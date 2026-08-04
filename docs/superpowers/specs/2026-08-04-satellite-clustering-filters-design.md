# Satellite Tracker v1.4 — Clustering + Better Filters + Observer Fix

Date: 2026-08-04
Status: Approved (pre-implementation)
Depends on: satellite tracker v1.3 (full catalog, shipped; visually diagnosed: 16k dots render as a dense overlapping field; filter UX insufficient; observer longitude unwraps past ±180)

## Purpose

Make the 16k-object catalog usable: (1) cluster dots at low zoom with click-to-zoom, (2) zoom-dependent dot sizing, (3) substantially better filters — per-filter counts, All/None shortcuts, a search results list, (4) fix the observer longitude wrap bug.

## 1. Clustering + zoom-dependent rendering (MapView)

- Satellites GeoJSON source gains `cluster: true, clusterRadius: 50` (MapLibre's built-in clustering — established library feature, no hand-rolled clustering)
- **Cluster layer** (`satellites-cluster-layer`, circle + count-label symbol): neutral slate circles, radius scales with `point_count`, white `point_count_abbreviated` text; placed below the dots layer
- **Dots layer** (`satellites-layer`): filter `["!", ["has", "point_count"]]`; radius interpolated by zoom (small at world view, ~9-14px when zoomed in; selected dot stays larger at all zooms)
- **Click handling:** cluster feature → `flyTo({ center: e.lngLat, zoom: zoom + 2 })`; dot feature → `onSelect(catnr)` (existing)
- **Focus prop:** `focus: { catnr, ts } | null` — flyTo the satellite's current position at zoom ~6 (used by the search results list); effect keyed on the `ts` so repeated clicks on the same result re-trigger

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
