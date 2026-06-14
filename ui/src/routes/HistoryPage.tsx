import {
  CheckBox, CheckBoxOutlineBlank, Close, DeleteOutline, Download, Folder, GraphicEq,
  Mic, OpenInNew, Replay, Search, StopCircle, YouTube,
} from "@mui/icons-material";
import {
  Box, Button, Divider, IconButton, InputAdornment, ListItemIcon, ListItemText,
  Menu, MenuItem, Skeleton, Stack, TextField, Typography,
} from "@mui/material";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { cancelJob, listJobs, retryJob, type JobView } from "../api/jobs";
import { exportUrl } from "../api/transcripts";
import { useToast } from "../components/feedback/toast";
import { statusTone } from "../components/job/statusPalette";
import { useJobsStore } from "../stores/jobsStore";
import { usePendingDeleteStore } from "../stores/pendingDeleteStore";
import { formatLanguage, formatRelative } from "../utils/format";
import { formatDuration } from "../utils/time";

/* Dense table + multi-select + pagination + per-row context menu. Click row to
 * open; checkbox to multi-select (bulk delete / export); right-click for quick
 * actions. Per DESIGN.md "row can be the affordance" — the table is the surface,
 * actions live in the toolbar (bulk) or context menu (per-row). */

const PAGE_SIZE = 50;
type ExportFormat = "srt" | "vtt" | "txt";

function downloadFile(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function useFiltered(items: JobView[]) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((j) => {
      if (status !== "all" && j.status !== status) return false;
      if (!needle) return true;
      const hay = [j.source_label, j.model, j.backend, j.language, j.job_id].join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [items, q, status]);

  return { q, setQ, status, setStatus, filtered };
}

export function HistoryPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const upsert = useJobsStore((s) => s.upsert);

  const query = useInfiniteQuery({
    queryKey: ["history"],
    queryFn: ({ pageParam }) => listJobs({ page: pageParam, size: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? all.length + 1 : undefined;
    },
  });

  const items = useMemo(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );
  const total = query.data?.pages[0]?.total ?? 0;

  const { q, setQ, status, setStatus, filtered } = useFiltered(items);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const scheduleDelete = usePendingDeleteStore((s) => s.schedule);
  const pendingSet = usePendingDeleteStore((s) => s.pending);

  const visible = useMemo(
    () => filtered.filter((j) => !pendingSet.has(j.job_id)),
    [filtered, pendingSet],
  );
  const visibleIds = useMemo(() => new Set(visible.map((j) => j.job_id)), [visible]);
  const effectiveSelected = useMemo(() => {
    const next = new Set<string>();
    for (const id of selected) if (visibleIds.has(id)) next.add(id);
    return next;
  }, [selected, visibleIds]);

  useEffect(() => {
    if (selected.size === 0) return;
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "Escape") { e.preventDefault(); setSelected(new Set()); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.size]);

  async function onRetry(job: JobView) {
    try {
      const { job_id } = await retryJob(job.job_id);
      upsert({ job_id, kind: "transcribe", status: "queued", stage: "queued", progress: 0,
               started_at: null, finished_at: null, error: null, result: null });
      toast.success(t("toast.job_started"));
      void qc.invalidateQueries({ queryKey: ["history"] });
      nav(`/jobs/${job_id}`);
    } catch (err) {
      console.error("retryJob failed", err);
      toast.error(t("toast.job_start_failed"));
    }
  }

  async function onCancel(job: JobView) {
    try {
      await cancelJob(job.job_id);
      toast.info(t("toast.job_cancelled", { label: job.source_label ?? job.job_id.slice(-8) }));
      void qc.invalidateQueries({ queryKey: ["history"] });
    } catch (err) {
      console.error("cancelJob failed", err);
    }
  }

  function onBulkExport(format: ExportFormat) {
    const targets = visible.filter(
      (j) => effectiveSelected.has(j.job_id) && j.result?.transcript_id,
    );
    if (targets.length === 0) return;
    // Stagger so the browser doesn't drop concurrent downloads.
    targets.forEach((j, i) => {
      window.setTimeout(
        () => downloadFile(exportUrl(j.result!.transcript_id!, format)),
        i * 250,
      );
    });
    toast.info(t("toast.export_started", { count: targets.length }));
    setSelected(new Set());
  }

  if (query.isLoading) return (
    <Stack spacing={1.5}>
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={40} />)}
    </Stack>
  );
  if (query.error) return <Typography color="error">{t("error.api_unreachable")}</Typography>;
  if (items.length === 0) return <EmptyState />;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (effectiveSelected.size === visible.length) setSelected(new Set());
    else setSelected(new Set(visible.map((j) => j.job_id)));
  }
  function clearSelection() { setSelected(new Set()); }

  return (
    <Box>
      <PageHeader title={t("nav.history")} total={total} />
      <Toolbar q={q} setQ={setQ} status={status} setStatus={setStatus} count={visible.length} />
      <JobsTable
        rows={visible}
        selected={effectiveSelected}
        totalVisible={visible.length}
        onToggle={toggle}
        onToggleAll={toggleAll}
        onClearSelection={clearSelection}
        onBulkDelete={() => { const ids = Array.from(effectiveSelected); setSelected(new Set()); scheduleDelete(ids); }}
        onBulkExport={onBulkExport}
        onOpen={(j) => nav(`/jobs/${j.job_id}`)}
        onRetry={onRetry}
        onCancel={onCancel}
        onDeleteOne={(j) => scheduleDelete([j.job_id])}
      />
      {query.hasNextPage && (
        <Stack alignItems="center" sx={{ mt: 2 }}>
          <Button
            variant="outlined" onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? t("common.loading") : t("history.load_more")}
          </Button>
        </Stack>
      )}
    </Box>
  );
}

