import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import App from "../src/App";

let appClickHandler: ((e: unknown) => void) | null = null;
let clickFeatureIcao = "a1b2c3";

vi.mock("maplibre-gl", () => {
  class MockMap {
    constructor() {}
    on(evt: string, cb: (e: unknown) => void) {
      if (evt === "click") appClickHandler = cb as (e: unknown) => void;
    }
    addSource() {}
    addLayer() {}
    removeLayer() {}
    removeSource() {}
    remove() {}
    getSource() {
      return undefined;
    }
    getLayer() {
      return undefined;
    }
    flyTo() {}
    fitBounds() {}
    getZoom() { return 4; }
    hasImage() { return false; }
    addImage() {}
    queryRenderedFeatures() {
      return [{ properties: { icao24: clickFeatureIcao, callsign: "UAL123" } }];
    }
  }
  return { default: MockMap, Map: MockMap };
});

const flight = {
  icao24: "a1b2c3",
  callsign: "UAL123",
  originCountry: "United States",
  lat: 35.5,
  lon: -95.2,
  altitudeBaro: 10668,
  altitudeGeo: 10712,
  velocity: 250.3,
  heading: 92.4,
  verticalRate: 0.5,
  squawk: "1200",
  positionSource: 0,
  onGround: false,
  lastContact: 1_725_000_000,
};
const response = { flights: [flight], stale: false, rateLimited: false, fetchedAt: Date.now() };
const fetchMock = vi.fn();

beforeEach(() => {
  appClickHandler = null;
  clickFeatureIcao = "a1b2c3";
  vi.useFakeTimers();
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => response });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

