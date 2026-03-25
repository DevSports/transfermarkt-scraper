# Command Examples

Examples below use the TypeScript exporter:

```bash
node --experimental-strip-types ./export-leagues.ts ...
```

## League / Club exports (`--mode leagues`)

### 1. Single league, single season
```bash
node --experimental-strip-types ./export-leagues.ts \
  --mode leagues \
  --league-ids GB1 \
  --seasons 2025 \
  --delay-ms 500 \
  --out ./output/leagues-gb1-2025.json
```

### 2. Multiple leagues, multiple seasons
```bash
node --experimental-strip-types ./export-leagues.ts \
  --mode leagues \
  --league-ids GB1,ES1,IT1 \
  --seasons 2023,2024,2025 \
  --delay-ms 800 \
  --out ./output/leagues-europe-top3.json
```

### 3. Premier League only (2025, 2024, 2023)
```bash
node --experimental-strip-types ./export-leagues.ts \
  --mode leagues \
  --league-ids GB1 \
  --seasons 2025,2024,2023 \
  --delay-ms 500 \
  --out ./output/premier-league-2025-2024-2023.json
```

## Nation exports (`--mode nations`)

### 1. All nations, one season, all discovered squad levels
```bash
node --experimental-strip-types ./export-leagues.ts \
  --mode nations \
  --seasons 2025 \
  --delay-ms 500 \
  --out ./output/nations-2025.json
```

### 2. Specific countries only (ISO-2)
```bash
node --experimental-strip-types ./export-leagues.ts \
  --mode nations \
  --seasons 2025 \
  --country-codes GB,ES,FR \
  --delay-ms 500 \
  --out ./output/nations-gb-es-fr-2025.json
```

### 2b. England only (Transfermarkt country code)
```bash
node --experimental-strip-types ./export-leagues.ts \
  --mode nations \
  --seasons 2025 \
  --country-codes GB-ENG \
  --squad-levels senior,u21,u18 \
  --delay-ms 500 \
  --out ./output/england-senior-u21-u18-2025.json
```

### 3. Specific squad levels only (senior + youth)
```bash
node --experimental-strip-types ./export-leagues.ts \
  --mode nations \
  --seasons 2025 \
  --squad-levels senior,u21,u18 \
  --delay-ms 500 \
  --out ./output/nations-senior-u21-u18-2025.json
```

### 4. Multiple seasons with country and level filters
```bash
node --experimental-strip-types ./export-leagues.ts \
  --mode nations \
  --seasons 2023,2024,2025 \
  --country-codes GB,DE,BR \
  --squad-levels senior,u21 \
  --delay-ms 700 \
  --out ./output/nations-gb-de-br-senior-u21.json
```

## Notes

- `--league-ids` are Transfermarkt competition codes for first-tier domestic leagues (example: `GB1`, `ES1`).
- `--country-codes` accepts ISO-2 (example: `GB`, `ES`) or Transfermarkt country codes (example: `GB-ENG`).
- `--squad-levels` accepts `all` (default) or values like `senior,u21,u18`.
- In `--mode nations`, output shape now matches leagues mode: `League[] -> seasons[] -> teams[]`.
- Nations mode uses synthetic per-level competitions, for example:
  - `NAT-SEN` -> `National Teams - Senior`
  - `NAT-U21` -> `National Teams - U21`
  - `NAT-U18` -> `National Teams - U18`
- Output is one combined JSON file per command.
