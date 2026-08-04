import { describe, it, expect } from "vitest";
import { tileXY, bucketClusters } from "../src/sat/cluster";

describe("tileXY", () => {
  it("places lon -180/180 at the tile edges and the equator at the middle", () => {
    expect(tileXY(0, -180, 0)).toEqual({ x: 0, y: 0.5 });
    expect(tileXY(0, 180, 0)).toEqual({ x: 1, y: 0.5 });
    expect(tileXY(0, 0, 1)).toEqual({ x: 1, y: 1 });
  });

  it("is monotonic in latitude and longitude", () => {
    const a = tileXY(10, 10, 4);
    const b = tileXY(11, 11, 4);
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.y).toBeLessThan(a.y); // y grows northward in tile space
  });
});

describe("bucketClusters", () => {
  it("buckets nearby points together and preserves the total count", () => {
    const points = [
      { lon: 0, lat: 0 },
      { lon: 0.01, lat: 0 },
      { lon: 0.02, lat: 0 },
      { lon: 40, lat: 40 },
    ];
    const clusters = bucketClusters(points, 2);
    expect(clusters.reduce((s, c) => s + c.count, 0)).toBe(4);
    expect(clusters.length).toBeLessThanOrEqual(2);
    const big = clusters.find((c) => c.count === 3);
    expect(big).toBeDefined();
    expect(Math.abs(big!.lon)).toBeLessThan(0.1);
  });

  it("produces finer clusters at higher zoom", () => {
    const points = Array.from({ length: 100 }, (_, i) => ({ lon: (i % 10) * 1, lat: Math.floor(i / 10) * 1 }));
    const low = bucketClusters(points, 1);
    const high = bucketClusters(points, 6);
    expect(high.length).toBeGreaterThan(low.length);
  });
});
