import { InfoOutlined } from "@mui/icons-material";
import { Box, Stack, Switch, TextField, Tooltip, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { fetchSystemInfo } from "../../api/system";
import { useSettingsStore } from "../../stores/settingsStore";

export function PipelinePlan() {
  const { t } = useTranslation();
  const s = useSettingsStore();
  const sys = useQuery({ queryKey: ["system-info"], queryFn: fetchSystemInfo, staleTime: 30_000 });
  const diarizeAvailable = sys.data?.diarize_available ?? true;

  return (
    <Box sx={{
      pl: { lg: 2.5 },
      borderLeft: { lg: "1px solid var(--border-default)" },
    }}>
      <Typography variant="overline" sx={{
        display: "block", color: "text.muted", letterSpacing: 0.8, mb: 1.5,
      }}>
        {t("pipeline.title")}
      </Typography>
      <Stack spacing={1}>
        <Row label={t("pipeline.vad")} checked={s.vadEnabled} onChange={(v) => s.setPartial({ vadEnabled: v })} />
        <Row label={t("pipeline.uvr")} checked={s.uvrEnabled} onChange={(v) => s.setPartial({ uvrEnabled: v })} />
        <Row
          label={t("pipeline.diarize")}
          checked={s.diarizeEnabled}
          onChange={(v) => s.setPartial({ diarizeEnabled: v })}
          disabled={!diarizeAvailable}
          hint={diarizeAvailable ? undefined : t("pipeline.diarize_unavailable")}
        />
        {/* Cluster-count hints and the cost line only appear once diarize is
            actually on — they're irrelevant noise otherwise. Indent under
            the row so the parent-child relationship reads visually. */}
        {diarizeAvailable && s.diarizeEnabled && (
          <Stack spacing={0.75} sx={{ pl: 0, mt: -0.25 }}>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {t("pipeline.diarize_cost_hint")}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="caption" sx={{ color: "text.muted", minWidth: 60 }}>
                {t("pipeline.diarize_speakers_label")}
              </Typography>
              <SpeakerCountField
                value={s.diarizeMinSpeakers}
                onChange={(v) => s.setPartial({ diarizeMinSpeakers: v })}
                placeholder={t("pipeline.diarize_min")}
              />
              <Typography variant="caption" sx={{ color: "text.muted" }}>~</Typography>
              <SpeakerCountField
                value={s.diarizeMaxSpeakers}
                onChange={(v) => s.setPartial({ diarizeMaxSpeakers: v })}
                placeholder={t("pipeline.diarize_max")}
              />
              <Tooltip title={t("pipeline.diarize_speakers_hint")}>
                <InfoOutlined fontSize="inherit" sx={{ fontSize: 14, color: "text.secondary" }} />
              </Tooltip>
            </Stack>
          </Stack>
        )}
        <Row label={`${t("pipeline.translate_text")} → ${s.translateTarget}`}
             checked={s.translateEnabled} onChange={(v) => s.setPartial({ translateEnabled: v })} />
        {s.translateEnabled && s.translateProvider === "nllb" && (
          <Typography variant="caption" sx={{ color: "warning.main" }}>{t("license.nllb_warning")}</Typography>
        )}
      </Stack>
    </Box>
  );
}

function Row({
  label, checked, onChange, disabled, hint,
}: {
  label: string; checked: boolean; onChange: (v: boolean) => void;
  disabled?: boolean; hint?: string;
}) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between">
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ color: disabled ? "text.disabled" : "text.primary" }}>
          {label}
        </Typography>
        {hint && (
          <Tooltip title={hint}>
            <InfoOutlined fontSize="inherit" sx={{ fontSize: 14, color: "text.secondary" }} />
          </Tooltip>
        )}
      </Stack>
      <Switch size="small" checked={checked} disabled={disabled}
              onChange={(e) => onChange(e.target.checked)} />
    </Stack>
  );
}

/** Tiny number input for diarize min/max. Empty string = null (auto-estimate).
 *  Clamped to 1..20 — pyannote's clustering breaks down well before that. */
function SpeakerCountField({
  value, onChange, placeholder,
}: { value: number | null; onChange: (v: number | null) => void; placeholder: string }) {
  return (
    <TextField
      size="small" variant="outlined" type="number" placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") { onChange(null); return; }
        const n = Math.max(1, Math.min(20, Number(raw)));
        if (Number.isFinite(n)) onChange(n);
      }}
      inputProps={{ min: 1, max: 20, "aria-label": placeholder }}
      sx={{
        width: 70,
        "& .MuiInputBase-input": { fontSize: 12, py: 0.5, textAlign: "center" },
      }}
    />
  );
}
