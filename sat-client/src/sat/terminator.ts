import { subsolarPoint } from "./sun";

const DEG = Math.PI / 180;

function wrap180(lon: number): number {
  return ((lon + 540) % 360) - 180;
}

export function nightPolygon(date: Date, points = 360): [number, number][] {
  const sub = subsolarPoint(date);
  const latR = sub.latDeg * DEG;
  const lonR = sub.lonDeg * DEG;
  // sun unit vector from the subsolar point
  const s = {
    x: Math.cos(latR) * Math.cos(lonR),
    y: Math.cos(latR) * Math.sin(lonR),
    z: Math.sin(latR),
  };
  // orthonormal basis perpendicular to the sun direction
  const north = { x: 0, y: 0, z: 1 };
  let u = {
    x: s.y * north.z - s.z * north.y,
    y: s.z * north.x - s.x * north.z,
    z: s.x * north.y - s.y * north.x,
  };
  const uLen = Math.hypot(u.x, u.y, u.z);
  if (uLen < 1e-9) u = { x: 1, y: 0, z: 0 }; // subsolar point at the pole
  else u = { x: u.x / uLen, y: u.y / uLen, z: u.z / uLen };
  const v = {
    x: s.y * u.z - s.z * u.y,
    y: s.z * u.x - s.x * u.z,
    z: s.x * u.y - s.y * u.x,
  };

  const raw: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const t = (i / points) * 2 * Math.PI;
    const px = Math.cos(t) * u.x + Math.sin(t) * v.x;
    const py = Math.cos(t) * u.y + Math.sin(t) * v.y;
    const pz = Math.cos(t) * u.z + Math.sin(t) * v.z;
    raw.push([Math.atan2(py, px) / DEG, Math.asin(pz) / DEG]);
  }

  const antiLat = -sub.latDeg;
  const antiLon = wrap180(sub.lonDeg + 180);

  // Start the sweep at the terminator's crossing of the sub-solar meridian so the
  // closing edge runs along the ring's day-side latitude extreme and the polygon's
  // interior (per the even-odd test) is the night hemisphere.
  let start = 0;
  let best = Infinity;
  for (let i = 0; i < points; i++) {
    const d = Math.abs(wrap180(raw[i][0] - sub.lonDeg));
    if (d < best) {
      best = d;
      start = i;
    }
  }

  const build = (dir: number): [number, number][] => {
    const ring: [number, number][] = [];
    for (let k = 0; k < points; k++) {
      const idx = (((start + dir * k) % points) + points) % points;
      let lon = raw[idx][0];
      if (k > 0) {
        const prev = ring[ring.length - 1][0];
        while (lon - prev > 180) lon -= 360;
        while (lon - prev < -180) lon += 360;
      }
      ring.push([lon, raw[idx][1]]);
    }
    ring.push([ring[0][0], ring[0][1]]); // close the ring
    return ring;
  };

  // The sweep must enclose the night pole (anti-subsolar point). Which traversal
  // direction does that depends on the sun's declination and longitude, so try both.
  let ring = build(1);
  if (!pointInPolygon(antiLon, antiLat, ring)) ring = build(-1);
  return ring;
}

function pointInPolygon(lon: number, lat: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
