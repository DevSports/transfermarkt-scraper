export interface League {
  id: string;
  name: string;
  gender: "Male";
  country: Country;
  logo: string | null;
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
  gender: "Male";
  countryCode: string;
  national: boolean;
  logo: string | null;
  players: Player[];
}

export interface Player {
  id: number;
  firstName: string;
  lastName: string | null;
  gender: "Male";
  birthDate: string | null;
  nationality: string | null;
  heightCm: number | null;
  photo: string | null;
  position: "Attack" | "Midfield" | "Defender" | "Goalkeeper" | null;
  number: number | null;
}
