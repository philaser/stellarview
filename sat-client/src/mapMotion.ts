import type { SatDot } from "./MapView";

const DURATION_MS = 2000;
const longitudeDelta = (from: number, to: number) => ((to - from + 540) % 360) - 180;
type Track = { from: SatDot; to: SatDot; started: number };

export class MapMotion {
  private tracks = new Map<number, Track>();

  update(positions: SatDot[], now: number, snap = false) {
    const next = new Map<number, Track>();
    for (const to of positions) {
      const old = this.tracks.get(to.catnr);
      if (old && !snap && old.to.lon === to.lon && old.to.lat === to.lat) {
        next.set(to.catnr, { ...old, to });
      } else {
        const from = old && !snap ? this.interpolate(old, now) : to;
        next.set(to.catnr, { from, to, started: now });
      }
    }
    this.tracks = next;
  }

  moving(now: number): boolean {
    return Array.from(this.tracks.values()).some(({ from, to, started }) =>
      now < started + DURATION_MS && (from.lon !== to.lon || from.lat !== to.lat));
  }

  sample(now: number): SatDot[] {
    return Array.from(this.tracks.values(), (track) => this.interpolate(track, now));
  }

  private interpolate({ from, to, started }: Track, now: number): SatDot {
    const t = Math.max(0, Math.min(1, (now - started) / DURATION_MS));
    const lon = from.lon + longitudeDelta(from.lon, to.lon) * t;
    return { ...to, lon: ((lon + 540) % 360) - 180, lat: from.lat + (to.lat - from.lat) * t };
  }
}
