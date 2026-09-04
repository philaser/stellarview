import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import Globe from "globe.gl";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { SatDot } from "./MapView";
import { subsolarPoint } from "./sat/sun";

const COUNTRIES_URL = "/globe/countries.geojson";
const EARTH_TEXTURE_URL = "/globe/earth-dark.jpg";
const EARTH_BUMP_URL = "/globe/earth-topology.png";

// Cap visual altitude so GEO/MEO shells hug the globe instead of rendering as streaks from inside the camera.
const ALT_CAP = 0.35;
const altR = (altKm: number) => Math.min(altKm / 6371, ALT_CAP);

// Dot sizes in globe-RADIUS units: dots gently grow as the camera zooms in (~2-5px dots at the
// default camera, up to a visible 9% of the globe radius). This globe.gl build uses a globe radius
// of ~100 three.js units, so every size below is multiplied by the actual radius before being
// applied to materials/sprites (see `globeRadius` in the component).
const BASE_SIZE = 0.017;
const BASE_OPACITY = 0.46;
const MIN_DOT_SIZE = 0.01;
const MAX_DOT_SIZE = 0.09;
const SIZE_CURVE = 0.35;

// Trajectory: a fat Line2 circling the globe just above the surface. A per-vertex color gradient
// (sharp white-hot head fading to a dim violet tail) loops around the ring every frame to show
// direction of travel; violet keeps the orbit distinct from the mint-green selection marker.
// Line2 renders with depth testing so the far side is occluded by the globe.
const ORBIT_ALTITUDE = 0.07;
const ORBIT_LINE_WIDTH = 4;
const ORBIT_PHASE_STEP = 0.02;

// Selected-satellite highlight: a mint-green dot plus a soft radial-gradient halo sprite. Both
// are round radial-gradient sprites (never the square quads THREE.Points renders) that scale WITH
// the globe like ordinary dots — the dot ~1.3x their size, the halo 3x the dot — floored to a
// tiny pixel size at far zoom so the marker is always visible. The selection breathes via
// opacity, not size, so it never balloons into a giant pulsing blob at any zoom.
const SELECTION_FACTOR = 1.3;  // selection dot ~1.3x the base dot size
const SELECTION_MIN_PX = 5;    // never smaller than ~5px on screen
const GLOW_HALO_FACTOR = 3;    // halo is 3x the dot
const GLOW_TEX_SIZE = 128;
const PULSE_AMPLITUDE = 0.3;   // opacity pulse depth (size stays stable)
const PULSE_MEAN = 0.72;       // mean opacity of the pulsing dot
const PULSE_PERIOD_MS = 600; // ~3.8s pulse

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
  const SIGMA = 0.04; // head width as a fraction of the ring (~12% of the ring is hot)
  const HEAD: [number, number, number] = [255, 255, 255];      // white-hot head
  const TAIL: [number, number, number] = [168, 85, 247];      // violet base (#a855f7)
  const TAIL_BRIGHTNESS = 0.35;                                // tail clearly dimmer
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

/** Dims markers around and behind the globe limb so the orbital shell retains front/back depth. */
export function cameraFacingBrightness(
  point: { x: number; y: number; z: number },
  camera: { x: number; y: number; z: number }
): number {
  const pointLength = Math.hypot(point.x, point.y, point.z) || 1;
  const cameraLength = Math.hypot(camera.x, camera.y, camera.z) || 1;
  const facing = (point.x * camera.x + point.y * camera.y + point.z * camera.z) / (pointLength * cameraLength);
  const normalized = Math.min(1, Math.max(0, (facing + 0.25) / 0.8));
  const smooth = normalized * normalized * (3 - 2 * normalized);
  return 0.45 + 0.55 * smooth;
}

/**
 * Whether the segment from camera to a world point clears the rendered Earth sphere. This is a
 * scalar, allocation-free ray/sphere test because pointer picking evaluates every live satellite.
 */
