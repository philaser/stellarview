export interface Bbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export const MAX_BBOX_AREA_SQ_DEG = 62_000;

export function parseBbox(input: string): Bbox {
  const parts = input.split(",").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) {
    throw new Error("bbox must be 4 comma-separated numbers: minLon,minLat,maxLon,maxLat");
  }
  const [minLon, minLat, maxLon, maxLat] = parts as [number, number, number, number];
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) {
    throw new Error("bbox coordinates out of range");
  }
  if (minLon >= maxLon || minLat >= maxLat) {
    throw new Error("bbox corners inverted: min must be less than max");
  }
  const area = Math.abs(maxLon - minLon) * Math.abs(maxLat - minLat);
  if (area > MAX_BBOX_AREA_SQ_DEG) {
    throw new Error(`bbox area ${area.toFixed(0)} sq deg exceeds max ${MAX_BBOX_AREA_SQ_DEG}`);
  }
  return { minLon, minLat, maxLon, maxLat };
}
