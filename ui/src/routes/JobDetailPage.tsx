import {
  DeleteOutline, Folder, GraphicEq, Mic, Replay, Stop, YouTube,
} from "@mui/icons-material";
import {
  Box, Button, CircularProgress, LinearProgress, Skeleton, Stack, Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { cancelJob, getJob, retryJob, type JobView } from "../api/jobs";
import {
  exportUrl, getTranscript,
  type TranscriptSegment, type TranscriptView,
} from "../api/transcripts";
import { useConfirm, type ConfirmOptions } from "../components/feedback/ConfirmDialog";
import { StatusBlock } from "../components/feedback/StatusBlock";
import { statusTone } from "../components/job/statusPalette";
import { TranscriptViewer } from "../components/transcript/TranscriptViewer";
import { useJobStream } from "../hooks/useJobStream";
import { useJobsStore } from "../stores/jobsStore";
import { usePendingDeleteStore } from "../stores/pendingDeleteStore";
import { formatLanguage, formatRelative } from "../utils/format";
import { formatDuration } from "../utils/time";

/* Two-pane layout. Left rail = identity, meta, audio, export. Right = transcript.
 * Sticky rail keeps export reachable while scrolling 6000-line transcripts.
 *
 * State: the React Query cache for `["job", id]` is the single source of truth.
 * WS events write through `setQueryData`; on WS reconnect we refetch so missed
 * events while disconnected don't strand the page on stale "running". */

export function JobDetailPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const upsert = useJobsStore((s) => s.upsert);
  const qc = useQueryClient();
  const scheduleDelete = usePendingDeleteStore((s) => s.schedule);

  const jobQuery = useQuery<JobView>({
    queryKey: ["job", id], queryFn: () => getJob(id), enabled: !!id,
    // Stale by default — a transcribe job's status moves over a 30s+ window,
    // so we want fresh data every time the page is foregrounded or remounted.
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const job = jobQuery.data ?? null;

  /** Local "we asked to cancel; waiting for the worker" state. Lives outside
   *  the query cache because it's a UI affordance (lock the button, show a
   *  banner) rather than authoritative job state. Clears when the status
   *  becomes terminal — that's how we know the worker acked. */
  const [cancelRequestedAt, setCancelRequestedAt] = useState<number | null>(null);

  // Only stream while the job can still change. Terminal jobs have nothing
  // more to send and the server closes the socket immediately — keeping the
  // stream "on" would loop reconnect → refetch → close forever (the screen's
  // endless-refresh bug). `null` job = still loading; keep it on so we don't
  // miss the first events.
  const jobActive = job == null || job.status === "queued" || job.status === "running";

  useJobStream(
    id,
    (e) => {
      if (e.type === "job_status") {
        qc.setQueryData<JobView>(["job", id], (old) =>
          old ? { ...old, status: "running", stage: String(e.stage), progress: Number(e.progress) } : old,
        );
      } else if (e.type === "job_done") {
        qc.setQueryData<JobView>(["job", id], (old) =>
          old ? {
            ...old, status: "succeeded", progress: 1,
            result: { transcript_id: String(e.transcript_id), output_files: (e.output_files as never) ?? [] },
          } : old,
        );
        void jobQuery.refetch();
      } else if (e.type === "job_failed") {
        qc.setQueryData<JobView>(["job", id], (old) =>
          old ? { ...old, status: "failed", error: e.error as never } : old,
        );
      } else if (e.type === "job_cancelled") {
        qc.setQueryData<JobView>(["job", id], (old) =>
          old ? { ...old, status: "cancelled", error: e.error as never } : old,
        );
      }
    },
    {
      enabled: jobActive,
      // Re-sync from the server whenever the socket (re)connects — covers
      // events fired during a brief disconnect (laptop sleep, dev reload).
      onOpen: () => { void jobQuery.refetch(); },
    },
  );

  // Clear the "cancelling" pseudostate once the server confirms a terminal
  // status. Otherwise the banner would linger after the worker stopped.
  useEffect(() => {
    if (job && (job.status === "cancelled" || job.status === "failed" || job.status === "succeeded")) {
      setCancelRequestedAt(null);
    }
  }, [job?.status]);

  useEffect(() => { if (job) upsert(job); }, [job, upsert]);

  const transcript = useQuery<TranscriptView>({
    queryKey: ["transcript", id], queryFn: () => getTranscript(id),
    enabled: job?.status === "succeeded",
  });

  function applyEdit(seq: number, next: TranscriptSegment) {
    qc.setQueryData<TranscriptView>(["transcript", id], (old) => {
      if (!old) return old;
      const segs = old.segments.slice();
      segs[seq - 1] = next;
      return { ...old, segments: segs };
    });
  }

  function onDeleteRequested() {
    // Schedule a delete-with-undo and leave for History immediately. The
    // global Snackbar (mounted in AppShell) keeps the undo affordance alive
    // across the navigation; the actual DELETE fires after the undo window.
    qc.removeQueries({ queryKey: ["transcript", id] });
    scheduleDelete([id]);
    nav("/history");
  }

  if (!job) return <Skeleton variant="rectangular" height={480} sx={{ borderRadius: 2 }} />;

  return (
    <Box sx={{
      display: "grid", gap: 3,
      gridTemplateColumns: { xs: "1fr", lg: "320px 1fr" },
      alignItems: "start",
    }}>
      <SideRail
        job={job}
        cancelRequestedAt={cancelRequestedAt}
        onCancelRequested={() => setCancelRequestedAt(Date.now())}
        onDeleteRequested={onDeleteRequested}
      />
      <Box sx={{ minWidth: 0 }}>
        {job.status === "succeeded" && job.result?.transcript_id && transcript.data ? (
          <TranscriptViewer
            transcriptId={job.result.transcript_id}
            segments={transcript.data.segments}
            onSegmentEdited={applyEdit}
          />
        ) : (
          <MainStatus job={job} cancelRequestedAt={cancelRequestedAt} />
        )}
      </Box>
    </Box>
  );
}

function SideRail({
  job, cancelRequestedAt, onCancelRequested, onDeleteRequested,
}: {
  job: JobView;
  cancelRequestedAt: number | null;
  onCancelRequested: () => void;
  onDeleteRequested: () => void;
}) {
  const { t } = useTranslation();
  const SourceIcon =
    job.source_kind === "youtube"  ? YouTube :
    job.source_kind === "file"     ? Folder  :
    job.source_kind === "realtime" ? Mic     :
                                     GraphicEq;
  const isTerminal = job.status === "succeeded" || job.status === "failed" || job.status === "cancelled";
  // Retry only makes sense for transcribe jobs that have finished one way or
  // another. Realtime sessions have no replayable request.
  const canRetry = isTerminal && job.kind === "transcribe";

  return (
    <Box sx={{
      position: { lg: "sticky" }, top: { lg: 16 },
      pr: { lg: 3 },
      borderRight: { lg: "1px solid var(--border-default)" },
    }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ color: "text.muted", mb: 1 }}>
        <SourceIcon fontSize="small" />
        <Typography variant="overline">{job.source_kind ?? job.kind}</Typography>
      </Stack>
      <Typography variant="h3" sx={{
        wordBreak: "break-all", mb: 2, lineHeight: 1.3,
      }}>
        {job.source_label ?? job.job_id}
      </Typography>

      <DefinitionList>
        <Def k="Status"><StatusBadge status={job.status} /></Def>
        {job.model    && <Def k="Model"   className="font-mono">{job.model}</Def>}
        {job.backend  && <Def k="Backend" className="font-mono">{job.backend}</Def>}
        {job.language && <Def k="Lang">{formatLanguage(job.language)}</Def>}
        {job.duration_sec != null && (
          <Def k="Length" className="font-mono">{formatDuration(job.duration_sec)}</Def>
        )}
        <Def k="Created">{formatRelative(job.created_at)}</Def>
      </DefinitionList>

      {(job.status === "queued" || job.status === "running") && (
        <Stack spacing={1.5} sx={{ mt: 2 }}>
          <StatusBlock tone="accent">
            <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5, color: "inherit" }}>
              {t(`stage.${job.stage}`, { defaultValue: job.stage })} · {Math.round(job.progress * 100)}%
            </Typography>
            <LinearProgress
              variant={job.status === "queued" ? "indeterminate" : "determinate"}
              value={Math.round(job.progress * 100)}
              sx={{ height: 4, borderRadius: 2 }}
            />
          </StatusBlock>
          <CancelJobButton
            jobId={job.job_id}
            requested={cancelRequestedAt != null}
            onRequested={onCancelRequested}
          />
        </Stack>
      )}

      {job.status === "failed" && job.error && (
        <StatusBlock tone="danger" sx={{ mt: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 500, color: "inherit" }}>{job.error.code}</Typography>
          <Typography variant="caption" sx={{ color: "inherit", display: "block" }}>{job.error.message}</Typography>
        </StatusBlock>
      )}

      {/* A 403 on the pyannote repo is almost never a bad token — it's that
          the HF account hasn't accepted the two models' gated-access terms.
          Spell out the exact fix so the user doesn't chase the token. */}
      {job.status === "failed" && job.error?.code === "gated_model" && (
        <GatedModelGuide />
      )}

      {/* YouTube blocked the download — tell the user it's YouTube, not their
          file, and what actually fixes it. */}
      {job.status === "failed" && job.error?.code === "youtube_blocked" && (
        <YouTubeBlockedGuide />
      )}

      {job.status === "cancelled" && (
        // Calm gray — cancellation is a user choice, not an error.
        <StatusBlock tone="neutral" sx={{ mt: 2 }}>
          <Typography variant="body2" sx={{ color: "inherit" }}>
            {job.error?.message ?? "Cancelled."}
          </Typography>
        </StatusBlock>
      )}

      {/* Retry — the primary recovery action for a failed/cancelled job.
          Sits right under the error so the eye lands on the fix, not the
          dead end. */}
      {canRetry && (job.status === "failed" || job.status === "cancelled") && (
        <Box sx={{ mt: 1.5 }}>
          <RetryJobButton jobId={job.job_id} />
        </Box>
      )}

      {job.status === "succeeded" && job.result?.transcript_id && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="overline" sx={{ color: "text.muted", display: "block", mb: 1 }}>
            Export
          </Typography>
          {/* Format pills, not full-width buttons. SRT/VTT/TXT are flavours of
              the same action (download the transcript); equal-flex buttons
              made each look like a primary action of its own. */}
          <Stack direction="row" spacing={0.75} flexWrap="wrap">
            <ExportChip href={exportUrl(job.result.transcript_id, "srt")}>SRT</ExportChip>
            <ExportChip href={exportUrl(job.result.transcript_id, "vtt")}>VTT</ExportChip>
            <ExportChip href={exportUrl(job.result.transcript_id, "txt")}>TXT</ExportChip>
          </Stack>
        </Box>
      )}

      {/* Delete sits at the bottom — it's not the primary action for any
          state, but burying it in History was the wrong call. Visible only
          on terminal jobs so we can't double-up on Cancel. */}
      {isTerminal && (
        <Box sx={{ mt: 3, pt: 2, borderTop: "1px solid var(--border-default)" }}>
          <DeleteJobButton onDelete={onDeleteRequested} />
        </Box>
      )}
    </Box>
  );
}

