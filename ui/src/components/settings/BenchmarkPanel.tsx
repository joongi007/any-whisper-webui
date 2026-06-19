import { CheckCircle, Speed, StopCircle } from "@mui/icons-material";
import {
  Box, Button, CircularProgress, Stack, Typography,
} from "@mui/material";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { cancelBenchmark, runBenchmark, type BenchmarkStrategy } from "../../api/system";
import { BENCH_STALE_MS, useBenchmarkStore } from "../../stores/benchmarkStore";
import { useSettingsStore, type SettingsState } from "../../stores/settingsStore";
import { useToast } from "../feedback/toast";

/** Human label for a strategy key ("batched_8" → "배치 (8)"). */
export function strategyLabel(key: string, t: TFunction): string {
  if (key.startsWith("batched_")) return t("bench.strat_batched", { size: key.split("_")[1] });
  if (key.startsWith("concurrent_")) return t("bench.strat_concurrent", { n: key.split("_")[1] });
  if (key === "sequential") return t("bench.strat_sequential");
  return key;
}

/** Map a strategy to settings; returns false if it can't be applied from the UI
 *  (concurrent = multi-process, which is a deployment-time `--scale`, not a
 *  runtime toggle). */
function applyStrategy(key: string, setPartial: (p: Partial<SettingsState>) => void): boolean {
  if (key.startsWith("batched")) {
    const n = parseInt(key.split("_")[1] || "8", 10);
    setPartial({ processingMode: "batched", batchSize: Number.isFinite(n) ? n : 8 });
    return true;
  }
  if (key.startsWith("sequential")) {
    setPartial({ processingMode: "sequential" });
    return true;
  }
  return false; // concurrent_* — not a runtime setting
}

