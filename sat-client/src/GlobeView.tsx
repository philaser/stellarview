import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import Globe from "globe.gl";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { SatDot } from "./MapView";

const COUNTRIES_URL =
  "https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson";

// Cap visual altitude so GEO/MEO shells hug the globe instead of rendering as streaks from inside the camera.
const ALT_CAP = 0.35;
const altR = (altKm: number) => Math.min(altKm / 6371, ALT_CAP);

// Point sizes in globe-radius units; dots gently grow as the camera zooms in (~2-5px dots at the
// default camera, up to a visible 9% of the globe radius). Highlight stays 5x the base size and
// the glow halo ~4.5x so the selection reads distinctly from the trajectory head.
const BASE_SIZE = 0.02;
const HIGHLIGHT_FACTOR = 5;
const MIN_DOT_SIZE = 0.01;
const MAX_DOT_SIZE = 0.09;
const SIZE_CURVE = 0.35;

// Trajectory: a fat Line2 circling the globe just above the surface. A per-vertex color gradient
// (sharp white-hot head fading to a dim green tail) loops around the ring every frame to show
// direction of travel; Line2 renders with depth testing so the far side is occluded by the globe.
const ORBIT_ALTITUDE = 0.07;
const ORBIT_LINE_WIDTH = 5;
const ORBIT_PHASE_STEP = 0.02;

// Selected-satellite highlight: pulsing green dot (#22ff88) plus a soft radial-gradient halo sprite
// that breathes with the same ~3.8s phase so the selection reads as a strong pulsing blob.
const HIGHLIGHT_RGB: [number, number, number] = [0.13, 1, 0.53];
const GLOW_FACTOR = 4.5;
const GLOW_TEX_SIZE = 128;
const PULSE_AMPLITUDE = 0.55;
const PULSE_PERIOD_MS = 600; // ~3.8s pulse
const GLOW_PULSE_MEAN = 1.2;
const GLOW_PULSE_AMPLITUDE = 0.5;

/** Dot size (globe-radius units) for a camera at `distance` from a reference distance `refDist`. */
export function dotSizeFor(distance: number, refDist: number, base: number): number {
  const scaled = base * Math.pow(refDist / distance, SIZE_CURVE);
  return Math.min(MAX_DOT_SIZE, Math.max(MIN_DOT_SIZE, scaled));
}

/** Linear interpolation between two per-satellite world-coord snapshots, written into `out` (reused across frames). */
export function lerpWorldPositions(
  prev: Float32Array,
  current: Float32Array,
  t: number,
  out: Float32Array
): Float32Array {
  for (let i = 0; i < out.length; i++) out[i] = prev[i] + (current[i] - prev[i]) * t;
  return out;
}

/**
 * Per-vertex RGB colors for the orbit ring: a sharp white-hot gaussian head that fades to a dim
 * green tail, looping around the ring. `phase` (fraction of the ring, mod 1) drives the head
 * position, so advancing it each frame makes the gradient loop around the orbit and read as a
 * direction arrow.
 */
