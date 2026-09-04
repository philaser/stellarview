import { fileURLToPath } from "url";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, rename, stat, writeFile } from "fs/promises";
import express from "express";
import cors from "cors";
import { parseBbox } from "./bbox";
import type { FlightsResponse, FlightState, FlightTrack, TrackResponse } from "./types";
import { createProvider } from "./providers/factory";
import { TtlCache } from "./cache";
import type { FlightProvider, TrackSource } from "./providers/flight-provider";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TLE_CACHE_FILE = path.join(__dirname, "..", "data", "tle-active.cache");
const TLE_CACHE_TEMP_FILE = path.join(__dirname, "..", "data", "tle-active.tmp.cache");

const DEFAULT_CACHE_TTL_MS = 15_000;
const TRACK_CACHE_TTL_MS = 120_000;
const TLE_CACHE_TTL_MS = 43_200_000; // 12h
const DEFAULT_LAST_GOOD_TTL_MS = 60_000;
const MAX_LAST_GOOD_KEYS = 100;
const TLE_FETCH_TIMEOUT_MS = 10_000;
const TLE_CURL_TIMEOUT_MS = 15_000;

const execFileP = promisify(execFile);

// CelesTrak intermittently 403s on Node's TLS fingerprint, so fall back to curl.
async function fetchCelesTrak(params: string): Promise<string> {
  try {
    const res = await fetch(`https://celestrak.org/NORAD/elements/gp.php?${params}`, {
      signal: AbortSignal.timeout(TLE_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`CelesTrak responded ${res.status}`);
    return await res.text();
  } catch {
    const { stdout } = await execFileP(
      "curl",
      ["-sS", "--fail", "--connect-timeout", "10", "--max-time", "15", "-A", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36", `https://celestrak.org/NORAD/elements/gp.php?${params}`],
      { timeout: TLE_CURL_TIMEOUT_MS + 5_000, maxBuffer: 32 * 1024 * 1024 }
    );
    return stdout;
  }
}

interface LastGoodEntry {
  flights: FlightState[];
  fetchedAt: number;
  expiresAt: number;
}

interface TleCacheEntry {
  text: string;
  fetchedAt: number | null;
  source: "upstream" | "disk";
}

function parseTleCache(serialized: string): { text: string; fetchedAt: number | null; legacy: boolean } {
  try {
    const { text, fetchedAt } = JSON.parse(serialized) as { text?: unknown; fetchedAt?: unknown };
    if (typeof text === "string") {
      return {
        text,
        fetchedAt: typeof fetchedAt === "number" && Number.isFinite(fetchedAt) && fetchedAt > 0 ? fetchedAt : null,
        legacy: false,
      };
    }
  } catch {}
  return { text: serialized, fetchedAt: null, legacy: true };
}

function legacyTleTimestamp(mtimeMs: number | null): number | null {
  return mtimeMs && Number.isFinite(mtimeMs) && mtimeMs > 0 ? mtimeMs : null;
}

function hasTlePair(text: string): boolean {
  const lines = text.split(/\r?\n/);
  return lines.some((line, index) => /^1 \d{5}/.test(line) && /^2 \d{5}/.test(lines[index + 1] ?? ""));
}

async function persistTleCache(text: string, fetchedAt: number): Promise<void> {
  await writeFile(TLE_CACHE_TEMP_FILE, JSON.stringify({ text, fetchedAt }));
  await rename(TLE_CACHE_TEMP_FILE, TLE_CACHE_FILE);
}

function setTleHeaders(res: express.Response, tle: TleCacheEntry, cache: "hit" | "miss", stale = false): express.Response {
  const response = res
    .set("X-TLE-Fetched-At", tle.fetchedAt === null ? "unknown" : String(tle.fetchedAt))
    .set("X-TLE-Source", tle.source)
    .set("X-TLE-Cache", cache);
  if (stale) response.set("X-TLE-Stale", "true");
  return response;
}

// Prime the in-memory TLE cache from the last-good disk copy so restarts
// survive CelesTrak throttles (403s can last up to 2h).
export function primeTleCacheFromDisk(cache: TtlCache<TleCacheEntry>): Promise<void> {
  return readFile(TLE_CACHE_FILE, "utf8")
    .then(async (serialized) => {
      const diskCache = parseTleCache(serialized);
      if (hasTlePair(diskCache.text)) {
        const fileStat = diskCache.legacy ? await stat(TLE_CACHE_FILE).catch(() => null) : null;
        const fetchedAt = diskCache.fetchedAt ?? legacyTleTimestamp(fileStat?.mtimeMs ?? null);
        const entry = { text: diskCache.text, fetchedAt, source: "disk" } satisfies TleCacheEntry;
        cache.setIfAbsent("group:active", entry, fetchedAt ?? 0);
      }
    })
    .catch(() => {});
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
  const tleCache = new TtlCache<TleCacheEntry>(tleCacheTtlMs ?? TLE_CACHE_TTL_MS);
  const tleGroupCache = new TtlCache<TleCacheEntry>(tleCacheTtlMs ?? TLE_CACHE_TTL_MS, true);
  const tlePrimed = primeTleCacheFromDisk(tleGroupCache);
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

  const TLE_GROUPS = new Set(["active"]);

  app.get("/api/tle", async (req, res) => {
    const catnr = String(req.query.catnr ?? "");
    const group = String(req.query.group ?? "");
    if ((catnr && group) || (!catnr && !group)) {
      res.status(400).json({ error: "provide exactly one of catnr or group" });
      return;
    }
    if (catnr) {
      if (!/^\d{1,5}(,\d{1,5}){0,49}$/.test(catnr)) {
        res.status(400).json({ error: "invalid catnr" });
        return;
      }
      try {
        const key = `catnr:${catnr}`;
        const cached = tleCache.get(key);
        const tle = cached ?? await tleCache.getOrLoad(key, async () => {
          const blocks = await Promise.all(
            catnr.split(",").map((c) => fetchCelesTrak(`CATNR=${c}&FORMAT=tle`))
          );
          return {
            text: blocks.filter((b) => b.includes("\n2 ")).join(""),
            fetchedAt: Date.now(),
            source: "upstream",
          };
        });
        setTleHeaders(res, tle, cached ? "hit" : "miss")
          .type("text/plain")
          .send(tle.text);
      } catch {
        res.status(502).json({ error: "provider unreachable" });
      }
      return;
    }
    if (!TLE_GROUPS.has(group)) {
      res.status(400).json({ error: `unsupported group: ${group}` });
      return;
    }
    let stale: TleCacheEntry | undefined;
    try {
      await tlePrimed;
      const key = `group:${group}`;
      const cached = tleGroupCache.get(key);
      stale = cached === undefined ? tleGroupCache.getStale(key) : undefined;
      const tle = cached ?? await tleGroupCache.getOrLoad(key, async () => {
        const text = await fetchCelesTrak(`GROUP=${group}&FORMAT=tle`);
        if (!hasTlePair(text)) throw new Error("CelesTrak returned invalid TLE data");
        const fetchedAt = Date.now();
        await persistTleCache(text, fetchedAt).catch(() => {});
        return { text, fetchedAt, source: "upstream" };
      });
      setTleHeaders(res, tle, cached ? "hit" : "miss")
        .type("text/plain")
        .send(tle.text);
    } catch {
      if (stale) {
        setTleHeaders(res, stale, "miss", true).type("text/plain").send(stale.text);
      } else {
        res.status(502).json({ error: "provider unreachable" });
      }
    }
  });

  return app;
}
