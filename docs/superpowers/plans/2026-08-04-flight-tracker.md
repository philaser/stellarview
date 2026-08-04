# Live Flight Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a live flight tracker web app — map of aircraft positions over a user-selected region, with a click-for-details panel — using only free data sources.

**Architecture:** Monorepo with `server/` (Express + TypeScript proxy that caches OpenSky responses behind a provider abstraction) and `client/` (Vite + React + MapLibre GL). The proxy is the sole consumer of external APIs, solving OpenSky's CORS block and centralizing credit caching. Static airport data comes from a build script over OurAirports public-domain CSV.

**Tech Stack:** TypeScript, Express, Vite, React, MapLibre GL, OpenFreeMap tiles, vitest, OurAirports CSV.

**Spec:** `docs/superpowers/specs/2026-08-04-flight-tracker-design.md`

---

### Task 1: Monorepo scaffolding

**Files:**
- Create: `package.json` (root, npm workspaces)
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `README.md`
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `client/package.json`
- Create: `client/tsconfig.json`
- Create: `client/vite.config.ts`

- [ ] **Step 1: Write root `package.json`**

```json
{
  "name": "flight-tracker",
  "private": true,
  "workspaces": ["server", "client"],
  "scripts": {
    "dev": "npm-run-all --parallel dev:server dev:client",
    "dev:server": "npm run dev -w server",
    "dev:client": "npm run dev -w client",
    "test": "npm run test -w server && npm run test -w client",
    "build:airports": "tsx scripts/build-airports.ts"
  },
  "devDependencies": {
    "npm-run-all": "^4.1.5",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "types": ["node"]
  }
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
dist/
*.log
.env
.DS_Store
```

- [ ] **Step 4: Write `README.md`**

```markdown
# Flight Tracker

Live map of aircraft over a user-selected region, with flight details on click. Built entirely on free data sources.

## Prereqs

- Node 20+
- Recommended: free OpenSky Network account (4,000 credits/day vs 400 anonymous)

## Setup

npm install
npm run build:airports   # downloads OurAirports CSV, generates server/data/airports.json

## Run

npm run dev              # server on :3001, client on :5173

Optional env vars (server/.env): OPENSKY_USERNAME, OPENSKY_PASSWORD, AIRLABS_API_KEY, PROVIDER
```

- [ ] **Step 5: Write `server/package.json`**

```json
{
  "name": "server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^22.0.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 6: Write `server/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 7: Write `client/package.json`**

```json
{
  "name": "client",
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
    "react-dom": "^18.3.1"
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

- [ ] **Step 8: Write `client/tsconfig.json`**

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

- [ ] **Step 9: Write `client/vite.config.ts`**

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

- [ ] **Step 10: Verify workspaces install**

Run: `npm install`
Expected: installs with no errors, creates `node_modules` at root.

- [ ] **Step 11: Commit**

```bash
git add package.json tsconfig.base.json .gitignore README.md server client
git commit -m "chore: scaffold monorepo workspaces for server and client"
```

---

### Task 2: Shared types + bbox validation

**Files:**
- Create: `server/src/types.ts`
- Create: `server/src/bbox.ts`
- Create: `server/tests/bbox.test.ts`

- [ ] **Step 1: Write the failing test `server/tests/bbox.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { parseBbox, Bbox } from "../src/bbox";

