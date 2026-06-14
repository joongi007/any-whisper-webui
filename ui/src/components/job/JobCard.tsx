import {
  CheckCircleOutline, DeleteOutline, ErrorOutline, Folder, GraphicEq,
  HourglassEmpty, Mic, PlayCircleFilled, YouTube,
} from "@mui/icons-material";
import {
  Box, Chip, IconButton, LinearProgress, Stack, Tooltip, Typography,
} from "@mui/material";
import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { type JobView } from "../../api/jobs";
import { exportUrl } from "../../api/transcripts";
import { useJobsStore } from "../../stores/jobsStore";
import { usePendingDeleteStore } from "../../stores/pendingDeleteStore";
import { formatLanguage, formatRelative } from "../../utils/format";
import { formatDuration } from "../../utils/time";
import { statusTone } from "./statusPalette";

/** Density-conscious card that surfaces the job's *identity* (source +
 *  filename) prominently — the user's biggest complaint was "I can't tell
 *  which job is which" in History. */
export function JobCard({ job }: { job: JobView }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const removeLocal = useJobsStore((s) => s.remove);
  const scheduleDelete = usePendingDeleteStore((s) => s.schedule);

  const isQueued = job.status === "queued";
  const isRunning = job.status === "running";
  const isDone = job.status === "succeeded";
  const isFailed = job.status === "failed" || job.status === "cancelled";

  function onDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Schedule a delete-with-undo (global Snackbar handles the rest). Drop the
    // card from the local jobs panel immediately for snappy feedback; if the
    // user undoes, the next history refetch restores it.
    removeLocal(job.job_id);
    scheduleDelete([job.job_id]);
  }

  const SourceIcon =
    job.source_kind === "youtube"  ? YouTube :
    job.source_kind === "file"     ? Folder  :
    job.source_kind === "realtime" ? Mic     :
                                     GraphicEq;
  const sourceLabel = job.source_label ?? job.job_id.slice(-8);

  // The card itself behaves like a link (click / Enter / Space → navigate), but
  // it's a <div>, not an <a> — the SRT/VTT/TXT download chips are real <a>
  // children, and nested <a> in <a> is invalid HTML.
  function goToDetail(e?: React.SyntheticEvent) {
    e?.preventDefault();
    nav(`/jobs/${job.job_id}`);
  }

  return (
    <Box
      role="link" tabIndex={0}
      onClick={goToDetail}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") goToDetail(e);
      }}
      sx={{
        display: "block", cursor: "pointer", textDecoration: "none", color: "inherit",
        p: 1.5, borderRadius: 2,
        bgcolor: "background.paper",
        border: "1px solid var(--border-default)",
        transition: "border-color 140ms cubic-bezier(0.16, 1, 0.3, 1)",
        "&:hover": { borderColor: "var(--border-strong)" },
      }}
    >
      <Stack spacing={1.25}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <SourceIcon fontSize="small" sx={{ color: "text.secondary", flexShrink: 0 }} />
          <Typography
            variant="body2"
            title={sourceLabel}
            sx={{
              flex: 1, minWidth: 0, fontWeight: 500,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {sourceLabel}
          </Typography>
          <StatusChip status={job.status} t={t} />
          <Tooltip title={t("history.delete")}>
            <IconButton size="small" aria-label="delete" onClick={onDelete}>
              <DeleteOutline fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>

        <Stack direction="row" spacing={1.5} flexWrap="wrap" alignItems="center"
            sx={{ color: "text.secondary" }}>
          {job.model && <MetaChip>{job.model}</MetaChip>}
          {job.language && <MetaChip>{formatLanguage(job.language)}</MetaChip>}
          {job.duration_sec != null && <MetaChip>{formatDuration(job.duration_sec)}</MetaChip>}
          <MetaChip sx={{ ml: "auto" }}>{formatRelative(job.created_at)}</MetaChip>
        </Stack>

        {(isQueued || isRunning) && (
          <Box>
            <LinearProgress
              variant={isQueued ? "indeterminate" : "determinate"}
              value={Math.round(job.progress * 100)}
              sx={{ height: 4, borderRadius: 2 }}
            />
            <Typography variant="caption" sx={{ color: "text.secondary", mt: 0.5, display: "block" }}>
              {t(`stage.${job.stage}`, { defaultValue: job.stage })} · {Math.round(job.progress * 100)}%
            </Typography>
          </Box>
        )}

        {isDone && job.result?.transcript_id && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ pt: 0.25 }}>
            <DlLink href={exportUrl(job.result.transcript_id, "srt")}>SRT</DlLink>
            <DlLink href={exportUrl(job.result.transcript_id, "vtt")}>VTT</DlLink>
            <DlLink href={exportUrl(job.result.transcript_id, "txt")}>TXT</DlLink>
            <Box component="span" sx={{ ml: "auto", fontSize: 12, opacity: 0.7 }}>
              {t("common.open")} →
            </Box>
          </Stack>
        )}

        {isFailed && job.error && (
          <Typography variant="caption" sx={{ color: "error.main" }}>
            {job.error.code}: {job.error.message}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}

function MetaChip({ children, sx }: { children: ReactNode; sx?: object }) {
  return (
    <Typography variant="caption" sx={{ fontSize: 11, color: "text.secondary", ...sx }}>
      {children}
    </Typography>
  );
}

function DlLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      onClick={(e) => e.stopPropagation()}
      style={{
        fontSize: 12, fontWeight: 500, padding: "2px 8px",
        border: "1px solid var(--border-default)", borderRadius: 6,
        textDecoration: "none", color: "inherit",
      }}
    >
      {children}
    </a>
  );
}

function StatusChip({ status, t }: { status: string; t: (k: string, opts?: { defaultValue?: string }) => string }) {
  const label = t(`history.status.${status}`, { defaultValue: status });
  const tone = statusTone(status);
  return (
    <Chip
      size="small" label={label} icon={statusIcon(status)}
      sx={{
        height: 22, fontWeight: 500, fontSize: 11,
        bgcolor: tone.bg,
        color: tone.fg,
        "& .MuiChip-icon": { color: "inherit", marginLeft: "6px" },
      }}
    />
  );
}

function statusIcon(status: string) {
  switch (status) {
    case "succeeded": return <CheckCircleOutline fontSize="inherit" />;
    case "running":   return <PlayCircleFilled  fontSize="inherit" />;
    case "queued":    return <HourglassEmpty    fontSize="inherit" />;
    case "failed":
    case "cancelled": return <ErrorOutline      fontSize="inherit" />;
    default:          return undefined;
  }
}
