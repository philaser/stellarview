import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import Globe from "globe.gl";
import type { SatDot } from "./MapView";

const COUNTRIES_URL =
  "https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson";

// Cap visual altitude so GEO/MEO shells hug the globe instead of rendering as streaks from inside the camera.
const ALT_CAP = 0.35;
const altR = (altKm: number) => Math.min(altKm / 6371, ALT_CAP);

// Point sizes in globe-radius units; dots gently grow as the camera zooms in (~2-5px dots at the
// default camera, up to a visible 9% of the globe radius). Highlight stays 4x the base size.
const BASE_SIZE = 0.02;
const HIGHLIGHT_FACTOR = 4;
const MIN_DOT_SIZE = 0.01;
const MAX_DOT_SIZE = 0.09;
const SIZE_CURVE = 0.35;

/** Dot size (globe-radius units) for a camera at `distance` from a reference distance `refDist`. */
export function dotSizeFor(distance: number, refDist: number, base: number): number {
  const scaled = base * Math.pow(refDist / distance, SIZE_CURVE);
  return Math.min(MAX_DOT_SIZE, Math.max(MIN_DOT_SIZE, scaled));
}

// Screen-space picking radii (px) around the cursor; the nearest projected dot wins.
const HOVER_THRESHOLD = 8;
const CLICK_THRESHOLD = 12;
const TOOLTIP_OFFSET = 14;

