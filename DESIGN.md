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

- `--space`: `#050816`
- `--surface`: `rgba(24, 29, 40, .72)`
- `--surface-strong`: `rgba(17, 22, 32, .9)`
- `--surface-hover`: `rgba(255, 255, 255, .1)`
- `--border`: `rgba(148, 163, 184, .16)`
- `--text`: `#f1f5f9`
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
- Never place essential text below 12px.

### Spacing and shape

- Base spacing: 4px.
- Controls: 40px minimum desktop, 44px minimum touch.
- Compact padding: 8px; panel padding: 16px.
- Control radius: 12px; panel radius: 20px; pills: 999px.
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
- `prefers-reduced-motion` disables pulsing, orbit-flow animation, spring hover, and nonessential camera tweening.

### Icons

Use `@tabler/icons-react` outline icons at 18-20px and 1.7-2px stroke. Every icon-only control requires an accessible label and tooltip. Do not use emoji or text glyphs for controls.

### Breakpoints

- Mobile: below 640px.
- Compact/tablet: 640-959px.
- Desktop: 960px and above.

## Core components

### HUD button

Variants: neutral, active, danger, icon-only. States: default, hover, focus-visible, pressed, disabled. Active uses accent fill/glow; focus is always visible.

### Search

Desktop search lives in the bottom dock. Mobile search expands to a full-width results surface. Results support Arrow Up/Down, Enter, and Escape.

### Filters

The existing Orbit/Type segmented control and chips remain the visual foundation. The panel opens above the dock on desktop and becomes a bottom sheet on mobile.

### Details panel

Header, status/category, priority metrics, secondary orbital facts, actions, pass predictions. Desktop anchors top-right. Mobile becomes a scrollable bottom sheet. It must not coexist with the mobile filters sheet.

### Live status

Shows simulation status, UTC time, TLE freshness, catalog count, and recoverable errors. Status uses both icon/text and color.

## Accessibility

- All controls are semantic buttons, inputs, dialogs, or status regions.
- Keyboard focus is visible against every globe background.
- Escape closes search, filters, and details in that priority order.
- Touch targets are at least 44px on mobile.
- Color categories always include text labels.
- Live updates avoid unnecessary screen-reader announcements.

## Responsive behavior

- Desktop: compact observer chip, count/time status, top-right details, bottom-center dock and filter popover.
- Mobile: top status bar, bottom dock, one bottom sheet at a time, no persistent observer chip or count pill over the globe.
- The globe remains full-bleed at every viewport.

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
