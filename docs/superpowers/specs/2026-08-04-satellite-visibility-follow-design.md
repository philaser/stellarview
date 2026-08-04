# Satellite Tracker v1.2 — Visibility Indicator + Follow Mode

Date: 2026-08-04
Status: Approved (pre-implementation)
Depends on: `2026-08-04-satellite-tracker-design.md` (v1) + `2026-08-04-satellite-visibility-design.md` (v1.1)

## Purpose

Two features: (1) a "Visible now" indicator in the details panel answering *can I see this satellite from my location right now*, and (2) a Follow toggle that keeps the map centered on the selected satellite.

## Feature 1: Visibility indicator

A satellite is **visible** right now iff:
1. It is **above the observer's horizon** (elevation > 0° — computed with the existing `ecfToLookAngles` math)
2. It is **dark at the observer** (solar elevation < −6°, nautical darkness)
3. The satellite is **in sunlight** (not inside Earth's shadow)

### New module `sat-client/src/sat/sun.ts` — low-precision solar position (standard NOAA algorithm, ~40 lines)

- `subsolarPoint(date): { latDeg, lonDeg }` — from solar declination + RA vs GMST (`gstime` from satellite.js for GMST — established library, not re-derived)
- `solarElevationDeg(date, latDeg, lonDeg): number` — standard hour-angle formula

### New module `sat-client/src/sat/visibility.ts`

- `isSunlit(satrec, date): boolean` — cylindrical shadow model: satellite in shadow iff `dot(satPosECI, sunDirECI) < 0` AND perpendicular distance from the sun–Earth line `< R_earth` (6371 km)
- `darkAtObserver(date, lat, lon): boolean` — `solarElevationDeg < -6`
- `satelliteVisible(satrec, observer, date): { visible: boolean; reason: "visible" | "in-shadow" | "daylight" | "below-horizon" }`

### Shared elevation helper

`passes.ts` gains an exported `elevationDegAt(satrec, observer, date)` (extracted from the stepping loop, reused by `nextPasses` and `satelliteVisible`) — no duplicated math.

### Panel

Details panel gains `Visible now: Yes / No` row, with the reason as a short note when No ("in shadow", "daylight at observer", "below horizon").

## Feature 2: Follow mode

- App: `followCatnr: number | null` state; **Follow** toggle button in the details panel (on/off); deselection (Close/selection change) clears follow
- MapView: new prop `followCatnr: number | null`; effect on `[positions, followCatnr, styleLoaded]` — when a position matches `followCatnr`, `map.easeTo({ center: [lon, lat], duration: 500, essential: true })` each tick; manual panning does not cancel (kept simple)

## Testing

- **sun.ts:** subsolar point ≈ 0° latitude at the 2026 March equinox (fixed date); solar elevation ≈ +90° (within tolerance) at the subsolar point, ≈ −90° at the antipode; deterministic at fixed dates
- **visibility.ts:** cases pinned at dates found during implementation with the current ISS fixture TLE (deterministic): a night-time ISS pass over Paris → `visible`; a midday case → `daylight`; a satellite in Earth's shadow → `in-shadow`; a satellite below the horizon → `below-horizon` (construct each case by scanning the fixture TLE over a 24h window during implementation and pinning the found timestamps)
- **Follow:** MapView — `easeTo` called with the followed satellite's coordinates on position updates; not called when `followCatnr` is null; App — toggle button toggles state, Close clears follow
- **Visual (visual-inspector):** panel shows Visible now with correct reason; Follow on keeps the satellite centered while it moves; off stops

## Out of scope

Twilight-aware margins, umbra/penumbra distinction, visibility *predictions* (past/current only), auto-follow-cancel on manual pan, dot-color changes for visible sats, multiple observers.
