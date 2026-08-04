# Satellite Tracker v1.4 — Clustering + Better Filters + Observer Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 16k-object catalog usable via MapLibre clustering, zoom-dependent dot sizing, cluster click-to-zoom, per-filter counts, All/None shortcuts, a search results list, and an observer longitude wrap fix.

**Architecture:** MapView: clustered source + cluster/count layers + cluster-click zoom + `focus` prop. App: count-annotated filter labels, All/None toggles, search results panel, observer longitude normalization. Pure client-side.

**Tech Stack:** React, MapLibre GL, vitest.

**Spec:** `docs/superpowers/specs/2026-08-04-satellite-clustering-filters-design.md`

---

### Task 1: MapView — clustering, cluster click, zoom-dependent radius, focus prop (TDD)

**Files:**
- Modify: `sat-client/src/MapView.tsx`
- Modify: `sat-client/tests/mapview.test.tsx`

- [ ] **Step 1: Write the failing tests — append to `sat-client/tests/mapview.test.tsx`**

```tsx
it("registers the satellites source with clustering enabled", () => {
  render(<MapView {...props} />);
  act(() => { loadHandler!(); });
  const satCall = addSourceMock.mock.calls.find((c) => c[0] === "satellites");
  expect(satCall).toBeDefined();
  expect(satCall![1]).toMatchObject({ type: "geojson", cluster: true, clusterRadius: 50 });
});

it("adds a cluster layer and a cluster label layer", () => {
  render(<MapView {...props} />);
  act(() => { loadHandler!(); });
  const ids = addLayerMock.mock.calls.map((c) => c[0].id);
  expect(ids).toContain("satellites-cluster-layer");
  expect(ids).toContain("satellites-cluster-label");
});

it("zooms into a cluster on cluster click instead of selecting", () => {
  const onSelect = vi.fn();
  clickHitsFeature = false; // need a cluster feature — see note below
  render(<MapView {...props} onSelect={onSelect} />);
  capturedClick!({ point: { x: 0, y: 0 }, lngLat: { lng: 2.35, lat: 48.86 } });
  expect(onSelect).not.toHaveBeenCalled();
  expect(flyToMock).toHaveBeenCalledWith(expect.objectContaining({ zoom: expect.any(Number) }));
});

it("flies to the focused satellite's position", () => {
  const { rerender } = render(<MapView {...props} />);
  act(() => { loadHandler!(); });
  rerender(
    <MapView
      {...props}
      positions={[{ catnr: 25544, lat: 45, lon: 2, altKm: 420 }]}
      focus={{ catnr: 25544, ts: 1 }}
    />
  );
  expect(flyToMock).toHaveBeenCalledWith(expect.objectContaining({ center: [2, 45] }));
});

it("uses zoom-interpolated dot radius", () => {
  render(<MapView {...props} />);
  act(() => { loadHandler!(); });
  const layerCall = addLayerMock.mock.calls.find((c) => c[0].id === "satellites-layer");
  expect(layerCall![0].paint["circle-radius"]).toEqual([
    "interpolate",
    ["linear"],
    ["zoom"],
    0,
    ["case", ["get", "selected"], 6, 4],
    10,
    ["case", ["get", "selected"], 14, 9],
  ]);
});
```

Mock changes in mapview.test.tsx:
- `queryRenderedFeatures` must support clusters: add a module-scope flag `let clickReturnsCluster = false;` — when true, return `[{ properties: { point_count: 42 } }]`; else the existing dot feature or `[]` per `clickHitsFeature`. The click handler queries with `{ layers: [...] }` — the mock ignores the layers arg and returns per the flags. Cluster-click test: set `clickReturnsCluster = true`.
- The click handler's cluster branch reads `features[0].properties.point_count` — implement accordingly.
- Add `const flyToMock = vi.fn();` and `flyTo(...a) { flyToMock(...a); }` in both mock classes; clear in beforeEach. (MapView already has a flyTo in the mock from earlier tasks — check; if it exists as a no-op, convert to flyToMock.)
- Existing tests to keep green: "reports a satellite click via onSelect" — with `clickReturnsCluster = false` default, queryRenderedFeatures returns the dot feature → onSelect path ✓. "reports an empty-map click via onSetObserver" — clickHitsFeature = false AND clickReturnsCluster = false → empty → onSetObserver ✓.
- The culling test and selected-flag tests keep working (source config objectContaining assertions still match with cluster: true).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w sat-client`
Expected: FAIL — no cluster config/layers/flyTo/focus. Existing 38 pass.

- [ ] **Step 3: Implement in `sat-client/src/MapView.tsx`**

1. Props gains `focus: { catnr: number; ts: number } | null;` (required prop — update the shared `props` object in the test file).
2. Satellites source:

```tsx
      map.addSource("satellites", { type: "geojson", data: satData, cluster: true, clusterRadius: 50 });
