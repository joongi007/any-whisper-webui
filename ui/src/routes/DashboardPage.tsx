import {
  ArrowForward, Bolt, Folder, Mic, Speed, YouTube,
} from "@mui/icons-material";
import { Box, Button, Skeleton, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { listJobs, type JobView } from "../api/jobs";
import { fetchGpuStats, fetchSystemInfo, type BenchmarkStrategy } from "../api/system";
import { strategyLabel } from "../components/settings/BenchmarkPanel";
import { LoadedModelsCard } from "../components/settings/LoadedModelsCard";
import { useSettingsDialog } from "../components/settings/SettingsDialog";
import { BENCH_STALE_MS, useBenchmarkStore } from "../stores/benchmarkStore";
import { formatLanguage, formatRelative } from "../utils/format";
import { formatDuration } from "../utils/time";

/* Dashboard rejects the hero-metric template (impeccable absolute ban).
 * Three blocks instead: a calm intro, three start actions, and side-by-side
 * "system" + "recent jobs" so the user can either launch new work or jump
 * back into something they were doing. */

export function DashboardPage() {
  const sys = useQuery({ queryKey: ["system-info"], queryFn: fetchSystemInfo, refetchInterval: 5_000 });
  // Distinct key from HistoryPage's useInfiniteQuery(["history"]) — sharing it
  // made this read the infinite-query shape ({pages}) and lose `.items`.
  const jobs = useQuery({
    queryKey: ["recent-jobs"], queryFn: () => listJobs({ size: 5 }),
    refetchOnWindowFocus: true,
  });

  return (
    <Stack spacing={5} sx={{ maxWidth: 1080 }}>
      <Intro />
      <StartRow />
      <Box sx={{
        display: "grid", gap: 3,
        gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" },
      }}>
        <SystemBlock data={sys.data} loading={sys.isLoading} />
        <RecentBlock data={jobs.data?.items} loading={jobs.isLoading} />
      </Box>
      <BenchmarkSummary />
    </Stack>
  );
}

function BenchmarkSummary() {
  const { t } = useTranslation();
  const result = useBenchmarkStore((s) => s.result);
  const storeRunning = useBenchmarkStore((s) => s.running);
  const startedAt = useBenchmarkStore((s) => s.startedAt);
  const openSettings = useSettingsDialog();

  const running = storeRunning && (startedAt == null || Date.now() - startedAt < BENCH_STALE_MS);
  const valid = (result?.results ?? []).filter((r) => !r.error && r.throughput_xrt != null);
  const best = valid.reduce<BenchmarkStrategy | null>(
    (m, r) => (!m || (r.throughput_xrt ?? 0) > (m.throughput_xrt ?? 0) ? r : m), null);

  return (
    <Box sx={{
      display: "flex", alignItems: "center", gap: 2, p: 2,
      border: "1px solid var(--border-default)", borderRadius: 2, bgcolor: "background.paper",
    }}>
      <Speed sx={{ fontSize: 20, color: "text.muted", flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 500 }}>{t("bench.title")}</Typography>
        <Typography variant="caption" sx={{ color: "text.muted" }}>
          {running
            ? t("bench.running")
            : best
            ? t("bench.summary_done", {
                strategy: strategyLabel(best.strategy, t),
                xrt: best.throughput_xrt,
              })
            : t("bench.summary_none")}
        </Typography>
      </Box>
      <Button size="small" variant="outlined" onClick={openSettings} sx={{ fontSize: 12, flexShrink: 0 }}>
        {running ? t("bench.view") : best ? t("bench.run_again") : t("bench.run")}
      </Button>
    </Box>
  );
}

function Intro() {
  const { t } = useTranslation();
  return (
    <Stack spacing={1.5} sx={{ maxWidth: 640 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ color: "text.muted" }}>
        <Bolt sx={{ fontSize: 14 }} />
        <Typography variant="overline" sx={{ color: "inherit", letterSpacing: 1 }}>
          {t("dashboard.intro_label")}
        </Typography>
      </Stack>
      <Typography variant="h1">{t("dashboard.intro_title")}</Typography>
      <Typography variant="body1" sx={{ color: "text.secondary" }}>
        {t("dashboard.intro_body")}
      </Typography>
    </Stack>
  );
}

function StartRow() {
  const { t } = useTranslation();
  return (
    <Box sx={{
      display: "grid",
      gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" },
      borderTop: "1px solid var(--border-default)",
      borderBottom: "1px solid var(--border-default)",
    }}>
      <StartTile to="/file"     icon={<Folder />}    label={t("dashboard.start_file")}     hint={t("dashboard.start_file_hint")} />
      <StartTile to="/youtube"  icon={<YouTube />}   label={t("dashboard.start_youtube")}  hint={t("dashboard.start_youtube_hint")} />
      <StartTile to="/realtime" icon={<Mic />}       label={t("dashboard.start_realtime")} hint={t("dashboard.start_realtime_hint")} />
    </Box>
  );
}

/** A single shared horizontal rule above and below the row carries the
 *  affordance; individual tiles are borderless. Hover gains a subtle tint and
 *  nudges the arrow — that's enough to read as "this is clickable". */
function StartTile({
  to, icon, label, hint,
}: { to: string; icon: React.ReactNode; label: string; hint: string }) {
  return (
    <Box
      component={Link} to={to}
      sx={{
        display: "block", textDecoration: "none", color: "inherit",
        py: 2, px: 2.5,
        borderLeft: { md: "1px solid var(--border-default)" },
        "&:first-of-type": { borderLeft: "none" },
        transition: "background-color 140ms cubic-bezier(0.16, 1, 0.3, 1)",
        "&:hover": {
          bgcolor: "var(--bg-subtle)",
          "& .start-tile-arrow": { transform: "translateX(2px)", opacity: 0.9 },
        },
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: 0.5 }}>
        <Box sx={{
          width: 24, height: 24, color: "text.secondary",
          display: "grid", placeItems: "center",
          "& svg": { fontSize: 18 },
        }}>
          {icon}
        </Box>
        <Typography variant="h4" sx={{ flex: 1, fontSize: 15, fontWeight: 500 }}>{label}</Typography>
        <ArrowForward className="start-tile-arrow" sx={{
          fontSize: 14, opacity: 0.4, color: "text.muted",
          transition: "transform 140ms cubic-bezier(0.16, 1, 0.3, 1), opacity 140ms",
        }} />
      </Stack>
      <Typography variant="caption" sx={{ color: "text.muted", pl: "36px", display: "block" }}>
        {hint}
      </Typography>
    </Box>
  );
}

function SystemBlock({ data, loading }: { data: ReturnType<typeof useQuery<unknown>>["data"] | unknown; loading: boolean }) {
  const { t } = useTranslation();
  // Cast — useQuery generic above is unknown to keep imports light.
  const sys = data as undefined | {
    gpu: { available: boolean; name?: string; vram_total_mb?: number; cuda?: string };
    ffmpeg_version: string | null;
    backends_available: string[];
    diarize_available: boolean;
    diarize_token_present: boolean;
    ai_online: boolean;
  };

  return (
    <Stack spacing={4}>
      <Box>
        <BlockHeader>{t("dashboard.system_title")}</BlockHeader>
        <Box sx={{ mt: 1.5 }}>
          {loading && <Skeleton variant="text" width={180} />}
          {!loading && sys && (
            <Stack spacing={1}>
              <Row label="GPU"     value={sys.gpu.available ? (sys.gpu.name ?? "·") : t("dashboard.sys_unavailable")}
                   tone={sys.gpu.available ? "good" : "muted"} />
              {sys.gpu.available && <GpuLive vramTotalMb={sys.gpu.vram_total_mb ?? 0} />}
              <Row label="CUDA"    value={sys.gpu.cuda ?? "·"} mono />
              <Row label="ffmpeg"  value={sys.ffmpeg_version ?? "·"} mono />
              <Row label="ai"      value={sys.ai_online ? t("dashboard.sys_online") : t("dashboard.sys_offline")} tone={sys.ai_online ? "good" : "bad"} />
              <Row label="diarize"
                   value={sys.diarize_available ? t("dashboard.sys_ready")
                        : sys.diarize_token_present ? t("dashboard.sys_needs_terms")
                        : t("dashboard.sys_needs_token")}
                   tone={sys.diarize_available ? "good" : "muted"} />
              <Row label="engines" value={sys.backends_available.join(", ")} mono />
            </Stack>
          )}
        </Box>
      </Box>
      <LoadedModelsCard />
    </Stack>
  );
}

/** Live GPU util + VRAM. Two horizontal mini-bars, ~2.5s poll. Stops polling
 *  when ai goes offline so we don't hammer NATS with timeouts.
 *
 *  Why inline bars and not a chart: a sparkline would lie under our compositional
 *  rules (dashboard ≠ telemetry tool). The user only needs "is it busy" and
 *  "how much VRAM left" — not 30-second history. */
function GpuLive({ vramTotalMb }: { vramTotalMb: number }) {
  const q = useQuery({
    queryKey: ["gpu-stats"],
    queryFn: fetchGpuStats,
    refetchInterval: 2500,
    refetchIntervalInBackground: false,
  });
  const s = q.data;
  if (!s || !s.available) return null;
  const util = s.util_pct ?? 0;
  const memUsedGb = (s.mem_used_mb ?? 0) / 1024;
  const memTotalGb = (vramTotalMb || s.mem_total_mb || 1) / 1024;
  const memPct = Math.min(100, Math.round((memUsedGb / memTotalGb) * 100));

  return (
    <Stack spacing={0.75} sx={{ pl: 9, pr: 0.5, pt: 0.25 }}>
      <MiniBar label="util" pct={util} suffix={`${util}%${s.temp_c != null ? ` · ${s.temp_c}°` : ""}`} />
      <MiniBar label="vram" pct={memPct} suffix={`${memUsedGb.toFixed(1)} / ${memTotalGb.toFixed(1)} GB`} />
    </Stack>
  );
}

function MiniBar({ label, pct, suffix }: { label: string; pct: number; suffix: string }) {
  // Tone the bar warm as it approaches saturation — the user notices red on
  // "VRAM nearly full" without needing to read the number.
  const fill =
    pct >= 90 ? "var(--danger)" :
    pct >= 70 ? "var(--warning)" :
                "var(--accent)";
  return (
    <Stack direction="row" alignItems="center" spacing={1.25}>
      <Typography variant="caption" sx={{
        width: 36, color: "text.muted", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6,
      }}>
        {label}
      </Typography>
      <Box sx={{
        flex: 1, height: 4, borderRadius: 999,
        bgcolor: "var(--bg-subtle)", overflow: "hidden",
      }}>
        <Box sx={{
          // Animate transform, not width (DESIGN: no layout-property animation).
          height: "100%", width: "100%", transformOrigin: "left center",
          transform: `scaleX(${pct / 100})`, bgcolor: fill,
          transition: "transform 600ms cubic-bezier(0.22, 1, 0.36, 1), background-color 400ms",
        }} />
      </Box>
      <Typography variant="caption" className="font-mono" sx={{
        minWidth: 96, textAlign: "right", color: "text.secondary", fontSize: 11,
      }}>
        {suffix}
      </Typography>
    </Stack>
  );
}

function RecentBlock({ data, loading }: { data: JobView[] | undefined; loading: boolean }) {
  const { t } = useTranslation();
  return (
    <Box>
      <BlockHeader>{t("dashboard.recent_title")}</BlockHeader>
      <Box sx={{
        mt: 1.5,
        borderTop: data && data.length > 0 ? "1px solid var(--border-default)" : "none",
        borderBottom: data && data.length > 0 ? "1px solid var(--border-default)" : "none",
      }}>
        {loading && <Box sx={{ py: 2 }}><Skeleton height={28} /><Skeleton height={28} /><Skeleton height={28} /></Box>}
        {!loading && (!data || data.length === 0) && (
          <Box sx={{
            py: 4, px: 3, borderRadius: 1.5,
            bgcolor: "var(--bg-subtle)",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5,
          }}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {t("dashboard.recent_empty")}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.muted" }}>
              {t("history.empty_hint")}
            </Typography>
          </Box>
        )}
        {!loading && data?.map((j, i) => (
          <Box
            key={j.job_id} component={Link} to={`/jobs/${j.job_id}`}
            sx={{
              display: "grid", gap: 1.5, alignItems: "center",
              gridTemplateColumns: "1fr auto auto",
              py: 1.25,
              textDecoration: "none", color: "inherit",
              borderTop: i === 0 ? "none" : "1px solid var(--border-default)",
              "&:hover": { bgcolor: "var(--bg-subtle)" },
            }}
          >
            <Stack sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{
                fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {j.source_label ?? j.job_id.slice(-8)}
              </Typography>
              <Typography variant="caption" sx={{ color: "text.muted" }}>
                {j.model ?? "·"} · {formatLanguage(j.language)} · {j.duration_sec != null ? formatDuration(j.duration_sec) : "·"}
              </Typography>
            </Stack>
            <Typography variant="caption" sx={{ color: "text.muted" }}>
              {formatRelative(j.created_at)}
            </Typography>
            <ArrowForward sx={{ fontSize: 14, opacity: 0.4 }} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function BlockHeader({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="overline" sx={{ color: "text.muted", letterSpacing: 1 }}>
      {children}
    </Typography>
  );
}

function Row({
  label, value, mono, tone = "default",
}: { label: string; value: string; mono?: boolean; tone?: "default" | "good" | "bad" | "muted" }) {
  const colour =
    tone === "good"  ? "var(--success)" :
    tone === "bad"   ? "var(--danger)"  :
    tone === "muted" ? "var(--text-muted)" :
                       "var(--text-primary)";
  return (
    <Stack direction="row" alignItems="baseline" spacing={2}>
      <Typography variant="caption" sx={{
        minWidth: 64, color: "text.muted", textTransform: "uppercase", letterSpacing: 0.6, fontSize: 10,
      }}>
        {label}
      </Typography>
      <Typography variant="body2" className={mono ? "font-mono" : undefined} sx={{ color: colour }}>
        {value}
      </Typography>
    </Stack>
  );
}
