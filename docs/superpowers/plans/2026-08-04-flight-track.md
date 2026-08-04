# Flight Track on Click Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the actual flown trajectory of a clicked aircraft as a dashed line on the map, refreshed every 60s while its details panel stays open.

**Architecture:** Server gains `GET /api/track?icao24=` — a 120s-TTL-cached proxy call to OpenSky `/tracks/{icao24}?time=now` behind a `TrackSource` capability seam. Client fetches on selection, renders a MapLibre line layer, refreshes on a 60s interval, clears on close/change/region-switch.

**Tech Stack:** TypeScript, Express, OpenSky Tracks API, React, MapLibre GL, vitest, supertest.

**Spec:** `docs/superpowers/specs/2026-08-04-flight-track-track-design.md`

---

### Task 1: Track types + TrackSource seam + OpenSky fetchTrack

**Files:**
- Modify: `server/src/types.ts`
- Modify: `server/src/providers/flight-provider.ts`
- Modify: `server/src/providers/opensky.ts`
- Modify: `server/tests/opensky.test.ts`

- [ ] **Step 1: Add track types to `server/src/types.ts`**

Append to the file:

```typescript
export interface TrackPoint {
  t: number;
  lat: number;
  lon: number;
  altBaro: number | null;
}

export interface FlightTrack {
  icao24: string;
  callsign: string | null;
  points: TrackPoint[];
}

export interface TrackResponse {
  track: FlightTrack | null;
  stale: boolean;
  rateLimited: boolean;
}
```

- [ ] **Step 2: Add the `TrackSource` capability to `server/src/providers/flight-provider.ts`**

Full replacement:

```typescript
import type { Bbox } from "../bbox";
import type { FlightState, FlightTrack } from "../types";

export interface FlightProvider {
  name: string;
  fetchStates(bbox: Bbox): Promise<FlightState[]>;
}

export interface TrackSource {
  fetchTrack(icao24: string, now: number): Promise<FlightTrack | null>;
}
```

- [ ] **Step 3: Write the failing tests — append to `server/tests/opensky.test.ts`**

```typescript
describe("OpenSkyProvider.fetchTrack", () => {
  const trackBody = {
    icao24: "a1b2c3",
    callsign: "UAL123 ",
    startTime: 1754300000,
    endTime: 1754303600,
    path: [
      [1754300000, 35.1, -95.0, 10000, 90.0, false],
      [1754300060, 35.2, -95.1, 10100, 91.0, false],
    ],
  };

  it("maps the track path to FlightTrack and trims the callsign", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => trackBody })
    );
    const provider = new OpenSkyProvider({ baseUrl: "https://opensky-network.org/api" });
    const track = await provider.fetchTrack("a1b2c3", 1754303600);
    expect(track).not.toBeNull();
    expect(track?.callsign).toBe("UAL123");
    expect(track?.points).toHaveLength(2);
    expect(track?.points[0]).toEqual({ t: 1754300000, lat: 35.1, lon: -95.0, altBaro: 10000 });
    expect(track?.points[1].lat).toBe(35.2);
  });

  it("returns null on 404 (no track for aircraft)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
    );
    const provider = new OpenSkyProvider({ baseUrl: "https://opensky-network.org/api" });
    expect(await provider.fetchTrack("a1b2c3", 1754303600)).toBeNull();
  });

  it("throws with status on other non-ok responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) })
    );
    const provider = new OpenSkyProvider({ baseUrl: "https://opensky-network.org/api" });
    await expect(provider.fetchTrack("a1b2c3", 1754303600)).rejects.toThrow("429");
  });

  it("requests the track endpoint with the current time", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => trackBody })
    );
    const provider = new OpenSkyProvider({ baseUrl: "https://opensky-network.org/api" });
    await provider.fetchTrack("a1b2c3", 1754303600);
    const url = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(url).toContain("/tracks/a1b2c3");
    expect(url).toContain("time=1754303600");
  });
});
```

