import { useEffect, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IconPlane } from "@tabler/icons-react";
import maplibregl, { Map as MapLibreMap } from "maplibre-gl";
import type { FlightState, FlightTrack } from "../../server/src/types";

export const ALTITUDE_COLORS = { low: "#22c55e", mid: "#f59e0b", high: "#ef4444" } as const;
const AIRCRAFT_IMAGES = { low: "aircraft-low", mid: "aircraft-mid", high: "aircraft-high" } as const;

export function altitudeColor(altBaro: number | null): string {
  if (altBaro === null || altBaro < 3000) return ALTITUDE_COLORS.low;
  if (altBaro < 7000) return ALTITUDE_COLORS.mid;
  return ALTITUDE_COLORS.high;
}

interface MapViewProps {
  bounds: [number, number, number, number];
  flights: FlightState[];
  selectedIcao?: string | null;
  track: FlightTrack | null;
  onSelect: (flight: FlightState | null) => void;
}

function aircraftImage(color: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(32, 32);
    image.onload = () => resolve(image);
    image.onerror = reject;
    const svg = renderToStaticMarkup(<IconPlane size={28} stroke={2.4} color={color} />);
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

export default function MapView({ bounds, flights, selectedIcao = null, track, onSelect }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onSelectRef = useRef(onSelect);
  const focusedSelectionRef = useRef<string | null>(null);
  onSelectRef.current = onSelect;
  const [styleLoaded, setStyleLoaded] = useState(false);
  const [iconReady, setIconReady] = useState(false);

  useEffect(() => {
    const map = new MapLibreMap({
      container: containerRef.current!,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
      zoom: 4,
    });
    map.on("click", (event) => {
      const layers = ["flights-layer", "selected-flight"].filter((id) => map.getLayer(id));
      const features = map.queryRenderedFeatures(event.point, { layers });
      if (features.length > 0) onSelectRef.current(features[0].properties as FlightState);
    });
    map.on("load", () => {
      if (mapRef.current !== map) return;
      setStyleLoaded(true);
      void Promise.all(Object.entries(AIRCRAFT_IMAGES).map(async ([band, imageName]) => ({ imageName, image: await aircraftImage(ALTITUDE_COLORS[band as keyof typeof ALTITUDE_COLORS]) }))).then((images) => {
        if (mapRef.current === map) {
          for (const { imageName, image } of images) if (!map.hasImage(imageName)) map.addImage(imageName, image, { pixelRatio: 2 });
          setIconReady(true);
        }
      }).catch(() => setIconReady(false));
    });
    mapRef.current = map;
    return () => map.remove();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 48, duration: 700 });
  }, [bounds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded) return;
    const positioned = flights.filter((flight): flight is FlightState & { lat: number; lon: number } => flight.lat !== null && flight.lon !== null);
    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: positioned.map((flight) => ({ type: "Feature", properties: { ...flight }, geometry: { type: "Point", coordinates: [flight.lon, flight.lat] } })),
    };
    const source = map.getSource("flights") as maplibregl.GeoJSONSource | undefined;
    if (!source) map.addSource("flights", { type: "geojson", data });
    else source.setData(data);

    const useAircraftIcons = iconReady && Object.values(AIRCRAFT_IMAGES).every((image) => map.hasImage(image));
    const existingLayer = map.getLayer("flights-layer");
    if (existingLayer && existingLayer.type !== (useAircraftIcons ? "symbol" : "circle")) map.removeLayer("flights-layer");
    if (!map.getLayer("flights-layer") && useAircraftIcons) {
      map.addLayer({
        id: "flights-layer", type: "symbol", source: "flights",
        layout: { "icon-image": ["case", ["<", ["coalesce", ["get", "altitudeBaro"], 0], 3000], AIRCRAFT_IMAGES.low, ["<", ["coalesce", ["get", "altitudeBaro"], 0], 7000], AIRCRAFT_IMAGES.mid, AIRCRAFT_IMAGES.high], "icon-size": ["interpolate", ["linear"], ["zoom"], 2, 0.45, 6, 0.85, 10, 1], "icon-rotate": ["-", ["coalesce", ["get", "heading"], 0], 90], "icon-rotation-alignment": "map", "icon-allow-overlap": true },
      });
    } else if (!map.getLayer("flights-layer")) {
      map.addLayer({
        id: "flights-layer", type: "circle", source: "flights",
        paint: { "circle-radius": 5, "circle-color": ["interpolate", ["linear"], ["coalesce", ["get", "altitudeBaro"], 0], 0, ALTITUDE_COLORS.low, 3000, ALTITUDE_COLORS.low, 3001, ALTITUDE_COLORS.mid, 7000, ALTITUDE_COLORS.mid, 7001, ALTITUDE_COLORS.high] },
      });
    }
  }, [flights, styleLoaded, iconReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded) return;
    const selected = flights.find((flight) => flight.icao24 === selectedIcao && flight.lat !== null && flight.lon !== null);
    const data: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: selected ? [{ type: "Feature", properties: { ...selected }, geometry: { type: "Point", coordinates: [selected.lon!, selected.lat!] } }] : [] };
    const source = map.getSource("selected-aircraft") as maplibregl.GeoJSONSource | undefined;
    if (!source) map.addSource("selected-aircraft", { type: "geojson", data });
    else source.setData(data);
    if (!map.getLayer("selected-flight")) map.addLayer({ id: "selected-flight", type: "circle", source: "selected-aircraft", paint: { "circle-radius": 11, "circle-color": "#ffffff", "circle-opacity": 0.2, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
  }, [flights, selectedIcao, styleLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    const selected = flights.find((flight) => flight.icao24 === selectedIcao && flight.lat !== null && flight.lon !== null);
    if (!selected) {
      if (!selectedIcao) focusedSelectionRef.current = null;
      return;
    }
    if (focusedSelectionRef.current !== selected.icao24) {
      focusedSelectionRef.current = selected.icao24;
      map?.flyTo({ center: [selected.lon!, selected.lat!], zoom: Math.max(map.getZoom(), 6), duration: 500 });
    }
  }, [flights, selectedIcao]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded) return;
    const removeTrack = () => {
      if (map.getLayer("track-line")) map.removeLayer("track-line");
      if (map.getSource("track-source")) map.removeSource("track-source");
    };
    if (!track || track.points.length < 2) {
      removeTrack();
      return;
    }
    const data: GeoJSON.Feature = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: track.points.map((point) => [point.lon, point.lat]) } };
    const source = map.getSource("track-source") as maplibregl.GeoJSONSource | undefined;
    if (!source) {
      map.addSource("track-source", { type: "geojson", data });
      map.addLayer({ id: "track-line", type: "line", source: "track-source", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#38bdf8", "line-width": 2, "line-dasharray": [2, 1] } }, "flights-layer");
    } else source.setData(data);
  }, [track, styleLoaded]);

  return <div ref={containerRef} className="map" />;
}
