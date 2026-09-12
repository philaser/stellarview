import type { ExpressionSpecification, StyleSpecification } from "maplibre-gl";

export const MAP_PALETTE = {
  land: "#151d28",
  landDetail: "#1a2632",
  water: "#193e5c",
  waterway: "#245577",
  border: "#526172",
  borderDisputed: "#687789",
  roadMajor: "#405064",
  roadMinor: "#303e4e",
  building: "#1d2936",
  label: "#aeb9c6",
  labelMuted: "#8493a4",
  labelHalo: "#101721",
} as const;

const OPEN_FREE_MAP_ATTRIBUTION =
  '<a href="https://openfreemap.org">OpenFreeMap</a> · © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';

const placeName = (): ExpressionSpecification => ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name"]];

export function createMapStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      openmaptiles: {
        type: "vector",
        url: "https://tiles.openfreemap.org/planet",
        attribution: OPEN_FREE_MAP_ATTRIBUTION,
      },
    },
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    layers: [
      {
        id: "atlas-background",
        type: "background",
        paint: { "background-color": MAP_PALETTE.land },
      },
      {
        id: "atlas-landcover",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landcover",
        minzoom: 6,
        filter: ["match", ["get", "class"], ["wood", "grass", "scrub"], true, false],
        paint: {
          "fill-color": MAP_PALETTE.landDetail,
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0.2, 11, 0.55],
        },
      },
      {
        id: "atlas-water",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "water",
        filter: ["!=", ["get", "brunnel"], "tunnel"],
        paint: { "fill-color": MAP_PALETTE.water },
      },
      {
        id: "atlas-waterways",
        type: "line",
        source: "openmaptiles",
        "source-layer": "waterway",
        minzoom: 8,
        filter: ["!=", ["get", "brunnel"], "tunnel"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": MAP_PALETTE.waterway,
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0.35, 13, 0.8],
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.3, 15, 1.4],
        },
      },
      {
        id: "atlas-buildings",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "building",
        minzoom: 13,
        paint: {
          "fill-color": MAP_PALETTE.building,
          "fill-outline-color": "#263544",
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.35, 16, 0.75],
        },
      },
      {
        id: "atlas-roads-major",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        minzoom: 7,
        filter: [
          "all",
          ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
          ["match", ["get", "class"], ["motorway", "trunk", "primary"], true, false],
          ["!=", ["get", "brunnel"], "tunnel"],
        ],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": MAP_PALETTE.roadMajor,
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 7, 0.25, 11, 0.65],
          "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.35, 12, 1.1, 17, 3],
        },
      },
      {
        id: "atlas-roads-secondary",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        minzoom: 10,
        filter: [
          "all",
          ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
          ["match", ["get", "class"], ["secondary", "tertiary"], true, false],
          ["!=", ["get", "brunnel"], "tunnel"],
        ],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": MAP_PALETTE.roadMinor,
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.25, 14, 0.7],
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.3, 14, 0.85, 17, 2],
        },
      },
      {
        id: "atlas-roads-local",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        minzoom: 13,
        filter: [
          "all",
          ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false],
          ["match", ["get", "class"], ["minor", "service", "track"], true, false],
          ["!=", ["get", "brunnel"], "tunnel"],
        ],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": MAP_PALETTE.roadMinor,
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.15, 16, 0.55],
          "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.25, 17, 1.2],
        },
      },
      {
        id: "atlas-country-borders",
        type: "line",
        source: "openmaptiles",
        "source-layer": "boundary",
        filter: [
          "all",
          ["==", ["get", "admin_level"], 2],
          ["!=", ["get", "maritime"], 1],
          ["!=", ["get", "disputed"], 1],
        ],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": MAP_PALETTE.border,
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.35, 5, 0.65],
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.35, 6, 0.75, 12, 1.25],
        },
      },
      {
        id: "atlas-country-borders-disputed",
        type: "line",
        source: "openmaptiles",
        "source-layer": "boundary",
        filter: [
          "all",
          ["==", ["get", "admin_level"], 2],
          ["!=", ["get", "maritime"], 1],
          ["==", ["get", "disputed"], 1],
        ],
        paint: {
          "line-color": MAP_PALETTE.borderDisputed,
          "line-dasharray": [2, 2],
          "line-opacity": 0.55,
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.35, 8, 0.9],
        },
      },
      {
        id: "atlas-country-labels",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        maxzoom: 9,
        filter: [
          "all",
          ["==", ["get", "class"], "country"],
          ["<=", ["coalesce", ["get", "rank"], 99], 5],
        ],
        layout: {
          "text-field": placeName(),
          "text-font": ["Noto Sans Regular"],
          "text-letter-spacing": 0.12,
          "text-max-width": 7,
          "text-size": ["interpolate", ["linear"], ["zoom"], 1, 9, 5, 13, 8, 15],
          "text-transform": "uppercase",
        },
        paint: {
          "text-color": MAP_PALETTE.labelMuted,
          "text-halo-color": MAP_PALETTE.labelHalo,
          "text-halo-width": 1,
          "text-halo-blur": 0.5,
        },
      },
      {
        id: "atlas-city-labels",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        minzoom: 3,
        filter: [
          "all",
          ["==", ["get", "class"], "city"],
          ["<=", ["coalesce", ["get", "rank"], 99], 6],
        ],
        layout: {
          "symbol-sort-key": ["coalesce", ["get", "rank"], 99],
          "text-field": placeName(),
          "text-font": ["Noto Sans Regular"],
          "text-max-width": 8,
          "text-padding": 10,
          "text-size": ["interpolate", ["linear"], ["zoom"], 3, 10, 7, 12, 12, 14],
        },
        paint: {
          "text-color": MAP_PALETTE.label,
          "text-halo-color": MAP_PALETTE.labelHalo,
          "text-halo-width": 1.25,
          "text-halo-blur": 0.5,
        },
      },
      {
        id: "atlas-road-labels",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "transportation_name",
        minzoom: 12,
        filter: ["match", ["get", "class"], ["motorway", "trunk", "primary", "secondary"], true, false],
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": 450,
          "text-field": placeName(),
          "text-font": ["Noto Sans Regular"],
          "text-max-angle": 30,
          "text-size": ["interpolate", ["linear"], ["zoom"], 12, 9, 16, 11],
        },
        paint: {
          "text-color": MAP_PALETTE.labelMuted,
          "text-halo-color": MAP_PALETTE.labelHalo,
          "text-halo-width": 1,
        },
      },
    ],
  };
}
