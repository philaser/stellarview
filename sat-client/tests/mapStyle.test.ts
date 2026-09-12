import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import { MAP_PALETTE, createMapStyle } from "../src/mapStyle";

describe("createMapStyle", () => {
  it("produces a valid MapLibre v8 style", () => {
    const errors = validateStyleMin(createMapStyle());

    expect(errors.map((error) => error.message)).toEqual([]);
  });

  it("uses the atlas palette and delays local detail until close zooms", () => {
    const style = createMapStyle();
    const water = style.layers.find((layer) => layer.id === "atlas-water");
    const localRoads = style.layers.find((layer) => layer.id === "atlas-roads-local");
    const buildings = style.layers.find((layer) => layer.id === "atlas-buildings");

    expect(water?.type).toBe("fill");
    if (water?.type === "fill") expect(water.paint?.["fill-color"]).toBe(MAP_PALETTE.water);
    expect(localRoads?.minzoom).toBe(13);
    expect(buildings?.minzoom).toBe(13);
  });

  it("returns a fresh style object for each map instance", () => {
    expect(createMapStyle()).not.toBe(createMapStyle());
    expect(createMapStyle().layers).not.toBe(createMapStyle().layers);
  });
});