function PageHeader({ title, total }: { title: string; total: number }) {
  return (
    <Stack direction="row" alignItems="baseline" spacing={1.5} sx={{ mb: 2 }}>
      <Typography variant="h2">{title}</Typography>
      <Typography variant="caption" sx={{ color: "text.muted" }}>
        {total} total
      </Typography>
    </Stack>
  );
}

function Toolbar({
  q, setQ, status, setStatus, count,
}: {
  q: string; setQ: (v: string) => void;
  status: string; setStatus: (v: string) => void;
  count: number;
}) {
  const { t } = useTranslation();
  const statuses = ["all", "succeeded", "running", "queued", "failed", "cancelled"];
  return (
    <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.5 }}>
      <TextField
        size="small" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder={t("history.search_placeholder")}
        sx={{ flex: 1, maxWidth: 420 }}
        InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }}
      />
      <TextField select size="small" value={status} onChange={(e) => setStatus(e.target.value)}
          sx={{ minWidth: 140 }}>
        {statuses.map((s) => (
          <MenuItem key={s} value={s}>
            {s === "all" ? t("history.filter_all") : t(`history.status.${s}`, { defaultValue: s })}
          </MenuItem>
        ))}
      </TextField>
      <Typography variant="caption" sx={{ color: "text.muted", minWidth: 36, textAlign: "right" }}>
        {count}
      </Typography>
    </Stack>
  );
}

const COLS = "32px minmax(0,2fr) 90px minmax(0,1fr) 90px 70px 110px 130px";

interface RowActions {
  onOpen: (j: JobView) => void;
  onRetry: (j: JobView) => void;
  onCancel: (j: JobView) => void;
  onDeleteOne: (j: JobView) => void;
}

