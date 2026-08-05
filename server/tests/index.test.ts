import { describe, it, expect, vi } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import { execFile } from "child_process";
import { readFile, writeFile } from "fs/promises";
import request from "supertest";
import { createApp } from "../src/app";
import type { FlightProvider, TrackSource } from "../src/providers/flight-provider";
import type { FlightState, FlightTrack } from "../src/types";

vi.mock("child_process", async () => {
  const actual = await vi.importActual<typeof import("child_process")>("child_process");
  return { ...actual, execFile: vi.fn() };
});

vi.mock("fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(new Error("no cache file")),
}));

// promisify(execFile) resolves via the callback, so the mock must invoke it.
function stubCurl(stdout: string) {
  vi.mocked(execFile).mockImplementation(((
    _file: string,
    _args: readonly string[] | undefined,
    _options: Record<string, unknown>,
    cb: (err: Error | null, result: { stdout: string; stderr: string }) => void
  ) => {
    cb(null, { stdout, stderr: "" });
    return undefined as unknown as ReturnType<typeof execFile>;
  }) as typeof execFile);
}

function stubCurlFailure() {
  vi.mocked(execFile).mockImplementation(((
    _file: string,
    _args: readonly string[] | undefined,
    _options: Record<string, unknown>,
    cb: (err: Error | null, result: { stdout: string; stderr: string }) => void
  ) => {
    cb(new Error("curl failed"), { stdout: "", stderr: "" });
    return undefined as unknown as ReturnType<typeof execFile>;
  }) as typeof execFile);
}

const flight: FlightState = {
  icao24: "mock1",
  callsign: null,
  originCountry: "Testland",
  lat: 50,
  lon: 10,
  altitudeBaro: null,
  altitudeGeo: null,
  velocity: null,
  heading: null,
  verticalRate: null,
  squawk: null,
  positionSource: null,
  onGround: false,
  lastContact: 0,
};

const okProvider: FlightProvider = {
  name: "mock",
  fetchStates: async () => [flight],
};

const errorProvider: FlightProvider = {
  name: "mock",
  fetchStates: async () => {
    const e = new Error("429") as Error & { status?: number };
    e.status = 429;
    throw e;
  },
};

const BBOX = "?bbox=-10,45,10,55";

describe("proxy /api/flights", () => {
  it("returns flights from the provider", async () => {
    const app = createApp({ provider: okProvider });
    const res = await request(app).get(`/api/flights${BBOX}`);
    expect(res.status).toBe(200);
    expect(res.body.flights).toHaveLength(1);
    expect(res.body.flights[0].icao24).toBe("mock1");
    expect(res.body.stale).toBe(false);
    expect(res.body.rateLimited).toBe(false);
    expect(typeof res.body.fetchedAt).toBe("number");
  });

  it("rejects an invalid bbox with 400", async () => {
    const app = createApp({ provider: okProvider });
    const res = await request(app).get("/api/flights?bbox=abc");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid bbox" });
  });

  it("serves a stale fallback when the provider rate-limits after priming", async () => {
    const provider: FlightProvider = {
      name: "mock",
      fetchStates: vi.fn().mockResolvedValue([flight]),
    };
    const app = createApp({ provider, cacheTtlMs: 1 });

    const first = await request(app).get(`/api/flights${BBOX}`);
    expect(first.status).toBe(200);
    expect(first.body.stale).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 5));

    provider.fetchStates = async () => {
      const e = new Error("429") as Error & { status?: number };
      e.status = 429;
      throw e;
    };

    const second = await request(app).get(`/api/flights${BBOX}`);
    expect(second.status).toBe(200);
    expect(second.body.stale).toBe(true);
    expect(second.body.rateLimited).toBe(true);
    expect(second.body.flights[0].icao24).toBe("mock1");
  });

  it("returns 502 when the provider is unreachable and no fallback exists", async () => {
    const app = createApp({ provider: errorProvider });
    const res = await request(app).get(`/api/flights${BBOX}`);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "provider unreachable", rateLimited: true });
  });
});

