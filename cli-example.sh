node --experimental-strip-types ./export-leagues.ts \
  --mode nations \
  --seasons 2025 \
  --country-codes GB-ENG \
  --squad-levels senior,u21,u18 \
  --delay-ms 500 \
  --out ./outputs/nations-senior-u21-u18-2025.json

  node --experimental-strip-types ./export-leagues.ts \
  --mode nations \
  --seasons 2025 \
  --squad-levels senior,u21 \
  --delay-ms 500 \
  --out ./outputs/nations-senior-u21-2025.json

  node --experimental-strip-types ./export-leagues.ts \
  --mode leagues \
  --seasons 2000,2001,2002,2003,2004,2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024,2025 \
  --league-ids GB1,GB2,GB3,GB4,CNAT,NLS6,NLN6,GB18,GB21 \
  --delay-ms 500 \
  --out ./outputs/leagues-gb1-2000-2025.json

  node --experimental-strip-types ./export-leagues.ts \
  --mode leagues \
  --seasons 2025 \
  --league-ids GB1 \
  --delay-ms 500 \
  --out ./outputs/leagues-gb1-2025.json