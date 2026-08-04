# Satellite Tracker v1.2 — Visibility Indicator + Follow Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Visible now" indicator (sunlit + dark-at-observer + above-horizon) to the details panel, and a Follow toggle that keeps the map centered on the selected satellite.

**Architecture:** Two new pure modules (`sun.ts`, `visibility.ts`) + an extracted shared elevation helper in `passes.ts`; MapView gains a `followCatnr` prop with an `easeTo` effect; App gains follow state + panel rows.

**Tech Stack:** React, MapLibre GL, satellite.js, vitest.

**Spec:** `docs/superpowers/specs/2026-08-04-satellite-visibility-follow-design.md`

---

### Task 1: sun.ts + visibility.ts + shared elevation helper (TDD)

**Files:**
- Create: `sat-client/src/sat/sun.ts`
- Create: `sat-client/src/sat/visibility.ts`
- Modify: `sat-client/src/sat/passes.ts`
- Modify: `sat-client/tests/sat.test.ts`
- Create: `sat-client/tests/sun-visibility.test.ts`

- [ ] **Step 1: Write the failing tests — `sat-client/tests/sun-visibility.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { subsolarPoint, solarElevationDeg } from "../src/sat/sun";
import { isSunlit, darkAtObserver, satelliteVisible } from "../src/sat/visibility";
import { parseTleBlock } from "../src/sat/tle";

const ISS_LINE1 = "1 25544U 98067A   14020.93268519  .00009878  00000-0  18200-3 0  5082";
const ISS_LINE2 = "2 25544  51.6498 109.4756 0003572  55.9686 274.4705 15.49815350830473";
const ISS_BLOCK = `ISS (ZARYA)\n${ISS_LINE1}\n${ISS_LINE2}\n`;
```

IMPORTANT: this is the stale 2014 fixture that fails SGP4 in 2026 (discovered in earlier tasks). Use the CURRENT ISS TLE from CelesTrak instead — fetch `https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle` at implementation time and embed the returned lines (name line "ISS (ZARYA)" + the two element lines) as the fixture. The implementation-time sun/visibility CASE SCANNING (below) must be done with this same fixture TLE so the pinned dates are consistent.

