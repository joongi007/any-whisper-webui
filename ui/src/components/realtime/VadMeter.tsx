import { Box, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";

/** Horizontal probability bar with a threshold marker. Shows the user
 *  whether the mic is picking anything up and whether the threshold is
 *  reasonable. */
export function VadMeter({
  prob, threshold, speech,
}: { prob: number; threshold: number; speech: boolean }) {
  const { t } = useTranslation();
  const pct = Math.max(0, Math.min(1, prob)) * 100;
  const thrPct = Math.max(0, Math.min(1, threshold)) * 100;

  // Three states: silent (prob < 0.05), listening (some sound but below
  // threshold), speech (above threshold). The dot + label pair reads cleanly
  // against the rest of the page — emoji felt like a tutorial codepen.
  const state =
    prob < 0.05 ? "silent" :
    speech     ? "speech" :
                 "listening";
  const stateColor =
    state === "speech"   ? "var(--success)" :
    state === "silent"   ? "var(--text-muted)" :
                           "var(--text-secondary)";
  const stateLabel =
    state === "speech"   ? t("realtime.vad_speech") :
    state === "silent"   ? t("realtime.vad_silent") :
                           t("realtime.vad_listening");

  return (
    <Stack spacing={0.5}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="caption" sx={{ color: "text.secondary", minWidth: 110 }}>
          VAD probability
        </Typography>
        <Typography variant="caption" className="font-mono">{prob.toFixed(2)} / {threshold.toFixed(2)}</Typography>
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ ml: "auto" }}>
          <Box sx={{
            width: 6, height: 6, borderRadius: "50%", bgcolor: stateColor,
            transition: "background-color 140ms cubic-bezier(0.16, 1, 0.3, 1)",
          }} />
          <Typography variant="caption" sx={{ color: stateColor, fontWeight: 500 }}>
            {stateLabel}
          </Typography>
        </Stack>
      </Stack>
      <Box sx={{
        position: "relative", height: 6, borderRadius: 999,
        bgcolor: "var(--bg-subtle)", overflow: "hidden",
      }}>
        <Box sx={{
          // Animate transform, not width (DESIGN: no layout-property animation).
          position: "absolute", top: 0, left: 0, bottom: 0, width: "100%",
          transformOrigin: "left center", transform: `scaleX(${pct / 100})`,
          bgcolor: speech ? "var(--success)" : "var(--text-secondary)",
          transition: "transform 100ms linear, background-color 140ms",
        }} />
        <Box sx={{
          position: "absolute", top: -2, bottom: -2, left: `${thrPct}%`,
          width: 1, bgcolor: "var(--warning)",
        }} />
      </Box>
    </Stack>
  );
}
