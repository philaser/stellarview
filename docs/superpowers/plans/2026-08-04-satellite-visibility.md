# Satellite Tracker v1.1 — Orbit-on-Select + Dot Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show orbit ground-tracks only for the selected satellite, and make satellite dots larger with white halos and a selected-ring highlight.

**Architecture:** Pure client-side change in `sat-client/`: App filters the `orbits` prop to the selected satellite and adds a `selected` flag to dot features; MapView uses data-driven paint expressions for radius/stroke.

**Tech Stack:** React, MapLibre GL, vitest.

**Spec:** `docs/superpowers/specs/2026-08-04-satellite-visibility-design.md`

---

### Task 1: MapView dot visibility + App orbit filtering (TDD)

**Files:**
- Modify: `sat-client/src/MapView.tsx`
- Modify: `sat-client/src/App.tsx`
- Modify: `sat-client/tests/mapview.test.tsx`
- Modify: `sat-client/tests/app.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `sat-client/tests/mapview.test.tsx`:

```tsx
it("uses data-driven radius and white halo stroke for satellite dots", () => {
  render(<MapView {...props} />);
  const layerCall = addLayerMock.mock.calls.find((c) => c[0].id === "satellites-layer");
  expect(layerCall).toBeDefined();
  const paint = layerCall![0].paint;
  expect(paint["circle-radius"]).toEqual(["case", ["get", "selected"], 11, 8]);
  expect(paint["circle-stroke-color"]).toEqual("#ffffff");
  expect(paint["circle-stroke-width"]).toEqual(["case", ["get", "selected"], 3, 2]);
});
```

Append to `sat-client/tests/app.test.tsx`:

```tsx
it("passes only the selected satellite's orbit and flags the selected dot", async () => {
  render(<App />);
  await act(async () => {});
  await act(async () => { vi.advanceTimersByTime(1000); });
  capturedClick!({ point: { x: 0, y: 0 } }); // selects ISS (25544)
  await act(async () => {});
  // capture MapView props: the mapview mock's addSource calls record the data passed in
  const satCall = addSourceMock.mock.calls.find((c) => c[0] === "satellites");
  expect(satCall).toBeDefined();
  const features = satCall![1].data.features;
  expect(features.every((f: { properties: { catnr: number; selected?: boolean } }) =>
    f.properties.selected === (f.properties.catnr === 25544)
  )).toBe(true);
});
```

NOTE: app.test.tsx currently has a minimal maplibre mock (`addSource() {}` no-ops). To assert the data passed to the satellites source, the mock must record `addSource` calls — add module-scope `const addSourceMock = vi.fn();` and have the mock's `addSource(...a) { addSourceMock(...a); }` (mirror mapview.test.tsx's mock). Also `clearAllMocks`/`mockClear` in beforeEach as needed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w sat-client`
Expected: FAIL — the radius paint is a plain number and no `selected` flag exists. Existing 15 tests still pass.

- [ ] **Step 3: Implement in `sat-client/src/MapView.tsx`**

Replace the satellites layer paint block:

```tsx
      map.addLayer({
        id: "satellites-layer",
        type: "circle",
        source: "satellites",
        paint: {
          "circle-radius": ["case", ["get", "selected"], 11, 8],
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": ["case", ["get", "selected"], 3, 2],
        },
      });
```

- [ ] **Step 4: Implement in `sat-client/src/App.tsx`**

1. Dot features get the selected flag — in the tick's position building:

```tsx
          return {
            catnr: s.catnr,
            lat: p.latDeg,
            lon: p.lonDeg,
            altKm: p.altKm,
            velocityKms: p.velocityKms,
            color: cfg?.color,
            selected: s.catnr === selectedCatnrRef.current,
          };
```

NOTE: the tick closure captures `selectedCatnr` at interval-creation time (stale after selection changes). Add a ref mirroring the pattern used elsewhere (`const selectedCatnrRef = useRef(selectedCatnr); selectedCatnrRef.current = selectedCatnr;`) and read `selectedCatnrRef.current` inside the interval. (Or re-create the interval when selectedCatnr changes — the ref approach is less churn.)

2. Extend `SatDot` in `sat-client/src/MapView.tsx` with `selected?: boolean;` (MapView ignores it beyond paint lookup — properties spread includes it).

3. Orbit filtering — the MapView call:

```tsx
      <MapView
        positions={positions}
        orbits={selected ? { [selected.catnr]: orbits[selected.catnr] } : {}}
        ...
```

(`selected` is already computed in App.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w sat-client`
Expected: PASS — 17 tests (15 + 2 new). Typecheck: `npm run build -w sat-client` clean. Full `npm test` — server 36 + client 16 + sat-client 17 = 69.

- [ ] **Step 6: Commit**

```bash
git add sat-client/src/MapView.tsx sat-client/src/App.tsx sat-client/tests/mapview.test.tsx sat-client/tests/app.test.tsx
git commit -m "feat: show orbit only for selected satellite, bigger dots with halos"
```

---

### Task 2: Integration + visual verification

**Files:**
- None (verification only)

- [ ] **Step 1: Full suite**

Run: `npm test` — 69 tests, all passing. Builds: `npm run build -w sat-client` clean.

- [ ] **Step 2: Visual pass (visual-inspector subagent)**

App should be running (launchctl-started dev:sat at :5173/:3001; the tsx/vite watchers hot-reload the changes). Verify: dots are clearly visible with white halos over land and sea (screenshot, compare to before); NO orbit lines initially; click a satellite → exactly one orbit line appears and follows the selected dot; click a different satellite → the line switches; click empty map → line disappears (deselect); selected dot has a visible ring. Screenshot each step. If the app isn't running, restart it and note the URL.
