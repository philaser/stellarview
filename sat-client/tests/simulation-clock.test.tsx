import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSimulationClock } from "../src/useSimulationClock";

describe("useSimulationClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T20:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tracks wall-clock time while live", () => {
    const { result } = renderHook(() => useSimulationClock());
    expect(result.current.mode).toBe("live");
    expect(result.current.time.toISOString()).toBe("2026-08-11T20:00:00.000Z");

    act(() => vi.advanceTimersByTime(2_000));
    expect(result.current.time.toISOString()).toBe("2026-08-11T20:00:02.000Z");
  });

  it("freezes while paused and reset returns to live now", () => {
    const { result } = renderHook(() => useSimulationClock());
    act(() => result.current.pause());
    const pausedAt = result.current.time.getTime();

    act(() => vi.advanceTimersByTime(5_000));
    expect(result.current.mode).toBe("paused");
    expect(result.current.time.getTime()).toBe(pausedAt);

    act(() => result.current.reset());
    expect(result.current.mode).toBe("live");
    expect(result.current.time.toISOString()).toBe("2026-08-11T20:00:05.000Z");
  });
});
