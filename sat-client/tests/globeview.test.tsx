import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import GlobeView, { findNearest, dotSizeFor } from "../src/GlobeView";

const { createdPoints, sceneAdd, controlsListeners, cameraState, labelsDataMock, labelTextAccessor } = vi.hoisted(() => ({
  createdPoints: [] as any[],
  sceneAdd: vi.fn(),
  controlsListeners: {} as Record<string, (() => void) | null>,
  // camera sits 10 units from the globe origin at the initial pointOfView (refDist = 10)
  cameraState: { x: 0, y: 0, z: 10 },
  labelsDataMock: vi.fn(),
  labelTextAccessor: { current: null as ((d: unknown) => string) | null },
}));

const config: Record<string, unknown> = {};

vi.mock("globe.gl", () => ({
  default: class {
    scene() {
      return { add: sceneAdd, remove: () => {} };
    }
    camera() {
      return {
        isCamera: true,
        position: {
          x: cameraState.x,
          y: cameraState.y,
          z: cameraState.z,
          distanceTo: (v: { x: number; y: number; z: number }) =>
            Math.hypot(cameraState.x - v.x, cameraState.y - v.y, cameraState.z - v.z),
        },
      };
    }
    controls() {
      return {
        target: { x: 0, y: 0, z: 0 },
        addEventListener: (evt: string, fn: () => void) => {
          controlsListeners[evt] = fn;
        },
        removeEventListener: () => {},
      };
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
      labelsDataMock(d);
      config.labelsData = d;
      return this;
    }
    labelLat() {
      return this;
    }
    labelLng() {
      return this;
    }
    labelText(fn: (d: unknown) => string) {
      labelTextAccessor.current = fn;
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
  class Color {
    r = 1;
    g = 1;
    b = 1;
    set() {}
  }
  class Vector3 {
    x = 0;
    y = 0;
    z = 0;
    set(x: number, y: number, z: number) {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }
    project() {
      // Deterministic NDC so the screen-space hit path works in jsdom.
      this.x = this.x / 100;
      this.y = this.y / 100;
      this.z = 0;
      return this;
    }
  }
  return {
    BufferAttribute,
    BufferGeometry,
    PointsMaterial,
    Points,
    Color,
    Vector3,
    DynamicDrawUsage: Symbol("DynamicDrawUsage"),
  };
});

const positions = [
  { catnr: 1, lat: 10, lon: 20, altKm: 420, velocityKms: 7.6, color: "#38bdf8", selected: false },
  { catnr: 2, lat: -30, lon: 60, altKm: 35786, velocityKms: 3.1, color: "#fbbf24", selected: false },
];

const satNames = { 1: "Sat One", 2: "Sat Two" };

// 800x600 container rect so screen-space projection yields deterministic pixels.
const mapRect = () =>
  ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
  }) as DOMRect;

const renderGlobe = (props: Partial<Parameters<typeof GlobeView>[0]> = {}) => {
  const { container } = render(
    <GlobeView
      positions={positions}
      satNames={satNames}
      selectedOrbit={null}
      selectedCatnr={null}
      onSelect={() => {}}
      {...props}
    />
  );
  const mapEl = container.querySelector(".map")!;
  mapEl.getBoundingClientRect = mapRect;
  return { container, mapEl };
};

describe("findNearest", () => {
  it("hits a projected dot inside the threshold", () => {
    const projected = [{ x: 100, y: 100 }, { x: 500, y: 500 }];
    expect(findNearest(projected, 105, 100, 8)).toBe(0); // 5px away
  });

  it("misses when every dot is outside the threshold", () => {
    const projected = [{ x: 100, y: 100 }, { x: 500, y: 500 }];
    expect(findNearest(projected, 200, 100, 8)).toBe(-1);
  });

  it("picks the nearest dot when two are within the threshold", () => {
    const projected = [{ x: 100, y: 100 }, { x: 106, y: 100 }];
    expect(findNearest(projected, 100, 100, 8)).toBe(0);
  });
});

describe("dotSizeFor", () => {
  it("returns the base size at the reference camera distance", () => {
    expect(dotSizeFor(10, 10, 0.02)).toBe(0.02);
  });

  it("grows gently as the camera zooms in", () => {
    const atHalfDist = dotSizeFor(5, 10, 0.02);
    expect(atHalfDist).toBeGreaterThan(0.02); // closer camera -> bigger dots
    expect(atHalfDist).toBeLessThan(0.05); // gentle curve, not runaway
  });

  it("clamps to the floor and ceiling", () => {
    expect(dotSizeFor(1e9, 10, 0.02)).toBe(0.01); // very far -> floor
    expect(dotSizeFor(0.0001, 10, 0.02)).toBe(0.09); // very close -> ceiling
  });

  it("clamps a huge base size down to the ceiling", () => {
    expect(dotSizeFor(10, 10, 0.5)).toBe(0.09);
  });
});

describe("GlobeView", () => {
  beforeEach(() => {
    createdPoints.length = 0;
    sceneAdd.mockClear();
    labelsDataMock.mockClear();
    labelTextAccessor.current = null;
    for (const k of Object.keys(config)) delete config[k];
    for (const k of Object.keys(controlsListeners)) delete controlsListeners[k];
    cameraState.x = 0;
    cameraState.y = 0;
    cameraState.z = 10;
    // jsdom has no PointerEvent; the component listens for pointermove, so give it a MouseEvent-backed one.
    vi.stubGlobal(
      "PointerEvent",
      class PointerEvent extends MouseEvent {
        constructor(type: string, init: PointerEventInit = {}) {
          super(type, init);
        }
      }
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [] }) }));
  });

  it("renders satellites as a single base Points layer with altitude-normalized positions", () => {
    render(
      <GlobeView positions={positions} satNames={satNames} selectedOrbit={null} selectedCatnr={null} onSelect={() => {}} />
    );
    const base = createdPoints.find((p) => p.geometry.attributes.position.count === 2);
    expect(base).toBeDefined();
    expect(base.material.size).toBe(0.02); // base dot size at the reference camera distance
    const pos = base.geometry.attributes.position.array as number[];
    expect(pos[2]).toBeCloseTo(420 / 6371, 3);
    expect(pos[5]).toBeCloseTo(0.35, 5);
    expect(base.geometry.attributes.color).toBeDefined();
    expect(sceneAdd).toHaveBeenCalledTimes(1); // base + highlight added in one scene.add call
    expect(sceneAdd.mock.calls[0]).toHaveLength(2);
    expect(config.particlesData).toBeUndefined(); // no per-satellite particle layers anymore
  });

  it("reports clicks via onSelect when the nearest projected dot is within the click radius", () => {
    const onSelect = vi.fn();
    const { mapEl } = renderGlobe({ onSelect });
    // Sat 1 projects to (640, 390) in the 800x600 test rect.
    fireEvent.click(mapEl, { clientX: 640, clientY: 390 });
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("does not select on a click far from any projected dot", () => {
    const onSelect = vi.fn();
    const { mapEl } = renderGlobe({ onSelect });
    fireEvent.click(mapEl, { clientX: 50, clientY: 50 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("highlights the hovered satellite and shows a name tooltip", () => {
    const { container, mapEl } = renderGlobe();
    const highlight = createdPoints.find((p) => p.geometry.attributes.position.count === 1)!;
    expect(highlight.visible).toBe(false);
    // Sat 0 projects to (480, 270) in the 800x600 test rect.
    fireEvent.pointerMove(mapEl, { clientX: 480, clientY: 270 });
    expect(highlight.visible).toBe(true);
    expect((mapEl as HTMLElement).style.cursor).toBe("pointer");
    const tooltip = container.querySelector(".globe-tooltip")!;
    expect(tooltip.classList.contains("visible")).toBe(true);
    expect(tooltip.textContent).toBe("Sat One · 1");
    fireEvent.pointerMove(mapEl, { clientX: 5, clientY: 5 });
    expect(highlight.visible).toBe(false);
    expect((mapEl as HTMLElement).style.cursor).toBe("");
    expect(tooltip.classList.contains("visible")).toBe(false);
  });

  it("shows the highlight layer for the selected satellite", () => {
    render(
      <GlobeView positions={positions} satNames={satNames} selectedOrbit={null} selectedCatnr={2} onSelect={() => {}} />
    );
    const highlight = createdPoints.find((p) => p.geometry.attributes.position.count === 1)!;
    expect(highlight.visible).toBe(true);
    const pos = highlight.geometry.attributes.position.array as number[];
    expect(pos[2]).toBeCloseTo(0.35, 5); // sat 2's altitude (capped GEO)
  });

  it("renders the selected orbit as a path and one stable label named from satNames", () => {
    render(
      <GlobeView
        positions={positions}
        satNames={satNames}
        selectedOrbit={[[0, 10], [10, 20], [20, 30]]}
        selectedCatnr={1}
        onSelect={() => {}}
      />
    );
    expect(config.pathsData).toBeDefined();
    expect((config.pathsData as unknown[]).length).toBeGreaterThan(0);
    // the label layer is created exactly once when the selection is set
    const labelCalls = labelsDataMock.mock.calls.filter((c) => (c[0] as unknown[]).length > 0);
    expect(labelCalls).toHaveLength(1);
    const entry = (labelCalls[0][0] as unknown[])[0] as { lat: number; lng: number; catnr: number };
    expect(entry.catnr).toBe(1);
    // the label accessor resolves the satellite NAME (not the NORAD id)
    expect(labelTextAccessor.current?.(entry)).toBe("Sat One");
  });

  it("mutates the label entry in place instead of re-creating it on a positions tick", () => {
    const { rerender } = render(
      <GlobeView positions={positions} satNames={satNames} selectedOrbit={null} selectedCatnr={1} onSelect={() => {}} />
    );
    const labelCalls = labelsDataMock.mock.calls.filter((c) => (c[0] as unknown[]).length > 0);
    expect(labelCalls).toHaveLength(1);
    const callsBefore = labelsDataMock.mock.calls.length;
    const moved = positions.map((p, i) => (i === 0 ? { ...p, lat: p.lat + 1, lon: p.lon + 1 } : p));
    rerender(
      <GlobeView positions={moved} satNames={satNames} selectedOrbit={null} selectedCatnr={1} onSelect={() => {}} />
    );
    // a positions-only change must NOT re-create the label layer
    expect(labelsDataMock.mock.calls.length).toBe(callsBefore);
    // the same entry object was mutated to the new position
    const entry = (labelCalls[0][0] as unknown[])[0] as { lat: number; lng: number };
    expect(entry.lat).toBe(11);
  });

  it("has no path when no satellite is selected", () => {
    render(
      <GlobeView positions={positions} satNames={satNames} selectedOrbit={null} selectedCatnr={null} onSelect={() => {}} />
    );
    expect(config.pathsData).toBeUndefined();
  });

  it("resizes dots when the camera zooms, keeping the highlight 4x", () => {
    render(
      <GlobeView positions={positions} satNames={satNames} selectedOrbit={null} selectedCatnr={null} onSelect={() => {}} />
    );
    const base = createdPoints.find((p) => p.geometry.attributes.position.count === 2)!;
    const highlight = createdPoints.find((p) => p.geometry.attributes.position.count === 1)!;
    expect(base.material.size).toBe(0.02);
    expect(highlight.material.size).toBeCloseTo(base.material.size * 4, 5);
    // zoom in to half the reference distance and fire the OrbitControls 'change' event
    cameraState.z = 5;
    controlsListeners.change?.();
    expect(base.material.size).toBe(dotSizeFor(5, 10, 0.02));
    expect(base.material.size).toBeGreaterThan(0.02);
    expect(highlight.material.size).toBeCloseTo(base.material.size * 4, 5);
  });
});
