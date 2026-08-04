# Satellite Tracker — Design Spec

Date: 2026-08-04
Status: Approved (pre-implementation)
Depends on: the existing flight-tracker monorepo (server proxy + patterns); the flight app itself is untouched.

## Purpose

A live satellite tracking map: curated satellites as moving dots with their orbit ground-tracks drawn on the map, click for details, and pass predictions over a user location. Key difference from the flight tracker: **positions are computed client-side from TLE orbital data (deterministic physics), not polled from an API** — no credits, no rate limits, the map animates itself.

## Data source (verified feasibility)

**CelesTrak** (celestrak.org) serves TLE orbital elements — free, no key, no quota of consequence. TLE text files are ~2KB per satellite; they change a few times a day (station-keeping). `satellite.js` (npm, MIT) implements SGP4 propagation, ECEF→geodetic conversion, and pass computation — the established library; do not hand-roll orbit math.

Fetch pattern: `https://celestrak.org/NORAD/elements/gp.php?CATNR=25544,20580,...&FORMAT=tle` returns one TLE block per catalog number, including line 0 with the satellite name. Multiple `CATNR` in one request.

CORS: unknown/blocked in general — route through the server proxy (established pattern).

## Curated satellite config

~15 objects; the config is the seam for later category filters. Chosen by NORAD catalog number; **names/categories come from the TLE response itself** (line 0 name), so the implementer must verify each picked catalog number resolves to the intended satellite (query CelesTrak live during Task 1; adjust IDs if any 404). Mix:

- Manned/science LEO: ISS (25544), Tiangong (48274), Hubble (20580), TESS (43435)
- A handful of Starlinks (pick ~5 live from CelesTrak's `starlink` group during implementation)
- 1–2 weather: e.g., NOAA-18/19 (verify live)
- 1 geostationary (e.g., GOES-16) — appears as a hovering fixed dot above the equator; interesting contrast

Config shape: `{ catnr: number, category: "manned" | "science" | "comms" | "weather" | "geo", color: string }[]`. Category filtering is explicitly out of v1 (the field exists for later).

## Architecture

### Server (extend existing `server/`)

**`GET /api/tle?catnr=25544,20580,...`**
- Validate `catnr`: comma-separated 1–5 digit numbers → else 400
- Proxy to CelesTrak `gp.php` — one request **per catalog number** (CelesTrak rejects comma-joined `CATNR` with "not an integer"; verified live 2026-08-04), blocks concatenated; empty/"No GP data found" responses dropped
- Cache the combined result in-memory **12h TTL** (TtlCache, established pattern; `TLE_CACHE_TTL_MS` env, default 12h)
- Non-ok upstream → 502 `{"error":"provider unreachable"}`; no stale-fallback needed (client re-fetches next load; TLE age is not critical)
- Response: the raw TLE text block

### Client (new workspace `sat-client/`)

Vite + React + MapLibre GL — same stack/styling patterns as `client/`.

**Modules (pure, unit-testable):**
- `tle.ts` — parse CelesTrak TLE text via `satellite.js` `parseTle`; extract name (line 0), period (from mean motion), inclination, catalog number
- `propagate.ts` — `positionAt(satrec, date)` → `{ lat, lon, altKm }` via `satellite.js` `propagate` + `eciToGeodetic` + `degreesLat/Long`; `velocityKmPerS(satrec, date)` for speed display
- `groundTrack.ts` — sample one full orbital period (~120 points) → `[lon, lat][]` for the orbit line
- `passes.ts` — `nextPasses(satrec, { lat, lon }, hours=48)` → passes sorted by max elevation, each `{ start, peak, end, maxElevationDeg }`. **Implementation note:** satellite.js v5 removed the `getPasses` helper, so the module steps propagation (60s) over the window and finds contiguous runs above the elevation threshold via `ecfToLookAngles` — hand-rolled ~40 lines, behavior contract unchanged

**Components:**
- `App.tsx` — on load: fetch `/api/tle?catnr=<joined config>`, parse all, kick off the 1s animation tick; manage selected sat, observer location (browser geolocation, fallback Paris), pass predictions
- `MapView.tsx` — one `satellites` GeoJSON source (moving dots, updated every tick via `setData`); one `orbits` source (static lines per TLE); click → onSelect; observer marker (circle) + "click to predict passes here" cursor mode
- Details panel (reuse flight panel styling): name, category, NORAD id, current lat/lon, altitude km, orbital speed km/s, period, inclination, next pass over observer location (if predictions loaded)
- Pass list panel: next 48h passes for the selected sat over the observer location (or all sats' best passes — v1: selected sat only), sorted by max elevation, start/peak/end times + elevation

**Animation:** `setInterval` 1000ms — recompute all positions, one `setData`. 15 satellites × SGP4 per second is trivial CPU.

**Observer location:** `navigator.geolocation` on load (fallback: Paris 48.86, 2.35); a "set prediction point" interaction — click anywhere on the map sets the observer point and recomputes passes. Keep the observer marker + a small coordinates readout.

## Error handling

| Failure | Behavior |
|---|---|
| CelesTrak unreachable at load | server 502; client shows "TLE provider unreachable" banner, retries on next load/refresh |
| A catalog number 404s | CelesTrak omits it; client shows the count of resolved satellites vs configured (e.g., "14/15 satellites loaded") |
| Geolocation denied | fallback Paris, no error UI beyond a small note |
| TLE parse failure for one sat | skip that sat, count it in the resolved tally |

## Testing

- **Server (vitest + supertest):** /api/tle — invalid catnr → 400; 200 with TLE text; cache hit within TTL (single upstream call); upstream failure → 502
- **Client (vitest):** TLE parsing (name/period/inclination from a fixture TLE), groundTrack produces N points spanning ~one period (first/last time delta ≈ period), positionAt returns sane lat/lon/alt for a known TLE at a fixed date (deterministic), passes module returns sorted passes with start<peak<end, App renders "N/M satellites loaded", panel shows sat fields, animation tick updates the source data
- **Visual (visual-inspector):** dots move, orbit lines visible, click opens panel, click map computes passes, marker moves

## Out of scope (v1)

Category filters (config field reserved), on-map labels, sunlit/darkness indicators, debris/decay tracking, satellite search, multiple concurrent observer points, deployment.
