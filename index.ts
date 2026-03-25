export interface League {
  id: string;
  name: string;
  country: Country;
  seasons: Season[];
}

export interface Nation {
  id: string;
  name: string;
  seasons: Season[];
}

export interface Country {
  name: string;
  code: string;
}

export interface Season {
  year: number;
  teams: Team[];
}

export interface Team {
  id: number;
  name: string;
  code: string;
  countryCode: string;
  national: boolean;
  players: Player[];
}

export type NationSeason = Season;
export type NationSquad = Team;

export interface Player {
  id: number;
  firstName: string;
  lastName: string | null;
  birthDate: string | null;
  nationality: string | null;
  heightCm: number | null;
  photo: string | null;
  position: "Attack" | "Midfield" | "Defender" | "Goalkeeper" | null;
  number: number | null;
}
