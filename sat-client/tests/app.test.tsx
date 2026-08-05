import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import App from "../src/App";

// Fixture: real TLEs fetched from CelesTrak (ISS 25544, STARLINK-1008 44714, GOES 16 41866)
const TLE_BLOCKS = `ISS (ZARYA)
1 25544U 98067A   26215.79638706  .00007444  00000+0  14146-3 0  9999
2 25544  51.6316  64.4821 0007224   9.2337 350.8783 15.49332738579132
STARLINK-1008
1 44714U 19074B   26215.97871058  .00029734  00000+0  37585-3 0  9997
2 44714  53.1486 198.6893 0006328  18.4929 341.6313 15.59291253371649
GOES 16
1 41866U 16071A   26215.85468562 -.00000082  00000+0  00000+0 0  9999
2 41866   0.4487  85.2768 0001085 105.6447 324.4846  1.00271010 35581
`;

let capturedClick: ((e: unknown) => void) | null = null;
let loadHandler: (() => void) | null = null;
let clickHitsFeature = true;
let geoMock: ReturnType<typeof vi.fn>;
const addSourceMock = vi.fn();
const setDataMock = vi.fn();

vi.mock("maplibre-gl", () => ({
  default: class {
    on(evt: string, cb: (e: unknown) => void) {
      if (evt === "click") capturedClick = cb;
      if (evt === "load") loadHandler = cb as () => void;
    }
    addSource(...a: unknown[]) { addSourceMock(...a); }
    addLayer() {}
    removeLayer() {}
    removeSource() {}
    getSource(name: string) {
      return { setData: (data: unknown) => setDataMock(name, data) };
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
      if (evt === "load") loadHandler = cb as () => void;
    }
    addSource(...a: unknown[]) { addSourceMock(...a); }
    addLayer() {}
    removeLayer() {}
    removeSource() {}
    getSource(name: string) {
      return { setData: (data: unknown) => setDataMock(name, data) };
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

// globe.gl needs a DOM element + WebGL; in jsdom tests it can't construct, so no-op it.
vi.mock("globe.gl", () => ({
  default: class {
    constructor() {}
    scene() { return { add() {}, remove() {} }; }
    camera() { return {}; }
    getCoords(_lat: number, _lng: number, altitude = 0) {
      return { x: 0, y: 0, z: altitude };
    }
    polygonsData() { return this; }
    polygonCapColor() { return this; }
    polygonSideColor() { return this; }
    polygonStrokeColor() { return this; }
    polygonAltitude() { return this; }
    pathsData() { return this; }
    pathPoints() { return this; }
    pathPointLat() { return this; }
    pathPointLng() { return this; }
    pathPointAlt() { return this; }
    pathColor() { return this; }
    pathStroke() { return this; }
    pathDashLength() { return this; }
    pathDashGap() { return this; }
    pathDashInitialGap() { return this; }
    labelsData() { return this; }
    labelLat() { return this; }
    labelLng() { return this; }
    labelText() { return this; }
    labelColor() { return this; }
    labelSize() { return this; }
    labelAltitude() { return this; }
    labelResolution() { return this; }
    backgroundColor() { return this; }
    showAtmosphere() { return this; }
    atmosphereColor() { return this; }
    showGraticules() { return this; }
    pointOfView() { return this; }
    _destructor() {}
  },
}));

// GlobeView adds custom THREE.Points layers to the globe scene; jsdom has no WebGL so mock the classes used.
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
    }
  }
  class Raycaster {
    params = { Points: { threshold: 1 } };
    setFromCamera() {}
    intersectObject() {
      return [];
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
      return this;
    }
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
    Vector3,
    Vector2,
    DynamicDrawUsage: Symbol("DynamicDrawUsage"),
  };
});
beforeEach(() => {
  capturedClick = null;
  loadHandler = null;
  clickHitsFeature = true;
  geoMock = vi.fn(
    (ok: (p: { coords: { latitude: number; longitude: number } }) => void) =>
      ok({ coords: { latitude: 40.0, longitude: -74.0 } })
  );
  addSourceMock.mockClear();
  setDataMock.mockClear();
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => TLE_BLOCKS }));
  vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition: geoMock } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// The app now defaults to 3D; tests exercising the 2D map click/feature flow switch first.
