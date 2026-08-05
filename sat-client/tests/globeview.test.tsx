import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import GlobeView from "../src/GlobeView";

const handlers: Record<string, (arg: unknown) => void> = {};
const config: Record<string, unknown> = {};

vi.mock("globe.gl", () => ({
  default: class {
    constructor() {}
    onPointClick(cb: (p: unknown) => void) {
      handlers.onPointClick = cb;
      return this;
    }
    onPointHover(cb: (p: unknown) => void) {
      handlers.onPointHover = cb;
      return this;
    }
    pointsData(d: unknown) {
      config.pointsData = d;
      return this;
    }
    pointLat() {
      return this;
    }
    pointLng() {
      return this;
    }
    pointAltitude() {
      return this;
    }
    pointColor() {
      return this;
    }
    pointRadius() {
      return this;
    }
    polygonsData(d: unknown) {
      config.polygonsData = d;
      return this;
    }
    polygonCapColor() {
      return this;
    }
    polygonSideColor() {
      return this;
    }
    polygonStrokeColor() {
      return this;
    }
    polygonAltitude() {
      return this;
    }
    // pathsData only records non-empty data; an empty array means "no orbit shown"
    pathsData(d: unknown) {
      if (Array.isArray(d) && d.length > 0) config.pathsData = d;
      return this;
    }
    pathPoints() {
      return this;
    }
    pathPointLat() {
      return this;
    }
    pathPointLng() {
      return this;
    }
    pathPointAlt() {
      return this;
    }
    pathColor() {
      return this;
    }
    pathStroke() {
      return this;
    }
    pathDashLength() {
      return this;
    }
    pathDashGap() {
      return this;
    }
    pathDashInitialGap() {
      return this;
    }
    labelsData(d: unknown) {
      config.labelsData = d;
      return this;
    }
    labelLat() {
      return this;
    }
    labelLng() {
      return this;
    }
    labelText() {
      return this;
    }
    labelColor() {
      return this;
    }
    labelSize() {
      return this;
    }
    labelAltitude() {
      return this;
    }
    labelResolution() {
      return this;
    }
    backgroundColor() {
      return this;
    }
    showAtmosphere() {
      return this;
    }
    atmosphereColor() {
      return this;
    }
    showGraticules() {
      return this;
    }
    pointOfView() {
      return this;
    }
    _destructor() {}
  },
}));

describe("GlobeView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(handlers)) delete handlers[k];
    for (const k of Object.keys(config)) delete config[k];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [] }) }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const positions = [
    { catnr: 1, lat: 10, lon: 20, altKm: 420, velocityKms: 7.6, color: "#38bdf8", selected: false },
    { catnr: 2, lat: -30, lon: 60, altKm: 35786, velocityKms: 3.1, color: "#fbbf24", selected: false },
  ];

  it("renders positions as points with globe-radius-normalized altitude, capped to a readable shell", () => {
    render(<GlobeView positions={positions} selectedOrbit={null} selectedCatnr={null} onSelect={() => {}} />);
    const data = config.pointsData as Array<{ altR: number }>;
    expect(data).toHaveLength(2);
    expect(data[0].altR).toBeCloseTo(420 / 6371, 3);
    expect(data[1].altR).toBe(0.35);
  });

  it("reports clicks via onSelect", () => {
    const onSelect = vi.fn();
    render(<GlobeView positions={positions} selectedOrbit={null} selectedCatnr={null} onSelect={onSelect} />);
    handlers.onPointClick?.({ catnr: 2 });
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("renders the selected orbit as a path and the selected satellite as a label", () => {
    render(
      <GlobeView
        positions={positions}
        selectedOrbit={[[0, 10], [10, 20], [20, 30]]}
        selectedCatnr={1}
        onSelect={() => {}}
      />
    );
    expect(config.pathsData).toBeDefined();
    expect((config.pathsData as unknown[]).length).toBeGreaterThan(0);
    expect(config.labelsData).toBeDefined();
  });

  it("has no path when no satellite is selected", () => {
    render(<GlobeView positions={positions} selectedOrbit={null} selectedCatnr={null} onSelect={() => {}} />);
    expect(config.pathsData).toBeUndefined();
  });
});
