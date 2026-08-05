import { useEffect, useRef } from "react";
import Globe from "globe.gl";
import type { SatDot } from "./MapView";

const COUNTRIES_URL =
  "https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson";

// Cap visual altitude so GEO/MEO shells hug the globe instead of rendering as streaks from inside the camera.
const ALT_CAP = 0.35;
const altR = (altKm: number) => Math.min(altKm / 6371, ALT_CAP);

export interface GlobeViewProps {
  positions: SatDot[];
  selectedOrbit: [number, number][] | null;
  selectedCatnr: number | null;
  onSelect: (catnr: number) => void;
}

export default function GlobeView({ positions, selectedOrbit, selectedCatnr, onSelect }: GlobeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<InstanceType<typeof Globe> | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedRef = useRef(selectedCatnr);
  selectedRef.current = selectedCatnr;
  const hoveredRef = useRef<number | null>(null);

  useEffect(() => {
    const globe = new Globe(containerRef.current!, { rendererConfig: { antialias: true } });
    globe
      .backgroundColor("#050816")
      .showAtmosphere(true)
      .atmosphereColor("#3a4a6b")
      .showGraticules(false)
      .pointOfView({ lat: 20, lng: 0, altitude: 3.2 });

    globe
      .pointsData([])
      .pointLat((d) => (d as SatDot).lat)
      .pointLng((d) => (d as SatDot).lon)
      .pointAltitude((d) => (d as { altR?: number }).altR ?? 0.1)
      .pointColor((d) => (d as SatDot).color ?? "#e5e7eb")
      .pointRadius((d) =>
        (d as SatDot).catnr === selectedRef.current
          ? 0.05
          : hoveredRef.current === (d as SatDot).catnr
            ? 0.045
            : 0.018
      )
      .onPointClick((p) => onSelectRef.current((p as SatDot).catnr))
      .onPointHover((p) => {
        hoveredRef.current = p ? (p as SatDot).catnr : null;
        if (containerRef.current) {
          containerRef.current.style.cursor = p ? "pointer" : "";
        }
      });

    globe
      .labelsData([])
      .labelLat((d) => (d as SatDot).lat)
      .labelLng((d) => (d as SatDot).lon)
      .labelText((d) => String((d as SatDot).catnr))
      .labelColor(() => "#ffffff")
      .labelSize(1.2)
      .labelAltitude((d) => altR((d as SatDot).altKm) + 0.03)
      .labelResolution(2);

    globe
      .pathsData([])
      .pathPoints((d) => (d as { pts: [number, number][] }).pts)
      .pathPointLat((p) => (p as [number, number])[1])
      .pathPointLng((p) => (p as [number, number])[0])
      .pathPointAlt(() => 0.07)
      .pathColor(() => "#a855f7")
      .pathStroke(0.04)
      .pathDashLength(0.15)
      .pathDashGap(0.06)
      .pathDashInitialGap(0.05);

    globeRef.current = globe;

    fetch(COUNTRIES_URL)
      .then((r) => r.json())
      .then((geo: { features: object[] }) => {
        globe
          .polygonsData(geo.features)
          .polygonCapColor(() => "rgba(30, 41, 59, 0.85)")
          .polygonSideColor(() => "rgba(56, 89, 138, 0.35)")
          .polygonStrokeColor(() => "rgba(96, 165, 250, 0.25)")
          .polygonAltitude(0.002);
      })
      .catch(() => {
        // countries layer is decorative; the globe still renders
      });

    return () => {
      globe._destructor?.();
      globeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const pts = positions.map((p) => ({ ...p, altR: altR(p.altKm) }));
    globe.pointsData(pts);
    globe.labelsData(positions.filter((p) => p.catnr === selectedCatnr));
    globe.pointsData(pts); // re-apply after label change to refresh radius expressions
  }, [positions, selectedCatnr]);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    if (selectedOrbit && selectedOrbit.length >= 2) {
      globe.pathsData([{ pts: selectedOrbit }]);
    } else {
      globe.pathsData([]);
    }
  }, [selectedOrbit]);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    let gap = 0;
    const interval = setInterval(() => {
      gap = (gap + 0.02) % 0.3;
      globe.pathDashInitialGap(gap);
    }, 80);
    return () => clearInterval(interval);
  }, []);

  return <div ref={containerRef} className="map" />;
}
