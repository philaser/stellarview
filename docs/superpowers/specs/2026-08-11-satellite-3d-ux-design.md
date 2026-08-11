# Satellite Tracker 3D UX — Design Spec

Date: 2026-08-11
Status: Approved for implementation

## Goal

Make the existing satellite tracker feel like a polished, immersive live 3D tracking product while preserving its current glass/dock visual language. The primary journey is: load the active catalog, find or click a satellite, understand it, focus it, follow it, and control simulation time.

## Scope boundary

This work applies to `sat-client` and the existing `/api/tle` server capability only. The flight client, OpenSky, aircraft tracking, launch databases, accounts, alerts, AR, and full historical playback are excluded.

The 3D globe remains the default. The 2D map stays functional but receives no redesign and moves to a secondary control.

## Existing foundation to preserve

- `globe.gl` and Three.js renderer.
- One `THREE.Points` draw call for the full visible catalog.
- Two-second propagation snapshots with frame interpolation.
- Search, regime/constellation filters, visibility, observer location, passes, selection lock, and animated orbit.
- Existing glass surfaces, chip filters, blue action state, mint selection, and violet orbit.

## Experience architecture

### Overview

The globe fills the viewport. The default view shows a quiet Earth, readable atmosphere, star field, and luminous catalog without labels. Status chrome communicates live/paused time, catalog count, and TLE freshness.

### Find

Search matches name or NORAD ID. Keyboard navigation moves through results. Filters switch exclusively between orbital regime and constellation. Changing filters never leaves a hidden satellite selected or followed.

### Select

Hover reveals one compact tooltip. Clicking a satellite selects it unless the pointer movement was a globe drag or selection is locked. Selection opens details, renders a persistent label and halo, and shows the orbit.

### Focus and follow

Focus is a one-time camera move to frame the satellite. Follow continuously keeps the selected satellite framed while preserving camera distance and allowing zoom. Manual globe rotation exits follow. Lock prevents accidental reselection but does not itself move the camera.

### Time

One simulation clock drives propagation, visibility, orbit, and pass calculations. Live mode tracks UTC wall time. Pause freezes the simulation. Reset returns to now. Full rewind, fast-forward, and date scrubbing are deferred.

## Desktop layout

- Observer/location chip: top-left.
- Count, live/paused state, UTC, and TLE age: compact top-center status cluster.
- Selected details: top-right.
- Dock: bottom-center with filters, time controls, search, and More.
- Filter popover: above the dock.
- Search results: above/adjacent to the dock without overlapping filters.

## Mobile layout

- Compact top status bar.
- Bottom safe-area dock.
- Filters, search results, and details use mutually exclusive bottom sheets.
- Details occupy at most 64vh and scroll internally.
- Observer and count compress into the status bar.

## Globe environment

- Space background `#050816` with low-contrast stars.
- Dark Earth, subtle boundaries, optional graticules, and atmospheric rim.
- Sun-based directional lighting with a readable day/night terminator.
- Environment appears before catalog data; errors do not remove the globe.

## Satellite field

- Regime color is the default visualization; constellation color remains a filter dimension, not a simultaneous encoding.
- Dots remain tiny at overview and grow gently with camera proximity.
- Only hovered and selected satellites receive labels.
- The selected satellite uses a restrained mint dot and halo; pulse uses opacity, not size.
- Visual altitude is compressed and explained in the legend/details.

## Orbit

- Only the selected orbit renders.
- A dim violet full path plus a brighter direction head conveys motion.
- Far-side segments are Earth-occluded.
- Reduced-motion mode shows a static highlighted forward segment.

## Data freshness

The server returns TLE content plus freshness metadata through headers. The client displays loaded time and whether the catalog is cached. Manual refresh refetches catalog data without reloading the page. Last-good data remains visible during provider failures.

## Accessibility

- Tabler icons replace emoji/text-glyph controls.
- 40px desktop and 44px touch targets.
- Semantic buttons, dialogs/sheets, status regions, labels, tooltips, and visible focus.
- Escape closes the topmost surface before clearing selection.
- Reduced motion covers HUD motion, camera transitions, pulsing, and orbit flow.

## Performance constraints

- No per-satellite DOM elements.
- No React state updates per animation frame.
- Typed arrays and Three.js objects are reused.
- Selected-orbit calculation only.
- Dynamic-import the 2D MapLibre view so 3D startup does not pay its bundle cost.
- Target smooth desktop interaction with the full active catalog and a usable 30 FPS floor on supported mobile hardware.

## Acceptance

- Search-to-follow journey works by mouse, touch, and keyboard.
- Live/pause/reset time stays consistent across positions and details.
- Mobile surfaces never overlap.
- Provider failure retains the last-good catalog and explains freshness.
- All satellite tests and the full repository test suite pass.
- Production builds succeed without the existing single 2.9 MB entry chunk.
- Visual QA passes at desktop and mobile viewports with overview, selected, filters, search, paused, and error states.
