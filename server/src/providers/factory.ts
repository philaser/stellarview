import { OpenSkyProvider } from "./opensky";
import { TokenManager } from "./token";
import type { FlightProvider } from "./flight-provider";

export function createProvider(env: NodeJS.ProcessEnv): FlightProvider {
  const provider = env.PROVIDER ?? "opensky";

  if (provider === "airlabs") {
    if (!env.AIRLABS_API_KEY) throw new Error("AIRLABS_API_KEY is required when PROVIDER=airlabs");
    throw new Error("AirLabs provider not yet implemented");
  }

  if (provider !== "opensky") throw new Error(`Unknown provider: ${provider}`);

  const baseUrl = env.OPENSKY_BASE_URL ?? "https://opensky-network.org/api";
  const tokenManager =
    env.OPENSKY_USERNAME && env.OPENSKY_PASSWORD
      ? new TokenManager({
          clientId: env.OPENSKY_USERNAME,
          clientSecret: env.OPENSKY_PASSWORD,
          baseUrl: "https://auth.opensky-network.org",
          tokenEndpoint: "/oauth2/token",
        })
      : null;
  return new OpenSkyProvider({ baseUrl }, tokenManager);
}
