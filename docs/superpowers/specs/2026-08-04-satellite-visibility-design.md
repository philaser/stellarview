# Satellite Tracker v1.1 — Orbit-on-Select + Dot Visibility

Date: 2026-08-04
Status: Approved (pre-implementation)
Depends on: `2026-08-04-satellite-tracker-design.md` (v1, shipped and visually verified)

## Purpose

Two UI refinements to the satellite tracker: (1) orbit ground-track lines render **only for the selected satellite** instead of all 12 at once; (2) satellite dots are **larger with a white halo** so they read clearly over map tiles, and the **selected** dot gets a highlighted ring.

## Changes

### 1. Orbit lines on selection only

- `sat-client/src/App.tsx`: pass only the selected satellite's orbit to MapView — `orbits={selected ? { [selected.catnr]: orbits[selected.catnr] } : {}}`
- `sat-client/src/MapView.tsx`: unchanged layer logic (it already handles empty orbit data by clearing via `setData`); the effect re-runs on `orbits` change so switching selection swaps the line, closing the panel clears it
- Selected satellite must be in `positions`/feature data (unchanged); the line persists while the details panel is open

### 2. Dot visibility

- `sat-client/src/MapView.tsx` satellites layer paint becomes data-driven:
  - `circle-radius`: 11 when the feature has `selected: true`, else 8
  - `circle-color`: feature color (existing) — selected dot keeps its category color
  - `circle-stroke-color`: `#ffffff`, `circle-stroke-width`: 2 for all dots (white halo); selected dot `circle-stroke-width`: 3 for a stronger ring
- `sat-client/src/App.tsx`: dot features gain `selected: boolean` (catnr === selectedCatnr)

## Testing

- **MapView (vitest):** satellites layer registered with the data-driven radius/stroke paint (inspect `addLayerMock` call); a selected feature carries `selected: true` in its properties
- **App (vitest):** clicking a satellite passes an orbits map containing only that catnr; closing (or switching to null) passes `{}`; the satellite dot feature properties include the `selected` flag
- **Visual (visual-inspector):** dots clearly visible with white halos over land and sea; exactly one orbit line at a time; line appears on click, follows selection, disappears on close

## Out of scope

Label toggles, per-category orbit toggles, line styling changes, dot scaling by altitude.
