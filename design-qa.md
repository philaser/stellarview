# Design QA — Orbital View 3D Satellite Tracker

## Comparison target

- Source visual truth: [satellitemap.space](https://satellitemap.space/), captured and inspected in the in-app browser at a 1512 × 776 CSS viewport with DPR 2. The browser capture was normalized to 1512 × 776 pixels.
- Implementation: local `sat-client` preview at `http://localhost:5175/`.
- Implementation screenshots:
  - Overview: `/private/tmp/orbital-view-desktop-v3.png`
  - Selected satellite: `/private/tmp/orbital-view-selected-v4.png`
- Implementation viewport: 1247 × 807 CSS px, DPR 2. The browser screenshot API produced normalized 1247 × 807 pixel PNGs, so comparisons used the normalized full-view captures rather than raw device pixels.
- Theme: dark.
- States: live 3D overview with 16,089 loaded objects; ISS selected with orbit, spatial label, focus, details, and pass predictions.

The source and implementation use different desktop aspect ratios. Comparisons therefore judged the globe-first composition, hierarchy, visual density, control zones, Earth treatment, and selected-object state rather than claiming pixel-level layout parity.

## Full-view comparison evidence

The final overview preserves the source's dark Earth, atmospheric edge, luminous orbital field, live UTC context, and map-first composition. Orbital View intentionally keeps fewer controls, higher-contrast targets, and no permanent legend. The final capture has clear land/ocean separation, restrained fixed-pixel markers, camera-facing brightness attenuation, and no overlay collisions.

Fonts and typography use a system sans stack for chrome and system monospace for time and telemetry. The compact uppercase hierarchy is consistent across the HUD, panels, filters, and selected label. Supporting text remains legible against the glass surfaces.

Spacing and layout use stable control zones: status upper left, time upper center, details upper right, dock lower center, observer lower left, and count lower right. Panels use the same border, radius, elevation, and spacing system. The selected panel does not cover the selected marker.

Colors map cleanly to semantics: blue for active controls, cyan/violet/amber for orbital regimes, green for selection/live state, violet for the selected orbit, amber for cached data, and red for failures. `CACHED · DISK FALLBACK` removes the earlier contradiction between freshness and provenance.

Image and asset fidelity uses bundled real `three-globe` Earth/topology textures and Natural Earth country boundaries. There are no placeholder images, handcrafted SVG assets, emoji controls, or CSS-drawn product imagery. Tabler supplies the production icon set.

Copy is concise and standalone: Orbital View, active satellite network, catalog provenance, UTC time, observer location, filter vocabulary, NORAD identifiers, visibility, and pass predictions all match the satellite-tracking task.

## Focused comparison evidence

The selected-state capture was reviewed separately because marker, orbit, telemetry, labels, and action controls are too small to judge precisely in the overview. It confirms:

- green selected marker and anchored `ISS (ZARYA)` label;
- violet direction-bearing orbit that remains depth-occluded by the Earth;
- purposeful focus framing without losing global context;
- strong marker-to-panel relationship;
- readable latitude, longitude, altitude, velocity, period, inclination, visibility, and pass data;
- Focus, Follow, and Lock controls with visible state changes.

## Interaction and runtime evidence

Browser-rendered flows checked: catalog load, overview motion, filters open/close, search and result selection, animated focus, selected details, follow, lock/unlock, pause/resume, day/night, and catalog refresh. Pause held simulation time and positions; resume returned to live time. No runtime error overlay appeared during these flows. Production TypeScript/Vite build and the complete `sat-client` test suite passed after the final visual changes.

The in-app browser does not expose viewport resizing. Mobile behavior received a code-level breakpoint/safe-area review and responsive fixes, but a normalized rendered mobile capture remains a residual test gap rather than a known design mismatch. Mobile rules provide one sheet at a time, safe-area-aware bottoms, a compact dock that drops the reset control below 430 px, a visible search cue, scrollable details, and no minimum-height clipping in landscape.

## Comparison history

### Iteration 1 — blocked

Findings:

- P1: Earth was a flat dark sphere with insufficient land/ocean and atmosphere depth.
- P1: uniformly bright, zoom-scaled points overwhelmed geography.
- P1: selected camera framing was too aggressive and tracking hierarchy was unclear.
- P1: `FRESH` conflicted with `DISK FALLBACK` provenance.
- P1: mobile safe areas, 320 px dock width, and landscape minimum height could collide or clip.

Fixes:

- Bundled and applied real dark-Earth, topology, and Natural Earth assets.
- Strengthened atmosphere and directional/ambient lighting.
- Converted ambient markers to fixed-pixel size, lowered opacity, and reduced selection zoom.
- Added explicit `CACHED` status semantics.
- Made mobile sheets and status chips safe-area aware, removed the mobile minimum height, widened touch targets, and hid reset at very narrow widths.

Post-fix evidence: `/private/tmp/orbital-view-desktop-v3.png`.

### Iteration 2 — blocked

Findings:

- P2: selected marker lacked an anchored spatial label.
- P2: dark-side geography fell too close to black.
- P2: far-limb markers competed with the atmosphere.

Fixes:

- Added an interpolated screen-space selected label.
- Raised the ambient geographic floor without flattening the terminator.
- Added camera-facing marker brightness attenuation.

Post-fix evidence: `/private/tmp/orbital-view-selected-v4.png`.

### Iteration 3 — passed

The combined final overview and selected-state review found no actionable P0, P1, or P2 visual differences. Remaining gaps are validation coverage, not observed defects.

## Findings

- P0: none.
- P1: none.
- P2: none.

## Follow-up polish

- P3: capture a physical 390 × 844 mobile viewport when the selected in-app browser exposes viewport emulation.
- P3: profile the primary Three.js/globe bundle if first-load performance becomes a measured issue; the secondary 2D renderer is already dynamically split.

## Final result

final result: passed
