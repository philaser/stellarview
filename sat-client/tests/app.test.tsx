import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import App from "../src/App";

const ISS_BLOCK = `ISS (ZARYA)
1 25544U 98067A   26215.79638706  .00007444  00000+0  14146-3 0  9999
2 25544  51.6316  64.4821 0007224   9.2337 350.8783 15.49332738579132
`;

let capturedClick: ((e: unknown) => void) | null = null;
let clickHitsFeature = true;
let geoMock: ReturnType<typeof vi.fn>;

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
  geoMock = vi.fn();
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => ISS_BLOCK }));
  vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition: geoMock } });
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
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText(/satellites loaded/)).toBeInTheDocument();
  });

  it("opens the details panel on satellite click", async () => {
    geoMock.mockImplementation(
      (ok: (p: { coords: { latitude: number; longitude: number } }) => void) =>
        ok({ coords: { latitude: 40.0, longitude: -74.0 } })
    );
    render(<App />);
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    await act(async () => {
      capturedClick!({ point: { x: 0, y: 0 } });
    });
    expect(screen.getByText("ISS (ZARYA)")).toBeInTheDocument();
  });

  it("sets the observer point on empty-map click", async () => {
    render(<App />);
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    clickHitsFeature = false;
    await act(async () => {
      capturedClick!({ lngLat: { lng: 2.35, lat: 48.86 } });
    });
    expect(screen.getByText(/observer/i)).toBeInTheDocument();
  });

  it("shows a banner when the TLE fetch fails", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network"));
    render(<App />);
    await act(async () => {});
    expect(screen.getByText("TLE provider unreachable")).toBeInTheDocument();
  });
});
