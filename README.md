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
