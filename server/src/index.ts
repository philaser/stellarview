import "dotenv/config";
import { fileURLToPath } from "url";
import path from "path";
import express from "express";
import cors from "cors";
import { parseBbox } from "./bbox";
import type { FlightsResponse, FlightState } from "./types";
import { createProvider } from "./providers/factory";
import { TtlCache } from "./cache";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3001);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS ?? 15_000);
const PROVIDER = createProvider(process.env);
const cache = new TtlCache<FlightState[]>(CACHE_TTL_MS);
const lastGood = new Map<string, { flights: FlightState[]; fetchedAt: number }>();

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
    const flights = await cache.getOrLoad(key, () => PROVIDER.fetchStates(bbox));
    lastGood.set(key, { flights, fetchedAt: Date.now() });
    const body: FlightsResponse = { flights, stale, rateLimited, fetchedAt: Date.now() };
    res.json(body);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 429) rateLimited = true;
    const fallback = lastGood.get(key);
    if (fallback) {
      stale = true;
      const body: FlightsResponse = {
        flights: fallback.flights,
        stale,
        rateLimited,
        fetchedAt: fallback.fetchedAt,
      };
      res.json(body);
    } else {
      res.status(502).json({ error: "provider unreachable", rateLimited });
    }
  }
});

app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT} (provider: ${PROVIDER.name})`);
});