export function orbitGradientColors(vertexCount: number, phase: number): Float32Array {
  const colors = new Float32Array(vertexCount * 3);
  const SIGMA = 0.09; // head width as a fraction of the ring
  const HEAD: [number, number, number] = [255, 255, 255];      // white-hot head
  const TAIL: [number, number, number] = [46, 232, 138];       // green base (#2ee88a)
  const TAIL_BRIGHTNESS = 0.35;                                 // tail clearly dimmer
  for (let i = 0; i < vertexCount; i++) {
    let d = (i / vertexCount - phase) % 1;
    if (d < 0) d += 1;
    if (d > 0.5) d = 1 - d; // shortest distance around the ring
    const w = Math.exp(-(d * d) / (2 * SIGMA * SIGMA));
    colors[i * 3] = (TAIL[0] * TAIL_BRIGHTNESS + (HEAD[0] - TAIL[0] * TAIL_BRIGHTNESS) * w) / 255;
    colors[i * 3 + 1] = (TAIL[1] * TAIL_BRIGHTNESS + (HEAD[1] - TAIL[1] * TAIL_BRIGHTNESS) * w) / 255;
    colors[i * 3 + 2] = (TAIL[2] * TAIL_BRIGHTNESS + (HEAD[2] - TAIL[2] * TAIL_BRIGHTNESS) * w) / 255;
  }
  return colors;
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
  const orbitLineRef = useRef<Line2 | null>(null);
  const glowSpriteRef = useRef<THREE.Sprite | null>(null);
  const orbitPointCountRef = useRef(0);
  const orbitPhaseRef = useRef(0);
  const highlightBaseRef = useRef(BASE_SIZE * HIGHLIGHT_FACTOR);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const satNamesRef = useRef(satNames);
  satNamesRef.current = satNames;
  const worldCoordsRef = useRef<Float32Array>(new Float32Array(0));
  const dotSizeRef = useRef(BASE_SIZE);
  // Interpolation state between the last two 2s position snapshots: `worldPrevRef` holds the previous
  // snapshot's world coords, `worldCurRef` the current one; the rAF loop lerps them into a single
  // reused output buffer (no allocation per frame). lat/lng snapshots feed the label glide.
  const worldPrevRef = useRef<Float32Array>(new Float32Array(0));
  const worldCurRef = useRef<Float32Array>(new Float32Array(0));
  const lerpOutRef = useRef<Float32Array>(new Float32Array(0));
  const latLngPrevRef = useRef<Float32Array>(new Float32Array(0));
  const latLngCurRef = useRef<Float32Array>(new Float32Array(0));
  const tickAtRef = useRef(0);
  const hasSnapshotRef = useRef(false);
  const labelIdxRef = useRef(-1);
  const highlightIdxRef = useRef(-1);
  // Single mutable label entry: position ticks mutate it in place so three-globe re-reads the
  // accessors next frame instead of re-creating the label layer (which would flicker every tick).
  const labelEntryRef = useRef<{ lat: number; lng: number; catnr: number; altKm: number } | null>(null);
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
      .labelText((d) => satNamesRef.current[(d as { catnr: number }).catnr] ?? String((d as { catnr: number }).catnr))
      .labelColor(() => "#ffffff")
      .labelSize(1.4)
      .labelAltitude((d) => altR((d as SatDot).altKm) + 0.03)
      .labelResolution(2);

    // All satellites render as one THREE.Points layer (single draw call) plus a 1-point highlight layer.
    const basePoints = buildPoints(positions.length, BASE_SIZE);
    const highlightPoints = buildPoints(1, BASE_SIZE * HIGHLIGHT_FACTOR);
    highlightPoints.visible = false;
    const hc = highlightPoints.geometry.attributes.color as THREE.BufferAttribute;
    hc.setXYZ(0, HIGHLIGHT_RGB[0], HIGHLIGHT_RGB[1], HIGHLIGHT_RGB[2]);
    hc.needsUpdate = true;
    baseRef.current = basePoints;
    highlightRef.current = highlightPoints;

    // Trajectory: a fat gradient line looping the globe. Positions are written when an orbit is
    // selected; the rAF loop advances the color peak so the gradient flows along the orbit.
    const orbitLineMaterial = new LineMaterial({ vertexColors: true, transparent: true });
    // @types/three omits `linewidth` from LineMaterialParameters though the runtime supports it
    (orbitLineMaterial as unknown as { linewidth: number }).linewidth = ORBIT_LINE_WIDTH;
    const orbitLine = new Line2(new LineGeometry(), orbitLineMaterial);
    orbitLine.visible = false;
    orbitLineRef.current = orbitLine;

    // Soft green halo behind the selected dot: radial gradient texture on a sprite (fades to
    // transparent at the edge; depthWrite off so it never punches holes in the globe).
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = GLOW_TEX_SIZE;
    glowCanvas.height = GLOW_TEX_SIZE;
    const gctx = glowCanvas.getContext("2d");
    if (gctx) {
      const grad = gctx.createRadialGradient(
        GLOW_TEX_SIZE / 2,
        GLOW_TEX_SIZE / 2,
        0,
        GLOW_TEX_SIZE / 2,
        GLOW_TEX_SIZE / 2,
        GLOW_TEX_SIZE / 2
      );
      grad.addColorStop(0, "rgba(34, 255, 136, 0.9)");
      grad.addColorStop(0.4, "rgba(34, 255, 136, 0.35)");
      grad.addColorStop(1, "rgba(34, 255, 136, 0)");
      gctx.fillStyle = grad;
      gctx.fillRect(0, 0, GLOW_TEX_SIZE, GLOW_TEX_SIZE);
    }
    const glowTexture = new THREE.CanvasTexture(glowCanvas);
    const glowMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.9,
    });
    const glowSprite = new THREE.Sprite(glowMaterial);
    glowSprite.visible = false;
    glowSpriteRef.current = glowSprite;

    globe.scene().add(basePoints, highlightPoints, orbitLine, glowSprite);

    // Recompute dot sizes when the OrbitControls camera moves: base size grows gently as the
    // camera zooms in so dots stay readable, clamped to a sane floor/ceiling.
    const controls = globe.controls();
    const refDist = globe.camera().position.distanceTo(controls.target);
    const applySize = () => {
      const dist = globe.camera().position.distanceTo(controls.target);
      const size = dotSizeFor(dist, refDist, BASE_SIZE);
      dotSizeRef.current = size;
      (basePoints.material as THREE.PointsMaterial).size = size;
      const hiSize = size * HIGHLIGHT_FACTOR;
      highlightBaseRef.current = hiSize;
      (highlightPoints.material as THREE.PointsMaterial).size = hiSize;
      glowSprite.scale.set(size * GLOW_FACTOR, size * GLOW_FACTOR, 1);
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

    // Per-frame interpolation: dots glide from the previous snapshot to the current one over the 2s
    // poll window instead of stepping (LEO moves only a few pixels per 2s, so a linear short-arc glide
    // is visually smooth and far cheaper than per-frame SGP4 for the whole catalog).
    let rafId = 0;
    const frame = (now: number) => {
      const base = baseRef.current;
      const n = worldCurRef.current.length / 3;
      if (base && n > 0) {
        const t = Math.min(1, Math.max(0, (now - tickAtRef.current) / 2000));
        lerpWorldPositions(worldPrevRef.current, worldCurRef.current, t, lerpOutRef.current);
        const posAttr = base.geometry.attributes.position as THREE.BufferAttribute;
        (posAttr.array as Float32Array).set(lerpOutRef.current);
        posAttr.needsUpdate = true;
        // picking and the visual-check harness project the *visible* (interpolated) dots
        worldCoordsRef.current = lerpOutRef.current;

        const hi = highlightIdxRef.current;
        const highlight = highlightRef.current;
        if (hi >= 0 && highlight?.visible) {
          const hp = highlight.geometry.attributes.position as THREE.BufferAttribute;
          hp.setXYZ(0, lerpOutRef.current[hi * 3], lerpOutRef.current[hi * 3 + 1], lerpOutRef.current[hi * 3 + 2]);
          hp.needsUpdate = true;
          // pulsing dot size + glow halo track the (lerped) selected satellite; the halo breathes
          // with the same phase so the selection reads as a strong pulsing blob
          const pulse = Math.sin(now / PULSE_PERIOD_MS);
          (highlight.material as THREE.PointsMaterial).size =
            highlightBaseRef.current * (1 + PULSE_AMPLITUDE * pulse);
          const glow = glowSpriteRef.current;
          if (glow) {
            glow.position.set(lerpOutRef.current[hi * 3], lerpOutRef.current[hi * 3 + 1], lerpOutRef.current[hi * 3 + 2]);
            const gScale = dotSizeRef.current * GLOW_FACTOR * (GLOW_PULSE_MEAN + GLOW_PULSE_AMPLITUDE * pulse);
            glow.scale.set(gScale, gScale, 1);
          }
        }

        const entry = labelEntryRef.current;
        const li = labelIdxRef.current;
        if (entry && li >= 0) {
          const lp = latLngPrevRef.current;
          const lc = latLngCurRef.current;
          entry.lat = lp[li * 2] + (lc[li * 2] - lp[li * 2]) * t;
          entry.lng = lp[li * 2 + 1] + (lc[li * 2 + 1] - lp[li * 2 + 1]) * t;
        }
      }
      // advance the orbit gradient's bright peak so it flows along the ring (direction cue)
      const orbitLine = orbitLineRef.current;
      if (orbitLine?.visible) {
        orbitPhaseRef.current += ORBIT_PHASE_STEP;
        orbitLine.geometry.setColors(orbitGradientColors(orbitPointCountRef.current, orbitPhaseRef.current));
      }
      rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("click", onClick);
      controls.removeEventListener("change", applySize);
      globe.scene().remove(basePoints, highlightPoints, orbitLine, glowSprite);
      basePoints.geometry.dispose();
      (basePoints.material as THREE.Material).dispose();
      highlightPoints.geometry.dispose();
      (highlightPoints.material as THREE.Material).dispose();
      orbitLine.geometry.dispose();
      orbitLine.material.dispose();
      glowSprite.geometry.dispose();
      glowSprite.material.dispose();
      (glowSprite.material as THREE.SpriteMaterial).map?.dispose();
      globe._destructor?.();
      globeRef.current = null;
      baseRef.current = null;
      highlightRef.current = null;
      orbitLineRef.current = null;
      glowSpriteRef.current = null;
    };
    // positions.length only seeds the initial buffer capacity; the update effect grows it as needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Snapshot bookkeeping: a new `positions` array starts a fresh 2s interpolation epoch. The old
  // snapshot is shifted into the "prev" buffers and new world coords are computed into "cur"; the rAF
  // loop lerps prev -> cur so dots glide. Continuity is free: at arrival t restarts at 0, where the
  // lerp equals the old current snapshot.
  useEffect(() => {
    const globe = globeRef.current;
    const base = baseRef.current;
    if (!globe || !base) return;

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

    const n = positions.length;
    const hadPrev = hasSnapshotRef.current && worldCurRef.current.length === n * 3;
    if (worldCurRef.current.length !== n * 3) {
      worldPrevRef.current = new Float32Array(n * 3);
      worldCurRef.current = new Float32Array(n * 3);
      lerpOutRef.current = new Float32Array(n * 3);
      latLngPrevRef.current = new Float32Array(n * 2);
      latLngCurRef.current = new Float32Array(n * 2);
    }
    const prev = worldPrevRef.current;
    const cur = worldCurRef.current;
    const lprev = latLngPrevRef.current;
    const lcur = latLngCurRef.current;
    if (hadPrev) {
      prev.set(cur);
      lprev.set(lcur);
    }

    const posAttr = base.geometry.attributes.position as THREE.BufferAttribute;
    const colorAttr = base.geometry.attributes.color as THREE.BufferAttribute;
    const tmpColor = new THREE.Color();
    positions.forEach((p, i) => {
      const c = globe.getCoords(p.lat, p.lon, altR(p.altKm));
      cur[i * 3] = c.x;
      cur[i * 3 + 1] = c.y;
      cur[i * 3 + 2] = c.z;
      lcur[i * 2] = p.lat;
      lcur[i * 2 + 1] = p.lon;
      posAttr.setXYZ(i, c.x, c.y, c.z);
      tmpColor.set(p.color ?? "#e5e7eb");
      colorAttr.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b);
    });
    // First snapshot (or resized catalog): hold at the current position instead of gliding from nowhere.
    if (!hadPrev) {
      prev.set(cur);
      lprev.set(lcur);
    }
    hasSnapshotRef.current = true;
    worldCoordsRef.current = cur;
    tickAtRef.current = performance.now();
    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;

    // Mutate the single label entry in place (no labelsData call) so the label glides with the sat.
    const labelEntry = labelEntryRef.current;
    if (labelEntry) {
      const idx = positions.findIndex((p) => p.catnr === labelEntry.catnr);
      labelIdxRef.current = idx;
      if (idx >= 0) {
        const p = positions[idx];
        labelEntry.lat = p.lat;
        labelEntry.lng = p.lon;
        labelEntry.altKm = p.altKm;
      }
    }
  }, [positions]);

  // Highlight layer shows hovered or selected (hover wins); the rAF loop keeps its position lerped
  // between snapshots using the index stored here. The glow halo mirrors its visibility.
  useEffect(() => {
    const highlight = highlightRef.current;
    const glow = glowSpriteRef.current;
    if (!highlight) return;
    const shown = hoveredCatnr ?? selectedCatnr;
    const idx = shown != null ? positions.findIndex((p) => p.catnr === shown) : -1;
    highlightIdxRef.current = idx;
    if (idx >= 0) {
      const cur = worldCurRef.current;
      if (cur.length >= (idx + 1) * 3) {
        const hp = highlight.geometry.attributes.position as THREE.BufferAttribute;
        hp.setXYZ(0, cur[idx * 3], cur[idx * 3 + 1], cur[idx * 3 + 2]);
        hp.needsUpdate = true;
      }
      highlight.visible = true;
      if (glow) glow.visible = true;
    } else {
      highlight.visible = false;
      if (glow) glow.visible = false;
    }
  }, [positions, selectedCatnr, hoveredCatnr]);

  // Re-create the label layer ONLY when the selection changes; position ticks mutate the same entry above.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    if (selectedCatnr == null) {
      labelIdxRef.current = -1;
      labelEntryRef.current = null;
      globe.labelsData([]);
      return;
    }
    const sat = positionsRef.current.find((p) => p.catnr === selectedCatnr);
    labelIdxRef.current = sat ? positionsRef.current.indexOf(sat) : -1;
    const entry = sat ? { lat: sat.lat, lng: sat.lon, catnr: sat.catnr, altKm: sat.altKm } : null;
    labelEntryRef.current = entry;
    globe.labelsData(entry ? [entry] : []);
  }, [selectedCatnr]);

  // The orbit ground track is drawn as a fat gradient Line2; the color peak loops around the ring
  // in the rAF loop as a direction cue. Writing new world coords also resets the loop phase.
  useEffect(() => {
    const globe = globeRef.current;
    const orbitLine = orbitLineRef.current;
    if (!globe || !orbitLine) return;
    if (selectedOrbit && selectedOrbit.length >= 2) {
      const n = selectedOrbit.length;
      const pos = new Float32Array(n * 3);
      selectedOrbit.forEach(([lon, lat], i) => {
        const c = globe.getCoords(lat, lon, ORBIT_ALTITUDE);
        pos[i * 3] = c.x;
        pos[i * 3 + 1] = c.y;
        pos[i * 3 + 2] = c.z;
      });
      orbitLine.geometry.setPositions(pos);
      orbitPointCountRef.current = n;
      orbitPhaseRef.current = 0;
      orbitLine.visible = true;
    } else {
      orbitLine.visible = false;
    }
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
