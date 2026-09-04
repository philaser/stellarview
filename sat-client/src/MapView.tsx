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
  night: [number, number][] | null;
  onStopFollow?: () => void;
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
  onStopFollow,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [styleLoaded, setStyleLoaded] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const stopFollowRef = useRef(onStopFollow);
  stopFollowRef.current = onStopFollow;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
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
      renderWorldCopies: false,
    });
    // dev/verification handle for the visual-check harness
    (window as { __ftMap?: MapLibreMap }).__ftMap = map;
    let loaded = false;
    const loadingTimeout = setTimeout(() => {
      if (!loaded) setMapError(true);
    }, 15_000);
    map.on("load", () => {
      loaded = true;
      clearTimeout(loadingTimeout);
      if (mapRef.current === map) {
        setStyleLoaded(true);
        setMapError(false);
      }
    });
    map.on("error", () => {
      if (!loaded) setMapError(true);
    });
    map.on("dragstart", () => stopFollowRef.current?.());
    map.on("click", (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: ["satellites-layer"],
      });
      if (features.length === 0) {
        onSetObserverRef.current(e.lngLat.lat, e.lngLat.lng);
        return;
      }
      const props = features[0].properties ?? {};
      onSelectRef.current((props.catnr as number) ?? -1);
    });
    let hoveredId: number | null = null;
    const clearHover = () => {
      if (hoveredId !== null) {
        map.setFeatureState({ source: "satellites", id: hoveredId }, { hover: false });
        hoveredId = null;
      }
    };
    map.on("mousemove", (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ["satellites-layer"] });
      const hit = features.length > 0 ? ((features[0].properties?.catnr as number) ?? null) : null;
      if (hit === hoveredId) return;
      clearHover();
      if (hit !== null) {
        map.setFeatureState({ source: "satellites", id: hit }, { hover: true });
        hoveredId = hit;
        map.getCanvas().style.cursor = "pointer";
      } else {
        map.getCanvas().style.cursor = "";
      }
    });
    map.on("mouseleave", () => {
      clearHover();
      map.getCanvas().style.cursor = "";
    });
    map.on("move", () => {
      if (mapRef.current !== map) return;
      const b = map.getBounds();
      setMapBounds({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
    });
    mapRef.current = map;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => map.resize());
    observer?.observe(containerRef.current!);
    return () => {
      clearTimeout(loadingTimeout);
      observer?.disconnect();
      map.remove();
    };
  }, [attempt]);

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
        id: p.catnr,
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
        paint: {
          "circle-radius": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            6,
            ["get", "selected"],
            5,
            2,
          ],
          "circle-color": ["get", "color"],
          "circle-stroke-color": ["case", ["get", "selected"], "#ffffff", "#153445"],
          "circle-stroke-width": ["case", ["get", "selected"], 2, 1],
        },
      });
    } else {
      (map.getSource("satellites") as maplibregl.GeoJSONSource).setData(satData);
    }
  }, [positions, styleLoaded, mapBounds]);

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
      properties: { color: "#783ec0" },
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
        paint: {
          "line-color": "#783ec0",
          "line-width": 2.5,
          "line-opacity": 0.9,
          "line-dasharray": [3, 2],
        },
      });
    } else {
      (map.getSource("orbits") as maplibregl.GeoJSONSource).setData(orbitData);
    }
  }, [orbits, styleLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded || Object.keys(orbits).length === 0 || reducedMotion) return;
    let phase = 0;
    let rafId = 0;
    const tick = () => {
      phase = (phase + 1) % 10;
      try {
        map.setPaintProperty("orbits-layer", "line-dasharray", [3, 2, phase, 2]);
      } catch {
        // layer not ready; retry next frame
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [orbits, styleLoaded, reducedMotion]);

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
    map.easeTo({ center: [target.lon, target.lat], duration: reducedMotion ? 0 : 500 });
  }, [positions, followCatnr, styleLoaded]);

  const handledFocusTsRef = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus || !styleLoaded) return;
    if (focus.ts === handledFocusTsRef.current) return;
    const target = positions.find((p) => p.catnr === focus.catnr);
    if (!target) return;
    handledFocusTsRef.current = focus.ts;
    map.flyTo({ center: [target.lon, target.lat], zoom: 6, duration: reducedMotion ? 0 : 700 });
  }, [focus, positions, styleLoaded]);

  return <>
    <div ref={containerRef} className="map" />
    {!styleLoaded && <div className="map-loading" role={mapError ? "alert" : "status"}>
      <div>
        <p>{mapError ? "Map tiles could not load. You can retry or switch to the globe." : "Loading map…"}</p>
        {mapError && <button type="button" onClick={() => {
          setMapError(false);
          setStyleLoaded(false);
          setMapBounds(null);
          handledFocusTsRef.current = 0;
          setAttempt((value) => value + 1);
        }}>Retry map</button>}
      </div>
    </div>}
  </>;
}
