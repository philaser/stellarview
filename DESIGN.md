# Satellite Tracker Design System

## Product posture

Immersive operational visualization. The globe is the product surface; interface chrome exists to help people find, understand, and follow satellites without obscuring the Earth.

## Design principles

1. Preserve the globe first. Overlays must remain compact, movable by responsive layout, and mutually exclusive when they would collide.
2. Use light and color to communicate tracking state. Decorative color never competes with satellite categories, selection, visibility, warnings, or focus.
3. Reveal complexity progressively. Overview stays quiet; hover identifies; selection explains; follow commits the camera.
4. Show time and data freshness before asking users to trust a position.
5. Keep motion spatial and causal. Camera movement, satellite interpolation, and orbit direction clarify state and respect reduced-motion preferences.

## Tokens

### Color

- `--space`: `#05070c`
- `--surface`: `rgba(13, 18, 28, .88)`
- `--surface-strong`: `rgba(18, 24, 36, .96)`
- `--surface-hover`: `rgba(255, 255, 255, .1)`
- `--border`: `rgba(148, 163, 184, .2)`
- `--text`: `#eef4fc`
- `--text-secondary`: `#cbd5e1`
- `--text-muted`: `#7f8ca3`
- `--accent`: `#3b82f6`
- `--selection`: `#22ff88`
- `--orbit`: `#a855f7`
- `--success`: `#34d399`
- `--warning`: `#fbbf24`
- `--danger`: `#fb7185`

Satellite category colors are defined in `sat-client/src/sat/catalog.ts` and must remain consistent across the globe, filters, details, and legend.

### Typography

- UI: Inter when available, then system sans-serif.
- Data and time: system monospace with tabular numerals.
- Display: 18px/600.
- Heading: 14px/600.
- Body: 13px/1.5.
- Label: 11px/600 with restrained uppercase tracking.
- Use 12–14px for primary reading; compact metadata labels may use 11px with sufficient contrast.

### Spacing and shape

- Base spacing: 4px.
- Controls: 40px minimum desktop, 44px minimum touch.
- Compact padding: 8px; panel padding: 16px.
- Control radius: 10px; panel radius: 16px; pills are reserved for compact status tags.
- Desktop chrome inset: 14px; mobile inset: 10px plus safe-area values.

### Border and elevation

- Panels: one hairline border, 18px backdrop blur, deep soft shadow.
- Popovers: stronger surface and 20px blur.
- Scrim: `rgba(2, 6, 23, .55)`.
- Do not stack decorative cards inside cards.

### Motion

- Hover: 160ms ease.
- Panel: 240ms cubic-bezier(.2,.8,.2,1).
- Drawer/camera: 320-600ms depending on travel distance.
- Satellite snapshots interpolate continuously over their update interval.
- `prefers-reduced-motion` disables selection pulsing, orbit-flow animation, spring hover, and camera tweening.

### Icons

Use `@tabler/icons-react` outline icons at 18-20px and 1.7-2px stroke. Every icon-only control requires an accessible label and tooltip. Do not use emoji or text glyphs for controls.

### Breakpoints

- Mobile: below 720px.
- Compact/tablet: 720-899px.
- Desktop: 900px and above.

### Globe environment

- Use the bundled `three-globe` dark Earth and topology assets under `sat-client/public/globe/`; do not rely on a runtime image CDN.
- Country boundaries come from the bundled Natural Earth dataset in the same folder.
- The Earth texture, atmospheric rim, and directional lighting preserve land/ocean depth without competing with tracked objects. Sun direction follows simulation time. Display altitude is compressed; the violet path is a projected ground track. Both limitations are disclosed in details.
- Ambient satellites use fixed-pixel points and camera-facing attenuation. Selection alone receives a green marker, anchored label, violet orbit, and camera focus.
- Ambient marker opacity stays below selected and hovered objects. Pointer hit areas are intentionally larger than the visible dots so the globe remains clean without making selection fiddly.

## Core components

### HUD button

Variants: neutral, active, danger, icon-only. States: default, hover, focus-visible, pressed, disabled. Active uses accent fill/glow; focus is always visible.

### Search

Search lives in the control dock and expands into a results surface. Results support Arrow Up/Down, Enter, and Escape. Searching a hidden category reveals the selected result and explains the filter change. Selection moves focus into details; closing search restores the controls.

### Filters

The existing Orbit/Type segmented control and chips remain the visual foundation. The panel opens above the dock on desktop and becomes a bottom sheet on mobile.

### Details panel

Header, status/category, priority metrics, actions and expandable technical data. Basic details never require location. Observer setup is explicit; manual coordinates or the named Paris reference enable visibility and chronological pass predictions. Desktop reserves a right-hand column. Mobile uses a scrollable bottom sheet with an expandable summary, keeping globe space above it. Filters and details are mutually exclusive.

### Live status

Separates simulation time from source freshness: `REAL-TIME` or `PAUSED` describes position propagation, while `CATALOG FRESH`, `CATALOG CACHED`, `CATALOG STALE`, or `CATALOG OFFLINE` describes TLE data. Status uses both icon/text and color.

### Interaction guidance

The empty overview carries one compact cue explaining that markers are selectable and search accepts names or NORAD IDs. It disappears during search, filtering, and selection. Icon-only dock controls show immediate hover and keyboard-focus tooltips.

## Accessibility

- All controls are semantic buttons, inputs, dialogs, or status regions.
- Keyboard focus is visible against every globe background.
- Escape closes search, filters, and details in that priority order.
- Touch targets are at least 44px on mobile.
- Color categories always include text labels.
- Live updates avoid unnecessary screen-reader announcements.

## Responsive behavior

- Desktop: unified product/view/freshness/time header, right-hand details, bottom-center dock and filter popover.
- Mobile: top status bar, bottom dock, one bottom sheet at a time, no persistent observer chip or count pill over the globe.
- The visualization stage resizes around the details panel or sheet so the selected object stays within the usable map area. Labels stay below interface controls.

## Do

- Reuse the existing glass surfaces, compact data rows, chips, selection green, and violet orbit treatment.
- Keep one GPU points layer for the catalog.
- Prefer progressive disclosure over adding permanent controls.

## Avoid

- Reintroducing flight UI into the satellite client.
- Permanent label clouds, debug/FPS controls, auto-rotation, or overlapping mobile cards.
- Per-satellite DOM nodes or React updates inside the animation loop.
- Copying satellitemap.space branding or exact panel composition.

## Implementation locations

- `sat-client/src/styles.css`: tokens and component styling.
- `sat-client/src/App.tsx`: state, HUD composition, accessibility, and data lifecycle.
- `sat-client/src/GlobeView.tsx`: globe environment, camera, points, picking, selection, and orbit rendering.
- `sat-client/src/sat/`: catalog, propagation, visibility, passes, and time-dependent calculations.
- `sat-client/tests/`: logic and interaction coverage.
- `scripts/visual-check.mjs`: desktop/mobile visual acceptance.
