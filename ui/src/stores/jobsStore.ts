import { create } from "zustand";

import type { JobView } from "../api/jobs";

type Patch = Partial<JobView> & { job_id: string };

interface JobsState {
  active: Record<string, JobView>;
  /** Merge into the existing entry; fill missing fields with `null`/defaults
   *  so callers don't have to know every field of `JobView`. */
  upsert: (job: Patch) => void;
  remove: (id: string) => void;
  list: () => JobView[];
}

const DEFAULTS: Omit<JobView, "job_id"> = {
  kind: "transcribe",
  status: "queued",
  stage: "queued",
  progress: 0,
  created_at: null,
  started_at: null,
  finished_at: null,
  error: null,
  result: null,
  source_kind: null,
  source_label: null,
  backend: null,
  model: null,
  language: null,
  duration_sec: null,
  segment_count: null,
};

export const useJobsStore = create<JobsState>((set, get) => ({
  active: {},
  upsert: (job) => set((s) => {
    const prev = s.active[job.job_id];
    const merged: JobView = { ...DEFAULTS, ...prev, ...job };
    return { active: { ...s.active, [job.job_id]: merged } };
  }),
  remove: (id) => set((s) => {
    const next = { ...s.active };
    delete next[id];
    return { active: next };
  }),
  list: () => Object.values(get().active),
}));
