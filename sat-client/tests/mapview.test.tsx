import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import MapView, { type MapViewProps } from "../src/MapView";

let capturedClick: ((e: unknown) => void) | null = null;
let loadHandler: (() => void) | null = null;
let moveHandler: (() => void) | null = null;
let clickHitsFeature = true;
let clickReturnsCluster = false;
let mockZoom = 4;
let mockLngLat = { lng: 2.35, lat: 48.86 };
const mockBounds = { west: 0, south: 0, east: 20, north: 20 };
const addSourceMock = vi.fn();
const addLayerMock = vi.fn();
const setDataMock = vi.fn();
const easeToMock = vi.fn();
const flyToMock = vi.fn();
const setLayoutPropertyMock = vi.fn();
const removeLayerMock = vi.fn();
const addedSources = new Set<string>();
const addedLayers = new Set<string>();

vi.mock("maplibre-gl", () => ({
  default: class {
    on(evt: string, cb: (e: unknown) => void) {
      if (evt === "click") capturedClick = cb;
      if (evt === "load") loadHandler = cb as () => void;
      if (evt === "move") moveHandler = cb as () => void;
    }
    addSource(...a: unknown[]) { addSourceMock(...a); addedSources.add(a[0] as string); }
    addLayer(...a: unknown[]) { addLayerMock(...a); addedLayers.add((a[0] as { id: string }).id); }
    removeLayer(...a: unknown[]) { removeLayerMock(...a); }
    removeSource() {}
    getSource(name: string) { return addedSources.has(name) ? { setData: setDataMock } : undefined; }
    getLayer(name: string) { return addedLayers.has(name) ? {} : undefined; }
    setLayoutProperty(...a: unknown[]) { setLayoutPropertyMock(...a); }
    getBounds() {
      return {
        getWest: () => mockBounds.west,
        getSouth: () => mockBounds.south,
        getEast: () => mockBounds.east,
        getNorth: () => mockBounds.north,
      };
    }
    queryRenderedFeatures() {
      return clickReturnsCluster
        ? [{ properties: { point_count: 42 } }]
        : clickHitsFeature
          ? [{ properties: { catnr: 25544 } }]
          : [];
    }
    easeTo(...a: unknown[]) { easeToMock(...a); }
    flyTo(...a: unknown[]) { flyToMock(...a); }
    getZoom() { return mockZoom; }
    remove() {}
  },
  Map: class {
    on(evt: string, cb: (e: unknown) => void) {
      if (evt === "click") capturedClick = cb;
      if (evt === "load") loadHandler = cb as () => void;
      if (evt === "move") moveHandler = cb as () => void;
    }
    addSource(...a: unknown[]) { addSourceMock(...a); addedSources.add(a[0] as string); }
    addLayer(...a: unknown[]) { addLayerMock(...a); addedLayers.add((a[0] as { id: string }).id); }
    removeLayer(...a: unknown[]) { removeLayerMock(...a); }
    removeSource() {}
    getSource(name: string) { return addedSources.has(name) ? { setData: setDataMock } : undefined; }
    getLayer(name: string) { return addedLayers.has(name) ? {} : undefined; }
    setLayoutProperty(...a: unknown[]) { setLayoutPropertyMock(...a); }
    getBounds() {
      return {
        getWest: () => mockBounds.west,
        getSouth: () => mockBounds.south,
        getEast: () => mockBounds.east,
        getNorth: () => mockBounds.north,
      };
    }
    queryRenderedFeatures() {
      return clickReturnsCluster
        ? [{ properties: { point_count: 42 } }]
        : clickHitsFeature
          ? [{ properties: { catnr: 25544 } }]
          : [];
    }
    easeTo(...a: unknown[]) { easeToMock(...a); }
    flyTo(...a: unknown[]) { flyToMock(...a); }
    getZoom() { return mockZoom; }
    remove() {}
  },
}));

