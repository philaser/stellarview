import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import Globe from "globe.gl";
import type { SatDot } from "./MapView";

const COUNTRIES_URL =
  "https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson";

// Cap visual altitude so GEO/MEO shells hug the globe instead of rendering as streaks from inside the camera.
const ALT_CAP = 0.35;
const altR = (altKm: number) => Math.min(altKm / 6371, ALT_CAP);

// Point sizes in globe-radius units (~1-3px dots at the default camera; highlight is 4x).
const BASE_SIZE = 0.012;
const HIGHLIGHT_SIZE = 0.05;

export interface GlobeViewProps {
  positions: SatDot[];
  selectedOrbit: [number, number][] | null;
  selectedCatnr: number | null;
  onSelect: (catnr: number) => void;
}

function buildGeometry(capacity: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
  const color = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
  position.setUsage(THREE.DynamicDrawUsage);
  color.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", position);
  geometry.setAttribute("color", color);
  return geometry;
}

function buildPoints(capacity: number, size: number): THREE.Points {
  return new THREE.Points(buildGeometry(capacity), new THREE.PointsMaterial({
    size,
    vertexColors: true,
    sizeAttenuation: true,
    transparent: true,
  }));
}

export default function GlobeView({ positions, selectedOrbit, selectedCatnr, onSelect }: GlobeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<InstanceType<typeof Globe> | null>(null);
  const baseRef = useRef<THREE.Points | null>(null);
  const highlightRef = useRef<THREE.Points | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const [hoveredCatnr, setHoveredCatnr] = useState<number | null>(null);

  useEffect(() => {
    const container = containerRef.current!;
    const globe = new Globe(container, { rendererConfig: { antialias: true } });
    // dev/verification handle for the visual-check harness
    (window as { __ftGlobe?: unknown }).__ftGlobe = globe;
    globe
      .backgroundColor("#050816")
      .showAtmosphere(true)
      .atmosphereColor("#3a4a6b")
      .showGraticules(false)
      .pointOfView({ lat: 20, lng: 0, altitude: 3.2 });

    globe
      .labelsData([])
      .labelLat((d) => (d as SatDot).lat)
      .labelLng((d) => (d as SatDot).lon)
      .labelText((d) => String((d as SatDot).catnr))
      .labelColor(() => "#ffffff")
      .labelSize(1.2)
      .labelAltitude((d) => altR((d as SatDot).altKm) + 0.03)
      .labelResolution(2);

    globe
      .pathsData([])
      .pathPoints((d) => (d as { pts: [number, number][] }).pts)
      .pathPointLat((p) => (p as [number, number])[1])
      .pathPointLng((p) => (p as [number, number])[0])
      .pathPointAlt(() => 0.07)
      .pathColor(() => "#a855f7")
      .pathStroke(0.04)
      .pathDashLength(0.15)
      .pathDashGap(0.06)
      .pathDashInitialGap(0.05);

    // All satellites render as one THREE.Points layer (single draw call) plus a 1-point highlight layer.
    const basePoints = buildPoints(positions.length, BASE_SIZE);
    const highlightPoints = buildPoints(1, HIGHLIGHT_SIZE);
    highlightPoints.visible = false;
    baseRef.current = basePoints;
    highlightRef.current = highlightPoints;
    globe.scene().add(basePoints, highlightPoints);

    // Picking: raycast against the base layer; the intersection index maps to the positions array.
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 2; // ~6px hit area so small dots are clickable
    const pick = (evt: PointerEvent): number | null => {
      const rect = container.getBoundingClientRect();
      const ndcX = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), globe.camera());
      const hits = raycaster.intersectObject(basePoints, false);
      return hits.length > 0 ? (hits[0].index ?? null) : null;
    };
    const onPointerMove = (evt: PointerEvent) => {
      const idx = pick(evt);
      const catnr = idx != null ? positionsRef.current[idx]?.catnr ?? null : null;
      setHoveredCatnr(catnr);
      container.style.cursor = catnr != null ? "pointer" : "";
    };
    const onClick = (evt: PointerEvent) => {
      const idx = pick(evt);
      if (idx != null) onSelectRef.current(positionsRef.current[idx].catnr);
    };
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("click", onClick);

    fetch(COUNTRIES_URL)
      .then((r) => r.json())
      .then((geo: { features: object[] }) => {
        globe
          .polygonsData(geo.features)
          .polygonCapColor(() => "rgba(30, 41, 59, 0.85)")
          .polygonSideColor(() => "rgba(56, 89, 138, 0.35)")
          .polygonStrokeColor(() => "rgba(96, 165, 250, 0.25)")
          .polygonAltitude(0.002);
      })
      .catch(() => {
        // countries layer is decorative; the globe still renders
      });

    globeRef.current = globe;

    return () => {
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("click", onClick);
      globe.scene().remove(basePoints, highlightPoints);
      basePoints.geometry.dispose();
      (basePoints.material as THREE.Material).dispose();
      highlightPoints.geometry.dispose();
      (highlightPoints.material as THREE.Material).dispose();
      globe._destructor?.();
      globeRef.current = null;
      baseRef.current = null;
      highlightRef.current = null;
    };
    // positions.length only seeds the initial buffer capacity; the update effect grows it as needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const globe = globeRef.current;
    const base = baseRef.current;
    const highlight = highlightRef.current;
    if (!globe || !base || !highlight) return;

    // Grow the buffer if the catalog shrank below its steady-state size on first mount.
    if (positions.length > base.geometry.attributes.position.count) {
      base.geometry.dispose();
      (base.material as THREE.Material).dispose();
      base.geometry = buildGeometry(positions.length);
      base.material = new THREE.PointsMaterial({
        size: BASE_SIZE,
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
      });
    }

    const posAttr = base.geometry.attributes.position as THREE.BufferAttribute;
    const colorAttr = base.geometry.attributes.color as THREE.BufferAttribute;
    const tmpColor = new THREE.Color();
    positions.forEach((p, i) => {
      const c = globe.getCoords(p.lat, p.lon, altR(p.altKm));
      posAttr.setXYZ(i, c.x, c.y, c.z);
      tmpColor.set(p.color ?? "#e5e7eb");
      colorAttr.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b);
    });
    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;

    // Highlight layer shows hovered or selected (hover wins), whichever applies.
    const shown = hoveredCatnr ?? selectedCatnr;
    const sat = shown != null ? positions.find((p) => p.catnr === shown) : undefined;
    if (sat) {
      const c = globe.getCoords(sat.lat, sat.lon, altR(sat.altKm));
      const hp = highlight.geometry.attributes.position as THREE.BufferAttribute;
      hp.setXYZ(0, c.x, c.y, c.z);
      hp.needsUpdate = true;
      highlight.visible = true;
    } else {
      highlight.visible = false;
    }

    globe.labelsData(positions.filter((p) => p.catnr === selectedCatnr));
  }, [positions, selectedCatnr, hoveredCatnr]);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    if (selectedOrbit && selectedOrbit.length >= 2) {
      globe.pathsData([{ pts: selectedOrbit }]);
    } else {
      globe.pathsData([]);
    }
  }, [selectedOrbit]);

  // Dash animation only runs while an orbit path is actually shown.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || !selectedOrbit || selectedOrbit.length < 2) return;
    let gap = 0;
    const interval = setInterval(() => {
      gap = (gap + 0.02) % 0.3;
      globe.pathDashInitialGap(gap);
    }, 80);
    return () => clearInterval(interval);
  }, [selectedOrbit]);

  return <div ref={containerRef} className="map" />;
}
