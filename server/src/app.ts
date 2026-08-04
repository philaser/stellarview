import { fileURLToPath } from "url";
import path from "path";
import express from "express";
import cors from "cors";
import { parseBbox } from "./bbox";
import type { FlightsResponse, FlightState } from "./types";
import { createProvider } from "./providers/factory";
import { TtlCache } from "./cache";
import type { FlightProvider } from "./providers/flight-provider";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CACHE_TTL_MS = 15_000;
const DEFAULT_LAST_GOOD_TTL_MS = 60_000;
const MAX_LAST_GOOD_KEYS = 100;

interface LastGoodEntry {
  flights: FlightState[];
  fetchedAt: number;
  expiresAt: number;
}

export interface CreateAppOptions {
  provider?: FlightProvider;
  cacheTtlMs?: number;
}

export function createApp(options: CreateAppOptions = {}) {
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const provider = options.provider ?? createProvider(process.env);
  const cache = new TtlCache<FlightState[]>(cacheTtlMs);
  // The fallback must outlive the hot cache, or it is already expired the moment the primary fails.
  const lastGoodTtlMs = Math.max(cacheTtlMs, DEFAULT_LAST_GOOD_TTL_MS);
  const lastGood = new Map<string, LastGoodEntry>();

  const app = express();
  app.use(cors());

  app.get("/api/airports", (_req, res) => {
    res.sendFile("data/airports.json", { root: path.join(__dirname, "..") }, (err) => {
      if (err) res.status(500).json({ error: "airport dataset missing — run npm run build:airports" });
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
      const flights = await cache.getOrLoad(key, () => provider.fetchStates(bbox));
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

  return app;
}
