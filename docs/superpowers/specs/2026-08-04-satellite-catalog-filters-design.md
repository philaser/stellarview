# Satellite Tracker v1.3 — Full Catalog + Filters

Date: 2026-08-04
Status: Approved (pre-implementation)
Depends on: satellite tracker v1/v1.1/v1.2 (all shipped)

## Purpose

Replace the curated 12-satellite config with the **full active catalog (~7,000 satellites)** from CelesTrak, with filters as the decluttering tool: orbital regime, constellation, and search.

## Data

- **Server:** `GET /api/tle?group=active` — one CelesTrak bulk fetch (`gp.php?GROUP=active&FORMAT=tle`, ~1.5MB, ~7k TLE blocks), 12h-cached. The existing `?catnr=` path stays. Exactly one of `catnr` / `group` required; `group` must be in a whitelist (`["active"]` for v1) → else 400.
- **Client:** loads the bulk once, parses all blocks, annotates each with derived metadata.

## Per-satellite metadata (pure TLE math, no external data)

- **Regime** from orbital period (`satrec.no`): LEO < 128 min, MEO < 1000 min, GEO ≥ 1000 min
- **Constellation** from name prefixes (case-insensitive): `STARLINK-` → starlink, `ONEWEB-` → oneweb, `GPS ` / `NAVSTAR` → gps, `IRIDIUM` → iridium, else → other
- **Dot color by regime:** LEO `#38bdf8`, MEO `#a78bfa`, GEO `#fbbf24`

## Filters

- **Regime checkboxes** (LEO/MEO/GEO) and **constellation chips** (Starlink/OneWeb/GPS/Iridium/Other): all on by default; OR within a group, AND across groups
- **Search box:** case-insensitive substring match on name or catalog number
- A satellite shows iff it passes all three groups
- **Selection safety:** if the selected satellite stops matching the filters, it is deselected (panel/orbit/follow clear via existing paths)
- Filter changes recompute positions immediately (no waiting for the next tick)

## Performance

- Tick: propagate all **filtered** satellites every 2s (7k × ~3µs ≈ 20ms — acceptable; filtered set is usually smaller)
- **Viewport culling:** MapView renders only dots within the current map bounds (+~2° margin) — zoomed views render hundreds, not thousands; culling re-runs on pan/zoom (map `move` event)
- Curated 12-config, `SAT_COLORS`, `CATNR_LIST` are removed; `SAT_CONFIG`-based logic in App is replaced by the catalog + filters

## Unchanged

Orbit-on-select, details panel, "Visible now", Follow mode, pass predictions — all per-satellite, work for any catalog object.

## Testing

- **Server:** group fetch + cache (single upstream call across two requests), unknown group → 400, both params → 400, catnr path unchanged (existing tests stay green)
- **Catalog:** regime classification at period thresholds (fixtures with known periods: LEO/MEO/GEO), constellation name mapping (5 cases incl. Other)
- **App:** loads `?group=active`; loaded count banner; regime checkbox hides GEO sats; constellation chip hides Starlink; search narrows by name and catnr; deselect-on-hide; colors by regime (feature property)
- **MapView:** culling — only in-bounds dots rendered (fixed mock bounds + move event); existing tests adapted
- **Visual (visual-inspector):** thousands of dots render (zoomed out), colors by regime, filters hide/show instantly, search works, selection + orbit + follow still work

## Out of scope

Brightness/naked-eye filter (needs external catalog), debris, clustering at low zoom, Web Worker propagation, country filters, per-constellation colors, pagination.