```

3. Replace the single dots layer with three layers (in order: cluster circle, cluster label, dots):

```tsx
      map.addLayer({
        id: "satellites-cluster-layer",
        type: "circle",
        source: "satellites",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#475569",
          "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 0, 12, 200, 28],
          "circle-stroke-color": "#f8fafc",
          "circle-stroke-width": 1.5,
        },
      });
      map.addLayer({
        id: "satellites-cluster-label",
        type: "symbol",
        source: "satellites",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 11,
          "text-font": ["Open Sans Bold"],
        },
        paint: { "text-color": "#ffffff" },
      });
      map.addLayer({
        id: "satellites-layer",
        type: "circle",
        source: "satellites",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0,
            ["case", ["get", "selected"], 6, 4],
            10,
            ["case", ["get", "selected"], 14, 9],
          ],
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": ["case", ["get", "selected"], 3, 2],
        },
      });
```

NOTE: `text-font: ["Open Sans Bold"]` requires the font glyphs from the style — OpenFreeMap liberty includes Open Sans; if the label layer errors at runtime (missing glyphs), the fallback is to drop the label layer and show only the circle (count shown via circle-size only) — report if you had to drop it. (Vitest mocks won't catch this — the visual pass will.)

4. Click handler — replace with cluster-aware logic:

```tsx
    map.on("click", (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: ["satellites-cluster-layer", "satellites-layer"],
      });
      if (features.length === 0) {
        onSetObserverRef.current(e.lngLat.lat, e.lngLat.lng);
        return;
      }
      const props = features[0].properties ?? {};
      if (props.point_count !== undefined) {
        map.flyTo({ center: e.lngLat, zoom: map.getZoom() + 2, essential: true });
        return;
      }
      onSelectRef.current((props.catnr as number) ?? -1);
    });
