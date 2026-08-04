import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import MapView, { altitudeColor } from "../src/MapView";

let capturedClickHandler: ((e: unknown) => void) | null = null;
let loadHandler: (() => void) | null = null;
const addSourceMock = vi.hoisted(() => vi.fn());
const addLayerMock = vi.hoisted(() => vi.fn());
const removeLayerMock = vi.hoisted(() => vi.fn());
const addedLayers = vi.hoisted(() => [] as string[]);

vi.mock("maplibre-gl", () => {
  class MockMap {
    on(evt: string, cb: (e: unknown) => void) {
      if (evt === "click") capturedClickHandler = cb as (e: unknown) => void;
      if (evt === "load") loadHandler = cb as () => void;
    }
    addSource(...args: unknown[]) {
      if (!loadHandler) throw new Error("Style is not done loading");
      addSourceMock(...args);
    }
    addLayer(...args: unknown[]) {
      if (!loadHandler) throw new Error("Style is not done loading");
      addLayerMock(...args);
      addedLayers.push((args[0] as { id: string }).id);
    }
    removeLayer(...args: unknown[]) {
      if (!loadHandler) throw new Error("Style is not done loading");
      removeLayerMock(...args);
      const idx = addedLayers.indexOf(args[0] as string);
      if (idx !== -1) addedLayers.splice(idx, 1);
    }
    removeSource() {}
    flyTo() {}
    remove() {}
    getSource() {
      return undefined;
    }
    getLayer(id: string) {
      return addedLayers.includes(id) ? {} : undefined;
    }
    queryRenderedFeatures() {
      return [
        { properties: { icao24: "a1b2c3", callsign: "UAL123", altitudeBaro: 10668 } },
      ];
    }
  }
  return { default: MockMap, Map: MockMap };
});

describe("MapView", () => {
  beforeEach(() => {
    capturedClickHandler = null;
    loadHandler = null;
    addSourceMock.mockClear();
    addLayerMock.mockClear();
    removeLayerMock.mockClear();
    addedLayers.length = 0;
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
        track={null}
        onSelect={() => {}}
      />
    );
    expect(document.querySelector(".map")).toBeInTheDocument();
  });

  it("registers a click handler on the map", () => {
    render(<MapView bounds={[-10, 35, 30, 60]} flights={[]} track={null} onSelect={() => {}} />);
    expect(capturedClickHandler).not.toBeNull();
  });

  it("waits for the style load event before adding sources", () => {
    const flights = [
      {
        icao24: "a1b2c3",
        callsign: "UAL123",
        originCountry: "United States",
        lat: 35.5,
        lon: -95.2,
        altitudeBaro: 10668,
        altitudeGeo: null,
        velocity: 250.3,
        heading: 92.4,
        verticalRate: 0.5,
        squawk: "1200",
        positionSource: 0,
        onGround: false,
        lastContact: Date.now() / 1000,
      },
    ];
    render(<MapView bounds={[-10, 35, 30, 60]} flights={flights} track={null} onSelect={() => {}} />);
    expect(addSourceMock).not.toHaveBeenCalled();
    expect(loadHandler).not.toBeNull();
    act(() => {
      loadHandler!();
    });
    expect(addSourceMock).toHaveBeenCalled();
    expect(addLayerMock).toHaveBeenCalled();
  });

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
    act(() => {
      loadHandler!();
    });
    expect(addSourceMock).toHaveBeenCalledWith(
      "track-source",
      expect.objectContaining({ type: "geojson" })
    );
    expect(addLayerMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "track-line", type: "line" }),
      "flights-layer"
    );
  });

  it("removes the track line when track becomes null", () => {
    const { rerender } = render(
      <MapView bounds={[-10, 35, 30, 60]} flights={[]} track={sampleTrack} onSelect={() => {}} />
    );
    act(() => {
      loadHandler!();
    });
    rerender(<MapView bounds={[-10, 35, 30, 60]} flights={[]} track={null} onSelect={() => {}} />);
    expect(removeLayerMock).toHaveBeenCalledWith("track-line");
  });
});
