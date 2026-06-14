import { create } from "zustand";

import { deleteJob, deleteJobKeepalive } from "../api/jobs";
import { queryClient } from "../lib/queryClient";

/** Global delete-with-undo, shared by History (bulk), JobDetail (single), and
 *  the JobsPanel cards.
 *
 *  The model: deletes are *scheduled*, not immediate. A scheduled batch hides
 *  its rows everywhere (consumers read `pending` and filter), shows one undo
 *  Snackbar, and fires the real DELETE requests after `UNDO_WINDOW_MS`. Undo
 *  cancels the timer. This is the Gmail pattern — it replaces both
 *  `window.confirm` (no interrupting modal) and the previous per-page timer
 *  logic that lived in HistoryPage.
 *
 *  Timers live in a module-level map rather than store state because they're
 *  not render-relevant and storing a number in zustand would just churn. */

export const UNDO_WINDOW_MS = 5000;

interface Batch {
  id: string;
  ids: readonly string[];
  timer: number;
}

const batches = new Map<string, Batch>();
let counter = 0;

function nextBatchId(): string {
  counter += 1;
  return `del-${counter}`;
}

async function commit(ids: readonly string[]): Promise<void> {
  // Fire all deletes in parallel; failures are logged, not surfaced — the row
  // is already gone from the user's view and a stale row will reappear on the
  // next refetch if the server rejected it.
  await Promise.allSettled(ids.map((id) => deleteJob(id)));
  await queryClient.invalidateQueries({ queryKey: ["history"] });
}

interface State {
  /** Union of every job id currently inside an undo window. Consumers filter
   *  their lists against this so a scheduled row vanishes immediately. */
  pending: Set<string>;
  /** The most recent batch — drives the single undo Snackbar. Cleared when the
   *  batch commits or is undone. */
  active: { id: string; count: number } | null;

  schedule: (ids: readonly string[]) => void;
  undo: () => void;
  /** Flush every in-flight batch immediately (used on page unload). */
  flushAll: () => void;
}

export const usePendingDeleteStore = create<State>((set, get) => ({
  pending: new Set(),
  active: null,

  schedule: (ids) => {
    if (ids.length === 0) return;
    const id = nextBatchId();
    const timer = window.setTimeout(() => {
      const b = batches.get(id);
      batches.delete(id);
      set((s) => {
        const pending = new Set(s.pending);
        for (const jid of ids) pending.delete(jid);
        // Only clear the snackbar if it's still showing *this* batch.
        const active = s.active?.id === id ? null : s.active;
        return { pending, active };
      });
      if (b) void commit(b.ids);
    }, UNDO_WINDOW_MS);

    batches.set(id, { id, ids, timer });
    set((s) => {
      const pending = new Set(s.pending);
      for (const jid of ids) pending.add(jid);
      return { pending, active: { id, count: ids.length } };
    });
  },

  undo: () => {
    const active = get().active;
    if (!active) return;
    const b = batches.get(active.id);
    if (b) {
      window.clearTimeout(b.timer);
      batches.delete(b.id);
    }
    set((s) => {
      const pending = new Set(s.pending);
      if (b) for (const jid of b.ids) pending.delete(jid);
      return { pending, active: null };
    });
  },

  flushAll: () => {
    for (const b of batches.values()) {
      window.clearTimeout(b.timer);
      // keepalive so the request survives the unload that triggered this.
      for (const id of b.ids) deleteJobKeepalive(id);
    }
    batches.clear();
    set({ pending: new Set(), active: null });
  },
}));

// Last-ditch flush on hard reload / tab close. React unmount cleanup can't run
// there, so the keepalive fetch is the only way to honour scheduled deletes.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    usePendingDeleteStore.getState().flushAll();
  });
}