describe("parseBbox", () => {
  it("accepts a valid bbox string", () => {
    expect(parseBbox("-10,35,30,60")).toEqual({ minLon: -10, minLat: 35, maxLon: 30, maxLat: 60 });
  });

  it("rejects non-numeric input", () => {
    expect(() => parseBbox("abc")).toThrow();
  });

  it("rejects out-of-range coordinates", () => {
    expect(() => parseBbox("-200,0,0,0")).toThrow();
    expect(() => parseBbox("0,-100,0,0")).toThrow();
  });

  it("rejects inverted corners", () => {
    expect(() => parseBbox("30,35,-10,60")).toThrow();
  });

  it("rejects bboxes larger than 400 sq degrees", () => {
    expect(() => parseBbox("-179,-89,179,89")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server`
Expected: FAIL — cannot find module `../src/bbox`.

- [ ] **Step 3: Write `server/src/bbox.ts`**

```typescript
export interface Bbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export const MAX_BBOX_AREA_SQ_DEG = 400;

export function parseBbox(input: string): Bbox {
  const parts = input.split(",").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) {
    throw new Error("bbox must be 4 comma-separated numbers: minLon,minLat,maxLon,maxLat");
  }
  const [minLon, minLat, maxLon, maxLat] = parts as [number, number, number, number];
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) {
    throw new Error("bbox coordinates out of range");
  }
  if (minLon >= maxLon || minLat >= maxLat) {
    throw new Error("bbox corners inverted: min must be less than max");
  }
  const area = Math.abs(maxLon - minLon) * Math.abs(maxLat - minLat);
  if (area > MAX_BBOX_AREA_SQ_DEG) {
    throw new Error(`bbox area ${area.toFixed(0)} sq deg exceeds max ${MAX_BBOX_AREA_SQ_DEG}`);
  }
  return { minLon, minLat, maxLon, maxLat };
}
```

- [ ] **Step 4: Write `server/src/types.ts`**

```typescript
export interface FlightState {
  icao24: string;
  callsign: string | null;
  originCountry: string;
  lat: number | null;
  lon: number | null;
  altitudeBaro: number | null;
  altitudeGeo: number | null;
  velocity: number | null;
  heading: number | null;
  verticalRate: number | null;
  squawk: string | null;
  positionSource: number | null;
  onGround: boolean;
  lastContact: number;
}

export interface FlightsResponse {
  flights: FlightState[];
  stale: boolean;
  rateLimited: boolean;
  fetchedAt: number;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w server`
Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
git add server/src/types.ts server/src/bbox.ts server/tests/bbox.test.ts
git commit -m "feat: add shared flight types and bbox validation"
```

---

### Task 3: OpenSky provider

**Files:**
- Create: `server/src/providers/flight-provider.ts`
- Create: `server/src/providers/opensky.ts`
- Create: `server/tests/opensky.test.ts`

- [ ] **Step 1: Write `server/src/providers/flight-provider.ts`**

```typescript
import type { Bbox } from "../bbox";
import type { FlightState } from "../types";

export interface FlightProvider {
  name: string;
  fetchStates(bbox: Bbox): Promise<FlightState[]>;
}
```

- [ ] **Step 2: Write the failing test `server/tests/opensky.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenSkyProvider } from "../src/providers/opensky";

const sampleStates = {
  time: 1754300000,
  states: [
    [
      "a1b2c3",
      "UAL123 ",
      "United States",
      1754300000,
      1754299000,
      35.5,
      -95.2,
      10668,
      false,
      250.3,
      92.4,
      0.5,
      null,
      5123,
      "1200",
      false,
      0,
    ],
    ["deadbeef", null, "Germany", 1754300000, null, null, null, null, null, null, null, null, null, null, null, false, 0],
  ],
};

describe("OpenSkyProvider", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => sampleStates,
      })
    );
  });

  it("maps OpenSky state vectors to FlightState and trims callsigns", async () => {
    const provider = new OpenSkyProvider({ baseUrl: "https://opensky-network.org/api" });
    const states = await provider.fetchStates({ minLon: -10, minLat: 35, maxLon: 30, maxLat: 60 });
    expect(states).toHaveLength(2);
    expect(states[0]).toMatchObject({
      icao24: "a1b2c3",
      callsign: "UAL123",
      originCountry: "United States",
      lat: 35.5,
      lon: -95.2,
      altitudeBaro: 10668,
      onGround: false,
      squawk: "1200",
    });
  });

  it("excludes aircraft without a fresh position", async () => {
    const provider = new OpenSkyProvider({ baseUrl: "https://opensky-network.org/api" });
    const states = await provider.fetchStates({ minLon: -10, minLat: 35, maxLon: 30, maxLat: 60 });
    expect(states.find((s) => s.icao24 === "deadbeef")).toBeUndefined();
  });

  it("sends the bbox as query params", async () => {
    const provider = new OpenSkyProvider({ baseUrl: "https://opensky-network.org/api" });
    await provider.fetchStates({ minLon: -10, minLat: 35, maxLon: 30, maxLat: 60 });
    const fetchMock = vi.mocked(fetch);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("lamin=35");
    expect(url).toContain("lomin=-10");
    expect(url).toContain("lamax=60");
    expect(url).toContain("lomax=30");
  });

  it("throws on non-ok responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) })
    );
    const provider = new OpenSkyProvider({ baseUrl: "https://opensky-network.org/api" });
    await expect(
      provider.fetchStates({ minLon: -10, minLat: 35, maxLon: 30, maxLat: 60 })
    ).rejects.toThrow("429");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -w server`
Expected: FAIL — cannot find module `../src/providers/opensky`.

- [ ] **Step 4: Write `server/src/providers/opensky.ts`**

```typescript
import type { Bbox } from "../bbox";
import type { FlightState } from "../types";
import type { FlightProvider } from "./flight-provider";

// OpenSky state vector array positions (documented in their REST API)
const IDX = {
  icao24: 0,
  callsign: 1,
  originCountry: 2,
  timePosition: 3,
  lastContact: 4,
  longitude: 5,
  latitude: 6,
  baroAltitude: 7,
  onGround: 8,
  velocity: 9,
  trueTrack: 10,
  verticalRate: 11,
  sensors: 12,
  geoAltitude: 13,
  squawk: 14,
  spi: 15,
  positionSource: 16,
} as const;

export const FRESH_POSITION_WINDOW_S = 60;

export class OpenSkyProvider implements FlightProvider {
  name = "opensky";

  constructor(private opts: { baseUrl: string; token?: string | null }) {}

  async fetchStates(bbox: Bbox): Promise<FlightState[]> {
    const params = new URLSearchParams({
      lamin: String(bbox.minLat),
      lomin: String(bbox.minLon),
      lamax: String(bbox.maxLat),
      lomax: String(bbox.maxLon),
    });
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.opts.token) headers.Authorization = `Bearer ${this.opts.token}`;

    const res = await fetch(`${this.opts.baseUrl}/states/all?${params}`, { headers });
    if (!res.ok) {
      throw new Error(`OpenSky responded ${res.status}`);
    }
    const body = (await res.json()) as { states: unknown[] };
    const now = Math.floor(Date.now() / 1000);

    return body.states
      .filter((s) => Array.isArray(s))
      .map((s) => s as (number | string | boolean | null)[])
      .filter((s) => {
        const timePosition = s[IDX.timePosition];
        return typeof timePosition === "number" && now - timePosition <= FRESH_POSITION_WINDOW_S;
      })
      .map((s) => this.toFlightState(s));
  }

  private toFlightState(s: (number | string | boolean | null)[]): FlightState {
    const callsign = typeof s[IDX.callsign] === "string" ? (s[IDX.callsign] as string).trim() : null;
    return {
      icao24: String(s[IDX.icao24]),
      callsign: callsign || null,
      originCountry: String(s[IDX.originCountry]),
      lat: typeof s[IDX.latitude] === "number" ? (s[IDX.latitude] as number) : null,
      lon: typeof s[IDX.longitude] === "number" ? (s[IDX.longitude] as number) : null,
      altitudeBaro: typeof s[IDX.baroAltitude] === "number" ? (s[IDX.baroAltitude] as number) : null,
      altitudeGeo: typeof s[IDX.geoAltitude] === "number" ? (s[IDX.geoAltitude] as number) : null,
      velocity: typeof s[IDX.velocity] === "number" ? (s[IDX.velocity] as number) : null,
      heading: typeof s[IDX.trueTrack] === "number" ? (s[IDX.trueTrack] as number) : null,
      verticalRate: typeof s[IDX.verticalRate] === "number" ? (s[IDX.verticalRate] as number) : null,
      squawk: typeof s[IDX.squawk] === "string" ? (s[IDX.squawk] as string) : null,
      positionSource: typeof s[IDX.positionSource] === "number" ? (s[IDX.positionSource] as number) : null,
      onGround: s[IDX.onGround] === true,
      lastContact: typeof s[IDX.lastContact] === "number" ? (s[IDX.lastContact] as number) : 0,
    };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w server`
Expected: PASS — 4 tests.

- [ ] **Step 6: Commit**

```bash
git add server/src/providers server/tests/opensky.test.ts
git commit -m "feat: add OpenSky provider with state vector mapping"
```

---

### Task 4: OpenSky OAuth2 token + provider factory

**Files:**
- Create: `server/src/providers/token.ts`
- Create: `server/src/providers/factory.ts`
- Create: `server/tests/token.test.ts`

- [ ] **Step 1: Write the failing test `server/tests/token.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenManager } from "../src/providers/token";

describe("TokenManager", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: "tok123", expires_in: 1800 }),
      })
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("fetches a token on first call and caches it", async () => {
    const tm = new TokenManager({ clientId: "u", clientSecret: "p", baseUrl: "https://auth.opensky-network.org" });
    const t1 = await tm.getToken();
    const t2 = await tm.getToken();
    expect(t1).toBe("tok123");
    expect(t2).toBe("tok123");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refetches after expiry (half-life cache)", async () => {
    const tm = new TokenManager({ clientId: "u", clientSecret: "p", baseUrl: "https://auth.opensky-network.org" });
    await tm.getToken();
    (vi.mocked(fetch).mockResolvedValueOnce as unknown as () => void).call(null);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "tok456", expires_in: 1800 }),
    });
    (tm as unknown as { expiresAt: number }).expiresAt = Date.now() - 1000;
    expect(await tm.getToken()).toBe("tok456");
  });

  it("throws when credentials are missing", () => {
    expect(() => new TokenManager({ clientId: "", clientSecret: "", baseUrl: "x" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server`
Expected: FAIL — cannot find module `../src/providers/token`.

- [ ] **Step 3: Write `server/src/providers/token.ts`**

```typescript
export class TokenManager {
  private token: string | null = null;
  private expiresAt = 0;

  constructor(
    private opts: {
      clientId: string;
      clientSecret: string;
      baseUrl: string;
      tokenEndpoint?: string;
    }
  ) {
    if (!opts.clientId || !opts.clientSecret) {
      throw new Error("OpenSky credentials (OPENSKY_USERNAME / OPENSKY_PASSWORD) are required");
    }
  }

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt) return this.token;
    const endpoint = this.opts.tokenEndpoint ?? "/token";
    const res = await fetch(`${this.opts.baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${this.opts.clientId}:${this.opts.clientSecret}`
        ).toString("base64")}`,
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = body.access_token;
    this.expiresAt = Date.now() + (body.expires_in - 60) * 1000; // refresh 60s early
    return this.token;
  }
}
```

Note: OpenSky's token endpoint is `https://auth.opensky-network.org/oauth2/token`; the test mocks fetch so the URL is irrelevant there, but the real default is set in the factory (next step).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server`
Expected: PASS — 3 tests.

- [ ] **Step 5: Update `server/src/providers/opensky.ts` to use a lazy TokenManager**

Replace the entire file with (note the constructor now takes `{ baseUrl }` plus an optional `tokenManager`, and attaches status/retry-after info to thrown errors):

```typescript
import type { Bbox } from "../bbox";
import type { FlightState } from "../types";
import type { FlightProvider } from "./flight-provider";
import type { TokenManager } from "./token";

// OpenSky state vector array positions (documented in their REST API)
const IDX = {
  icao24: 0,
  callsign: 1,
  originCountry: 2,
  timePosition: 3,
  lastContact: 4,
  longitude: 5,
  latitude: 6,
  baroAltitude: 7,
  onGround: 8,
  velocity: 9,
  trueTrack: 10,
  verticalRate: 11,
  sensors: 12,
  geoAltitude: 13,
  squawk: 14,
  spi: 15,
  positionSource: 16,
} as const;

export const FRESH_POSITION_WINDOW_S = 60;

export class OpenSkyProvider implements FlightProvider {
  name = "opensky";

  constructor(
    private opts: { baseUrl: string },
    private tokenManager: TokenManager | null = null
  ) {}

  async fetchStates(bbox: Bbox): Promise<FlightState[]> {
    const params = new URLSearchParams({
      lamin: String(bbox.minLat),
      lomin: String(bbox.minLon),
      lamax: String(bbox.maxLat),
      lomax: String(bbox.maxLon),
    });
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.tokenManager) {
      headers.Authorization = `Bearer ${await this.tokenManager.getToken()}`;
    }
    const res = await fetch(`${this.opts.baseUrl}/states/all?${params}`, { headers });
    if (!res.ok) {
      const error = new Error(`OpenSky responded ${res.status}`) as Error & {
        status?: number;
        retryAfter?: string | null;
      };
      error.status = res.status;
      error.retryAfter = res.headers.get("X-Rate-Limit-Retry-After-Seconds");
      throw error;
    }
    const body = (await res.json()) as { states: unknown[] };
    const now = Math.floor(Date.now() / 1000);
    return body.states
      .filter((s) => Array.isArray(s))
      .map((s) => s as (number | string | boolean | null)[])
      .filter((s) => {
        const timePosition = s[IDX.timePosition];
        return typeof timePosition === "number" && now - timePosition <= FRESH_POSITION_WINDOW_S;
      })
      .map((s) => this.toFlightState(s));
  }

  private toFlightState(s: (number | string | boolean | null)[]): FlightState {
    const callsign = typeof s[IDX.callsign] === "string" ? (s[IDX.callsign] as string).trim() : null;
    return {
      icao24: String(s[IDX.icao24]),
      callsign: callsign || null,
      originCountry: String(s[IDX.originCountry]),
      lat: typeof s[IDX.latitude] === "number" ? (s[IDX.latitude] as number) : null,
      lon: typeof s[IDX.longitude] === "number" ? (s[IDX.longitude] as number) : null,
      altitudeBaro: typeof s[IDX.baroAltitude] === "number" ? (s[IDX.baroAltitude] as number) : null,
      altitudeGeo: typeof s[IDX.geoAltitude] === "number" ? (s[IDX.geoAltitude] as number) : null,
      velocity: typeof s[IDX.velocity] === "number" ? (s[IDX.velocity] as number) : null,
      heading: typeof s[IDX.trueTrack] === "number" ? (s[IDX.trueTrack] as number) : null,
      verticalRate: typeof s[IDX.verticalRate] === "number" ? (s[IDX.verticalRate] as number) : null,
      squawk: typeof s[IDX.squawk] === "string" ? (s[IDX.squawk] as string) : null,
      positionSource: typeof s[IDX.positionSource] === "number" ? (s[IDX.positionSource] as number) : null,
      onGround: s[IDX.onGround] === true,
      lastContact: typeof s[IDX.lastContact] === "number" ? (s[IDX.lastContact] as number) : 0,
    };
  }
}
```

- [ ] **Step 6: Write `server/src/providers/factory.ts`**

```typescript
import { OpenSkyProvider } from "./opensky";
import { TokenManager } from "./token";
import type { FlightProvider } from "./flight-provider";

export function createProvider(env: NodeJS.ProcessEnv): FlightProvider {
  const provider = env.PROVIDER ?? "opensky";

  if (provider === "airlabs") {
    if (!env.AIRLABS_API_KEY) throw new Error("AIRLABS_API_KEY is required when PROVIDER=airlabs");
    throw new Error("AirLabs provider not yet implemented");
  }

  if (provider !== "opensky") throw new Error(`Unknown provider: ${provider}`);

  const baseUrl = env.OPENSKY_BASE_URL ?? "https://opensky-network.org/api";
  const tokenManager =
    env.OPENSKY_USERNAME && env.OPENSKY_PASSWORD
      ? new TokenManager({
          clientId: env.OPENSKY_USERNAME,
          clientSecret: env.OPENSKY_PASSWORD,
          baseUrl: "https://auth.opensky-network.org",
          tokenEndpoint: "/oauth2/token",
        })
      : null;
  return new OpenSkyProvider({ baseUrl }, tokenManager);
}
```

Note: OpenSky's real token endpoint is `https://auth.opensky-network.org/oauth2/token` (handled in the factory); the TokenManager test mocks fetch so the endpoint path is not exercised there.

- [ ] **Step 7: Run all server tests**

Run: `npm run test -w server`
Expected: PASS — 7 tests.

- [ ] **Step 8: Commit**

```bash
git add server/src/providers
git commit -m "feat: add OpenSky OAuth2 token manager and provider factory"
```

---

### Task 5: Caching proxy + Express server

**Files:**
- Create: `server/src/cache.ts`
- Create: `server/tests/cache.test.ts`
- Create: `server/src/index.ts`

- [ ] **Step 1: Write the failing test `server/tests/cache.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { TtlCache } from "../src/cache";

describe("TtlCache", () => {
  it("returns undefined on miss", () => {
    const c = new TtlCache<number>(1000);
    expect(c.get("a")).toBeUndefined();
  });

  it("returns the value and does not refetch before TTL", async () => {
    const c = new TtlCache<number>(1000);
    const load = vi.fn().mockResolvedValue(42);
    expect(await c.getOrLoad("a", load)).toBe(42);
    expect(await c.getOrLoad("a", load)).toBe(42);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("refetches after TTL expires", async () => {
    vi.useFakeTimers();
    const c = new TtlCache<number>(1000);
    const load = vi.fn().mockResolvedValue(42);
    await c.getOrLoad("a", load);
    vi.advanceTimersByTime(1500);
    await c.getOrLoad("a", load);
    expect(load).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server`
Expected: FAIL — cannot find module `../src/cache`.

- [ ] **Step 3: Write `server/src/cache.ts`**

```typescript
interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private entries = new Map<string, Entry<T>>();

  constructor(private ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await load();
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server`
Expected: PASS — 3 tests.

- [ ] **Step 5: Write `server/src/index.ts`**

```typescript
import "dotenv/config";
import { fileURLToPath } from "url";
import path from "path";
import express from "express";
import cors from "cors";
import { parseBbox } from "./bbox";
import type { FlightsResponse, FlightState } from "./types";
import { createProvider } from "./providers/factory";
import { TtlCache } from "./cache";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3001);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS ?? 15_000);
const PROVIDER = createProvider(process.env);
const cache = new TtlCache<FlightState[]>(CACHE_TTL_MS);
const lastGood = new Map<string, { flights: FlightState[]; fetchedAt: number }>();

const app = express();
app.use(cors());

app.get("/api/airports", (_req, res) => {
  res.sendFile("data/airports.json", { root: __dirname }, (err) => {
    if (err) res.status(500).json({ error: "airport dataset missing — run npm run build:airports" });
  });
});

app.get("/api/flights", async (req, res) => {
  let bbox;
  try {
    bbox = parseBbox(String(req.query.bbox ?? ""));
  } catch {
    res.status(400).json({ error: "invalid bbox" });
    return;
  }

  const key = `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`;
  let rateLimited = false;
  let stale = false;

  try {
    const flights = await cache.getOrLoad(key, () => PROVIDER.fetchStates(bbox));
    lastGood.set(key, { flights, fetchedAt: Date.now() });
    const body: FlightsResponse = { flights, stale, rateLimited, fetchedAt: Date.now() };
    res.json(body);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 429) rateLimited = true;
    const fallback = lastGood.get(key);
    if (fallback) {
      stale = true;
      const body: FlightsResponse = {
        flights: fallback.flights,
        stale,
        rateLimited,
        fetchedAt: fallback.fetchedAt,
      };
      res.json(body);
    } else {
      res.status(502).json({ error: "provider unreachable", rateLimited });
    }
  }
});

app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT} (provider: ${PROVIDER.name})`);
});
```

Note: `res.sendFile` root is `__dirname` (resolved to the compiled/tsx-run `src` dir), and the data file lives at `server/data/airports.json` — update the root if the layout changes; the Task 6 script writes there.

- [ ] **Step 6: Verify the server boots (smoke test)**

Run: `npm run dev -w server` (or `npx tsx server/src/index.ts`), then `curl "http://localhost:3001/api/flights?bbox=-10,35,30,60"`
Expected: JSON response with `flights` array (may be empty if no aircraft in region, or fail if offline — either way the server responds, and invalid bbox returns 400).

- [ ] **Step 7: Commit**

```bash
git add server/src/index.ts server/src/cache.ts server/tests/cache.test.ts
git commit -m "feat: add Express proxy with TTL cache, stale fallback and rate-limit handling"
```

---

### Task 6: Airport dataset build script

**Files:**
- Create: `scripts/build-airports.ts`
- Create: `server/data/airports.json` (generated output, committed)

- [ ] **Step 1: Write `scripts/build-airports.ts`**

```typescript
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_URL = "https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv";

