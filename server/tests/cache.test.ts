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
});
