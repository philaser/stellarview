# Satellite Tracker v1.6 — 3D Globe Mode

Date: 2026-08-04
Status: Approved (pre-implementation)
Depends on: satellite tracker v1.5 (shipped)

## Purpose

A "3D mode" toggle rendering the satellites on a dark 3D globe (satellitemap.space style), reusing all existing data pipelines: positions (already computed with altitude), TLEs, filters, search, selection, passes.

## Approach

**globe.gl** (Three.js-based, established library) as a separate view component. The 2D map stays untouched; a mode toggle swaps the map for the globe. No MapLibre globe projection (experimental, risky in this version).

## Implementation

- **New deps (sat-client):** `globe.gl` + `three`
- **New component `sat-client/src/GlobeView.tsx`:**
  - Dark space theme: `backgroundColor #050816`, atmosphere glow, no graticules; initial `pointOfView({ lat: 20, lng: 0, altitude: 2.5 })`
  - **Countries:** fetch Natural Earth GeoJSON once (`https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson` — free, keyless, CORS-open), render via `polygonsData` with dark fill + subtle border
  - **Satellites:** `pointsData` = positions mapped to globe-radius units (`altR = altKm / 6371`), colored by regime, tiny radius; hover enlarges the point + pointer cursor; click → `onSelect(catnr)` (reuses the selection state/panels)
  - **Selected:** a highlight point (brighter, larger) + a name label (labelsLayer); the orbit rendered as a 3D path (`pathsLayer`) at orbital altitude in vivid purple, with **animated flowing dashes** (`pathDashInitialGap` advanced on an interval — the 3D version of the 2D animated trajectory)
  - Props: `positions: SatDot[]`, `selectedOrbit: [lon, lat][] | null`, `selectedCatnr: number | null`, `onSelect`
- **App:** `mode: "2d" | "3d"` state (default 2d) + a toggle button in the controls ("3D mode" checkbox or button); when 3d → render GlobeView instead of MapView (same container/panels/controls/banners overlay — they're absolute-positioned). Filters/search/selection/passes all work identically (data-driven).
- **Known v1 limits (documented, not built):** no day/night overlay in 3D (globe has atmosphere lighting), observer-point setting stays 2D (pass predictions panel still works), cluster-lite stays 2D.

## Testing

- **GlobeView (vitest, mocked globe.gl):** pointsData receives altitude-normalized positions; click handler → onSelect; selected orbit passed as pathsData when a satellite is selected, absent otherwise; hover enlarges.
- **App (vitest):** the mode toggle switches the rendered view (mocked modules — assert via a mode class or the mocked Globe's pointsData calls); filters/search still update the 3D view data.
- **Visual (harness + inspector):** extend `scripts/visual-check.mjs` with a 3D step (toggle 3D, wait, screenshot, console check); inspector reads the screenshots: dark globe with country outlines, tiny luminous dots, hover highlight, selected glow + label + animated purple orbit ring.

## Out of scope

Time playback controls, 3D arcs between points, camera fly-to on selection, day/night in 3D, 3D observer interaction, WebGL2 fallbacks, mobile perf tuning.
