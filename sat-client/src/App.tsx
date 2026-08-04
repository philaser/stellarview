import { useEffect, useState } from "react";
import MapView, { type SatDot } from "./MapView";
import { SAT_CONFIG, CATNR_LIST } from "./config";
import { parseTleBlock, type TleSatellite } from "./sat/tle";
import { positionAt } from "./sat/propagate";
import { buildGroundTrack } from "./sat/groundTrack";
import { nextPasses, type ObserverPoint, type Pass } from "./sat/passes";

const FALLBACK_OBSERVER: ObserverPoint = { lat: 48.8566, lon: 2.3522, heightM: 0 };

export default function App() {
  const [sats, setSats] = useState<TleSatellite[]>([]);
  const [configCount] = useState(SAT_CONFIG.length);
  const [loadError, setLoadError] = useState(false);
  const [positions, setPositions] = useState<SatDot[]>([]);
  const [orbits, setOrbits] = useState<Record<number, [number, number][]>>({});
  const [selectedCatnr, setSelectedCatnr] = useState<number | null>(null);
  const [observer, setObserver] = useState<ObserverPoint | null>(null);
  const [passes, setPasses] = useState<Pass[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/tle?catnr=${CATNR_LIST}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (cancelled) return;
        const wanted = new Set(SAT_CONFIG.map((c) => c.catnr));
        const kept = parseTleBlock(text).filter((s) => wanted.has(s.catnr));
        setSats(kept);
        setOrbits(
          Object.fromEntries(kept.map((s): [number, [number, number][]] => [s.catnr, buildGroundTrack(s.satrec)]))
        );
      } catch {
        if (!cancelled) setLoadError(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (sats.length === 0) return;
      const now = new Date();
      const next = sats
        .map((s): SatDot | null => {
          try {
            const p = positionAt(s.satrec, now);
            const cfg = SAT_CONFIG.find((c) => c.catnr === s.catnr);
            return {
              catnr: s.catnr,
              lat: p.latDeg,
              lon: p.lonDeg,
              altKm: p.altKm,
              velocityKms: p.velocityKms,
              color: cfg?.color,
            };
          } catch {
            // positionAt throws on SGP4 error; skip this satellite this tick.
            return null;
          }
        })
        .filter((p): p is SatDot => p !== null);
      setPositions(next);
    }, 1000);
    return () => clearInterval(interval);
  }, [sats]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setObserver(FALLBACK_OBSERVER);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setObserver({ lat: pos.coords.latitude, lon: pos.coords.longitude, heightM: 0 }),
      () => setObserver(FALLBACK_OBSERVER)
    );
  }, []);

  useEffect(() => {
    if (selectedCatnr === null || observer === null) {
      setPasses(null);
      return;
    }
    const sat = sats.find((s) => s.catnr === selectedCatnr);
    if (!sat) {
      setPasses(null);
      return;
    }
    setPasses(nextPasses(sat.satrec, observer, 48));
  }, [selectedCatnr, observer, sats]);

  const selected = sats.find((s) => s.catnr === selectedCatnr) ?? null;
  const pos = positions.find((p) => p.catnr === selectedCatnr);

  return (
    <div className="app">
      <MapView
        positions={positions}
        orbits={orbits}
        observer={observer ? { lat: observer.lat, lon: observer.lon } : null}
        onSelect={setSelectedCatnr}
        onSetObserver={(lat, lon) => setObserver({ lat, lon, heightM: 0 })}
      />
      <div className="controls">
        <button onClick={() => window.location.reload()}>Reload TLEs</button>
      </div>
      {selected && observer && (
        <div className="panel">
          <h2>{selected.name}</h2>
          <div className="row"><span>Category</span><span>{SAT_CONFIG.find((c) => c.catnr === selected.catnr)?.category}</span></div>
          <div className="row"><span>NORAD id</span><span>{selected.catnr}</span></div>
          <div className="row"><span>Latitude</span><span>{pos ? `${pos.lat.toFixed(2)}°` : "…"}</span></div>
          <div className="row"><span>Longitude</span><span>{pos ? `${pos.lon.toFixed(2)}°` : "…"}</span></div>
          <div className="row"><span>Altitude</span><span>{pos ? `${pos.altKm.toFixed(0)} km` : "…"}</span></div>
          <div className="row"><span>Speed</span><span>{pos ? `${pos.velocityKms?.toFixed(2)} km/s` : "…"}</span></div>
          <div className="row"><span>Period</span><span>{Math.round(selected.periodS / 60)} min</span></div>
          <div className="row"><span>Inclination</span><span>{selected.inclinationDeg.toFixed(1)}°</span></div>
          <div className="row"><span>Next passes (48h)</span><span>{passes ? passes.length : "…"}</span></div>
          <button onClick={() => setSelectedCatnr(null)}>Close</button>
        </div>
      )}
      {selected && observer && passes && passes.length > 0 && (
        <div className="panel pass-list" style={{ top: "320px" }}>
          <h2>Next passes</h2>
          {passes.map((p, i) => (
            <div key={i} className="row">
              <span>{p.start.toLocaleTimeString()}</span>
              <span>{p.maxElevationDeg.toFixed(0)}°</span>
            </div>
          ))}
        </div>
      )}
      {observer && (
        <div className="observer-label">
          Observer: {observer.lat.toFixed(2)}, {observer.lon.toFixed(2)} — click map to change
        </div>
      )}
      {loadError && <div className="banner">TLE provider unreachable</div>}
      {!loadError && (
        <div className="banner" style={{ background: "#111827" }}>
          {sats.length}/{configCount} satellites loaded
        </div>
      )}
    </div>
  );
}