describe("App", () => {
  it("polls every 20s", async () => {
    render(<App />);
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("visibility refresh does not start a second chain", async () => {
    render(<App />);
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("resumes the polling chain when the tab becomes visible", async () => {
    render(<App />);
    await act(async () => {});
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await act(async () => { vi.advanceTimersByTime(40_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("region change triggers polling of the new bbox", async () => {
    render(<App />);
    await act(async () => {});

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "us" } });
    await act(async () => {});

    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("bbox=-125,24,-66,50");
  });

  it("ignores an older region response that arrives after a newer one", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    fetchMock.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
    render(<App />);
    await act(async () => {});

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "us" } });
    await act(async () => {});
    resolvers[1]({ ok: true, json: async () => ({ ...response, flights: [{ ...flight, callsign: "NEW100" }] }) });
    await act(async () => {});
    resolvers[0]({ ok: true, json: async () => ({ ...response, flights: [{ ...flight, callsign: "OLD100" }] }) });
    await act(async () => {});

    expect(screen.getByText("1 aircraft in Continental US")).toBeInTheDocument();
    expect(screen.queryByText("OLD100")).not.toBeInTheDocument();
  });

  it("searches the loaded region by callsign and ICAO", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ...response, flights: [flight, { ...flight, icao24: "beef42", callsign: "EZY87MY" }] }),
    });
    render(<App />);
    await act(async () => {});
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "ezy" } });
    expect(screen.getByText("1 of 2 aircraft shown")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /EZY87MY/i })).toBeInTheDocument();
    await act(async () => { fireEvent.keyDown(search, { key: "Enter" }); });
    expect(screen.getByRole("heading", { name: "EZY87MY" })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "missing" } });
    expect(screen.getByText("No aircraft match “missing” in this region.")).toBeInTheDocument();
  });

  it("rate-limited response shows banner", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ flights: [], stale: false, rateLimited: true, fetchedAt: Date.now() }),
    });
    render(<App />);
    await act(async () => {});

    expect(screen.getByText("Rate limited — showing cached data")).toBeInTheDocument();
  });

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
    await act(async () => {
      appClickHandler!({ point: { x: 0, y: 0 } });
    });
    await act(async () => {});
    const calls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.startsWith("/api/track?icao24=a1b2c3"))).toBe(true);
  });

  it("keeps selected details in sync with the newest flight batch and explains disappearance", async () => {
    const batches = [response, { ...response, flights: [{ ...flight, velocity: 300 }] }, { ...response, flights: [] }];
    fetchMock.mockImplementation((url: string) => Promise.resolve({
      ok: true,
      json: async () => url.startsWith("/api/track") ? { track: null, stale: false, rateLimited: false } : batches.shift(),
    }));
    render(<App />);
    await act(async () => {});
    await act(async () => { appClickHandler!({ point: { x: 0, y: 0 } }); });
    await act(async () => {});
    expect(screen.getByText("901 km/h")).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(screen.getByText("1080 km/h")).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(screen.getByText("This aircraft is no longer in the latest regional snapshot.")).toBeInTheDocument();
  });

  it("refreshes the track every 60s while selected", async () => {
    fetchMock.mockImplementation((url: string) => Promise.resolve({ ok: true, json: async () => url.startsWith("/api/track") ? trackResponse : response }));
    render(<App />);
    await act(async () => {});
    await act(async () => {
      appClickHandler!({ point: { x: 0, y: 0 } });
    });
    await act(async () => {});
    const trackCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("/api/track"));
    expect(trackCalls()).toHaveLength(1);
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(trackCalls()).toHaveLength(2);
    expect(String(trackCalls()[1][0])).toContain("icao24=a1b2c3");
  });

  it("stops refreshing the track after Close", async () => {
    fetchMock.mockImplementation((url: string) => Promise.resolve({ ok: true, json: async () => url.startsWith("/api/track") ? trackResponse : response }));
    render(<App />);
    await act(async () => {});
    await act(async () => {
      appClickHandler!({ point: { x: 0, y: 0 } });
    });
    await act(async () => {});
    const trackCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("/api/track")).length;
    expect(trackCalls()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(trackCalls()).toBe(1);
  });

  it("does not refresh the track while the tab is hidden", async () => {
    fetchMock.mockImplementation((url: string) => Promise.resolve({ ok: true, json: async () => url.startsWith("/api/track") ? trackResponse : response }));
    render(<App />);
    await act(async () => {});
    await act(async () => {
      appClickHandler!({ point: { x: 0, y: 0 } });
    });
    await act(async () => {});
    const trackCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("/api/track")).length;
    expect(trackCalls()).toBe(1);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(trackCalls()).toBe(1);
  });

  it("ignores a stale track response after switching planes", async () => {
    const resolvers: Array<(v: unknown) => void> = [];
    fetchMock.mockImplementation((url: string) =>
      url.startsWith("/api/track")
        ? new Promise((resolve) => resolvers.push(resolve))
        : Promise.resolve({ ok: true, json: async () => ({ ...response, flights: [flight, { ...flight, icao24: "deadbe", callsign: "DAL42" }] }) })
    );
    const trackA = {
      ...trackResponse,
      track: {
        ...trackResponse.track,
        icao24: "a1b2c3",
        points: Array.from({ length: 99 }, (_, i) => ({ t: i, lat: 35, lon: -95, altBaro: 10000 })),
      },
    };
    const trackB = {
      ...trackResponse,
      track: {
        ...trackResponse.track,
        icao24: "deadbe",
        points: [
          { t: 1, lat: 36, lon: -94, altBaro: 9000 },
          { t: 2, lat: 36.1, lon: -94.1, altBaro: 9100 },
        ],
      },
    };

    clickFeatureIcao = "a1b2c3";
    render(<App />);
    await act(async () => {});
    await act(async () => {
      appClickHandler!({ point: { x: 0, y: 0 } });
    });
    await act(async () => {});
    clickFeatureIcao = "deadbe";
    await act(async () => {
      appClickHandler!({ point: { x: 0, y: 0 } });
    });
    await act(async () => {});

    expect(screen.getByText("Track unavailable")).toBeInTheDocument();

    resolvers[1]({ ok: true, json: async () => trackB }); // plane B's response lands first
    await act(async () => {});
    expect(screen.getByText("Track: 2 points")).toBeInTheDocument();

    resolvers[0]({ ok: true, json: async () => trackA }); // stale: plane A's response lands late
    await act(async () => {});
    expect(screen.queryByText("Track: 99 points")).toBeNull();
    expect(screen.getByText("Track: 2 points")).toBeInTheDocument();

    const lastTrackCall = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("/api/track")).at(-1);
    expect(String(lastTrackCall?.[0])).toContain("icao24=deadbe");
  });

  it("shows Track unavailable and clears on close", async () => {
    fetchMock.mockImplementation((url: string) => Promise.resolve({ ok: true, json: async () => url.startsWith("/api/track") ? { track: null, stale: false, rateLimited: false } : response }));
    render(<App />);
    await act(async () => {});
    await act(async () => {
      appClickHandler!({ point: { x: 0, y: 0 } });
    });
    await act(async () => {});
    expect(screen.getByText("Track unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(screen.queryByText("Track unavailable")).not.toBeInTheDocument();
  });
});
