import type { SatRec } from "satellite.js";
import { propagate } from "satellite.js";
import { solarElevationDeg, sunDirectionECI } from "./sun";
import { elevationDegAt, type ObserverPoint } from "./passes";

const R_EARTH_KM = 6371;
export const NAUTICAL_DARKNESS_DEG = -6;

export function isSunlit(satrec: SatRec, date: Date): boolean {
  const sunDir = sunDirectionECI(date);
  const pv = propagate(satrec, date);
  // satellite.js returns position as false on SGP4 error; treat as not sunlit.
  if (typeof pv.position === "boolean") return false;
  const sat = pv.position;
  const along = sat.x * sunDir.x + sat.y * sunDir.y + sat.z * sunDir.z;
  const perpSq =
    (sat.x - sunDir.x * along) ** 2 + (sat.y - sunDir.y * along) ** 2 + (sat.z - sunDir.z * along) ** 2;
  return !(along < 0 && perpSq < R_EARTH_KM ** 2);
}

export function darkAtObserver(date: Date, latDeg: number, lonDeg: number): boolean {
  return solarElevationDeg(date, latDeg, lonDeg) < NAUTICAL_DARKNESS_DEG;
}

export type VisibilityReason = "visible" | "in-shadow" | "daylight" | "below-horizon";

export function satelliteVisible(
  satrec: SatRec,
  observer: ObserverPoint,
  date: Date
): { visible: boolean; reason: VisibilityReason } {
  if (elevationDegAt(satrec, observer, date) <= 0) return { visible: false, reason: "below-horizon" };
  if (!darkAtObserver(date, observer.lat, observer.lon)) return { visible: false, reason: "daylight" };
  if (!isSunlit(satrec, date)) return { visible: false, reason: "in-shadow" };
  return { visible: true, reason: "visible" };
}