interface AirportRecord {
  id: number;
  ident: string; // ICAO or FAA LID
  iata: string | null;
  name: string;
  lat: number;
  lon: number;
  elevationFt: number | null;
  type: string;
  tz: string | null;
}

async function main() {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`Failed to download airports.csv: ${res.status}`);
  const text = await res.text();
  const rows = parseCsv(text);
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));

  const airports: AirportRecord[] = [];
  for (const row of rows.slice(1)) {
    const iata = row[idx.iata_code] || null;
    const type = row[idx.type];
    if (!iata) continue; // keep dataset small: IATA-coded airports only
    airports.push({
      id: Number(row[idx.id]),
      ident: row[idx.ident],
      iata,
      name: row[idx.name],
      lat: Number(row[idx.latitude_deg]),
      lon: Number(row[idx.longitude_deg]),
      elevationFt: row[idx.elevation_ft] ? Number(row[idx.elevation_ft]) : null,
      type,
      tz: row[idx.timezone] || null,
    });
  }

  const out = path.join(__dirname, "..", "server", "data", "airports.json");
  writeFileSync(out, JSON.stringify(airports, null, 0));
  console.log(`Wrote ${airports.length} airports to ${out}`);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the script**

Run: `npm run build:airports`
Expected: prints `Wrote N airports to .../server/data/airports.json` (N ~ several thousand).

