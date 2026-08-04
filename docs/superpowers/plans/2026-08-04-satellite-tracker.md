# Satellite Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A satellite tracking map — curated satellites as moving dots with orbit ground-tracks, click-for-details, and pass predictions over a user location. Positions computed client-side from TLEs (no API polling).

**Architecture:** Extend the existing Express server with a cached `GET /api/tle` proxy to CelesTrak. New `sat-client/` workspace (Vite + React + MapLibre GL + satellite.js): pure modules for TLE parse / position propagation / ground tracks / pass predictions, animated by a 1s tick updating one GeoJSON source.

**Tech Stack:** TypeScript, Express, CelesTrak, satellite.js (npm), React, MapLibre GL, vitest, supertest.

**Spec:** `docs/superpowers/specs/2026-08-04-satellite-tracker-design.md`

---

### Task 1: Server — /api/tle proxy with 12h cache

**Files:**
- Modify: `server/src/app.ts`
- Modify: `server/src/index.ts`
- Modify: `server/tests/index.test.ts`

- [ ] **Step 1: Write the failing tests — append to `server/tests/index.test.ts`**

```typescript
describe("GET /api/tle", () => {
  const tleBlock = `ISS (ZARYA)\n1 25544U 98067A   14020.93268519  .00009878  00000-0  18200-3 0  5082\n2 25544  51.6498 109.4756 0003572  55.9686 274.4705 15.49815350830473\n`;

  it("returns 400 for an invalid catnr", async () => {
    const app = createApp({ provider: okProvider });
    const res = await request(app).get("/api/tle?catnr=abc");
    expect(res.status).toBe(400);
    const res2 = await request(app).get("/api/tle?catnr=25544,,20580");
    expect(res2.status).toBe(400);
  });

  it("proxies the TLE text and caches within TTL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => tleBlock }));
    const app = createApp({ provider: okProvider });
    const res1 = await request(app).get("/api/tle?catnr=25544,20580");
    expect(res1.status).toBe(200);
    expect(res1.text).toContain("ISS (ZARYA)");
    const res2 = await request(app).get("/api/tle?catnr=25544,20580");
    expect(res2.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("returns 502 when CelesTrak is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "" }));
    const app = createApp({ provider: okProvider });
    const res = await request(app).get("/api/tle?catnr=25544");
    expect(res.status).toBe(502);
    vi.unstubAllGlobals();
  });
});
```

Note: the describe block needs the TTL to be long enough that the two requests hit the cache — default 12h is fine. `okProvider` already exists in the file (from the flights tests). Check that the existing `beforeEach`/stubbing in index.test.ts doesn't conflict — if the file stubs fetch globally in a beforeEach, override per-test with `vi.stubGlobal` (which stacks) and `vi.unstubAllGlobals()` at the end of each test.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm run test -w server`
Expected: FAIL — /api/tle returns 404 (route missing). Existing 32 pass.

- [ ] **Step 3: Implement in `server/src/app.ts`**

1. Add module constant (next to the existing TTL constants):

```typescript
const TLE_CACHE_TTL_MS = 43_200_000; // 12h
```

2. Extend `CreateAppDeps` with `tleCacheTtlMs?: number;`

3. Inside createApp, after the track cache:

```typescript
  const tleCache = new TtlCache<string>(tleCacheTtlMs ?? TLE_CACHE_TTL_MS);
```

4. Add the route after /api/track:

```typescript
  app.get("/api/tle", async (req, res) => {
    const catnr = String(req.query.catnr ?? "");
    if (!/^\d{1,5}(,\d{1,5}){0,49}$/.test(catnr)) {
      res.status(400).json({ error: "invalid catnr" });
      return;
    }
    try {
      const tle = await tleCache.getOrLoad(catnr, async () => {
        const upstream = await fetch(
          `https://celestrak.org/NORAD/elements/gp.php?CATNR=${catnr}&FORMAT=tle`
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

- [ ] **Step 4: Update `server/src/index.ts`** — add `tleCacheTtlMs: Number(process.env.TLE_CACHE_TTL_MS ?? 43_200_000),` to the createApp call.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w server`
Expected: PASS — 35 tests (32 + 3). Typecheck: `npx tsc --noEmit -p server` clean.

- [ ] **Step 6: Smoke test the live endpoint**

Boot the server on a spare port (PORT=3006 if 3001 is in use): `PORT=3006 npm run start -w server`. Then:

```
curl "http://localhost:3006/api/tle?catnr=25544" | head -3
curl "http://localhost:3006/api/tle?catnr=zzz" -w "%{http_code}\n"
```

Expected: first returns the ISS TLE block (line 0 `ISS (ZARYA)`); second returns 400. Kill the server. Record what you got.

- [ ] **Step 7: Commit**

```bash
git add server/src/app.ts server/src/index.ts server/tests/index.test.ts
git commit -m "feat: add cached TLE proxy endpoint"
```

---

### Task 2: sat-client workspace scaffold

**Files:**
- Modify: `package.json` (root — workspaces + scripts)
- Create: `sat-client/package.json`
- Create: `sat-client/tsconfig.json`
- Create: `sat-client/vite.config.ts`
- Create: `sat-client/index.html`
- Create: `sat-client/src/main.tsx`
- Create: `sat-client/src/styles.css`
- Create: `sat-client/tests/setup.ts`

- [ ] **Step 1: Update root `package.json`**

Change `"workspaces": ["server", "client"]` to `["server", "client", "sat-client"]`, and update scripts:

```json
  "scripts": {
    "dev": "npm-run-all --parallel dev:server dev:client",
    "dev:sat": "npm-run-all --parallel dev:server dev:sat-client",
    "dev:server": "npm run dev -w server",
    "dev:client": "npm run dev -w client",
    "dev:sat-client": "npm run dev -w sat-client",
    "test": "npm run test -w server && npm run test -w client && npm run test -w sat-client",
    "build:airports": "tsx scripts/build-airports.ts"
  },