export interface GlobeViewProps {
  positions: SatDot[];
  satNames: Record<number, string>;
  selectedOrbit: [number, number][] | null;
  selectedCatnr: number | null;
  onSelect: (catnr: number) => void;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

interface ScreenDot extends ScreenPoint {
  catnr: number;
}

/** Index of the projected point nearest (within `threshold` px) to (px, py), or -1 when none qualifies. */
export function findNearest(projected: ScreenPoint[], px: number, py: number, threshold: number): number {
  let best = -1;
  let bestD2 = threshold * threshold;
  for (let i = 0; i < projected.length; i++) {
    const dx = projected[i].x - px;
    const dy = projected[i].y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
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

export default function GlobeView({ positions, satNames, selectedOrbit, selectedCatnr, onSelect }: GlobeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<InstanceType<typeof Globe> | null>(null);
  const baseRef = useRef<THREE.Points | null>(null);
  const highlightRef = useRef<THREE.Points | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const satNamesRef = useRef(satNames);
  satNamesRef.current = satNames;
  const worldCoordsRef = useRef<Float32Array>(new Float32Array(0));
  const dotSizeRef = useRef(BASE_SIZE);
  const [hoveredCatnr, setHoveredCatnr] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

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
      .pathColor(() => "#c77dff")
      .pathStroke(0.1)
      .pathDashLength(0.25)
      .pathDashGap(0.08)
      .pathDashInitialGap(0.05);

    // All satellites render as one THREE.Points layer (single draw call) plus a 1-point highlight layer.
    const basePoints = buildPoints(positions.length, BASE_SIZE);
    const highlightPoints = buildPoints(1, BASE_SIZE * HIGHLIGHT_FACTOR);
    highlightPoints.visible = false;
    baseRef.current = basePoints;
    highlightRef.current = highlightPoints;
    globe.scene().add(basePoints, highlightPoints);

    // Recompute dot sizes when the OrbitControls camera moves: base size grows gently as the
    // camera zooms in so dots stay readable, clamped to a sane floor/ceiling.
    const controls = globe.controls();
    const refDist = globe.camera().position.distanceTo(controls.target);
    const applySize = () => {
      const dist = globe.camera().position.distanceTo(controls.target);
      const size = dotSizeFor(dist, refDist, BASE_SIZE);
      dotSizeRef.current = size;
      (basePoints.material as THREE.PointsMaterial).size = size;
      (highlightPoints.material as THREE.PointsMaterial).size = size * HIGHLIGHT_FACTOR;
    };
    applySize();
    controls.addEventListener("change", applySize);

    // Picking: project every satellite's world coords to the container and take the nearest within a radius.
    const tmpVec = new THREE.Vector3();
    const projectToScreen = (rect: DOMRect): ScreenDot[] => {
      const wc = worldCoordsRef.current;
      const n = wc.length / 3;
      const dots: ScreenDot[] = new Array(n);
      for (let i = 0; i < n; i++) {
        tmpVec.set(wc[i * 3], wc[i * 3 + 1], wc[i * 3 + 2]).project(globe.camera());
        if (tmpVec.z > 1) {
          // behind the camera — never a hit
          dots[i] = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, catnr: -1 };
          continue;
        }
        dots[i] = {
          x: (tmpVec.x * 0.5 + 0.5) * rect.width,
          y: (-tmpVec.y * 0.5 + 0.5) * rect.height,
          catnr: positionsRef.current[i]?.catnr ?? -1,
        };
      }
      return dots;
    };
    // dev/verification handle: projected screen dots for the visual-check harness
    (window as { __ftGlobeDots?: () => ScreenDot[] }).__ftGlobeDots = () =>
      projectToScreen(container.getBoundingClientRect()).filter((d) => d.catnr >= 0);

    const pick = (evt: PointerEvent, threshold: number): { idx: number; px: number; py: number } | null => {
      const rect = container.getBoundingClientRect();
      const px = evt.clientX - rect.left;
      const py = evt.clientY - rect.top;
      const idx = findNearest(projectToScreen(rect), px, py, threshold);
      return idx >= 0 ? { idx, px, py } : null;
    };
    const onPointerMove = (evt: PointerEvent) => {
      const hit = pick(evt, HOVER_THRESHOLD);
      if (!hit) {
        setHoveredCatnr(null);
        setTooltip(null);
        container.style.cursor = "";
        return;
      }
      const catnr = positionsRef.current[hit.idx]?.catnr ?? null;
      if (catnr == null) {
        setHoveredCatnr(null);
        setTooltip(null);
        container.style.cursor = "";
        return;
      }
      setHoveredCatnr(catnr);
      setTooltip({
        x: hit.px + TOOLTIP_OFFSET,
        y: hit.py + TOOLTIP_OFFSET,
        text: `${satNamesRef.current[catnr] ?? "Unknown"} · ${catnr}`,
      });
      container.style.cursor = "pointer";
    };
    const onClick = (evt: PointerEvent) => {
      const hit = pick(evt, CLICK_THRESHOLD);
      if (!hit) return;
      const sat = positionsRef.current[hit.idx];
      if (sat) onSelectRef.current(sat.catnr);
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
      controls.removeEventListener("change", applySize);
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
        size: dotSizeRef.current,
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
      });
    }

    const posAttr = base.geometry.attributes.position as THREE.BufferAttribute;
    const colorAttr = base.geometry.attributes.color as THREE.BufferAttribute;
    const tmpColor = new THREE.Color();
    // Cache world coords so pointer events can project to screen without re-reading the GPU buffer.
    const world = new Float32Array(positions.length * 3);
    positions.forEach((p, i) => {
      const c = globe.getCoords(p.lat, p.lon, altR(p.altKm));
      posAttr.setXYZ(i, c.x, c.y, c.z);
      world[i * 3] = c.x;
      world[i * 3 + 1] = c.y;
      world[i * 3 + 2] = c.z;
      tmpColor.set(p.color ?? "#e5e7eb");
      colorAttr.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b);
    });
    worldCoordsRef.current = world;
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

  return (
    // globe.gl wipes the container's children on init, so the tooltip lives as a sibling of the container.
    <div className="map-globe">
      <div ref={containerRef} className="map" />
      <div
        className={tooltip ? "globe-tooltip visible" : "globe-tooltip"}
        style={tooltip ? { left: tooltip.x, top: tooltip.y } : undefined}
      >
        {tooltip?.text}
      </div>
    </div>
  );
}