/** Main column — replaces the old PendingPlaceholder. State-aware so that a
 *  failed job doesn't read as "no transcript yet" (the old copy felt like
 *  the page hadn't loaded properly). */
function MainStatus({
  job, cancelRequestedAt,
}: { job: JobView; cancelRequestedAt: number | null }) {
  const { t } = useTranslation();

  if (cancelRequestedAt != null && (job.status === "queued" || job.status === "running")) {
    return (
      <CenteredHero>
        <CircularProgress size={20} sx={{ color: "var(--accent)" }} />
        <Typography variant="body1" sx={{ fontWeight: 500 }}>
          {t("job.cancelling_title")}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", maxWidth: 360, textAlign: "center" }}>
          {t("job.cancelling_hint")}
        </Typography>
      </CenteredHero>
    );
  }

  if (job.status === "queued" || job.status === "running") {
    return (
      <CenteredHero>
        <Box sx={{
          width: 8, height: 8, borderRadius: "50%",
          bgcolor: "var(--accent)",
          animation: "ww-pulse 1.4s ease-in-out infinite",
        }} />
        <Typography variant="body1" sx={{ fontWeight: 500 }}>
          {t("dashboard.job_pending")}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {t(`stage.${job.stage}`, { defaultValue: job.stage })} · {Math.round(job.progress * 100)}%
        </Typography>
      </CenteredHero>
    );
  }

  if (job.status === "failed") {
    return (
      <CenteredHero>
        <Typography variant="body1" sx={{ fontWeight: 500, color: "var(--danger)" }}>
          {t("job.failed_title")}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", maxWidth: 420, textAlign: "center" }}>
          {t("job.failed_hint")}
        </Typography>
      </CenteredHero>
    );
  }

  if (job.status === "cancelled") {
    return (
      <CenteredHero>
        <Typography variant="body1" sx={{ fontWeight: 500, color: "text.secondary" }}>
          {t("job.cancelled_title")}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.muted" }}>
          {t("job.cancelled_hint")}
        </Typography>
      </CenteredHero>
    );
  }

  // succeeded but transcript not ready (transient state between done event
  // and transcript fetch)
  return (
    <CenteredHero>
      <CircularProgress size={18} sx={{ color: "var(--accent)" }} />
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {t("job.loading_transcript")}
      </Typography>
    </CenteredHero>
  );
}