- [ ] **Step 4: Run tests to verify the new ones fail**

Run: `npm run test -w server`
Expected: FAIL — `fetchTrack is not a function` / type errors (TrackSource not implemented). Existing 23 tests still pass.

- [ ] **Step 5: Implement `fetchTrack` on `server/src/providers/opensky.ts`**

Add `implements TrackSource` (import type `TrackSource` and `FlightTrack`), and append the method to the class:

```typescript
  async fetchTrack(icao24: string, now: number): Promise<FlightTrack | null> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.tokenManager) {
      headers.Authorization = `Bearer ${await this.tokenManager.getToken()}`;
    }
    const res = await fetch(`${this.opts.baseUrl}/tracks/${icao24}?time=${now}`, { headers });
    if (res.status === 404) return null;
    if (!res.ok) {
      const error = new Error(`OpenSky responded ${res.status}`) as Error & {
        status?: number;
        retryAfter?: string | null;
      };
      error.status = res.status;
      error.retryAfter = res.headers.get("X-Rate-Limit-Retry-After-Seconds");
      throw error;
    }
    const body = (await res.json()) as {
      icao24: string;
      callsign: string | null;
      path: unknown[];
    };
    const points = body.path
      .filter((p) => Array.isArray(p))
      .map((p) => p as (number | boolean | null)[])
      .filter((p) => p.length >= 4)
      .map((p) => ({
        t: Number(p[0]),
        lat: Number(p[1]),
        lon: Number(p[2]),
        altBaro: typeof p[3] === "number" ? p[3] : null,
      }));
    return {
      icao24: body.icao24,
      callsign: body.callsign ? body.callsign.trim() : null,
      points,
    };
  }
```

Update the class declaration to `export class OpenSkyProvider implements FlightProvider, TrackSource`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -w server`
Expected: PASS — 27 tests (23 + 4 new). Typecheck: `npx tsc --noEmit -p server` clean.

- [ ] **Step 7: Commit**

```bash
git add server/src/types.ts server/src/providers/flight-provider.ts server/src/providers/opensky.ts server/tests/opensky.test.ts
git commit -m "feat: add OpenSky track fetching behind TrackSource seam"
```

---

### Task 2: /api/track endpoint with TTL cache

**Files:**
- Modify: `server/src/app.ts`
- Modify: `server/src/index.ts`
- Modify: `server/tests/index.test.ts`

- [ ] **Step 1: Write the failing tests — append to `server/tests/index.test.ts`**

```typescript
import type { FlightProvider, TrackSource } from "../src/providers/flight-provider";
import type { FlightTrack } from "../src/types";

const trackSourceProvider: FlightProvider & TrackSource = {
  name: "mock-track",
  fetchStates: async () => [],
  fetchTrack: async () => ({
    icao24: "a1b2c3",
    callsign: "UAL123",
    points: [
      { t: 1754300000, lat: 35.1, lon: -95.0, altBaro: 10000 },
      { t: 1754300060, lat: 35.2, lon: -95.1, altBaro: 10100 },
    ],
  }),
};