```

5. Focus effect (after the follow effect):

```tsx
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus || !styleLoaded) return;
    const target = positions.find((p) => p.catnr === focus.catnr);
    if (!target) return;
    map.flyTo({ center: [target.lon, target.lat], zoom: 6, essential: true });
  }, [focus, positions, styleLoaded]);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w sat-client`
Expected: PASS — 38 + 5 new = 43 (report actual). Typecheck: `npm run build -w sat-client` clean.

- [ ] **Step 5: Commit**

```bash
git add sat-client/src/MapView.tsx sat-client/tests/mapview.test.tsx
git commit -m "feat: cluster satellites with click-to-zoom and focus prop"
```

---

### Task 2: App — filter counts, All/None, search results, observer wrap (TDD)

**Files:**
- Modify: `sat-client/src/App.tsx`
- Modify: `sat-client/src/styles.css`
- Modify: `sat-client/tests/app.test.tsx`

- [ ] **Step 1: Write the failing tests — append to `sat-client/tests/app.test.tsx`**

```tsx
it("shows per-filter counts in the checkbox labels", async () => {
  render(<App />);
  await act(async () => {});
  expect(screen.getByLabelText(/LEO/)).toHaveTextContent("LEO (2)");
  expect(screen.getByLabelText(/GEO/)).toHaveTextContent("GEO (1)");
  expect(screen.getByLabelText(/starlink/)).toHaveTextContent("starlink (1)");
});
```

(3-block fixture: ISS + STARLINK (LEO) + GOES (GEO) → LEO 2, MEO 0, GEO 1; starlink 1.)

CAREFUL: `getByLabelText(/LEO/)` with a label containing an `<input>` — the label text includes "LEO (2)" and the checkbox has aria-label "LEO". If both exist, `getByLabelText(/LEO/)` may match multiple elements (the input's aria-label AND the label text). Adjust: keep the input's aria-label as-is and assert via `screen.getByText("LEO (2)")` instead — decide what's robust and note it. Also — should the count live in the aria-label too? Keep aria-label = "LEO" (test-friendly, matches existing tests) and display text "LEO (2)".

```tsx
it("toggles all regimes off and back on via the None/All shortcuts", async () => {
  render(<App />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: /regimes: none/i }));
  await act(async () => { vi.advanceTimersByTime(2000); });
  const dots = setDataMock.mock.calls.filter((c) => c[0] === "satellites").at(-1)?.[1].features ?? [];
  expect(dots).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: /regimes: all/i }));
  await act(async () => { vi.advanceTimersByTime(2000); });
  const dots2 = setDataMock.mock.calls.filter((c) => c[0] === "satellites").at(-1)?.[1].features ?? [];
  expect(dots2.length).toBeGreaterThan(0);
});
```

```tsx
it("lists search results and selects on click", async () => {
  render(<App />);
  await act(async () => {});
  fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "ISS" } });
  await act(async () => {});
  fireEvent.click(screen.getByText("ISS (ZARYA)"));
  await act(async () => {});
  expect(screen.getByText("ISS (ZARYA)")).toBeInTheDocument(); // panel opens
});
```

CAREFUL: with search "ISS" the results list shows "ISS (ZARYA)" AND the details panel (after click) also shows the same text — after the click, `getByText("ISS (ZARYA)")` may match 2 elements (results list item + panel title). Use `getAllByText(...).length >= 2` or assert the panel row "Regime" exists instead. Decide and note.

```tsx
it("wraps the observer longitude into ±180", async () => {
  render(<App />);
  await act(async () => {});
  clickHitsFeature = false;
  capturedClick!({ lngLat: { lng: 293.78, lat: 48.86 } });
  await act(async () => {});
  expect(screen.getByText(/Observer: 48\.86, -66\.22/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w sat-client`
Expected: FAIL — no counts, no All/None, no results list, no wrap. Existing 43 pass.

- [ ] **Step 3: Implement in `sat-client/src/App.tsx`**

1. Counts (useMemo, next to visibleSats):

```tsx
  const regimeCounts = useMemo(() => {
    const counts: Record<Regime, number> = { leo: 0, meo: 0, geo: 0 };
    for (const s of sats) counts[s.regime] += 1;
    return counts;
  }, [sats]);

  const constellationCounts = useMemo(() => {
    const counts: Record<Constellation, number> = { starlink: 0, oneweb: 0, gps: 0, iridium: 0, other: 0 };
    for (const s of sats) counts[s.constellation] += 1;
    return counts;
  }, [sats]);
```

2. All/None handlers:

```tsx
  const setAllRegimes = (on: boolean) => setRegimes(new Set(on ? ["leo", "meo", "geo"] : []));
  const setAllConstellations = (on: boolean) => setConstellations(new Set(on ? CONSTELLATIONS : []));
```

3. Search results (derived, capped):

```tsx
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q === "") return [];
    return sats
      .filter((s) => s.name.toLowerCase().includes(q) || String(s.catnr).includes(q))
      .slice(0, 20);
  }, [sats, search]);
```

4. Focus state + pass to MapView:

```tsx
  const [focus, setFocus] = useState<{ catnr: number; ts: number } | null>(null);
```

MapView call gains `focus={focus}`. Results click:

```tsx
  const selectFromResults = (catnr: number) => {
    setSelectedCatnr(catnr);
    setFocus({ catnr, ts: Date.now() });
  };
```

5. Controls markup — counts in labels, All/None buttons, results panel. Regime group:

```tsx
        <div className="filter-group">
          <div className="filter-group-header">
            <span>Regime</span>
            <button onClick={() => setAllRegimes(true)}>All</button>
            <button onClick={() => setAllRegimes(false)}>None</button>
          </div>
          <div className="filter-row">
            {(["leo", "meo", "geo"] as Regime[]).map((r) => (
              <label key={r} style={{ color: REGIME_COLORS[r] }}>
                <input
                  type="checkbox"
                  aria-label={r.toUpperCase()}
                  checked={regimes.has(r)}
                  onChange={() => toggleRegime(r)}
                />
                {r.toUpperCase()} ({regimeCounts[r]})
              </label>
            ))}
          </div>
        </div>
```

(Similarly for constellations; search input unchanged; All/None buttons for constellations with accessible names "Constellations: all"/"Constellations: none"... — use aria-label matching the test regex: the tests use /regimes: none/i and /regimes: all/i — so button aria-labels must be exactly "Regimes: None" / "Regimes: All" (case-insensitive regex). Same for constellations if tested.)

6. Search results panel (rendered when searchResults.length > 0, positioned under the controls — reuse the pass-list panel styling):

```tsx
      {searchResults.length > 0 && (
        <div className="panel results-list">
          <h2>Results</h2>
          {searchResults.map((s) => (
            <button key={s.catnr} className="result-row" onClick={() => selectFromResults(s.catnr)}>
              {s.name} · {s.catnr}
            </button>
          ))}
          {searchResults.length === 20 && <div className="row"><span>… and more</span></div>}
        </div>
      )}
```

(results-list needs `results-list` styling + result-row buttons reset — styles in Step 4.)

7. Observer normalization helper + apply at both call sites:

```tsx
  const normalizeObserver = (lat: number, lon: number): ObserverPoint => ({
    lat,
    lon: ((lon + 180) % 360 + 360) % 360 - 180,
    heightM: 0,
  });
```

- onSetObserver: `onSetObserver={(lat, lon) => setObserver(normalizeObserver(lat, lon))}`
- geolocation success: `(pos) => setObserver(normalizeObserver(pos.coords.latitude, pos.coords.longitude))`
- FALLBACK_OBSERVER is already in range — fine.

- [ ] **Step 4: styles.css additions** (`sat-client/src/styles.css`):

```css
.controls { background: rgba(17, 24, 39, 0.92); border-radius: 8px; padding: 10px; }
.filter-group { display: flex; flex-direction: column; gap: 4px; }
.filter-group-header {
  display: flex; align-items: center; gap: 6px;
  color: #9ca3af; font: 12px system-ui, sans-serif;
}
.filter-group-header button {
  background: none; border: none; color: #60a5fa;
  font: 11px system-ui, sans-serif; cursor: pointer; padding: 0;
}
.results-list { top: 180px; left: 12px; width: 280px; max-height: 300px; overflow-y: auto; }
.result-row {
  display: block; width: 100%; text-align: left;
  background: none; border: none; color: #e5e7eb;
  font: 12px system-ui, sans-serif; padding: 4px 0; cursor: pointer;
}
.result-row:hover { color: #60a5fa; }
```

(Check the existing .controls style — it may already have background/padding from v1.3; read it and adapt, keeping the panel look consistent.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w sat-client`
Expected: PASS — 43 + 4 new = 47 (report actual). Typecheck: `npm run build -w sat-client` clean. Full `npm test` — server 38 + client 16 + sat-client N.

- [ ] **Step 6: Commit**

```bash
git add sat-client/src/App.tsx sat-client/src/styles.css sat-client/tests/app.test.tsx
git commit -m "feat: filter counts, all-none shortcuts, search results, observer wrap"
```

---

### Task 3: Integration + visual verification

**Files:**
- None (verification only)

- [ ] **Step 1: Full suite + builds**

Run: `npm test` — all green. `npm run build -w sat-client` clean.

- [ ] **Step 2: Visual pass (visual-inspector subagent)**

App at :5173 (launchctl watch; the catalog should still be cached 12h — if the banner shows 502/provider-unreachable, the 12h cache expired or the upstream throttle returned — check the upstream once; the app reload retries). Verify: world view shows numbered CLUSTERS (not a solid dot field — screenshot); zooming in unclusters into distinct dots with regime colors; clicking a cluster zooms in (before/after screenshots); dot size grows with zoom; filter labels show counts ("LEO (15,3xx)"); Regime All/None buttons work; searching "ISS" shows a results list with names + catnr, clicking one selects it AND flies the map to it; the observer label longitude is always within ±180; details panel/Visible now/Follow still work; console errors (especially the cluster label glyphs — if the count labels don't render, report it). Screenshot each step.
