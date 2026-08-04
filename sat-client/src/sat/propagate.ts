import { propagate, eciToGeodetic, gstime, degreesLat, degreesLong, type SatRec } from "satellite.js";

export interface SatPosition {
  latDeg: number;
  lonDeg: number;
  altKm: number;
  velocityKms: number;
}

export function positionAt(satrec: SatRec, date: Date): SatPosition {
  const pv = propagate(satrec, date);
  // satellite.js returns position/velocity as false on SGP4 error.
  if (typeof pv.position === "boolean" || typeof pv.velocity === "boolean") {
    throw new Error("SGP4 propagation failed");
  }
  const gmst = gstime(date);
  const geodetic = eciToGeodetic(pv.position, gmst);
  const velocityKms = Math.sqrt(
    pv.velocity.x ** 2 + pv.velocity.y ** 2 + pv.velocity.z ** 2
  );
  return {
    latDeg: degreesLat(geodetic.latitude),
    lonDeg: degreesLong(geodetic.longitude),
    altKm: geodetic.height,
    velocityKms,
  };
}
