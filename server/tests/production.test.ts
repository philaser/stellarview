import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { it, expect } from "vitest";
import { createApp } from "../src/app";

it("serves the production client and release health without swallowing API errors", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "stellarview-production-"));
  try {
    await writeFile(path.join(directory, "index.html"), "<title>Stellarview</title>");
    const app = createApp({ staticDir: directory, releaseCommit: "test-release" });
    const health = await request(app).get("/healthz").expect(200);
    expect(health.body).toEqual({ status: "ok", commit: "test-release" });
    const page = await request(app).get("/").expect(200);
    expect(page.text).toContain("<title>Stellarview</title>");
    await request(app).get("/api/unknown").expect(404).expect("Content-Type", /json/);
    await request(app).get("/assets/missing.js").expect(404);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
