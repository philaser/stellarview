import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconAdjustmentsHorizontal,
  IconChevronDown,
  IconChevronUp,
  IconClock,
  IconCurrentLocation,
  IconEye,
  IconLock,
  IconLockOpen,
  IconMap2,
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

const FALLBACK_OBSERVER: ObserverPoint = { lat: 40.7128, lon: -74.0060, heightM: 0 };
const CATALOG_REFRESH_MS = 15 * 60_000;
const CATALOG_STALE_MS = 6 * 60 * 60_000;
const REQUEST_TIMEOUT_MS = 35_000;
const MapView = lazy(() => import("./MapView"));

interface CatalogStatus {
  loading: boolean;
  error: boolean;
  fetchedAt: number | null;
  source: string | null;
  stale: boolean;
}

type ObserverSource = "device" | "map" | "manual" | "reference";

const normalizeObserver = (lat: number, lon: number): ObserverPoint => ({
  lat,
  lon: ((lon + 180) % 360 + 360) % 360 - 180,
  heightM: 0,
});

function formatCatalogAge(fetchedAt: number | null, now: number): string {
  if (fetchedAt === null) return "Download time unknown";
  const minutes = Math.max(0, Math.floor((now - fetchedAt) / 60_000));
  if (minutes < 1) return "Downloaded now";
  if (minutes < 60) return `Downloaded ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `Downloaded ${hours}h ago`;
}

function formatElementEpoch(line1: string): string {
  const raw = line1.slice(18, 32).trim();
  const year = Number(raw.slice(0, 2));
  const day = Number(raw.slice(2));
  if (!Number.isFinite(year) || !Number.isFinite(day)) return "Unknown";
  const fullYear = year >= 57 ? 1900 + year : 2000 + year;
  const epoch = new Date(Date.UTC(fullYear, 0, 1) + (day - 1) * 86_400_000);
  return epoch.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  });
}

function catalogSourceLabel(source: string | null): string {
  if (source === "disk") return "SAVED CATALOG";
  return "CELESTRAK";
}

function formatPassTime(date: Date): string {
  return date.toLocaleString("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).toUpperCase();
}

export default function App() {
  const [sats, setSats] = useState<CatalogSatellite[]>([]);
  const [catalog, setCatalog] = useState<CatalogStatus>({
    loading: true,
    error: false,
    fetchedAt: null,
    source: null,
    stale: false,
  });
  const [positions, setPositions] = useState<SatDot[]>([]);
  const [orbits, setOrbits] = useState<Record<number, [number, number][]>>({});
  const [selectedCatnr, setSelectedCatnr] = useState<number | null>(null);
  const [observer, setObserver] = useState<ObserverPoint | null>(null);
  const [observerSource, setObserverSource] = useState<ObserverSource | null>(null);
  const [observerStatus, setObserverStatus] = useState<"idle" | "locating" | "ready" | "unavailable">("idle");
  const [observerError, setObserverError] = useState<string | null>(null);
  const [placingObserver, setPlacingObserver] = useState(false);
  const observerRequestRef = useRef(0);
  const observerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelObserverRequest = useCallback(() => {
    observerRequestRef.current += 1;
    if (observerTimerRef.current !== null) clearTimeout(observerTimerRef.current);
    observerTimerRef.current = null;
  }, []);
  useEffect(() => cancelObserverRequest, [cancelObserverRequest]);
  const [manualLat, setManualLat] = useState("");
  const [manualLon, setManualLon] = useState("");
  const [manualObserverError, setManualObserverError] = useState<string | null>(null);
  const [observerSetupOpen, setObserverSetupOpen] = useState(false);
  const [passes, setPasses] = useState<Pass[] | null>(null);
  const [followCatnr, setFollowCatnr] = useState<number | null>(null);
  const [regimes, setRegimes] = useState<Set<Regime>>(new Set(["leo", "meo", "geo"]));
  const [constellations, setConstellations] = useState<Set<Constellation>>(new Set(CONSTELLATIONS));
  const [filterMode, setFilterMode] = useState<"orbit" | "type">("orbit");
  const [search, setSearch] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [focus, setFocus] = useState<{ catnr: number; ts: number } | null>(null);
  const [showDaylight, setShowDaylight] = useState(true);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [mode, setMode] = useState<"2d" | "3d">("3d");
  const [locked, setLocked] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [revealMessage, setRevealMessage] = useState<string | null>(null);
  const [wallNow, setWallNow] = useState(() => Date.now());
  const searchRef = useRef<HTMLInputElement>(null);
  const filtersButtonRef = useRef<HTMLButtonElement>(null);
  const catalogRequestRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const detailsCloseRef = useRef<HTMLButtonElement>(null);
  const focusDetailsRef = useRef(false);
  const simulation = useSimulationClock();

  const loadCatalog = useCallback(async () => {
    if (catalogRequestRef.current) return;
    setCatalog((current) => ({ ...current, loading: true, error: false }));
    const controller = new AbortController();
    catalogRequestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch("/api/tle?group=active", { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const next = parseTleBlock(text).map(annotate);
      if (next.length === 0) throw new Error("Catalog contained no valid satellites");
      if (!mountedRef.current || catalogRequestRef.current !== controller) return;
      const getHeader = (name: string) => res.headers?.get?.(name) ?? null;
      const fetchedHeader = Number(getHeader("X-TLE-Fetched-At"));
      setSats(next);
      setCatalog({
        loading: false,
        error: false,
        fetchedAt: Number.isFinite(fetchedHeader) && fetchedHeader > 0 ? fetchedHeader : null,
        source: getHeader("X-TLE-Source") ?? "upstream",
        stale: getHeader("X-TLE-Stale") === "true",
      });
    } catch {
      if (mountedRef.current && catalogRequestRef.current === controller) {
        setCatalog((current) => ({ ...current, loading: false, error: true }));
      }
    } finally {
      window.clearTimeout(timeout);
      if (catalogRequestRef.current === controller) catalogRequestRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadCatalog();
    const refresh = window.setInterval(() => void loadCatalog(), CATALOG_REFRESH_MS);
    return () => {
      window.clearInterval(refresh);
      mountedRef.current = false;
      const activeRequest = catalogRequestRef.current;
      catalogRequestRef.current = null;
      activeRequest?.abort();
    };
  }, [loadCatalog]);

  useEffect(() => {
    const ageClock = window.setInterval(() => setWallNow(Date.now()), 60_000);
    return () => window.clearInterval(ageClock);
  }, []);

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

  const requestObserver = useCallback(() => {
    cancelObserverRequest();
    const request = observerRequestRef.current;
    setObserverError(null);
    const fail = (message: string) => {
      if (request !== observerRequestRef.current) return;
      cancelObserverRequest();
      setObserverStatus("unavailable");
      setObserverError(message);
    };
    if (window.isSecureContext === false) {
      fail("Device location requires HTTPS. Open the secure site, or choose on map.");
      return;
    }
    if (!navigator.geolocation) {
      fail("Device location is unavailable in this browser. Choose on map or enter coordinates.");
      return;
    }
    setObserverStatus("locating");
    observerTimerRef.current = setTimeout(() => fail("Location request timed out. Try again or choose on map."), 30_000);
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (request !== observerRequestRef.current) return;
          cancelObserverRequest();
          setObserver(normalizeObserver(pos.coords.latitude, pos.coords.longitude));
          setObserverSource("device");
          setObserverStatus("ready");
          setObserverSetupOpen(false);
        },
        (error) => fail(error.code === 1
          ? "Location access is blocked. Allow location for this website and enable device Location Services, or choose on map."
          : error.code === 3
            ? "Location request timed out. Try again or choose on map."
            : "Your device could not determine its location. Try again or choose on map."),
        { enableHighAccuracy: false, timeout: 20_000, maximumAge: 300_000 }
      );
    } catch {
      fail("Device location is unavailable. Choose on map or enter coordinates.");
    }
  }, [cancelObserverRequest]);

  useEffect(() => {
    if (selectedCatnr === null || observer === null) {
      setPasses(null);
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

  const selectSatellite = (catnr: number, moveFocusToDetails = false) => {
    const satellite = sats.find((candidate) => candidate.catnr === catnr);
    let revealed = false;
    if (satellite && filterMode === "orbit" && !regimes.has(satellite.regime)) {
      setRegimes((previous) => new Set(previous).add(satellite.regime));
      revealed = true;
    }
    if (satellite && filterMode === "type" && !constellations.has(satellite.constellation)) {
      setConstellations((previous) => new Set(previous).add(satellite.constellation));
      revealed = true;
    }
    setSelectedCatnr(catnr);
    setFocus({ catnr, ts: Date.now() });
    setDetailsExpanded(false);
    setObserverSetupOpen(false);
    setRevealMessage(revealed && satellite ? `Filters updated to show ${satellite.name}` : null);
    setSearch("");
    setControlsOpen(false);
    focusDetailsRef.current = moveFocusToDetails;
  };

  useEffect(() => {
    if (selectedCatnr !== null && focusDetailsRef.current) {
      detailsCloseRef.current?.focus();
      focusDetailsRef.current = false;
    }
  }, [selectedCatnr]);

  const closeSelection = () => {
    setSelectedCatnr(null);
    setFollowCatnr(null);
    setLocked(false);
    setDetailsExpanded(false);
    setRevealMessage(null);
  };

  const openControls = () => {
    setSearch("");
    setControlsOpen((open) => !open);
  };

  const closeSearch = () => {
    setSearch("");
    filtersButtonRef.current?.focus();
  };

  const handleSearchKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") return;
    if (searchResults.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSearchIndex((index) => (index + 1) % searchResults.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSearchIndex((index) => (index - 1 + searchResults.length) % searchResults.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectSatellite(searchResults[searchIndex].catnr, true);
    }
  };

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (placingObserver) {
        setPlacingObserver(false);
      } else if (search !== "") {
        closeSearch();
      } else if (controlsOpen) {
        setControlsOpen(false);
        filtersButtonRef.current?.focus();
      } else if (selectedCatnr !== null) {
        closeSelection();
        filtersButtonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [controlsOpen, search, selectedCatnr, placingObserver]);

  const setNamedObserver = (point: ObserverPoint, source: ObserverSource) => {
    cancelObserverRequest();
    setPlacingObserver(false);
    setObserverError(null);
    setObserver(normalizeObserver(point.lat, point.lon));
    setObserverSource(source);
    setObserverStatus("ready");
    setObserverSetupOpen(false);
    setManualObserverError(null);
  };

  const submitManualObserver = (event: React.FormEvent) => {
    event.preventDefault();
    if (manualLat.trim() === "" || manualLon.trim() === "") {
      setManualObserverError("Enter both latitude and longitude.");
      return;
    }
    const lat = Number(manualLat);
    const lon = Number(manualLon);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setManualObserverError("Latitude must be between -90 and 90 degrees.");
      return;
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      setManualObserverError("Longitude must be between -180 and 180 degrees.");
      return;
    }
    setNamedObserver({ lat, lon, heightM: 0 }, "manual");
  };

  const catalogTooOld = catalog.fetchedAt !== null && wallNow - catalog.fetchedAt >= CATALOG_STALE_MS;
  const catalogState = catalog.error || catalog.stale || catalogTooOld
    ? sats.length > 0 ? "STALE" : "OFFLINE"
    : catalog.loading ? "SYNCING" : catalog.fetchedAt === null ? "UNKNOWN" : catalog.source === "disk" ? "CACHED" : "FRESH";
  const catalogStateLabel = `CATALOG ${catalogState}`;
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
  const chronologicalPasses = passes
    ? [...passes].sort((first, second) => first.start.getTime() - second.start.getTime())
    : null;
  const observerName = observerSource === "device"
    ? "your location"
    : observerSource === "map"
      ? "map observer"
      : observerSource === "manual"
        ? "manual observer"
        : "New York reference";

  return (
    <div className={`app ${mode === "2d" ? "map-mode" : ""} ${selected && !placingObserver && !controlsOpen && search === "" ? "selection-open" : ""}`}>
      <div className="visualization-stage">
      <Suspense fallback={<div className="map-loading">Loading map renderer…</div>}>
        {mode === "2d" ? (
          <MapView
            positions={positions}
            satNames={satNames}
            locked={locked}
            orbits={selected && orbits[selected.catnr] ? { [selected.catnr]: orbits[selected.catnr] } : {}}
            observer={observer ? { lat: observer.lat, lon: observer.lon } : null}
            onSelect={selectSatellite}
            placingObserver={placingObserver}
            onSetObserver={(lat, lon) => setNamedObserver({ lat, lon, heightM: 0 }, "map")}
            followCatnr={followCatnr}
            focus={focus}
            night={showDaylight ? night : null}
            onStopFollow={() => setFollowCatnr(null)}
          />
        ) : (
          <GlobeView
            positions={positions}
            satNames={satNames}
            selectedOrbit={selected && orbits[selected.catnr] ? orbits[selected.catnr] : null}
            selectedCatnr={selectedCatnr}
            followCatnr={followCatnr}
            focus={focus}
            showDaylight={showDaylight}
            time={orbitTime}
            locked={locked}
            onSelect={selectSatellite}
            onStopFollow={() => setFollowCatnr(null)}
          />
        )}
      </Suspense>
      </div>

      {placingObserver && <div className="observer-placement" role="status">
        <span>Click anywhere on the map to set your observer location.</span>
        <button type="button" onClick={() => setPlacingObserver(false)}>Cancel placement</button>
      </div>}
      <header className="mission-hud" aria-label="Satellite tracking status">
        <div className="brand-lockup">
          <span className="brand-mark"><IconSatellite size={18} stroke={1.8} /></span>
          <span>
            <strong>ORBITAL VIEW</strong>
            <small>ACTIVE SATELLITE NETWORK</small>
          </span>
        </div>
        <div className="view-switch" aria-label="View mode">
          <button aria-label="Show 3D globe" aria-pressed={mode === "3d"} onClick={() => { setMode("3d"); setPlacingObserver(false); }}>
            <IconWorld size={17} stroke={1.8} /><span>Globe</span>
          </button>
          <button aria-label="Show 2D map" aria-pressed={mode === "2d"} onClick={() => setMode("2d")}>
            <IconMap2 size={17} stroke={1.8} /><span>Map</span>
          </button>
        </div>
        <div className={`catalog-state state-${catalogState.toLowerCase()}`}>
          <span className="live-dot" aria-hidden="true" />
          <span>
            <strong>{catalogStateLabel}</strong>
            <small>{formatCatalogAge(catalog.fetchedAt, wallNow)} · {catalogSourceLabel(catalog.source)}</small>
          </span>
        </div>
      <div className="time-hud" aria-live="polite">
        <IconClock size={16} stroke={1.8} />
        <span>
          <strong>{utcTime} UTC</strong>
          <small>{utcDate}</small>
        </span>
        <span
          className={`time-mode ${simulation.mode}`}
          aria-label={simulation.mode === "live" ? "Real-time propagation from orbital elements" : "Simulation paused"}
        >
          {simulation.mode === "live" ? "REAL-TIME" : "PAUSED"}
        </span>
      </div>
      </header>

      <div className="dock" aria-label="Map controls">
        <button
          ref={filtersButtonRef}
          className={`dock-item icon-button ${controlsOpen ? "active" : ""}`}
          aria-label="Toggle filters"
          aria-expanded={controlsOpen}
          title="Filters"
          data-tooltip="Filters"
          onClick={openControls}
        >
          <IconAdjustmentsHorizontal size={19} stroke={1.8} />
        </button>
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
          className="dock-item icon-button reset-button"
          aria-label="Return to live time"
          title="Return to live time"
          data-tooltip="Live time"
          disabled={simulation.mode === "live"}
          onClick={simulation.reset}
        >
          <IconRefresh size={18} stroke={1.8} />
        </button>
        <button
          className={`dock-item icon-button ${showDaylight ? "active" : ""}`}
          aria-label="Show daylight"
          aria-pressed={showDaylight}
          title="Show daylight"
          data-tooltip={showDaylight ? "Hide daylight overlay" : "Show daylight overlay"}
          onClick={() => setShowDaylight((shown) => !shown)}
        >
          <IconSun size={18} stroke={1.8} />
        </button>
        <label className="dock-search-wrap">
          <IconSearch size={17} stroke={1.8} aria-hidden="true" />
          <input
            ref={searchRef}
            className="dock-search"
            aria-label="Search satellites"
            aria-controls="satellite-results"
            aria-expanded={search.trim() !== ""}
            placeholder="Search name or NORAD ID"
            value={search}
            onFocus={() => setControlsOpen(false)}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={handleSearchKey}
          />
          {search !== "" && (
            <button type="button" className="search-clear" aria-label="Close search" onClick={closeSearch}>
              <IconX size={15} stroke={1.8} />
            </button>
          )}
        </label>
      </div>

      {mode === "3d" && sats.length > 0 && selectedCatnr === null && search === "" && !controlsOpen && (
        <div className="interaction-hint" role="status">
          <IconTarget size={16} stroke={1.8} aria-hidden="true" />
          <span>
            <strong>Select a satellite to inspect</strong>
            <small>Click a marker or search by name / NORAD ID</small>
          </span>
        </div>
      )}

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
        {visibleSats.length === 0 && sats.length > 0 && (
          <div className="empty-filter" role="status">
            <span>No satellites are visible with these filters.</span>
            <button onClick={() => filterMode === "orbit"
              ? setRegimes(new Set(["leo", "meo", "geo"]))
              : setConstellations(new Set(CONSTELLATIONS))}
            >Show all satellites</button>
          </div>
        )}
      </section>

      {search.trim() !== "" && !controlsOpen && (
        <section id="satellite-results" className="panel results-list" aria-label="Satellite search results">
          <div className="panel-kicker">Search results</div>
          {searchResults.length > 0 ? searchResults.map((satellite, index) => (
            <button
              key={satellite.catnr}
              aria-label={`${satellite.name} NORAD ${satellite.catnr}`}
              className={`result-row ${index === searchIndex ? "active" : ""}`}
              onMouseEnter={() => setSearchIndex(index)}
              onClick={() => selectSatellite(satellite.catnr, true)}
            >
              <span className="result-icon"><IconSatellite size={16} stroke={1.8} /></span>
              <span><strong>{satellite.name}</strong><small>NORAD {satellite.catnr} · {satellite.regime.toUpperCase()}</small></span>
              <IconTarget size={16} stroke={1.7} />
            </button>
          )) : (
            <div className="search-empty" role="status">
              <IconSearch size={20} stroke={1.7} />
              <strong>No satellites match “{search.trim()}”</strong>
              <small>Try a satellite name or NORAD catalog number.</small>
              <button onClick={closeSearch}>Close search</button>
            </div>
          )}
          {searchResults.length === 20 && <div className="results-more">Refine your search to see more</div>}
        </section>
      )}

      {selected && !placingObserver && !controlsOpen && search === "" && (
        <section className={`panel sat-panel ${detailsExpanded ? "expanded" : ""}`} aria-label={`${selected.name} details`}>
          <div className="panel-header">
            <div className="panel-title">
              <span className="status-dot" style={{ background: REGIME_COLORS[selected.regime] }} />
              <span>
                <span className="panel-kicker">{selected.regime.toUpperCase()} · NORAD {selected.catnr}</span>
                <h2>{selected.name}</h2>
              </span>
            </div>
            <button ref={detailsCloseRef} className="panel-close" aria-label="Close" title="Close" onClick={closeSelection}>
              <IconX size={17} stroke={1.8} />
            </button>
          </div>
          <div className="position-readout">
            <div><small>ALTITUDE</small><strong>{pos ? `${pos.altKm.toFixed(0)} km` : "…"}</strong></div>
            <div><small>SPEED</small><strong>{pos?.velocityKms ? `${pos.velocityKms.toFixed(2)} km/s` : "…"}</strong></div>
          </div>
          <div className="ground-position">Ground position <span>{pos ? `${pos.lat.toFixed(2)}°, ${pos.lon.toFixed(2)}°` : "Calculating…"}</span></div>
          <p className="prediction-note">Predicted position at the simulation time from published orbital elements.</p>
          {revealMessage && <div className="reveal-notice" role="status">{revealMessage}</div>}
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
          {observer ? (
            <div className="observer-summary">
              <div>
                <span>Visible now from {observerName}</span>
                <strong className={visibility?.visible ? "val-ok" : "val-warn"}>
                  {visibility ? (visibility.visible ? "Yes" : `No · ${visibility.reason}`) : "Calculating…"}
                </strong>
              </div>
              <small>{observer.lat.toFixed(2)}°, {observer.lon.toFixed(2)}°</small>
              <button className="observer-change" onClick={() => { setObserver(null); setObserverSource(null); setObserverStatus("idle"); setObserverSetupOpen(true); }}>Change observer</button>
            </div>
          ) : (
            <div className={`observer-setup ${observerSetupOpen ? "open" : "collapsed"}`}>
              <div className="observer-prompt">
                <span><strong>Observer location</strong><small>Needed for visibility and pass predictions.</small></span>
                <button type="button" aria-expanded={observerSetupOpen} onClick={() => { cancelObserverRequest(); setObserverStatus("idle"); setObserverSetupOpen((open) => !open); }}>
                  {observerSetupOpen ? "Cancel" : "Set observer location"}
                </button>
              </div>
              {observerSetupOpen && (
                <div className="observer-options">
                  <small>{observerStatus === "locating"
                    ? "Requesting your approximate location…"
                    : observerStatus === "unavailable"
                      ? observerError
                      : "Use your device location, choose on map, use a reference, or enter coordinates."}</small>
                  <div className="observer-actions">
                    <button type="button" disabled={observerStatus === "locating"} onClick={requestObserver}>Use my location</button>
                    <button type="button" onClick={() => { cancelObserverRequest(); setObserverStatus("idle"); setObserverError(null); setMode("2d"); setLocked(false); setFollowCatnr(null); setPlacingObserver(true); setObserverSetupOpen(false); }}>Choose on map</button>
                    <button type="button" onClick={() => setNamedObserver(FALLBACK_OBSERVER, "reference")}>Use New York reference</button>
                  </div>
                  <form className="coordinate-form" onSubmit={submitManualObserver}>
                    <label>Latitude<input aria-label="Observer latitude" inputMode="decimal" value={manualLat} onChange={(event) => setManualLat(event.target.value)} placeholder="-90 to 90" /></label>
                    <label>Longitude<input aria-label="Observer longitude" inputMode="decimal" value={manualLon} onChange={(event) => setManualLon(event.target.value)} placeholder="-180 to 180" /></label>
                    <button type="submit">Set observer</button>
                    {manualObserverError && <div className="coordinate-error" role="alert">{manualObserverError}</div>}
                  </form>
                </div>
              )}
            </div>
          )}
          <button className="details-toggle" aria-expanded={detailsExpanded} onClick={() => setDetailsExpanded((expanded) => !expanded)}>
            {detailsExpanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
            {detailsExpanded ? "Hide technical details" : "Show technical details"}
          </button>
          {detailsExpanded && (
            <div className="technical-details">
              <div className="sat-rows">
                <div className="row"><span>Network</span><span className="constellation-label">{selected.constellation}</span></div>
                <div className="row"><span>Velocity</span><span>{pos?.velocityKms ? `${pos.velocityKms.toFixed(2)} km/s` : "…"}</span></div>
                <div className="row"><span>Period</span><span>{Math.round(selected.periodS / 60)} min</span></div>
                <div className="row"><span>Inclination</span><span>{selected.inclinationDeg.toFixed(1)}°</span></div>
                <div className="row"><span>Element epoch</span><span>{formatElementEpoch(selected.line1)} UTC</span></div>
              </div>
              <div className="display-disclosure">
                Globe altitude is compressed for readability. The violet line is a projected ground track, not a true-scale 3D orbit.
              </div>
              {observer && (
                <div className="passes">
                  <div className="section-title"><IconEye size={14} stroke={1.8} /> Upcoming passes <small>UTC</small></div>
                  <p className="pass-explainer">Prediction from orbital elements for {observerName}, in chronological order.</p>
                  {chronologicalPasses && chronologicalPasses.length > 0 ? (
                    <div className="passes-list">
                      {chronologicalPasses.slice(0, 5).map((pass) => (
                        <div key={pass.start.getTime()} className="pass-row">
                          <span className="pass-time">{formatPassTime(pass.start)}</span>
                          <span className="pass-bar-track"><span className="pass-bar" style={{ width: `${Math.min(100, (pass.maxElevationDeg / 90) * 100)}%` }} /></span>
                          <span className="pass-elev" aria-label={`${pass.maxElevationDeg.toFixed(0)} degrees maximum elevation`}>{pass.maxElevationDeg.toFixed(0)}°</span>
                        </div>
                      ))}
                    </div>
                  ) : <div className="passes-empty">No passes above 5° in the next 48 hours.</div>}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {observer && (
        <div className="observer-label">
          <IconCurrentLocation size={14} stroke={1.8} />
          <span>Observer {observer.lat.toFixed(2)}°, {observer.lon.toFixed(2)}°</span>
          {mode === "2d" && <small>Click map to relocate</small>}
        </div>
      )}

      <aside className="orbit-legend" aria-label="Satellite marker legend">
        {(["leo", "meo", "geo"] as Regime[]).map((regime) => (
          <span key={regime}><i style={{ background: REGIME_COLORS[regime] }} />{regime.toUpperCase()}</span>
        ))}
      </aside>

      <div className="count-pill" aria-live="polite">
        {visibleSats.length === sats.length ? (
          <><span className="count-value">{sats.length.toLocaleString()}</span>{" objects"}</>
        ) : (
          <>
            <span className="count-value">{visibleSats.length.toLocaleString()}</span>
            {" shown"}
            <span className="count-separator"> / </span>
            <span>{sats.length.toLocaleString()} loaded</span>
          </>
        )}
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
