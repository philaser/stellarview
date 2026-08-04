# Satellite Tracker v1.4 — Clustering + Better Filters + Observer Fix

Date: 2026-08-04
Status: Approved (pre-implementation)
Depends on: satellite tracker v1.3 (full catalog, shipped; visually diagnosed: 16k dots render as a dense overlapping field; filter UX insufficient; observer longitude unwraps past ±180)

## Purpose

Make the 16k-object catalog usable: (1) cluster dots at low zoom with click-to-zoom, (2) zoom-dependent dot sizing, (3) substantially better filters — per-filter counts, All/None shortcuts, a search results list, (4) fix the observer longitude wrap bug.

## 1. Clustering + zoom-dependent rendering (MapView)

**EMPIRICAL FINDING (2026-08-04):** MapLibre's built-in clustering (`cluster: true` on a GeoJSON source) renders NOTHING in this environment — the clustered source silently produces zero features in both headless Chromium and the user's browser, while the identical 16k dataset renders fine with clustering off (verified by in-browser experiment: 9,820 dots rendered unclustered vs 0 clustered, no console errors). No upstream fix found. **Decision: hand-rolled "cluster-lite"** — deterministic JS grid bucketing in Mercator tile space (sanctioned by AGENTS.md: hand-roll only when no reasonable existing solution exists; the established one demonstrably fails here).

- Satellites source stays **unclustered** (proven rendering path)
- New pure module `sat-client/src/sat/cluster.ts`:
  - `tileXY(lat, lon, zoom)` → fractional Mercator tile coords
  - `bucketClusters(points, zoom, cellSize=0.25)` → buckets of points by grid cell, each with count + centroid lon/lat
- MapView renders a separate `clusters` source/layer (circles sized by count + count labels) from `bucketClusters(positions, currentZoom)` — the App side is untouched
- **Zoom-based visibility:** below zoom 5 → clusters visible, individual dots hidden; at ≥ zoom 5 → dots visible, clusters hidden (implemented via layout `visibility` zoom-step expression if MapLibre accepts it, else `setLayoutProperty` on zoom change — verify in browser)
- Click: cluster feature → `flyTo({ center, zoom: zoom + 2 })`; dot → `onSelect` (unchanged)
- Cluster count labels: use a font that exists in the OpenFreeMap liberty style (the earlier `"Open Sans Bold"` produced a glyph 404 — verify the style's actual fonts from its JSON and use one; fallback: no explicit font if the style defaults exist)
- **Focus prop:** `focus: { catnr, ts } | null` — flyTo the satellite's current position at zoom ~6; one-shot per `ts` (deduped via ref so the 2s tick doesn't re-fly)

## 2. Better filters (App)

- **Per-filter counts:** each regime/constellation checkbox label shows its count from the loaded catalog, e.g. `LEO (15,303)` — computed with useMemo from `sats`
- **All/None shortcuts** per filter group (two small buttons under each group's label row)
- **Search results list:** when the search query is non-empty, a results panel lists matching satellites (name + catnr, capped at ~20 with "and N more"); clicking a result selects the satellite AND sets the focus request (map flies to it); "ISS" currently matches 13 catalog entries — the list makes the ambiguity visible and resolvable
- Controls panel gets a solid background (`rgba(17,24,39,0.92)` + padding) so dots no longer obscure it

## 3. Observer longitude wrap (App)

- `setObserver` inputs normalized: longitude wrapped into [-180, 180] via `((lon + 180) % 360 + 360) % 360 - 180` (MapLibre `e.lngLat.lng` unwraps past ±180 at world zoom — verified in the field: observer showed `-293.78`)
- Applied at both call sites: empty-map click and geolocation success callback (defensive; geolocation is already in range)

## Testing

- **MapView:** source registered with `cluster: true`; cluster layer + label layer added; cluster click → flyTo (not onSelect); dot click → onSelect (unchanged); focus prop → flyTo at zoom ~6; radius paint interpolates by zoom
- **App:** checkbox labels include counts (3-block fixture: LEO 2, GEO 1; starlink 1); All/None buttons toggle sets; search results list renders names, click selects + issues focus; empty-map click with `lngLat.lng = 293.78` → observer label shows the wrapped longitude (−66.22)
- **Visual (visual-inspector):** world view shows clean clusters with counts instead of a solid dot field; zooming unclusters into dots; cluster click zooms in; filters with counts; search results list works; observer label always in ±180

## Out of scope

Cluster styling variants, per-regime cluster colors, results-list sorting/paging, debounced search, brightness filter, Web Worker propagation.
