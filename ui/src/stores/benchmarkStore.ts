import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { BenchmarkResult } from "../api/system";

/** Last benchmark result, persisted so the Settings panel and the Dashboard
 *  card show the same thing and it survives a reload. One-shot manual data, so
 *  a small store fits better than a React Query cache. */
/** A run older than this is treated as stale — the request was probably
 *  abandoned by a refresh, so we stop showing "measuring" indefinitely. */
export const BENCH_STALE_MS = 7 * 60 * 1000;

interface BenchmarkState {
  result: BenchmarkResult | null;
  ranAt: number | null;
  // Persisted so "measuring…" survives a refresh / dialog reopen — that's what
  // stops the user re-triggering a run that's already in flight.
  running: boolean;
  startedAt: number | null;
  setResult: (r: BenchmarkResult) => void;
  setRunning: (running: boolean) => void;
  clear: () => void;
}

export const useBenchmarkStore = create<BenchmarkState>()(
  persist(
    (set) => ({
      result: null,
      ranAt: null,
      running: false,
      startedAt: null,
      setResult: (r) => set({ result: r, ranAt: Date.now(), running: false, startedAt: null }),
      setRunning: (running) => set({ running, startedAt: running ? Date.now() : null }),
      clear: () => set({ result: null, ranAt: null }),
    }),
    { name: "whisper-benchmark" },
  ),
);
