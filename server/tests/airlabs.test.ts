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
