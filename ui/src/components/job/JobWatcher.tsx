import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { listJobs } from "../../api/jobs";
import { useJobsStore } from "../../stores/jobsStore";
import { useToast } from "../feedback/toast";

/** Headless global watcher. While any tracked job is queued/running it polls the
 *  jobs list, keeps the in-progress rail (JobsPanel) live even when the user is
 *  NOT on the job detail page, and fires a toast when a job finishes in the
 *  background. Mounted once at the AppShell root. */
export function JobWatcher() {
  const { t } = useTranslation();
  const toast = useToast();
  const active = useJobsStore((s) => s.active);
  const hasActive = Object.values(active).some(
    (j) => j.status === "queued" || j.status === "running",
  );
  const notified = useRef<Set<string>>(new Set());

  const { data } = useQuery({
    queryKey: ["jobs-watch"],
    queryFn: () => listJobs({ size: 30 }),
    enabled: hasActive,
    refetchInterval: hasActive ? 4000 : false,
  });

  useEffect(() => {
    if (!data) return;
    const store = useJobsStore.getState();
    for (const job of data.items) {
      const prev = store.active[job.job_id];
      if (!prev) continue; // only jobs this session is tracking
      const wasActive = prev.status === "queued" || prev.status === "running";
      const isTerminal = ["succeeded", "failed", "cancelled"].includes(job.status);
      if (isTerminal && wasActive && !notified.current.has(job.job_id)) {
        notified.current.add(job.job_id);
        const label = job.source_label ?? job.job_id.slice(-8);
        if (job.status === "succeeded") toast.success(t("toast.job_done", { label }));
        else if (job.status === "failed") toast.error(t("toast.job_failed", { label }));
        else toast.info(t("toast.job_cancelled", { label }));
      }
      // Keep the rail's progress/stage live regardless of which page is open.
      if (prev.status !== job.status || prev.stage !== job.stage || prev.progress !== job.progress) {
        store.upsert(job);
      }
    }
  }, [data, t, toast]);

  return null;
}
