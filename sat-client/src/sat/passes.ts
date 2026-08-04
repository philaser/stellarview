import { propagate, gstime, eciToEcf, ecfToLookAngles, type SatRec } from "satellite.js";

export interface ObserverPoint {
  lat: number;
  lon: number;
  heightM: number;
}

export interface Pass {
  start: Date;
  peak: Date;
  end: Date;
  maxElevationDeg: number;
}

export function nextPasses(
  satrec: SatRec,
  observer: ObserverPoint,
  hours = 48,
  stepS = 60,
  minElevationDeg = 5
): Pass[] {
  const observerGd = {
    longitude: (observer.lon * Math.PI) / 180,
    latitude: (observer.lat * Math.PI) / 180,
    height: observer.heightM / 1000,
  };
  const now = Date.now();
  const endMs = now + hours * 3600_000;
  const steps = Math.ceil((endMs - now) / (stepS * 1000));

  const elevations: { t: number; deg: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = now + i * stepS * 1000;
    const pv = propagate(satrec, new Date(t));
    // satellite.js returns position as false on SGP4 error; treat as not visible.
    if (typeof pv.position === "boolean") continue;
    const look = ecfToLookAngles(observerGd, eciToEcf(pv.position, gstime(new Date(t))));
    elevations.push({ t, deg: (look.elevation * 180) / Math.PI });
  }

  const passes: Pass[] = [];
  let runStart: number | null = null;
  let peak: { t: number; deg: number } | null = null;
  for (const e of elevations) {
    if (e.deg >= minElevationDeg) {
      if (runStart === null) runStart = e.t;
      if (!peak || e.deg > peak.deg) peak = e;
    } else if (runStart !== null) {
      passes.push({
        start: new Date(runStart),
        peak: new Date(peak!.t),
        end: new Date(e.t),
        maxElevationDeg: peak!.deg,
      });
      runStart = null;
      peak = null;
    }
  }
  if (runStart !== null) {
    passes.push({
      start: new Date(runStart),
      peak: new Date(peak!.t),
      end: new Date(endMs),
      maxElevationDeg: peak!.deg,
    });
  }
  return passes.sort((a, b) => b.maxElevationDeg - a.maxElevationDeg);
}
