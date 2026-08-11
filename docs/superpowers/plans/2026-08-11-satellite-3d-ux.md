# Satellite Tracker 3D UX — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-08-11-satellite-3d-ux-design.md`

Execute tasks in order and commit each task separately. Use TDD for simulation-time, camera/follow, freshness, and state-transition logic.

## Task 1 — Design contract and dependency foundation

- [x] Add `DESIGN.md`.
- [x] Add the approved design spec and this plan.
- [ ] Add the selected maintained icon library.
- [ ] Establish shared CSS tokens and icon-button primitives.
- [ ] Verify baseline tests and build.

## Task 2 — Simulation clock and catalog lifecycle

- [ ] Add a single live/paused simulation clock.
- [ ] Drive propagation, visibility, orbit, and passes from that clock.
- [ ] Add pause/resume/reset controls and keyboard behavior.
- [ ] Replace page reload with an in-app catalog refresh.
- [ ] Expose catalog freshness/cached metadata from `/api/tle`.
- [ ] Preserve last-good catalog on refresh failure.
- [ ] Add tests.

## Task 3 — 3D focus, follow, and environment

- [ ] Add imperative focus/follow camera support to `GlobeView`.
- [ ] Preserve camera distance while following.
- [ ] Exit follow on intentional manual rotation.
- [ ] Improve atmosphere, stars, borders, and graticule controls using existing globe.gl capabilities.
- [ ] Respect reduced motion for camera, pulse, and orbit flow.
- [ ] Add tests.

## Task 4 — Responsive HUD and tracking details

- [ ] Replace emoji/text controls with Tabler icons.
- [ ] Add compact time/freshness status.
- [ ] Keep the existing dock and glass panels but clarify control groups and hierarchy.
- [ ] Make search keyboard navigable.
- [ ] Make mobile details, filters, and search mutually exclusive sheets.
- [ ] Improve details hierarchy and Follow/Focus/Lock actions.
- [ ] Add semantic state and accessibility tests.

## Task 5 — Loading, error, and bundle performance

- [ ] Add progressive catalog loading and recoverable error messaging.
- [ ] Lazy-load the secondary 2D MapLibre view.
- [ ] Verify resource disposal and no stale following/selection after filtering.
- [ ] Expand visual-check coverage for desktop/mobile and stateful interactions.
- [ ] Run satellite tests, full tests, builds, and console checks.

## Task 6 — Visual inspection and design QA

- [ ] Capture the reference and implementation at matching viewports/states.
- [ ] Dispatch the required visual-inspector.
- [ ] Fix all P0/P1/P2 findings.
- [ ] Create `design-qa.md` with `final result: passed`.
- [ ] Leave the verified local preview running.
