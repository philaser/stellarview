import type { Bbox } from "../bbox";
import type { FlightState, FlightTrack } from "../types";

export interface FlightProvider {
  name: string;
  fetchStates(bbox: Bbox): Promise<FlightState[]>;
}

export interface TrackSource {
  fetchTrack(icao24: string): Promise<FlightTrack | null>;
}
