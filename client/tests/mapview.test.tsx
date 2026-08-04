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
    flyTo() {}
    getSource() {
      return undefined;
    }
    queryRenderedFeatures() {
      return [
        { properties: { icao24: "a1b2c3", callsign: "UAL123", altitudeBaro: 10668 } },
      ];
    }
  },
  Map: class {
    on(evt: string, cb: (e: unknown) => void) {
      if (evt === "click") capturedClickHandler = cb;
    }
    addSource() {}
    addLayer() {}
    remove() {}
    flyTo() {}
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
