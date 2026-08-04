# Live Flight Tracker — Design Spec

Date: 2026-08-04
Status: Approved (pre-implementation)

## Purpose

A web app that shows live aircraft positions on a map, FlightRadar24-style, built entirely on free data sources. Users select a region to watch, see planes as markers colored by altitude, and click a plane to inspect its flight details.

## Constraints (from feasibility research, verified Aug 2026)

- **OpenSky Network** is the primary live-data provider: free registered account = 4,000 credits/day (~1,000 regional bbox polls/day). Blocks browser CORS — must be proxied server-side. Crowd-sourced ADS-B: strong over North America/Europe, gaps over oceans. No free historical data.
- **AirLabs** (1,000 req/mo, browser CORS, reduced fields on free) is the designated fallback/secondary provider.
- **OurAirports** public-domain CSVs (nightly updates) are the static airport-data source; bundled at build time.
- **OpenFreeMap** tiles + **MapLibre GL** for the map: no keys, no cost.
- All live requests go through a single in-memory cache (15s TTL) to stretch the OpenSky credit budget.

## Architecture

Monorepo with two apps, one language (TypeScript):

```
flight-tracker/
├── server/          # Express proxy + cache + provider abstraction
├── client/          # Vite + React + MapLibre GL
├── scripts/         # airport-dataset build script
└── docs/
```

### Server (Express + TypeScript)

Sole consumer of external APIs. Solves OpenSky's CORS block and centralizes credit/rate-limit handling.

**Endpoints**

- `GET /api/flights?bbox=minLon,minLat,maxLon,maxLat` — validated bbox (lon ∈ [-180,180], lat ∈ [-90,90], max area ~400 sq°), server-side call to OpenSky `/states/all`, response trimmed to a compact payload (see Data model). Responses cached in memory, 15s TTL (keyed by rounded bbox). On OpenSky failure, serve last cached response with `stale: true` flag.
- `GET /api/airports` — bundled dataset (id, icao, iata, name, lat, lon) served statically.

**Provider abstraction**

`FlightProvider` interface (`fetchStates(bbox): Promise<FlightState[]>`). Implementations: `OpenSkyProvider` (primary), `AirLabsProvider` (fallback — toggled via `PROVIDER` env var, requires `AIRLABS_API_KEY`). The proxy caches regardless of provider; provider choice is configuration, not code change.

**OpenSky auth**

Optional `OPENSKY_USERNAME`/`OPENSKY_PASSWORD` env vars (OAuth2 client-credentials, 30-min token cached in memory). Anonymous by default (400 credits/day); registered free account strongly recommended (4,000/day).

**Rate-limit handling**

On HTTP 429 from OpenSky, honor `X-Rate-Limit-Retry-After-Seconds`; back off, serve stale cache if available, and report `rateLimited: true` in the response so the client can show a banner.

**Airport dataset build script**

`scripts/build-airports.ts` downloads `airports.csv` from OurAirports (GitHub mirror), filters to airports with IATA codes (keeps size small), maps fields (icao/iata/name/lat/lon/elevation/timezone optional), writes `server/data/airports.json`. Run on demand; output committed to the repo.

### Client (Vite + React + MapLibre GL)

- MapLibre GL with OpenFreeMap raster/tile style — no API key.
- **Region selector**: presets (Europe, Continental US, Global) + "use current map bounds" option. Selecting a region stores it in React state and starts polling.
- **Polling**: every 20s by default (configurable via client setting), `GET /api/flights?bbox=…`. Polling stops when the tab is hidden (`document.visibilityState`) and resumes on visible.
- **Rendering**: plane markers as rotated aircraft glyphs, colored by altitude band (e.g., <3,000m / 3,000–7,000m / >7,000m). Click a marker to open the details panel.
- **Flight details panel**: callsign, aircraft category, origin country, altitude (barometric + geometric), groundspeed, heading, vertical rate, squawk, position source, on-ground flag, last contact time.
- **Status indicators**: "last updated Ns ago" clock; banner on `rateLimited` or `stale` responses; empty-state handling when the region has no aircraft.
- Client never calls OpenSky directly — only the proxy (no keys in the browser).

## Data model (trimmed flight state)

```ts
interface FlightState {
  icao24: string;
  callsign: string | null;        // trimmed, e.g. "UAL123"
  originCountry: string;
  lat: number | null;
  lon: number | null;
  altitudeBaro: number | null;    // meters
  altitudeGeo: number | null;     // meters
  velocity: number | null;        // m/s
  heading: number | null;         // degrees true
  verticalRate: number | null;    // m/s
  squawk: string | null;
  positionSource: number | null;  // OpenSky enum (0=ADS-B, 1=ASTERIX, 2=MLAT, 3=FLARM)
  onGround: boolean;
  lastContact: number;            // unix seconds
}
```

Stale/aircraft without fresh position (`time_position` > 60s old) are excluded from the map but this is a proxy-side filter so the client payload stays lean.

## Error handling

| Failure | Server behavior | Client behavior |
|---|---|---|
| OpenSky 429 | back off, serve stale cache, `rateLimited: true` | banner "rate limited, showing cached data" |
| OpenSky down/5xx | serve stale cache, `stale: true` | banner "stale data — provider unreachable" |
| No cache, provider down | 502 | banner + empty map |
| Invalid bbox | 400 | (client never sends invalid bbox) |
| Provider misconfig (e.g., AirLabs no key) | 500 with clear message, logged | server banner |

## Testing

- **Server (vitest, mocked fetch):** bbox validation, payload trimming, 15s cache behavior (subsequent calls hit cache, no second upstream fetch), 429 backoff + stale-serving, provider fallback wiring.
- **Client (vitest):** smoke test — component render, region preset selection triggers correct poll URL, details panel opens on marker click, rate-limited response shows banner.
- Manual verification: run both apps locally, load a preset region, confirm planes render and details panel works.

## Deliberately excluded (YAGNI, addable later)

- Airport boards (departures/arrivals), airline filters, callsign labels on map, historical playback, weather overlays (METAR via aviationweather.gov), multi-user/accounts, deployment config.
- Provider interface is the seam for all of these later additions.

## Out of scope for v1

- Hosting/deployment (local `npm run dev` only), Docker, auth/accounts, paid providers.
