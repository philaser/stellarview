import { useCallback, useEffect, useState } from "react";
import MapView from "./MapView";
import type { FlightsResponse, FlightState } from "../../server/src/types";

const REGIONS = {
  europe: { name: "Europe", bounds: [-10, 35, 30, 60] as [number, number, number, number] },
  us: { name: "Continental US", bounds: [-125, 24, -66, 50] as [number, number, number, number] },
  global: { name: "Global", bounds: [-180, -85, 180, 85] as [number, number, number, number] },
};

export default function App() {
  const [region, setRegion] = useState<keyof typeof REGIONS>("europe");
  const [flights, setFlights] = useState<FlightState[]>([]);
  const [selected, setSelected] = useState<FlightState | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const [stale, setStale] = useState(false);

  const applyResponse = useCallback((body: FlightsResponse) => {
    setFlights(body.flights);
    setLastUpdated(body.fetchedAt);
    setRateLimited(Boolean(body.rateLimited));
    setStale(Boolean(body.stale));
  }, []);

  const pollOnce = useCallback(() => {
    const b = REGIONS[region].bounds;
    return fetch(`/api/flights?bbox=${b.join(",")}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body) => applyResponse(body))
      .catch(() => setStale(true));
  }, [region, applyResponse]);

  const pollNow = useCallback(() => {
    return pollOnce();
  }, [pollOnce]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = () => {
      void pollOnce().then(() => {
        if (!cancelled && document.visibilityState === "visible") timer = setTimeout(poll, 20_000);
      });
    };

    poll();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void pollOnce();
      else clearTimeout(timer);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [region, applyResponse, pollOnce]);

  const changeRegion = useCallback((key: string) => setRegion(key as keyof typeof REGIONS), []);

  return (
    <div className="app">
      <MapView bounds={REGIONS[region].bounds} flights={flights} track={null} onSelect={setSelected} />
      <div className="controls">
        <select value={region} onChange={(e) => changeRegion(e.target.value)}>
          {Object.entries(REGIONS).map(([key, r]) => (
            <option key={key} value={key}>
              {r.name}
            </option>
          ))}
        </select>
        <button onClick={() => void pollNow()}>Refresh now</button>
      </div>
      {selected && (
        <div className="panel">
          <h2>{selected.callsign ?? selected.icao24}</h2>
          <div className="row"><span>Origin country</span><span>{selected.originCountry}</span></div>
          <div className="row"><span>Altitude (baro)</span><span>{selected.altitudeBaro ?? "—"} m</span></div>
          <div className="row"><span>Ground speed</span><span>{selected.velocity != null ? Math.round(selected.velocity * 3.6) : "—"} km/h</span></div>
          <div className="row"><span>Heading</span><span>{selected.heading != null ? `${Math.round(selected.heading)}°` : "—"}</span></div>
          <div className="row"><span>Vertical rate</span><span>{selected.verticalRate ?? "—"} m/s</span></div>
          <div className="row"><span>On ground</span><span>{selected.onGround ? "yes" : "no"}</span></div>
          <div className="row"><span>Last contact</span><span>{new Date(selected.lastContact * 1000).toLocaleTimeString()}</span></div>
          <div className="row"><span>Altitude (geo)</span><span>{selected.altitudeGeo ?? "—"} m</span></div>
          <div className="row"><span>Squawk</span><span>{selected.squawk ?? "—"}</span></div>
          <div className="row"><span>Position source</span><span>{selected.positionSource != null ? String(selected.positionSource) : "—"}</span></div>
          <button onClick={() => setSelected(null)}>Close</button>
        </div>
      )}
      {(rateLimited || stale) && (
        <div className="banner">
          {rateLimited ? "Rate limited — showing cached data" : "Stale data — provider unreachable"}
        </div>
      )}
      {lastUpdated && (
        <div className="banner" style={{ bottom: "52px", background: "#111827" }}>
          Updated {Math.round((Date.now() - lastUpdated) / 1000)}s ago
        </div>
      )}
    </div>
  );
}