describe("GET /api/track", () => {
  it("returns 400 for an invalid icao24", async () => {
    const app = createApp({ provider: trackSourceProvider });
    const res = await request(app).get("/api/track?icao24=zzzzzz");
    expect(res.status).toBe(400);
  });

  it("returns the track and caches per icao24 within TTL", async () => {
    const fetchTrack = vi.fn(async () => ({
      icao24: "a1b2c3",
      callsign: "UAL123",
      points: [{ t: 1, lat: 1, lon: 1, altBaro: null }],
    }));
    const provider = { name: "mock-track", fetchStates: async () => [], fetchTrack } as FlightProvider & TrackSource;
    const app = createApp({ provider });
    const res1 = await request(app).get("/api/track?icao24=a1b2c3");
    expect(res1.status).toBe(200);
    expect(res1.body.track?.callsign).toBe("UAL123");
    expect(res1.body.rateLimited).toBe(false);
    const res2 = await request(app).get("/api/track?icao24=a1b2c3");
    expect(res2.status).toBe(200);
    expect(fetchTrack).toHaveBeenCalledTimes(1);
  });

  it("reports rateLimited on 429, cold cache returns track null", async () => {
    const failing = async () => {
      const e = new Error("429") as Error & { status?: number };
      e.status = 429;
      throw e;
    };
    const provider = { name: "mock-track", fetchStates: async () => [], fetchTrack: failing } as FlightProvider & TrackSource;
    const app = createApp({ provider });
    const res = await request(app).get("/api/track?icao24=a1b2c3");
    expect(res.status).toBe(200);
    expect(res.body.track).toBeNull();
    expect(res.body.rateLimited).toBe(true);
  });

  it("serves the cached track with rateLimited on 429 when warm", async () => {
    let shouldFail = false;
    const fetchTrack = vi.fn(async () => {
      if (shouldFail) {
        const e = new Error("429") as Error & { status?: number };
        e.status = 429;
        throw e;
      }
      return { icao24: "a1b2c3", callsign: "UAL123", points: [{ t: 1, lat: 1, lon: 1, altBaro: null }] };
    });
    const provider = { name: "mock-track", fetchStates: async () => [], fetchTrack } as FlightProvider & TrackSource;
    const app = createApp({ provider });
    await request(app).get("/api/track?icao24=a1b2c3");
    shouldFail = true;
    const res = await request(app).get("/api/track?icao24=a1b2c3");
    expect(res.body.track?.callsign).toBe("UAL123");
    expect(res.body.rateLimited).toBe(true);
  });

  it("returns 501 when the provider does not support tracks", async () => {
    const plain: FlightProvider = { name: "mock-plain", fetchStates: async () => [] };
    const app = createApp({ provider: plain });
    const res = await request(app).get("/api/track?icao24=a1b2c3");
    expect(res.status).toBe(501);
  });
});
```

Note: the 429-warm test relies on the cache still holding the first result — the test app must have a track cache TTL longer than the test duration (default 120s is fine). The cold-429 test uses a fresh app instance so no cache exists.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm run test -w server`
Expected: FAIL — `/api/track` returns 404 (route missing). Existing 27 pass.

- [ ] **Step 3: Implement the endpoint in `server/src/app.ts`**

Update the `createApp` signature and add the route. Current signature: `createApp({ provider?, cacheTtlMs? })`. New:

```typescript
export interface CreateAppDeps {
  provider?: FlightProvider;
  cacheTtlMs?: number;
  trackCacheTtlMs?: number;
}

export function createApp({ provider, cacheTtlMs, trackCacheTtlMs }: CreateAppDeps = {}) {
```

Inside createApp, after the existing `lastGood` map:

```typescript
  const trackCache = new TtlCache<FlightTrack>(trackCacheTtlMs ?? TRACK_CACHE_TTL_MS);
```

And before the listen/export lines, add the route (keep the existing `/api/flights` handler untouched):

```typescript
  const trackSource = PROVIDER as FlightProvider & Partial<TrackSource>;

  app.get("/api/track", async (req, res) => {
    const icao24 = String(req.query.icao24 ?? "").toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(icao24)) {
      res.status(400).json({ error: "invalid icao24" });
      return;
    }
    const fetchTrack = trackSource.fetchTrack;
    if (typeof fetchTrack !== "function") {
      res.status(501).json({ error: `track not supported by provider ${PROVIDER.name}` });
      return;
    }

    let rateLimited = false;
    try {
      const track = await trackCache.getOrLoad(icao24, () =>
        fetchTrack(icao24, Math.floor(Date.now() / 1000))
      );
      const body: TrackResponse = { track, stale: false, rateLimited };
      res.json(body);
    } catch (err) {
      if ((err as { status?: number }).status === 429) rateLimited = true;
      const cached = trackCache.get(icao24);
      if (cached !== undefined || rateLimited) {
        const body: TrackResponse = { track: cached ?? null, stale: false, rateLimited };
        res.json(body);
      } else {
        res.status(502).json({ error: "provider unreachable", rateLimited });
      }
    }
  });
```

