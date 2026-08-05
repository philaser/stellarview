import { vi } from "vitest";
import "@testing-library/jest-dom";

// jsdom has no 2D canvas implementation; give the glow-sprite gradient a no-op context so the
// GlobeView mount doesn't spam "not implemented" warnings (the real gradient is drawn in browsers).
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  value: () =>
    ({
      createRadialGradient: () => ({ addColorStop: () => {} }),
      fillStyle: "",
      fillRect: () => {},
    }) as unknown as CanvasRenderingContext2D,
  configurable: true,
});

// Shared mocks for the three.js wide-line classes GlobeView uses for the orbit trajectory and the
// glow halo sprite. Kept in the setup file so both app.test.tsx and globeview.test.tsx get them
// without duplicating the mock factories; recorded instances live here for test assertions.
const lineMocksState = vi.hoisted(() => ({
  createdLines: [] as any[],
  createdGeometries: [] as any[],
  createdMaterials: [] as any[],
  createdSprites: [] as any[],
  createdTextures: [] as any[],
}));

export const threeLineMocks = lineMocksState;

vi.mock("three/examples/jsm/lines/Line2.js", () => ({
  Line2: class {
    geometry: any;
    material: any;
    visible = true;
    constructor(geometry: any, material: any) {
      this.geometry = geometry;
      this.material = material;
      threeLineMocks.createdLines.push(this);
    }
  },
}));

vi.mock("three/examples/jsm/lines/LineGeometry.js", () => ({
  LineGeometry: class {
    positions: Float32Array | null = null;
    colors: Float32Array | null = null;
    constructor() {
      threeLineMocks.createdGeometries.push(this);
    }
    setPositions(array: number[] | Float32Array) {
      this.positions = array instanceof Float32Array ? array : new Float32Array(array);
      return this;
    }
    setColors(array: number[] | Float32Array) {
      this.colors = array instanceof Float32Array ? array : new Float32Array(array);
      return this;
    }
    dispose() {}
  },
}));

vi.mock("three/examples/jsm/lines/LineMaterial.js", () => ({
  LineMaterial: class {
    constructor(props: object) {
      Object.assign(this, props);
      threeLineMocks.createdMaterials.push(this);
    }
    dispose() {}
  },
}));
