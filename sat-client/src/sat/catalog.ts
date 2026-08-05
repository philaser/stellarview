import type { TleSatellite } from "./tle";

export type Regime = "leo" | "meo" | "geo";
export type Constellation = "starlink" | "oneweb" | "gps" | "iridium" | "other";

export const REGIME_COLORS: Record<Regime, string> = {
  leo: "#00e5ff", // bright cyan
  meo: "#c77dff", // bright violet
  geo: "#ffd166", // bright amber
};

const LEO_MAX_S = 128 * 60;
const MEO_MAX_S = 1000 * 60;

export function classifyRegime(periodS: number): Regime {
  if (periodS < LEO_MAX_S) return "leo";
  if (periodS < MEO_MAX_S) return "meo";
  return "geo";
}

export function classifyConstellation(name: string): Constellation {
  const n = name.toUpperCase();
  if (n.startsWith("STARLINK-")) return "starlink";
  if (n.startsWith("ONEWEB-")) return "oneweb";
  if (n.startsWith("GPS") || n.startsWith("NAVSTAR")) return "gps";
  if (n.startsWith("IRIDIUM")) return "iridium";
  return "other";
}

export interface CatalogSatellite extends TleSatellite {
  regime: Regime;
  constellation: Constellation;
}

export function annotate(sat: TleSatellite): CatalogSatellite {
  return {
    ...sat,
    regime: classifyRegime(sat.periodS),
    constellation: classifyConstellation(sat.name),
  };
}

export const CONSTELLATIONS: Constellation[] = ["starlink", "oneweb", "gps", "iridium", "other"];
