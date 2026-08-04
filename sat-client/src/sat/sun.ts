import { gstime } from "satellite.js";

const DEG = 180 / Math.PI;

function julianCentury(date: Date): number {
  const msPerDay = 86_400_000;
  const j2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
  return (date.getTime() - j2000) / msPerDay / 36525;
}

// Shared low-precision solar position (NOAA algorithm): RA/dec in radians
function solarRaDec(date: Date): { ra: number; dec: number } {
  const n = julianCentury(date);
  const L = (280.46 + 36000.771 * n) % 360;
  const g = ((357.528 + 35999.05 * n) % 360) * (Math.PI / 180);
  const eclipticLon = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * (Math.PI / 180);
  const obliquity = (23.439 - 0.0000004 * n) * (Math.PI / 180);
  const ra = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLon), Math.cos(eclipticLon));
  const dec = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLon));
  return { ra, dec };
}

export function subsolarPoint(date: Date): { latDeg: number; lonDeg: number } {
  const { ra, dec } = solarRaDec(date);
  const gmst = gstime(date);
  let lonDeg = (ra - gmst) * DEG;
  lonDeg = ((lonDeg + 540) % 360) - 180;
  return { latDeg: dec * DEG, lonDeg };
}

// Sun unit vector in the ECI frame (exact for the shadow test — RA is ECI-referenced)
export function sunDirectionECI(date: Date): { x: number; y: number; z: number } {
  const { ra, dec } = solarRaDec(date);
  return {
    x: Math.cos(dec) * Math.cos(ra),
    y: Math.cos(dec) * Math.sin(ra),
    z: Math.sin(dec),
  };
}

export function solarElevationDeg(date: Date, latDeg: number, lonDeg: number): number {
  const { ra, dec } = solarRaDec(date);
  const gmst = gstime(date);
  const hourAngle = gmst + lonDeg / DEG - ra;
  const sinElev =
    Math.sin(latDeg / DEG) * Math.sin(dec) +
    Math.cos(latDeg / DEG) * Math.cos(dec) * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sinElev))) * DEG;
}
