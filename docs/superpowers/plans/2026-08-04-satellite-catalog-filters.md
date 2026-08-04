# Satellite Tracker v1.3 — Full Catalog + Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the curated 12-satellite view with the full active catalog (~7k satellites) with regime/constellation/search filters, regime colors, and viewport culling.

**Architecture:** Server gains `?group=active` bulk TLE fetching; a new `catalog.ts` module classifies each TLE (regime, constellation); App owns filter state and propagates only matching satellites; MapView culls dots to the visible viewport.

**Tech Stack:** TypeScript, Express, CelesTrak, satellite.js, React, MapLibre GL, vitest, supertest.

**Spec:** `docs/superpowers/specs/2026-08-04-satellite-catalog-filters-design.md`

---

### Task 1: Server — /api/tle group support

**Files:**
- Modify: `server/src/app.ts`
- Modify: `server/tests/index.test.ts`

- [ ] **Step 1: Write the failing tests — append to the "GET /api/tle" describe in `server/tests/index.test.ts`**

```typescript
  it("fetches a CelesTrak GROUP bulk file and caches it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => `ISS (ZARYA)\n1 25544U 98067A   14020.93268519  .00009878  00000-0  18200-3 0  5082\n2 25544  51.6498 109.4756 0003572  55.9686 274.4705 15.49815350830473\n`,
      })
    );
    const app = createApp({ provider: okProvider });
    const res1 = await request(app).get("/api/tle?group=active");
    expect(res1.status).toBe(200);
    expect(res1.text).toContain("ISS (ZARYA)");
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("GROUP=active");
    const res2 = await request(app).get("/api/tle?group=active");
    expect(res2.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1); // cached
    vi.unstubAllGlobals();
  });

  it("rejects unknown groups and combined catnr+group", async () => {
    const app = createApp({ provider: okProvider });
    const res1 = await request(app).get("/api/tle?group=debris");
    expect(res1.status).toBe(400);
    const res2 = await request(app).get("/api/tle?catnr=25544&group=active");
    expect(res2.status).toBe(400);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w server`
Expected: FAIL — unknown group returns 502 (route ignores group and treats it as invalid catnr → actually 400 since catnr regex fails... verify the current behavior: `?group=active` has no catnr → String(req.query.catnr ?? "") = "" → regex fails → 400. So the group tests fail with 400 instead of 200. The combined test may PASS accidentally (catnr present, group ignored → 200... no: catnr=25544&group=active → catnr valid → 200 → the 400 assertion fails). Record the actual red behavior.

- [ ] **Step 3: Implement in `server/src/app.ts`**

Replace the /api/tle route with group support:

```typescript
  const TLE_GROUPS = new Set(["active"]);

  app.get("/api/tle", async (req, res) => {
    const catnr = String(req.query.catnr ?? "");
    const group = String(req.query.group ?? "");
    if ((catnr && group) || (!catnr && !group)) {
      res.status(400).json({ error: "provide exactly one of catnr or group" });
      return;
    }
    if (catnr) {
      if (!/^\d{1,5}(,\d{1,5}){0,49}$/.test(catnr)) {
        res.status(400).json({ error: "invalid catnr" });
        return;
      }
      try {
        const tle = await tleCache.getOrLoad(`catnr:${catnr}`, async () => {
          const blocks = await Promise.all(
            catnr.split(",").map(async (c) => {
              const upstream = await fetch(
                `https://celestrak.org/NORAD/elements/gp.php?CATNR=${c}&FORMAT=tle`
              );
              if (!upstream.ok) throw new Error(`CelesTrak responded ${upstream.status}`);
              return await upstream.text();
            })
          );
          return blocks.filter((b) => b.includes("\n2 ")).join("");
        });
        res.type("text/plain").send(tle);
      } catch {
        res.status(502).json({ error: "provider unreachable" });
      }
      return;
    }
    if (!TLE_GROUPS.has(group)) {
      res.status(400).json({ error: `unsupported group: ${group}` });
      return;
    }
    try {
      const tle = await tleCache.getOrLoad(`group:${group}`, async () => {
        const upstream = await fetch(
          `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`
        );
        if (!upstream.ok) throw new Error(`CelesTrak responded ${upstream.status}`);
        return await upstream.text();
      });
      res.type("text/plain").send(tle);
    } catch {
      res.status(502).json({ error: "provider unreachable" });
    }
  });
```

Note the cache keys changed to namespaced (`catnr:...` / `group:...`) so the two modes never collide.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w server`
Expected: PASS — 38 tests (36 + 2 new). Typecheck: `npx tsc --noEmit -p server` clean.

- [ ] **Step 5: Smoke test the live group endpoint**