describe("MapView", () => {
  beforeEach(() => {
    capturedClick = null;
    loadHandler = null;
    moveHandler = null;
    clickHitsFeature = true;
    clickReturnsCluster = false;
    mockZoom = 4;
    mockLngLat = { lng: 2.35, lat: 48.86 };
    addSourceMock.mockClear();
    addLayerMock.mockClear();
    setDataMock.mockClear();
    easeToMock.mockClear();
    flyToMock.mockClear();
    setLayoutPropertyMock.mockClear();
    removeLayerMock.mockClear();
    addedSources.clear();
    addedLayers.clear();
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

  it("adds the satellites, orbits, and clusters sources", () => {
    render(<MapView {...props} />);
    act(() => {
      loadHandler!();
    });
    expect(addSourceMock).toHaveBeenCalledWith("satellites", expect.objectContaining({ type: "geojson" }));
    expect(addSourceMock).toHaveBeenCalledWith("orbits", expect.objectContaining({ type: "geojson" }));
    expect(addSourceMock).toHaveBeenCalledWith("clusters", expect.objectContaining({ type: "geojson" }));
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
    capturedClick!({ point: { x: 0, y: 0 } });
    expect(onSelect).toHaveBeenCalledWith(25544);
  });

  it("reports an empty-map click via onSetObserver", () => {
    const onSetObserver = vi.fn();
    render(<MapView {...props} onSetObserver={onSetObserver} />);
    clickHitsFeature = false;
    capturedClick!({ lngLat: mockLngLat });
    expect(onSetObserver).toHaveBeenCalledWith(48.86, 2.35);
  });

  it("uses data-driven radius and white halo stroke for satellite dots", () => {
    render(<MapView {...props} />);
    act(() => {
      loadHandler!();
    });
    const layerCall = addLayerMock.mock.calls.find((c) => c[0].id === "satellites-layer");
    expect(layerCall).toBeDefined();
    const paint = layerCall![0].paint;
    expect(paint["circle-radius"]).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      0,
      ["case", ["get", "selected"], 6, 4],
      10,
      ["case", ["get", "selected"], 14, 9],
    ]);
    expect(paint["circle-stroke-color"]).toEqual("#ffffff");
    expect(paint["circle-stroke-width"]).toEqual(["case", ["get", "selected"], 3, 2]);
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
    expect(easeToMock).toHaveBeenCalledWith(expect.objectContaining({ center: [2, 45], duration: 500 }));
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

  it("adds a clusters source with point_count features plus a cluster layer and label", () => {
    render(<MapView {...props} positions={[{ catnr: 1, lat: 45, lon: 2, altKm: 400 }]} />);
    act(() => { loadHandler!(); });
    const clusterSourceCall = addSourceMock.mock.calls.find((c) => c[0] === "clusters");
    expect(clusterSourceCall).toBeDefined();
    const data = clusterSourceCall![1].data;
    expect(data.features.length).toBeGreaterThan(0);
    expect(data.features[0].properties.point_count).toBe(1);
    const ids = addLayerMock.mock.calls.map((c) => c[0].id);
    expect(ids).toContain("clusters-layer");
    expect(ids).toContain("clusters-label");
  });

  it("zooms into a cluster on cluster click instead of selecting", () => {
    const onSelect = vi.fn();
    clickReturnsCluster = true;
    render(<MapView {...props} onSelect={onSelect} />);
    capturedClick!({ point: { x: 0, y: 0 }, lngLat: { lng: 2.35, lat: 48.86 } });
    expect(onSelect).not.toHaveBeenCalled();
    expect(flyToMock).toHaveBeenCalledWith(expect.objectContaining({ zoom: 6 }));
  });

  it("shows clusters and hides dots below zoom 5", () => {
    render(<MapView {...props} />);
    act(() => { loadHandler!(); });
    const satAdd = addLayerMock.mock.calls.find((c) => c[0].id === "satellites-layer");
    expect(satAdd![0].layout.visibility).toBe("none");
    const clusterAdd = addLayerMock.mock.calls.find((c) => c[0].id === "clusters-layer");
    expect(clusterAdd![0].layout.visibility).toBe("visible");
    mockZoom = 2;
    act(() => { moveHandler!(); });
    const calls = setLayoutPropertyMock.mock.calls;
    expect(calls).toContainEqual(["satellites-layer", "visibility", "none"]);
    expect(calls).toContainEqual(["clusters-layer", "visibility", "visible"]);
    expect(calls).toContainEqual(["clusters-label", "visibility", "visible"]);
  });

  it("shows dots and hides clusters at zoom 5 and above", () => {
    render(<MapView {...props} />);
    act(() => { loadHandler!(); });
    mockZoom = 6;
    act(() => { moveHandler!(); });
    const calls = setLayoutPropertyMock.mock.calls;
    expect(calls).toContainEqual(["satellites-layer", "visibility", "visible"]);
    expect(calls).toContainEqual(["clusters-layer", "visibility", "none"]);
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

  it("uses zoom-interpolated dot radius", () => {
    render(<MapView {...props} />);
    act(() => { loadHandler!(); });
    const layerCall = addLayerMock.mock.calls.find((c) => c[0].id === "satellites-layer");
    expect(layerCall![0].paint["circle-radius"]).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      0,
      ["case", ["get", "selected"], 6, 4],
      10,
      ["case", ["get", "selected"], 14, 9],
    ]);
  });

  it("adds the night overlay layer when a polygon is provided", () => {
    const poly: [number, number][] = [[-180, -85], [0, -85], [180, -85], [180, 85], [0, 85], [-180, 85], [-180, -85]];
    const { rerender } = render(<MapView {...props} />);
    act(() => { loadHandler!(); });
    rerender(<MapView {...props} night={poly} />);
    const nightCall = addSourceMock.mock.calls.find((c) => c[0] === "night");
    expect(nightCall).toBeDefined();
    expect(addLayerMock.mock.calls.some((c) => c[0].id === "night-layer" && c[1] === "satellites-layer")).toBe(true);
  });

  it("removes the night overlay when the polygon is null", () => {
    const poly: [number, number][] = [[-180, -85], [0, -85], [180, -85], [180, 85], [0, 85], [-180, 85], [-180, -85]];
    const { rerender } = render(<MapView {...props} night={poly} />);
    act(() => { loadHandler!(); });
    rerender(<MapView {...props} night={null} />);
    expect(removeLayerMock).toHaveBeenCalledWith("night-layer");
  });
});
