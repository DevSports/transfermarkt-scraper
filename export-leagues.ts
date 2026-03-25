#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { COUNTRY_CODE_BY_NORMALIZED_NAME } from "./country-code-map.ts";
import type { League, Player, Season, Team } from "./index";

type ExportMode = "leagues" | "nations";
type CrawlerName =
  | "confederations"
  | "competitions"
  | "countries"
  | "clubs"
  | "national_teams"
  | "players";

interface CliOptions {
  mode: ExportMode;
  leagueIds: string[];
  seasons: number[];
  delayMs: number;
  out: string;
  countryCodes: string[];
  squadLevels: Set<string> | null;
}

interface ConfederationItem {
  type: "confederation";
  href: string;
}

interface CompetitionItem {
  type: "competition";
  href: string;
  competition_type: string;
  competition_name?: string;
  country_name?: string;
  country_code?: string;
}

interface CountryItem {
  type: "country";
  href: string;
  country_name?: string;
  country_code?: string;
}

interface ClubItem {
  type: "club";
  href: string;
  name?: string;
  code?: string;
  parent?: {
    href?: string;
    country_code?: string;
  };
}

interface NationalTeamItem {
  type: "national_team";
  href: string;
  parent?: {
    href?: string;
    country_name?: string;
    country_code?: string;
  };
  team_level?: string;
  team_label?: string;
  name?: string;
  code?: string;
  team_image_url?: string;
  squad_size?: string;
  average_age?: string;
  total_market_value?: string;
  coach_name?: string;
  coach_href?: string;
  confederation?: string;
  fifa_ranking?: string | null;
}

interface PlayerItem {
  type: "player";
  href: string;
  name?: string;
  last_name?: string;
  full_name?: string;
  date_of_birth?: string;
  citizenship?: string;
  citizienship?: string;
  height?: string;
  image_url?: string;
  position?: string;
  number?: string | number | null;
  parent?: {
    href?: string;
  };
}

interface SpawnResult<T extends object> {
  items: T[];
  stdout: string;
  stderr: string;
  code: number | null;
}

interface PythonInvocation {
  command: string;
  prefixArgs: string[];
  label: string;
}

type CrawlerRunner = <T extends object>(
  crawler: CrawlerName,
  season: number,
  parents?: object[]
) => Promise<T[]>;

interface NationTeamCandidate {
  level: string;
  nationName: string;
  label: string;
  name: string;
  href: string;
  fifaRanking: string | null;
  team: Team;
}

