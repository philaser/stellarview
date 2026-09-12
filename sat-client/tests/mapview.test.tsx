import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import MapView, { type MapViewProps } from "../src/MapView";

let capturedClick: ((e: unknown) => void) | null = null;
let errorHandler: (() => void) | null = null;
let loadHandler: (() => void) | null = null;
let moveHandler: (() => void) | null = null;
let mockMousemoveHandler: ((e: unknown) => void) | null = null;
let mockMouseleaveHandler: (() => void) | null = null;
let clickHitsFeature = true;
let mockHits: Array<{ properties: { catnr: number }; geometry: { type: string; coordinates: number[] } }> | null = null;
let mockLngLat = { lng: 2.35, lat: 48.86 };
const mockBounds = { west: 0, south: 0, east: 20, north: 20 };
const mockCanvas = { style: {} as Record<string, string> };
const addSourceMock = vi.fn();
const addLayerMock = vi.fn();
const setDataMock = vi.fn();
const easeToMock = vi.fn();
const flyToMock = vi.fn();
const setFeatureStateMock = vi.fn();
const setPaintPropertyMock = vi.fn();
const removeLayerMock = vi.fn();
const addedSources = new Set<string>();
const addedLayers = new Set<string>();

vi.mock("maplibre-gl", () => ({
  default: class {

    dragPan = { enable() {}, disable() {} };
    scrollZoom = { enable() {}, disable() {} };
    boxZoom = { enable() {}, disable() {} };
    doubleClickZoom = { enable() {}, disable() {} };
    keyboard = { enable() {}, disable() {} };
    touchZoomRotate = { enable() {}, disable() {}, disableRotation() {} };
    project(coords: [number, number]) { return { x: coords[0], y: coords[1] }; }
    zoomIn() {}
    zoomOut() {}
    on(evt: string, cb: (e: unknown) => void) {
      if (evt === "click") capturedClick = cb;
      if (evt === "error") errorHandler = cb as () => void;
      if (evt === "load") loadHandler = cb as () => void;
      if (evt === "move") moveHandler = cb as () => void;
      if (evt === "mousemove") mockMousemoveHandler = cb;
      if (evt === "mouseleave") mockMouseleaveHandler = cb as () => void;
    }
    addSource(...a: unknown[]) { addSourceMock(...a); addedSources.add(a[0] as string); }
    addLayer(...a: unknown[]) { addLayerMock(...a); addedLayers.add((a[0] as { id: string }).id); }
    removeLayer(...a: unknown[]) { removeLayerMock(...a); }
    removeSource() {}
    getSource(name: string) { return addedSources.has(name) ? { setData: setDataMock } : undefined; }
    getLayer(name: string) { return addedLayers.has(name) ? {} : undefined; }
    setFeatureState(...a: unknown[]) { setFeatureStateMock(...a); }
    setPaintProperty(...a: unknown[]) { setPaintPropertyMock(...a); }
    getCanvas() { return mockCanvas; }
    getBounds() {
      return {
        getWest: () => mockBounds.west,
        getSouth: () => mockBounds.south,
        getEast: () => mockBounds.east,
        getNorth: () => mockBounds.north,
      };
    }
    queryRenderedFeatures() {
      return mockHits ?? (clickHitsFeature ? [{ properties: { catnr: 25544 }, geometry: { type: "Point", coordinates: [0, 0] } }] : []);
    }
    easeTo(...a: unknown[]) { easeToMock(...a); }
    flyTo(...a: unknown[]) { flyToMock(...a); }
    remove() {}
  },
  Map: class {

    dragPan = { enable() {}, disable() {} };
    scrollZoom = { enable() {}, disable() {} };
    boxZoom = { enable() {}, disable() {} };
    doubleClickZoom = { enable() {}, disable() {} };
    keyboard = { enable() {}, disable() {} };
    touchZoomRotate = { enable() {}, disable() {}, disableRotation() {} };
    project(coords: [number, number]) { return { x: coords[0], y: coords[1] }; }
    zoomIn() {}
    zoomOut() {}
    on(evt: string, cb: (e: unknown) => void) {
      if (evt === "click") capturedClick = cb;
      if (evt === "error") errorHandler = cb as () => void;
      if (evt === "load") loadHandler = cb as () => void;
      if (evt === "move") moveHandler = cb as () => void;
      if (evt === "mousemove") mockMousemoveHandler = cb;
      if (evt === "mouseleave") mockMouseleaveHandler = cb as () => void;
    }
    addSource(...a: unknown[]) { addSourceMock(...a); addedSources.add(a[0] as string); }
    addLayer(...a: unknown[]) { addLayerMock(...a); addedLayers.add((a[0] as { id: string }).id); }
    removeLayer(...a: unknown[]) { removeLayerMock(...a); }
    removeSource() {}
    getSource(name: string) { return addedSources.has(name) ? { setData: setDataMock } : undefined; }
    getLayer(name: string) { return addedLayers.has(name) ? {} : undefined; }
    setFeatureState(...a: unknown[]) { setFeatureStateMock(...a); }
    setPaintProperty(...a: unknown[]) { setPaintPropertyMock(...a); }
    getCanvas() { return mockCanvas; }
    getBounds() {
      return {
        getWest: () => mockBounds.west,
        getSouth: () => mockBounds.south,
        getEast: () => mockBounds.east,
        getNorth: () => mockBounds.north,
      };
    }
    queryRenderedFeatures() {
      return mockHits ?? (clickHitsFeature ? [{ properties: { catnr: 25544 }, geometry: { type: "Point", coordinates: [0, 0] } }] : []);
    }
    easeTo(...a: unknown[]) { easeToMock(...a); }
    flyTo(...a: unknown[]) { flyToMock(...a); }
    remove() {}
  },
}));

