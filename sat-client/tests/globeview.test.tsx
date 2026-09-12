import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import GlobeView, {
  cameraFacingBrightness,
  findNearest,
  dotSizeFor,
  lerpWorldPositions,
  orbitGradientColors,
  isVisibleAboveGlobe,
} from "../src/GlobeView";
import { threeLineMocks } from "./setup";

const { createdPoints, sceneAdd, controlsListeners, cameraState, labelsDataMock, labelTextAccessor, pointOfViewMock, rafCallbacks, coordsForTest, globeRadiusForTest } =
  vi.hoisted(() => ({
    createdPoints: [] as any[],
    sceneAdd: vi.fn(),
    controlsListeners: {} as Record<string, (() => void) | null>,
    // camera sits 10 units from the globe origin at the initial pointOfView (refDist = 10)
    cameraState: { x: 0, y: 0, z: 10, altitude: 2.75 },
    labelsDataMock: vi.fn(),
    labelTextAccessor: { current: null as ((d: unknown) => string) | null },
    pointOfViewMock: vi.fn(),
    // captured rAF callbacks so tests can drive the interpolation loop frame-by-frame
    rafCallbacks: [] as FrameRequestCallback[],
    coordsForTest: { current: (lat: number, lng: number, altitude: number) => ({ x: lng, y: lat, z: altitude }) },
    globeRadiusForTest: { current: 1 },
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
        fov: 60,
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
      return coordsForTest.current(lat, lng, altitude);
    }
    getGlobeRadius() {
      return globeRadiusForTest.current;
    }
    lights(d: unknown) {
      config.lights = d;
      return this;
    }
    polygonsData(d: unknown) {
      config.polygonsData = d;
      return this;
    }
    polygonCapMaterial() {
      return this;
    }
    polygonSideMaterial() {
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
    backgroundImageUrl() {
      return this;
    }
    globeMaterial() { return this; }
    globeImageUrl() {
      return this;
    }
    bumpImageUrl() {
      return this;
    }
    showAtmosphere() {
      return this;
    }
    atmosphereColor() {
      return this;
    }
    atmosphereAltitude() {
      return this;
    }
    showGraticules() {
      return this;
    }
    pointOfView(...args: unknown[]) {
      pointOfViewMock(...args);
      if (args.length === 0) return { lat: 0, lng: 0, altitude: cameraState.altitude };
      const view = args[0] as { altitude?: number };
      if (view.altitude !== undefined) cameraState.altitude = view.altitude;
      return this;
    }
    _destructor() {}
  },
}));

