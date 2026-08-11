import type { SatRec } from "satellite.js";
import { positionAt } from "./propagate";

export function buildGroundTrack(satrec: SatRec, points = 120, start = new Date()): [number, number][] {
  const periodS = (2 * Math.PI) / satrec.no * 60;
  const track: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const t = new Date(start.getTime() + (periodS * i) / points * 1000);
    const pos = positionAt(satrec, t);
    track.push([pos.lonDeg, pos.latDeg]);
  }
  // Unwrap longitudes so the track never jumps ±180° at the antimeridian (MapLibre would draw a full-viewport line).
  let prev = track[0][0];
  for (let i = 1; i < track.length; i++) {
    let lon = track[i][0];
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    track[i] = [lon, track[i][1]];
    prev = lon;
  }
  return track;
}