function CenteredHero({ children }: { children: ReactNode }) {
  return (
    <Stack alignItems="center" justifyContent="center" spacing={1.5}
        sx={{ py: 12, color: "text.secondary", minHeight: 320 }}>
      {children}
    </Stack>
  );
}

function DefinitionList({ children }: { children: ReactNode }) {
  return (
    <Box component="dl" sx={{
      display: "grid", gridTemplateColumns: "70px 1fr", gap: "6px 12px",
      m: 0, p: 0,
    }}>
      {children}
    </Box>
  );
}

function Def({ k, children, className }: { k: string; children: ReactNode; className?: string }) {
  return (
    <>
      <Box component="dt" sx={{
        fontSize: 11, color: "text.muted", textTransform: "uppercase", letterSpacing: 0.6, pt: 0.25,
      }}>
        {k}
      </Box>
      <Box component="dd" sx={{ m: 0, fontSize: 13 }} className={className}>
        {children}
      </Box>
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = statusTone(status);
  return (
    <Box component="span" sx={{
      display: "inline-flex", alignItems: "center", height: 20, px: 1, borderRadius: 999,
      fontSize: 11, fontWeight: 500, bgcolor: tone.bg, color: tone.fg,
    }}>
      {status}
    </Box>
  );
}

function CancelJobButton({
  jobId, requested, onRequested,
}: { jobId: string; requested: boolean; onRequested: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const cancel = useMutation({
    mutationFn: () => cancelJob(jobId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["history"] });
    },
  });

  const inFlight = cancel.isPending;
  const waiting = requested || inFlight;

  const label = inFlight
    ? t("history.cancelling")
    : requested
      ? t("job.cancel_waiting")
      : t("history.cancel_job");

  const cancelConfirmOpts: ConfirmOptions = {
    title: t("history.cancel_job"),
    body: t("history.cancel_job_confirm"),
    confirmLabel: t("history.cancel_job"),
    cancelLabel: t("job.keep_running"),
    tone: "danger",
  };

  return (
    <Stack spacing={0.5}>
      <Button
        size="small" variant="outlined" color="error"
        startIcon={waiting
          ? <CircularProgress size={12} sx={{ color: "inherit" }} />
          : <Stop fontSize="small" />}
        disabled={waiting}
        onClick={async () => {
          if (!(await confirm(cancelConfirmOpts))) return;
          // Flip the local "requested" flag *before* the network call so the
          // UI doesn't flash back to the idle label between the HTTP 200 and
          // the worker's `job_cancelled` event arriving (~seconds).
          onRequested();
          cancel.mutate();
        }}
        sx={{ alignSelf: "flex-start" }}
      >
        {label}
      </Button>
      {requested && !inFlight && (
        <Typography variant="caption" sx={{ color: "text.muted", pl: 0.5 }}>
          {t("job.cancel_waiting_hint")}
        </Typography>
      )}
    </Stack>
  );
}