vi.mock("three", async () => {
  const actual = await vi.importActual<typeof import("three")>("three");
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
    drawRange: { start: number; count: number } = { start: 0, count: 0 };
    setDrawRange(start: number, count: number) {
      this.drawRange = { start, count };
    }
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
  class Sprite {
    position: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void };
    scale: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => void };
    geometry: { dispose: () => void };
    material: SpriteMaterial;
    visible = true;
    constructor(material: SpriteMaterial) {
      this.material = material;
      this.geometry = { dispose: () => {} };
      this.position = {
        x: 0,
        y: 0,
        z: 0,
        set(x: number, y: number, z: number) {
          this.x = x;
          this.y = y;
          this.z = z;
        },
      };
      this.scale = {
        x: 1,
        y: 1,
        z: 1,
        set(x: number, y: number, z: number) {
          this.x = x;
          this.y = y;
          this.z = z;
        },
      };
      threeLineMocks.createdSprites.push(this);
    }
  }
  class SpriteMaterial {
    constructor(props: object) {
      Object.assign(this, props);
    }
    dispose() {}
  }
  class CanvasTexture {
    image: unknown;
    constructor(image: unknown) {
      this.image = image;
      threeLineMocks.createdTextures.push(this);
    }
    dispose() {}
  }
  class Light {
    position = new Vector3();
    color: Color;
    constructor() {
      this.color = new Color();
    }
    intensity = 0;
  }
  return {
    ...actual,
    BufferAttribute,
    BufferGeometry,
    PointsMaterial,
    Points,
    Color,
    Vector3,
    Sprite,
    SpriteMaterial,
    CanvasTexture,
    AmbientLight: Light,
    DirectionalLight: Light,
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
  const { container, rerender } = render(
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
  return { container, mapEl, rerender };
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

describe("lerpWorldPositions", () => {
  it("returns prev values at t=0", () => {
    const prev = new Float32Array([1, 2, 3, 4, 5, 6]);
    const cur = new Float32Array([7, 8, 9, 10, 11, 12]);
    const out = new Float32Array(6);
    expect(lerpWorldPositions(prev, cur, 0, out)).toBe(out);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("returns current values at t=1", () => {
    const prev = new Float32Array([1, 2, 3, 4, 5, 6]);
    const cur = new Float32Array([7, 8, 9, 10, 11, 12]);
    const out = new Float32Array(6);
    lerpWorldPositions(prev, cur, 1, out);
    expect(Array.from(out)).toEqual([7, 8, 9, 10, 11, 12]);
  });

  it("returns midpoints at t=0.5", () => {
    const prev = new Float32Array([0, 10, 20]);
    const cur = new Float32Array([2, 14, 30]);
    const out = new Float32Array(3);
    lerpWorldPositions(prev, cur, 0.5, out);
    expect(Array.from(out)).toEqual([1, 12, 25]);
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

describe("cameraFacingBrightness", () => {
  const camera = { x: 0, y: 0, z: 10 };

  it("keeps near-side markers brighter than limb and rear-side markers", () => {
    const near = cameraFacingBrightness({ x: 0, y: 0, z: 1 }, camera);
    const limb = cameraFacingBrightness({ x: 1, y: 0, z: 0 }, camera);
    const rear = cameraFacingBrightness({ x: 0, y: 0, z: -1 }, camera);
    expect(near).toBe(1);
    expect(limb).toBeGreaterThan(rear);
    expect(limb).toBeLessThan(near);
    expect(rear).toBeCloseTo(0.45);
  });
});

describe("isVisibleAboveGlobe", () => {
  const camera = { x: 0, y: 0, z: 300 };

  it("rejects a far-side point whose camera segment crosses Earth", () => {
    expect(isVisibleAboveGlobe({ x: -20, y: 0, z: -120 }, camera, 100)).toBe(false);
  });

  it("keeps front-side and elevated beyond-limb points selectable", () => {
    expect(isVisibleAboveGlobe({ x: 20, y: 0, z: 120 }, camera, 100)).toBe(true);
    expect(isVisibleAboveGlobe({ x: 110, y: 0, z: 0 }, camera, 100)).toBe(true);
  });
});

describe("orbitGradientColors", () => {
  const peakIndexOf = (colors: Float32Array) => {
    let best = 0;
    for (let i = 1; i < colors.length / 3; i++) {
      if (colors[i * 3] > colors[best * 3]) best = i;
    }
    return best;
  };

  it("peaks near the vertex matching the phase (within a couple of vertices)", () => {
    expect(Math.abs(peakIndexOf(orbitGradientColors(120, 0.25)) - 30)).toBeLessThanOrEqual(2);
    expect(Math.abs(peakIndexOf(orbitGradientColors(120, 0.75)) - 90)).toBeLessThanOrEqual(2);
    expect(Math.abs(peakIndexOf(orbitGradientColors(120, 0.99)) - 119)).toBeLessThanOrEqual(2);
  });

  it("moves the peak as the phase advances", () => {
    expect(peakIndexOf(orbitGradientColors(120, 0.1))).not.toBe(peakIndexOf(orbitGradientColors(120, 0.6)));
  });

  it("keeps every color channel in [0,1]", () => {
    for (const phase of [0, 0.37, 0.99, 1.25]) {
      const colors = orbitGradientColors(60, phase);
      for (const v of colors) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("renders a white-hot gaussian head and a clearly dimmer violet tail", () => {
    const colors = orbitGradientColors(120, 0);
    // head at the phase vertex is white-hot (≈ 1.0 in every channel)
    expect(colors[0]).toBeCloseTo(1, 2);
    expect(colors[1]).toBeCloseTo(1, 2);
    expect(colors[2]).toBeCloseTo(1, 2);
    // a vertex within 2 of the phase still reads near-white-hot (narrow head)
    expect(colors[1 * 3]).toBeGreaterThan(0.9);
    // tail opposite the head sits at 35% of #a855f7, clearly dimmer than the head
    const tailAt = (c: number) => (c * 0.35) / 255;
    expect(colors[60 * 3]).toBeCloseTo(tailAt(168), 3);
    expect(colors[60 * 3 + 1]).toBeCloseTo(tailAt(85), 3);
    expect(colors[60 * 3 + 2]).toBeCloseTo(tailAt(247), 3);
    expect(colors[60 * 3 + 1]).toBeLessThan(0.5);
  });
});

describe("GlobeView", () => {
  beforeEach(() => {
    createdPoints.length = 0;
    sceneAdd.mockClear();
    labelsDataMock.mockClear();
    pointOfViewMock.mockClear();
    labelTextAccessor.current = null;
    for (const k of Object.keys(config)) delete config[k];
    for (const k of Object.keys(controlsListeners)) delete controlsListeners[k];
    for (const key of Object.keys(threeLineMocks)) threeLineMocks[key as keyof typeof threeLineMocks].length = 0;
    cameraState.x = 0;
    cameraState.y = 0;
    cameraState.z = 10;
    globeRadiusForTest.current = 1;
    coordsForTest.current = (lat, lng, altitude) => ({ x: lng, y: lat, z: altitude });
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
    // Capture rAF callbacks so no real frames auto-fire; the interpolation test drives them explicitly.
    rafCallbacks.length = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  it("moves the geographic night overlay with simulation time", () => {
    const { rerender, unmount } = render(<GlobeView positions={positions} satNames={satNames}
      selectedOrbit={null} selectedCatnr={null} onSelect={() => {}} showDaylight
      time={new Date("2026-03-20T12:00:00Z")} />);
    const overlay = sceneAdd.mock.calls.flat().find((item) => item.name === "daylight-overlay");
    const noon = overlay.quaternion.clone();
    expect(overlay.geometry.parameters.thetaLength).toBeCloseTo(Math.PI / 2);
    rerender(<GlobeView positions={positions} satNames={satNames}
      selectedOrbit={null} selectedCatnr={null} onSelect={() => {}} showDaylight
      time={new Date("2026-03-20T18:00:00Z")} />);
    expect(overlay.quaternion.equals(noon)).toBe(false);
    const disposeGeometry = vi.spyOn(overlay.geometry, "dispose");
    const disposeMaterial = vi.spyOn(overlay.material, "dispose");
    unmount();
    expect(disposeGeometry).toHaveBeenCalled();
    expect(disposeMaterial).toHaveBeenCalled();
  });

  it("toggles the geographic overlay without changing scene lighting", () => {
    const { rerender } = render(<GlobeView positions={positions} satNames={satNames}
      selectedOrbit={null} selectedCatnr={null} showDaylight={false} onSelect={() => {}} />);
    const overlay = sceneAdd.mock.calls.flat().find((item) => item.name === "daylight-overlay");
    const lights = config.lights;
    expect(overlay.visible).toBe(false);
    rerender(<GlobeView positions={positions} satNames={satNames}
      selectedOrbit={null} selectedCatnr={null} showDaylight onSelect={() => {}} />);
    expect(overlay.visible).toBe(true);
    expect(config.lights).toBe(lights);
  });

  it("trims the rendered draw range when satellites are filtered out", () => {
    const { rerender } = render(
      <GlobeView positions={positions} satNames={satNames} selectedOrbit={null} selectedCatnr={null} onSelect={() => {}} />
    );
    const base = createdPoints.find((p) => p.geometry.attributes.position.count === 2)!;
    expect(base.geometry.drawRange.count).toBe(2);
    rerender(
      <GlobeView
        positions={positions.slice(0, 1)}
        satNames={satNames}
        selectedOrbit={null}
        selectedCatnr={null}
        onSelect={() => {}}
      />
    );
    // filtered-out satellites must no longer render (no stale frozen dots)
    expect(base.geometry.drawRange.count).toBe(1);
  });

  it("renders satellites as a single base Points layer with altitude-normalized positions", () => {
    render(
      <GlobeView positions={positions} satNames={satNames} selectedOrbit={null} selectedCatnr={null} onSelect={() => {}} />
    );
    const base = createdPoints.find((p) => p.geometry.attributes.position.count === 2);
    expect(base).toBeDefined();
    expect(base.material.size).toBeCloseTo(0.017); // 0.017 globe radii x the mocked unit globe radius
    expect(base.material.opacity).toBeLessThan(0.5);
    const pos = base.geometry.attributes.position.array as number[];
    expect(pos[2]).toBeCloseTo(420 / 6371, 3);
    expect(pos[5]).toBeCloseTo(0.35, 5);
    expect(base.geometry.attributes.color).toBeDefined();
    expect(sceneAdd).toHaveBeenCalledTimes(2); // daylight overlay and satellite layers
    expect(sceneAdd.mock.calls[1]).toHaveLength(5);
    expect(config.particlesData).toBeUndefined(); // no per-satellite particle layers anymore
  });

  it("reports clicks via onSelect when the nearest projected dot is within the click radius", () => {
    const onSelect = vi.fn();
    const { mapEl } = renderGlobe({ onSelect });
    // Sat 1 projects to (640, 390) in the 800x600 test rect.
    fireEvent.click(mapEl, { clientX: 640, clientY: 390 });
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("does not hover or click a far-side point projected over Earth, while keeping front and limb points interactive", () => {
    cameraState.z = 300;
    coordsForTest.current = (lat, lng) => ({ x: lat, y: 0, z: lng });
    const occlusionPositions = [
      { catnr: 10, lat: -20, lon: -120, altKm: 420, velocityKms: 7.6, color: "#38bdf8", selected: false },
      { catnr: 11, lat: 20, lon: 120, altKm: 420, velocityKms: 7.6, color: "#38bdf8", selected: false },
      { catnr: 12, lat: 110, lon: 0, altKm: 420, velocityKms: 7.6, color: "#38bdf8", selected: false },
    ];
    const onSelect = vi.fn();
    globeRadiusForTest.current = 100;
    const { container, mapEl } = renderGlobe({ positions: occlusionPositions, satNames: { 10: "Behind", 11: "Front", 12: "Limb" }, selectedCatnr: 10, onSelect });
    fireEvent.pointerMove(mapEl, { clientX: 320, clientY: 300 });
    expect((mapEl as HTMLElement).style.cursor).toBe("");
    expect(container.querySelector(".globe-tooltip")?.classList.contains("visible")).toBe(false);
    fireEvent.click(mapEl, { clientX: 320, clientY: 300 });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(mapEl, { clientX: 480, clientY: 300 });
    fireEvent.click(mapEl, { clientX: 840, clientY: 300 });
    expect(onSelect).toHaveBeenNthCalledWith(1, 11);
    expect(onSelect).toHaveBeenNthCalledWith(2, 12);
    rafCallbacks.shift()?.(1000);
    expect((container.querySelector(".selected-map-label") as HTMLElement).style.display).toBe("none");
  });

  it("focuses and follows a satellite with distinct camera transitions", () => {
    const { rerender } = renderGlobe({ focus: { catnr: 1, ts: 1 } });
    expect(pointOfViewMock).toHaveBeenCalledWith({ lat: 10, lng: 20, altitude: 2.15 }, 850);

    rerender(
      <GlobeView
        positions={positions}
        satNames={satNames}
        selectedOrbit={null}
        selectedCatnr={1}
        followCatnr={1}
        onSelect={() => {}}
      />
    );
    expect(pointOfViewMock).toHaveBeenCalledWith({ lat: 10, lng: 20, altitude: 2.15 }, 650);
    cameraState.altitude = 3.4;
    rerender(<GlobeView positions={[...positions]} satNames={satNames} selectedOrbit={null}
      selectedCatnr={1} followCatnr={1} onSelect={() => {}} />);
    expect(pointOfViewMock).toHaveBeenLastCalledWith({ lat: 10, lng: 20, altitude: 3.4 }, 650);
  });

  it("focuses a revealed search result when its first position arrives", () => {
    const focus = { catnr: 1, ts: 42 };
    const { rerender } = renderGlobe({ positions: [], focus });
    pointOfViewMock.mockClear();
    rerender(<GlobeView positions={positions} satNames={satNames} selectedOrbit={null}
      selectedCatnr={1} focus={focus} onSelect={() => {}} />);
    expect(pointOfViewMock).toHaveBeenCalledWith({ lat: 10, lng: 20, altitude: 2.15 }, 850);
    pointOfViewMock.mockClear();
    rerender(<GlobeView positions={[...positions]} satNames={satNames} selectedOrbit={null}
      selectedCatnr={1} focus={focus} onSelect={() => {}} />);
    expect(pointOfViewMock).not.toHaveBeenCalled();
  });

  it("does not select on a click far from any projected dot", () => {
    const onSelect = vi.fn();
    const { mapEl } = renderGlobe({ onSelect });
    fireEvent.click(mapEl, { clientX: 50, clientY: 50 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not select a satellite when locked", () => {
    const onSelect = vi.fn();
    const { mapEl } = renderGlobe({ locked: true, onSelect });
    fireEvent.click(mapEl, { clientX: 640, clientY: 390 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("ignores clicks that follow a globe-rotation drag", () => {
    const onSelect = vi.fn();
    const { mapEl } = renderGlobe({ onSelect });
    // pointer goes down away from any dot, drags across the globe, and releases ON a dot:
    // that is a rotation, not a selection
    fireEvent.pointerDown(mapEl, { clientX: 600, clientY: 390 });
    fireEvent.click(mapEl, { clientX: 640, clientY: 390 });
    expect(onSelect).not.toHaveBeenCalled();
    // a plain click (no preceding drag) still selects
    fireEvent.pointerDown(mapEl, { clientX: 640, clientY: 390 });
    fireEvent.click(mapEl, { clientX: 640, clientY: 390 });
    expect(onSelect).toHaveBeenCalled();
  });

  it("suppresses hover highlighting and tooltips while locked", () => {
    const { container, mapEl } = renderGlobe({ locked: true });
    const dot = threeLineMocks.createdSprites[0];
    const glow = threeLineMocks.createdSprites[1];
    fireEvent.pointerMove(mapEl, { clientX: 480, clientY: 270 });
    expect(dot.visible).toBe(false);
    expect(glow.visible).toBe(false);
    const tooltip = container.querySelector(".globe-tooltip")!;
    expect(tooltip.classList.contains("visible")).toBe(false);
    expect((mapEl as HTMLElement).style.cursor).toBe("");
  });

  it("highlights the hovered satellite with a round dot sprite and shows a name tooltip", () => {
    const { container, mapEl } = renderGlobe();
    const dot = threeLineMocks.createdSprites[2];
    const glow = threeLineMocks.createdSprites[1];
    expect(dot.visible).toBe(false);
    expect(glow.visible).toBe(false);
    // Sat 0 projects to (480, 270) in the 800x600 test rect.
    fireEvent.pointerMove(mapEl, { clientX: 480, clientY: 270 });
    expect(dot.visible).toBe(true);
    expect(glow.visible).toBe(false);
    expect((mapEl as HTMLElement).style.cursor).toBe("pointer");
    const tooltip = container.querySelector(".globe-tooltip")!;
    expect(tooltip.classList.contains("visible")).toBe(true);
    expect(tooltip.textContent).toBe("Sat One · NORAD 1");
    fireEvent.pointerMove(mapEl, { clientX: 5, clientY: 5 });
    expect(dot.visible).toBe(false);
    expect(glow.visible).toBe(false);
    expect((mapEl as HTMLElement).style.cursor).toBe("");
    expect(tooltip.classList.contains("visible")).toBe(false);
  });

  it("shows the round highlight sprite for the selected satellite", () => {
    render(
      <GlobeView positions={positions} satNames={satNames} selectedOrbit={null} selectedCatnr={2} onSelect={() => {}} />
    );
    const dot = threeLineMocks.createdSprites[0];
    expect(dot.visible).toBe(true);
    // sat 2's world coords: mock getCoords maps (lat, lon, alt) -> (lon, lat, alt), GEO altitude capped
    expect(dot.position.x).toBeCloseTo(60, 5);
    expect(dot.position.y).toBeCloseTo(-30, 5);
    expect(dot.position.z).toBeCloseTo(0.35, 5);
  });

  it("renders the selected orbit as a Line2 with world-coord positions and one stable label named from satNames", () => {
    render(
      <GlobeView
        positions={positions}
        satNames={satNames}
        selectedOrbit={[[0, 10], [10, 20], [20, 30]]}
        selectedCatnr={1}
        onSelect={() => {}}
      />
    );
    const line = threeLineMocks.createdLines[0];
    expect(line).toBeDefined();
    expect(line.visible).toBe(true);
    // 3 ground-track points -> 9 world coords; mock getCoords maps (lat, lon, alt) -> (lon, lat, alt)
    const pos = line.geometry.positions as Float32Array;
    expect(pos).toHaveLength(3 * 3);
    expect(pos[0]).toBeCloseTo(0, 5);
    expect(pos[1]).toBeCloseTo(10, 5);
    expect(pos[2]).toBeCloseTo(0.07, 5);
    expect(pos[8]).toBeCloseTo(0.07, 5);
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

  it("hides the orbit line when no satellite is selected", () => {
    render(
      <GlobeView positions={positions} satNames={satNames} selectedOrbit={null} selectedCatnr={null} onSelect={() => {}} />
    );
    expect(threeLineMocks.createdLines).toHaveLength(1);
    expect(threeLineMocks.createdLines[0].visible).toBe(false);
  });

  it("advances the looping orbit gradient in the rAF loop", () => {
    const { rerender } = renderGlobe({ selectedCatnr: 1 });
    const line = threeLineMocks.createdLines[0];
    expect(line.visible).toBe(false);

    rerender(
      <GlobeView
        positions={positions}
        satNames={satNames}
        selectedOrbit={[[0, 10], [10, 20], [20, 30]]}
        selectedCatnr={1}
        onSelect={() => {}}
      />
    );
    expect(line.visible).toBe(true);

    // frame 1 advances phase 0 -> 0.02 and writes the color attribute
    const cb1 = rafCallbacks.shift()!;
    cb1(1000);
    expect(Array.from(line.geometry.colors as Float32Array)).toEqual(Array.from(orbitGradientColors(3, 0.02)));

    // frame 2 keeps advancing the phase
    const cb2 = rafCallbacks.shift()!;
    cb2(2000);
    expect(Array.from(line.geometry.colors as Float32Array)).toEqual(Array.from(orbitGradientColors(3, 0.04)));
  });

  it("keeps the selected glow in place while hovering another satellite", () => {
    const { mapEl } = renderGlobe({ selectedCatnr: 1 });
    fireEvent.pointerMove(mapEl, { clientX: 640, clientY: 390 });
    rafCallbacks.shift()!(2500);
    const [dot, glow, hover] = threeLineMocks.createdSprites;
    expect(dot.position.x).toBeCloseTo(20);
    expect(glow.position.x).toBeCloseTo(20);
    expect(dot.visible).toBe(true);
    expect(glow.visible).toBe(true);
    expect(hover.visible).toBe(true);
    expect(hover.position.x).toBeCloseTo(60);
  });

  it("pulses the highlight's opacity, keeping its size stable, and follows the satellite with the glow halo", () => {
    const { mapEl } = renderGlobe({ selectedCatnr: 1 });
    const dot = threeLineMocks.createdSprites[0];
    const glow = threeLineMocks.createdSprites[1];
    expect(dot.visible).toBe(true);
    expect(glow.visible).toBe(true);
    expect(glow.material.map).toBeDefined();
    // the highlight dot uses a radial-gradient texture so it renders ROUND, never a square
    expect(dot.material.map).toBeDefined();

    // two frames at different times -> different pulsing opacities, but STABLE sizes (the marker
    // must never balloon into a pulsing blob)
    const cb1 = rafCallbacks.shift()!;
    cb1(1000);
    const dotOpacity1 = dot.material.opacity;
    const glowOpacity1 = glow.material.opacity;
    const dotScale1 = dot.scale.x;
    expect(dotOpacity1).toBeGreaterThan(0);
    expect(glow.scale.x).toBeGreaterThan(dot.scale.x);

    const cb2 = rafCallbacks.shift()!;
    cb2(2500);
    expect(dot.material.opacity).not.toBe(dotOpacity1);
    expect(glow.material.opacity).not.toBe(glowOpacity1);
    expect(dot.scale.x).toBe(dotScale1);

    // the dot and glow track the selected satellite's lerped world coords (sat 1: lon 20, lat 10)
    expect(dot.position.x).toBeCloseTo(20, 5);
    expect(dot.position.y).toBeCloseTo(10, 5);
    expect(glow.position.x).toBeCloseTo(20, 5);
    expect(glow.position.y).toBeCloseTo(10, 5);
    mapEl; // referenced to keep renderGlobe's container rect active
  });

  it("floors the highlight to a minimum pixel size at far zoom and scales it with the globe up close", () => {
    const { mapEl } = renderGlobe({ selectedCatnr: 1 });
    const base = createdPoints.find((p) => p.geometry.attributes.position.count === 2)!;
    expect(base.material.size).toBeCloseTo(0.017); // 0.017 globe radii x the mocked unit globe radius
    const dot = threeLineMocks.createdSprites[0];
    expect(dot.visible).toBe(true);
    const frame = (now: number) => rafCallbacks.shift()!(now);
    const floorAt = (z: number) => (5 / 600) * (2 * Math.tan((60 * Math.PI) / 360) * z);

    // very far zoom (z=200): the world-scaled marker would be ~2px, so the pixel floor keeps it ~5px
    cameraState.z = 200;
    controlsListeners.change?.();
    frame(1000);
    expect(dot.scale.x).toBeCloseTo(floorAt(200), 4);

    // close zoom (z=2, same pulse phase): the marker outgrows the floor and scales with the globe
    // at ~1.3x the base dot size (both in globe-radius units x the mocked unit radius)
    cameraState.z = 2;
    controlsListeners.change?.();
    frame(1000 + 2 * Math.PI * 600);
    expect(dot.scale.x).toBeCloseTo(dotSizeFor(2, 10, 0.017) * 1.3, 2);
    mapEl; // referenced to keep renderGlobe's container rect active
  });

  it("glides base dots, the highlight and the label between snapshots via the rAF loop", () => {
    let now = 1000;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => now);

    const { rerender } = renderGlobe({ selectedCatnr: 1 });
    const base = createdPoints.find((p) => p.geometry.attributes.position.count === 2)!;
    const dot = threeLineMocks.createdSprites[0];
    const posAttr = base.geometry.attributes.position;

    // new snapshot arrives: sat 0 moves (+2 lat, +2 lon), sat 1 stays put
    const moved = positions.map((p, i) => (i === 0 ? { ...p, lat: p.lat + 2, lon: p.lon + 2 } : p));
    rerender(
      <GlobeView positions={moved} satNames={satNames} selectedOrbit={null} selectedCatnr={1} onSelect={() => {}} />
    );

    now += 1000; // halfway through the 2s window -> t = 0.5
    const cb = rafCallbacks.shift()!;
    cb(now);

    // lerped world coords (mock getCoords maps lon/lat/alt -> x/y/z): sat 0 at the midpoint (21, 11)
    expect(posAttr.array[0]).toBeCloseTo(21, 5);
    expect(posAttr.array[1]).toBeCloseTo(11, 5);
    expect(posAttr.array[2]).toBeCloseTo(420 / 6371, 5); // altitude is unchanged
    expect(posAttr.needsUpdate).toBe(true);
    // sat 1 did not move, so it sits exactly at its snapshot position
    expect(posAttr.array[3]).toBeCloseTo(60, 5);
    expect(posAttr.array[4]).toBeCloseTo(-30, 5);

    // the highlight dot sprite tracks the same lerped position for the selected sat
    expect(dot.position.x).toBeCloseTo(21, 5);
    expect(dot.position.y).toBeCloseTo(11, 5);

    // the label glides between the previous and current lat/lngs
    const labelCalls = labelsDataMock.mock.calls.filter((c) => (c[0] as unknown[]).length > 0);
    const entry = (labelCalls[0][0] as unknown[])[0] as { lat: number; lng: number };
    expect(entry.lat).toBeCloseTo(11, 5);
    expect(entry.lng).toBeCloseTo(21, 5);

    nowSpy.mockRestore();
  });
});
