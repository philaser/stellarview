import "dotenv/config";
import { pathToFileURL } from "url";
import { createApp } from "./app";
import { createProvider } from "./providers/factory";

const PORT = Number(process.env.PORT ?? 3001);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS ?? 15_000);

// Guard so importing this module (e.g. from tests) does not boot the server.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const provider = createProvider(process.env);
  const app = createApp({ provider, cacheTtlMs: CACHE_TTL_MS });

  app.listen(PORT, () => {
    console.log(`[server] listening on :${PORT} (provider: ${provider.name})`);
  });
}
