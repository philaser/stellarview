export interface FlightState {
  icao24: string;
  callsign: string | null;
  originCountry: string;
  lat: number | null;
  lon: number | null;
  altitudeBaro: number | null;
  altitudeGeo: number | null;
  velocity: number | null;
  heading: number | null;
  verticalRate: number | null;
  squawk: string | null;
  positionSource: number | null;
  onGround: boolean;
  lastContact: number;
}

export interface FlightsResponse {
  flights: FlightState[];
  stale: boolean;
  rateLimited: boolean;
  fetchedAt: number;
}

export interface TrackPoint {
  t: number;
  lat: number;
  lon: number;
  altBaro: number | null;
}

export interface FlightTrack {
  icao24: string;
  callsign: string | null;
  points: TrackPoint[];
}

export interface TrackResponse {
  track: FlightTrack | null;
  stale: boolean;
  rateLimited: boolean;
}
