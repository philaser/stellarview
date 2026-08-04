export class TokenManager {
  private token: string | null = null;
  private expiresAt = 0;

  constructor(
    private opts: {
      clientId: string;
      clientSecret: string;
      baseUrl: string;
      tokenEndpoint?: string;
    }
  ) {
    if (!opts.clientId || !opts.clientSecret) {
      throw new Error("OpenSky credentials (OPENSKY_USERNAME / OPENSKY_PASSWORD) are required");
    }
  }

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt) return this.token;
    const endpoint = this.opts.tokenEndpoint ?? "/token";
    const res = await fetch(`${this.opts.baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${this.opts.clientId}:${this.opts.clientSecret}`
        ).toString("base64")}`,
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = body.access_token;
    this.expiresAt = Date.now() + (body.expires_in - 60) * 1000; // refresh 60s early
    return this.token;
  }
}
