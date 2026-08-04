import { describe, it, expect } from "vitest";
import { subsolarPoint, solarElevationDeg } from "../src/sat/sun";
import { isSunlit, darkAtObserver, satelliteVisible } from "../src/sat/visibility";
import { parseTleBlock } from "../src/sat/tle";

// CURRENT ISS TLE from CelesTrak (fetched 2026-08-04) — name line + 2 element lines
const ISS_BLOCK = `ISS (ZARYA)
1 25544U 98067A   26215.79638706  .00007444  00000+0  14146-3 0  9999
2 25544  51.6316  64.4821 0007224   9.2337 350.8783 15.49332738579132`;

describe("subsolarPoint", () => {
  it("is near the equator at the March equinox", () => {
    const p = subsolarPoint(new Date(Date.UTC(2026, 2, 20, 12, 0, 0)));
    expect(Math.abs(p.latDeg)).toBeLessThan(1);
  });

  it("moves west over time", () => {
    const t0 = new Date(Date.UTC(2026, 2, 20, 12, 0, 0));
    const t1 = new Date(Date.UTC(2026, 2, 20, 15, 0, 0));
    const p0 = subsolarPoint(t0);
    const p1 = subsolarPoint(t1);
    const d = ((p1.lonDeg - p0.lonDeg + 540) % 360) - 180;
    expect(d).toBeLessThan(-30);
  });
});

describe("solarElevationDeg", () => {
  it("is near +90 at the subsolar point and near -90 at the antipode", () => {
    const date = new Date(Date.UTC(2026, 2, 20, 12, 0, 0));
    const sub = subsolarPoint(date);
    expect(solarElevationDeg(date, sub.latDeg, sub.lonDeg)).toBeGreaterThan(85);
    expect(solarElevationDeg(date, -sub.latDeg, ((sub.lonDeg + 180 + 540) % 360) - 180)).toBeLessThan(-85);
  });

  it("is negative at night and positive at noon in Paris", () => {
    const midnight = new Date(Date.UTC(2026, 7, 4, 0, 0, 0));
    expect(solarElevationDeg(midnight, 48.8566, 2.3522)).toBeLessThan(-5);
    const noon = new Date(Date.UTC(2026, 7, 4, 12, 0, 0));
    expect(solarElevationDeg(noon, 48.8566, 2.3522)).toBeGreaterThan(10);
  });
});

describe("visibility", () => {
  const OBSERVER = { lat: 48.8566, lon: 2.3522, heightM: 0 };

  it("reports visible for a night-time sunlit pass", () => {
    const [iss] = parseTleBlock(ISS_BLOCK);
    const r = satelliteVisible(iss.satrec, OBSERVER, new Date("2026-08-19T03:47:00Z"));
    expect(r).toEqual({ visible: true, reason: "visible" });
  });

  it("reports daylight when the sun is up at the observer", () => {
    const [iss] = parseTleBlock(ISS_BLOCK);
    const r = satelliteVisible(iss.satrec, OBSERVER, new Date("2026-08-05T11:42:00Z"));
    expect(r.reason).toBe("daylight");
  });

  it("reports in-shadow when the satellite is in Earth's shadow", () => {
    const [iss] = parseTleBlock(ISS_BLOCK);
    const r = satelliteVisible(iss.satrec, OBSERVER, new Date("2026-08-25T02:09:00Z"));
    expect(r.reason).toBe("in-shadow");
  });

  it("reports below-horizon when the satellite is on the far side", () => {
    const [iss] = parseTleBlock(ISS_BLOCK);
    const r = satelliteVisible(iss.satrec, OBSERVER, new Date("2026-08-05T04:12:00Z"));
    expect(r.reason).toBe("below-horizon");
  });

  it("darkAtObserver uses the nautical-darkness threshold", () => {
    expect(darkAtObserver(new Date("2026-08-05T00:00:00Z"), 48.8566, 2.3522)).toBe(true);
  });
});
