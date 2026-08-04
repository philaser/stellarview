import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import MapView, { altitudeColor } from "../src/MapView";

vi.mock("maplibre-gl", () => {
  class MockMap {
    constructor() {}
    on() {}
    addSource() {}
    addLayer() {}
    remove() {}
    getSource() {
      return undefined;
    }
    flyTo() {}
  }
  return { default: MockMap, Map: MockMap };
});

describe("MapView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
