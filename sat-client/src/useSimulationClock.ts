import { useCallback, useEffect, useState } from "react";

export type SimulationMode = "live" | "paused";

export interface SimulationClock {
  mode: SimulationMode;
  time: Date;
  pause: () => void;
  resume: () => void;
  reset: () => void;
}

export function useSimulationClock(): SimulationClock {
  const [mode, setMode] = useState<SimulationMode>("live");
  const [timeMs, setTimeMs] = useState(() => Date.now());

  useEffect(() => {
    if (mode !== "live") return;
    const update = () => setTimeMs(Date.now());
    update();
    const interval = setInterval(update, 1_000);
    return () => clearInterval(interval);
  }, [mode]);

  const pause = useCallback(() => setMode("paused"), []);
  const resume = useCallback(() => {
    setTimeMs(Date.now());
    setMode("live");
  }, []);
  const reset = useCallback(() => {
    setTimeMs(Date.now());
    setMode("live");
  }, []);

  return { mode, time: new Date(timeMs), pause, resume, reset };
}
