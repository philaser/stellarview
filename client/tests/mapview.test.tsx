import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import MapView, { altitudeColor } from "../src/MapView";

let capturedClickHandler: ((e: unknown) => void) | null = null;
let loadHandler: (() => void) | null = null;
const addSourceMock = vi.hoisted(() => vi.fn());
const addLayerMock = vi.hoisted(() => vi.fn());

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
    }
    flyTo() {}
    remove() {}
    getSource() {
      return undefined;
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
    render(<MapView bounds={[-10, 35, 30, 60]} flights={flights} onSelect={() => {}} />);
    expect(addSourceMock).not.toHaveBeenCalled();
    expect(loadHandler).not.toBeNull();
    act(() => {
      loadHandler!();
    });
    expect(addSourceMock).toHaveBeenCalled();
    expect(addLayerMock).toHaveBeenCalled();
  });
});