```

(Read the current root package.json first and preserve everything else.)

- [ ] **Step 2: Write `sat-client/package.json`**

```json
{
  "name": "sat-client",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "preview": "vite preview"
  },
  "dependencies": {
    "maplibre-gl": "^4.7.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "satellite.js": "^5.0.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.8",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 3: Write `sat-client/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 4: Write `sat-client/vite.config.ts`**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
  },
});
```

- [ ] **Step 5: Write `sat-client/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Satellite Tracker</title>
    <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.0/dist/maplibre-gl.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Write `sat-client/src/main.tsx`**

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

NOTE: `./App` does not exist yet (Task 5). To keep this task green, create a minimal placeholder `sat-client/src/App.tsx`:

```tsx
export default function App() {
  return <div className="app">Satellite tracker loading…</div>;
}
```

(Replaced fully in Task 5.)

- [ ] **Step 7: Write `sat-client/src/styles.css`** — copy the styling pattern from `client/src/styles.css` (the flight client), keeping the same class names (`.app`, `.map`, `.panel`, `.row`, `.banner`, `.controls`) plus two new classes:

```css
.observer-label {
  position: absolute;
  bottom: 52px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(17, 24, 39, 0.92);
  color: #e5e7eb;
  border-radius: 6px;
  padding: 6px 12px;
  font: 12px system-ui, sans-serif;
  z-index: 10;
}
.pass-list { max-height: 260px; overflow-y: auto; }
```

Read `client/src/styles.css` and copy it verbatim, then append these two classes.

- [ ] **Step 8: Write `sat-client/tests/setup.ts`**

```typescript
import "@testing-library/jest-dom";
```

- [ ] **Step 9: Install and verify**

Run: `npm install` (root). Then `npm ls --workspaces --depth=0` — confirm `sat-client` resolves with `satellite.js` present.

- [ ] **Step 10: Verify test setup works**

Run: `npm run test -w sat-client`
Expected: PASS — "No test files found" counts as a pass (or create a trivial smoke test if vitest errors; if it errors, add a minimal passing test file `sat-client/tests/smoke.test.ts` with `it("passes", () => expect(1).toBe(1))`).

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json sat-client
git commit -m "chore: scaffold sat-client workspace"
```

---

### Task 3: Satellite math modules (TDD)

**Files:**
- Create: `sat-client/src/sat/tle.ts`
- Create: `sat-client/src/sat/propagate.ts`
- Create: `sat-client/src/sat/groundTrack.ts`
- Create: `sat-client/src/sat/passes.ts`
- Create: `sat-client/tests/sat.test.ts`

- [ ] **Step 1: Write the failing tests — `sat-client/tests/sat.test.ts`**

Fixture TLE (canonical ISS example from the satellite.js docs — stable):

```typescript
const ISS_LINE1 = "1 25544U 98067A   14020.93268519  .00009878  00000-0  18200-3 0  5082";
const ISS_LINE2 = "2 25544  51.6498 109.4756 0003572  55.9686 274.4705 15.49815350830473";
const ISS_NAME = "ISS (ZARYA)";
```

```typescript
import { describe, it, expect } from "vitest";
import { parseTleBlock, TleSatellite } from "../src/sat/tle";
import { positionAt } from "../src/sat/propagate";
import { buildGroundTrack } from "../src/sat/groundTrack";
import { nextPasses } from "../src/sat/passes";

const ISS_LINE1 = "1 25544U 98067A   14020.93268519  .00009878  00000-0  18200-3 0  5082";
const ISS_LINE2 = "2 25544  51.6498 109.4756 0003572  55.9686 274.4705 15.49815350830473";
const ISS_BLOCK = `ISS (ZARYA)\n${ISS_LINE1}\n${ISS_LINE2}\n`;

describe("parseTleBlock", () => {
  it("parses name, period and inclination from a TLE block", () => {
    const sats = parseTleBlock(ISS_BLOCK);
    expect(sats).toHaveLength(1);
    const s = sats[0];
    expect(s.name).toBe("ISS (ZARYA)");
    expect(s.catnr).toBe(25544);
    // mean motion 15.49815350 revs/day -> period ~5574.9s
    expect(s.periodS).toBeGreaterThan(5500);
    expect(s.periodS).toBeLessThan(5600);
    expect(s.inclinationDeg).toBeCloseTo(51.6498, 3);
  });
});

