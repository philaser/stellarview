import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import MapView, { type MapViewProps } from "../src/MapView";

let capturedClick: ((e: unknown) => void) | null = null;
let loadHandler: (() => void) | null = null;
let clickHitsFeature = true;
let mockLngLat = { lng: 2.35, lat: 48.86 };
const addSourceMock = vi.fn();
const addLayerMock = vi.fn();
const setDataMock = vi.fn();
const addedSources = new Set<string>();

vi.mock("maplibre-gl", () => ({
  default: class {
    on(evt: string, cb: (e: unknown) => void) {
      if (evt === "click") capturedClick = cb;
      if (evt === "load") loadHandler = cb as () => void;
    }
    addSource(...a: unknown[]) { addSourceMock(...a); addedSources.add(a[0] as string); }
    addLayer(...a: unknown[]) { addLayerMock(...a); }
    removeLayer() {}
    removeSource() {}
    getSource(name: string) { return addedSources.has(name) ? { setData: setDataMock } : undefined; }
    getLayer() { return undefined; }
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
    addSource(...a: unknown[]) { addSourceMock(...a); addedSources.add(a[0] as string); }
    addLayer(...a: unknown[]) { addLayerMock(...a); }
    removeLayer() {}
    removeSource() {}
    getSource(name: string) { return addedSources.has(name) ? { setData: setDataMock } : undefined; }
    getLayer() { return undefined; }
    queryRenderedFeatures() {
      return clickHitsFeature ? [{ properties: { catnr: 25544 } }] : [];
    }
    flyTo() {}
    remove() {}
  },
}));

describe("MapView", () => {
  beforeEach(() => {
    capturedClick = null;
    loadHandler = null;
    clickHitsFeature = true;
    mockLngLat = { lng: 2.35, lat: 48.86 };
    addSourceMock.mockClear();
    addLayerMock.mockClear();
    setDataMock.mockClear();
    addedSources.clear();
  });

  const props: MapViewProps = {
    positions: [],
    orbits: {},
    observer: null,
    onSelect: () => {},
    onSetObserver: () => {},
  };

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
    expect(setDataMock).toHaveBeenCalled();
    const [data] = setDataMock.mock.calls.at(-1)!;
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
    expect(paint["circle-radius"]).toEqual(["case", ["get", "selected"], 11, 8]);
    expect(paint["circle-stroke-color"]).toEqual("#ffffff");
    expect(paint["circle-stroke-width"]).toEqual(["case", ["get", "selected"], 3, 2]);
  });
});
