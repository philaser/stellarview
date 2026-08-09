import { useEffect, useMemo, useRef, useState } from "react";
import MapView, { type SatDot } from "./MapView";
import GlobeView from "./GlobeView";
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
  const [filterMode, setFilterMode] = useState<"orbit" | "type">("orbit");
  const [search, setSearch] = useState("");
  const [focus, setFocus] = useState<{ catnr: number; ts: number } | null>(null);
  const [night, setNight] = useState<[number, number][] | null>(null);
  const [showNight, setShowNight] = useState(true);
  const [controlsOpen, setControlsOpen] = useState(true);
  const [mode, setMode] = useState<"2d" | "3d">("3d");
  const [locked, setLocked] = useState(false);

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
        (filterMode === "orbit" ? regimes.has(s.regime) : constellations.has(s.constellation)) &&
        (q === "" || s.name.toLowerCase().includes(q) || String(s.catnr).includes(q))
    );
  }, [sats, regimes, constellations, filterMode, search]);

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

  const satNames = useMemo(() => Object.fromEntries(sats.map((s) => [s.catnr, s.name])), [sats]);

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
      {mode === "2d" ? (
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
      ) : (
        <GlobeView
          positions={positions}
          satNames={satNames}
          selectedOrbit={selected && orbits[selected.catnr] ? orbits[selected.catnr] : null}
          selectedCatnr={selectedCatnr}
          showNight={showNight}
          locked={locked}
          onSelect={setSelectedCatnr}
        />
      )}
      <div className="dock">
        <button
          className={`dock-item gear-button ${controlsOpen ? "active" : ""}`}
          aria-label="Toggle filters"
          title="Filters"
          onClick={() => setControlsOpen((o) => !o)}
        >
          ⚙
        </button>
        <button
          className="dock-item"
          aria-label="Toggle 3D mode"
          title={mode === "2d" ? "Show 3D globe" : "Show 2D map"}
          onClick={() => setMode((m) => (m === "2d" ? "3d" : "2d"))}
        >
          {mode === "2d" ? "3D mode" : "2D mode"}
        </button>
        <button
          className={`dock-item ${showNight ? "active" : ""}`}
          aria-label="Day/Night"
          aria-pressed={showNight}
          title="Day/Night shading"
          onClick={() => setShowNight((s) => !s)}
        >
          ☀
        </button>
        <input
          className="dock-item dock-search"
          placeholder="Search satellites…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className={`controls ${controlsOpen ? "open" : "closed"}`}>
        <div className="controls-header">
          <span className="controls-title">Filters</span>
          <button className="reload-btn" onClick={() => window.location.reload()}>Reload TLEs</button>
        </div>
        <div className="segmented" data-mode={filterMode} role="radiogroup" aria-label="Filter mode">
          <span className="seg-thumb" aria-hidden="true" />
          <button
            className="seg-btn"
            role="radio"
            aria-label="Filter by orbit"
            aria-checked={filterMode === "orbit"}
            onClick={() => setFilterMode("orbit")}
          >
            Orbit
          </button>
          <button
            className="seg-btn"
            role="radio"
            aria-label="Filter by type"
            aria-checked={filterMode === "type"}
            onClick={() => setFilterMode("type")}
          >
            Type
          </button>
        </div>
        {filterMode === "orbit" ? (
          <section className="filter-section">
            <div className="section-header">
              <span className="section-title">Orbit type</span>
              <span className="section-actions">
                <button aria-label="Regimes: All" onClick={() => setAllRegimes(true)}>All</button>
                <button aria-label="Regimes: None" onClick={() => setAllRegimes(false)}>None</button>
              </span>
            </div>
            <div className="chip-row">
              {(["leo", "meo", "geo"] as Regime[]).map((r) => (
                <label key={r} className={`chip ${regimes.has(r) ? "checked" : ""}`}>
                  <input
                    type="checkbox"
                    aria-label={r.toUpperCase()}
                    checked={regimes.has(r)}
                    onChange={() => toggleRegime(r)}
                  />
                  <span className="chip-label" style={{ color: REGIME_COLORS[r] }}>{r.toUpperCase()}</span>
                  <span className="chip-count">{regimeCounts[r]}</span>
                </label>
              ))}
            </div>
          </section>
        ) : (
          <section className="filter-section">
            <div className="section-header">
              <span className="section-title">Constellation</span>
              <span className="section-actions">
                <button aria-label="Constellations: All" onClick={() => setAllConstellations(true)}>All</button>
                <button aria-label="Constellations: None" onClick={() => setAllConstellations(false)}>None</button>
              </span>
            </div>
            <div className="chip-row">
              {CONSTELLATIONS.map((c) => (
                <label key={c} className={`chip ${constellations.has(c) ? "checked" : ""}`}>
                  <input
                    type="checkbox"
                    aria-label={c}
                    checked={constellations.has(c)}
                    onChange={() => toggleConstellation(c)}
                  />
                  <span className="chip-label" style={{ textTransform: "capitalize" }}>{c}</span>
                  <span className="chip-count">{constellationCounts[c]}</span>
                </label>
              ))}
            </div>
          </section>
        )}
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
        <div className="panel sat-panel">
          <div className="panel-header">
            <div className="panel-title">
              <span className="status-dot" style={{ background: REGIME_COLORS[selected.regime] }} />
              <h2>{selected.name}</h2>
            </div>
            <button className="panel-close" aria-label="Close" title="Close" onClick={() => setSelectedCatnr(null)}>×</button>
          </div>
          <div className="sat-rows">
            <div className="row"><span>Regime</span><span>{selected.regime.toUpperCase()}</span></div>
            <div className="row"><span>Constellation</span><span>{selected.constellation}</span></div>
            <div className="row"><span>NORAD id</span><span>{selected.catnr}</span></div>
            <div className="row"><span>Latitude</span><span>{pos ? `${pos.lat.toFixed(2)}°` : "…"}</span></div>
            <div className="row"><span>Longitude</span><span>{pos ? `${pos.lon.toFixed(2)}°` : "…"}</span></div>
            <div className="row"><span>Altitude</span><span>{pos ? `${pos.altKm.toFixed(0)} km` : "…"}</span></div>
            <div className="row"><span>Speed</span><span>{pos ? `${pos.velocityKms?.toFixed(2)} km/s` : "…"}</span></div>
            <div className="row"><span>Period</span><span>{Math.round(selected.periodS / 60)} min</span></div>
            <div className="row"><span>Inclination</span><span>{selected.inclinationDeg.toFixed(1)}°</span></div>
            <div className="row"><span>Visible now</span>
              <span className={visibility?.visible ? "val-ok" : "val-warn"}>
                {visibility ? (visibility.visible ? "Yes" : `No — ${visibility.reason}`) : "…"}
              </span>
            </div>
          </div>
          <div className="panel-actions">
            <button
              className={`action-btn ${followCatnr === selected.catnr ? "active" : ""}`}
              onClick={() => setFollowCatnr(followCatnr === selected.catnr ? null : selected.catnr)}
            >
              {followCatnr === selected.catnr ? "Following" : "Follow"}
            </button>
            <button
              className={`action-btn ${locked ? "active" : ""}`}
              onClick={() => setLocked((l) => !l)}
            >
              {locked ? "Unlock" : "Lock"}
            </button>
          </div>
          {passes && passes.length > 0 && (
            <div className="passes">
              <div className="section-title">Next passes</div>
              <div className="passes-list">
                {passes.map((p, i) => (
                  <div key={i} className="pass-row">
                    <span className="pass-time">{p.start.toLocaleTimeString()}</span>
                    <span className="pass-bar-track">
                      <span className="pass-bar" style={{ width: `${Math.min(100, (p.maxElevationDeg / 90) * 100)}%` }} />
                    </span>
                    <span className="pass-elev">{p.maxElevationDeg.toFixed(0)}°</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {observer && (
        <div className="observer-label">
          Observer: {observer.lat.toFixed(2)}, {observer.lon.toFixed(2)} — click map to change
        </div>
      )}
      {loadError && <div className="banner banner-error">TLE provider unreachable</div>}
      {!loadError && (
        <div className="banner count-pill">
          {sats.length.toLocaleString()} satellites loaded · {visibleSats.length.toLocaleString()} shown
        </div>
      )}
    </div>
  );
}