`PORT=3006 npm run start -w server` (background), then:

```
curl -s "http://localhost:3006/api/tle?group=active" | grep -c "^[0-2] "   # count element lines (~14k = 7k sats × 2)
curl -s "http://localhost:3006/api/tle?group=active" | head -3              # first block (ISS or similar)
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3006/api/tle?group=nope"   # 400
```

Report the element-line count and first block. Kill the server.

- [ ] **Step 6: Commit**

```bash
git add server/src/app.ts server/tests/index.test.ts
git commit -m "feat: add group TLE fetching to the proxy"
```

---

### Task 2: Catalog classification module (TDD)

**Files:**
- Create: `sat-client/src/sat/catalog.ts`
- Create: `sat-client/tests/catalog.test.ts`

- [ ] **Step 1: Write the failing tests — `sat-client/tests/catalog.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { classifyRegime, classifyConstellation, annotate } from "../src/sat/catalog";
import { parseTleBlock } from "../src/sat/tle";
```

Fixtures: fetch REAL TLEs at implementation time from CelesTrak for three regimes (e.g. ISS 25544 → LEO; GPS BIIR-1 24876 → MEO; GOES-16 41866 → GEO) — embed the returned blocks. Also craft name-based classification using the same blocks plus synthetic names where needed.

```typescript
describe("classifyRegime", () => {
  it("classifies by orbital period thresholds", () => {
    const [leo] = parseTleBlock(ISS_BLOCK);
    const [meo] = parseTleBlock(GPS_BLOCK);
    const [geo] = parseTleBlock(GOES_BLOCK);
    expect(classifyRegime(leo.periodS)).toBe("leo");
    expect(classifyRegime(meo.periodS)).toBe("meo");
    expect(classifyRegime(geo.periodS)).toBe("geo");
  });

  it("applies the exact LEO/MEO boundary at 128 min and MEO/GEO at 1000 min", () => {
    expect(classifyRegime(128 * 60 - 1)).toBe("leo");
    expect(classifyRegime(128 * 60)).toBe("meo");
    expect(classifyRegime(1000 * 60 - 1)).toBe("meo");
    expect(classifyRegime(1000 * 60)).toBe("geo");
  });
});

describe("classifyConstellation", () => {
  it("maps known prefixes and defaults to other", () => {
    expect(classifyConstellation("STARLINK-1008")).toBe("starlink");
    expect(classifyConstellation("ONEWEB-0001")).toBe("oneweb");
    expect(classifyConstellation("GPS BIIR-1")).toBe("gps");
    expect(classifyConstellation("NAVSTAR 82")).toBe("gps");
    expect(classifyConstellation("IRIDIUM 33")).toBe("iridium");
    expect(classifyConstellation("NOAA 18")).toBe("other");
    expect(classifyConstellation("ISS (ZARYA)")).toBe("other");
  });
});

describe("annotate", () => {
  it("adds regime and constellation to a parsed satellite", () => {
    const [iss] = parseTleBlock(ISS_BLOCK);
    const cat = annotate(iss);
    expect(cat.regime).toBe("leo");
    expect(cat.constellation).toBe("other");
    expect(cat.name).toBe(iss.name);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w sat-client`
Expected: FAIL — cannot find module catalog.

- [ ] **Step 3: Write `sat-client/src/sat/catalog.ts`**

```typescript
import type { TleSatellite } from "./tle";

export type Regime = "leo" | "meo" | "geo";
export type Constellation = "starlink" | "oneweb" | "gps" | "iridium" | "other";

export const REGIME_COLORS: Record<Regime, string> = {
  leo: "#38bdf8",
  meo: "#a78bfa",
  geo: "#fbbf24",
};

const LEO_MAX_S = 128 * 60;
const MEO_MAX_S = 1000 * 60;

export function classifyRegime(periodS: number): Regime {
  if (periodS < LEO_MAX_S) return "leo";
  if (periodS < MEO_MAX_S) return "meo";
  return "geo";
}

export function classifyConstellation(name: string): Constellation {
  const n = name.toUpperCase();
  if (n.startsWith("STARLINK-")) return "starlink";
  if (n.startsWith("ONEWEB-")) return "oneweb";
  if (n.startsWith("GPS") || n.startsWith("NAVSTAR")) return "gps";
  if (n.startsWith("IRIDIUM")) return "iridium";
  return "other";
}

export interface CatalogSatellite extends TleSatellite {
  regime: Regime;
  constellation: Constellation;
}

export function annotate(sat: TleSatellite): CatalogSatellite {
  return { ...sat, regime: classifyRegime(sat.periodS), constellation: classifyConstellation(sat.name) };
}

export const CONSTELLATIONS: Constellation[] = ["starlink", "oneweb", "gps", "iridium", "other"];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w sat-client`
Expected: PASS — 30 existing + 3 new = 33 (report actual; catalog file adds 3 tests: 2 regime describes + 1 constellation + 1 annotate = 4 — count precisely). Typecheck: `npm run build -w sat-client` clean.

