import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { StrictMode } from "react";
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
    camera() {
      return { position: { distanceTo: () => 10 } };
    }
    controls() {
      return { target: {}, addEventListener() {}, removeEventListener() {} };
    }
    getCoords(_lat: number, _lng: number, altitude = 0) {
      return { x: 0, y: 0, z: altitude };
    }
    getGlobeRadius() {
      return 100;
    }
    lights() { return this; }
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
    backgroundImageUrl() { return this; }
    globeImageUrl() { return this; }
    bumpImageUrl() { return this; }
    showAtmosphere() { return this; }
    atmosphereColor() { return this; }
    atmosphereAltitude() { return this; }
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
  class Sprite {
    geometry = { dispose() {} };
    material: SpriteMaterial;
    visible = true;
    position = { set() {} };
    scale = { set() {} };
    constructor(material: SpriteMaterial) {
      this.material = material;
    }
  }
  class SpriteMaterial {
    constructor(props: object) {
      Object.assign(this, props);
    }
    dispose() {}
  }
  class CanvasTexture {
    dispose() {}
  }
  class Light {
    color: Color;
    position = { set() {} };
    constructor() {
      this.color = new Color();
    }
    intensity = 0;
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
    Sprite,
    SpriteMaterial,
    CanvasTexture,
    AmbientLight: Light,
    DirectionalLight: Light,
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
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    text: async () => TLE_BLOCKS,
    headers: { get: (name: string) => name === "X-TLE-Fetched-At" ? String(Date.now()) : null },
  }));
  vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition: geoMock } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// The app now defaults to 3D; tests exercising the 2D map click/feature flow switch first.
const switchTo2d = async () => {
  fireEvent.click(screen.getByRole("button", { name: /show 2d map/i }));
  await act(async () => {
    await import("../src/MapView");
  });
};