describe("proxy /api/airports", () => {
  const app = createApp({ provider: okProvider });

  function startServer(): Promise<{ server: http.Server; port: number }> {
    return new Promise((resolve) => {
      const server = app.listen(0, () => {
        resolve({ server, port: (server.address() as AddressInfo).port });
      });
    });
  }

  it("serves the airport dataset", async () => {
    const { server, port } = await startServer();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/airports`);
      expect(res.status).toBe(200);
      const airports = (await res.json()) as { ident: string }[];
      expect(airports.length).toBeGreaterThan(0);
    } finally {
      server.close();
    }
  });

  it("survives a client that aborts mid-transfer", async () => {
    const { server, port } = await startServer();
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/api/airports`, (res) => {
          res.destroy();
          setTimeout(resolve, 300);
        });
        req.on("error", () => {});
        setTimeout(() => reject(new Error("timed out")), 2000);
      });
    } finally {
      server.close();
    }
    // An uncaught ERR_HTTP_HEADERS_SENT from the sendFile error callback
    // would surface as an unhandled error and fail the run.
  });
});

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

  it("serves the cached track without re-fetching once warm", async () => {
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
    expect(res.body.rateLimited).toBe(false);
    expect(fetchTrack).toHaveBeenCalledTimes(1);
  });

  it("returns 501 when the provider does not support tracks", async () => {
    const plain: FlightProvider = { name: "mock-plain", fetchStates: async () => [] };
    const app = createApp({ provider: plain });
    const res = await request(app).get("/api/track?icao24=a1b2c3");
    expect(res.status).toBe(501);
  });
});

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
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("CATNR=25544");
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain("CATNR=20580");
    vi.unstubAllGlobals();
  });

  it("filters out upstream 'No GP data' responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: async () => (String(url).includes("99999") ? "No GP data found for: 99999\n" : tleBlock),
        })
      )
    );
    const app = createApp({ provider: okProvider });
    const res = await request(app).get("/api/tle?catnr=25544,99999");
    expect(res.status).toBe(200);
    expect(res.text).toContain("ISS (ZARYA)");
    expect(res.text).not.toContain("No GP data");
    vi.unstubAllGlobals();
  });

  it("returns 502 when CelesTrak is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "" }));
    stubCurlFailure();
    const app = createApp({ provider: okProvider });
    const res = await request(app).get("/api/tle?catnr=25544");
    expect(res.status).toBe(502);
    vi.unstubAllGlobals();
  });

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
    expect(vi.mocked(writeFile)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeFile)).toHaveBeenCalledWith(
      expect.stringContaining("tle-active.cache"),
      expect.stringContaining("ISS (ZARYA)")
    );
    const res2 = await request(app).get("/api/tle?group=active");
    expect(res2.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1); // cached
    vi.unstubAllGlobals();
  });

  it("primes the group cache from the disk cache file on boot", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => tleBlock }));
    vi.mocked(readFile).mockResolvedValueOnce(tleBlock);
    const app = createApp({ provider: okProvider });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const res = await request(app).get("/api/tle?group=active");
    expect(res.status).toBe(200);
    expect(res.text).toContain("ISS (ZARYA)");
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("rejects unknown groups and combined catnr+group", async () => {
    const app = createApp({ provider: okProvider });
    const res1 = await request(app).get("/api/tle?group=debris");
    expect(res1.status).toBe(400);
    const res2 = await request(app).get("/api/tle?catnr=25544&group=active");
    expect(res2.status).toBe(400);
  });

  it("falls back to curl when CelesTrak 403s the fetch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "" }));
    vi.mocked(execFile).mockClear();
    stubCurl(tleBlock);
    const app = createApp({ provider: okProvider });
    const res = await request(app).get("/api/tle?group=active");
    expect(res.status).toBe(200);
    expect(res.text).toContain("ISS (ZARYA)");
    expect(vi.mocked(execFile)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(execFile).mock.calls[0][0]).toBe("curl");
    const curlArgs = String(vi.mocked(execFile).mock.calls[0][1]);
    expect(curlArgs).toContain("GROUP=active");
    vi.unstubAllGlobals();
  });
});
