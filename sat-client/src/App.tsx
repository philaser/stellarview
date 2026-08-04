import { useEffect, useMemo, useRef, useState } from "react";
import MapView, { type SatDot } from "./MapView";
import {
  annotate,
  CONSTELLATIONS,
  REGIME_COLORS,
  type CatalogSatellite,
  type Constellation,
  type Regime,
} from "./sat/catalog";
import { parseTleBlock } from "./sat/tle";
import { positionAt } from "./sat/propagate";
import { buildGroundTrack } from "./sat/groundTrack";
import { nextPasses, type ObserverPoint, type Pass } from "./sat/passes";
import { satelliteVisible } from "./sat/visibility";
import { nightPolygon } from "./sat/terminator";

const FALLBACK_OBSERVER: ObserverPoint = { lat: 48.8566, lon: 2.3522, heightM: 0 };

export default function App() {
  const [sats, setSats] = useState<CatalogSatellite[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [positions, setPositions] = useState<SatDot[]>([]);
  const [orbits, setOrbits] = useState<Record<number, [number, number][]>>({});
  const [selectedCatnr, setSelectedCatnr] = useState<number | null>(null);
  const selectedCatnrRef = useRef(selectedCatnr);
  selectedCatnrRef.current = selectedCatnr;
  const [observer, setObserver] = useState<ObserverPoint | null>(null);
  const [passes, setPasses] = useState<Pass[] | null>(null);
  const [followCatnr, setFollowCatnr] = useState<number | null>(null);
  const [regimes, setRegimes] = useState<Set<Regime>>(new Set(["leo", "meo", "geo"]));
  const [constellations, setConstellations] = useState<Set<Constellation>>(new Set(CONSTELLATIONS));
  const [search, setSearch] = useState("");
  const [focus, setFocus] = useState<{ catnr: number; ts: number } | null>(null);
  const [night, setNight] = useState<[number, number][] | null>(null);
  const [showNight, setShowNight] = useState(true);

  useEffect(() => {
    const update = () => setNight(nightPolygon(new Date()));
    update();
    const interval = setInterval(update, 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/tle?group=active`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (cancelled) return;
        setSats(parseTleBlock(text).map(annotate));
      } catch {
        if (!cancelled) setLoadError(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleSats = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sats.filter(
      (s) =>
        regimes.has(s.regime) &&
        constellations.has(s.constellation) &&
        (q === "" || s.name.toLowerCase().includes(q) || String(s.catnr).includes(q))
    );
  }, [sats, regimes, constellations, search]);

  const regimeCounts = useMemo(() => {
    const counts: Record<Regime, number> = { leo: 0, meo: 0, geo: 0 };
    for (const s of sats) counts[s.regime] += 1;
    return counts;
  }, [sats]);

  const constellationCounts = useMemo(() => {
    const counts: Record<Constellation, number> = { starlink: 0, oneweb: 0, gps: 0, iridium: 0, other: 0 };
    for (const s of sats) counts[s.constellation] += 1;
    return counts;
  }, [sats]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q === "") return [];
    return sats
      .filter((s) => s.name.toLowerCase().includes(q) || String(s.catnr).includes(q))
      .slice(0, 20);
  }, [sats, search]);

  // Orbit data for the selected satellite only (ground tracks for the whole ~16k catalog would be prohibitive).
  useEffect(() => {
    const sat = sats.find((s) => s.catnr === selectedCatnr);
    if (!sat) return;
    setOrbits({ [sat.catnr]: buildGroundTrack(sat.satrec) });
  }, [sats, selectedCatnr]);

  useEffect(() => {
    if (selectedCatnr !== null && !visibleSats.some((s) => s.catnr === selectedCatnr)) {
      setSelectedCatnr(null);
    }
  }, [visibleSats, selectedCatnr]);

  useEffect(() => {
    const compute = () => {
      if (document.visibilityState !== "visible") return;
      const now = new Date();
      const next = visibleSats
        .map((s): SatDot | null => {
          try {
            const p = positionAt(s.satrec, now);
            return {
              catnr: s.catnr,
              lat: p.latDeg,
              lon: p.lonDeg,
              altKm: p.altKm,
              velocityKms: p.velocityKms,
              color: REGIME_COLORS[s.regime],
              selected: s.catnr === selectedCatnrRef.current,
            };
          } catch {
            return null;
          }
        })
        .filter((p): p is SatDot => p !== null);
      setPositions(next);
    };
    compute();
    const interval = setInterval(compute, 2000);
    return () => clearInterval(interval);
  }, [visibleSats]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setObserver(FALLBACK_OBSERVER);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setObserver(normalizeObserver(pos.coords.latitude, pos.coords.longitude)),
      () => setObserver(FALLBACK_OBSERVER)
    );
  }, []);

  useEffect(() => {
    if (selectedCatnr === null || observer === null) {
      setPasses(null);
      setFollowCatnr(null);
      return;
    }
    const sat = sats.find((s) => s.catnr === selectedCatnr);
    if (!sat) {
      setPasses(null);
      setFollowCatnr(null);
      return;
    }
    setPasses(nextPasses(sat.satrec, observer, 48));
  }, [selectedCatnr, observer, sats]);

  const selected = sats.find((s) => s.catnr === selectedCatnr) ?? null;
  const pos = positions.find((p) => p.catnr === selectedCatnr);
  const visibility = selected && observer ? satelliteVisible(selected.satrec, observer, new Date()) : null;

  const toggleRegime = (r: Regime) =>
    setRegimes((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  const toggleConstellation = (c: Constellation) =>
    setConstellations((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  const setAllRegimes = (on: boolean) => setRegimes(new Set(on ? (["leo", "meo", "geo"] as Regime[]) : []));
  const setAllConstellations = (on: boolean) => setConstellations(new Set(on ? CONSTELLATIONS : []));
  const selectFromResults = (catnr: number) => {
    setSelectedCatnr(catnr);
    setFocus({ catnr, ts: Date.now() });
  };
  const normalizeObserver = (lat: number, lon: number): ObserverPoint => ({
    lat,
    lon: ((lon + 180) % 360 + 360) % 360 - 180,
    heightM: 0,
  });

  return (
    <div className="app">
      <MapView
        positions={positions}
        orbits={selected && orbits[selected.catnr] ? { [selected.catnr]: orbits[selected.catnr] } : {}}
        observer={observer ? { lat: observer.lat, lon: observer.lon } : null}
        onSelect={setSelectedCatnr}
        onSetObserver={(lat, lon) => setObserver(normalizeObserver(lat, lon))}
        followCatnr={followCatnr}
        focus={focus}
        night={showNight ? night : null}
      />
      <div className="controls">
        <div className="filter-group">
          <div className="filter-group-header">
            <span>Regime</span>
            <button aria-label="Regimes: All" onClick={() => setAllRegimes(true)}>All</button>
            <button aria-label="Regimes: None" onClick={() => setAllRegimes(false)}>None</button>
          </div>
          <div className="filter-row">
            {(["leo", "meo", "geo"] as Regime[]).map((r) => (
              <label key={r} style={{ color: REGIME_COLORS[r] }}>
                <input
                  type="checkbox"
                  aria-label={r.toUpperCase()}
                  checked={regimes.has(r)}
                  onChange={() => toggleRegime(r)}
                />
                {r.toUpperCase()} ({regimeCounts[r]})
              </label>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <div className="filter-group-header">
            <span>Constellation</span>
            <button aria-label="Constellations: All" onClick={() => setAllConstellations(true)}>All</button>
            <button aria-label="Constellations: None" onClick={() => setAllConstellations(false)}>None</button>
          </div>
          <div className="filter-row">
            {CONSTELLATIONS.map((c) => (
              <label key={c} style={{ textTransform: "capitalize" }}>
                <input
                  type="checkbox"
                  aria-label={c}
                  checked={constellations.has(c)}
                  onChange={() => toggleConstellation(c)}
                />
                {c} ({constellationCounts[c]})
              </label>
            ))}
          </div>
        </div>
        <input
          type="text"
          placeholder="Search satellites…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label style={{ color: "#e5e7eb" }}>
          <input
            type="checkbox"
            aria-label="Day/Night"
            checked={showNight}
            onChange={(e) => setShowNight(e.target.checked)}
          />
          Day/Night
        </label>
        <button onClick={() => window.location.reload()}>Reload TLEs</button>
      </div>
      {searchResults.length > 0 && (
        <div className="panel results-list">
          <h2>Results</h2>
          {searchResults.map((s) => (
            <button key={s.catnr} className="result-row" onClick={() => selectFromResults(s.catnr)}>
              {s.name} · {s.catnr}
            </button>
          ))}
          {searchResults.length === 20 && <div className="row"><span>… and more</span></div>}
        </div>
      )}
      {selected && observer && (
        <div className="panel">
          <h2>{selected.name}</h2>
          <div className="row"><span>Regime</span><span>{selected.regime.toUpperCase()}</span></div>
          <div className="row"><span>Constellation</span><span>{selected.constellation}</span></div>
          <div className="row"><span>NORAD id</span><span>{selected.catnr}</span></div>
          <div className="row"><span>Latitude</span><span>{pos ? `${pos.lat.toFixed(2)}°` : "…"}</span></div>
          <div className="row"><span>Longitude</span><span>{pos ? `${pos.lon.toFixed(2)}°` : "…"}</span></div>
          <div className="row"><span>Altitude</span><span>{pos ? `${pos.altKm.toFixed(0)} km` : "…"}</span></div>
          <div className="row"><span>Speed</span><span>{pos ? `${pos.velocityKms?.toFixed(2)} km/s` : "…"}</span></div>
          <div className="row"><span>Period</span><span>{Math.round(selected.periodS / 60)} min</span></div>
          <div className="row"><span>Inclination</span><span>{selected.inclinationDeg.toFixed(1)}°</span></div>
          <div className="row"><span>Next passes (48h)</span><span>{passes ? passes.length : "…"}</span></div>
          <div className="row"><span>Visible now</span><span>{visibility ? (visibility.visible ? "Yes" : `No — ${visibility.reason}`) : "…"}</span></div>
          <button onClick={() => setSelectedCatnr(null)}>Close</button>
          <button onClick={() => setFollowCatnr(followCatnr === selected.catnr ? null : selected.catnr)}>
            {followCatnr === selected.catnr ? "Following" : "Follow"}
          </button>
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
          {sats.length.toLocaleString()} satellites loaded · {visibleSats.length.toLocaleString()} shown
        </div>
      )}
    </div>
  );
}