describe("positionAt", () => {
  it("returns a deterministic lat/lon/altitude for a fixed date", () => {
    const [iss] = parseTleBlock(ISS_BLOCK);
    const pos = positionAt(iss.satrec, new Date(Date.UTC(2026, 7, 4, 12, 0, 0)));
    expect(pos.latDeg).toBeGreaterThan(-90);
    expect(pos.latDeg).toBeLessThan(90);
    expect(pos.lonDeg).toBeGreaterThan(-180);
    expect(pos.lonDeg).toBeLessThan(180);
    expect(pos.altKm).toBeGreaterThan(300);
    expect(pos.altKm).toBeLessThan(600);
    expect(pos.velocityKms).toBeGreaterThan(7);
    expect(pos.velocityKms).toBeLessThan(8);
  });

  it("returns a different position at a later time", () => {
    const [iss] = parseTleBlock(ISS_BLOCK);
    const t0 = new Date(Date.UTC(2026, 7, 4, 12, 0, 0));
    const t1 = new Date(Date.UTC(2026, 7, 4, 12, 10, 0));
    const p0 = positionAt(iss.satrec, t0);
    const p1 = positionAt(iss.satrec, t1);
    expect(Math.abs(p1.lonDeg - p0.lonDeg)).toBeGreaterThan(1);
  });
});

describe("buildGroundTrack", () => {
  it("produces one orbit of points spanning ~one period", () => {
    const [iss] = parseTleBlock(ISS_BLOCK);
    const track = buildGroundTrack(iss.satrec, 120);
    expect(track).toHaveLength(120);
    for (const [lon, lat] of track) {
      expect(lon).toBeGreaterThan(-180);
      expect(lon).toBeLessThan(180);
      expect(lat).toBeGreaterThan(-90);
      expect(lat).toBeLessThan(90);
    }
  });
});