function JobsTable({
  rows, selected, totalVisible, onToggle, onToggleAll, onClearSelection,
  onBulkDelete, onBulkExport, ...actions
}: {
  rows: JobView[]; selected: Set<string>; totalVisible: number;
  onToggle: (id: string) => void; onToggleAll: () => void;
  onClearSelection: () => void; onBulkDelete: () => void;
  onBulkExport: (format: ExportFormat) => void;
} & RowActions) {
  const { t } = useTranslation();
  const allSelected = rows.length > 0 && selected.size === rows.length;
  const selecting = selected.size > 0;

  // Per-row context menu (right-click). Anchored at the cursor.
  const [ctx, setCtx] = useState<{ job: JobView; x: number; y: number } | null>(null);
  // Bulk-export format menu (anchored to the toolbar button).
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);

  function openContext(job: JobView, e: React.MouseEvent) {
    e.preventDefault();
    setCtx({ job, x: e.clientX, y: e.clientY });
  }

  return (
    <Box sx={{
      border: "1px solid var(--border-default)", borderRadius: 2,
      overflow: "hidden", bgcolor: "background.paper",
    }}>
      {selecting ? (
        <Stack direction="row" alignItems="center" spacing={1}
            sx={{
              px: 2, py: 0.5, minHeight: 36,
              bgcolor: "var(--bg-subtle)",
              borderBottom: "1px solid var(--border-default)",
            }}>
          <IconButton size="small" onClick={onToggleAll} aria-label="select all"
            sx={{ color: "var(--accent)", p: 0.25 }}>
            {allSelected ? <CheckBox fontSize="small" /> : <CheckBoxOutlineBlank fontSize="small" />}
          </IconButton>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {t("history.selected", { count: selected.size, total: totalVisible })}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Button
            size="small" variant="outlined"
            startIcon={<Download fontSize="small" />}
            onClick={(e) => setExportAnchor(e.currentTarget)}
            sx={{ minHeight: 28, py: 0.25, fontSize: 12 }}
          >
            {t("history.bulk_export")}
          </Button>
          <Button
            size="small" variant="contained" color="error"
            startIcon={<DeleteOutline fontSize="small" />}
            onClick={onBulkDelete}
            sx={{ minHeight: 28, py: 0.25, fontSize: 12, boxShadow: "none", "&:hover": { boxShadow: "none" } }}
          >
            {t("history.bulk_delete")}
          </Button>
          <IconButton size="small" onClick={onClearSelection}
            aria-label={t("history.clear_selection")}
            title={`${t("history.clear_selection")} (Esc)`}
            sx={{ color: "text.muted", p: 0.5 }}>
            <Close fontSize="small" />
          </IconButton>
        </Stack>
      ) : (
        <Box sx={{
          display: "grid", gridTemplateColumns: COLS,
          alignItems: "center", gap: 1.5, px: 2, minHeight: 36,
          bgcolor: "var(--bg-subtle)", borderBottom: "1px solid var(--border-default)",
          fontSize: 10, fontWeight: 500, letterSpacing: 0.8, textTransform: "uppercase",
          color: "text.secondary",
        }}>
          <IconButton size="small" onClick={onToggleAll} aria-label="select all"
            sx={{ color: "text.muted", p: 0.25 }}>
            <CheckBoxOutlineBlank fontSize="small" />
          </IconButton>
          <span>{t("history.col_source")}</span>
          <span>{t("history.col_status")}</span>
          <span>{t("history.col_model")}</span>
          <span>{t("history.col_lang")}</span>
          <span>{t("history.col_length")}</span>
          <span>{t("history.col_created")}</span>
          <span style={{ textAlign: "right" }}>{t("history.col_export")}</span>
        </Box>
      )}
      {rows.map((j) => (
        <Row key={j.job_id}
          job={j}
          selected={selected.has(j.job_id)}
          onToggle={() => onToggle(j.job_id)}
          onContextMenu={(e) => openContext(j, e)}
        />
      ))}

      {/* Bulk-export format picker */}
      <Menu anchorEl={exportAnchor} open={Boolean(exportAnchor)} onClose={() => setExportAnchor(null)}>
        {(["srt", "vtt", "txt"] as ExportFormat[]).map((fmt) => (
          <MenuItem key={fmt} onClick={() => { setExportAnchor(null); onBulkExport(fmt); }}>
            {t("history.export_as", { format: fmt.toUpperCase() })}
          </MenuItem>
        ))}
      </Menu>

      {/* Per-row context menu */}
      <Menu
        open={ctx != null} onClose={() => setCtx(null)}
        anchorReference="anchorPosition"
        anchorPosition={ctx ? { top: ctx.y, left: ctx.x } : undefined}
      >
        {ctx && <ContextItems job={ctx.job} actions={actions} close={() => setCtx(null)} />}
      </Menu>
    </Box>
  );
}

function ContextItems({ job, actions, close }: {
  job: JobView; actions: RowActions; close: () => void;
}) {
  const { t } = useTranslation();
  const active = job.status === "queued" || job.status === "running";
  const isTerminal = job.status === "succeeded" || job.status === "failed" || job.status === "cancelled";
  const canRetry = isTerminal && job.kind === "transcribe";
  // MUI <Menu> needs an array of elements (not a fragment) to render children.
  const items: ReactNode[] = [
    <MenuItem key="open" onClick={() => { close(); actions.onOpen(job); }}>
      <ListItemIcon><OpenInNew fontSize="small" /></ListItemIcon>
      <ListItemText>{t("common.open")}</ListItemText>
    </MenuItem>,
  ];
  if (canRetry) items.push(
    <MenuItem key="retry" onClick={() => { close(); actions.onRetry(job); }}>
      <ListItemIcon><Replay fontSize="small" /></ListItemIcon>
      <ListItemText>{t("common.retry")}</ListItemText>
    </MenuItem>,
  );
  if (active) items.push(
    <MenuItem key="cancel" onClick={() => { close(); actions.onCancel(job); }}>
      <ListItemIcon><StopCircle fontSize="small" /></ListItemIcon>
      <ListItemText>{t("history.cancel")}</ListItemText>
    </MenuItem>,
  );
  items.push(<Divider key="div" />);
  items.push(
    <MenuItem key="delete" onClick={() => { close(); actions.onDeleteOne(job); }}
        sx={{ color: "var(--danger)" }}>
      <ListItemIcon sx={{ color: "inherit" }}><DeleteOutline fontSize="small" /></ListItemIcon>
      <ListItemText>{t("history.delete")}</ListItemText>
    </MenuItem>,
  );
  return <>{items}</>;
}