export function isVisibleAboveGlobe(
  point: { x: number; y: number; z: number },
  camera: { x: number; y: number; z: number },
  globeRadius: number
): boolean {
  const dx = point.x - camera.x;
  const dy = point.y - camera.y;
  const dz = point.z - camera.z;
  const segmentLengthSquared = dx * dx + dy * dy + dz * dz;
  if (segmentLengthSquared === 0) return true;
  const closestT = Math.max(0, Math.min(1, -(camera.x * dx + camera.y * dy + camera.z * dz) / segmentLengthSquared));
  const closestX = camera.x + dx * closestT;
  const closestY = camera.y + dy * closestT;
  const closestZ = camera.z + dz * closestT;
  return closestX * closestX + closestY * closestY + closestZ * closestZ >= globeRadius * globeRadius;
}

// Screen-space picking radii (px) around the cursor; the nearest projected dot wins.
const HOVER_THRESHOLD = 11;
const CLICK_THRESHOLD = 14;
const TOOLTIP_OFFSET = 14;
// A click that moved more than this many px from its pointerdown was a globe-rotation drag,
// not a selection gesture.
const DRAG_TOLERANCE = 5;

/** Scene lights for the 3D globe: with night shading, globe.gl's default ambient+directional pair so
 *  the terminator shows; without, ambient-only so the whole globe reads uniformly lit. */
export function globeLights(showNight: boolean): THREE.Light[] {
  return showNight
    ? [new THREE.AmbientLight(0xc2cede, 1.3 * Math.PI), new THREE.DirectionalLight(0xffffff, 0.65 * Math.PI)]
    : [new THREE.AmbientLight(0xffffff, 2 * Math.PI)];
}