- [ ] **Step 5: Commit**

```bash
git add sat-client/src/sat/catalog.ts sat-client/tests/catalog.test.ts
git commit -m "feat: add satellite regime and constellation classification"
```

---

### Task 3: App — catalog loading, filters UI, regime colors (TDD)

**Files:**
- Modify: `sat-client/src/App.tsx`
- Modify: `sat-client/src/config.ts` (delete or reduce to regime colors — the curated SAT_CONFIG/CATNR_LIST are removed)
- Modify: `sat-client/src/MapView.tsx` (only if SatDot needs changes)
- Modify: `sat-client/tests/app.test.tsx`

- [ ] **Step 1: Write the failing tests**

Adapt `sat-client/tests/app.test.tsx`:
- The fetch mock must return a group-style fixture with 2-3 TLE blocks (ISS 25544 + a STARLINK + GOES-16 41866 — fetch real TLEs at implementation time and embed). The App now fetches `/api/tle?group=active`.
- Update the "fetches the TLE list" test: assert the URL contains `group=active`.
- The "N/M satellites loaded" banner changes to "N satellites loaded" — update the regex /satellites loaded/ stays valid.
- New tests:

```tsx
it("hides GEO satellites when the GEO regime is unchecked", async () => {
  render(<App />);
  await act(async () => {});
  await act(async () => { vi.advanceTimersByTime(2000); });
  fireEvent.click(screen.getByLabelText("GEO"));
  await act(async () => { vi.advanceTimersByTime(2000); });
  const geoDot = setDataMock.mock.calls
    .filter((c) => c[0] === "satellites")
    .at(-1)?.[1].features;
  expect(geoDot.every((f: { properties: { catnr: number } }) => f.properties.catnr !== 41866)).toBe(true);
});

it("narrows by search", async () => {
  render(<App />);
  await act(async () => {});
  await act(async () => { vi.advanceTimersByTime(2000); });
  fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "STARLINK" } });
  await act(async () => { vi.advanceTimersByTime(2000); });
  const dots = setDataMock.mock.calls.filter((c) => c[0] === "satellites").at(-1)?.[1].features;
  expect(dots.length).toBeGreaterThan(0);
  expect(dots.every((f: { properties: { catnr: number } }) => f.properties.catnr === <the starlink catnr>)).toBe(true);
});
```

- Add a "deselects when the selected satellite is filtered out" test: select ISS (click), then uncheck... which regime hides ISS? ISS is LEO — uncheck LEO → ISS deselected (panel gone).

CAREFUL: the app tests' maplibre mock — setDataMock must be captured per-source (existing pattern from the v1.1 tests). The tick is now 2s — the tests advance 2000ms. The observer geolocation-success stub pattern stays.

**Step 2 — Run tests to verify they fail:** `npm run test -w sat-client` — expected FAIL (App still uses the curated config). Existing 33 pass.

**Step 3 — Implement in `sat-client/src/App.tsx`:**

1. Remove SAT_CONFIG/CATNR_LIST usage; import from catalog: `REGIME_COLORS`, `classifyRegime`... no — App uses `annotate`, `CONSTELLATIONS`, `REGIME_COLORS`.
2. Load: `fetch("/api/tle?group=active")` → parse all → `setSats(parseTleBlock(text).map(annotate))`.
3. State:

```tsx
  const [regimes, setRegimes] = useState<Set<Regime>>(new Set(["leo", "meo", "geo"]));
  const [constellations, setConstellations] = useState<Set<Constellation>>(new Set(CONSTELLATIONS));
  const [search, setSearch] = useState("");
```

4. Derived:

```tsx
  const visibleSats = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sats.filter(
      (s) =>
        regimes.has(s.regime) &&
        constellations.has(s.constellation) &&
        (q === "" || s.name.toLowerCase().includes(q) || String(s.catnr).includes(q))
    );
  }, [sats, regimes, constellations, search]);
```

5. Selection safety effect:

```tsx
  useEffect(() => {
    if (selectedCatnr !== null && !visibleSats.some((s) => s.catnr === selectedCatnr)) {
      setSelectedCatnr(null);
    }
  }, [visibleSats, selectedCatnr]);
```

