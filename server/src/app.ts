import { fileURLToPath } from "url";
import path from "path";
import express from "express";
import cors from "cors";
import { parseBbox } from "./bbox";
import type { FlightsResponse, FlightState, FlightTrack, TrackResponse } from "./types";
import { createProvider } from "./providers/factory";
import { TtlCache } from "./cache";
import type { FlightProvider, TrackSource } from "./providers/flight-provider";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CACHE_TTL_MS = 15_000;
const TRACK_CACHE_TTL_MS = 120_000;
const TLE_CACHE_TTL_MS = 43_200_000; // 12h
const DEFAULT_LAST_GOOD_TTL_MS = 60_000;
const MAX_LAST_GOOD_KEYS = 100;

interface LastGoodEntry {
  flights: FlightState[];
  fetchedAt: number;
  expiresAt: number;
}

export interface CreateAppDeps {
  provider?: FlightProvider;
  cacheTtlMs?: number;
  trackCacheTtlMs?: number;
  tleCacheTtlMs?: number;
}

export function createApp(
  { provider, cacheTtlMs, trackCacheTtlMs, tleCacheTtlMs }: CreateAppDeps = {}
) {
  const providerInstance = provider ?? createProvider(process.env);
  const cache = new TtlCache<FlightState[]>(cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
  const trackCache = new TtlCache<FlightTrack | null>(trackCacheTtlMs ?? TRACK_CACHE_TTL_MS);
  const tleCache = new TtlCache<string>(tleCacheTtlMs ?? TLE_CACHE_TTL_MS);
  // The fallback must outlive the hot cache, or it is already expired the moment the primary fails.
  const lastGoodTtlMs = Math.max(cacheTtlMs ?? DEFAULT_CACHE_TTL_MS, DEFAULT_LAST_GOOD_TTL_MS);
  const lastGood = new Map<string, LastGoodEntry>();

  const app = express();
  app.use(cors());

  app.get("/api/airports", (_req, res) => {
    res.sendFile("data/airports.json", { root: path.join(__dirname, "..") }, (err) => {
      // The callback also fires on client aborts after the response started;
      // only send a 500 when nothing has been written yet.
      if (err && !res.headersSent) {
        res.status(500).json({ error: "airport dataset missing — run npm run build:airports" });
      }
    });
  });

  app.get("/api/flights", async (req, res) => {
    let bbox;
    try {
      bbox = parseBbox(String(req.query.bbox ?? ""));
    } catch {
      res.status(400).json({ error: "invalid bbox" });
      return;
    }

    const key = `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`;
    let rateLimited = false;
    let stale = false;

    try {
      const flights = await cache.getOrLoad(key, () => providerInstance.fetchStates(bbox));
      const now = Date.now();
      lastGood.set(key, { flights, fetchedAt: now, expiresAt: now + lastGoodTtlMs });
      if (lastGood.size > MAX_LAST_GOOD_KEYS) {
        const oldest = lastGood.keys().next().value;
        if (oldest !== undefined) lastGood.delete(oldest);
      }
      const body: FlightsResponse = { flights, stale, rateLimited, fetchedAt: now };
      res.json(body);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 429) rateLimited = true;
      const fallback = lastGood.get(key);
      if (fallback && Date.now() <= fallback.expiresAt) {
        stale = true;
        const body: FlightsResponse = {
          flights: fallback.flights,
          stale,
          rateLimited,
          fetchedAt: fallback.fetchedAt,
        };
        res.json(body);
      } else {
        if (fallback) lastGood.delete(key);
        res.status(502).json({ error: "provider unreachable", rateLimited });
      }
    }
  });

  const trackSource = providerInstance as FlightProvider & Partial<TrackSource>;
  // bind: fetchTrack is a class method (OpenSky) that uses `this` (tokenManager).
  const fetchTrack = trackSource.fetchTrack?.bind(providerInstance);

  app.get("/api/track", async (req, res) => {
    const icao24 = String(req.query.icao24 ?? "").toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(icao24)) {
      res.status(400).json({ error: "invalid icao24" });
      return;
    }
    if (typeof fetchTrack !== "function") {
      res.status(501).json({ error: `track not supported by provider ${providerInstance.name}` });
      return;
    }

    let rateLimited = false;
    try {
      const track = await trackCache.getOrLoad(icao24, () => fetchTrack(icao24));
      const body: TrackResponse = { track, stale: false, rateLimited };
      res.json(body);
    } catch (err) {
      if ((err as { status?: number }).status === 429) rateLimited = true;
      const cached = trackCache.get(icao24);
      if (cached !== undefined || rateLimited) {
        const body: TrackResponse = { track: cached ?? null, stale: false, rateLimited };
        res.json(body);
      } else {
        res.status(502).json({ error: "provider unreachable", rateLimited });
      }
    }
  });

  app.get("/api/tle", async (req, res) => {
    const catnr = String(req.query.catnr ?? "");
    if (!/^\d{1,5}(,\d{1,5}){0,49}$/.test(catnr)) {
      res.status(400).json({ error: "invalid catnr" });
      return;
    }
    try {
      const tle = await tleCache.getOrLoad(catnr, async () => {
        const blocks = await Promise.all(
          catnr.split(",").map(async (c) => {
            const upstream = await fetch(
              `https://celestrak.org/NORAD/elements/gp.php?CATNR=${c}&FORMAT=tle`
            );
            if (!upstream.ok) throw new Error(`CelesTrak responded ${upstream.status}`);
            return await upstream.text();
          })
        );
        return blocks.filter((b) => b.includes("\n2 ")).join("");
      });
      res.type("text/plain").send(tle);
    } catch {
      res.status(502).json({ error: "provider unreachable" });
    }
  });

  return app;
}
