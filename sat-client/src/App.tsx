import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  IconAdjustmentsHorizontal,
  IconClock,
  IconCurrentLocation,
  IconEye,
  IconLock,
  IconLockOpen,
  IconMap2,
  IconMoonStars,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
  IconSatellite,
  IconSearch,
  IconSun,
  IconTarget,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import type { SatDot } from "./MapView";
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
import { useSimulationClock } from "./useSimulationClock";

const FALLBACK_OBSERVER: ObserverPoint = { lat: 48.8566, lon: 2.3522, heightM: 0 };
const MapView = lazy(() => import("./MapView"));

interface CatalogStatus {
  loading: boolean;
  error: boolean;
  fetchedAt: number | null;
  source: string | null;
  cache: string | null;
}

const normalizeObserver = (lat: number, lon: number): ObserverPoint => ({
  lat,
  lon: ((lon + 180) % 360 + 360) % 360 - 180,
  heightM: 0,
});

function formatCatalogAge(fetchedAt: number | null): string {
  if (fetchedAt === null) return "Awaiting catalog";
  const minutes = Math.max(0, Math.floor((Date.now() - fetchedAt) / 60_000));
  if (minutes < 1) return "Updated now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `Updated ${hours}h ago`;
}

function catalogSourceLabel(source: string | null, cache: string | null): string {
  if (source === "disk") return "DISK FALLBACK";
  if (cache === "hit") return "CACHE HIT";
  return "CELESTRAK";
}

