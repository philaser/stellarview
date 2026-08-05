import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import GlobeView from "../src/GlobeView";

const { createdPoints, raycasters, sceneAdd } = vi.hoisted(() => ({
  createdPoints: [] as any[],
  raycasters: [] as any[],
  sceneAdd: vi.fn(),
}));

const config: Record<string, unknown> = {};

vi.mock("globe.gl", () => ({
  default: class {
    scene() {
      return { add: sceneAdd, remove: () => {} };
    }
    camera() {
      return { isCamera: true };
    }
    getCoords(lat: number, lng: number, altitude = 0) {
      return { x: lng, y: lat, z: altitude };
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

vi.mock("three", () => {
  class BufferAttribute {
    array: Float32Array;
    itemSize: number;
    needsUpdate = false;
    constructor(array: Float32Array, itemSize: number) {
      this.array = array;
      this.itemSize = itemSize;
    }
    get count() {
      return this.array.length / this.itemSize;
    }
    setUsage() {
      return this;
    }
    setXYZ(i: number, x: number, y: number, z: number) {
      this.array[i * 3] = x;
      this.array[i * 3 + 1] = y;
      this.array[i * 3 + 2] = z;
    }
  }
  class BufferGeometry {
    attributes: Record<string, BufferAttribute> = {};
    setAttribute(name: string, attr: BufferAttribute) {
      this.attributes[name] = attr;
    }
    dispose() {}
  }
  class PointsMaterial {
    constructor(props: object) {
      Object.assign(this, props);
    }
    dispose() {}
  }
  class Points {
    geometry: BufferGeometry;
    material: PointsMaterial;
    visible = true;
    constructor(geometry: BufferGeometry, material: PointsMaterial) {
      this.geometry = geometry;
      this.material = material;
      createdPoints.push(this);
    }
  }
  class Raycaster {
    params = { Points: { threshold: 1 } };
    hits: Array<{ index: number | null }> = [];
    setFromCamera() {}
    intersectObject() {
      return this.hits;
    }
    constructor() {
      raycasters.push(this);
    }
  }
  class Color {
    r = 1;
    g = 1;
    b = 1;
    set() {}
  }
  class Vector2 {
    x: number;
    y: number;
    constructor(x = 0, y = 0) {
      this.x = x;
      this.y = y;
    }
  }
  return {
    BufferAttribute,
    BufferGeometry,
    PointsMaterial,
    Points,
    Raycaster,
    Color,
    Vector2,
    DynamicDrawUsage: Symbol("DynamicDrawUsage"),
  };
});

const positions = [
  { catnr: 1, lat: 10, lon: 20, altKm: 420, velocityKms: 7.6, color: "#38bdf8", selected: false },
  { catnr: 2, lat: -30, lon: 60, altKm: 35786, velocityKms: 3.1, color: "#fbbf24", selected: false },
];

describe("GlobeView", () => {
  beforeEach(() => {
    createdPoints.length = 0;
    raycasters.length = 0;
    sceneAdd.mockClear();
    for (const k of Object.keys(config)) delete config[k];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [] }) }));
  });

  it("renders satellites as a single base Points layer with altitude-normalized positions", () => {
    render(<GlobeView positions={positions} selectedOrbit={null} selectedCatnr={null} onSelect={() => {}} />);
    const base = createdPoints.find((p) => p.geometry.attributes.position.count === 2);
    expect(base).toBeDefined();
    expect(base.material.size).toBe(0.012);
    const pos = base.geometry.attributes.position.array as number[];
    expect(pos[2]).toBeCloseTo(420 / 6371, 3);
    expect(pos[5]).toBeCloseTo(0.35, 5);
    expect(base.geometry.attributes.color).toBeDefined();
    expect(sceneAdd).toHaveBeenCalledTimes(1); // base + highlight added in one scene.add call
    expect(sceneAdd.mock.calls[0]).toHaveLength(2);
    expect(config.particlesData).toBeUndefined(); // no per-satellite particle layers anymore
  });

  it("reports clicks via onSelect", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <GlobeView positions={positions} selectedOrbit={null} selectedCatnr={null} onSelect={onSelect} />
    );
    const raycaster = raycasters.at(-1)!;
    raycaster.hits = [{ index: 1 }];
    fireEvent.click(container.querySelector(".map")!, { clientX: 10, clientY: 10 });
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("highlights the hovered satellite in the highlight layer", () => {
    const { container } = render(
      <GlobeView positions={positions} selectedOrbit={null} selectedCatnr={null} onSelect={() => {}} />
    );
    const highlight = createdPoints.find((p) => p.geometry.attributes.position.count === 1)!;
    expect(highlight.visible).toBe(false);
    const raycaster = raycasters.at(-1)!;
    raycaster.hits = [{ index: 0 }];
    fireEvent.pointerMove(container.querySelector(".map")!, { clientX: 10, clientY: 10 });
    expect(highlight.visible).toBe(true);
    expect((container.querySelector(".map") as HTMLElement).style.cursor).toBe("pointer");
    raycaster.hits = [];
    fireEvent.pointerMove(container.querySelector(".map")!, { clientX: 5, clientY: 5 });
    expect(highlight.visible).toBe(false);
  });

  it("shows the highlight layer for the selected satellite", () => {
    render(<GlobeView positions={positions} selectedOrbit={null} selectedCatnr={2} onSelect={() => {}} />);
    const highlight = createdPoints.find((p) => p.geometry.attributes.position.count === 1)!;
    expect(highlight.visible).toBe(true);
    const pos = highlight.geometry.attributes.position.array as number[];
    expect(pos[2]).toBeCloseTo(0.35, 5); // sat 2's altitude (capped GEO)
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
    expect((config.labelsData as unknown[]).length).toBe(1);
  });

  it("has no path when no satellite is selected", () => {
    render(<GlobeView positions={positions} selectedOrbit={null} selectedCatnr={null} onSelect={() => {}} />);
    expect(config.pathsData).toBeUndefined();
  });
});
