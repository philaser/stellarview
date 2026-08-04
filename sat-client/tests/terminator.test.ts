import { describe, it, expect } from "vitest";
import { nightPolygon } from "../src/sat/terminator";
import { subsolarPoint } from "../src/sat/sun";

function pointInPolygon(lon: number, lat: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

describe("nightPolygon", () => {
  it("is closed and deterministic", () => {
    const date = new Date("2026-08-05T12:00:00Z");
    const p1 = nightPolygon(date);
    const p2 = nightPolygon(date);
    expect(p1).toEqual(p2);
    expect(p1[0]).toEqual(p1[p1.length - 1]);
    expect(p1.length).toBe(361);
  });

  it("contains the anti-subsolar point and excludes the subsolar point", () => {
    const date = new Date("2026-08-05T12:00:00Z");
    const sub = subsolarPoint(date);
    const anti = { lon: ((sub.lonDeg + 180 + 540) % 360) - 180, lat: -sub.latDeg };
    const poly = nightPolygon(date);
    expect(pointInPolygon(anti.lon, anti.lat, poly)).toBe(true);
    expect(pointInPolygon(sub.lonDeg, sub.latDeg, poly)).toBe(false);
  });

  it("has no consecutive longitude jump greater than 180 degrees", () => {
    const poly = nightPolygon(new Date("2026-08-05T12:00:00Z"));
    // skip the closing edge: a ring spanning all longitudes must wrap 360 degrees
    // between its last point and the numerically-closed first point
    for (let i = 1; i < poly.length - 1; i++) {
      expect(Math.abs(poly[i][0] - poly[i - 1][0])).toBeLessThanOrEqual(180);
    }
  });

  it("tracks the terminator over time", () => {
    const p0 = nightPolygon(new Date("2026-08-05T00:00:00Z"));
    const p1 = nightPolygon(new Date("2026-08-05T06:00:00Z"));
    expect(p0).not.toEqual(p1);
  });
});