const switchTo2d = async () => {
  fireEvent.click(screen.getByRole("button", { name: /toggle 3d mode/i }));
  await act(async () => {});
};

describe("App", () => {
  it("fetches the TLE list on load and reports N/M satellites", async () => {
    render(<App />);
    await act(async () => {});
    const calls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.startsWith("/api/tle?group=active"))).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(2000);
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
    await switchTo2d();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    await act(async () => {
      capturedClick!({ point: { x: 0, y: 0 } });
    });
    expect(screen.getByText("ISS (ZARYA)")).toBeInTheDocument();
  });

  it("sets the observer point on empty-map click", async () => {
    render(<App />);
    await act(async () => {});
    await switchTo2d();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    clickHitsFeature = false;
    await act(async () => {
      capturedClick!({ lngLat: { lng: 2.35, lat: 48.86 } });
    });
    expect(screen.getByText(/observer/i)).toBeInTheDocument();
  });

  it("shows a banner when the TLE fetch fails", async () => {
    // reject every fetch: the 3D globe's countries fetch is decorative and swallowed, the TLE fetch drives the banner
    vi.mocked(fetch).mockRejectedValue(new Error("network"));
    render(<App />);
    await act(async () => {});
    expect(screen.getByText("TLE provider unreachable")).toBeInTheDocument();
  });

  it("flags the selected satellite's dot feature", async () => {
    render(<App />);
    await act(async () => {});
    await switchTo2d();
    await act(async () => {
      loadHandler!();
    });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    await act(async () => {
      capturedClick!({ point: { x: 0, y: 0 } }); // selects ISS (25544)
    });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    const satCalls = setDataMock.mock.calls.filter((c) => c[0] === "satellites");
    expect(satCalls.length).toBeGreaterThan(0);
    const [, data] = satCalls.at(-1)!;
    expect(
      data.features.every(
        (f: { properties: { catnr: number; selected?: boolean } }) =>
          f.properties.selected === (f.properties.catnr === 25544)
      )
    ).toBe(true);
  });

  it("shows Visible now and a Follow toggle in the panel", async () => {
    render(<App />);
    await act(async () => {});
    await switchTo2d();
    await act(async () => { vi.advanceTimersByTime(2000); });
    await act(async () => {
      capturedClick!({ point: { x: 0, y: 0 } });
    });
    expect(screen.getByText(/Visible now/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /follow/i })).toBeInTheDocument();
  });

  it("toggles follow mode on and clears it on close", async () => {
    render(<App />);
    await act(async () => {});
    await switchTo2d();
    await act(async () => { vi.advanceTimersByTime(2000); });
    await act(async () => {
      capturedClick!({ point: { x: 0, y: 0 } });
    });
    fireEvent.click(screen.getByRole("button", { name: /follow/i }));
    expect(screen.getByRole("button", { name: /following/i })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Close"));
    expect(screen.queryByRole("button", { name: /following/i })).not.toBeInTheDocument();
  });

  it("hides GEO satellites when the GEO regime is unchecked", async () => {
    render(<App />);
    await act(async () => {});
    await switchTo2d();
    await act(async () => {
      loadHandler!();
    });
    fireEvent.click(screen.getByLabelText("GEO"));
    await act(async () => { vi.advanceTimersByTime(2000); });
    const geoDots = setDataMock.mock.calls
      .filter((c) => c[0] === "satellites")
      .at(-1)?.[1].features;
    expect(geoDots).toHaveLength(2);
    expect(geoDots.every((f: { properties: { catnr: number } }) => f.properties.catnr !== 41866)).toBe(true);
  });

  it("narrows by search", async () => {
    render(<App />);
    await act(async () => {});
    await switchTo2d();
    await act(async () => {
      loadHandler!();
    });
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "STARLINK" } });
    await act(async () => { vi.advanceTimersByTime(2000); });
    const dots = setDataMock.mock.calls.filter((c) => c[0] === "satellites").at(-1)?.[1].features;
    expect(dots.length).toBeGreaterThan(0);
    expect(dots.every((f: { properties: { catnr: number } }) => f.properties.catnr === 44714)).toBe(true);
  });

  it("deselects when the selected satellite is filtered out", async () => {
    render(<App />);
    await act(async () => {});
    await switchTo2d();
    await act(async () => {
      capturedClick!({ point: { x: 0, y: 0 } }); // selects ISS
    });
    expect(screen.getByText("ISS (ZARYA)")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("LEO")); // hides ISS
    await act(async () => {});
    expect(screen.queryByText("ISS (ZARYA)")).not.toBeInTheDocument();
  });

  it("shows per-filter counts in the checkbox labels", async () => {
    render(<App />);
    await act(async () => {});
    expect(screen.getByText("LEO (2)")).toBeInTheDocument();
    expect(screen.getByText("GEO (1)")).toBeInTheDocument();
    expect(screen.getByText("starlink (1)")).toBeInTheDocument();
  });

  it("toggles all regimes off and back on via the None/All shortcuts", async () => {
    render(<App />);
    await act(async () => {});
    await switchTo2d();
    await act(async () => { loadHandler!(); });
    fireEvent.click(screen.getByRole("button", { name: /regimes: none/i }));
    await act(async () => { vi.advanceTimersByTime(2000); });
    const dots = setDataMock.mock.calls.filter((c) => c[0] === "satellites").at(-1)?.[1].features ?? [];
    expect(dots).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /regimes: all/i }));
    await act(async () => { vi.advanceTimersByTime(2000); });
    const dots2 = setDataMock.mock.calls.filter((c) => c[0] === "satellites").at(-1)?.[1].features ?? [];
    expect(dots2.length).toBeGreaterThan(0);
  });

  it("lists search results and selects on click", async () => {
    render(<App />);
    await act(async () => {});
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "ISS" } });
    await act(async () => {});
    fireEvent.click(screen.getAllByText(/ISS \(ZARYA\)/)[0]); // results list item
    await act(async () => {});
    expect(screen.getAllByText(/ISS \(ZARYA\)/).length).toBeGreaterThanOrEqual(2); // results item + panel title
  });

  it("wraps the observer longitude into ±180", async () => {
    render(<App />);
    await act(async () => {});
    await switchTo2d();
    clickHitsFeature = false;
    await act(async () => {
      capturedClick!({ lngLat: { lng: 293.78, lat: 48.86 } });
    });
    expect(screen.getByText(/Observer: 48\.86, -66\.22/)).toBeInTheDocument();
  });

  it("toggles the day/night overlay", async () => {
    render(<App />);
    await act(async () => {});
    const cb = screen.getByLabelText("Day/Night");
    expect(cb).toBeChecked();
    fireEvent.click(cb);
    expect(cb).not.toBeChecked();
  });

  it("collapses and expands the controls panel via the gear button", async () => {
    render(<App />);
    await act(async () => {});
    expect(document.querySelector(".controls")?.classList.contains("open")).toBe(true);
    fireEvent.click(screen.getByLabelText("Toggle filters"));
    expect(document.querySelector(".controls")?.classList.contains("closed")).toBe(true);
    fireEvent.click(screen.getByLabelText("Toggle filters"));
    expect(document.querySelector(".controls")?.classList.contains("open")).toBe(true);
  });

  it("toggles between 2D and 3D modes", async () => {
    render(<App />);
    await act(async () => {});
    expect(screen.getByText("2D mode")).toBeInTheDocument(); // app defaults to 3D
    fireEvent.click(screen.getByRole("button", { name: /toggle 3d mode/i }));
    expect(screen.getByText("3D mode")).toBeInTheDocument();
  });
});
