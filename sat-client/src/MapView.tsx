import { useEffect, useRef, useState } from "react";
import maplibregl, { Map as MapLibreMap, type ExpressionSpecification } from "maplibre-gl";
import { IconPlus, IconMinus, IconWorld } from "@tabler/icons-react";
import { MapMotion } from "./mapMotion";
import { createMapStyle } from "./mapStyle";

const markerOpacity = (opacity: number): ExpressionSpecification =>
  ["case", ["get", "selected"], 1, ["boolean", ["feature-state", "hover"], false], 1, opacity];
const markerRadius = (radius: number): ExpressionSpecification =>
  ["case", ["boolean", ["feature-state", "hover"], false], 6, ["get", "selected"], 5, radius];

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
  satNames?: Record<number, string>;
  locked?: boolean;
  orbits: Record<number, [number, number][]>;
  observer: { lat: number; lon: number } | null;
  onSelect: (catnr: number) => void;
  placingObserver?: boolean;
  onSetObserver: (lat: number, lon: number) => void;
  followCatnr: number | null;
  focus?: { catnr: number; ts: number } | null;
  night: [number, number][] | null;
  onStopFollow?: () => void;
}

export default function MapView({
  positions,
  satNames = {},
  locked = false,
  orbits,
  observer,
  onSelect,
  onSetObserver,
  placingObserver = false,
  followCatnr,
  focus,
  night,
  onStopFollow,
}: MapViewProps) {
  const [hover, setHover] = useState<{ catnr: number; x: number; y: number } | null>(null);
  const [label, setLabel] = useState<{ catnr: number; x: number; y: number } | null>(null);
  const motionRef = useRef(new MapMotion());
  const followCenterRef = useRef<string | null>(null);
  const followRef = useRef(followCatnr);
  followRef.current = followCatnr;
  const clearHoverRef = useRef<() => void>(() => {});
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyMapRef = useRef<MapLibreMap | null>(null);
  const [styleLoaded, setStyleLoaded] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const stopFollowRef = useRef(onStopFollow);
  stopFollowRef.current = onStopFollow;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const [mapBounds, setMapBounds] = useState<{ west: number; south: number; east: number; north: number } | null>(null);
  const boundsRef = useRef(mapBounds);
  boundsRef.current = mapBounds;
  const placingObserverRef = useRef(placingObserver);
  placingObserverRef.current = placingObserver;
  const onSelectRef = useRef(onSelect);
  const onSetObserverRef = useRef(onSetObserver);
  onSelectRef.current = onSelect;
  onSetObserverRef.current = onSetObserver;

  useEffect(() => {
    readyMapRef.current = null;
    setStyleLoaded(false);
    setMapBounds(null);
    const map = new MapLibreMap({
      container: containerRef.current!,
      style: createMapStyle(),
      center: [0, 20],
      zoom: 1.5,
      minZoom: 1,
      maxZoom: 16,
      dragRotate: false,
      pitchWithRotate: false,
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
        readyMapRef.current = map;
        setStyleLoaded(true);
        setMapError(false);
      }
    });
    map.on("error", () => {
      if (!loaded) setMapError(true);
    });
    map.on("dragstart", () => { setHover(null); stopFollowRef.current?.(); });
    const pick = (point: { x: number; y: number } | undefined, radius: number) => {
      if (!point || !map.getLayer("satellites-layer")) return undefined;
      const features = map.queryRenderedFeatures(
        [[point.x - radius, point.y - radius], [point.x + radius, point.y + radius]],
        { layers: ["satellites-layer"] },
      );
      return features.sort((a, b) => {
        const distance = (feature: typeof a) => {
          if (feature.geometry.type !== "Point") return Infinity;
          const p = map.project(feature.geometry.coordinates as [number, number]);
          return (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
        };
        return distance(a) - distance(b);
      })[0];
    };
    map.on("click", (e) => {
      if (lockedRef.current || !loaded) return;
      if (placingObserverRef.current) {
        onSetObserverRef.current(e.lngLat.lat, e.lngLat.lng);
        return;
      }
      const feature = pick(e.point, 12);
      if (feature) onSelectRef.current(Number(feature.properties.catnr));

    });
    let hoveredId: number | null = null;
    const clearHover = () => {
      if (hoveredId !== null) {
        map.setFeatureState({ source: "satellites", id: hoveredId }, { hover: false });
        hoveredId = null;
      }
    };
    clearHoverRef.current = () => {
      clearHover();
      setHover(null);
      map.getCanvas().style.cursor = "";
    };
    map.on("mousemove", (e) => {
      if (lockedRef.current || !loaded) return;
      const feature = pick(e.point, 8);
      const hit = feature ? Number(feature.properties.catnr) : null;
      setHover(hit === null ? null : { catnr: hit, x: e.point.x, y: e.point.y });
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
      setHover(null);
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
      clearHoverRef.current = () => {};
      readyMapRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, [attempt]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded || readyMapRef.current !== map) return;

    motionRef.current.update(positions, performance.now(), reducedMotion);
    const dataAt = (now: number): GeoJSON.FeatureCollection => {
      const mapBounds = boundsRef.current;
      const displayed = motionRef.current.sample(now);
      const selected = displayed.find((p) => p.selected);
      if (selected) {
        const point = map.project([selected.lon, selected.lat]);
        const container = containerRef.current!;
        setLabel(point.x < 0 || point.y < 0 || point.x > container.clientWidth || point.y > container.clientHeight
          ? null : { catnr: selected.catnr, x: point.x, y: point.y });
      } else setLabel(null);
      const followed = displayed.find((p) => p.catnr === followRef.current);
      const followCenter = followed ? `${followed.catnr}:${followed.lon}:${followed.lat}` : null;
      if (followed && followCenter !== followCenterRef.current) {
        map.easeTo({ center: [followed.lon, followed.lat], duration: 0 });
      }
      followCenterRef.current = followCenter;
      return { type: "FeatureCollection", features: displayed
        .filter((p) => !mapBounds || (p.lon >= mapBounds.west - 2 && p.lon <= mapBounds.east + 2
          && p.lat >= mapBounds.south - 2 && p.lat <= mapBounds.north + 2))
        .map((p) => ({ type: "Feature", id: p.catnr, properties: { catnr: p.catnr, color: p.color, selected: p.selected ?? false },
          geometry: { type: "Point", coordinates: [p.lon, p.lat] } })) };
    };
    const satData = dataAt(performance.now());

    if (!map.getSource("satellites")) {
      map.addSource("satellites", { type: "geojson", data: satData });
      map.addLayer({
        id: "satellites-selection",
        type: "circle",
        source: "satellites",
        filter: ["==", ["get", "selected"], true],
        paint: { "circle-radius": 12, "circle-color": "#22ff88", "circle-opacity": 0.12,
          "circle-stroke-color": "#22ff88", "circle-stroke-width": 1, "circle-stroke-opacity": 0.7 },
      });
      map.addLayer({
        id: "satellites-layer",
        type: "circle",
        source: "satellites",
        layout: { "circle-sort-key": ["case", ["get", "selected"], 1, 0] },
        paint: {
          "circle-opacity": ["interpolate", ["linear"], ["zoom"],
            1, markerOpacity(0.45), 3, markerOpacity(0.55), 6, markerOpacity(0.7)],
          "circle-radius": ["interpolate", ["linear"], ["zoom"],
            1, markerRadius(1.5), 3, markerRadius(1.8), 6, markerRadius(2.4)],
          "circle-color": ["case", ["get", "selected"], "#22ff88", ["coalesce", ["get", "color"], "#67d9ec"]],
          "circle-stroke-color": ["case", ["get", "selected"], "#d6ffeb", "#071521"],
          "circle-stroke-width": ["case", ["get", "selected"], 1.5, 0],
        },
      });
    } else {
      (map.getSource("satellites") as maplibregl.GeoJSONSource).setData(satData);
    }
    let frameId = 0;
    let lastFrame = performance.now();
    let moving = motionRef.current.moving(lastFrame);
    let lastBounds = boundsRef.current;
    const frame = (now: number) => {
      frameId = requestAnimationFrame(frame);
      if (!moving && lastBounds === boundsRef.current) return;
      const source = map.getSource("satellites") as maplibregl.GeoJSONSource | undefined;
      // Avoid queuing GeoJSON worker jobs faster than the renderer can consume them.
      if (now - lastFrame < 1000 / 30 || !source || (source.loaded && !source.loaded())) return;
      lastFrame = now;
      source.setData(dataAt(now));
      moving = motionRef.current.moving(now);
      lastBounds = boundsRef.current;
    };
    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, [positions, styleLoaded, reducedMotion, followCatnr]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded || readyMapRef.current !== map) return;

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
            paint: { "fill-color": "rgba(2, 6, 23, 0.45)", "fill-antialias": true },
          },
          map.getLayer("orbits-glow") ? "orbits-glow" : "satellites-selection"
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
    if (!map || !styleLoaded || readyMapRef.current !== map) return;

    const orbitFeatures: GeoJSON.Feature[] = Object.entries(orbits).map(([catnr, coords]) => ({
      type: "Feature",
      properties: { color: "#b87aff" },
      geometry: { type: "LineString", coordinates: coords },
    }));
    const orbitData: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: orbitFeatures };

    if (!map.getSource("orbits")) {
      map.addSource("orbits", { type: "geojson", data: orbitData });
      map.addLayer({
        id: "orbits-glow", type: "line", source: "orbits",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#a855f7", "line-width": 7, "line-opacity": 0.14, "line-blur": 3 },
      }, "satellites-selection");
      map.addLayer({
        id: "orbits-layer",
        type: "line",
        source: "orbits",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#b87aff",
          "line-width": 2,
          "line-opacity": 0.95,
        },
      }, "satellites-selection");
    } else {
      (map.getSource("orbits") as maplibregl.GeoJSONSource).setData(orbitData);
    }
  }, [orbits, styleLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded || readyMapRef.current !== map) return;
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

  const handledFocusTsRef = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus || !styleLoaded || readyMapRef.current !== map) return;
    if (focus.ts === handledFocusTsRef.current) return;
    const target = positions.find((p) => p.catnr === focus.catnr);
    if (!target) return;
    handledFocusTsRef.current = focus.ts;
    map.flyTo({ center: [target.lon, target.lat], zoom: 6, duration: reducedMotion ? 0 : 700 });
  }, [focus, positions, styleLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const handler of [map.dragPan, map.scrollZoom, map.boxZoom, map.doubleClickZoom, map.keyboard, map.touchZoomRotate]) {
      if (locked) handler.disable(); else handler.enable();
    }
    map.touchZoomRotate.disableRotation();
    if (locked) clearHoverRef.current();
  }, [locked, attempt]);

  return <>
    <div ref={containerRef} className="map atlas-map" />
    {styleLoaded && <nav className="atlas-navigation" aria-label="Map navigation">
      <button type="button" aria-label="Zoom in" title="Zoom in" disabled={locked} onClick={() => mapRef.current?.zoomIn()}><IconPlus size={18} /></button>
      <button type="button" aria-label="Zoom out" title="Zoom out" disabled={locked} onClick={() => mapRef.current?.zoomOut()}><IconMinus size={18} /></button>
      <button type="button" aria-label="Show world" title="Show world" disabled={locked} onClick={() => { stopFollowRef.current?.(); mapRef.current?.easeTo({ center: [0, 20], zoom: 1.5, duration: reducedMotion ? 0 : 700 }); }}><IconWorld size={18} /></button>
    </nav>}
    {label && <div className="atlas-selected-label" style={{ left: label.x, top: Math.max(24, Math.min(label.y, (containerRef.current?.clientHeight ?? 48) - 24)), transform: label.x > (containerRef.current?.clientWidth ?? 0) - 240 ? "translate(calc(-100% - 16px), -50%)" : undefined }}>{satNames[label.catnr] ?? `NORAD ${label.catnr}`}</div>}
    {hover && <div className="atlas-tooltip" style={{ left: Math.max(8, Math.min(hover.x + 14, (containerRef.current?.clientWidth ?? 300) - 230)), top: Math.max(8, hover.y - 42) }}>
      {satNames[hover.catnr] ?? "Satellite"} · NORAD {hover.catnr}
    </div>}
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