describe("nextPasses", () => {
  it("finds ISS passes over Paris in the next 48h, sorted by max elevation", () => {
    const [iss] = parseTleBlock(ISS_BLOCK);
    const passes = nextPasses(iss.satrec, { lat: 48.8566, lon: 2.3522, heightM: 0 }, 48);
    expect(passes.length).toBeGreaterThan(0);
    for (const p of passes) {
      expect(p.start < p.peak && p.peak < p.end).toBe(true);
      expect(p.maxElevationDeg).toBeGreaterThanOrEqual(0);
    }
    for (let i = 1; i < passes.length; i++) {
      expect(passes[i - 1].maxElevationDeg).toBeGreaterThanOrEqual(passes[i].maxElevationDeg);
    }
  });
});
```

NOTE: the position test asserts only sane ranges, not exact values — the exact position at a fixed date depends on the satellite.js version's exact SGP4 implementation; range assertions keep the test robust while still verifying determinism + the "moves over time" property. This is a deliberate deviation from the flight tests' style (which pinned exact values) — record it in your report.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w sat-client`
Expected: FAIL — cannot find modules (sat/ directory doesn't exist).

- [ ] **Step 3: Write `sat-client/src/sat/tle.ts`**

```typescript
import { parseTle, twoline2satrec, type SatRec } from "satellite.js";

export interface TleSatellite {
  catnr: number;
  name: string;
  line1: string;
  line2: string;
  satrec: SatRec;
  periodS: number;
  inclinationDeg: number;
}

export function parseTleBlock(text: string): TleSatellite[] {
  const lines = text.split("\n").map((l) => l.trimEnd());
  const sats: TleSatellite[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i].trim();
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) continue;
    const satrec = twoline2satrec(line1, line2);
    const catnr = Number(line1.slice(2, 7));
    // satrec.no is mean motion in rad/min; period in seconds = 2*pi/no*60
    const periodS = (2 * Math.PI) / satrec.no * 60;
    sats.push({
      catnr,
      name,
      line1,
      line2,
      satrec,
      periodS,
      inclinationDeg: (satrec.inclo * 180) / Math.PI,
    });
  }
  return sats;
}
```

NOTE: check the satellite.js v5 export names against the installed package (`node_modules/satellite.js/dist/satellite.d.ts`): the v5 API exports `twoline2satrec` (previously `twoline2satrec`), `propagate`, `eciToGeodetic`, `gstime`, `degreesLat`, `degreesLong`, `getPasses`, and type `SatRec`. If the installed version names differ, adapt imports (e.g., `satellite.parseTle` legacy) — the tests must stay green, the module is the interface.

- [ ] **Step 4: Write `sat-client/src/sat/propagate.ts`**

```typescript
import { propagate, eciToGeodetic, gstime, degreesLat, degreesLong, type SatRec } from "satellite.js";

export interface SatPosition {
  latDeg: number;
  lonDeg: number;
  altKm: number;
  velocityKms: number;
}

export function positionAt(satrec: SatRec, date: Date): SatPosition {
  const pv = propagate(satrec, date);
  const gmst = gstime(date);
  const geodetic = eciToGeodetic(pv.position, gmst);
  const velocityKms = Math.sqrt(
    pv.velocity.x ** 2 + pv.velocity.y ** 2 + pv.velocity.z ** 2
  );
  return {
    latDeg: degreesLat(geodetic.latitude),
    lonDeg: degreesLong(geodetic.longitude),
    altKm: geodetic.height,
    velocityKms,
  };
}
```

- [ ] **Step 5: Write `sat-client/src/sat/groundTrack.ts`**

```typescript
import type { SatRec } from "satellite.js";
import { positionAt } from "./propagate";

export function buildGroundTrack(satrec: SatRec, points = 120): [number, number][] {
  const periodS = (2 * Math.PI) / satrec.no * 60;
  const start = new Date();
  const track: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const t = new Date(start.getTime() + (periodS * i) / points * 1000);
    const pos = positionAt(satrec, t);
    track.push([pos.lonDeg, pos.latDeg]);
  }
  return track;
}
```

- [ ] **Step 6: Write `sat-client/src/sat/passes.ts`**

```typescript
import { getPasses, type SatRec } from "satellite.js";

export interface ObserverPoint {
  lat: number;
  lon: number;
  heightM: number;
}

export interface Pass {
  start: Date;
  peak: Date;
  end: Date;
  maxElevationDeg: number;
}

export function nextPasses(
  satrec: SatRec,
  observer: ObserverPoint,
  hours = 48,
  stepMinutes = 1
): Pass[] {
  const now = new Date();
  const end = new Date(now.getTime() + hours * 3600_000);
  const raw = getPasses(observer, satrec, now, end, stepMinutes) as Array<{
    start: Date;
    end: Date;
    maxElevation: number;
  }>;
  return raw
    .map((p) => ({
      start: p.start,
      peak: new Date((p.start.getTime() + p.end.getTime()) / 2),
      end: p.end,
      maxElevationDeg: p.maxElevation,
    }))
    .sort((a, b) => b.maxElevationDeg - a.maxElevationDeg);
}
```

NOTE: the satellite.js `getPasses` signature is `getPasses(observer, satrec, startTime, endTime, stepSizeInMinutes)` and returns an array of passes each with `start`, `end`, `startLat`, `startLon`, `endLat`, `endLon`, `maxElevation`, `riseTime`, `setTime`. Verify the exact shape against the installed package's types (the peak estimate as the midpoint is an approximation — acceptable for v1; if the package exposes rise/set times, use those instead). The `observer` arg order is `(observer, satrec, ...)` — verify against the types; if reversed, fix and note it.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test -w sat-client`
Expected: PASS — 6 tests. If a specific assertion is wrong (e.g., getPasses argument order), fix the implementation per the installed package types — the module interface (function signatures used by later tasks) must stay as specified. Report any fixes.

- [ ] **Step 8: Typecheck/build**

Run: `npm run build -w sat-client` — clean.

- [ ] **Step 9: Commit**

```bash
git add sat-client/src/sat sat-client/tests/sat.test.ts
git commit -m "feat: add satellite TLE, propagation, ground track and pass modules"
```

---

### Task 4: Satellite config + MapView

**Files:**
- Create: `sat-client/src/config.ts`
- Create: `sat-client/src/MapView.tsx`
- Create: `sat-client/tests/mapview.test.tsx`

- [ ] **Step 1: Verify the curated NORAD catalog numbers against live CelesTrak**

Run: `curl "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544,48274,20580,43435,28654,33591,41866&FORMAT=tle"` and read the line-0 names. Confirm: 25544=ISS, 48274=Tiangong, 20580=Hubble, 43435=TESS, 28654=NOAA-18, 33591=NOAA-19, 41866=GOES-16. Then pick 5 Starlinks: `curl "https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle" | head -40` and choose 5 from the first lines, recording their catalog numbers (the 5th-9th fields of line 1 columns 3-7). If any of the 7 above 404 (absent from the response), replace with a live equivalent of the same category and note the swap in your report.

- [ ] **Step 2: Write `sat-client/src/config.ts`**

```typescript
export type SatCategory = "manned" | "science" | "comms" | "weather" | "geo";

export interface SatConfigEntry {
  catnr: number;
  category: SatCategory;
  color: string;
}

export const SAT_COLORS: Record<SatCategory, string> = {
  manned: "#f472b6",
  science: "#a78bfa",
  comms: "#38bdf8",
  weather: "#34d399",
  geo: "#fbbf24",
};

export const SAT_CONFIG: SatConfigEntry[] = [
  { catnr: 25544, category: "manned", color: SAT_COLORS.manned }, // ISS
  { catnr: 48274, category: "manned", color: SAT_COLORS.manned }, // Tiangong
  { catnr: 20580, category: "science", color: SAT_COLORS.science }, // Hubble
  { catnr: 43435, category: "science", color: SAT_COLORS.science }, // TESS
  { catnr: 28654, category: "weather", color: SAT_COLORS.weather }, // NOAA-18
  { catnr: 33591, category: "weather", color: SAT_COLORS.weather }, // NOAA-19
  { catnr: 41866, category: "geo", color: SAT_COLORS.geo }, // GOES-16
  // 5 Starlinks verified in Step 1 (catnr from live group listing)
  { catnr: 0, category: "comms", color: SAT_COLORS.comms }, // FILLED IN STEP 1
  { catnr: 0, category: "comms", color: SAT_COLORS.comms },
  { catnr: 0, category: "comms", color: SAT_COLORS.comms },
  { catnr: 0, category: "comms", color: SAT_COLORS.comms },
  { catnr: 0, category: "comms", color: SAT_COLORS.comms },
];

export const CATNR_LIST = SAT_CONFIG.map((c) => c.catnr).join(",");
```

(Replace the placeholder `catnr: 0` entries with the live Starlink numbers from Step 1.)

- [ ] **Step 3: Write the failing tests — `sat-client/tests/mapview.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import MapView, { type MapViewProps } from "../src/MapView";

let capturedClick: ((e: unknown) => void) | null = null;
const addSourceMock = vi.fn();
const addLayerMock = vi.fn();
const setDataMock = vi.fn();

vi.mock("maplibre-gl", () => ({
  default: class {
    on(evt: string, cb: (e: unknown) => void) {
      if (evt === "click") capturedClick = cb;
    }
    addSource(...a: unknown[]) {
      addSourceMock(...a);
    }
    addLayer(...a: unknown[]) {
      addLayerMock(...a);
    }
    removeLayer() {}
    removeSource() {}
    getSource() {
      return { setData: setDataMock };
    }
    getLayer() {
      return undefined;
    }
    queryRenderedFeatures() {
      return [{ properties: { catnr: 25544 } }];
    }
    flyTo() {}
    remove() {}
  },
  Map: class {
    on(evt: string, cb: (e: unknown) => void) {
      if (evt === "click") capturedClick = cb;
    }
    addSource(...a: unknown[]) {
      addSourceMock(...a);
    }
    addLayer(...a: unknown[]) {
      addLayerMock(...a);
    }
    removeLayer() {}
    removeSource() {}
    getSource() {
      return { setData: setDataMock };
    }
    getLayer() {
      return undefined;
    }
    queryRenderedFeatures() {
      return [{ properties: { catnr: 25544 } }];
    }
    flyTo() {}
    remove() {}
  },
}));

describe("MapView", () => {
  beforeEach(() => {
    capturedClick = null;
    addSourceMock.mockClear();
    addLayerMock.mockClear();
    setDataMock.mockClear();
  });

  const props: MapViewProps = {
    positions: [],
    orbits: {},
    observer: null,
    onSelect: () => {},
    onSetObserver: () => {},
  };

  it("adds the satellites source and orbit layer", () => {
    render(<MapView {...props} />);
    expect(addSourceMock).toHaveBeenCalledWith("satellites", expect.objectContaining({ type: "geojson" }));
    expect(addSourceMock).toHaveBeenCalledWith("orbits", expect.objectContaining({ type: "geojson" }));
  });

  it("updates satellite positions via setData", () => {
    const { rerender } = render(<MapView {...props} />);
    rerender(
      <MapView
        {...props}
        positions={[{ catnr: 25544, lat: 45, lon: 2, altKm: 420 }]}
      />
    );
    expect(setDataMock).toHaveBeenCalled();
    const [data] = setDataMock.mock.calls.at(-1);
    expect(data.features).toHaveLength(1);
    expect(data.features[0].properties.catnr).toBe(25544);
  });

  it("reports a satellite click via onSelect", () => {
    const onSelect = vi.fn();
    render(<MapView {...props} onSelect={onSelect} />);
    capturedClick!({ point: { x: 0, y: 0 } });
    expect(onSelect).toHaveBeenCalledWith(25544);
  });

  it("reports an empty-map click via onSetObserver", () => {
    const onSetObserver = vi.fn();
    let empty = true;
    // mock queryRenderedFeatures to return [] for the observer case — use a mutable flag
    // (see note below)
    render(<MapView {...props} onSetObserver={onSetObserver} />);
    capturedClick!({ point: { x: 0, y: 0 } });
    expect(onSetObserver).not.toHaveBeenCalled();
  });
});
```

NOTE on the empty-map click test: the mock's queryRenderedFeatures always returns a feature, so a click always selects. To test the observer path, make queryRenderedFeatures return `[]` when a module-scope flag `let clickHitsFeature = true;` is false, then the click handler calls onSetObserver with the clicked lat/lon — but the mock can't provide real coordinates (no map state). Pragmatic approach: the handler calls `onSetObserver` only when no feature is hit; the test sets `clickHitsFeature = false` and asserts `onSetObserver` WAS called (with whatever coords the mock provides — assert `toHaveBeenCalled()` with any argument, or have the mock store the last clicked lngLat and return it via a getter). Implement the mock with `let mockLngLat = { lng: 2.35, lat: 48.86 }` and the handler using `e.lngLat` — assert `onSetObserver` called with `(48.86, 2.35)`. Adapt the MapView handler to use `e.lngLat` (standard MapLibre click event).

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm run test -w sat-client`
Expected: FAIL — cannot find module ../src/MapView. (Existing sat.test.ts 6 tests still pass.)

- [ ] **Step 5: Write `sat-client/src/MapView.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import maplibregl, { Map as MapLibreMap } from "maplibre-gl";

export interface SatDot {
  catnr: number;
  lat: number;
  lon: number;
  altKm: number;
}

export interface MapViewProps {
  positions: SatDot[];
  orbits: Record<number, [number, number][]>;
  observer: { lat: number; lon: number } | null;
  onSelect: (catnr: number) => void;
  onSetObserver: (lat: number, lon: number) => void;
}

export default function MapView({
  positions,
  orbits,
  observer,
  onSelect,
  onSetObserver,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [styleLoaded, setStyleLoaded] = useState(false);
  const onSelectRef = useRef(onSelect);
  const onSetObserverRef = useRef(onSetObserver);
  onSelectRef.current = onSelect;
  onSetObserverRef.current = onSetObserver;

  useEffect(() => {
    const map = new MapLibreMap({
      container: containerRef.current!,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [0, 30],
      zoom: 2,
    });
    map.on("load", () => {
      if (mapRef.current === map) setStyleLoaded(true);
    });
    map.on("click", (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ["satellites-layer"] });
      if (features.length > 0) {
        onSelectRef.current((features[0].properties?.catnr as number) ?? -1);
      } else {
        onSetObserverRef.current(e.lngLat.lat, e.lngLat.lng);
      }
    });
    mapRef.current = map;
    return () => map.remove();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded) return;

    const satFeatures: GeoJSON.Feature[] = positions.map((p) => ({
      type: "Feature",
      properties: { catnr: p.catnr },
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
    }));
    const satData: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: satFeatures };

    if (!map.getSource("satellites")) {
      map.addSource("satellites", { type: "geojson", data: satData });
      map.addLayer({
        id: "satellites-layer",
        type: "circle",
        source: "satellites",
        paint: {
          "circle-radius": 4,
          "circle-color": ["get", "color"],
        },
      });
    } else {
      (map.getSource("satellites") as maplibregl.GeoJSONSource).setData(satData);
    }
  }, [positions, styleLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded) return;

    const orbitFeatures: GeoJSON.Feature[] = Object.entries(orbits).map(([catnr, coords]) => ({
      type: "Feature",
      properties: { catnr: Number(catnr) },
      geometry: { type: "LineString", coordinates: coords },
    }));
    const orbitData: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: orbitFeatures };

    if (!map.getSource("orbits")) {
      map.addSource("orbits", { type: "geojson", data: orbitData });
      map.addLayer({
        id: "orbits-layer",
        type: "line",
        source: "orbits",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 1,
          "line-opacity": 0.5,
          "line-dasharray": [2, 1],
        },
      });
    } else {
      (map.getSource("orbits") as maplibregl.GeoJSONSource).setData(orbitData);
    }
  }, [orbits, styleLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded) return;
    const feature: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: observer
        ? [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "Point", coordinates: [observer.lon, observer.lat] },
            },
          ]
        : [],
    };
    if (!map.getSource("observer")) {
      map.addSource("observer", { type: "geojson", data: feature });
      map.addLayer({
        id: "observer-layer",
        type: "circle",
        source: "observer",
        paint: { "circle-radius": 6, "circle-color": "#f8fafc", "circle-stroke-color": "#0f172a", "circle-stroke-width": 2 },
      });
    } else {
      (map.getSource("observer") as maplibregl.GeoJSONSource).setData(feature);
    }
  }, [observer, styleLoaded]);

  return <div ref={containerRef} className="map" />;
}
```

NOTE: the color for satellites/orbits comes from `["get", "color"]` — so the feature properties must include the color. The SatDot/positions are built in App (Task 5) with the color from SAT_CONFIG; the orbits features likewise. The tests above assert only catnr — adjust the tests to include `color` in the position property assertions IF the App builds them that way (keep tests consistent with the implementation; the mock's setData assertion checks catnr only, which stays valid).

ALSO NOTE: the mock's `queryRenderedFeatures` + `e.lngLat` — the handler uses `e.lngLat.lat/lng`; the empty-click test needs the mock to provide `{ lngLat: { lng: 2.35, lat: 48.86 } }` on the event and `queryRenderedFeatures` to return `[]` when `clickHitsFeature` is false. Implement the mock accordingly (module-scope `let clickHitsFeature = true;` + `let mockEvent = { lngLat: { lng: 2.35, lat: 48.86 } };` — the test for onSetObserver sets `clickHitsFeature = false` and asserts `onSetObserver` called with `(48.86, 2.35)`).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -w sat-client`
Expected: PASS — 10 tests (6 sat + 4 mapview). If the observer test needs the mock event to flow through `capturedClick`, wire it: `capturedClick!(mockEvent)`.

