import { useEffect, useRef, useState } from "react";
import maplibregl, { Map as MapLibreMap } from "maplibre-gl";
import { bucketClusters } from "./sat/cluster";

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
  night: [number, number][] | null;
}

export default function MapView({
  positions,
  orbits,
  observer,
  onSelect,
  onSetObserver,
  followCatnr,
  focus,
  night,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [styleLoaded, setStyleLoaded] = useState(false);
  const [mapBounds, setMapBounds] = useState<{ west: number; south: number; east: number; north: number } | null>(null);
  const [mapZoom, setMapZoom] = useState(2);
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
        layers: ["clusters-layer", "satellites-layer"],
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
      const zoom = map.getZoom();
      setMapZoom(zoom);
      const dotsVisible = zoom >= 5;
      if (map.getLayer("satellites-layer")) {
        map.setLayoutProperty("satellites-layer", "visibility", dotsVisible ? "visible" : "none");
      }
      if (map.getLayer("clusters-layer")) {
        map.setLayoutProperty("clusters-layer", "visibility", dotsVisible ? "none" : "visible");
      }
      if (map.getLayer("clusters-label")) {
        map.setLayoutProperty("clusters-label", "visibility", dotsVisible ? "none" : "visible");
      }
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
      map.addSource("satellites", { type: "geojson", data: satData });
      map.addLayer({
        id: "satellites-layer",
        type: "circle",
        source: "satellites",
        layout: { visibility: "none" },
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

    const clusters = bucketClusters(
      positions.map((p) => ({ lon: p.lon, lat: p.lat })),
      mapZoom
    );
    const features: GeoJSON.Feature[] = clusters.map((c) => ({
      type: "Feature",
      properties: { point_count: c.count },
      geometry: { type: "Point", coordinates: [c.lon, c.lat] },
    }));
    const data: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };

    if (!map.getSource("clusters")) {
      map.addSource("clusters", { type: "geojson", data });
      map.addLayer({
        id: "clusters-layer",
        type: "circle",
        source: "clusters",
        layout: { visibility: "visible" },
        paint: {
          "circle-color": "#475569",
          "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 0, 10, 200, 26],
          "circle-stroke-color": "#f8fafc",
          "circle-stroke-width": 1.5,
        },
      });
      map.addLayer({
        id: "clusters-label",
        type: "symbol",
        source: "clusters",
        layout: {
          "text-field": ["get", "point_count"],
          "text-size": 11,
          "text-font": ["Noto Sans Regular"],
          visibility: "visible",
        },
        paint: { "text-color": "#ffffff" },
      });
    } else {
      (map.getSource("clusters") as maplibregl.GeoJSONSource).setData(data);
    }
  }, [positions, mapZoom, styleLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded) return;
    const removeNight = () => {
      if (map.getLayer("night-layer")) {
        map.removeLayer("night-layer");
        map.removeSource("night");
      }
    };
    if (!night || night.length < 3) {
      removeNight();
      return;
    }
    const feature: GeoJSON.Feature = {
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [night] },
    };
    if (!map.getSource("night")) {
      map.addSource("night", { type: "geojson", data: { type: "FeatureCollection", features: [feature] } });
      try {
        map.addLayer(
          {
            id: "night-layer",
            type: "fill",
            source: "night",
            paint: { "fill-color": "rgba(2, 6, 23, 0.35)", "fill-antialias": false },
          },
          "satellites-layer"
        );
      } catch (err) {
        console.error("night layer add failed", err);
      }
    } else {
      (map.getSource("night") as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features: [feature] });
    }
  }, [night, styleLoaded]);

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

  const handledFocusTsRef = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus || !styleLoaded) return;
    if (focus.ts === handledFocusTsRef.current) return;
    const target = positions.find((p) => p.catnr === focus.catnr);
    if (!target) return;
    handledFocusTsRef.current = focus.ts;
    map.flyTo({ center: [target.lon, target.lat], zoom: 6, essential: true });
  }, [focus, positions, styleLoaded]);

  return <div ref={containerRef} className="map" />;
}
