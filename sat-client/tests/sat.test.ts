import { describe, it, expect } from "vitest";
import { parseTleBlock } from "../src/sat/tle";
import { positionAt } from "../src/sat/propagate";
import { buildGroundTrack } from "../src/sat/groundTrack";
import { nextPasses } from "../src/sat/passes";

const ISS_LINE1 = "1 25544U 98067A   26215.79638706  .00007444  00000+0  14146-3 0  9999";
const ISS_LINE2 = "2 25544  51.6316  64.4821 0007224   9.2337 350.8783 15.49332738579132";
const ISS_BLOCK = `ISS (ZARYA)\n${ISS_LINE1}\n${ISS_LINE2}\n`;

describe("parseTleBlock", () => {
  it("parses name, period and inclination from a TLE block", () => {
    const sats = parseTleBlock(ISS_BLOCK);
    expect(sats).toHaveLength(1);
    const s = sats[0];
    expect(s.name).toBe("ISS (ZARYA)");
    expect(s.catnr).toBe(25544);
    expect(s.periodS).toBeGreaterThan(5500);
    expect(s.periodS).toBeLessThan(5600);
    expect(s.inclinationDeg).toBeCloseTo(51.6316, 3);
  });
});

describe("positionAt", () => {
  it("returns a deterministic lat/lon/altitude for a fixed date", () => {
    const [iss] = parseTleBlock(ISS_BLOCK);
    const pos = positionAt(iss.satrec, new Date(Date.UTC(2026, 7, 4, 12, 0, 0)));
    expect(pos.latDeg).toBeGreaterThan(-90);
    expect(pos.latDeg).toBeLessThan(90);
    expect(pos.lonDeg).toBeGreaterThan(-180);
    expect(pos.lonDeg).toBeLessThan(180);
    expect(pos.altKm).toBeGreaterThan(300);
    expect(pos.altKm).toBeLessThan(600);
    expect(pos.velocityKms).toBeGreaterThan(7);
    expect(pos.velocityKms).toBeLessThan(8);
  });

  it("returns a different position at a later time", () => {
    const [iss] = parseTleBlock(ISS_BLOCK);
    const t0 = new Date(Date.UTC(2026, 7, 4, 12, 0, 0));
    const t1 = new Date(Date.UTC(2026, 7, 4, 12, 10, 0));
    const p0 = positionAt(iss.satrec, t0);
    const p1 = positionAt(iss.satrec, t1);
    expect(Math.abs(p1.lonDeg - p0.lonDeg)).toBeGreaterThan(1);
  });
});

describe("buildGroundTrack", () => {
  it("produces one orbit of points spanning ~one period", () => {
    const [iss] = parseTleBlock(ISS_BLOCK);
    const track = buildGroundTrack(iss.satrec, 120);
    expect(track).toHaveLength(120);
    for (const [lon, lat] of track) {
      // unwrapped longitudes may legitimately exceed ±180
      expect(Math.abs(lon)).toBeLessThan(540);
      expect(lat).toBeGreaterThan(-90);
      expect(lat).toBeLessThan(90);
    }
  });

  it("unwraps longitudes so the track never jumps the antimeridian", () => {
    const [iss] = parseTleBlock(ISS_BLOCK);
    const track = buildGroundTrack(iss.satrec, 120);
    for (let i = 1; i < track.length; i++) {
      expect(Math.abs(track[i][0] - track[i - 1][0])).toBeLessThanOrEqual(180);
    }
  });
});

describe("nextPasses", () => {
  it("finds ISS passes over Paris in the next 48h, sorted by max elevation", () => {
    const [iss] = parseTleBlock(ISS_BLOCK);
    const passes = nextPasses(iss.satrec, { lat: 48.8566, lon: 2.3522, heightM: 0 }, 48);
    expect(passes.length).toBeGreaterThan(0);
    for (const p of passes) {
      expect(p.start < p.peak && p.peak < p.end).toBe(true);
      expect(p.maxElevationDeg).toBeGreaterThanOrEqual(0);
    }
    for (let i = 1; i < passes.length; i++) {
      expect(passes[i - 1].maxElevationDeg).toBeGreaterThanOrEqual(passes[i].maxElevationDeg);
    }
  });
});