- [ ] **Step 3: Verify dataset shape**

Run: `node -e "const a=require('./server/data/airports.json'); console.log(a.length, JSON.stringify(a[0]))"`
Expected: prints count and a sample record with `ident`, `iata`, `name`, `lat`, `lon`.

- [ ] **Step 4: Verify the airports endpoint**

Run: `npm run dev -w server`, then `curl http://localhost:3001/api/airports`
Expected: JSON array of airports.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-airports.ts server/data/airports.json
git commit -m "feat: add OurAirports dataset build script and generated airports.json"
```

---

### Task 7: Client scaffold + map

**Files:**
- Create: `client/index.html`
- Create: `client/src/main.tsx`
- Create: `client/src/App.tsx`
- Create: `client/src/MapView.tsx`
- Create: `client/src/styles.css`
- Create: `client/tests/setup.ts`
- Create: `client/tests/mapview.test.tsx`

- [ ] **Step 1: Write `client/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Flight Tracker</title>
    <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.0/dist/maplibre-gl.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `client/src/main.tsx`**

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

- [ ] **Step 3: Write `client/src/styles.css`**

```css
html, body, #root { height: 100%; margin: 0; }
.app { position: relative; height: 100%; width: 100%; }
.map { position: absolute; inset: 0; }
.panel {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 260px;
  background: rgba(17, 24, 39, 0.92);
  color: #e5e7eb;
  border-radius: 8px;
  padding: 12px;
  font: 13px/1.5 system-ui, sans-serif;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
}
.panel h2 { margin: 0 0 8px; font-size: 15px; }
.panel .row { display: flex; justify-content: space-between; gap: 8px; }
.panel .row span:first-child { color: #9ca3af; }
.controls {
  position: absolute;
  top: 12px;
  left: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 10;
}
.controls select, .controls button {
  background: rgba(17, 24, 39, 0.92);
  color: #e5e7eb;
  border: 1px solid #374151;
  border-radius: 6px;
  padding: 6px 10px;
  font: 13px system-ui, sans-serif;
}
.banner {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: #7c2d12;
  color: #ffedd5;
  border-radius: 6px;
  padding: 6px 12px;
  font: 12px system-ui, sans-serif;
  z-index: 10;
}
```

