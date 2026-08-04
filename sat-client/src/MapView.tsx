import { useEffect, useRef, useState } from "react";
import maplibregl, { Map as MapLibreMap } from "maplibre-gl";

export interface SatDot {
  catnr: number;
  lat: number;
  lon: number;
  altKm: number;
  velocityKms?: number;
  color?: string;
}

export interface MapViewProps {
  positions: SatDot[];
  orbits: Record<number, [number, number][]>;
  observer: { lat: number; lon: number } | null;
  onSelect: (catnr: number) => void;
  onSetObserver: (lat: number, lon: number) => void;
}

export default function MapView({
  positions,
  orbits,
  observer,
  onSelect,
  onSetObserver,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [styleLoaded, setStyleLoaded] = useState(false);
  const onSelectRef = useRef(onSelect);
  const onSetObserverRef = useRef(onSetObserver);
  onSelectRef.current = onSelect;
  onSetObserverRef.current = onSetObserver;

  useEffect(() => {
    const map = new MapLibreMap({
      container: containerRef.current!,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [0, 30],
      zoom: 2,
    });
    map.on("load", () => {
      if (mapRef.current === map) setStyleLoaded(true);
    });
    map.on("click", (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ["satellites-layer"] });
      if (features.length > 0) {
        onSelectRef.current((features[0].properties?.catnr as number) ?? -1);
      } else {
        onSetObserverRef.current(e.lngLat.lat, e.lngLat.lng);
      }
    });
    mapRef.current = map;
    return () => map.remove();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded) return;

    const satFeatures: GeoJSON.Feature[] = positions.map((p) => ({
      type: "Feature",
      properties: { catnr: p.catnr, color: p.color ?? "#94a3b8" },
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
    }));
    const satData: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: satFeatures };

    if (!map.getSource("satellites")) {
      map.addSource("satellites", { type: "geojson", data: satData });
      map.addLayer({
        id: "satellites-layer",
        type: "circle",
        source: "satellites",
        paint: { "circle-radius": 4, "circle-color": ["get", "color"] },
      });
    } else {
      (map.getSource("satellites") as maplibregl.GeoJSONSource).setData(satData);
    }
  }, [positions, styleLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded) return;

    const orbitFeatures: GeoJSON.Feature[] = Object.entries(orbits).map(([catnr, coords]) => ({
      type: "Feature",
      properties: { color: "#64748b" },
      geometry: { type: "LineString", coordinates: coords },
    }));
    const orbitData: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: orbitFeatures };

    if (!map.getSource("orbits")) {
      map.addSource("orbits", { type: "geojson", data: orbitData });
      map.addLayer({
        id: "orbits-layer",
        type: "line",
        source: "orbits",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 1, "line-opacity": 0.5, "line-dasharray": [2, 1] },
      });
    } else {
      (map.getSource("orbits") as maplibregl.GeoJSONSource).setData(orbitData);
    }
  }, [orbits, styleLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded) return;
    const feature: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: observer
        ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [observer.lon, observer.lat] } }]
        : [],
    };
    if (!map.getSource("observer")) {
      map.addSource("observer", { type: "geojson", data: feature });
      map.addLayer({
        id: "observer-layer",
        type: "circle",
        source: "observer",
        paint: { "circle-radius": 6, "circle-color": "#f8fafc", "circle-stroke-color": "#0f172a", "circle-stroke-width": 2 },
      });
    } else {
      (map.getSource("observer") as maplibregl.GeoJSONSource).setData(feature);
    }
  }, [observer, styleLoaded]);

  return <div ref={containerRef} className="map" />;
}