- [ ] **Step 7: Typecheck**

Run: `npm run build -w sat-client` — clean.

- [ ] **Step 8: Commit**

```bash
git add sat-client/src/config.ts sat-client/src/MapView.tsx sat-client/tests/mapview.test.tsx
git commit -m "feat: add satellite config and map view with orbits"
```

---

### Task 5: App — TLE load, animation tick, geolocation, panels

**Files:**
- Create: `sat-client/src/App.tsx` (replaces the placeholder)
- Create: `sat-client/tests/app.test.tsx`

- [ ] **Step 1: Write the failing tests — `sat-client/tests/app.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import App from "../src/App";

const ISS_BLOCK = `ISS (ZARYA)\n1 25544U 98067A   14020.93268519  .00009878  00000-0  18200-3 0  5082\n2 25544  51.6498 109.4756 0003572  55.9686 274.4705 15.49815350830473\n`;

let capturedClick: ((e: unknown) => void) | null = null;
let clickHitsFeature = true;

vi.mock("maplibre-gl", () => ({
  default: class {
    on(evt: string, cb: (e: unknown) => void) {
      if (evt === "click") capturedClick = cb;
    }
    addSource() {}
    addLayer() {}
    removeLayer() {}
    removeSource() {}
    getSource() {
      return { setData: vi.fn() };
    }
    getLayer() {
      return undefined;
    }
    queryRenderedFeatures() {
      return clickHitsFeature ? [{ properties: { catnr: 25544 } }] : [];
    }
    flyTo() {}
    remove() {}
  },
  Map: class {
    on(evt: string, cb: (e: unknown) => void) {
      if (evt === "click") capturedClick = cb;
    }
    addSource() {}
    addLayer() {}
    removeLayer() {}
    removeSource() {}
    getSource() {
      return { setData: vi.fn() };
    }
    getLayer() {
      return undefined;
    }
    queryRenderedFeatures() {
      return clickHitsFeature ? [{ properties: { catnr: 25544 } }] : [];
    }
    flyTo() {}
    remove() {}
  },
}));

beforeEach(() => {
  capturedClick = null;
  clickHitsFeature = true;
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, text: async () => ISS_BLOCK })
  );
  // geolocation stub: deny by default (headless)
  vi.stubGlobal("navigator", {
    ...navigator,
    geolocation: { getCurrentPosition: vi.fn() },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("App", () => {
  it("fetches the TLE list on load and reports N/M satellites", async () => {
    render(<App />);
    await act(async () => {});
    const calls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.startsWith("/api/tle?catnr="))).toBe(true);
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText(/satellites loaded/)).toBeInTheDocument();
  });

  it("opens the details panel on satellite click", async () => {
    render(<App />);
    await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(1000); });
    capturedClick!({ point: { x: 0, y: 0 } });
    await act(async () => {});
    expect(screen.getByText("ISS (ZARYA)")).toBeInTheDocument();
  });

  it("sets the observer point on empty-map click and computes passes", async () => {
    render(<App />);
    await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(1000); });
    clickHitsFeature = false;
    capturedClick!({ lngLat: { lng: 2.35, lat: 48.86 } });
    await act(async () => {});
    expect(screen.getByText(/observer/i)).toBeInTheDocument();
  });
});
```