export default function App() {
  const [sats, setSats] = useState<CatalogSatellite[]>([]);
  const [catalog, setCatalog] = useState<CatalogStatus>({
    loading: true,
    error: false,
    fetchedAt: null,
    source: null,
    cache: null,
  });
  const [positions, setPositions] = useState<SatDot[]>([]);
  const [orbits, setOrbits] = useState<Record<number, [number, number][]>>({});
  const [selectedCatnr, setSelectedCatnr] = useState<number | null>(null);
  const [observer, setObserver] = useState<ObserverPoint | null>(null);
  const [passes, setPasses] = useState<Pass[] | null>(null);
  const [followCatnr, setFollowCatnr] = useState<number | null>(null);
  const [regimes, setRegimes] = useState<Set<Regime>>(new Set(["leo", "meo", "geo"]));
  const [constellations, setConstellations] = useState<Set<Constellation>>(new Set(CONSTELLATIONS));
  const [filterMode, setFilterMode] = useState<"orbit" | "type">("orbit");
  const [search, setSearch] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [focus, setFocus] = useState<{ catnr: number; ts: number } | null>(null);
  const [showNight, setShowNight] = useState(true);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [mode, setMode] = useState<"2d" | "3d">("3d");
  const [locked, setLocked] = useState(false);
  const simulation = useSimulationClock();

  const loadCatalog = useCallback(async () => {
    setCatalog((current) => ({ ...current, loading: true, error: false }));
    try {
      const res = await fetch("/api/tle?group=active");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const next = parseTleBlock(text).map(annotate);
      const getHeader = (name: string) => res.headers?.get?.(name) ?? null;
      const fetchedHeader = Number(getHeader("X-TLE-Fetched-At"));
      setSats(next);
      setCatalog({
        loading: false,
        error: false,
        fetchedAt: Number.isFinite(fetchedHeader) && fetchedHeader > 0 ? fetchedHeader : Date.now(),
        source: getHeader("X-TLE-Source") ?? "upstream",
        cache: getHeader("X-TLE-Cache"),
      });
    } catch {
      setCatalog((current) => ({ ...current, loading: false, error: true }));
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const positionTimeMs = Math.floor(simulation.time.getTime() / 2_000) * 2_000;
  const positionTime = useMemo(() => new Date(positionTimeMs), [positionTimeMs]);
  const orbitTimeMs = Math.floor(simulation.time.getTime() / 60_000) * 60_000;
  const orbitTime = useMemo(() => new Date(orbitTimeMs), [orbitTimeMs]);
  const passTimeMs = Math.floor(simulation.time.getTime() / 300_000) * 300_000;
  const passTime = useMemo(() => new Date(passTimeMs), [passTimeMs]);
  const night = useMemo(() => nightPolygon(orbitTime), [orbitTime]);

  const visibleSats = useMemo(
    () =>
      sats.filter((s) =>
        filterMode === "orbit" ? regimes.has(s.regime) : constellations.has(s.constellation)
      ),
    [sats, regimes, constellations, filterMode]
  );

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

  useEffect(() => {
    setSearchIndex(0);
  }, [search]);

  const satNames = useMemo(() => Object.fromEntries(sats.map((s) => [s.catnr, s.name])), [sats]);

  useEffect(() => {
    const sat = sats.find((s) => s.catnr === selectedCatnr);
    if (!sat) {
      setOrbits({});
      return;
    }
    setOrbits({ [sat.catnr]: buildGroundTrack(sat.satrec, 120, orbitTime) });
  }, [sats, selectedCatnr, orbitTime]);

  useEffect(() => {
    if (selectedCatnr !== null && !visibleSats.some((s) => s.catnr === selectedCatnr)) {
      setSelectedCatnr(null);
      setFollowCatnr(null);
      setLocked(false);
    }
  }, [visibleSats, selectedCatnr]);

  useEffect(() => {
    if (document.visibilityState !== "visible") return;
    const next = visibleSats
      .map((s): SatDot | null => {
        try {
          const p = positionAt(s.satrec, positionTime);
          return {
            catnr: s.catnr,
            lat: p.latDeg,
            lon: p.lonDeg,
            altKm: p.altKm,
            velocityKms: p.velocityKms,
            color: REGIME_COLORS[s.regime],
            selected: s.catnr === selectedCatnr,
          };
        } catch {
          return null;
        }
      })
      .filter((p): p is SatDot => p !== null);
    setPositions(next);
  }, [visibleSats, selectedCatnr, positionTime]);

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
    setPasses(nextPasses(sat.satrec, observer, 48, 60, 5, passTime));
  }, [selectedCatnr, observer, sats, passTime]);

  const selected = sats.find((s) => s.catnr === selectedCatnr) ?? null;
  const pos = positions.find((p) => p.catnr === selectedCatnr);
  const visibility = selected && observer
    ? satelliteVisible(selected.satrec, observer, simulation.time)
    : null;

  const toggleRegime = (regime: Regime) =>
    setRegimes((previous) => {
      const next = new Set(previous);
      if (next.has(regime)) next.delete(regime);
      else next.add(regime);
      return next;
    });

  const toggleConstellation = (constellation: Constellation) =>
    setConstellations((previous) => {
      const next = new Set(previous);
      if (next.has(constellation)) next.delete(constellation);
      else next.add(constellation);
      return next;
    });

  const selectSatellite = (catnr: number) => {
    setSelectedCatnr(catnr);
    setFocus({ catnr, ts: Date.now() });
    setSearch("");
    setControlsOpen(false);
  };

  const closeSelection = () => {
    setSelectedCatnr(null);
    setFollowCatnr(null);
    setLocked(false);
  };

  const openControls = () => {
    setSearch("");
    setControlsOpen((open) => !open);
  };

  const handleSearchKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (searchResults.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSearchIndex((index) => (index + 1) % searchResults.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSearchIndex((index) => (index - 1 + searchResults.length) % searchResults.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectSatellite(searchResults[searchIndex].catnr);
    } else if (event.key === "Escape") {
      setSearch("");
    }
  };

  const catalogState = catalog.error
    ? sats.length > 0 ? "STALE" : "OFFLINE"
    : catalog.loading ? "SYNCING" : "FRESH";
  const utcTime = simulation.time.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
  });
  const utcDate = simulation.time.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="app">
      <Suspense fallback={<div className="map-loading">Loading map renderer…</div>}>
        {mode === "2d" ? (
          <MapView
            positions={positions}
            orbits={selected && orbits[selected.catnr] ? { [selected.catnr]: orbits[selected.catnr] } : {}}
            observer={observer ? { lat: observer.lat, lon: observer.lon } : null}
            onSelect={selectSatellite}
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
            followCatnr={followCatnr}
            focus={focus}
            showNight={showNight}
            locked={locked}
            onSelect={selectSatellite}
          />
        )}
      </Suspense>

      <header className="mission-hud" aria-label="Satellite tracking status">
        <div className="brand-lockup">
          <span className="brand-mark"><IconSatellite size={18} stroke={1.8} /></span>
          <span>
            <strong>ORBITAL VIEW</strong>
            <small>ACTIVE SATELLITE NETWORK</small>
          </span>
        </div>
        <div className={`catalog-state state-${catalogState.toLowerCase()}`}>
          <span className="live-dot" aria-hidden="true" />
          <span>
            <strong>{catalogState}</strong>
            <small>{formatCatalogAge(catalog.fetchedAt)} · {catalogSourceLabel(catalog.source, catalog.cache)}</small>
          </span>
        </div>
      </header>

      <div className="time-hud" aria-live="polite">
        <IconClock size={16} stroke={1.8} />
        <span>
          <strong>{utcTime} UTC</strong>
          <small>{utcDate}</small>
        </span>
        <span className={`time-mode ${simulation.mode}`}>{simulation.mode === "live" ? "LIVE" : "PAUSED"}</span>
      </div>

      <div className="dock" aria-label="Map controls">
        <button
          className={`dock-item icon-button ${controlsOpen ? "active" : ""}`}
          aria-label="Toggle filters"
          aria-expanded={controlsOpen}
          title="Filters"
          onClick={openControls}
        >
          <IconAdjustmentsHorizontal size={19} stroke={1.8} />
        </button>
        <button
          className="dock-item icon-button"
          aria-label={mode === "2d" ? "Show 3D globe" : "Show 2D map"}
          title={mode === "2d" ? "Show 3D globe" : "Show 2D map"}
          onClick={() => setMode((current) => (current === "2d" ? "3d" : "2d"))}
        >
          {mode === "2d" ? <IconWorld size={19} stroke={1.8} /> : <IconMap2 size={19} stroke={1.8} />}
        </button>
        <span className="dock-divider" aria-hidden="true" />
        <button
          className={`dock-item simulation-button ${simulation.mode === "paused" ? "active" : ""}`}
          aria-label={simulation.mode === "live" ? "Pause simulation" : "Resume live simulation"}
          title={simulation.mode === "live" ? "Pause simulation" : "Resume live simulation"}
          onClick={simulation.mode === "live" ? simulation.pause : simulation.resume}
        >
          {simulation.mode === "live" ? <IconPlayerPause size={18} stroke={1.9} /> : <IconPlayerPlay size={18} stroke={1.9} />}
          <span>{simulation.mode === "live" ? "Pause" : "Resume"}</span>
        </button>
        <button
          className="dock-item icon-button"
          aria-label="Return to live time"
          title="Return to live time"
          onClick={simulation.reset}
        >
          <IconRefresh size={18} stroke={1.8} />
        </button>
        <button
          className={`dock-item icon-button ${showNight ? "active" : ""}`}
          aria-label="Day/Night"
          aria-pressed={showNight}
          title="Day and night lighting"
          onClick={() => setShowNight((shown) => !shown)}
        >
          {showNight ? <IconMoonStars size={18} stroke={1.8} /> : <IconSun size={18} stroke={1.8} />}
        </button>
        <label className="dock-search-wrap">
          <IconSearch size={17} stroke={1.8} aria-hidden="true" />
          <input
            className="dock-search"
            aria-label="Search satellites"
            aria-controls="satellite-results"
            aria-expanded={searchResults.length > 0}
            placeholder="Search name or NORAD ID"
            value={search}
            onFocus={() => setControlsOpen(false)}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={handleSearchKey}
          />
          {search !== "" && (
            <button type="button" className="search-clear" aria-label="Clear search" onClick={() => setSearch("")}>
              <IconX size={15} stroke={1.8} />
            </button>
          )}
        </label>
      </div>

      <section className={`controls ${controlsOpen ? "open" : "closed"}`} aria-label="Satellite filters">
        <div className="controls-header">
          <span>
            <strong className="controls-title">Display controls</strong>
            <small>{visibleSats.length.toLocaleString()} of {sats.length.toLocaleString()} satellites</small>
          </span>
          <div className="header-actions">
            <button
              className="control-icon"
              aria-label="Refresh satellite catalog"
              title="Refresh satellite catalog"
              disabled={catalog.loading}
              onClick={() => void loadCatalog()}
            >
              <IconRefresh className={catalog.loading ? "spinning" : ""} size={17} stroke={1.8} />
            </button>
            <button className="control-icon" aria-label="Close filters" title="Close filters" onClick={() => setControlsOpen(false)}>
              <IconX size={17} stroke={1.8} />
            </button>
          </div>
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
            Orbit class
          </button>
          <button
            className="seg-btn"
            role="radio"
            aria-label="Filter by type"
            aria-checked={filterMode === "type"}
            onClick={() => setFilterMode("type")}
          >
            Network
          </button>
        </div>
        {filterMode === "orbit" ? (
          <section className="filter-section">
            <div className="section-header">
              <span className="section-title">Orbital regime</span>
              <span className="section-actions">
                <button aria-label="Regimes: All" onClick={() => setRegimes(new Set(["leo", "meo", "geo"]))}>All</button>
                <button aria-label="Regimes: None" onClick={() => setRegimes(new Set())}>None</button>
              </span>
            </div>
            <div className="chip-row">
              {(["leo", "meo", "geo"] as Regime[]).map((regime) => (
                <label key={regime} className={`chip ${regimes.has(regime) ? "checked" : ""}`}>
                  <input
                    type="checkbox"
                    aria-label={regime.toUpperCase()}
                    checked={regimes.has(regime)}
                    onChange={() => toggleRegime(regime)}
                  />
                  <span className="chip-swatch" style={{ background: REGIME_COLORS[regime] }} />
                  <span className="chip-label">{regime.toUpperCase()}</span>
                  <span className="chip-count">{regimeCounts[regime]}</span>
                </label>
              ))}
            </div>
          </section>
        ) : (
          <section className="filter-section">
            <div className="section-header">
              <span className="section-title">Satellite network</span>
              <span className="section-actions">
                <button aria-label="Constellations: All" onClick={() => setConstellations(new Set(CONSTELLATIONS))}>All</button>
                <button aria-label="Constellations: None" onClick={() => setConstellations(new Set())}>None</button>
              </span>
            </div>
            <div className="chip-row">
              {CONSTELLATIONS.map((constellation) => (
                <label key={constellation} className={`chip ${constellations.has(constellation) ? "checked" : ""}`}>
                  <input
                    type="checkbox"
                    aria-label={constellation}
                    checked={constellations.has(constellation)}
                    onChange={() => toggleConstellation(constellation)}
                  />
                  <span className="chip-label constellation-label">{constellation}</span>
                  <span className="chip-count">{constellationCounts[constellation]}</span>
                </label>
              ))}
            </div>
          </section>
        )}
      </section>

      {searchResults.length > 0 && !controlsOpen && (
        <section id="satellite-results" className="panel results-list" aria-label="Satellite search results">
          <div className="panel-kicker">Search results</div>
          {searchResults.map((satellite, index) => (
            <button
              key={satellite.catnr}
              className={`result-row ${index === searchIndex ? "active" : ""}`}
              onMouseEnter={() => setSearchIndex(index)}
              onClick={() => selectSatellite(satellite.catnr)}
            >
              <span className="result-icon"><IconSatellite size={16} stroke={1.8} /></span>
              <span><strong>{satellite.name}</strong><small>NORAD {satellite.catnr} · {satellite.regime.toUpperCase()}</small></span>
              <IconTarget size={16} stroke={1.7} />
            </button>
          ))}
          {searchResults.length === 20 && <div className="results-more">Refine your search to see more</div>}
        </section>
      )}

      {selected && observer && !controlsOpen && searchResults.length === 0 && (
        <section className="panel sat-panel" aria-label={`${selected.name} details`}>
          <div className="panel-header">
            <div className="panel-title">
              <span className="status-dot" style={{ background: REGIME_COLORS[selected.regime] }} />
              <span>
                <span className="panel-kicker">Tracked object</span>
                <h2>{selected.name}</h2>
              </span>
            </div>
            <button className="panel-close" aria-label="Close" title="Close" onClick={closeSelection}>
              <IconX size={17} stroke={1.8} />
            </button>
          </div>
          <div className="position-readout">
            <div><small>LAT</small><strong>{pos ? `${pos.lat.toFixed(2)}°` : "…"}</strong></div>
            <div><small>LON</small><strong>{pos ? `${pos.lon.toFixed(2)}°` : "…"}</strong></div>
            <div><small>ALT</small><strong>{pos ? `${pos.altKm.toFixed(0)} km` : "…"}</strong></div>
          </div>
          <div className="sat-rows">
            <div className="row"><span>Orbit class</span><span>{selected.regime.toUpperCase()}</span></div>
            <div className="row"><span>Network</span><span className="constellation-label">{selected.constellation}</span></div>
            <div className="row"><span>NORAD ID</span><span>{selected.catnr}</span></div>
            <div className="row"><span>Velocity</span><span>{pos ? `${pos.velocityKms?.toFixed(2)} km/s` : "…"}</span></div>
            <div className="row"><span>Period</span><span>{Math.round(selected.periodS / 60)} min</span></div>
            <div className="row"><span>Inclination</span><span>{selected.inclinationDeg.toFixed(1)}°</span></div>
            <div className="row"><span>Visible now</span>
              <span className={visibility?.visible ? "val-ok" : "val-warn"}>
                {visibility ? (visibility.visible ? "Yes" : `No · ${visibility.reason}`) : "…"}
              </span>
            </div>
          </div>
          <div className="panel-actions">
            <button className="action-btn" onClick={() => setFocus({ catnr: selected.catnr, ts: Date.now() })}>
              <IconTarget size={16} stroke={1.8} /> Focus
            </button>
            <button
              className={`action-btn ${followCatnr === selected.catnr ? "active" : ""}`}
              onClick={() => setFollowCatnr(followCatnr === selected.catnr ? null : selected.catnr)}
            >
              <IconCurrentLocation size={16} stroke={1.8} /> {followCatnr === selected.catnr ? "Following" : "Follow"}
            </button>
            <button className={`action-btn ${locked ? "active" : ""}`} onClick={() => setLocked((value) => !value)}>
              {locked ? <IconLockOpen size={16} stroke={1.8} /> : <IconLock size={16} stroke={1.8} />}
              {locked ? "Unlock" : "Lock"}
            </button>
          </div>
          {passes && passes.length > 0 && (
            <div className="passes">
              <div className="section-title"><IconEye size={14} stroke={1.8} /> Strongest upcoming passes</div>
              <div className="passes-list">
                {passes.slice(0, 5).map((pass, index) => (
                  <div key={index} className="pass-row">
                    <span className="pass-time">{pass.start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="pass-bar-track">
                      <span className="pass-bar" style={{ width: `${Math.min(100, (pass.maxElevationDeg / 90) * 100)}%` }} />
                    </span>
                    <span className="pass-elev">{pass.maxElevationDeg.toFixed(0)}°</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {observer && (
        <div className="observer-label">
          <IconCurrentLocation size={14} stroke={1.8} />
          <span>{observer.lat.toFixed(2)}, {observer.lon.toFixed(2)}</span>
          <small>{mode === "2d" ? "Click map to relocate" : "Observer location"}</small>
        </div>
      )}

      <div className="count-pill" aria-live="polite">
        <span className="count-value">{visibleSats.length.toLocaleString()}</span>
        <span>shown</span>
        <span className="count-separator">/</span>
        <span>{sats.length.toLocaleString()} loaded</span>
      </div>

      {catalog.loading && sats.length === 0 && (
        <div className="banner loading-banner"><IconSatellite size={17} stroke={1.8} /> Loading orbital catalog…</div>
      )}
      {catalog.error && (
        <div className="banner banner-error">
          <span>TLE provider unreachable{!sats.length ? " — no catalog available" : " — showing last catalog"}</span>
          <button onClick={() => void loadCatalog()}>Retry</button>
        </div>
      )}
    </div>
  );
}
