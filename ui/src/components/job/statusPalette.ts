/** Single source of truth for job-status colors. Imported by everywhere that
 *  renders a status chip (HistoryPage, JobCard, JobDetailPage), so the same
 *  job reads the same color regardless of where it surfaces.
 *
 *  All values pull from the design tokens — no hardcoded hex. */
export interface StatusTone {
  bg: string;
  fg: string;
}

export const STATUS_PALETTE: Record<string, StatusTone> = {
  succeeded: { bg: "var(--success-soft)", fg: "var(--success)" },
  running:   { bg: "var(--accent-soft)",  fg: "var(--accent)" },
  queued:    { bg: "var(--bg-subtle)",    fg: "var(--text-secondary)" },
  failed:    { bg: "var(--danger-soft)",  fg: "var(--danger)" },
  cancelled: { bg: "var(--bg-subtle)",    fg: "var(--text-muted)" },
};

export function statusTone(status: string): StatusTone {
  return STATUS_PALETTE[status] ?? STATUS_PALETTE.queued;
}
