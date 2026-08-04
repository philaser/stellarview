import type { Bbox } from "../bbox";
import type { FlightState } from "../types";

export interface FlightProvider {
  name: string;
  fetchStates(bbox: Bbox): Promise<FlightState[]>;
}