```typescript
describe("subsolarPoint", () => {
  it("is near the equator at the March equinox", () => {
    const p = subsolarPoint(new Date(Date.UTC(2026, 2, 20, 12, 0, 0))); // 2026-03-20 12:00 UTC
    expect(Math.abs(p.latDeg)).toBeLessThan(1);
  });

  it("moves west over time (sun tracks across the sky)", () => {
    const t0 = new Date(Date.UTC(2026, 2, 20, 12, 0, 0));
    const t1 = new Date(Date.UTC(2026, 2, 20, 15, 0, 0)); // 3h later
    const p0 = subsolarPoint(t0);
    const p1 = subsolarPoint(t1);
    const d = ((p1.lonDeg - p0.lonDeg + 540) % 360) - 180; // signed delta
    expect(d).toBeLessThan(-30); // moved >30° west in 3h
  });
});

describe("solarElevationDeg", () => {
  it("is near +90 at the subsolar point and near -90 at the antipode", () => {
    const date = new Date(Date.UTC(2026, 2, 20, 12, 0, 0));
    const sub = subsolarPoint(date);
    expect(solarElevationDeg(date, sub.latDeg, sub.lonDeg)).toBeGreaterThan(85);
    expect(solarElevationDeg(date, -sub.latDeg, ((sub.lonDeg + 180) % 360) - 180)).toBeLessThan(-85);
  });

  it("is negative at night and positive at noon (Paris)", () => {
    const date = new Date(Date.UTC(2026, 7, 4, 0, 0, 0)); // local midnight-ish UTC
    expect(solarElevationDeg(date, 48.8566, 2.3522)).toBeLessThan(-5);
    const noon = new Date(Date.UTC(2026, 7, 4, 12, 0, 0));
    expect(solarElevationDeg(noon, 48.8566, 2.3522)).toBeGreaterThan(10);
  });
});

describe("visibility", () => {
  // CASE SCANNING (implementation time, with the CURRENT ISS fixture):
  // scan the fixture TLE over a 24h window starting 2026-08-05T00:00:00Z in 60s steps,
  // for an observer at Paris (48.8566, 2.3522), and record:
  //  - caseVisible: a timestamp where elevation > 0 AND darkAtObserver AND isSunlit
  //  - caseDaylight: a timestamp where elevation > 0 AND solarElevationDeg(observer) > 10 (daylight)
  //  - caseShadow: a timestamp where isSunlit === false (ISS in Earth's shadow)
  //  - caseBelowHorizon: a timestamp where elevation < 0 (plenty exist)
  // Pin the four found timestamps below as ISO strings.

  const OBSERVER = { lat: 48.8566, lon: 2.3522, heightM: 0 };

  it("reports visible for a night-time sunlit pass", () => {
    const [iss] = parseTleBlock(ISS_BLOCK);
    const result = satelliteVisible(iss.satrec, OBSERVER, new Date("2026-08-05T<caseVisible>Z"));
    expect(result).toEqual({ visible: true, reason: "visible" });
  });

  it("reports daylight when the sun is up at the observer", () => {
    const [iss] = parseTleBlock(ISS_BLOCK);
    const result = satelliteVisible(iss.satrec, OBSERVER, new Date("2026-08-05T<caseDaylight>Z"));
    expect(result.reason).toBe("daylight");
  });

  it("reports in-shadow when the satellite is in Earth's shadow", () => {
    const [iss] = parseTleBlock(ISS_BLOCK);
    const result = satelliteVisible(iss.satrec, OBSERVER, new Date("2026-08-05T<caseShadow>Z"));
    expect(result.reason).toBe("in-shadow");
  });

  it("reports below-horizon when the satellite is on the far side", () => {
    const [iss] = parseTleBlock(ISS_BLOCK);
    const result = satelliteVisible(iss.satrec, OBSERVER, new Date("2026-08-05T<caseBelowHorizon>Z"));
    expect(result.reason).toBe("below-horizon");
  });

  it("darkAtObserver uses the nautical-darkness threshold", () => {
    expect(darkAtObserver(new Date("2026-08-05T00:00:00Z"), 48.8566, 2.3522)).toBe(true);
  });
});
```