/** Step-by-step recovery for the gated-model 403. The token card in Settings
 *  covers setup, but a user who hits this error wants the fix inline, not a
 *  trip to another page. */
function GatedModelGuide() {
  const { t } = useTranslation();
  return (
    <StatusBlock tone="warning" padding={2} sx={{ mt: 1.5 }}>
      <Stack spacing={1}>
        <Typography variant="body2" sx={{ fontWeight: 500, color: "var(--text-primary)" }}>
          {t("job.gated_title")}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {t("job.gated_body")}
        </Typography>
        <Box component="ol" sx={{
          m: 0, pl: 2.5,
          "& li": { marginBottom: "4px", color: "text.secondary", fontSize: 12 },
        }}>
          <li>
            <GatedLink href="https://huggingface.co/pyannote/speaker-diarization-3.1">
              pyannote/speaker-diarization-3.1
            </GatedLink>
          </li>
          <li>
            <GatedLink href="https://huggingface.co/pyannote/segmentation-3.0">
              pyannote/segmentation-3.0
            </GatedLink>
          </li>
          <li>
            <GatedLink href="https://huggingface.co/pyannote/speaker-diarization-community-1">
              pyannote/speaker-diarization-community-1
            </GatedLink>
          </li>
          <li>{t("job.gated_step_restart")}</li>
        </Box>
      </Stack>
    </StatusBlock>
  );
}

