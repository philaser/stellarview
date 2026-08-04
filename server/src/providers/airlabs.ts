import type { Bbox } from "../bbox";
import type { FlightState } from "../types";
import type { FlightProvider } from "./flight-provider";

interface AirLabsFlight {
  hex: string;
  flight_iata?: string | null;
  lat?: number | null;
  lng?: number | null;
  alt?: number | null;
  dir?: number | null;
  speed?: number | null;
  v_speed?: number | null;
  status?: string;
  updated?: number | null;
  flag?: string | null;
}

export class AirLabsProvider implements FlightProvider {
  name = "airlabs";

  constructor(private opts: { apiKey: string; baseUrl?: string }) {}

  async fetchStates(bbox: Bbox): Promise<FlightState[]> {
    const baseUrl = this.opts.baseUrl ?? "https://airlabs.co/api/v9";
    const params = new URLSearchParams({ api_key: this.opts.apiKey });
    // bbox appended literally: URLSearchParams would percent-encode the commas
    const res = await fetch(`${baseUrl}/flights?${params}&bbox=${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`);
    if (!res.ok) throw new Error(`AirLabs responded ${res.status}`);
    const body = (await res.json()) as { response: AirLabsFlight[] };

    return body.response
      .filter((f) => typeof f.lat === "number" && typeof f.lng === "number")
      .map((f) => ({
        icao24: f.hex,
        callsign: f.flight_iata || null,
        originCountry: f.flag || "",
        lat: f.lat ?? null,
        lon: f.lng ?? null,
        altitudeBaro: f.alt != null ? Math.round(f.alt * 0.3048) : null,
        altitudeGeo: null,
        velocity: f.speed != null ? f.speed / 3.6 : null,
        heading: f.dir ?? null,
        verticalRate: f.v_speed ?? null,
        squawk: null,
        positionSource: null,
        onGround: f.status === "ground",
        lastContact: f.updated ?? 0,
      }));
  }
}