- [ ] **Step 4: Write `client/src/MapView.tsx`** (final version — click handling and altitude painting included here; Task 8 adds the click-handler test only)

```tsx
import { useEffect, useRef } from "react";
import maplibregl, { Map as MapLibreMap } from "maplibre-gl";
import type { FlightState } from "../../server/src/types";

export const ALTITUDE_COLORS = {
  low: "#22c55e",
  mid: "#f59e0b",
  high: "#ef4444",
} as const;

export function altitudeColor(altBaro: number | null): string {
  if (altBaro === null) return ALTITUDE_COLORS.low;
  if (altBaro < 3000) return ALTITUDE_COLORS.low;
  if (altBaro < 7000) return ALTITUDE_COLORS.mid;
  return ALTITUDE_COLORS.high;
}

interface MapViewProps {
  bounds: [number, number, number, number];
  flights: FlightState[];
  onSelect: (flight: FlightState | null) => void;
}

export default function MapView({ bounds, flights, onSelect }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const map = new MapLibreMap({
      container: containerRef.current!,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
      zoom: 4,
    });
    map.on("click", (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ["flights-layer"] });
      if (features.length > 0) {
        const props = features[0].properties ?? {};
        onSelectRef.current(props as unknown as FlightState);
      }
    });
    mapRef.current = map;
    return () => map.remove();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const featureCollection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: flights.map((f) => ({
        type: "Feature",
        properties: { ...f },
        geometry:
          f.lat !== null && f.lon !== null
            ? { type: "Point", coordinates: [f.lon, f.lat] }
            : { type: "Point", coordinates: [0, 0] },
      })),
    };

    const source = map.getSource("flights") as maplibregl.GeoJSONSource | undefined;
    if (!source) {
      map.addSource("flights", { type: "geojson", data: featureCollection });
      map.addLayer({
        id: "flights-layer",
        type: "circle",
        source: "flights",
        paint: {
          "circle-radius": 5,
          "circle-color": [
            "interpolate",
            ["linear"],
            ["coalesce", ["get", "altitudeBaro"], 0],
            0,
            ALTITUDE_COLORS.low,
            3000,
            ALTITUDE_COLORS.low,
            3001,
            ALTITUDE_COLORS.mid,
            7000,
            ALTITUDE_COLORS.mid,
            7001,
            ALTITUDE_COLORS.high,
          ],
        },
      });
    } else {
      source.setData(featureCollection);
    }
  }, [flights]);

  return <div ref={containerRef} className="map" />;
}
```