function GatedLink({ href, children }: { href: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <>
      <Box component="a" href={href} target="_blank" rel="noopener noreferrer"
          sx={{ color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}>
        {children}
      </Box>
      {" — "}{t("job.gated_step_agree")}
    </>
  );
}

/** YouTube download was blocked (403 bot-wall, outdated yt-dlp, private/age
 *  video). Make it clear this is YouTube's side, not the user's audio. */
function YouTubeBlockedGuide() {
  const { t } = useTranslation();
  return (
    <StatusBlock tone="warning" padding={2} sx={{ mt: 1.5 }}>
      <Stack spacing={1}>
        <Typography variant="body2" sx={{ fontWeight: 500, color: "var(--text-primary)" }}>
          {t("job.youtube_blocked_title")}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {t("job.youtube_blocked_body")}
        </Typography>
        <Box component="ul" sx={{
          m: 0, pl: 2.5,
          "& li": { marginBottom: "4px", color: "text.secondary", fontSize: 12 },
        }}>
          <li>{t("job.youtube_blocked_fix1")}</li>
          <li>{t("job.youtube_blocked_fix2")}</li>
          <li>{t("job.youtube_blocked_fix3")}</li>
        </Box>
      </Stack>
    </StatusBlock>
  );
}

function RetryJobButton({ jobId }: { jobId: string }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: () => retryJob(jobId),
    onSuccess: ({ job_id }) => {
      void qc.invalidateQueries({ queryKey: ["history"] });
      nav(`/jobs/${job_id}`);
    },
  });
  return (
    <Stack spacing={0.5}>
      <Button
        size="small" variant="contained"
        startIcon={retry.isPending
          ? <CircularProgress size={12} sx={{ color: "inherit" }} />
          : <Replay fontSize="small" />}
        disabled={retry.isPending}
        onClick={() => retry.mutate()}
        sx={{ alignSelf: "flex-start", boxShadow: "none", "&:hover": { boxShadow: "none" } }}
      >
        {retry.isPending ? t("job.retrying") : t("job.retry")}
      </Button>
      {retry.isError && (
        <Typography variant="caption" sx={{ color: "var(--danger)" }}>
          {t("job.retry_failed")}
        </Typography>
      )}
    </Stack>
  );
}

function DeleteJobButton({ onDelete }: { onDelete: () => void }) {
  const { t } = useTranslation();
  // No confirm dialog — the undo Snackbar IS the safety net (Gmail pattern).
  // The delete is scheduled by the parent; this button just triggers it.
  return (
    <Button
      size="small" variant="text"
      startIcon={<DeleteOutline fontSize="small" />}
      onClick={onDelete}
      sx={{
        alignSelf: "flex-start",
        // Text-button (low chrome) because Delete on a finished job is a
        // destructive but rarely-used action — burying it visually is the
        // right balance.
        color: "text.muted",
        "&:hover": { color: "var(--danger)", bgcolor: "var(--danger-soft)" },
      }}
    >
      {t("history.delete")}
    </Button>
  );
}

function ExportChip({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Box
      component="a" href={href} download
      sx={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 500, height: 24, px: 1.25, borderRadius: 999,
        border: "1px solid var(--border-default)",
        textDecoration: "none", color: "text.secondary",
        transition: "border-color 140ms cubic-bezier(0.16, 1, 0.3, 1), color 140ms",
        "&:hover": { borderColor: "var(--accent)", color: "var(--accent)" },
      }}
    >
      {children}
    </Box>
  );
}

