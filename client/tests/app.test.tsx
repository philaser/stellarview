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
    queryRenderedFeatures() {
      return [{ properties: { icao24: clickFeatureIcao, callsign: "UAL123" } }];
    }
  }
  return { default: MockMap, Map: MockMap };
});

const response = { flights: [], stale: false, rateLimited: false, fetchedAt: Date.now() };
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

    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("region change triggers polling of the new bbox", async () => {
    render(<App />);
    await act(async () => {});

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "us" } });
    await act(async () => {});

    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("bbox=-125,24,-66,50"));
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

  it("refreshes the track every 60s while selected", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => trackResponse });
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
    fetchMock.mockResolvedValue({ ok: true, json: async () => trackResponse });
    render(<App />);
    await act(async () => {});
    await act(async () => {
      appClickHandler!({ point: { x: 0, y: 0 } });
    });
    await act(async () => {});
    const trackCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("/api/track")).length;
    expect(trackCalls()).toBe(1);
    fireEvent.click(screen.getByText("Close"));
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(trackCalls()).toBe(1);
  });

  it("does not refresh the track while the tab is hidden", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => trackResponse });
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
        : Promise.resolve({ ok: true, json: async () => response })
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

    resolvers[1]({ ok: true, json: async () => trackB }); // plane B's response lands first
    await act(async () => {});
    expect(screen.getByText("2 pts")).toBeInTheDocument();

    resolvers[0]({ ok: true, json: async () => trackA }); // stale: plane A's response lands late
    await act(async () => {});
    expect(screen.queryByText("99 pts")).toBeNull();
    expect(screen.getByText("2 pts")).toBeInTheDocument();

    const lastTrackCall = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("/api/track")).at(-1);
    expect(String(lastTrackCall?.[0])).toContain("icao24=deadbe");
  });

  it("shows Track unavailable and clears on close", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ track: null, stale: false, rateLimited: false }) });
    render(<App />);
    await act(async () => {});
    await act(async () => {
      appClickHandler!({ point: { x: 0, y: 0 } });
    });
    await act(async () => {});
    expect(screen.getByText("unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Close"));
    expect(screen.queryByText("unavailable")).not.toBeInTheDocument();
  });
});
