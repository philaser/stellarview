import { useEffect, useRef, useState } from "react";
import maplibregl, { Map as MapLibreMap } from "maplibre-gl";

export interface SatDot {
  catnr: number;
  lat: number;
  lon: number;
  altKm: number;
  velocityKms?: number;
  color?: string;
  selected?: boolean;
}

export interface MapViewProps {
  positions: SatDot[];
  orbits: Record<number, [number, number][]>;
  observer: { lat: number; lon: number } | null;
  onSelect: (catnr: number) => void;
  onSetObserver: (lat: number, lon: number) => void;
  followCatnr: number | null;
  focus?: { catnr: number; ts: number } | null;
}

export default function MapView({
  positions,
  orbits,
  observer,
  onSelect,
  onSetObserver,
  followCatnr,
  focus,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [styleLoaded, setStyleLoaded] = useState(false);
  const [mapBounds, setMapBounds] = useState<{ west: number; south: number; east: number; north: number } | null>(null);
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
      const features = map.queryRenderedFeatures(e.point, {
        layers: ["satellites-cluster-layer", "satellites-layer"],
      });
      if (features.length === 0) {
        onSetObserverRef.current(e.lngLat.lat, e.lngLat.lng);
        return;
      }
      const props = features[0].properties ?? {};
      if (props.point_count !== undefined) {
        map.flyTo({ center: e.lngLat, zoom: map.getZoom() + 2, essential: true });
        return;
      }
      onSelectRef.current((props.catnr as number) ?? -1);
    });
    map.on("move", () => {
      if (mapRef.current !== map) return;
      const b = map.getBounds();
      setMapBounds({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
    });
    mapRef.current = map;
    return () => map.remove();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded) return;

    const MARGIN = 2;
    const satFeatures: GeoJSON.Feature[] = positions
      .filter((p) =>
        mapBounds
          ? p.lon >= mapBounds.west - MARGIN &&
            p.lon <= mapBounds.east + MARGIN &&
            p.lat >= mapBounds.south - MARGIN &&
            p.lat <= mapBounds.north + MARGIN
          : true
      )
      .map((p) => ({
        type: "Feature",
        properties: { ...p },
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      }));
    const satData: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: satFeatures };

    if (!map.getSource("satellites")) {
      map.addSource("satellites", { type: "geojson", data: satData, cluster: true, clusterRadius: 50 });
      map.addLayer({
        id: "satellites-cluster-layer",
        type: "circle",
        source: "satellites",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#475569",
          "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 0, 12, 200, 28],
          "circle-stroke-color": "#f8fafc",
          "circle-stroke-width": 1.5,
        },
      });
      map.addLayer({
        id: "satellites-cluster-label",
        type: "symbol",
        source: "satellites",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 11,
          "text-font": ["Open Sans Bold"],
        },
        paint: { "text-color": "#ffffff" },
      });
      map.addLayer({
        id: "satellites-layer",
        type: "circle",
        source: "satellites",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0,
            ["case", ["get", "selected"], 6, 4],
            10,
            ["case", ["get", "selected"], 14, 9],
          ],
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": ["case", ["get", "selected"], 3, 2],
        },
      });
    } else {
      (map.getSource("satellites") as maplibregl.GeoJSONSource).setData(satData);
    }
  }, [positions, styleLoaded, mapBounds]);

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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded || followCatnr === null) return;
    const target = positions.find((p) => p.catnr === followCatnr);
    if (!target) return;
    map.easeTo({ center: [target.lon, target.lat], duration: 500, essential: true });
  }, [positions, followCatnr, styleLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus || !styleLoaded) return;
    const target = positions.find((p) => p.catnr === focus.catnr);
    if (!target) return;
    map.flyTo({ center: [target.lon, target.lat], zoom: 6, essential: true });
  }, [focus, positions, styleLoaded]);

  return <div ref={containerRef} className="map" />;
}