- [ ] **Step 5: Write `client/src/App.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import MapView from "./MapView";
import type { FlightsResponse, FlightState } from "../../server/src/types";

const REGIONS = {
  europe: { name: "Europe", bounds: [-10, 35, 30, 60] as [number, number, number, number] },
  us: { name: "Continental US", bounds: [-125, 24, -66, 50] as [number, number, number, number] },
  global: { name: "Global", bounds: [-180, -85, 180, 85] as [number, number, number, number] },
};

export default function App() {
  const [region, setRegion] = useState<keyof typeof REGIONS>("europe");
  const [flights, setFlights] = useState<FlightState[]>([]);
  const [selected, setSelected] = useState<FlightState | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const [stale, setStale] = useState(false);

  const applyResponse = useCallback((body: FlightsResponse) => {
    setFlights(body.flights);
    setLastUpdated(body.fetchedAt);
    setRateLimited(Boolean(body.rateLimited));
    setStale(Boolean(body.stale));
  }, []);

  const pollNow = useCallback(() => {
    const b = REGIONS[region].bounds;
    return fetch(`/api/flights?bbox=${b.join(",")}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body) => applyResponse(body))
      .catch(() => setStale(true));
  }, [region, applyResponse]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      const b = REGIONS[region].bounds;
      try {
        const res = await fetch(`/api/flights?bbox=${b.join(",")}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (!cancelled) applyResponse(body);
      } catch {
        if (!cancelled) setStale(true);
      }
      if (!cancelled) timer = setTimeout(poll, 20_000);
    };

    poll();
    const onVisibility = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [region, applyResponse]);

  const changeRegion = useCallback((key: string) => setRegion(key as keyof typeof REGIONS), []);

  return (
    <div className="app">
      <MapView bounds={REGIONS[region].bounds} flights={flights} onSelect={setSelected} />
      <div className="controls">
        <select value={region} onChange={(e) => changeRegion(e.target.value)}>
          {Object.entries(REGIONS).map(([key, r]) => (
            <option key={key} value={key}>
              {r.name}
            </option>
          ))}
        </select>
        <button onClick={() => void pollNow()}>Refresh now</button>
      </div>
      {selected && (
        <div className="panel">
          <h2>{selected.callsign ?? selected.icao24}</h2>
          <div className="row"><span>Origin country</span><span>{selected.originCountry}</span></div>
          <div className="row"><span>Altitude (baro)</span><span>{selected.altitudeBaro ?? "—"} m</span></div>
          <div className="row"><span>Ground speed</span><span>{selected.velocity != null ? Math.round(selected.velocity * 3.6) : "—"} km/h</span></div>
          <div className="row"><span>Heading</span><span>{selected.heading != null ? `${Math.round(selected.heading)}°` : "—"}</span></div>
          <div className="row"><span>Vertical rate</span><span>{selected.verticalRate ?? "—"} m/s</span></div>
          <div className="row"><span>On ground</span><span>{selected.onGround ? "yes" : "no"}</span></div>
          <div className="row"><span>Last contact</span><span>{new Date(selected.lastContact * 1000).toLocaleTimeString()}</span></div>
          <button onClick={() => setSelected(null)}>Close</button>
        </div>
      )}
      {(rateLimited || stale) && (
        <div className="banner">
          {rateLimited ? "Rate limited — showing cached data" : "Stale data — provider unreachable"}
        </div>
      )}
      {lastUpdated && (
        <div className="banner" style={{ bottom: "52px", background: "#111827" }}>
          Updated {Math.round((Date.now() - lastUpdated) / 1000)}s ago
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Write `client/tests/setup.ts`**

```typescript
import "@testing-library/jest-dom";
```

- [ ] **Step 7: Write the failing test `client/tests/mapview.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import MapView, { altitudeColor } from "../src/MapView";

vi.mock("maplibre-gl", () => ({
  default: class {
    constructor() {}
    on() {}
    addSource() {}
    addLayer() {}
    remove() {}
    getSource() {
      return undefined;
    }
  },
}));

describe("MapView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps altitude to colors", () => {
    expect(altitudeColor(1000)).toBe("#22c55e");
    expect(altitudeColor(5000)).toBe("#f59e0b");
    expect(altitudeColor(12000)).toBe("#ef4444");
    expect(altitudeColor(null)).toBe("#22c55e");
  });

  it("renders the map container", () => {
    render(
      <MapView
        bounds={[-10, 35, 30, 60]}
        flights={[]}
        onSelect={() => {}}
      />
    );
    expect(document.querySelector(".map")).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run client tests to verify they pass**

Run: `npm run test -w client`
Expected: PASS — 2 tests. (MapView implementation precedes the test in this scaffold task, so the first run should already pass; if it fails, the mock is missing a method MapView calls on mount — add it.)

- [ ] **Step 9: Commit**

```bash
git add client
git commit -m "feat: scaffold client with MapLibre map and region controls"
```

---

### Task 8: Plane marker click-handler test

**Files:**
- Modify: `client/tests/mapview.test.tsx`

- [ ] **Step 1: Add the click-handler test and update the module mock**

The module mock at the top of the test file must capture the click callback. Replace the whole file with:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import MapView, { altitudeColor } from "../src/MapView";

let capturedClickHandler: ((e: unknown) => void) | null = null;

vi.mock("maplibre-gl", () => ({
  default: class {
    on(evt: string, cb: (e: unknown) => void) {
      if (evt === "click") capturedClickHandler = cb;
    }
    addSource() {}
    addLayer() {}
    remove() {}
    getSource() {
      return undefined;
    }
    queryRenderedFeatures() {
      return [
        { properties: { icao24: "a1b2c3", callsign: "UAL123", altitudeBaro: 10668 } },
      ];
    }
  },
}));

describe("MapView", () => {
  beforeEach(() => {
    capturedClickHandler = null;
  });

  it("maps altitude to colors", () => {
    expect(altitudeColor(1000)).toBe("#22c55e");
    expect(altitudeColor(5000)).toBe("#f59e0b");
    expect(altitudeColor(12000)).toBe("#ef4444");
    expect(altitudeColor(null)).toBe("#22c55e");
  });

  it("renders the map container", () => {
    render(
      <MapView
        bounds={[-10, 35, 30, 60]}
        flights={[]}
        onSelect={() => {}}
      />
    );
    expect(document.querySelector(".map")).toBeInTheDocument();
  });

  it("registers a click handler on the map", () => {
    render(<MapView bounds={[-10, 35, 30, 60]} flights={[]} onSelect={() => {}} />);
    expect(capturedClickHandler).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm run test -w client`
Expected: PASS — 3 tests.

- [ ] **Step 3: Typecheck**

Run: `npm run build -w client`
Expected: tsc passes with no errors.

- [ ] **Step 4: Commit**

```bash
git add client/tests/mapview.test.tsx
git commit -m "test: add click-handler registration test for map"
```

---

### Task 9: Full-app smoke test

**Files:**
- Modify: `client/src/App.tsx` (only if smoke test surfaces issues)

- [ ] **Step 1: Manual smoke test (full app)**

Run: `npm run dev`
Expected: server on :3001, client on :5173; browser opens `http://localhost:5173`; map renders with tiles; planes appear over the Europe region within a few seconds; clicking a plane opens the details panel; region dropdown switches the polling bbox; Refresh now triggers an immediate poll; stale-data banner shows if the server is stopped (server still caches last good data in memory).

- [ ] **Step 2: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: wire refresh button and region selector"
```

---

### Task 10: AirLabs fallback provider (optional, stretch)

**Files:**
- Create: `server/src/providers/airlabs.ts`
- Create: `server/tests/airlabs.test.ts`
- Modify: `server/src/providers/factory.ts`

- [ ] **Step 1: Write the failing test `server/tests/airlabs.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { AirLabsProvider } from "../src/providers/airlabs";

describe("AirLabsProvider", () => {
  it("maps AirLabs flights to FlightState and filters missing positions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          response: [
            {
              hex: "a1b2c3",
              flight_iata: "UAL123",
              lat: 35.5,
              lng: -95.2,
              alt: 35000,
              dir: 92.4,
              speed: 900,
              status: "en-route",
              updated: 1754300000,
            },
            { hex: "deadbeef", lat: null, lng: null, status: "ground" },
          ],
        }),
      })
    );
    const provider = new AirLabsProvider({ apiKey: "test-key" });
    const states = await provider.fetchStates({ minLon: -10, minLat: 35, maxLon: 30, maxLat: 60 });
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      icao24: "a1b2c3",
      callsign: "UAL123",
      lat: 35.5,
      lon: -95.2,
      heading: 92.4,
      onGround: false,
    });
  });

  it("passes api_key and bbox params", async () => {
    const provider = new AirLabsProvider({ apiKey: "test-key" });
    await provider.fetchStates({ minLon: -10, minLat: 35, maxLon: 30, maxLat: 60 });
    const url = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(url).toContain("api_key=test-key");
    expect(url).toContain("bbox=-10,35,30,60");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w server`
Expected: FAIL — cannot find module `../src/providers/airlabs`.

- [ ] **Step 3: Write `server/src/providers/airlabs.ts`**

```typescript
import type { Bbox } from "../bbox";
import type { FlightState } from "../types";
import type { FlightProvider } from "./flight-provider";

interface AirLabsFlight {
  hex: string;
  flight_iata?: string | null;
  lat?: number | null;
  lng?: number | null;
  alt?: number | null;
  dir?: number | null;
  speed?: number | null;
  v_speed?: number | null;
  status?: string;
  updated?: number | null;
  flag?: string | null;
}

export class AirLabsProvider implements FlightProvider {
  name = "airlabs";

  constructor(private opts: { apiKey: string; baseUrl?: string }) {}

  async fetchStates(bbox: Bbox): Promise<FlightState[]> {
    const baseUrl = this.opts.baseUrl ?? "https://airlabs.co/api/v9";
    const params = new URLSearchParams({
      api_key: this.opts.apiKey,
      bbox: `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`,
    });
    const res = await fetch(`${baseUrl}/flights?${params}`);
    if (!res.ok) throw new Error(`AirLabs responded ${res.status}`);
    const body = (await res.json()) as { response: AirLabsFlight[] };

    return body.response
      .filter((f) => typeof f.lat === "number" && typeof f.lng === "number")
      .map((f) => ({
        icao24: f.hex,
        callsign: f.flight_iata || null,
        originCountry: f.flag || "",
        lat: f.lat ?? null,
        lon: f.lng ?? null,
        altitudeBaro: f.alt != null ? Math.round(f.alt * 0.3048) : null,
        altitudeGeo: null,
        velocity: f.speed != null ? f.speed / 3.6 : null,
        heading: f.dir ?? null,
        verticalRate: f.v_speed ?? null,
        squawk: null,
        positionSource: null,
        onGround: f.status === "ground",
        lastContact: f.updated ?? 0,
      }));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w server`
Expected: PASS — 2 tests.

- [ ] **Step 5: Wire AirLabs into `server/src/providers/factory.ts`**

```typescript
import { OpenSkyProvider } from "./opensky";
import { TokenManager } from "./token";
import { AirLabsProvider } from "./airlabs";
import type { FlightProvider } from "./flight-provider";

export function createProvider(env: NodeJS.ProcessEnv): FlightProvider {
  const provider = env.PROVIDER ?? "opensky";

  if (provider === "airlabs") {
    if (!env.AIRLABS_API_KEY) throw new Error("AIRLABS_API_KEY is required when PROVIDER=airlabs");
    return new AirLabsProvider({ apiKey: env.AIRLABS_API_KEY });
  }

  if (provider !== "opensky") throw new Error(`Unknown provider: ${provider}`);

  const baseUrl = env.OPENSKY_BASE_URL ?? "https://opensky-network.org/api";
  const tokenManager =
    env.OPENSKY_USERNAME && env.OPENSKY_PASSWORD
      ? new TokenManager({
          clientId: env.OPENSKY_USERNAME,
          clientSecret: env.OPENSKY_PASSWORD,
          baseUrl: "https://auth.opensky-network.org",
          tokenEndpoint: "/oauth2/token",
        })
      : null;
  return new OpenSkyProvider({ baseUrl }, tokenManager);
}
```

- [ ] **Step 6: Run all server tests**

Run: `npm run test -w server`
Expected: PASS — 9 tests.

- [ ] **Step 7: Commit**

```bash
git add server/src/providers/airlabs.ts server/tests/airlabs.test.ts server/src/providers/factory.ts
git commit -m "feat: add AirLabs fallback provider"
```

---

### Task 11: Final integration pass

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Full test run**

Run: `npm test`
Expected: all server + client tests pass.

- [ ] **Step 2: Full manual pass**

Run: `npm run dev`
Verify: map loads with tiles, planes render for Europe preset, details panel opens and closes, region switch changes polling, refresh button works, airports endpoint serves data, rate-limit banner appears when the proxy is throttled (simulate by setting a 1ms TTL and hammering the endpoint).

- [ ] **Step 3: Update README with run instructions and provider config table**

```markdown
## Providers

| PROVIDER value | Requires | Notes |
|---|---|---|
| `opensky` (default) | optional OPENSKY_USERNAME/PASSWORD | 4,000 cr/day registered vs 400 anonymous — register for free |
| `airlabs` | AIRLABS_API_KEY | 1,000 req/mo free, reduced fields |

Set PROVIDER / AIRLABS_API_KEY / OPENSKY_USERNAME / OPENSKY_PASSWORD in `server/.env`.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document providers and run instructions"
```
