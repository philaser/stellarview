export interface ClusterInput {
  lon: number;
  lat: number;
}

export interface Cluster {
  lon: number; // centroid
  lat: number;
  count: number;
  cellX: number;
  cellY: number;
}

const CELL_SIZE_TILES = 0.25;

export function tileXY(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const latRad = (lat * Math.PI) / 180;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

export function bucketClusters(points: ClusterInput[], zoom: number, cellSize = CELL_SIZE_TILES): Cluster[] {
  const cells = new Map<string, { x: number; y: number; sumLon: number; sumLat: number; count: number }>();
  for (const p of points) {
    const t = tileXY(p.lat, p.lon, zoom);
    const cx = Math.floor(t.x / cellSize);
    const cy = Math.floor(t.y / cellSize);
    const key = `${cx},${cy}`;
    const cell = cells.get(key);
    if (cell) {
      cell.sumLon += p.lon;
      cell.sumLat += p.lat;
      cell.count += 1;
    } else {
      cells.set(key, { x: cx, y: cy, sumLon: p.lon, sumLat: p.lat, count: 1 });
    }
  }
  return [...cells.values()].map((c) => ({
    lon: c.sumLon / c.count,
    lat: c.sumLat / c.count,
    count: c.count,
    cellX: c.x,
    cellY: c.y,
  }));
}