describe("App", () => {
  it("fetches the TLE list and collapses an unfiltered count to one readable total", async () => {
    render(<App />);
    await act(async () => {});
    const calls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.startsWith("/api/tle?group=active"))).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(document.querySelector(".count-pill")?.textContent).toBe("3 objects");
    expect(screen.getByText("CATALOG FRESH")).toBeInTheDocument();
    expect(screen.getByText("REAL-TIME")).toBeInTheDocument();
    expect(screen.getByText(/Select a satellite to inspect/i)).toBeInTheDocument();
  });

  it("restarts an aborted catalog request during a StrictMode remount", async () => {
    let tleRequests = 0;
    vi.mocked(fetch).mockImplementation((url, init) => {
      if (!String(url).includes("/api/tle")) return Promise.reject(new Error("decorative asset unavailable"));
      tleRequests += 1;
      if (tleRequests === 1) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      }
      return Promise.resolve({
        ok: true,
        text: async () => TLE_BLOCKS,
        headers: { get: (name: string) => name === "X-TLE-Fetched-At" ? String(Date.now()) : null },
      } as unknown as Response);
    });
    render(<StrictMode><App /></StrictMode>);
    await act(async () => {});
    expect(tleRequests).toBe(2);
    expect(screen.getByText("CATALOG FRESH")).toBeInTheDocument();
    expect(document.querySelector(".count-pill")?.textContent).toBe("3 objects");
  });

  it("removes the first-use selection cue after a satellite is chosen", async () => {
    render(<App />);
    await act(async () => {});
    expect(screen.getByText(/Select a satellite to inspect/i)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /search satellites/i }), {
      target: { value: "ISS" },
    });
    fireEvent.click(screen.getByRole("button", { name: /ISS \(ZARYA\) NORAD 25544/i }));
    expect(screen.queryByText(/Select a satellite to inspect/i)).not.toBeInTheDocument();
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

  it("shows basic satellite details while observer location is unresolved", async () => {
    geoMock.mockImplementation(() => undefined);
    render(<App />);
    await act(async () => {});
    fireEvent.change(screen.getByRole("textbox", { name: /search satellites/i }), {
      target: { value: "ISS" },
    });
    fireEvent.click(screen.getByRole("button", { name: /ISS \(ZARYA\) NORAD 25544/i }));
    expect(screen.getByRole("region", { name: /ISS \(ZARYA\) details/i })).toBeInTheDocument();
    expect(geoMock).not.toHaveBeenCalled();
    expect(screen.getByText(/NORAD 25544/)).toBeInTheDocument();
    expect(screen.getByText(/Needed for visibility and pass predictions/i)).toBeInTheDocument();
  });

  it("reveals a searched satellite that was hidden by the active filters", async () => {
    render(<App />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: /regimes: none/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /search satellites/i }), {
      target: { value: "ISS" },
    });
    fireEvent.click(screen.getByRole("button", { name: /ISS \(ZARYA\) NORAD 25544/i }));
    expect(screen.getByRole("checkbox", { name: "LEO" })).toBeChecked();
    expect(screen.getByRole("region", { name: /ISS \(ZARYA\) details/i })).toBeInTheDocument();
    expect(screen.getByText(/Filters updated to show ISS/i)).toBeInTheDocument();
  });

  it("shows an actionable no-results state", async () => {
    render(<App />);
    await act(async () => {});
    fireEvent.change(screen.getByRole("textbox", { name: /search satellites/i }), {
      target: { value: "not-a-satellite" },
    });
    expect(screen.getByText(/No satellites match/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /close search/i })).not.toHaveLength(0);
  });

  it("uses Escape to close search, filters, then selection", async () => {
    render(<App />);
    await act(async () => {});
    const search = screen.getByRole("textbox", { name: /search satellites/i });
    fireEvent.change(search, { target: { value: "ISS" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(search).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: /toggle filters/i }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector(".controls")).toHaveClass("closed");

    fireEvent.change(search, { target: { value: "ISS" } });
    fireEvent.click(screen.getByRole("button", { name: /ISS \(ZARYA\) NORAD 25544/i }));
    expect(screen.getByRole("region", { name: /ISS \(ZARYA\) details/i })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("region", { name: /ISS \(ZARYA\) details/i })).not.toBeInTheDocument();
  });

  it("honors the server stale-catalog header", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => TLE_BLOCKS,
      headers: { get: (name: string) => name === "X-TLE-Stale" ? "true" : null },
    } as unknown as Response);
    render(<App />);
    await act(async () => {});
    expect(screen.getByText("CATALOG STALE")).toBeInTheDocument();
  });

  it("does not describe a catalog with unknown retrieval time as fresh", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => TLE_BLOCKS,
      headers: { get: () => null },
    } as unknown as Response);
    render(<App />);
    await act(async () => {});
    expect(screen.getByText("CATALOG UNKNOWN")).toBeInTheDocument();
    expect(screen.getByText(/Download time unknown/i)).toBeInTheDocument();
  });

  it("keeps the last valid catalog when a refresh returns invalid data", async () => {
    let tleRequests = 0;
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (!String(url).includes("/api/tle")) throw new Error("decorative asset unavailable");
      tleRequests += 1;
      return { ok: true, text: async () => tleRequests === 1 ? TLE_BLOCKS : "" } as Response;
    });
    render(<App />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: /refresh satellite catalog/i }));
    await act(async () => {});
    expect(document.querySelector(".count-pill")?.textContent).toBe("3 objects");
    expect(screen.getByText("CATALOG STALE")).toBeInTheDocument();
    expect(screen.getByText(/showing last catalog/i)).toBeInTheDocument();
  });

  it("accepts manual observer coordinates for visibility predictions", async () => {
    render(<App />);
    await act(async () => {});
    fireEvent.change(screen.getByRole("textbox", { name: /search satellites/i }), { target: { value: "ISS" } });
    fireEvent.click(screen.getByRole("button", { name: /ISS \(ZARYA\) NORAD 25544/i }));
    fireEvent.click(screen.getByRole("button", { name: /set observer location/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /observer latitude/i }), { target: { value: "5.56" } });
    fireEvent.change(screen.getByRole("textbox", { name: /observer longitude/i }), { target: { value: "-0.21" } });
    fireEvent.click(screen.getByRole("button", { name: /set observer/i }));
    expect(screen.getByText(/Visible now from manual observer/i)).toBeInTheDocument();
    expect(screen.getByText(/Observer 5\.56°, -0\.21°/)).toBeInTheDocument();
  });

  it("rejects missing and out-of-range manual observer coordinates", async () => {
    render(<App />);
    await act(async () => {});
    fireEvent.change(screen.getByRole("textbox", { name: /search satellites/i }), { target: { value: "ISS" } });
    fireEvent.click(screen.getByRole("button", { name: /ISS \(ZARYA\) NORAD 25544/i }));
    fireEvent.click(screen.getByRole("button", { name: /set observer location/i }));
    fireEvent.click(screen.getByRole("button", { name: /^set observer$/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/enter both latitude and longitude/i);
    fireEvent.change(screen.getByRole("textbox", { name: /observer latitude/i }), { target: { value: "5" } });
    fireEvent.change(screen.getByRole("textbox", { name: /observer longitude/i }), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: /^set observer$/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/longitude must be between/i);
  });

  it("moves focus out of search after selecting a result with Enter", async () => {
    render(<App />);
    await act(async () => {});
    const search = screen.getByRole("textbox", { name: /search satellites/i });
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: "ISS" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
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
    expect(screen.getByText(/Observer 48\.86°, 2\.35°/)).toBeInTheDocument();
  });

  it("shows a banner when the TLE fetch fails", async () => {
    // reject every fetch: the 3D globe's countries fetch is decorative and swallowed, the TLE fetch drives the banner
    vi.mocked(fetch).mockRejectedValue(new Error("network"));
    render(<App />);
    await act(async () => {});
    expect(screen.getByText(/TLE provider unreachable/)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /set observer location/i }));
    fireEvent.click(screen.getByRole("button", { name: /use my location/i }));
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
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("button", { name: /following/i })).not.toBeInTheDocument();
  });

  it("closes the details panel via the header close icon", async () => {
    render(<App />);
    await act(async () => {});
    await switchTo2d();
    await act(async () => { vi.advanceTimersByTime(2000); });
    await act(async () => {
      capturedClick!({ point: { x: 0, y: 0 } });
    });
    expect(screen.getByText("ISS (ZARYA)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("ISS (ZARYA)")).not.toBeInTheDocument();
  });

  it("merges next passes into the details panel", async () => {
    render(<App />);
    await act(async () => {});
    await switchTo2d();
    await act(async () => { vi.advanceTimersByTime(2000); });
    await act(async () => {
      capturedClick!({ point: { x: 0, y: 0 } });
    });
    fireEvent.click(screen.getByRole("button", { name: /set observer location/i }));
    fireEvent.click(screen.getByRole("button", { name: /use my location/i }));
    await act(async () => { vi.advanceTimersByTime(2000); });
    fireEvent.click(screen.getByRole("button", { name: /show technical details/i }));
    expect(screen.getByText(/Upcoming passes/i)).toBeInTheDocument();
    expect(screen.getByText(/Prediction from orbital elements/i)).toBeInTheDocument();
    expect(document.querySelector(".pass-list")).toBeNull();
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

  it("keeps the orbital context visible while search results are open", async () => {
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
    expect(dots).toHaveLength(3);
    expect(screen.getByText("STARLINK-1008")).toBeInTheDocument();
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

  it("shows per-filter counts in the filter chips", async () => {
    render(<App />);
    await act(async () => {});
    const leoChip = screen.getByRole("checkbox", { name: "LEO" }).closest("label")!;
    expect(leoChip.textContent).toContain("LEO");
    expect(leoChip.textContent).toContain("2");
    const geoChip = screen.getByRole("checkbox", { name: "GEO" }).closest("label")!;
    expect(geoChip.textContent).toContain("1");
    expect(screen.queryByRole("checkbox", { name: "starlink" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Filter by type" }));
    const starlinkChip = screen.getByRole("checkbox", { name: "starlink" }).closest("label")!;
    expect(starlinkChip.textContent).toContain("1");
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
    expect(screen.getAllByText(/ISS \(ZARYA\)/).length).toBeGreaterThanOrEqual(2);
  });

  it("wraps the observer longitude into ±180", async () => {
    render(<App />);
    await act(async () => {});
    await switchTo2d();
    clickHitsFeature = false;
    await act(async () => {
      capturedClick!({ lngLat: { lng: 293.78, lat: 48.86 } });
    });
    expect(screen.getByText(/Observer 48\.86°, -66\.22°/)).toBeInTheDocument();
  });

  it("hides the inactive filter section when the filter mode is switched", async () => {
    render(<App />);
    await act(async () => {});
    // orbit mode (default): only the orbit section exists
    expect(screen.getByRole("checkbox", { name: "LEO" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "starlink" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Filter by type" }));
    // type mode: orbit section disappears entirely, constellation appears
    expect(screen.queryByRole("checkbox", { name: "LEO" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "starlink" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Filter by orbit" }));
    expect(screen.getByRole("checkbox", { name: "LEO" })).toBeInTheDocument();
  });

  it("applies only the active filter dimension", async () => {
    render(<App />);
    await act(async () => {});
    const shown = () => document.querySelector(".count-pill")?.textContent ?? "";
    // orbit mode: unchecking LEO hides both LEO sats (ISS + STARLINK), leaving GOES
    fireEvent.click(screen.getByRole("checkbox", { name: "LEO" }));
    expect(shown()).toContain("1 shown");
    expect(shown()).toContain("3 loaded");
    // switching to type mode ignores the regime selection entirely
    fireEvent.click(screen.getByRole("radio", { name: "Filter by type" }));
    expect(shown()).toBe("3 objects");
  });

  it("toggles the day/night overlay", async () => {
    render(<App />);
    await act(async () => {});
    const btn = screen.getByLabelText("Day/Night");
    expect(btn).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  it("locks and unlocks the selection from the details panel", async () => {
    render(<App />);
    await act(async () => {});
    await switchTo2d();
    await act(async () => { vi.advanceTimersByTime(2000); });
    await act(async () => {
      capturedClick!({ point: { x: 0, y: 0 } });
    });
    fireEvent.click(screen.getByRole("button", { name: /lock/i }));
    expect(screen.getByRole("button", { name: /unlock/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /unlock/i }));
    expect(screen.getByRole("button", { name: /lock/i })).toBeInTheDocument();
  });

  it("collapses and expands the controls panel via the gear button", async () => {
    render(<App />);
    await act(async () => {});
    expect(document.querySelector(".controls")?.classList.contains("closed")).toBe(true);
    fireEvent.click(screen.getByLabelText("Toggle filters"));
    expect(document.querySelector(".controls")?.classList.contains("open")).toBe(true);
    fireEvent.click(screen.getByLabelText("Toggle filters"));
    expect(document.querySelector(".controls")?.classList.contains("closed")).toBe(true);
  });

  it("toggles between 2D and 3D modes", async () => {
    render(<App />);
    await act(async () => {});
    const twoDimensional = screen.getByRole("button", { name: /show 2d map/i });
    fireEvent.click(twoDimensional);
    expect(screen.getByRole("button", { name: /show 3d globe/i })).toBeInTheDocument();
  });

  it("pauses and resumes the simulation clock", async () => {
    render(<App />);
    await act(async () => {});
    const reset = screen.getByRole("button", { name: /return to live time/i });
    expect(screen.getByText("REAL-TIME")).toBeInTheDocument();
    expect(reset).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /pause simulation/i }));
    expect(screen.getByText("PAUSED")).toBeInTheDocument();
    expect(reset).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /resume live simulation/i }));
    expect(screen.getByText("REAL-TIME")).toBeInTheDocument();
    expect(reset).toBeDisabled();
  });

  it("refreshes the catalog without reloading the page", async () => {
    render(<App />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: /refresh satellite catalog/i }));
    await act(async () => {});
    const calls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/api/tle"));
    expect(calls).toHaveLength(2);
  });

  it("refreshes the catalog periodically while the app remains open", async () => {
    render(<App />);
    await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(15 * 60_000); });
    const calls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/api/tle"));
    expect(calls).toHaveLength(2);
  });
});
