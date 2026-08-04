import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import App from "../src/App";

vi.mock("maplibre-gl", () => {
  class MockMap {
    constructor() {}
    on() {}
    addSource() {}
    addLayer() {}
    remove() {}
    getSource() {
      return undefined;
    }
    flyTo() {}
  }
  return { default: MockMap, Map: MockMap };
});

const response = { flights: [], stale: false, rateLimited: false, fetchedAt: Date.now() };
const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => response });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("App", () => {
  it("polls every 20s", async () => {
    render(<App />);
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("visibility refresh does not start a second chain", async () => {
    render(<App />);
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
