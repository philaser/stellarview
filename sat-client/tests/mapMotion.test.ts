import { describe, expect, it } from "vitest";
import { MapMotion } from "../src/mapMotion";
const dot = (catnr: number, lon: number) => ({ catnr, lon, lat: 0, altKm: 400 });
describe("MapMotion", () => {
  it("takes the short path across the antimeridian", () => {
    const motion = new MapMotion();
    motion.update([dot(1, 179)], 0);
    motion.update([dot(1, -179)], 2000);
    expect(motion.sample(3000)[0].lon).toBe(-180);
    expect(motion.sample(4000)[0].lon).toBe(-179);
  });
  it("preserves motion through selection, reordering, and filtering", () => {
    const motion = new MapMotion();
    motion.update([dot(1, 0), dot(2, 20)], 0);
    motion.update([dot(2, 22), dot(1, 2)], 2000);
    motion.update([{ ...dot(1, 2), selected: true }, dot(3, 40)], 2500);
    expect(motion.sample(3000)).toEqual([{ ...dot(1, 1), selected: true }, dot(3, 40)]);
  });
  it("starts an interrupted glide at the displayed position and clamps late frames", () => {
    const motion = new MapMotion();
    motion.update([dot(1, 0)], 0);
    motion.update([dot(1, 2)], 2000);
    motion.update([dot(1, 4)], 3000);
    expect(motion.sample(3000)[0].lon).toBe(1);
    expect(motion.sample(4000)[0].lon).toBe(2.5);
    expect(motion.sample(10000)[0].lon).toBe(4);
    motion.update([dot(1, 100)], 11000, true);
    expect(motion.sample(11000)[0].lon).toBe(100);
  });
});