NOTE: if a pinned case timestamp is sensitive to the exact second (e.g., the shadow boundary), allow tolerance by choosing timestamps mid-window (e.g., the middle of a shadow run, not the edge). If the 24h scan can't find a case (unlikely), extend the window to 48h and note it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w sat-client`
Expected: FAIL — cannot find modules sun/visibility. (Pinned timestamps are placeholders — replace them during Step 1's scanning; tests then fail only on missing modules.)

- [ ] **Step 3: Write `sat-client/src/sat/sun.ts`**

```typescript
import { gstime } from "satellite.js";

const DEG = 180 / Math.PI;

function julianCentury(date: Date): number {
  const msPerDay = 86_400_000;
  const j2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
  return (date.getTime() - j2000) / msPerDay / 36525;
}

export function subsolarPoint(date: Date): { latDeg: number; lonDeg: number } {
  const n = julianCentury(date);
  const L = (280.460 + 36000.771 * n) % 360;              // mean longitude
  const g = ((357.528 + 35999.050 * n) % 360) * (Math.PI / 180); // mean anomaly
  const eclipticLon = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * (Math.PI / 180);
  const obliquity = (23.439 - 0.0000004 * n) * (Math.PI / 180);
  const ra = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLon), Math.cos(eclipticLon));
  const dec = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLon));
  const gmst = gstime(date); // radians
  let lonDeg = (ra - gmst) * DEG;
  lonDeg = ((lonDeg + 540) % 360) - 180;
  return { latDeg: dec * DEG, lonDeg };
}

export function solarElevationDeg(date: Date, latDeg: number, lonDeg: number): number {
  const n = julianCentury(date);
  const L = (280.460 + 36000.771 * n) % 360;
  const g = ((357.528 + 35999.050 * n) % 360) * (Math.PI / 180);
  const eclipticLon = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * (Math.PI / 180);
  const obliquity = (23.439 - 0.0000004 * n) * (Math.PI / 180);
  const dec = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLon));
  const ra = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLon), Math.cos(eclipticLon));
  const gmst = gstime(date);
  const hourAngle = gmst + lonDeg / DEG - ra;
  const sinElev = Math.sin(latDeg / DEG) * Math.sin(dec) + Math.cos(latDeg / DEG) * Math.cos(dec) * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sinElev))) * DEG;
}
```

- [ ] **Step 4: Write `sat-client/src/sat/visibility.ts`**

```typescript
import type { SatRec } from "satellite.js";
import { propagate } from "satellite.js";
import { solarElevationDeg, subsolarPoint } from "./sun";
import { elevationDegAt, type ObserverPoint } from "./passes";

const R_EARTH_KM = 6371;
export const NAUTICAL_DARKNESS_DEG = -6;

export function isSunlit(satrec: SatRec, date: Date): boolean {
  const sun = subsolarPoint(date);
  const sunDir = {
    x: Math.cos((sun.latDeg * Math.PI) / 180) * Math.cos((sun.lonDeg * Math.PI) / 180),
    y: Math.cos((sun.latDeg * Math.PI) / 180) * Math.sin((sun.lonDeg * Math.PI) / 180),
    z: Math.sin((sun.latDeg * Math.PI) / 180),
  };
  const pv = propagate(satrec, date);
  const sat = pv.position;
  const along = sat.x * sunDir.x + sat.y * sunDir.y + sat.z * sunDir.z;
  const perpSq = (sat.x - sunDir.x * along) ** 2 + (sat.y - sunDir.y * along) ** 2 + (sat.z - sunDir.z * along) ** 2;
  return !(along < 0 && perpSq < R_EARTH_KM ** 2);
}

export function darkAtObserver(date: Date, latDeg: number, lonDeg: number): boolean {
  return solarElevationDeg(date, latDeg, lonDeg) < NAUTICAL_DARKNESS_DEG;
}

export type VisibilityReason = "visible" | "in-shadow" | "daylight" | "below-horizon";

export function satelliteVisible(
  satrec: SatRec,
  observer: ObserverPoint,
  date: Date
): { visible: boolean; reason: VisibilityReason } {
  if (elevationDegAt(satrec, observer, date) <= 0) return { visible: false, reason: "below-horizon" };
  if (!darkAtObserver(date, observer.lat, observer.lon)) return { visible: false, reason: "daylight" };
  if (!isSunlit(satrec, date)) return { visible: false, reason: "in-shadow" };
  return { visible: true, reason: "visible" };
}
```

IMPORTANT about `sunDir` from subsolar point: the subsolar lat/lon gives the sun's direction in an ECF frame, but `sat` from `propagate` is ECI. The ECI↔ECF difference (Earth rotation) is small for the shadow test's purpose but strictly wrong. Two options: (a) accept the approximation (the sun is far; Earth-rotation misalignment of the sun direction by the observer's GMST — the error is a few degrees of shadow boundary shift; acceptable for a "visible now" indicator), or (b) convert: build the sun unit vector in ECI using RA/dec directly (RA is measured in the ECI frame already — no GMST needed): x = cos(dec)cos(RA), y = cos(dec)sin(RA), z = sin(dec). Prefer (b) — it's exact and simpler: export `sunDirectionECI(date): { x, y, z }` from sun.ts (reusing the internal RA/dec computation, with a private shared `solarPosition(date)` helper returning { ra, dec }) and use it in isSunlit. Implement sun.ts with a shared private `solarRaDec(date)` and export both `subsolarPoint` (for tests/display) and `sunDirectionECI` (for the shadow test).

- [ ] **Step 5: Modify `sat-client/src/sat/passes.ts`** — extract the elevation helper:

Add exported function at the top of the file (refactor `nextPasses` to use it):

```typescript
export function elevationDegAt(satrec: SatRec, observer: ObserverPoint, date: Date): number {
  const observerEcf = geodeticToEcf({
    longitude: (observer.lon * Math.PI) / 180,
    latitude: (observer.lat * Math.PI) / 180,
    height: observer.heightM / 1000,
  });
  const pv = propagate(satrec, date);
  const look = ecfToLookAngles(observerEcf, eciToEcf(pv.position, gstime(date)));
  return (look.elevation * 180) / Math.PI;
}
```

(imports needed: gstime, eciToEcf — check current imports; `nextPasses` keeps its own observerEcf building — either reuse the helper in its loop or leave it; prefer refactoring the loop to call `elevationDegAt` per sample IF the types allow it cheaply; otherwise leave the loop as-is and only add the helper. Keep the change minimal and green.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -w sat-client`
Expected: PASS — existing 17 + 7 new sun/visibility tests = 24 (sat.test.ts unchanged at 7 with smoke = ... count precisely: previous 17 = sat 6 + smoke 1 + mapview 4 + app 5? No — verify: after Task 1 of v1.1 the count was 17 (mapview 5, app 5, sat 6, smoke 1). New file adds 7 tests → 24. Report actual.)

Typecheck: `npm run build -w sat-client` clean.

- [ ] **Step 7: Commit**

```bash
git add sat-client/src/sat/sun.ts sat-client/src/sat/visibility.ts sat-client/src/sat/passes.ts sat-client/tests/sun-visibility.test.ts
git commit -m "feat: add solar position and satellite visibility modules"
```

---

### Task 2: Panel Visible-now row + Follow mode (TDD)

**Files:**
- Modify: `sat-client/src/App.tsx`
- Modify: `sat-client/src/MapView.tsx`
- Modify: `sat-client/tests/mapview.test.tsx`
- Modify: `sat-client/tests/app.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `sat-client/tests/mapview.test.tsx`:

```tsx
it("follows the selected satellite with easeTo when followCatnr is set", () => {
  const { rerender } = render(<MapView {...props} />);
  act(() => { loadHandler!(); });
  rerender(
    <MapView
      {...props}
      positions={[{ catnr: 25544, lat: 45, lon: 2, altKm: 420 }]}
      followCatnr={25544}
    />
  );
  expect(easeToMock).toHaveBeenCalledWith(expect.objectContaining({ center: [2, 45], duration: 500 }));
});

it("does not follow when followCatnr is null", () => {
  const { rerender } = render(<MapView {...props} />);
  act(() => { loadHandler!(); });
  rerender(
    <MapView {...props} positions={[{ catnr: 25544, lat: 45, lon: 2, altKm: 420 }]} followCatnr={null} />
  );
  expect(easeToMock).not.toHaveBeenCalled();
});
```

(mock gains `const easeToMock = vi.fn();` + `easeTo(...a) { easeToMock(...a); }` in both mock classes + clear in beforeEach; check the existing follow... the mapview tests already use act/loadHandler patterns — follow them.)

Append to `sat-client/tests/app.test.tsx`:

```tsx
it("shows Visible now and a Follow toggle in the panel", async () => {
  render(<App />);
  await act(async () => {});
  await act(async () => { vi.advanceTimersByTime(1000); });
  capturedClick!({ point: { x: 0, y: 0 } });
  await act(async () => {});
  expect(screen.getByText(/Visible now/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /follow/i })).toBeInTheDocument();
});

it("toggles follow mode on and clears it on close", async () => {
  render(<App />);
  await act(async () => {});
  await act(async () => { vi.advanceTimersByTime(1000); });
  capturedClick!({ point: { x: 0, y: 0 } });
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: /follow/i }));
  // followCatnr set — the MapView prop carries it; assert via the panel button label change ("Follow" -> "Following")
  expect(screen.getByRole("button", { name: /following/i })).toBeInTheDocument();
  fireEvent.click(screen.getByText("Close"));
  expect(screen.queryByRole("button", { name: /following/i })).not.toBeInTheDocument();
});
```

(`fireEvent` may need importing in app.test.tsx — check.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w sat-client`
Expected: FAIL — no Visible now row, no Follow button, no easeTo. Existing tests still pass.

- [ ] **Step 3: Implement in `sat-client/src/MapView.tsx`**

1. `MapViewProps` gains `followCatnr: number | null;`
2. New effect (after the observer effect):

```tsx
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded || followCatnr === null) return;
    const target = positions.find((p) => p.catnr === followCatnr);
    if (!target) return;
    map.easeTo({ center: [target.lon, target.lat], duration: 500, essential: true });
  }, [positions, followCatnr, styleLoaded]);
```

3. Existing mapview tests construct props without followCatnr — since the prop is required, update the shared `props` object in mapview.test.tsx to include `followCatnr: null`.

- [ ] **Step 4: Implement in `sat-client/src/App.tsx`**

1. State: `const [followCatnr, setFollowCatnr] = useState<number | null>(null);`
2. Selection effect: on `!selected`, also `setFollowCatnr(null)` (in the existing `if (!selected)` branch of the passes effect, or a dedicated effect — add to the passes effect's `!selected` branch).
3. MapView call gains `followCatnr={followCatnr}`.
4. Visible-now computation in the panel — inside the component body (before return), only when a satellite is selected:

```tsx
  const visibility = useMemo(() => {
    if (!selected || !observer) return null;
    return satelliteVisible(selected.satrec, observer, new Date());
  }, [selected, observer]);
```

Hmm — this recomputes only on selection/observer change; the sun/visibility state changes continuously. Since the panel re-renders every tick anyway (positions state changes), compute it inline without useMemo:

```tsx
  const visibility = selected && observer ? satelliteVisible(selected.satrec, observer, new Date()) : null;
```

(imports: `satelliteVisible` from "./sat/visibility".)

5. Panel rows — add after "Next passes (48h)":

```tsx
          <div className="row"><span>Visible now</span><span>{visibility ? (visibility.visible ? "Yes" : `No — ${visibility.reason}`) : "…"}</span></div>
```

6. Follow button — after the Close button:

```tsx
          <button onClick={() => setFollowCatnr(followCatnr === selected.catnr ? null : selected.catnr)}>
            {followCatnr === selected.catnr ? "Following" : "Follow"}
          </button>
```

(Keep Close button as-is.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w sat-client`
Expected: PASS — 24 + 4 new = 28 (report actual). Typecheck: `npm run build -w sat-client` clean. Full `npm test` — server 36 + client 16 + sat-client N.

- [ ] **Step 6: Commit**

```bash
git add sat-client/src/App.tsx sat-client/src/MapView.tsx sat-client/tests/mapview.test.tsx sat-client/tests/app.test.tsx
git commit -m "feat: add visible-now indicator and follow mode"
```

---

### Task 3: Integration + visual verification

**Files:**
- None (verification only)

- [ ] **Step 1: Full suite + builds**

Run: `npm test` — all green. `npm run build -w sat-client` clean.

- [ ] **Step 2: Visual pass (visual-inspector subagent)**

App should be running (:5173 via launchctl watch). Verify: select a satellite → panel shows "Visible now: Yes" (at night over your location — headless observer is Paris; run at any time — a daylight case shows "No — daylight" which is also correct) with the reason readable; Follow button toggles "Follow" ↔ "Following"; with Follow on, the map re-centers and the satellite stays near the center across ~10s of animation (two screenshots); toggling off stops it; Close clears follow. Screenshot each step. Report console errors.