export interface GlobeViewProps {
  positions: SatDot[];
  satNames: Record<number, string>;
  selectedOrbit: [number, number][] | null;
  selectedCatnr: number | null;
  followCatnr?: number | null;
  focus?: { catnr: number; ts: number } | null;
  showNight?: boolean;
  locked?: boolean;
  onSelect: (catnr: number) => void;
  time?: Date;
  onStopFollow?: () => void;
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

function buildPoints(capacity: number, size: number, sizeAttenuation = true): THREE.Points {
  return new THREE.Points(buildGeometry(capacity), new THREE.PointsMaterial({
    size,
    vertexColors: true,
    sizeAttenuation,
    transparent: true,
    opacity: BASE_OPACITY,
  }));
}

export default function GlobeView({
  positions,
  satNames,
  selectedOrbit,
  selectedCatnr,
  followCatnr,
  focus,
  showNight,
  locked,
  onSelect,
  time,
  onStopFollow,
}: GlobeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<InstanceType<typeof Globe> | null>(null);
  const baseRef = useRef<THREE.Points | null>(null);
  const highlightDotRef = useRef<THREE.Sprite | null>(null);
  const selectedLabelRef = useRef<HTMLDivElement>(null);
  const orbitLineRef = useRef<Line2 | null>(null);
  const glowSpriteRef = useRef<THREE.Sprite | null>(null);
  const orbitPointCountRef = useRef(0);
  const orbitPhaseRef = useRef(0);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const stopFollowRef = useRef(onStopFollow);
  stopFollowRef.current = onStopFollow;
  const dragNotifiedRef = useRef(false);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  // Pointer position at pointerdown, to tell real clicks apart from rotation drags.
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
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
  const selectedIdxRef = useRef(-1);
  const reducedMotionRef = useRef(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
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
    // this globe.gl build renders the sphere at ~100 three.js units radius; dot sizes are expressed
    // in globe-radius units, so multiply by the real radius before applying them to materials.
    const globeRadius = (globe as { getGlobeRadius?: () => number }).getGlobeRadius?.() ?? 100;
    globe
      .backgroundColor("#050816")
      .globeImageUrl(EARTH_TEXTURE_URL)
      .bumpImageUrl(EARTH_BUMP_URL)
      .showAtmosphere(true)
      .atmosphereColor("#5f86c8")
      .atmosphereAltitude(0.18)
      .showGraticules(false)
      .pointOfView({ lat: 20, lng: 0, altitude: 2.75 });

    globe
      .labelsData([])
      .labelLat((d) => (d as SatDot).lat)
      .labelLng((d) => (d as SatDot).lon)
      .labelText((d) => satNamesRef.current[(d as { catnr: number }).catnr] ?? String((d as { catnr: number }).catnr))
      .labelColor(() => "#ffffff")
      .labelSize(1.4)
      .labelAltitude((d) => altR((d as SatDot).altKm) + 0.03)
      .labelResolution(2);

    // All satellites render as one THREE.Points layer (single draw call); the selection is a pair
    // of round radial-gradient sprites (dot + halo) that never look like the square quads
    // THREE.Points renders, scaled with the globe and floored to a minimum pixel size.
    const basePoints = buildPoints(positions.length, BASE_SIZE * globeRadius, false);
    baseRef.current = basePoints;

    // Trajectory: a fat gradient line looping the globe. Positions are written when an orbit is
    // selected; the rAF loop advances the color peak so the gradient flows along the orbit.
    const orbitLineMaterial = new LineMaterial({ vertexColors: true, transparent: true });
    // @types/three omits `linewidth` from LineMaterialParameters though the runtime supports it
    (orbitLineMaterial as unknown as { linewidth: number }).linewidth = ORBIT_LINE_WIDTH;
    const orbitLine = new Line2(new LineGeometry(), orbitLineMaterial);
    orbitLine.visible = false;
    orbitLineRef.current = orbitLine;

    // Radial-gradient texture helper shared by the selection dot and its halo: both fade to
    // transparent at the edge so they render as smooth circles (depthWrite off so they never
    // punch holes in the globe).
    const radialTexture = (stops: [number, string][]) => {
      const canvas = document.createElement("canvas");
      canvas.width = GLOW_TEX_SIZE;
      canvas.height = GLOW_TEX_SIZE;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const grad = ctx.createRadialGradient(
          GLOW_TEX_SIZE / 2,
          GLOW_TEX_SIZE / 2,
          0,
          GLOW_TEX_SIZE / 2,
          GLOW_TEX_SIZE / 2,
          GLOW_TEX_SIZE / 2
        );
        for (const [at, color] of stops) grad.addColorStop(at, color);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, GLOW_TEX_SIZE, GLOW_TEX_SIZE);
      }
      return new THREE.CanvasTexture(canvas);
    };
    const spriteMaterial = (texture: THREE.Texture) =>
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });

    // Mint dot: mostly-opaque core with a soft edge.
    const highlightDot = new THREE.Sprite(
      spriteMaterial(
        radialTexture([
          [0, "rgba(34, 255, 136, 1)"],
          [0.3, "rgba(34, 255, 136, 0.9)"],
          [0.75, "rgba(34, 255, 136, 0.25)"],
          [1, "rgba(34, 255, 136, 0)"],
        ])
      )
    );
    highlightDot.visible = false;
    highlightDotRef.current = highlightDot;

    // Softer, wider halo behind the dot.
    const glowSprite = new THREE.Sprite(
      spriteMaterial(
        radialTexture([
          [0, "rgba(34, 255, 136, 0.9)"],
          [0.4, "rgba(34, 255, 136, 0.35)"],
          [1, "rgba(34, 255, 136, 0)"],
        ])
      )
    );
    glowSprite.visible = false;
    glowSpriteRef.current = glowSprite;

    globe.scene().add(basePoints, highlightDot, glowSprite, orbitLine);

    // Recompute dot sizes when the OrbitControls camera moves: base size grows gently as the
    // camera zooms in so dots stay readable, clamped to a sane floor/ceiling. The selection
    // sprites are pixel-constant: their world scale is derived from the camera projection below.
    const controls = globe.controls();
    const refDist = globe.camera().position.distanceTo(controls.target);
    const applySize = () => {
      const dist = globe.camera().position.distanceTo(controls.target);
      const size = dotSizeFor(dist, refDist, BASE_SIZE) * globeRadius;
      dotSizeRef.current = size;
      (basePoints.material as THREE.PointsMaterial).size = size;
    };
    applySize();
    controls.addEventListener("change", applySize);

    // World scale for a sprite that must render at a fixed on-screen pixel size: derive the world
    // height visible at the camera's distance, then take the pixel fraction of it.
    const pxScale = (px: number) => {
      const cam = globe.camera() as THREE.PerspectiveCamera;
      const dist = cam.position.distanceTo(controls.target);
      const worldHeightAtDist = 2 * Math.tan(((cam.fov ?? 60) * Math.PI) / 360) * dist;
      const cssHeight = container.getBoundingClientRect().height || 1;
      return (px / cssHeight) * worldHeightAtDist;
    };

    // Picking: project every satellite's world coords to the container and take the nearest within a radius.
    const tmpVec = new THREE.Vector3();
    const projectToScreen = (rect: DOMRect): ScreenDot[] => {
      const wc = worldCoordsRef.current;
      const n = wc.length / 3;
      const dots: ScreenDot[] = new Array(n);
      for (let i = 0; i < n; i++) {
        const point = { x: wc[i * 3], y: wc[i * 3 + 1], z: wc[i * 3 + 2] };
        if (!isVisibleAboveGlobe(point, globe.camera().position, globeRadius)) {
          dots[i] = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, catnr: -1 };
          continue;
        }
        tmpVec.set(wc[i * 3], wc[i * 3 + 1], wc[i * 3 + 2]).project(globe.camera());
        if (tmpVec.z < -1 || tmpVec.z > 1) {
          // outside the camera clip volume — never a hit
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
      const down = pointerDownRef.current;
      if (evt.buttons && down && Math.hypot(evt.clientX - down.x, evt.clientY - down.y) > DRAG_TOLERANCE) {
        if (!dragNotifiedRef.current && !lockedRef.current) stopFollowRef.current?.();
        dragNotifiedRef.current = true;
        setHoveredCatnr(null);
        setTooltip(null);
        return;
      }
      if (lockedRef.current) {
        // a locked globe only tracks its selection; hovering must not show highlights or tooltips
        setHoveredCatnr(null);
        setTooltip(null);
        container.style.cursor = "";
        return;
      }
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
      const rect = container.getBoundingClientRect();
      setTooltip({
        x: Math.min(hit.px + TOOLTIP_OFFSET, Math.max(8, rect.width - 230)),
        y: Math.min(hit.py + TOOLTIP_OFFSET, Math.max(8, rect.height - 44)),
        text: `${satNamesRef.current[catnr] ?? "Unknown"} · NORAD ${catnr}`,
      });
      container.style.cursor = "pointer";
    };
    const onPointerDown = (evt: PointerEvent) => {
      pointerDownRef.current = { x: evt.clientX, y: evt.clientY };
      dragNotifiedRef.current = false;
    };
    const onClick = (evt: PointerEvent) => {
      if (lockedRef.current) return;
      // a release far from the pointerdown was a globe rotation drag, not a click
      const down = pointerDownRef.current;
      if (down && Math.hypot(evt.clientX - down.x, evt.clientY - down.y) > DRAG_TOLERANCE) return;
      const hit = pick(evt, CLICK_THRESHOLD);
      if (!hit) return;
      const sat = positionsRef.current[hit.idx];
      if (sat) onSelectRef.current(sat.catnr);
    };
    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("click", onClick);

    fetch(COUNTRIES_URL)
      .then((r) => r.json())
      .then((geo: { features: object[] }) => {
        globe
          .polygonsData(geo.features)
          .polygonCapColor(() => "rgba(36, 58, 78, 0.24)")
          .polygonSideColor(() => "rgba(56, 89, 138, 0.22)")
          .polygonStrokeColor(() => "rgba(139, 172, 201, 0.46)")
          .polygonAltitude(0.002);
      })
      .catch(() => {
        // countries layer is decorative; the globe still renders
      });

    globeRef.current = globe;
    const resize = () => {
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        globe.width(container.clientWidth).height(container.clientHeight);
      }
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    resizeObserver?.observe(container);
    resize();

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
        const dot = highlightDotRef.current;
        if (hi >= 0 && dot?.visible) {
          // The marker scales with the globe (like the base dots, ~1.3x their size) but never
          // shrinks below a small pixel floor at far zoom; the halo is a fixed 3x the dot. The
          // pulse breathes the OPACITY so the selection reads as alive without ballooning in size.
          const pulse = reducedMotionRef.current ? 0 : Math.sin(now / PULSE_PERIOD_MS);
          const dotScale = Math.max(
            dotSizeRef.current * SELECTION_FACTOR,
            pxScale(SELECTION_MIN_PX)
          );
          dot.position.set(lerpOutRef.current[hi * 3], lerpOutRef.current[hi * 3 + 1], lerpOutRef.current[hi * 3 + 2]);
          dot.scale.set(dotScale, dotScale, 1);
          dot.material.opacity = Math.min(1, PULSE_MEAN + PULSE_AMPLITUDE * pulse);
          const glow = glowSpriteRef.current;
          if (glow) {
            glow.position.set(lerpOutRef.current[hi * 3], lerpOutRef.current[hi * 3 + 1], lerpOutRef.current[hi * 3 + 2]);
            const gScale = dotScale * GLOW_HALO_FACTOR;
            glow.scale.set(gScale, gScale, 1);
            glow.material.opacity = Math.min(1, PULSE_MEAN - 0.12 + PULSE_AMPLITUDE * pulse);
          }
        }

        const selectedLabel = selectedLabelRef.current;
        const selectedIndex = selectedIdxRef.current;
        if (selectedLabel && selectedIndex >= 0) {
          const point = {
            x: lerpOutRef.current[selectedIndex * 3],
            y: lerpOutRef.current[selectedIndex * 3 + 1],
            z: lerpOutRef.current[selectedIndex * 3 + 2],
          };
          tmpVec.set(point.x, point.y, point.z).project(globe.camera());
          if (isVisibleAboveGlobe(point, globe.camera().position, globeRadius) && tmpVec.z >= -1 && tmpVec.z <= 1) {
            selectedLabel.style.display = "block";
            selectedLabel.style.left = `${(tmpVec.x * 0.5 + 0.5) * container.clientWidth}px`;
            selectedLabel.style.top = `${(-tmpVec.y * 0.5 + 0.5) * container.clientHeight}px`;
          } else {
            selectedLabel.style.display = "none";
          }
        } else if (selectedLabel) {
          selectedLabel.style.display = "none";
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
      if (orbitLine?.visible && !reducedMotionRef.current) {
        orbitPhaseRef.current += ORBIT_PHASE_STEP;
        orbitLine.geometry.setColors(orbitGradientColors(orbitPointCountRef.current, orbitPhaseRef.current));
      }
      rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("click", onClick);
      controls.removeEventListener("change", applySize);
      globe.scene().remove(basePoints, highlightDot, glowSprite, orbitLine);
      basePoints.geometry.dispose();
      (basePoints.material as THREE.Material).dispose();
      orbitLine.geometry.dispose();
      orbitLine.material.dispose();
      glowSprite.geometry.dispose();
      glowSprite.material.dispose();
      (glowSprite.material as THREE.SpriteMaterial).map?.dispose();
      highlightDot.geometry.dispose();
      highlightDot.material.dispose();
      (highlightDot.material as THREE.SpriteMaterial).map?.dispose();
      globe._destructor?.();
      globeRef.current = null;
      baseRef.current = null;
      highlightDotRef.current = null;
      orbitLineRef.current = null;
      glowSpriteRef.current = null;
    };
    // positions.length only seeds the initial buffer capacity; the update effect grows it as needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Share the simulation's solar position with the 2D terminator and visibility calculations.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const lights = globeLights(showNight ?? true);
    if (lights.length > 1) {
      const sun = subsolarPoint(time ?? new Date());
      const direction = globe.getCoords(sun.latDeg, sun.lonDeg, 5);
      lights[1].position.set(direction.x, direction.y, direction.z);
    }
    globe.lights(lights);
  }, [showNight, time]);

  const handledFocusTsRef = useRef<number | null>(null);

  // Focus is a one-shot camera move. Follow repeats the move on each position snapshot, keeping
  // the selected satellite centered while still allowing the user to temporarily inspect nearby space.
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || !focus || handledFocusTsRef.current === focus.ts) return;
    const satellite = positions.find((position) => position.catnr === focus.catnr);
    if (!satellite) return;
    handledFocusTsRef.current = focus.ts;
    globe.pointOfView(
      { lat: satellite.lat, lng: satellite.lon, altitude: 2.15 },
      reducedMotionRef.current ? 0 : 850
    );
  }, [focus, positions]);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || followCatnr == null) return;
    const satellite = positions.find((position) => position.catnr === followCatnr);
    if (satellite) globe.pointOfView(
      { lat: satellite.lat, lng: satellite.lon, altitude: globe.pointOfView().altitude ?? 1.9 },
      reducedMotionRef.current ? 0 : 650
    );
  }, [followCatnr, positions]);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const controls = globe.controls() as ReturnType<InstanceType<typeof Globe>["controls"]> & {
      enableRotate?: boolean;
      enableZoom?: boolean;
    };
    controls.enableRotate = !(locked ?? false);
    controls.enableZoom = !(locked ?? false);
  }, [locked]);

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
        sizeAttenuation: false,
        transparent: true,
        opacity: BASE_OPACITY,
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
    const cameraPosition = globe.camera().position;
    positions.forEach((p, i) => {
      const c = globe.getCoords(p.lat, p.lon, altR(p.altKm));
      cur[i * 3] = c.x;
      cur[i * 3 + 1] = c.y;
      cur[i * 3 + 2] = c.z;
      lcur[i * 2] = p.lat;
      lcur[i * 2 + 1] = p.lon;
      posAttr.setXYZ(i, c.x, c.y, c.z);
      tmpColor.set(p.color ?? "#e5e7eb");
      const brightness = cameraFacingBrightness(c, cameraPosition);
      colorAttr.setXYZ(i, tmpColor.r * brightness, tmpColor.g * brightness, tmpColor.b * brightness);
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
    // The buffer keeps its largest-ever capacity; trim the draw range to the current catalog so
    // filtered-out satellites stop rendering instead of lingering as frozen dots.
    base.geometry.setDrawRange(0, n);

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

  // Highlight sprites show hovered or selected (hover wins); the rAF loop keeps their positions
  // lerped between snapshots using the index stored here. The glow halo mirrors the dot's visibility.
  useEffect(() => {
    const dot = highlightDotRef.current;
    const glow = glowSpriteRef.current;
    if (!dot) return;
    const shown = hoveredCatnr ?? selectedCatnr;
    const idx = shown != null ? positions.findIndex((p) => p.catnr === shown) : -1;
    selectedIdxRef.current = selectedCatnr != null
      ? positions.findIndex((position) => position.catnr === selectedCatnr)
      : -1;
    highlightIdxRef.current = idx;
    if (idx >= 0) {
      const cur = worldCurRef.current;
      if (cur.length >= (idx + 1) * 3) {
        dot.position.set(cur[idx * 3], cur[idx * 3 + 1], cur[idx * 3 + 2]);
      }
      dot.visible = true;
      if (glow) glow.visible = true;
    } else {
      dot.visible = false;
      if (glow) glow.visible = false;
    }
  }, [positions, selectedCatnr, hoveredCatnr]);

  const selectedPositionAvailable = positions.some((position) => position.catnr === selectedCatnr);

  // Position ticks mutate the label; a newly revealed result may arrive after selection.
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
  }, [selectedCatnr, selectedPositionAvailable]);

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
      orbitLine.geometry.setColors(orbitGradientColors(n, 0));
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
        aria-hidden="true"
      >
        {tooltip?.text}
      </div>
      <div ref={selectedLabelRef} className="selected-map-label" aria-hidden="true">
        {selectedCatnr == null ? "" : satNames[selectedCatnr] ?? selectedCatnr}
      </div>
    </div>
  );
}
