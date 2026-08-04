import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
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

  it("region change triggers polling of the new bbox", async () => {
    render(<App />);
    await act(async () => {});

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "us" } });
    await act(async () => {});

    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("bbox=-125,24,-66,50"));
  });

  it("rate-limited response shows banner", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ flights: [], stale: false, rateLimited: true, fetchedAt: Date.now() }),
    });
    render(<App />);
    await act(async () => {});

    expect(screen.getByText("Rate limited — showing cached data")).toBeInTheDocument();
  });
});
