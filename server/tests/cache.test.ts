import { describe, it, expect, vi } from "vitest";
import { TtlCache } from "../src/cache";

describe("TtlCache", () => {
  it("returns undefined on miss", () => {
    const c = new TtlCache<number>(1000);
    expect(c.get("a")).toBeUndefined();
  });

  it("returns the value and does not refetch before TTL", async () => {
    const c = new TtlCache<number>(1000);
    const load = vi.fn().mockResolvedValue(42);
    expect(await c.getOrLoad("a", load)).toBe(42);
    expect(await c.getOrLoad("a", load)).toBe(42);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("refetches after TTL expires", async () => {
    vi.useFakeTimers();
    const c = new TtlCache<number>(1000);
    const load = vi.fn().mockResolvedValue(42);
    await c.getOrLoad("a", load);
    vi.advanceTimersByTime(1500);
    await c.getOrLoad("a", load);
    expect(load).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("discards expired entries unless stale retention is explicitly enabled", () => {
    vi.useFakeTimers();
    const ordinary = new TtlCache<number>(1000);
    ordinary.set("a", 1);
    vi.advanceTimersByTime(1001);
    expect(ordinary.get("a")).toBeUndefined();
    expect(ordinary.getStale("a")).toBeUndefined();

    const retaining = new TtlCache<number>(1000, true);
    retaining.set("a", 1);
    vi.advanceTimersByTime(1001);
    expect(retaining.get("a")).toBeUndefined();
    expect(retaining.getStale("a")).toBe(1);
    vi.useRealTimers();
  });

  it("set stores a value retrievable by get", () => {
    const c = new TtlCache<number>(1000);
    c.set("a", 42);
    expect(c.get("a")).toBe(42);
  });
});