NOTE: these tests exercise the full App including real satellite.js propagation in the animation tick (fast for 1 sat). The "N/M satellites loaded" text: App shows e.g. "1/1 satellites loaded". The details panel shows the name from the TLE. The observer label shows "Observer: 48.86, 2.35 — next pass predictions for selected satellite" or similar. Keep the exact strings consistent between test and implementation.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w sat-client`
Expected: FAIL — placeholder App renders "Satellite tracker loading…". (sat + mapview tests still pass.)

- [ ] **Step 3: Write `sat-client/src/App.tsx`** (replaces the placeholder entirely)

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import MapView, { type SatDot } from "./MapView";
import { SAT_CONFIG, CATNR_LIST, type SatCategory } from "./config";
import { parseTleBlock, type TleSatellite } from "./sat/tle";
import { positionAt } from "./sat/propagate";
import { buildGroundTrack } from "./sat/groundTrack";
import { nextPasses, type ObserverPoint, type Pass } from "./sat/passes";

const FALLBACK_OBSERVER: ObserverPoint = { lat: 48.8566, lon: 2.3522, heightM: 0 };

export default function App() {
  const [sats, setSats] = useState<TleSatellite[]>([]);
  const [configCount, setConfigCount] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [positions, setPositions] = useState<SatDot[]>([]);
  const [orbits, setOrbits] = useState<Record<number, [number, number][]>>({});
  const [selectedCatnr, setSelectedCatnr] = useState<number | null>(null);
  const [observer, setObserver] = useState<ObserverPoint | null>(null);
  const [passes, setPasses] = useState<Pass[] | null>(null);
  const selectedRef = useRef(selectedCatnr);
  selectedRef.current = selectedCatnr;
  const observerRef = useRef(observer);
  observerRef.current = observer;

  useEffect(() => {
    setConfigCount(SAT_CONFIG.length);
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(`/api/tle?catnr=${CATNR_LIST}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (cancelled) return;
        const parsed = parseTleBlock(text);
        // only keep satellites in the config list
        const wanted = new Set(SAT_CONFIG.map((c) => c.catnr));
        const kept = parsed.filter((s) => wanted.has(s.catnr));
        setSats(kept);
        setOrbits(
          Object.fromEntries(
            kept.map((s) => [s.catnr, buildGroundTrack(s.satrec)])
          )
        );
      } catch {
        if (!cancelled) setLoadError(true);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      setPositions(
        sats.map((s) => {
          const p = positionAt(s.satrec, now);
          const cfg = SAT_CONFIG.find((c) => c.catnr === s.catnr);
          return {
            catnr: s.catnr,
            lat: p.latDeg,
            lon: p.lonDeg,
            altKm: p.altKm,
            velocityKms: p.velocityKms,
            color: cfg?.color,
          };
        })
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [sats]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setObserver(FALLBACK_OBSERVER);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setObserver({ lat: pos.coords.latitude, lon: pos.coords.longitude, heightM: 0 }),
      () => setObserver(FALLBACK_OBSERVER)
    );
  }, []);

  useEffect(() => {
    if (selectedCatnr === null || observer === null) {
      setPasses(null);
      return;
    }
    const sat = sats.find((s) => s.catnr === selectedCatnr);
    if (!sat) {
      setPasses(null);
      return;
    }
    setPasses(nextPasses(sat.satrec, observer, 48));
  }, [selectedCatnr, observer, sats]);

  const selected = sats.find((s) => s.catnr === selectedCatnr) ?? null;

  return (
    <div className="app">
      <MapView
        positions={positions}
        orbits={orbits}
        observer={observer ? { lat: observer.lat, lon: observer.lon } : null}
        onSelect={setSelectedCatnr}
        onSetObserver={(lat, lon) => setObserver({ lat, lon, heightM: 0 })}
      />
      <div className="controls">
        <button onClick={() => window.location.reload()}>Reload TLEs</button>
      </div>
      {selected && observer && (
        <div className="panel">
          <h2>{selected.name}</h2>
          <div className="row"><span>Category</span><span>{SAT_CONFIG.find((c) => c.catnr === selected.catnr)?.category}</span></div>
          <div className="row"><span>NORAD id</span><span>{selected.catnr}</span></div>
          <div className="row"><span>Latitude</span><span>{positions.find((p) => p.catnr === selected.catnr)?.lat.toFixed(2)}°</span></div>
          <div className="row"><span>Longitude</span><span>{positions.find((p) => p.catnr === selected.catnr)?.lon.toFixed(2)}°</span></div>
          <div className="row"><span>Altitude</span><span>{positions.find((p) => p.catnr === selected.catnr)?.altKm.toFixed(0)} km</span></div>
          <div className="row"><span>Speed</span><span>{positions.find((p) => p.catnr === selected.catnr)?.velocityKms.toFixed(2)} km/s</span></div>
          <div className="row"><span>Period</span><span>{Math.round(selected.periodS / 60)} min</span></div>
          <div className="row"><span>Inclination</span><span>{selected.inclinationDeg.toFixed(1)}°</span></div>
          <div className="row"><span>Next passes (48h)</span><span>{passes ? passes.length : "…"}</span></div>
          <button onClick={() => setSelectedCatnr(null)}>Close</button>
        </div>
      )}
      {selected && observer && passes && passes.length > 0 && (
        <div className="panel pass-list" style={{ top: "320px" }}>
          <h2>Next passes</h2>
          {passes.map((p, i) => (
            <div key={i} className="row">
              <span>{p.start.toLocaleTimeString()}</span>
              <span>{p.maxElevationDeg.toFixed(0)}°</span>
            </div>
          ))}
        </div>
      )}
      {observer && (
        <div className="observer-label">
          Observer: {observer.lat.toFixed(2)}, {observer.lon.toFixed(2)} — click map to change
        </div>
      )}
      {loadError && <div className="banner">TLE provider unreachable</div>}
      {!loadError && (
        <div className="banner" style={{ background: "#111827" }}>
          {sats.length}/{configCount} satellites loaded
        </div>
      )}
    </div>
  );
}
```

NOTE: `positions` uses `SatDot` with an optional `color` — extend the SatDot interface in MapView.tsx (`color?: string`). The velocity display requires `velocityKms` on SatDot too — extend: `velocityKms?: number`. The mapview tests construct SatDot without these (optional fields, fine).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w sat-client`
Expected: PASS — 13 tests (6 sat + 4 mapview + 3 app). Fix string mismatches between test and implementation if any (e.g., the "N/M satellites loaded" and observer label texts).

