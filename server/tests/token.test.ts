import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenManager } from "../src/providers/token";

describe("TokenManager", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: "tok123", expires_in: 1800 }),
      })
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("fetches a token on first call and caches it", async () => {
    const tm = new TokenManager({ clientId: "u", clientSecret: "p", baseUrl: "https://auth.opensky-network.org" });
    const t1 = await tm.getToken();
    const t2 = await tm.getToken();
    expect(t1).toBe("tok123");
    expect(t2).toBe("tok123");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refetches after expiry (half-life cache)", async () => {
    const tm = new TokenManager({ clientId: "u", clientSecret: "p", baseUrl: "https://auth.opensky-network.org" });
    await tm.getToken();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "tok456", expires_in: 1800 }),
    } as unknown as Response);
    (tm as unknown as { expiresAt: number }).expiresAt = Date.now() - 1000;
    expect(await tm.getToken()).toBe("tok456");
  });

  it("throws when credentials are missing", () => {
    expect(() => new TokenManager({ clientId: "", clientSecret: "", baseUrl: "x" })).toThrow();
  });
});