describe("MapView", () => {
  beforeEach(() => {
    capturedClick = null;
    loadHandler = null;
    moveHandler = null;
    mockMousemoveHandler = null;
    mockMouseleaveHandler = null;
    clickHitsFeature = true;
    mockHits = null;
    mockLngLat = { lng: 2.35, lat: 48.86 };
    mockCanvas.style = {};
    addSourceMock.mockClear();
    addLayerMock.mockClear();
    setDataMock.mockClear();
    easeToMock.mockClear();
    flyToMock.mockClear();
    setFeatureStateMock.mockClear();
    setPaintPropertyMock.mockClear();
    removeLayerMock.mockClear();
    addedSources.clear();
    addedLayers.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const props: MapViewProps = {
    positions: [],
    orbits: {},
    observer: null,
    onSelect: () => {},
    onSetObserver: () => {},
    followCatnr: null,
    focus: null,
    night: null,
  };

  it("glides between snapshots instead of jumping to the latest coordinate", () => {
    let frame: FrameRequestCallback = () => {};
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frame = cb; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const first = [{ catnr: 1, lon: 10, lat: 10, altKm: 400 }];
    const view = render(<MapView {...props} positions={first} />);
    act(() => { loadHandler!(); });
    clock.mockReturnValue(2000);
    view.rerender(<MapView {...props} positions={[{ ...first[0], lon: 12, lat: 14 }]} />);
    setDataMock.mockClear();
    clock.mockReturnValue(3000);
    act(() => { frame(3000); });
    expect(setDataMock).toHaveBeenCalled();
    const data = setDataMock.mock.calls.at(-1)![0];
    expect(data.features[0].geometry.coordinates).toEqual([11, 12]);
    view.unmount();
    clock.mockRestore();
  });

  it("explains initial loading and a failed map load", () => {
    render(<MapView {...props} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading map");
    act(() => { errorHandler!(); });
    expect(screen.getByRole("alert")).toHaveTextContent("Map tiles could not load");
    act(() => { loadHandler!(); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("registers valid runtime overlay styles with MapLibre", () => {
    render(<MapView {...props} night={[[-180, -80], [0, 80], [180, -80], [-180, -80]]} />);
    act(() => { loadHandler!(); });
    const errors = validateStyleMin({
      version: 8,
      sources: Object.fromEntries(addSourceMock.mock.calls),
      layers: addLayerMock.mock.calls.map(([layer]) => layer),
    });
    expect(errors.map((error) => error.message)).toEqual([]);
  });

  it("adds the satellites and orbits sources", () => {
    render(<MapView {...props} />);
    act(() => {
      loadHandler!();
    });
    expect(addSourceMock).toHaveBeenCalledWith("satellites", expect.objectContaining({ type: "geojson" }));
    expect(addSourceMock).toHaveBeenCalledWith("orbits", expect.objectContaining({ type: "geojson" }));
  });

  it("updates satellite positions via setData", () => {
    const { rerender } = render(<MapView {...props} />);
    act(() => {
      loadHandler!();
    });
    rerender(
      <MapView {...props} positions={[{ catnr: 25544, lat: 45, lon: 2, altKm: 420 }]} />
    );
    const satCalls = setDataMock.mock.calls.filter(([data]) =>
      (data.features ?? []).some((f: { properties: { catnr?: number } }) => f.properties?.catnr !== undefined)
    );
    expect(satCalls).toHaveLength(1);
    const [data] = satCalls[0];
    expect(data.features).toHaveLength(1);
    expect(data.features[0].properties.catnr).toBe(25544);
  });

  it("reports a satellite click via onSelect", () => {
    const onSelect = vi.fn();
    render(<MapView {...props} onSelect={onSelect} />);
    act(() => { loadHandler!(); });
    capturedClick!({ point: { x: 0, y: 0 } });
    expect(onSelect).toHaveBeenCalledWith(25544);
  });

  it("selects the closest satellite within the enlarged click target", () => {
    const onSelect = vi.fn();
    render(<MapView {...props} onSelect={onSelect} />);
    act(() => { loadHandler!(); });
    mockHits = [
      { properties: { catnr: 2 }, geometry: { type: "Point", coordinates: [10, 0] } },
      { properties: { catnr: 1 }, geometry: { type: "Point", coordinates: [2, 0] } },
    ];
    act(() => { capturedClick!({ point: { x: 0, y: 0 }, lngLat: mockLngLat }); });
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("reports an empty-map click via onSetObserver", () => {
    const onSetObserver = vi.fn();
    render(<MapView {...props} placingObserver onSetObserver={onSetObserver} />);
    act(() => { loadHandler!(); });
    clickHitsFeature = false;
    capturedClick!({ point: { x: 0, y: 0 }, lngLat: mockLngLat });
    expect(onSetObserver).toHaveBeenCalledWith(48.86, 2.35);
  });

  it("keeps hovered and selected satellites prominent above zoom-scaled dots", () => {
    render(<MapView {...props} />);
    act(() => {
      loadHandler!();
    });
    const layerCall = addLayerMock.mock.calls.find((c) => c[0].id === "satellites-layer");
    expect(layerCall).toBeDefined();
    const paint = layerCall![0].paint;
    expect(paint["circle-radius"]).toEqual([
      "interpolate", ["linear"], ["zoom"],
      1, ["case", ["boolean", ["feature-state", "hover"], false], 6, ["get", "selected"], 5, 1.5],
      3, ["case", ["boolean", ["feature-state", "hover"], false], 6, ["get", "selected"], 5, 1.8],
      6, ["case", ["boolean", ["feature-state", "hover"], false], 6, ["get", "selected"], 5, 2.4],
    ]);
    expect(paint["circle-stroke-color"]).toEqual(["case", ["get", "selected"], "#d6ffeb", "#071521"]);
    expect(paint["circle-stroke-width"]).toEqual(["case", ["get", "selected"], 1.5, 0]);
  });

  it("follows the selected satellite with easeTo when followCatnr is set", () => {
    const { rerender } = render(<MapView {...props} />);
    act(() => { loadHandler!(); });
    rerender(
      <MapView
        {...props}
        positions={[{ catnr: 25544, lat: 45, lon: 2, altKm: 420 }]}
        followCatnr={25544}
      />
    );
    expect(easeToMock).toHaveBeenCalledWith(expect.objectContaining({ center: [2, 45], duration: 0 }));
  });

  it("does not follow when followCatnr is null", () => {
    const { rerender } = render(<MapView {...props} />);
    act(() => { loadHandler!(); });
    rerender(
      <MapView {...props} positions={[{ catnr: 25544, lat: 45, lon: 2, altKm: 420 }]} followCatnr={null} />
    );
    expect(easeToMock).not.toHaveBeenCalled();
  });

  it("culls dots to the current map bounds", () => {
    const { rerender } = render(<MapView {...props} />);
    act(() => { loadHandler!(); });
    act(() => { moveHandler!(); }); // set initial bounds
    rerender(
      <MapView
        {...props}
        positions={[
          { catnr: 1, lat: 10, lon: 10, altKm: 400 },
          { catnr: 2, lat: 50, lon: 50, altKm: 400 },
        ]}
      />
    );
    const satCalls = setDataMock.mock.calls.filter(([data]) =>
      (data.features ?? []).some((f: { properties: { catnr?: number } }) => f.properties?.catnr !== undefined)
    );
    const satCall = satCalls.at(-1)!;
    const features = satCall[0].features ?? [];
    expect(features.map((f: { properties: { catnr: number } }) => f.properties.catnr)).toEqual([1]);
  });

  it("registers the satellites source without MapLibre clustering", () => {
    render(<MapView {...props} />);
    act(() => { loadHandler!(); });
    const satCall = addSourceMock.mock.calls.find((c) => c[0] === "satellites");
    expect(satCall).toBeDefined();
    expect(satCall![1]).toMatchObject({ type: "geojson" });
    expect(satCall![1]).not.toHaveProperty("cluster");
  });

  it("flies to the focused satellite's position", () => {
    const { rerender } = render(<MapView {...props} />);
    act(() => { loadHandler!(); });
    rerender(
      <MapView
        {...props}
        positions={[{ catnr: 25544, lat: 45, lon: 2, altKm: 420 }]}
        focus={{ catnr: 25544, ts: 1 }}
      />
    );
    expect(flyToMock).toHaveBeenCalledWith(expect.objectContaining({ center: [2, 45] }));
  });

  it("makes ordinary dots smaller at world scale", () => {
    render(<MapView {...props} />);
    act(() => { loadHandler!(); });
    const layerCall = addLayerMock.mock.calls.find((c) => c[0].id === "satellites-layer");
    expect(layerCall![0].paint["circle-radius"]).toEqual([
      "interpolate", ["linear"], ["zoom"],
      1, ["case", ["boolean", ["feature-state", "hover"], false], 6, ["get", "selected"], 5, 1.5],
      3, ["case", ["boolean", ["feature-state", "hover"], false], 6, ["get", "selected"], 5, 1.8],
      6, ["case", ["boolean", ["feature-state", "hover"], false], 6, ["get", "selected"], 5, 2.4],
    ]);
  });

  it("highlights a satellite dot on hover and clears it when the pointer leaves the dots", () => {
    render(<MapView {...props} />);
    act(() => { loadHandler!(); });
    act(() => {
      mockMousemoveHandler!({ point: { x: 0, y: 0 } });
    });
    expect(setFeatureStateMock).toHaveBeenCalledWith({ source: "satellites", id: 25544 }, { hover: true });
    expect(mockCanvas.style.cursor).toBe("pointer");
    clickHitsFeature = false;
    act(() => {
      mockMousemoveHandler!({ point: { x: 0, y: 0 } });
    });
    expect(setFeatureStateMock).toHaveBeenCalledWith({ source: "satellites", id: 25544 }, { hover: false });
    expect(mockCanvas.style.cursor).toBe("");
  });

  it("clears the active hover and cursor when locking", () => {
    const { rerender } = render(<MapView {...props} />);
    act(() => { loadHandler!(); });
    act(() => { mockMousemoveHandler!({ point: { x: 0, y: 0 } }); });
    expect(mockCanvas.style.cursor).toBe("pointer");
    rerender(<MapView {...props} locked />);
    expect(setFeatureStateMock).toHaveBeenLastCalledWith({ source: "satellites", id: 25544 }, { hover: false });
    expect(mockCanvas.style.cursor).toBe("");
  });

  it("clears the hover state on mouseleave", () => {
    render(<MapView {...props} />);
    act(() => { loadHandler!(); });
    act(() => {
      mockMousemoveHandler!({ point: { x: 0, y: 0 } });
    });
    expect(setFeatureStateMock).toHaveBeenCalledWith({ source: "satellites", id: 25544 }, { hover: true });
    act(() => {
      mockMouseleaveHandler!();
    });
    expect(setFeatureStateMock).toHaveBeenCalledWith({ source: "satellites", id: 25544 }, { hover: false });
    expect(mockCanvas.style.cursor).toBe("");
  });

  it("keeps a continuous orbit below the selection markers", () => {
    render(<MapView {...props} orbits={{ 25544: [[0, 0], [1, 1]] }} />);
    act(() => { loadHandler!(); });
    const orbit = addLayerMock.mock.calls.find(([layer]) => layer.id === "orbits-layer");
    expect(orbit?.[1]).toBe("satellites-selection");
    expect(orbit?.[0].paint).not.toHaveProperty("line-dasharray");
  });

  it("locks satellite selection and observer placement", () => {
    const onSelect = vi.fn();
    const onSetObserver = vi.fn();
    render(<MapView {...props} locked onSelect={onSelect} onSetObserver={onSetObserver} />);
    act(() => { loadHandler!(); });
    act(() => { capturedClick!({ point: { x: 0, y: 0 }, lngLat: mockLngLat }); });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onSetObserver).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Show world" })).toBeDisabled();
  });

  it("returns to the world view and stops following", () => {
    const onStopFollow = vi.fn();
    render(<MapView {...props} onStopFollow={onStopFollow} />);
    act(() => { loadHandler!(); });
    fireEvent.click(screen.getByRole("button", { name: "Show world" }));
    expect(onStopFollow).toHaveBeenCalled();
    expect(easeToMock).toHaveBeenCalledWith(expect.objectContaining({ center: [0, 20], zoom: 1.5 }));
  });

  it("adds the night overlay layer when a polygon is provided", () => {
    const poly: [number, number][] = [[-180, -85], [0, -85], [180, -85], [180, 85], [0, 85], [-180, 85], [-180, -85]];
    const { rerender } = render(<MapView {...props} />);
    act(() => { loadHandler!(); });
    rerender(<MapView {...props} night={poly} />);
    const nightCall = addSourceMock.mock.calls.find((c) => c[0] === "night");
    expect(nightCall).toBeDefined();
    expect(addLayerMock.mock.calls.some((c) => c[0].id === "night-layer" && c[1] === "orbits-glow")).toBe(true);
  });

  it("removes the night overlay when the polygon is null", () => {
    const poly: [number, number][] = [[-180, -85], [0, -85], [180, -85], [180, 85], [0, 85], [-180, 85], [-180, -85]];
    const { rerender } = render(<MapView {...props} night={poly} />);
    act(() => { loadHandler!(); });
    rerender(<MapView {...props} night={null} />);
    expect(removeLayerMock).toHaveBeenCalledWith("night-layer");
  });
});
