export interface ScraperPlayerRaw {
  type: "player";
  href: string;
  parent: Record<string, unknown>; // usually a club or national_team object passed into crawler

  name: string | null;
  last_name: string | null;
  number: string | null;

  name_in_home_country: string | null;
  date_of_birth: string | null;
  place_of_birth: {
    country: string | null;
    city: string | null;
  };
  age: string | null;
  height: string | null;
  full_name: string | null;

  citizenship: string | null;
  additional_citizenships?: string[];

  position: string | null;

  player_agent: {
    href: string | null;
    name: string | null;
  };

  image_url: string | null;
  current_club: {
    href: string | null;
  };

  foot: string | null;
  joined: string | null;
  contract_expires: string | null;
  day_of_last_contract_extension: string | null;
  outfitter: string | null;

  national_team?: {
    country: string | null;
    href: string | null;
  };

  international_caps?: string | null;
  international_goals?: string | null;

  current_market_value: string | null;
  highest_market_value: string | null;
  social_media?: string[];

  market_value_history: Array<Record<string, unknown>> | null;
  code: string;
}
