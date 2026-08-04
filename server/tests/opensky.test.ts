import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenSkyProvider } from "../src/providers/opensky";

// Time-relative fixture: the freshness filter compares against Date.now()/1000,
// so fixed timestamps would go stale. Use now-5 for timePosition, now-10 for lastContact.
const now = Math.floor(Date.now() / 1000);
const sampleStates = {
  time: now,
  states: [
    [
      "a1b2c3",
      "UAL123 ",
      "United States",
      now - 5,
      now - 10,
      -95.2,
      35.5,
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
    ["deadbeef", null, "Germany", now - 10_000, now - 10, null, null, null, null, null, null, null, null, null, null, false, 0],
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
    expect(states).toHaveLength(1);
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
      vi.fn().mockResolvedValue({ ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) })
    );
    const provider = new OpenSkyProvider({ baseUrl: "https://opensky-network.org/api" });
    await expect(
      provider.fetchStates({ minLon: -10, minLat: 35, maxLon: 30, maxLat: 60 })
    ).rejects.toThrow("429");
  });
});
