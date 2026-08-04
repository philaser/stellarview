# Flight Tracker

Live map of aircraft over a user-selected region, with flight details on click. Built entirely on free data sources.

## Prereqs

- Node 20+
- Recommended: free OpenSky Network account (4,000 credits/day vs 400 anonymous)

## Setup

npm install
npm run build:airports   # downloads OurAirports CSV, generates server/data/airports.json

## Run

npm run dev              # server on :3001, client on :5173

Optional env vars (server/.env): OPENSKY_USERNAME, OPENSKY_PASSWORD, AIRLABS_API_KEY, PROVIDER

## Providers

| PROVIDER value | Requires | Notes |
|---|---|---|
| `opensky` (default) | optional OPENSKY_USERNAME/PASSWORD | 4,000 cr/day registered vs 400 anonymous — register for free |
| `airlabs` | AIRLABS_API_KEY | 1,000 req/mo free, reduced fields |

Set PROVIDER / AIRLABS_API_KEY / OPENSKY_USERNAME / OPENSKY_PASSWORD in `server/.env`.
