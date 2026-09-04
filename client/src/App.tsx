import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconPlane, IconX } from "@tabler/icons-react";
import MapView from "./MapView";
import type { FlightsResponse, FlightState, FlightTrack } from "../../server/src/types";

const REGIONS = {
  europe: { name: "Europe", bounds: [-10, 35, 30, 60] as [number, number, number, number] },
  us: { name: "Continental US", bounds: [-125, 24, -66, 50] as [number, number, number, number] },
  global: { name: "Global", bounds: [-180, -85, 180, 85] as [number, number, number, number] },
};
const POLL_INTERVAL_MS = 20_000;

function formatAltitude(value: number | null) {
  return value == null ? "—" : `${Math.round(value).toLocaleString()} m`;
}
function formatSpeed(value: number | null) {
  return value == null ? "—" : `${Math.round(value * 3.6)} km/h`;
}

export default function App() {
  const [region, setRegion] = useState<keyof typeof REGIONS>("europe");
  const [flights, setFlights] = useState<FlightState[]>([]);
  const [selectedIcao, setSelectedIcao] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const [track, setTrack] = useState<FlightTrack | null>(null);
  const [trackRateLimited, setTrackRateLimited] = useState(false);
  const [now, setNow] = useState(Date.now());
  const requestVersion = useRef(0);
  const pollNowRef = useRef<(() => void) | null>(null);

  const selected = useMemo(
    () => flights.find((flight) => flight.icao24 === selectedIcao) ?? null,
    [flights, selectedIcao]
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleFlights = useMemo(
    () => normalizedQuery
      ? flights.filter((flight) => flight.icao24.toLowerCase().includes(normalizedQuery) || flight.callsign?.trim().toLowerCase().includes(normalizedQuery))
      : flights,
    [flights, normalizedQuery]
  );
  const searchResults = visibleFlights.slice(0, 8);
  const applyResponse = useCallback((body: FlightsResponse) => {
    setFlights(body.flights);
    setLastUpdated(body.fetchedAt);
    setRateLimited(Boolean(body.rateLimited));
    setStale(Boolean(body.stale));
    setLoadError(false);
  }, []);
  const selectFlight = useCallback((icao24: string | null) => {
    setSelectedIcao(icao24);
    if (icao24) setQuery("");
  }, []);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    };
    const schedule = () => {
      clearTimer();
      if (!disposed && document.visibilityState === "visible") timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };
    const poll = async () => {
      if (disposed || document.visibilityState !== "visible") return;
      controller?.abort();
      controller = new AbortController();
      const currentController = controller;
      const version = ++requestVersion.current;
      setLoading(true);
      try {
        const bounds = REGIONS[region].bounds;
        const response = await fetch(`/api/flights?bbox=${bounds.join(",")}`, { signal: currentController.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as FlightsResponse;
        if (!disposed && version === requestVersion.current) applyResponse(body);
      } catch (error) {
        const isAbort = error instanceof DOMException && error.name === "AbortError";
        if (!disposed && version === requestVersion.current && !isAbort) {
          setLoadError(true);
          setStale(true);
        }
      } finally {
        if (!disposed && version === requestVersion.current) {
          setLoading(false);
          schedule();
        }
      }
    };
    const onVisibility = () => {
      clearTimer();
      if (document.visibilityState === "visible") void poll();
      else {
        controller?.abort();
        requestVersion.current += 1;
        setLoading(false);
      }
    };
    pollNowRef.current = () => {
      clearTimer();
      void poll();
    };
    void poll();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      clearTimer();
      controller?.abort();
      requestVersion.current += 1;
      document.removeEventListener("visibilitychange", onVisibility);
      pollNowRef.current = null;
    };
  }, [region, applyResponse]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!selected?.icao24) {
      setTrack(null);
      setTrackRateLimited(false);
      return;
    }
    let disposed = false;
    const controller = new AbortController();
    const selectedId = selected.icao24;
    setTrack(null);
    setTrackRateLimited(false);
    const loadTrack = async () => {
      try {
        const response = await fetch(`/api/track?icao24=${selectedId}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        if (!disposed) {
          setTrack(body.track);
          setTrackRateLimited(Boolean(body.rateLimited));
        }
      } catch (error) {
        const isAbort = error instanceof DOMException && error.name === "AbortError";
        if (!disposed && !isAbort) {
          setTrack(null);
          setTrackRateLimited(false);
        }
      }
    };
    void loadTrack();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void loadTrack();
    }, 60_000);
    return () => {
      disposed = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [selected?.icao24]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (query) setQuery("");
      else setSelectedIcao(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [query]);

  const changeRegion = useCallback((key: string) => {
    setRegion(key as keyof typeof REGIONS);
    setFlights([]);
    setLastUpdated(null);
    setSelectedIcao(null);
    setLoadError(false);
  }, []);
  const selectedMissing = selectedIcao !== null && selected === null && !loading;
  const freshness = lastUpdated ? `${Math.max(0, Math.round((now - lastUpdated) / 1000))}s ago` : "Awaiting data";

  return <div className="app">
    <MapView bounds={REGIONS[region].bounds} flights={visibleFlights} selectedIcao={selectedIcao} track={track} onSelect={(flight) => selectFlight(flight?.icao24 ?? null)} />
    <header className="header"><div className="brand"><IconPlane aria-hidden="true" size={18} /> Flight tracker</div><div className="freshness" aria-live="polite">{loading ? "Updating…" : `Updated ${freshness}`}</div></header>
    <div className="controls">
      <label className="sr-only" htmlFor="region">Region</label>
      <select id="region" value={region} onChange={(event) => changeRegion(event.target.value)}>{Object.entries(REGIONS).map(([key, item]) => <option key={key} value={key}>{item.name}</option>)}</select>
      <label className="search"><span className="sr-only">Search callsign or ICAO</span><input type="search" placeholder="Search flight" value={query} onChange={(event) => { setQuery(event.target.value); setActiveResultIndex(0); }} onKeyDown={(event) => {
        if (event.key === "ArrowDown" && searchResults.length) { event.preventDefault(); setActiveResultIndex((index) => Math.min(index + 1, searchResults.length - 1)); }
        if (event.key === "ArrowUp" && searchResults.length) { event.preventDefault(); setActiveResultIndex((index) => Math.max(index - 1, 0)); }
        if (event.key === "Enter" && searchResults.length) { event.preventDefault(); selectFlight(searchResults[activeResultIndex]?.icao24 ?? searchResults[0].icao24); }
      }} /></label>
      <button onClick={() => pollNowRef.current?.()} disabled={loading}>Refresh</button>
    </div>
    {normalizedQuery && searchResults.length > 0 && <div className="search-results" role="listbox" aria-label="Aircraft search results">
      {searchResults.map((flight, index) => <button key={flight.icao24} role="option" aria-selected={index === activeResultIndex} className={index === activeResultIndex ? "active" : ""} onClick={() => selectFlight(flight.icao24)}><span><strong>{flight.callsign?.trim() || flight.icao24.toUpperCase()}</strong><small>{flight.icao24.toUpperCase()}</small></span><small>{formatAltitude(flight.altitudeBaro)}</small></button>)}
    </div>}
    <aside className="legend" aria-label="Altitude legend"><strong>Altitude</strong><span><i className="low" />Under 3 km</span><span><i className="mid" />3–7 km</span><span><i className="high" />Over 7 km</span></aside>
    <div className={`map-status ${selected || selectedMissing ? "selection-open" : ""}`} aria-live="polite">
      {loading && flights.length === 0 && "Loading aircraft…"}
      {!loading && loadError && flights.length === 0 && "Unable to load aircraft for this region."}
      {!loading && !loadError && flights.length === 0 && "No aircraft reported in this region."}
      {!loading && flights.length > 0 && normalizedQuery && visibleFlights.length === 0 && `No aircraft match “${query.trim()}” in this region.`}
      {!loading && visibleFlights.length > 0 && (normalizedQuery ? `${visibleFlights.length} of ${flights.length} aircraft shown` : `${flights.length} aircraft in ${REGIONS[region].name}`)}
    </div>
    {selected && <aside className="panel" aria-label="Aircraft details">
      <div className="panel-heading"><div><p>Aircraft</p><h2>{selected.callsign?.trim() || selected.icao24}</h2><span>{selected.icao24.toUpperCase()} · {selected.originCountry}</span></div><button className="close" aria-label="Close details" onClick={() => setSelectedIcao(null)}><IconX aria-hidden="true" size={18} /></button></div>
      <div className="metrics"><div><span>Altitude</span><strong>{formatAltitude(selected.altitudeBaro)}</strong></div><div><span>Ground speed</span><strong>{formatSpeed(selected.velocity)}</strong></div><div><span>Heading</span><strong>{selected.heading == null ? "—" : `${Math.round(selected.heading)}°`}</strong></div></div>
      <div className="summary"><span>{selected.onGround ? "On ground" : "Airborne"}</span><span>Contact {new Date(selected.lastContact * 1000).toLocaleTimeString()}</span><span>{track ? `Track: ${track.points.length} points` : trackRateLimited ? "Track refresh paused" : "Track unavailable"}</span></div>
      <details><summary>Technical details</summary><div className="rows"><div><span>Geometric altitude</span><span>{formatAltitude(selected.altitudeGeo)}</span></div><div><span>Vertical rate</span><span>{selected.verticalRate == null ? "—" : `${selected.verticalRate} m/s`}</span></div><div><span>Squawk</span><span>{selected.squawk ?? "—"}</span></div><div><span>Position source</span><span>{selected.positionSource == null ? "—" : ["ADS-B", "ASTERIX", "MLAT", "FLARM"][selected.positionSource] ?? "Other"}</span></div></div></details>
    </aside>}
    {selectedMissing && <aside className="panel missing"><p>Aircraft unavailable</p><strong>{selectedIcao.toUpperCase()}</strong><span>This aircraft is no longer in the latest regional snapshot.</span><button onClick={() => setSelectedIcao(null)}>Close</button></aside>}
    {(rateLimited || stale) && <div className="banner">{rateLimited ? "Rate limited — showing cached data" : loadError ? "Provider unreachable — retrying automatically" : "Showing stale data"}</div>}
  </div>;
}
