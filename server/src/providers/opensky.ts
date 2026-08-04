import type { Bbox } from "../bbox";
import type { FlightState, FlightTrack } from "../types";
import type { FlightProvider, TrackSource } from "./flight-provider";
import type { TokenManager } from "./token";

// OpenSky state vector array positions (documented in their REST API)
const IDX = {
  icao24: 0,
  callsign: 1,
  originCountry: 2,
  timePosition: 3,
  lastContact: 4,
  longitude: 5,
  latitude: 6,
  baroAltitude: 7,
  onGround: 8,
  velocity: 9,
  trueTrack: 10,
  verticalRate: 11,
  sensors: 12,
  geoAltitude: 13,
  squawk: 14,
  spi: 15,
  positionSource: 16,
} as const;

export const FRESH_POSITION_WINDOW_S = 60;

export class OpenSkyProvider implements FlightProvider, TrackSource {
  name = "opensky";

  constructor(
    private opts: { baseUrl: string },
    private tokenManager: TokenManager | null = null
  ) {}

  async fetchStates(bbox: Bbox): Promise<FlightState[]> {
    const params = new URLSearchParams({
      lamin: String(bbox.minLat),
      lomin: String(bbox.minLon),
      lamax: String(bbox.maxLat),
      lomax: String(bbox.maxLon),
    });
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.tokenManager) {
      headers.Authorization = `Bearer ${await this.tokenManager.getToken()}`;
    }
    const res = await fetch(`${this.opts.baseUrl}/states/all?${params}`, { headers });
    if (!res.ok) {
      const error = new Error(`OpenSky responded ${res.status}`) as Error & {
        status?: number;
        retryAfter?: string | null;
      };
      error.status = res.status;
      error.retryAfter = res.headers.get("X-Rate-Limit-Retry-After-Seconds");
      throw error;
    }
    const body = (await res.json()) as { states: unknown[] };
    const now = Math.floor(Date.now() / 1000);
    return body.states
      .filter((s) => Array.isArray(s))
      .map((s) => s as (number | string | boolean | null)[])
      .filter((s) => {
        const timePosition = s[IDX.timePosition];
        return typeof timePosition === "number" && now - timePosition <= FRESH_POSITION_WINDOW_S;
      })
      .map((s) => this.toFlightState(s));
  }

  private toFlightState(s: (number | string | boolean | null)[]): FlightState {
    const callsign = typeof s[IDX.callsign] === "string" ? (s[IDX.callsign] as string).trim() : null;
    return {
      icao24: String(s[IDX.icao24]),
      callsign: callsign || null,
      originCountry: String(s[IDX.originCountry]),
      lat: typeof s[IDX.latitude] === "number" ? (s[IDX.latitude] as number) : null,
      lon: typeof s[IDX.longitude] === "number" ? (s[IDX.longitude] as number) : null,
      altitudeBaro: typeof s[IDX.baroAltitude] === "number" ? (s[IDX.baroAltitude] as number) : null,
      altitudeGeo: typeof s[IDX.geoAltitude] === "number" ? (s[IDX.geoAltitude] as number) : null,
      velocity: typeof s[IDX.velocity] === "number" ? (s[IDX.velocity] as number) : null,
      heading: typeof s[IDX.trueTrack] === "number" ? (s[IDX.trueTrack] as number) : null,
      verticalRate: typeof s[IDX.verticalRate] === "number" ? (s[IDX.verticalRate] as number) : null,
      squawk: typeof s[IDX.squawk] === "string" ? (s[IDX.squawk] as string) : null,
      positionSource: typeof s[IDX.positionSource] === "number" ? (s[IDX.positionSource] as number) : null,
      onGround: s[IDX.onGround] === true,
      lastContact: typeof s[IDX.lastContact] === "number" ? (s[IDX.lastContact] as number) : 0,
    };
  }

  async fetchTrack(icao24: string, now: number): Promise<FlightTrack | null> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.tokenManager) {
      headers.Authorization = `Bearer ${await this.tokenManager.getToken()}`;
    }
    const res = await fetch(`${this.opts.baseUrl}/tracks/${icao24}?time=${now}`, { headers });
    if (res.status === 404) return null;
    if (!res.ok) {
      const error = new Error(`OpenSky responded ${res.status}`) as Error & {
        status?: number;
        retryAfter?: string | null;
      };
      error.status = res.status;
      error.retryAfter = res.headers.get("X-Rate-Limit-Retry-After-Seconds");
      throw error;
    }
    const body = (await res.json()) as {
      icao24: string;
      callsign: string | null;
      path: unknown[];
    };
    const points = body.path
      .filter((p) => Array.isArray(p))
      .map((p) => p as (number | boolean | null)[])
      .filter((p) => p.length >= 4)
      .map((p) => ({
        t: Number(p[0]),
        lat: Number(p[1]),
        lon: Number(p[2]),
        altBaro: typeof p[3] === "number" ? p[3] : null,
      }));
    return {
      icao24: body.icao24,
      callsign: body.callsign ? body.callsign.trim() : null,
      points,
    };
  }
}