Constants to add at module scope (near the existing CACHE_TTL_MS default):

```typescript
const TRACK_CACHE_TTL_MS = 120_000;
```

Imports to add: `import type { TrackResponse, FlightTrack } from "./types";` and `import type { TrackSource } from "./providers/flight-provider";` (the FlightProvider import already exists — extend it).

Semantics note: `stale` is always false in track responses — a 429 serve is "rate limited", not stale; a successful serve is fresh by definition.

- [ ] **Step 4: Update `server/src/index.ts` to pass the env var**

Current boot call passes `cacheTtlMs: Number(process.env.CACHE_TTL_MS ?? 15_000)`. Add alongside it:

```typescript
      trackCacheTtlMs: Number(process.env.TRACK_CACHE_TTL_MS ?? 120_000),
```

(The app.ts default `TRACK_CACHE_TTL_MS = 120_000` covers tests; index.ts supplies the env override, matching the existing CACHE_TTL_MS pattern.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -w server`
Expected: PASS — 32 tests (27 + 5 new). Typecheck: `npx tsc --noEmit -p server` clean.

- [ ] **Step 6: Smoke test the real endpoint**

Run `npm run start -w server` in background, then:

```
curl "http://localhost:3001/api/track?icao24=3c675a"  # pick any hex; may be null if no current track
curl "http://localhost:3001/api/track?icao24=zzzz"    # expect 400
```

If the first returns `{"track":null,...}` or a track with points — either is acceptable (different aircraft have different coverage). Kill the server after. Record what you got.

- [ ] **Step 7: Commit**

```bash
git add server/src/app.ts server/src/index.ts server/tests/index.test.ts
git commit -m "feat: add cached /api/track endpoint with rate-limit handling"
```

---

### Task 3: Client — track line layer in MapView

**Files:**
- Modify: `client/src/MapView.tsx`
- Modify: `client/tests/mapview.test.tsx`

- [ ] **Step 1: Write the failing tests — append to `client/tests/mapview.test.tsx`**

Extend the module-scope mock state (the existing mock uses `loadHandler`, `capturedClickHandler`, `addSourceMock`, `addLayerMock` from the style-load fix — check current file and extend it):

```tsx
let removeLayerMock: ReturnType<typeof vi.fn>;
```

In the `vi.mock` factory's class, add:

```tsx
    removeLayer() {
      if (!loadHandler) throw new Error("Style is not done loading");
      removeLayerMock();
    }
    getLayer() {
      return undefined;
    }
```

(If the current mock structure differs — e.g. plain methods instead of mocks — adapt: the key requirement is `removeLayer` and `getLayer` exist and `removeLayerMock` is callable/assertable.)

New tests:

```tsx
const sampleTrack = {
  icao24: "a1b2c3",
  callsign: "UAL123",
  points: [
    { t: 1, lat: 35.1, lon: -95.0, altBaro: 10000 },
    { t: 2, lat: 35.2, lon: -95.1, altBaro: 10100 },
  ],
};

it("adds a track line layer when a track is provided", () => {
  render(
    <MapView bounds={[-10, 35, 30, 60]} flights={[]} track={sampleTrack} onSelect={() => {}} />
  );
  loadHandler!();
  expect(addSourceMock).toHaveBeenCalledWith(
    "track-source",
    expect.objectContaining({ type: "geojson" })
  );
  expect(addLayerMock).toHaveBeenCalledWith(
    expect.objectContaining({ id: "track-line", type: "line" })
  );
});

it("removes the track line when track becomes null", () => {
  const { rerender } = render(
    <MapView bounds={[-10, 35, 30, 60]} flights={[]} track={sampleTrack} onSelect={() => {}} />
  );
  loadHandler!();
  rerender(<MapView bounds={[-10, 35, 30, 60]} flights={[]} track={null} onSelect={() => {}} />);
  expect(removeLayerMock).toHaveBeenCalledWith("track-line");
});
```

Note: `loadHandler` may already have been invoked by a prior test — reset it in `beforeEach` alongside the existing resets (`loadHandler = null; removeLayerMock.mockClear();` — and since the track effect requires styleLoaded, tests must call `loadHandler!()` after render; if a previous test already fired it, `loadHandler` is non-null and the new render's effect sees styleLoaded already true — both paths work, but the `addLayer` gating in the effect is what matters).

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm run test -w client`
Expected: FAIL — `track` prop is not accepted (TypeScript) and/or no track-line layer added. Existing 8 tests pass.

- [ ] **Step 3: Implement in `client/src/MapView.tsx`**

Changes:
1. Props: add `track: FlightTrack | null;` — import type from `../../server/src/types`.
2. Track effect (after the flights effect):

```tsx
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded) return;

    const removeTrack = () => {
      if (map.getLayer("track-line")) {
        map.removeLayer("track-line");
        map.removeSource("track-source");
      }
    };

    if (!track || track.points.length < 2) {
      removeTrack();
      return;
    }

    const coordinates = track.points.map((p) => [p.lon, p.lat] as [number, number]);
    const feature: GeoJSON.Feature = {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates },
    };

    if (!map.getSource("track-source")) {
      map.addSource("track-source", { type: "geojson", data: feature });
      map.addLayer(
        {
          id: "track-line",
          type: "line",
          source: "track-source",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#38bdf8",
            "line-width": 2,
            "line-dasharray": [2, 1],
          },
        },
        "flights-layer"
      );
    } else {
      (map.getSource("track-source") as maplibregl.GeoJSONSource).setData(feature);
    }
  }, [track, styleLoaded]);
```

3. The existing `styleLoaded` state stays as-is (the track effect depends on it).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w client`
Expected: PASS — 10 tests (8 + 2 new). Build: `npm run build -w client` clean.

- [ ] **Step 5: Commit**

```bash
git add client/src/MapView.tsx client/tests/mapview.test.tsx
git commit -m "feat: render flight track line on map"
```

---

### Task 4: Client — App wiring (fetch on select, 60s refresh, panel note)

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/tests/app.test.tsx`

- [ ] **Step 1: Write the failing tests — append to `client/tests/app.test.tsx`**

The maplibre mock in app.test.tsx must capture the map's click handler (to simulate plane selection) and satisfy MapView's new `track` prop. Check the current mock and extend:

```tsx
let appClickHandler: ((e: unknown) => void) | null = null;
```

In the mock class `on`: also capture `if (evt === "click") appClickHandler = cb as (e: unknown) => void;`. (MapView now also uses `track` prop — plain `null` works.)

New tests (beforeEach already stubs fetch; use `mockResolvedValueOnce` per-test overrides where needed):

```tsx
const trackResponse = {
  track: {
    icao24: "a1b2c3",
    callsign: "UAL123",
    points: [
      { t: 1, lat: 35.1, lon: -95.0, altBaro: 10000 },
      { t: 2, lat: 35.2, lon: -95.1, altBaro: 10100 },
    ],
  },
  stale: false,
  rateLimited: false,
};

it("fetches the track when a plane is selected", async () => {
  render(<App />);
  await act(async () => {});
  appClickHandler!({ point: { x: 0, y: 0 } });
  await act(async () => {});
  const calls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
  expect(calls.some((u) => u.startsWith("/api/track?icao24=a1b2c3"))).toBe(true);
});

it("refreshes the track every 60s while selected", async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => trackResponse });
  render(<App />);
  await act(async () => {});
  appClickHandler!({ point: { x: 0, y: 0 } });
  await act(async () => {});
  const trackCalls = () => vi.mocked(fetch).mock.calls.filter((c) => String(c[0]).startsWith("/api/track")).length;
  expect(trackCalls()).toBe(1);
  await act(async () => { vi.advanceTimersByTime(60_000); });
  expect(trackCalls()).toBe(2);
});

it("shows Track unavailable and clears on close", async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ track: null, stale: false, rateLimited: false }) });
  render(<App />);
  await act(async () => {});
  appClickHandler!({ point: { x: 0, y: 0 } });
  await act(async () => {});
  expect(screen.getByText("Track unavailable")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Close"));
  expect(screen.queryByText("Track unavailable")).not.toBeInTheDocument();
});
```

IMPORTANT adaptation: the mock's `queryRenderedFeatures` must return a feature whose properties the click handler passes to onSelect — check what app.test.tsx's mock returns; the click handler in MapView does `queryRenderedFeatures(e.point, { layers: ["flights-layer"] })` then passes `features[0].properties` — so the mock must return `[{ properties: { icao24: "a1b2c3", callsign: "UAL123" } }]` for selection to set `selected.icao24 = "a1b2c3"` (the track URL test depends on this). If the existing mock returns different properties, adapt.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm run test -w client`
Expected: FAIL — no track fetch happens on selection (feature not implemented). Existing 10 pass.

- [ ] **Step 3: Implement in `client/src/App.tsx`**

Changes:
1. State: `const [track, setTrack] = useState<FlightTrack | null>(null);` and `const [trackRateLimited, setTrackRateLimited] = useState(false);` — import type `FlightTrack` from `../../server/src/types`.
2. Track fetch effect (after the polling effect):

```tsx
  useEffect(() => {
    if (!selected) {
      setTrack(null);
      setTrackRateLimited(false);
      return;
    }
    let cancelled = false;

    const loadTrack = async () => {
      try {
        const res = await fetch(`/api/track?icao24=${selected.icao24}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (!cancelled) {
          setTrack(body.track);
          setTrackRateLimited(Boolean(body.rateLimited));
        }
      } catch {
        if (!cancelled) {
          setTrack(null);
          setTrackRateLimited(false);
        }
      }
    };

    void loadTrack();
    const interval = setInterval(() => void loadTrack(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selected]);
```

3. Region change clears selection (and thus track): in `changeRegion`, add `setSelected(null);`:

```tsx
  const changeRegion = useCallback((key: string) => {
    setRegion(key as keyof typeof REGIONS);
    setSelected(null);
  }, []);
```

4. Pass the prop to MapView: `<MapView bounds={...} flights={flights} track={track} onSelect={setSelected} />`.
5. Panel note — after the "Last contact" row, add:

```tsx
          <div className="row"><span>Track</span><span>{track ? `${track.points.length} pts` : trackRateLimited ? "refresh paused (rate limited)" : "unavailable"}</span></div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w client`
Expected: PASS — 13 tests (10 + 3 new). Build: `npm run build -w client` clean.

- [ ] **Step 5: Commit**

```bash
git add client/src/App.tsx client/tests/app.test.tsx
git commit -m "feat: fetch and refresh flight track on selection"
```

---

### Task 5: Integration pass

**Files:**
- None (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: 32 server + 13 client = 45 tests, all passing.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit -p server` and `npm run build -w client` — both clean.

- [ ] **Step 3: Manual API pass**

Run `npm run dev`, then:

```
curl "http://localhost:3001/api/track?icao24=<any 6-hex>"   # 200, track or null
curl "http://localhost:3001/api/track?icao24=zzz"           # 400
```

- [ ] **Step 4: Visual pass (delegated to visual-inspector subagent)**

Start `npm run dev` (if not running), open http://localhost:5173, click a plane, and verify: dashed light-blue line appears along the plane's real trajectory; keep the panel open ≥60s and verify the line extends (throttled refresh); close the panel and verify the line disappears. Screenshot each step.

- [ ] **Step 5: Commit (only if the pass surfaced changes; otherwise skip)**

```bash
git add .
git commit -m "fix: track feature integration fixes"
```
