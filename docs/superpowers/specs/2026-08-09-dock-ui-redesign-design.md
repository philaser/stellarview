# Dock UI Redesign + Selection Lock — Design

Date: 2026-08-09
Status: Approved (direction F chosen from `docs/design-options/directions2.html`)

## Direction: F — Dock

iOS-style floating dock, heavy blur, springy icons, minimal clutter. All alternative directions
(B Mission Control, C Aurora, D Neon Grid, E Light Orbit, G Rail, H Terminal) are preserved in
`docs/design-options/` in case the direction is revisited.

### Layout

- **Dock** — floating pill anchored bottom-center: gear (filters popover), 2D/3D mode toggle,
  day/night toggle (glows when active), and the search input.
- **Filters popover** — opens above the dock via the gear; regime/constellation groups with the
  existing Orbit/Type mode radios and All/None shortcuts. Keeps the `.controls.open/.closed`
  contract (collapsible, animated).
- **Details panel** — top-right rounded glass card (kept `.panel`), now with a **Lock** button.
- **Observer chip** — top-left pill (kept `.observer-label`).
- **Catalog count** — top-center pill (kept `.banner` class so the visual harness keeps working).
- **Error banner** — red pill below the count pill.
- **Search results** — floating card above the dock, left-aligned (kept `.results-list`).
- **Pass list** — glass card under the details panel (kept `.pass-list`).

### Look & motion

- Glass surfaces: translucent `rgba(24,29,40,.7)`, hairline `rgba(148,163,184,.14)` borders,
  18-20px radii, `backdrop-filter: blur(18px)`, deep soft shadows.
- Dock items: circular, spring hover `translateY(-6px) scale(1.12)` with a `.2,.8,.2,1` easing.
  Active state (day/night on, gear open): blue fill + glow.
- Panels enter with a fade/rise keyframe; the popover scales up from its bottom anchor.
- Existing class hooks preserved (`.banner`, `.controls`, `.gear-button`, `.panel`, `.observer-label`,
  `.results-list`, `.result-row`, `.globe-tooltip`, `aria-label="Toggle 3D mode"`, `Toggle filters`,
  `Day/Night`, `Search satellites…` placeholder) so unit tests and `scripts/visual-check.mjs` keep working.

## Feature: Selection Lock

Purpose: after selecting a satellite, locking freezes the selection so that rotating the globe
(which currently fires a click at release) cannot select a different satellite.

### Behavior

- New `locked` state in `App`; a **Lock / Unlock** button in the details panel toggles it.
- `GlobeView` receives `locked?: boolean`. When locked:
  - Click picking is disabled (no `onSelect` calls).
  - Hover highlight and tooltip are suppressed; cursor stays default.
  - The selected satellite's pulse/label/glow still render normally.
- Also guards accidental drag-selects even when unlocked: a `pointerdown` position is recorded,
  and a click that moved more than 5px before release (i.e., a globe rotation drag) is ignored.

### Tests

- globeview: locked click does not select; drag-then-release over a dot does not select; locked
  hover shows no highlight/tooltip.
- app: day/night toggle updated to the new button (`aria-pressed`); Lock button toggles to Unlock.

## Files

- `sat-client/src/App.tsx` — dock markup, popover, lock state + button, count pill.
- `sat-client/src/GlobeView.tsx` — `locked` prop, drag guard, hover suppression.
- `sat-client/src/styles.css` — full visual rework to F.
- Tests: `sat-client/tests/globeview.test.tsx`, `sat-client/tests/app.test.tsx`.