function printHelp(): void {
  console.log(`Usage:
  node export-leagues.ts --mode leagues --league-ids GB1,ES1 --seasons 2023,2024 --delay-ms 1000 [--out ./leagues.json]
  node export-leagues.ts --mode nations --seasons 2023,2024 [--country-codes GB,ES] [--squad-levels senior,u21,u18] [--out ./nations.json]

Arguments:
  --mode          Export mode: leagues | nations (default: leagues)
  --league-ids    Comma-separated first-tier league codes (required in leagues mode)
  --seasons       Comma-separated season years (required)
  --delay-ms      Delay in milliseconds between crawler process invocations (default: 0)
  --country-codes Optional country filters for nations mode (ISO-2 or Transfermarkt code, example: GB,ES,GB-ENG)
  --squad-levels  Optional levels for nations mode: all | senior | uXX list (example: senior,u21,u18)
                  Nations mode outputs club-like League[] with synthetic level competitions (NAT-SEN, NAT-U21, ...)
  --out           Output file path (defaults: ./leagues.json or ./nations.json)

Environment:
  TFMKT_PYTHON_BIN  Override Python command (example: python3)
`);
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseSeasons(value: string): number[] {
  const seasons = parseCsv(value).map((entry) => Number(entry));
  if (seasons.length === 0) {
    throw new Error("At least one season is required in --seasons");
  }
  if (seasons.some((season) => !Number.isInteger(season) || season <= 0)) {
    throw new Error(`Invalid --seasons value: "${value}"`);
  }
  return Array.from(new Set(seasons));
}

function parseLeagueIds(value: string): string[] {
  const leagueIds = parseCsv(value).map((leagueId) => leagueId.toUpperCase());
  if (leagueIds.length === 0) {
    throw new Error("At least one league id is required in --league-ids");
  }
  return Array.from(new Set(leagueIds));
}

function parseDelay(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid --delay-ms value: "${value}"`);
  }
  return parsed;
}

function parseMode(value: string): ExportMode {
  if (value === "leagues" || value === "nations") {
    return value;
  }
  throw new Error(`Invalid --mode value: "${value}". Expected leagues|nations`);
}

function parseCountryCodes(value: string): string[] {
  const codes = parseCsv(value).map((item) => item.toUpperCase());
  if (codes.length === 0) {
    throw new Error("At least one country code is required in --country-codes");
  }
  for (const code of codes) {
    if (!/^[A-Z]{2}(?:-[A-Z0-9]{2,})?$/.test(code)) {
      throw new Error(
        `Invalid country code in --country-codes: "${code}". Use ISO-2 (GB) or Transfermarkt code (GB-ENG).`
      );
    }
  }
  return Array.from(new Set(codes));
}

function normalizeSquadLevel(value: unknown): string {
  const raw = cleanText(value).toLowerCase();
  if (!raw) {
    return "senior";
  }
  if (raw === "senior") {
    return "senior";
  }
  const match = raw.match(/u[-\s]?(\d{1,2})/i);
  if (match) {
    return `u${Number(match[1])}`;
  }
  return raw.replace(/\s+/g, "");
}

function parseSquadLevels(value: string): Set<string> | null {
  const levels = parseCsv(value).map((item) => item.toLowerCase());
  if (levels.length === 0) {
    throw new Error("At least one level is required in --squad-levels");
  }

  const normalized = levels.map((level) => {
    if (level === "all") {
      return "all";
    }
    const parsed = normalizeSquadLevel(level);
    if (parsed !== "senior" && !/^u\d{1,2}$/.test(parsed)) {
      throw new Error(
        `Invalid squad level "${level}" in --squad-levels. Use senior or uXX values.`
      );
    }
    return parsed;
  });

  if (normalized.includes("all")) {
    if (normalized.length > 1) {
      throw new Error('"all" cannot be combined with other values in --squad-levels');
    }
    return null;
  }

  return new Set(normalized);
}

function parseArgs(argv: string[]): CliOptions {
  let mode: ExportMode = "leagues";
  let leagueIdsRaw: string | undefined;
  let seasonsRaw: string | undefined;
  let delayMs = 0;
  let outRaw: string | undefined;
  let countryCodesRaw: string | undefined;
  let squadLevelsRaw: string | undefined;

  const valueArgs = new Set([
    "--mode",
    "--league-ids",
    "--seasons",
    "--delay-ms",
    "--out",
    "--country-codes",
    "--squad-levels",
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (!valueArgs.has(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--mode") {
      mode = parseMode(next);
    } else if (arg === "--league-ids") {
      leagueIdsRaw = next;
    } else if (arg === "--seasons") {
      seasonsRaw = next;
    } else if (arg === "--delay-ms") {
      delayMs = parseDelay(next);
    } else if (arg === "--out") {
      outRaw = next;
    } else if (arg === "--country-codes") {
      countryCodesRaw = next;
    } else if (arg === "--squad-levels") {
      squadLevelsRaw = next;
    }

    index += 1;
  }

  if (!seasonsRaw) {
    throw new Error("--seasons is required");
  }

  const leagueIds = leagueIdsRaw ? parseLeagueIds(leagueIdsRaw) : [];
  const countryCodes = countryCodesRaw ? parseCountryCodes(countryCodesRaw) : [];
  const squadLevels = squadLevelsRaw ? parseSquadLevels(squadLevelsRaw) : null;

  if (mode === "leagues" && leagueIds.length === 0) {
    throw new Error("--league-ids is required in leagues mode");
  }

  const defaultOut = mode === "nations" ? "./nations.json" : "./leagues.json";

  return {
    mode,
    leagueIds,
    seasons: parseSeasons(seasonsRaw),
    delayMs,
    out: path.resolve(outRaw ?? defaultOut),
    countryCodes,
    squadLevels,
  };
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseNdjsonLine<T extends object>(line: string, context: string): T {
  try {
    return JSON.parse(line) as T;
  } catch {
    throw new Error(`Failed parsing NDJSON from ${context}: ${line.slice(0, 200)}`);
  }
}

function runSubprocess<T extends object>(
  command: string,
  args: string[],
  context: string,
  inputItems?: object[],
  parseNdjson = true
): Promise<SpawnResult<T>> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    const items: T[] = [];
    let stdoutBuffer = "";
    let stderrBuffer = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      if (!parseNdjson) {
        return;
      }

      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (line.length > 0) {
          items.push(parseNdjsonLine<T>(line, context));
        }
        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    });

    child.stderr.on("data", (chunk: string) => {
      stderrBuffer += chunk;
    });

    child.once("error", (error) => {
      reject(new Error(`${context} failed to start (${command}): ${error.message}`));
    });

    child.once("close", (code) => {
      const leftover = stdoutBuffer.trim();
      if (parseNdjson && leftover.length > 0) {
        items.push(parseNdjsonLine<T>(leftover, context));
      }
      resolve({
        items,
        stdout: stdoutBuffer,
        stderr: stderrBuffer.trim(),
        code,
      });
    });

    const input =
      inputItems && inputItems.length > 0
        ? `${inputItems.map((item) => JSON.stringify(item)).join("\n")}\n`
        : "";
    child.stdin.end(input, "utf8");
  });
}

function parseCommandSpec(spec: string): PythonInvocation {
  const parts = spec
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new Error("Empty Python command override");
  }
  return {
    command: parts[0],
    prefixArgs: parts.slice(1),
    label: spec.trim(),
  };
}

async function detectPythonCommand(): Promise<PythonInvocation> {
  const envOverride = process.env.TFMKT_PYTHON_BIN?.trim();
  const candidates: PythonInvocation[] = envOverride
    ? [parseCommandSpec(envOverride)]
    : [
        { command: "python3", prefixArgs: [], label: "python3" },
        { command: "python", prefixArgs: [], label: "python" },
        {
          command: "poetry",
          prefixArgs: ["run", "python3"],
          label: "poetry run python3",
        },
        {
          command: "poetry",
          prefixArgs: ["run", "python"],
          label: "poetry run python",
        },
      ];

  for (const candidate of candidates) {
    try {
      const result = await runSubprocess<object>(
        candidate.command,
        [...candidate.prefixArgs, "-c", "import crawlee; import tfmkt"],
        "python probe",
        undefined,
        false
      );
      if (result.code === 0) {
        return candidate;
      }
    } catch {
      // try next candidate
    }
  }

  if (envOverride) {
    throw new Error(
      `Could not execute tfmkt with TFMKT_PYTHON_BIN="${envOverride}". ` +
        "Ensure the command exists and this repository dependencies are installed."
    );
  }

  throw new Error(
    'Could not find a working Python command for "python -m tfmkt". Tried python3 and python.'
  );
}

async function runCrawler<T extends object>(
  python: PythonInvocation,
  crawler: CrawlerName,
  season: number,
  parents?: object[]
): Promise<T[]> {
  const args = [...python.prefixArgs, "-m", "tfmkt", crawler, "-s", String(season)];
  const context = `${crawler} crawler (season ${season})`;
  const result = await runSubprocess<T>(python.command, args, context, parents);

  if (result.code !== 0) {
    if (crawler === "players" && result.items.length > 0) {
      const stderrPreview = result.stderr
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(-3)
        .join(" | ");
      console.error(
        `[export] warning: ${context} exited with code ${String(result.code)}. ` +
          `Continuing with partial player data (${result.items.length} items).` +
          (stderrPreview ? ` Recent errors: ${stderrPreview}` : "")
      );
      return result.items;
    }

    const stderrSuffix = result.stderr ? `\n${result.stderr}` : "";
    throw new Error(`${context} exited with code ${String(result.code)}.${stderrSuffix}`);
  }

  return result.items;
}

function extractIdFromHref(href: string, segment: "verein" | "spieler"): number | null {
  const match = href.match(new RegExp(`/${segment}/(\\d+)`));
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function cleanText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim();
}

function cleanNullable(value: unknown): string | null {
  const cleaned = cleanText(value);
  return cleaned.length > 0 ? cleaned : null;
}

function normalizeCountryKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "");
}

function deriveFallbackCountryCode(rawCountry: string): string {
  const letters = rawCountry
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "")
    .toUpperCase();
  return (letters.slice(0, 2) || "UN").padEnd(2, "X");
}

function normalizeCountryCode(value: unknown): string | null {
  const raw = cleanText(value);
  if (!raw) {
    return null;
  }
  const mapped = COUNTRY_CODE_BY_NORMALIZED_NAME[normalizeCountryKey(raw)];
  if (mapped) {
    return mapped;
  }
  return deriveFallbackCountryCode(raw);
}

function homeNationAlias(countryName: string, iso2: string): string | null {
  if (iso2 !== "GB") {
    return null;
  }

  const normalized = normalizeCountryKey(countryName);
  if (normalized === "england") {
    return "GB-ENG";
  }
  if (normalized === "scotland") {
    return "GB-SCO";
  }
  if (normalized === "wales") {
    return "GB-WAL";
  }
  if (normalized === "northernireland") {
    return "GB-NIR";
  }
  return null;
}

function parseHeightCm(height: unknown): number | null {
  if (typeof height !== "string") {
    return null;
  }
  const normalized = height.replace(",", ".").trim();

  const metersMatch = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*m/i);
  if (metersMatch) {
    return Math.round(Number(metersMatch[1]) * 100);
  }

  const cmMatch = normalized.match(/([0-9]{2,3})\s*cm/i);
  if (cmMatch) {
    return Number(cmMatch[1]);
  }

  return null;
}

function parseShirtNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(/-?\d+/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePlayerNames(item: PlayerItem, playerId: number): {
  firstName: string;
  lastName: string | null;
} {
  const shortNameRaw = cleanText(item.name);
  const rawLastName = cleanText(item.last_name);
  const rawFullName = cleanText(item.full_name);

  let fullName = rawFullName;
  if (
    !fullName &&
    shortNameRaw &&
    rawLastName &&
    !shortNameRaw.toLowerCase().endsWith(rawLastName.toLowerCase())
  ) {
    fullName = `${shortNameRaw} ${rawLastName}`;
  }
  if (!fullName) {
    fullName = shortNameRaw || rawLastName || `Player ${playerId}`;
  }

  let firstName = shortNameRaw || fullName.split(" ")[0] || fullName;

  let lastName: string | null = rawLastName || null;
  if (!lastName) {
    const parts = fullName.split(" ").filter((part) => part.length > 0);
    if (parts.length > 1) {
      lastName = parts[parts.length - 1];
    }
  }

  if (
    lastName &&
    firstName &&
    firstName.trim().toLowerCase() === lastName.trim().toLowerCase()
  ) {
    firstName = "";
  }

  return {
    firstName,
    lastName,
  };
}

function normalizePosition(value: unknown): Player["position"] {
  const position = cleanText(value).toLowerCase();
  if (!position) {
    return null;
  }
  if (position.includes("goalkeeper")) {
    return "Goalkeeper";
  }
  if (position.includes("defender") || position.includes("back") || position.includes("cb")) {
    return "Defender";
  }
  if (position.includes("midfield") || position.includes("wing-back")) {
    return "Midfield";
  }
  if (
    position.includes("attack") ||
    position.includes("striker") ||
    position.includes("forward") ||
    position.includes("winger")
  ) {
    return "Attack";
  }
  return null;
}

function normalizePlayer(item: PlayerItem): Player | null {
  const playerId = extractIdFromHref(item.href, "spieler");
  if (playerId === null) {
    return null;
  }

  const names = normalizePlayerNames(item, playerId);

  return {
    id: playerId,
    firstName: names.firstName,
    lastName: names.lastName,
    birthDate: cleanNullable(item.date_of_birth),
    nationality: normalizeCountryCode(item.citizenship ?? item.citizienship),
    heightCm: parseHeightCm(item.height),
    photo: cleanNullable(item.image_url),
    position: normalizePosition(item.position),
    number: parseShirtNumber(item.number),
  };
}

function sortByIdAsc<T extends { id: number }>(left: T, right: T): number {
  return left.id - right.id;
}

function compareSquadLevels(left: string, right: string): number {
  const normalize = (level: string): [number, number, string] => {
    const parsed = normalizeSquadLevel(level);
    if (parsed === "senior") {
      return [0, 0, parsed];
    }
    const match = parsed.match(/^u(\d{1,2})$/);
    if (match) {
      return [1, Number(match[1]), parsed];
    }
    return [2, 0, parsed];
  };

  const a = normalize(left);
  const b = normalize(right);

  if (a[0] !== b[0]) {
    return a[0] - b[0];
  }
  if (a[1] !== b[1]) {
    return a[1] - b[1];
  }
  return a[2].localeCompare(b[2]);
}

function formatNationLevelLabel(level: string): string {
  const normalized = normalizeSquadLevel(level);
  if (normalized === "senior") {
    return "Senior";
  }
  const uMatch = normalized.match(/^u(\d{1,2})$/);
  if (uMatch) {
    return `U${uMatch[1]}`;
  }
  return normalized.toUpperCase();
}

function nationCompetitionCode(level: string): string {
  const normalized = normalizeSquadLevel(level);
  if (normalized === "senior") {
    return "NAT-SEN";
  }
  const uMatch = normalized.match(/^u(\d{1,2})$/);
  if (uMatch) {
    return `NAT-U${uMatch[1]}`;
  }
  const fallback = normalized.toUpperCase().replace(/[^A-Z0-9]+/g, "");
  return `NAT-${fallback || "OTHER"}`;
}

function nationCompetitionName(level: string): string {
  return `National Teams - ${formatNationLevelLabel(level)}`;
}

function levelFromNationCompetitionId(competitionId: string): string {
  if (competitionId === "NAT-SEN") {
    return "senior";
  }
  const uMatch = competitionId.match(/^NAT-U(\d{1,2})$/i);
  if (uMatch) {
    return `u${Number(uMatch[1])}`;
  }
  const genericMatch = competitionId.match(/^NAT-(.+)$/);
  if (genericMatch) {
    return genericMatch[1].toLowerCase();
  }
  return competitionId.toLowerCase();
}

function scoreNationTeamCandidate(candidate: NationTeamCandidate): number {
  const label = candidate.label.toLowerCase();
  const name = candidate.name.toLowerCase();
  const nation = candidate.nationName.toLowerCase();

  let score = 0;

  // Prefer the canonical national team over alternates such as "B" teams.
  if (label === nation || name === nation) {
    score += 100;
  }
  if (!/\b(b|ii)\b/.test(label) && !/\b(b|ii)\b/.test(name)) {
    score += 20;
  }

  // Prefer richer/stronger records when available.
  if (candidate.fifaRanking !== null) {
    score += 10;
  }
  score += candidate.team.players.length;

  return score;
}

function shouldReplaceNationTeamCandidate(
  current: NationTeamCandidate,
  candidate: NationTeamCandidate
): boolean {
  const currentScore = scoreNationTeamCandidate(current);
  const candidateScore = scoreNationTeamCandidate(candidate);

  if (candidateScore !== currentScore) {
    return candidateScore > currentScore;
  }

  const currentId = current.team.id;
  const candidateId = candidate.team.id;
  if (candidateId !== currentId) {
    return candidateId < currentId;
  }

  return candidate.href < current.href;
}

async function exportLeagues(options: CliOptions, runWithDelay: CrawlerRunner): Promise<League[]> {
  const leagueData = new Map<string, League>();

  for (const season of options.seasons) {
    const confederations = await runWithDelay<ConfederationItem>("confederations", season);
    const competitionsAll = await runWithDelay<CompetitionItem>(
      "competitions",
      season,
      confederations
    );

    const requestedLeagueIds = new Set(options.leagueIds);
    const firstTierByCode = new Map<string, CompetitionItem>();

    for (const competition of competitionsAll) {
      const countryCode = competition.country_code?.toUpperCase();
      if (competition.competition_type !== "first_tier" || !countryCode) {
        continue;
      }
      if (!requestedLeagueIds.has(countryCode)) {
        continue;
      }
      if (!firstTierByCode.has(countryCode)) {
        firstTierByCode.set(countryCode, competition);
      }
    }

    const matchedCodes = new Set(firstTierByCode.keys());
    const unmatched = options.leagueIds.filter((leagueId) => !matchedCodes.has(leagueId));
    if (unmatched.length > 0) {
      const availableCodes = Array.from(
        new Set(
          competitionsAll
            .filter((competition) => competition.competition_type === "first_tier")
            .map((competition) => competition.country_code?.toUpperCase())
            .filter((code): code is string => Boolean(code))
        )
      ).sort();
      throw new Error(
        `Season ${season}: unmatched league ids: ${unmatched.join(", ")}. ` +
          `Available first-tier league ids include: ${availableCodes.join(", ")}`
      );
    }

    const selectedCompetitions = options.leagueIds
      .map((leagueId) => firstTierByCode.get(leagueId))
      .filter((competition): competition is CompetitionItem => Boolean(competition));

    const clubs = await runWithDelay<ClubItem>("clubs", season, selectedCompetitions);
    const players = await runWithDelay<PlayerItem>("players", season, clubs);

    const playersByClubHref = new Map<string, Map<number, Player>>();
    for (const playerItem of players) {
      const clubHref = playerItem.parent?.href;
      if (!clubHref) {
        continue;
      }

      const normalized = normalizePlayer(playerItem);
      if (!normalized) {
        continue;
      }

      let playersForClub = playersByClubHref.get(clubHref);
      if (!playersForClub) {
        playersForClub = new Map<number, Player>();
        playersByClubHref.set(clubHref, playersForClub);
      }

      if (!playersForClub.has(normalized.id)) {
        playersForClub.set(normalized.id, normalized);
      }
    }

    for (const competition of selectedCompetitions) {
      const leagueId = competition.country_code?.toUpperCase();
      if (!leagueId) {
        continue;
      }

      const standardizedCompetitionCountryCode =
        normalizeCountryCode(competition.country_name) ?? "UN";

      const teamsById = new Map<number, Team>();
      const competitionClubs = clubs.filter((club) => club.parent?.href === competition.href);

      for (const club of competitionClubs) {
        const teamId = extractIdFromHref(club.href, "verein");
        if (teamId === null || teamsById.has(teamId)) {
          continue;
        }

        const normalizedPlayers = Array.from(
          playersByClubHref.get(club.href)?.values() ?? []
        ).sort(sortByIdAsc);

        const team: Team = {
          id: teamId,
          name: cleanText(club.name) || cleanText(club.code) || `Team ${teamId}`,
          code: cleanText(club.code) || `team-${teamId}`,
          countryCode: standardizedCompetitionCountryCode,
          national: false,
          players: normalizedPlayers,
        };

        teamsById.set(teamId, team);
      }

      const seasonEntry: Season = {
        year: season,
        teams: Array.from(teamsById.values()).sort(sortByIdAsc),
      };

      let league = leagueData.get(leagueId);
      if (!league) {
        league = {
          id: leagueId,
          name: cleanText(competition.competition_name) || leagueId,
          country: {
            name: cleanText(competition.country_name) || leagueId,
            code: standardizedCompetitionCountryCode,
          },
          seasons: [],
        };
        leagueData.set(leagueId, league);
      }

      league.seasons.push(seasonEntry);
    }
  }

  return Array.from(leagueData.values())
    .map((league) => ({
      ...league,
      seasons: league.seasons.sort((left, right) => left.year - right.year),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function exportNations(options: CliOptions, runWithDelay: CrawlerRunner): Promise<League[]> {
  const competitionData = new Map<string, League>();
  const requestedCountryCodes = new Set(options.countryCodes);

  for (const season of options.seasons) {
    const confederations = await runWithDelay<ConfederationItem>("confederations", season);
    const countries = await runWithDelay<CountryItem>("countries", season, confederations);

    const availableCountryCodes = new Set<string>();
    const matchedRequestedCodes = new Set<string>();
    const selectedCountries: CountryItem[] = [];

    for (const country of countries) {
      const countryName = cleanText(country.country_name);
      const normalizedCountryCode = normalizeCountryCode(countryName) ?? "UN";
      const transfermarktCountryCode = cleanText(country.country_code).toUpperCase();
      const aliasCode = homeNationAlias(countryName, normalizedCountryCode);
      availableCountryCodes.add(normalizedCountryCode);
      if (transfermarktCountryCode) {
        availableCountryCodes.add(transfermarktCountryCode);
      }
      if (aliasCode) {
        availableCountryCodes.add(aliasCode);
      }

      const matchesRequestedCountryCode =
        requestedCountryCodes.size === 0 ||
        requestedCountryCodes.has(normalizedCountryCode) ||
        (aliasCode !== null && requestedCountryCodes.has(aliasCode)) ||
        (transfermarktCountryCode.length > 0 &&
          requestedCountryCodes.has(transfermarktCountryCode));

      if (matchesRequestedCountryCode) {
        selectedCountries.push(country);
        if (requestedCountryCodes.size > 0) {
          if (requestedCountryCodes.has(normalizedCountryCode)) {
            matchedRequestedCodes.add(normalizedCountryCode);
          }
          if (aliasCode !== null && requestedCountryCodes.has(aliasCode)) {
            matchedRequestedCodes.add(aliasCode);
          }
          if (
            transfermarktCountryCode.length > 0 &&
            requestedCountryCodes.has(transfermarktCountryCode)
          ) {
            matchedRequestedCodes.add(transfermarktCountryCode);
          }
        }
      }
    }

    if (requestedCountryCodes.size > 0) {
      const unmatchedCountryCodes = options.countryCodes.filter(
        (code) => !matchedRequestedCodes.has(code)
      );
      if (unmatchedCountryCodes.length > 0) {
        throw new Error(
          `Season ${season}: unmatched country codes: ${unmatchedCountryCodes.join(", ")}. ` +
            `Available country codes include: ${Array.from(availableCountryCodes)
              .sort()
              .join(", ")}`
        );
      }
    }

    const nationalTeamsAll = await runWithDelay<NationalTeamItem>(
      "national_teams",
      season,
      selectedCountries
    );

    const availableLevels = new Set(
      nationalTeamsAll.map((team) => normalizeSquadLevel(team.team_level ?? team.team_label))
    );

    let selectedNationalTeams = nationalTeamsAll;
    if (options.squadLevels) {
      selectedNationalTeams = nationalTeamsAll.filter((team) =>
        options.squadLevels?.has(normalizeSquadLevel(team.team_level ?? team.team_label))
      );

      const matchedLevels = new Set(
        selectedNationalTeams.map((team) =>
          normalizeSquadLevel(team.team_level ?? team.team_label)
        )
      );
      const unmatchedLevels = Array.from(options.squadLevels).filter(
        (level) => !matchedLevels.has(level)
      );
      if (unmatchedLevels.length > 0) {
        throw new Error(
          `Season ${season}: unmatched squad levels: ${unmatchedLevels.join(", ")}. ` +
            `Available levels include: ${Array.from(availableLevels).sort().join(", ")}`
        );
      }
    }

    const players = await runWithDelay<PlayerItem>("players", season, selectedNationalTeams);

    const playersByTeamHref = new Map<string, Map<number, Player>>();
    for (const playerItem of players) {
      const teamHref = playerItem.parent?.href;
      if (!teamHref) {
        continue;
      }

      const normalized = normalizePlayer(playerItem);
      if (!normalized) {
        continue;
      }

      let playersForTeam = playersByTeamHref.get(teamHref);
      if (!playersForTeam) {
        playersForTeam = new Map<number, Player>();
        playersByTeamHref.set(teamHref, playersForTeam);
      }

      if (!playersForTeam.has(normalized.id)) {
        playersForTeam.set(normalized.id, normalized);
      }
    }

    const bestCandidatesByLevelAndCountry = new Map<string, NationTeamCandidate>();
    for (const nationalTeam of selectedNationalTeams) {
      const teamId = extractIdFromHref(nationalTeam.href, "verein");
      if (teamId === null) {
        continue;
      }

      const countryName = cleanText(nationalTeam.parent?.country_name);
      const countryCode = normalizeCountryCode(countryName) ?? "UN";
      const nationName = countryName || countryCode;
      const level = normalizeSquadLevel(nationalTeam.team_level ?? nationalTeam.team_label);
      const label =
        cleanText(nationalTeam.team_label) ||
        cleanText(nationalTeam.name) ||
        level.toUpperCase();

      const team: Team = {
        id: teamId,
        name: cleanText(nationalTeam.name) || label,
        code: cleanText(nationalTeam.code) || `team-${teamId}`,
        countryCode,
        national: true,
        players: Array.from(playersByTeamHref.get(nationalTeam.href)?.values() ?? []).sort(
          sortByIdAsc
        ),
      };

      const candidate: NationTeamCandidate = {
        level,
        nationName,
        label,
        name: team.name,
        href: nationalTeam.href,
        fifaRanking: cleanNullable(nationalTeam.fifa_ranking),
        team,
      };

      const key = `${level}::${countryCode}`;
      const existingCandidate = bestCandidatesByLevelAndCountry.get(key);
      if (
        !existingCandidate ||
        shouldReplaceNationTeamCandidate(existingCandidate, candidate)
      ) {
        bestCandidatesByLevelAndCountry.set(key, candidate);
      }
    }

    const teamsByLevel = new Map<string, Map<number, Team>>();
    for (const candidate of bestCandidatesByLevelAndCountry.values()) {
      let teamsById = teamsByLevel.get(candidate.level);
      if (!teamsById) {
        teamsById = new Map<number, Team>();
        teamsByLevel.set(candidate.level, teamsById);
      }
      teamsById.set(candidate.team.id, candidate.team);
    }

    for (const [level, teamsById] of teamsByLevel.entries()) {
      if (teamsById.size === 0) {
        continue;
      }

      const competitionId = nationCompetitionCode(level);
      const competitionName = nationCompetitionName(level);

      let competition = competitionData.get(competitionId);
      if (!competition) {
        competition = {
          id: competitionId,
          name: competitionName,
          country: {
            name: "International",
            code: "UN",
          },
          seasons: [],
        };
        competitionData.set(competitionId, competition);
      }

      competition.seasons.push({
        year: season,
        teams: Array.from(teamsById.values()).sort(sortByIdAsc),
      });
    }
  }

  return Array.from(competitionData.values())
    .map((competition) => ({
      ...competition,
      seasons: competition.seasons
        .map((seasonEntry) => ({
          ...seasonEntry,
          teams: seasonEntry.teams.sort(sortByIdAsc),
        }))
        .sort((left, right) => left.year - right.year),
    }))
    .sort((left, right) => {
      const levelOrder = compareSquadLevels(
        levelFromNationCompetitionId(left.id),
        levelFromNationCompetitionId(right.id)
      );
      if (levelOrder !== 0) {
        return levelOrder;
      }
      return left.id.localeCompare(right.id);
    });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const python = await detectPythonCommand();
  console.error(`[export] using Python runner: ${python.label}`);
  console.error(`[export] mode: ${options.mode}`);

  let invocationCount = 0;
  const runWithDelay: CrawlerRunner = async <T extends object>(
    crawler: CrawlerName,
    season: number,
    parents?: object[]
  ): Promise<T[]> => {
    if (invocationCount > 0 && options.delayMs > 0) {
      await wait(options.delayMs);
    }
    invocationCount += 1;
    console.error(
      `[export] running ${crawler} (season=${season}, parents=${parents?.length ?? 0})`
    );
    return runCrawler<T>(python, crawler, season, parents);
  };

  const output =
    options.mode === "nations"
      ? await exportNations(options, runWithDelay)
      : await exportLeagues(options, runWithDelay);

  await mkdir(path.dirname(options.out), { recursive: true });
  await writeFile(options.out, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.error(`[export] wrote ${output.length} records to ${options.out}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[export] failed: ${message}`);
  process.exit(1);
});
