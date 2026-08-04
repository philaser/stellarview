import type { SatRec } from "satellite.js";
import { positionAt } from "./propagate";

export function buildGroundTrack(satrec: SatRec, points = 120): [number, number][] {
  const periodS = (2 * Math.PI) / satrec.no * 60;
  const start = new Date();
  const track: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const t = new Date(start.getTime() + (periodS * i) / points * 1000);
    const pos = positionAt(satrec, t);
    track.push([pos.lonDeg, pos.latDeg]);
  }
  return track;
}
