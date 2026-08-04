# Flight Track on Click — Design Spec (v1.1)

Date: 2026-08-04
Status: Approved (pre-implementation)
Depends on: `2026-08-04-flight-tracker-design.md` (v1, implemented and verified)

## Purpose

When a user clicks a plane on the map, show the aircraft's **actual flown trajectory** as a line on the map, and keep it fresh (throttled) while the details panel stays open. Origin→destination arc is explicitly deferred (requires origin/destination data for live flights, which the free OpenSky tier does not provide; revisit when a cheap source exists).

## Data source (verified feasibility)

OpenSky Network `GET /api/tracks/{icao24}?time=<unix>` returns the trajectory of the given aircraft — `{ icao24, startTime, endTime, callsign, path: [[time, lat, lon, baroAlt, trueTrack, onGround], ...] }`. Cost: **4 credits per request** on the free tier (both anonymous and registered). Server-side caching makes re-clicks free within the TTL.

## Architecture

### Server

**New types (`server/src/types.ts`):**

```ts
export interface TrackPoint {
  t: number;        // unix seconds
  lat: number;
  lon: number;
  altBaro: number | null;
}

export interface FlightTrack {
  icao24: string;
  callsign: string | null;
  points: TrackPoint[];   // chronological
}

export interface TrackResponse {
  track: FlightTrack | null;   // null when OpenSky has no track for the aircraft
  stale: boolean;
  rateLimited: boolean;
}
```

**Provider capability seam:**

`server/src/providers/flight-provider.ts` gains an optional capability interface:

```ts
export interface TrackSource {
  fetchTrack(icao24: string, now: number): Promise<FlightTrack | null>;
}
```

`OpenSkyProvider` implements `TrackSource` (calls `/tracks/{icao24}?time=<now>`, maps path arrays to `TrackPoint[]`, throws on non-ok with `status`/`retryAfter` like `fetchStates`, returns `null` on 404). `AirLabsProvider` does NOT implement it.

**New endpoint (`server/src/app.ts`):**

`GET /api/track?icao24=<hex>`:
- Validate icao24: `/^[0-9a-f]{6}$/` → else 400 `{"error":"invalid icao24"}`
- If the active provider is not a `TrackSource` → 501 `{"error":"track not supported by provider <name>"}`
- Fetch through a `TtlCache<FlightTrack>` keyed by icao24, **TTL 120s** (injectable via `createApp` deps for tests, default 120_000)
- 429 → respond `{ track: <cached or null>, stale: true, rateLimited: true }`; if cached, serve it; else `track: null`
- 404/empty from OpenSky → `{ track: null, stale: false, rateLimited: false }`
- Other provider errors: 502 `{"error":"provider unreachable"}` (reuse existing pattern)

**Boot wiring (`server/src/index.ts`):** pass `TRACK_CACHE_TTL_MS` env (default 120_000) into `createApp`.

### Client

**`client/src/MapView.tsx`:**
- New prop `track: FlightTrack | null`
- New effect: when `track` changes, upsert a GeoJSON source `track-source` + line layer `track-line` (dashed, muted color, e.g. `#38bdf8` with `dasharray`), `setData` when the source exists; when `track` is null, remove source+layer if present (guard against map-not-ready with the same `styleLoaded` gating as the flights layer)

**`client/src/App.tsx`:**
- On selection change (`selected` non-null): fetch `/api/track?icao24=<selected.icao24>` → set `track`; set `trackUnavailable` when `track: null`; set `trackRateLimited` when flagged
- **Throttled refresh:** while `selected` is unchanged and non-null, re-fetch the track every 60s (interval created on selection, cleared on close/selection-change/unmount). On each response, update `track`.
- Clear `track` + cancel interval when panel closes or selection changes
- Details panel: small line under the rows — "Track: N points" when available; "Track unavailable" when `track === null` (and no rate-limit flag); "Track refresh paused (rate limited)" when `trackRateLimited`
- Region change: clear `track`, cancel the refresh interval, and close the panel (`setSelected(null)`) — the selected plane may be off-screen in the new region

## Error handling

| Failure | Server behavior | Client behavior |
|---|---|---|
| Invalid icao24 | 400 | (client never sends invalid) |
| Provider lacks TrackSource | 501 | note "tracks not supported for provider" |
| OpenSky 404 / no track | `{track:null}` | "Track unavailable" |
| OpenSky 429 | serve cached or `{track:null, rateLimited:true}` | "Track refresh paused (rate limited)" |
| OpenSky 5xx, no cache | 502 | (reuse existing error banner path) |
| Track fetch on closed panel | — | interval cleared; no request |

## Credit budget

4 credits per unique plane per 2 minutes (server TTL), refreshed every 60s while the panel stays open on the same plane → ~4 credits/2min open-panel. Anonymous 400/day ≈ 100 unique planes/day. Registered 4,000/day ≈ 1,000. Acceptable for v1.1; no client-side gating needed.

## Testing

- **Server (vitest + supertest):** `fetchTrack` mapping (mock OpenSky track response: path arrays → points, null on 404, error status propagation); endpoint tests — 400 invalid icao24, 200 with cached track (second call within TTL hits cache: 1 upstream fetch), 429 → `rateLimited:true` with cached track, 429 cold → `track:null` + flag, 501 when provider is AirLabs
- **Client (vitest):** MapView renders line layer when `track` prop set and removes it on null (mock captures addLayer/removeLayer); App — selecting a plane fetches `/api/track` with the icao24, interval refresh every 60s (fake timers), panel note when `track:null`, track cleared on close
- **Manual/visual:** click a plane → dashed line appears along its real path; re-click same plane within 2 min → no extra upstream call (server log); keep panel open 60s → line extends; close → line disappears

## Deferred (explicitly out of scope)

- Origin→destination arc (needs live origin/dest data; revisit when AirLabs flight-info free fields or another source is viable)
- Track persistence/history, playback, multi-flight tracks
- Client-side track gating by credit budget
