import { useEffect, useRef, useState } from "react";
import maplibregl, { Map as MapLibreMap } from "maplibre-gl";
import type { FlightState, FlightTrack } from "../../server/src/types";

export const ALTITUDE_COLORS = {
  low: "#22c55e",
  mid: "#f59e0b",
  high: "#ef4444",
} as const;

export function altitudeColor(altBaro: number | null): string {
  if (altBaro === null) return ALTITUDE_COLORS.low;
  if (altBaro < 3000) return ALTITUDE_COLORS.low;
  if (altBaro < 7000) return ALTITUDE_COLORS.mid;
  return ALTITUDE_COLORS.high;
}

interface MapViewProps {
  bounds: [number, number, number, number];
  flights: FlightState[];
  track: FlightTrack | null;
  onSelect: (flight: FlightState | null) => void;
}

export default function MapView({ bounds, flights, track, onSelect }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [styleLoaded, setStyleLoaded] = useState(false);

  useEffect(() => {
    const map = new MapLibreMap({
      container: containerRef.current!,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
      zoom: 4,
    });
    map.on("click", (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ["flights-layer"] });
      if (features.length > 0) {
        const props = features[0].properties ?? {};
        onSelectRef.current(props as unknown as FlightState);
      }
    });
    map.on("load", () => {
      if (mapRef.current === map) setStyleLoaded(true);
    });
    mapRef.current = map;
    return () => map.remove();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({
      center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
      zoom: 4,
      duration: 1000,
    });
  }, [bounds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!styleLoaded) return;

    const positioned = flights.filter(
      (f): f is FlightState & { lat: number; lon: number } => f.lat !== null && f.lon !== null
    );
    const featureCollection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: positioned.map((f) => ({
        type: "Feature",
        properties: { ...f },
        geometry: { type: "Point", coordinates: [f.lon, f.lat] },
      })),
    };

    const source = map.getSource("flights") as maplibregl.GeoJSONSource | undefined;
    if (!source) {
      map.addSource("flights", { type: "geojson", data: featureCollection });
      map.addLayer({
        id: "flights-layer",
        type: "circle",
        source: "flights",
        paint: {
          "circle-radius": 5,
          "circle-color": [
            "interpolate",
            ["linear"],
            ["coalesce", ["get", "altitudeBaro"], 0],
            0,
            ALTITUDE_COLORS.low,
            3000,
            ALTITUDE_COLORS.low,
            3001,
            ALTITUDE_COLORS.mid,
            7000,
            ALTITUDE_COLORS.mid,
            7001,
            ALTITUDE_COLORS.high,
          ],
        },
      });
    } else {
      source.setData(featureCollection);
    }
  }, [flights, styleLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded) return;

    const removeTrack = () => {
      if (map.getLayer("track-line")) {
        map.removeLayer("track-line");
        map.removeSource("track-source");
      }
    };

    if (!track || track.points.length < 2) {
      removeTrack();
      return;
    }

    const coordinates = track.points.map((p) => [p.lon, p.lat] as [number, number]);
    const feature: GeoJSON.Feature = {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates },
    };

    if (!map.getSource("track-source")) {
      map.addSource("track-source", { type: "geojson", data: feature });
      map.addLayer(
        {
          id: "track-line",
          type: "line",
          source: "track-source",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#38bdf8",
            "line-width": 2,
            "line-dasharray": [2, 1],
          },
        },
        "flights-layer"
      );
    } else {
      (map.getSource("track-source") as maplibregl.GeoJSONSource).setData(feature);
    }
  }, [track, styleLoaded]);

  return <div ref={containerRef} className="map" />;
}
