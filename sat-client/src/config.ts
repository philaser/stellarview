export type SatCategory = "manned" | "science" | "comms" | "weather" | "geo";

export interface SatConfigEntry {
  catnr: number;
  category: SatCategory;
  color: string;
}

export const SAT_COLORS: Record<SatCategory, string> = {
  manned: "#f472b6",
  science: "#a78bfa",
  comms: "#38bdf8",
  weather: "#34d399",
  geo: "#fbbf24",
};

export const SAT_CONFIG: SatConfigEntry[] = [
  { catnr: 25544, category: "manned", color: SAT_COLORS.manned }, // ISS
  { catnr: 48274, category: "manned", color: SAT_COLORS.manned }, // Tiangong
  { catnr: 20580, category: "science", color: SAT_COLORS.science }, // Hubble
  { catnr: 25867, category: "science", color: SAT_COLORS.science }, // CXO (Chandra; TESS absent from CelesTrak)
  { catnr: 28654, category: "weather", color: SAT_COLORS.weather }, // NOAA-18
  { catnr: 33591, category: "weather", color: SAT_COLORS.weather }, // NOAA-19
  { catnr: 41866, category: "geo", color: SAT_COLORS.geo }, // GOES-16
  { catnr: 44714, category: "comms", color: SAT_COLORS.comms }, // Starlink-1008
  { catnr: 44718, category: "comms", color: SAT_COLORS.comms }, // Starlink-1012
  { catnr: 44723, category: "comms", color: SAT_COLORS.comms }, // Starlink-1017
  { catnr: 44725, category: "comms", color: SAT_COLORS.comms }, // Starlink-1020
  { catnr: 44741, category: "comms", color: SAT_COLORS.comms }, // Starlink-1036
];

export const CATNR_LIST = SAT_CONFIG.map((c) => c.catnr).join(",");