function Row({
  job, selected, onToggle, onContextMenu,
}: {
  job: JobView; selected: boolean; onToggle: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const Icon =
    job.source_kind === "youtube"  ? YouTube :
    job.source_kind === "file"     ? Folder  :
    job.source_kind === "realtime" ? Mic     :
                                     GraphicEq;
  return (
    <Box onContextMenu={onContextMenu} sx={{
      display: "grid", gridTemplateColumns: COLS,
      alignItems: "center", gap: 1.5, px: 2, py: 1.25,
      borderBottom: "1px solid var(--border-default)",
      bgcolor: selected ? "var(--bg-subtle)" : "transparent",
      transition: "background-color 140ms cubic-bezier(0.16, 1, 0.3, 1)",
      "&:hover": { bgcolor: selected ? "var(--bg-selected-hover)" : "var(--bg-subtle)" },
      "&:last-of-type": { borderBottom: "none" },
    }}>
      <IconButton size="small" onClick={onToggle} aria-label="select row"
        sx={{ color: selected ? "var(--accent)" : "text.muted", p: 0.25 }}>
        {selected ? <CheckBox fontSize="small" /> : <CheckBoxOutlineBlank fontSize="small" />}
      </IconButton>
      <Box component={Link} to={`/jobs/${job.job_id}`} sx={{
        textDecoration: "none", color: "inherit", display: "flex",
        alignItems: "center", gap: 1, minWidth: 0,
      }}>
        <Icon fontSize="small" sx={{ color: "text.muted", flexShrink: 0 }} />
        <Typography variant="body2" sx={{
          fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {job.source_label ?? job.job_id.slice(-8)}
        </Typography>
      </Box>
      <StatusChip status={job.status} />
      <Typography variant="caption" className="font-mono" sx={{
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "text.secondary",
      }}>
        {job.model ?? "·"}
      </Typography>
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        {formatLanguage(job.language)}
      </Typography>
      <Typography variant="caption" className="font-mono" sx={{ color: "text.secondary" }}>
        {job.duration_sec != null ? formatDuration(job.duration_sec) : "·"}
      </Typography>
      <Typography variant="caption" sx={{ color: "text.muted" }}>
        {formatRelative(job.created_at)}
      </Typography>
      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
        {job.result?.transcript_id ? (
          <>
            <Dl href={exportUrl(job.result.transcript_id, "srt")}>SRT</Dl>
            <Dl href={exportUrl(job.result.transcript_id, "vtt")}>VTT</Dl>
            <Dl href={exportUrl(job.result.transcript_id, "txt")}>TXT</Dl>
          </>
        ) : (
          <Typography variant="caption" sx={{ color: "text.muted" }}>·</Typography>
        )}
      </Stack>
    </Box>
  );
}

function Dl({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href} onClick={(e) => e.stopPropagation()}
      style={{
        fontSize: 10, fontWeight: 500, padding: "2px 7px", borderRadius: 4,
        border: "1px solid var(--border-default)", textDecoration: "none", color: "inherit",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {children}
    </a>
  );
}

function StatusChip({ status }: { status: string }) {
  const { t } = useTranslation();
  const tone = statusTone(status);
  return (
    <Typography component="span" sx={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      height: 22, px: 1, borderRadius: 999, fontSize: 11, fontWeight: 500,
      bgcolor: tone.bg, color: tone.fg,
    }}>
      {t(`history.status.${status}`, { defaultValue: status })}
    </Typography>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <Stack alignItems="center" spacing={2} sx={{ py: 10, color: "text.secondary" }}>
      <Typography variant="h2">{t("history.empty_title")}</Typography>
      <Typography variant="body2" sx={{ color: "text.muted" }}>{t("history.empty_hint")}</Typography>
      <Stack direction="row" spacing={1.5} sx={{ pt: 1 }}>
        <Button component={Link} to="/file"    variant="outlined" startIcon={<Folder />}>{t("nav.file")}</Button>
        <Button component={Link} to="/youtube" variant="outlined" startIcon={<YouTube />}>{t("nav.youtube")}</Button>
        <Button component={Link} to="/realtime" variant="outlined" startIcon={<GraphicEq />}>{t("nav.realtime")}</Button>
      </Stack>
    </Stack>
  );
}