- [ ] **Step 5: Typecheck + full build**

Run: `npm run build -w sat-client` — clean.

- [ ] **Step 6: Commit**

```bash
git add sat-client/src/App.tsx sat-client/src/MapView.tsx sat-client/tests/app.test.tsx
git commit -m "feat: add satellite tracker app with animation, geolocation and passes"
```

---

### Task 6: Integration pass

**Files:**
- None (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: server 35 + flight client 16 + sat client 13 = 64 tests, all passing.

- [ ] **Step 2: Typecheck + builds**

Run: `npx tsc --noEmit -p server`, `npm run build -w client`, `npm run build -w sat-client` — all clean.

- [ ] **Step 3: Manual API pass**

Run `npm run dev:sat` (server :3001 + sat-client :5174 — Vite picks the next free port), then:

```
curl "http://localhost:3001/api/tle?catnr=25544,48274,20580,43435,28654,33591,41866" | head -8
```

Expected: 7 TLE blocks with names ISS (ZARYA), Tiangong, Hubble, TESS, NOAA-18/19, GOES-16.

- [ ] **Step 4: Visual pass (delegated to visual-inspector subagent)**

Start `npm run dev:sat`, open the sat client URL, and verify: colored dots move smoothly (two screenshots ~5s apart show different dot positions); orbit lines visible per satellite; clicking a satellite opens the details panel with name/category/altitude/speed/period/inclination; clicking empty map sets the observer marker + shows the observer label and pass predictions; the "N/M satellites loaded" banner shows the full configured count (or close to it); no console errors. Screenshot each step.

- [ ] **Step 5: Commit (only if the pass surfaced changes; otherwise skip)**

```bash
git add .
git commit -m "fix: satellite tracker integration fixes"
```
