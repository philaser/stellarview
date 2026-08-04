import { describe, it, expect } from "vitest";
import { parseBbox, Bbox } from "../src/bbox";

describe("parseBbox", () => {
  it("accepts a valid bbox string", () => {
    expect(parseBbox("-10,35,30,60")).toEqual({ minLon: -10, minLat: 35, maxLon: 30, maxLat: 60 });
  });

  it("rejects non-numeric input", () => {
    expect(() => parseBbox("abc")).toThrow();
  });

  it("rejects out-of-range coordinates", () => {
    expect(() => parseBbox("-200,0,0,0")).toThrow();
    expect(() => parseBbox("0,-100,0,0")).toThrow();
  });

  it("rejects inverted corners", () => {
    expect(() => parseBbox("30,35,-10,60")).toThrow();
  });

  it("rejects bboxes larger than 400 sq degrees", () => {
    expect(() => parseBbox("-179,-89,179,89")).toThrow();
  });
});