6. Tick: `visibleSats` instead of `sats`; interval 2000ms; color = `REGIME_COLORS[s.regime]`; compute immediately on mount/visibleSats change (run the tick computation once in an effect on [visibleSats], then interval): simplest — keep the interval effect keyed [visibleSats] with an immediate `compute()` call before setInterval (the effect body runs once per visibleSats change).
7. Banner: `{sats.length.toLocaleString()} satellites loaded · {visibleSats.length.toLocaleString()} shown`.
8. Controls: regime checkboxes with labels "LEO"/"MEO"/"GEO" (aria-label so getByLabelText works), constellation chips with labels, search input with placeholder "Search satellites…". Toggle helpers:

```tsx
  const toggleRegime = (r: Regime) => setRegimes((prev) => { const next = new Set(prev); next.has(r) ? next.delete(r) : next.add(r); return next; });
```

9. Panel + visibility + follow unchanged (operate on `selected` = visibleSats find or sats find — selection now possible for any catalog sat; keep `const selected = sats.find(...)` — works).

10. Delete `sat-client/src/config.ts` (SAT_CONFIG/CATNR_LIST/SAT_COLORS gone; REGIME_COLORS lives in catalog.ts). Check nothing else imports config.ts (MapView doesn't).

**Step 4 — Run tests to verify they pass:** `npm run test -w sat-client` — all pass (33 + new; report actual). Typecheck/build clean. Full `npm test`.

**Step 5 — Commit:**

```bash
git add sat-client/src/App.tsx sat-client/src/config.ts sat-client/tests/app.test.tsx
git commit -m "feat: full active catalog with regime, constellation and search filters"
```

---

### Task 4: MapView viewport culling (TDD)

**Files:**
- Modify: `sat-client/src/MapView.tsx`
- Modify: `sat-client/tests/mapview.test.tsx`

- [ ] **Step 1: Write the failing test — append to `sat-client/tests/mapview.test.tsx`**

```tsx
it("culls dots to the current map bounds", () => {
  // mock getBounds returns fixed bounds (e.g., lon 0..20, lat 0..20); positions inside and outside
  render(<MapView {...props} />);
  act(() => { loadHandler!(); });
  // trigger a move event to set bounds, then rerender with positions
  // ...
});
```

Implementation approach: MapView tracks bounds via a map `move` event → state; the satellites effect culls by bounds. In the mock: `getBounds()` returns `{ west: 0, south: 0, east: 20, north: 20 }`-shaped object (or `toArray()` — decide the shape in implementation), and a module-scope `moveHandler` captured from `on("move", ...)` that the test fires. The test: render with positions [{catnr:1, lat:10, lon:10}, {catnr:2, lat:50, lon:50}], fire the move handler, assert the satellites setData contains only catnr 1.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w sat-client` — expected FAIL (no culling yet).

- [ ] **Step 3: Implement in `sat-client/src/MapView.tsx`**

```tsx
  const [mapBounds, setMapBounds] = useState<{ west: number; south: number; east: number; north: number } | null>(null);
```

In the mount effect: `map.on("move", () => { const b = map.getBounds(); setMapBounds({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }); });` (guard `mapRef.current === map` like the load handler).

In the satellites effect (add mapBounds to deps): cull —

```tsx
    const MARGIN = 2;
    const satFeatures = positions
      .filter((p) =>
        mapBounds
          ? p.lon >= mapBounds.west - MARGIN && p.lon <= mapBounds.east + MARGIN &&
            p.lat >= mapBounds.south - MARGIN && p.lat <= mapBounds.north + MARGIN
          : true
      )
      .map(...);
```

(Note: at world zoom the bounds cover everything — no wrap handling for v1.)

- [ ] **Step 4: Run tests to verify they pass:** `npm run test -w sat-client` — all pass (existing 33 + 1 new; report actual). Build clean.

- [ ] **Step 5: Commit**

```bash
git add sat-client/src/MapView.tsx sat-client/tests/mapview.test.tsx
git commit -m "feat: cull satellite dots to the visible viewport"
```

---

### Task 5: Integration + visual verification

**Files:**
- None (verification only)

- [ ] **Step 1: Full suite + builds**

Run: `npm test` — all green. `npm run build -w sat-client` clean.

- [ ] **Step 2: Visual pass (visual-inspector subagent)**

App at :5173 (launchctl watch; restart if the watcher is stale — `launchctl remove flighttracker-sat` then relaunch with the PATH-exported zsh command if the UI doesn't show the catalog). Verify: zoomed-out world view renders THOUSANDS of dots (screenshot; the map will look dense/glittery); colors by regime (blue/violet/amber families visible); unchecking GEO removes the amber geostationary ring dots; unchecking Starlink (chip) removes most of the LEO swarm; search "ISS" leaves exactly one dot; click a sat → orbit + panel + Visible now still work; Follow still works. Screenshot each step. Report console errors and dot counts if measurable.
