import { useEffect, useRef } from "react";
import maplibregl, { Map as MapLibreMap } from "maplibre-gl";
import type { FlightState } from "../../server/src/types";

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
  onSelect: (flight: FlightState | null) => void;
}

export default function MapView({ bounds, flights, onSelect }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

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
    mapRef.current = map;
    return () => map.remove();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const featureCollection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: flights.map((f) => ({
        type: "Feature",
        properties: { ...f },
        geometry:
          f.lat !== null && f.lon !== null
            ? { type: "Point", coordinates: [f.lon, f.lat] }
            : { type: "Point", coordinates: [0, 0] },
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
  }, [flights]);

  return <div ref={containerRef} className="map" />;
}
