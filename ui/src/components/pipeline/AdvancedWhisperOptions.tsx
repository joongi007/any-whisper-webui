import { Box, Slider, Stack, Switch, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";

import { useSettingsStore } from "../../stores/settingsStore";

/** Hallucination & decoding knobs visible only in Advanced mode.
 *  Defaults match the Simple-mode conservative preset, so changes here
 *  always trace to an explicit user action. */
export function AdvancedWhisperOptions() {
  const { t } = useTranslation();
  const s = useSettingsStore();

  return (
    <Box sx={{ pt: 1, borderTop: "1px solid var(--border-default)" }}>
      <Typography variant="overline" sx={{
        display: "block", color: "text.muted", letterSpacing: 0.8, mb: 1.5,
      }}>
        {t("advanced.title")}
      </Typography>
      <Stack spacing={2}>
        <SliderRow
          label="no_speech_threshold" value={s.noSpeechThreshold}
          min={0} max={1} step={0.05}
          onChange={(v) => s.setPartial({ noSpeechThreshold: v })}
          hint={t("advanced.no_speech_hint")}
        />
        <SliderRow
          label="compression_ratio_threshold" value={s.compressionRatioThreshold}
          min={1.0} max={5.0} step={0.1}
          onChange={(v) => s.setPartial({ compressionRatioThreshold: v })}
          hint={t("advanced.compression_hint")}
        />
        <SliderRow
          label="log_prob_threshold" value={s.logProbThreshold}
          min={-3.0} max={0.0} step={0.1}
          onChange={(v) => s.setPartial({ logProbThreshold: v })}
          hint={t("advanced.logprob_hint")}
        />
        <SliderRow
          label="repetition_penalty" value={s.repetitionPenalty}
          min={1.0} max={2.0} step={0.05}
          onChange={(v) => s.setPartial({ repetitionPenalty: v })}
          hint={t("advanced.repetition_hint")}
        />
        <SliderRow
          label="hallucination_silence_threshold" value={s.hallucinationSilenceThreshold}
          min={0} max={5} step={0.25}
          onChange={(v) => s.setPartial({ hallucinationSilenceThreshold: v })}
          hint={t("advanced.hallucination_silence_hint")}
        />
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Box>
            <Typography variant="body2">condition_on_previous_text</Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {t("advanced.condition_hint")}
            </Typography>
          </Box>
          <Switch checked={s.conditionOnPreviousText}
              onChange={(e) => s.setPartial({ conditionOnPreviousText: e.target.checked })} />
        </Stack>
      </Stack>
    </Box>
  );
}

function SliderRow({
  label, value, min, max, step, onChange, hint,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; hint?: string;
}) {
  return (
    <Stack spacing={0.25}>
      <Stack direction="row" alignItems="center" spacing={2}>
        <Typography variant="body2" sx={{ minWidth: 220 }} className="font-mono">{label}</Typography>
        <Slider size="small" value={value} min={min} max={max} step={step}
            onChange={(_, v) => onChange(Array.isArray(v) ? v[0] : v)} sx={{ maxWidth: 280 }} />
        <Typography variant="caption" className="font-mono" sx={{ minWidth: 48, textAlign: "right" }}>
          {value.toFixed(2)}
        </Typography>
      </Stack>
      {hint && <Typography variant="caption" sx={{ color: "text.secondary", ml: "220px" }}>{hint}</Typography>}
    </Stack>
  );
}
