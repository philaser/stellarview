# Flight Tracker

Two browser tracking experiences sharing an Express API:

- **Aircraft** (`client`): regional live aircraft positions from OpenSky or AirLabs, flight search, selection details and available flight tracks.
- **Satellites** (`sat-client`): an interactive 3D globe and 2D map, catalog search, orbital filters, predicted positions, observer visibility and upcoming passes.

The satellite globe uses globe.gl and Three.js. Both 2D maps use MapLibre GL and OpenFreeMap. Satellite positions are calculated with satellite.js from CelesTrak orbital elements; they are predictions, not live telemetry. Displayed satellite heights are compressed, and the selected path is a projected ground track, not a true-scale 3D orbit.

## Setup

Requires Node 20+ and npm.

```sh
npm install
npm run build:airports
```

The airport build downloads OurAirports data into `server/data/airports.json`.

## Run locally

```sh
npm run dev       # aircraft client + API
npm run dev:sat   # satellite client + API
```

The API defaults to port 3001. Vite normally uses port 5173, or the next available port; use the URL printed by Vite. To run both clients against one API, start these in separate terminals:

```sh
npm run dev:server
npm run dev:client
npm run dev:sat-client
```

Clients call `/api/*` through the Vite development proxy. Map tiles are loaded by MapLibre directly from OpenFreeMap. Globe textures and country boundaries are bundled locally.

## Configuration

Optional settings go in `server/.env`, which is ignored by Git.

| Variable | Purpose |
| --- | --- |
| `PROVIDER` | `opensky` (default) or `airlabs` for aircraft data |
| `OPENSKY_USERNAME` | OpenSky OAuth client ID (legacy variable name) |
| `OPENSKY_PASSWORD` | OpenSky OAuth client secret (legacy variable name) |
| `AIRLABS_API_KEY` | Required when `PROVIDER=airlabs` |
| `PORT` | API listening port; defaults to 3001 |
| `CACHE_TTL_MS` | Aircraft response cache; defaults to 15000 ms |
| `TRACK_CACHE_TTL_MS` | Aircraft track cache; defaults to 120000 ms |
| `TLE_CACHE_TTL_MS` | Satellite catalog cache; defaults to 43200000 ms (12 hours) |

Aircraft data availability and rate limits depend on the selected provider and account. A missing flight track does not mean position tracking has stopped. Satellite catalog downloads are cached locally; cached or stale data is identified in the UI. Observer location is used for visibility and pass predictions, not required for basic satellite details.

## Verify

```sh
npm test
npm run typecheck -w server
npm run build -w client
npm run build -w sat-client
```

The server integration tests bind temporary local ports. Run them in an environment that permits loopback listening. See `DESIGN.md` for the satellite interface conventions and display semantics.

## Deploy Stellarview to Render

`render.yaml` defines a free Node web service for the satellite app and its API.
Build with `npm ci --include=dev && npm run build -w sat-client`, then run
`NODE_ENV=production npm start -w server`. Render supplies `PORT`; `/healthz`
reports readiness and the deployed `RENDER_GIT_COMMIT`.

The free service sleeps when idle. Its local TLE cache is ephemeral and is
refetched from CelesTrak after a new deployment; no satellite API credentials
are required.
