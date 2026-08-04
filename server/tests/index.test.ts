import { describe, it, expect, vi } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import request from "supertest";
import { createApp } from "../src/app";
import type { FlightProvider } from "../src/providers/flight-provider";
import type { FlightState } from "../src/types";

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
