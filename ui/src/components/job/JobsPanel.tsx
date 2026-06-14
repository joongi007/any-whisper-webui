import { Box, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";

import { useJobsStore } from "../../stores/jobsStore";
import { JobCard } from "./JobCard";

/** Right-hand rail of *in-progress* jobs only — queued or running. It is NOT
 *  "history" (that's its own page); a finished job drops out of here the moment
 *  it succeeds/fails so the rail stays a live work-in-progress view. Hidden
 *  entirely when nothing is active. */
export function JobsPanel() {
  const { t } = useTranslation();
  // Subscribe to the stable map ref; derive the filtered list in the body so we
  // don't hand Zustand a fresh array each render.
  const active = useJobsStore((s) => s.active);
  const inProgress = Object.values(active).filter(
    (j) => j.status === "queued" || j.status === "running",
  );
  if (inProgress.length === 0) return null;

  return (
    <Box
      component="aside" aria-label={t("jobs_panel.title")}
      sx={{
        display: { xs: "none", xl: "flex" }, flexDirection: "column",
        width: 320, flexShrink: 0,
        borderLeft: "1px solid var(--border-default)",
        bgcolor: "var(--bg-surface)",
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1}
          sx={{ px: 2, py: 1.5, borderBottom: "1px solid var(--border-default)" }}>
        <Box sx={{
          width: 7, height: 7, borderRadius: "50%", bgcolor: "var(--accent)",
          animation: "ww-pulse 1.4s ease-in-out infinite", flexShrink: 0,
        }} />
        <Typography sx={{ fontSize: 13, fontWeight: 500 }}>
          {t("jobs_panel.title")}
        </Typography>
        <Typography sx={{ fontSize: 12, color: "text.muted", fontVariantNumeric: "tabular-nums" }}>
          {inProgress.length}
        </Typography>
      </Stack>
      <Stack spacing={1.5} sx={{ flex: 1, overflow: "auto", p: 1.5 }}>
        {inProgress.map((j) => <JobCard key={j.job_id} job={j} />)}
      </Stack>
    </Box>
  );
}