function fmtVram(mb?: number | null): string {
  if (!mb) return "·";
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`;
}

export function BenchmarkPanel() {
  const { t } = useTranslation();
  const toast = useToast();
  const model = useSettingsStore((s) => s.model);
  const computeType = useSettingsStore((s) => s.computeType);
  const setPartial = useSettingsStore((s) => s.setPartial);
  const result = useBenchmarkStore((s) => s.result);
  const setResult = useBenchmarkStore((s) => s.setResult);
  const storeRunning = useBenchmarkStore((s) => s.running);
  const startedAt = useBenchmarkStore((s) => s.startedAt);
  const setRunning = useBenchmarkStore((s) => s.setRunning);

  // A persisted "running" older than the stale window means the request was
  // abandoned (refresh); don't block forever on it.
  const running = storeRunning && (startedAt == null || Date.now() - startedAt < BENCH_STALE_MS);

  async function run() {
    if (running) return;
    setRunning(true);
    try {
      const r = await runBenchmark({ model, compute_type: computeType, clip_sec: 30 });
      if (r.error === "already_running") {
        // Another run is in flight (e.g. started before a refresh). Keep the
        // measuring state; don't start a second one.
        toast.info(t("bench.already_running"));
        return;
      }
      setResult(r); // clears running; partial (cancelled) results still shown
      if (r.cancelled) toast.info(t("bench.cancelled"));
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: { message?: string } } } })
        ?.response?.data?.detail?.message;
      console.error("benchmark failed", err);
      toast.error(detail || t("bench.failed"));
      setRunning(false);
    }
  }

  async function cancel() {
    try {
      await cancelBenchmark();
    } catch (err) {
      console.error("cancel benchmark failed", err);
    } finally {
      // Unblock the UI even if this client didn't own the in-flight run.
      setRunning(false);
    }
  }

  function apply(key: string) {
    if (applyStrategy(key, setPartial)) {
      toast.success(t("bench.applied", { strategy: strategyLabel(key, t) }));
    }
  }

  const valid = (result?.results ?? []).filter((r) => !r.error && r.throughput_xrt != null);
  const best = valid.reduce<BenchmarkStrategy | null>(
    (m, r) => (!m || (r.throughput_xrt ?? 0) > (m.throughput_xrt ?? 0) ? r : m), null);

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Speed sx={{ fontSize: 16, color: "text.muted" }} />
        <Typography sx={{ fontSize: 13, fontWeight: 500 }}>{t("bench.title")}</Typography>
        <Box sx={{ flex: 1 }} />
        {running ? (
          <>
            <CircularProgress size={13} sx={{ color: "text.muted", mr: 0.5 }} />
            <Button
              size="small" variant="outlined" color="error"
              startIcon={<StopCircle fontSize="small" />}
              onClick={() => void cancel()}
              sx={{ fontSize: 12 }}
            >
              {t("bench.stop")}
            </Button>
          </>
        ) : (
          <Button
            size="small" variant="outlined"
            onClick={() => void run()}
            sx={{ fontSize: 12 }}
          >
            {result ? t("bench.run_again") : t("bench.run")}
          </Button>
        )}
      </Stack>

      <Typography variant="caption" sx={{ color: "text.muted", display: "block", mb: result ? 1.5 : 0 }}>
        {running ? t("bench.running_hint") : t("bench.hint")}
      </Typography>

      {result && (
        <Stack spacing={1.5}>
          {/* Results table */}
          <Box sx={{
            border: "1px solid var(--border-default)", borderRadius: 1.5, overflow: "hidden",
          }}>
            <Box sx={{
              display: "grid", gridTemplateColumns: "1fr 70px 70px 64px", gap: 1,
              px: 1.5, py: 0.75, bgcolor: "var(--bg-subtle)",
              fontSize: 10, fontWeight: 500, letterSpacing: 0.6, textTransform: "uppercase",
              color: "text.muted",
            }}>
              <span>{t("bench.col_strategy")}</span>
              <span style={{ textAlign: "right" }}>{t("bench.col_throughput")}</span>
              <span style={{ textAlign: "right" }}>VRAM</span>
              <span />
            </Box>
            {(result.results ?? []).map((r) => {
              const isBest = best && r.strategy === best.strategy;
              const canApply = !r.error && !r.strategy.startsWith("concurrent");
              return (
                <Box key={r.strategy} sx={{
                  display: "grid", gridTemplateColumns: "1fr 70px 70px 64px", gap: 1,
                  px: 1.5, py: 0.75, alignItems: "center",
                  borderTop: "1px solid var(--border-default)",
                  bgcolor: isBest ? "var(--accent-soft)" : "transparent",
                }}>
                  <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 12, fontWeight: isBest ? 500 : 400 }} noWrap>
                      {strategyLabel(r.strategy, t)}
                    </Typography>
                    {isBest && <CheckCircle sx={{ fontSize: 13, color: "var(--accent)" }} />}
                  </Stack>
                  <Typography className="font-mono" sx={{ fontSize: 12, textAlign: "right",
                      color: r.error ? "var(--danger)" : "text.primary" }}>
                    {r.error ? "—" : `${r.throughput_xrt}×`}
                  </Typography>
                  <Typography className="font-mono" sx={{ fontSize: 12, textAlign: "right", color: "text.secondary" }}>
                    {r.error ? "—" : fmtVram(r.peak_vram_mb)}
                  </Typography>
                  <Box sx={{ textAlign: "right" }}>
                    {canApply && (
                      <Button size="small" onClick={() => apply(r.strategy)}
                          sx={{ fontSize: 11, minWidth: 0, px: 0.75, py: 0 }}>
                        {t("bench.apply")}
                      </Button>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>

          {/* Recommendation */}
          {result.recommendation && !result.recommendation.error && (
            <Box sx={{ fontSize: 12, color: "text.secondary" }}>
              <Box component="span" sx={{ fontWeight: 500, color: "text.primary" }}>
                {t("bench.recommend")}:
              </Box>{" "}
              {t("bench.rec_max")} {strategyLabel(result.recommendation.max_performance ?? "", t)} ·{" "}
              {t("bench.rec_safe")} {strategyLabel(result.recommendation.safe ?? "", t)}
            </Box>
          )}
          {(result.recommendation?.notes ?? []).map((n, i) => (
            <Typography key={i} variant="caption" sx={{ color: "text.muted", display: "block", lineHeight: 1.5 }}>
              · {n}
            </Typography>
          ))}
        </Stack>
      )}
    </Box>
  );
}
