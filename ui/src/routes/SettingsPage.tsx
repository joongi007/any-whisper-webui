import { Box, MenuItem, Stack, Switch, TextField, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ModelSelect } from "../components/pipeline/ModelSelect";
import { BenchmarkPanel } from "../components/settings/BenchmarkPanel";
import { CacheCard } from "../components/settings/CacheCard";
import { HuggingFaceTokenCard } from "../components/settings/HuggingFaceTokenCard";
import { LoadedModelsCard } from "../components/settings/LoadedModelsCard";
import { useSettingsStore } from "../stores/settingsStore";

const COMPUTE_TYPES = [
  { value: "int8",          label: "int8",          hint: "smallest VRAM" },
  { value: "int8_float16",  label: "int8_float16",  hint: "balanced" },
  { value: "float16",       label: "float16",       hint: "default · GPU" },
  { value: "float32",       label: "float32",       hint: "highest accuracy · CPU fallback" },
];

export function SettingsPage() {
  const { t } = useTranslation();
  const s = useSettingsStore();
  const advanced = s.uiMode === "advanced";
  return (
    <Box sx={{ maxWidth: 560 }}>
      <Stack spacing={5}>
        <Section label={t("settings.general")}>
          <TextField select label={t("prefs.ui_mode")} size="small" value={s.uiMode}
              onChange={(e) => s.setPartial({ uiMode: e.target.value as never })}>
            <MenuItem value="simple">{t("mode.simple")}</MenuItem>
            <MenuItem value="advanced">{t("mode.advanced")}</MenuItem>
          </TextField>
        </Section>

        <Section label={t("common.model")}>
          <Stack spacing={2}>
            <TextField select label={t("common.backend")} size="small" value={s.backend}
                onChange={(e) => s.setPartial({ backend: e.target.value as never })}>
              <MenuItem value="faster_whisper">faster-whisper</MenuItem>
              <MenuItem value="openai_whisper">openai/whisper</MenuItem>
              <MenuItem value="insanely_fast_whisper">insanely-fast-whisper</MenuItem>
            </TextField>
            <ModelSelect value={s.model} backend={s.backend} onChange={(v) => s.setPartial({ model: v })} />
            {advanced && (
              <TextField select
                  label={t("settings.compute_type_label")}
                  size="small" value={s.computeType}
                  helperText={t("settings.compute_type_hint")}
                  onChange={(e) => s.setPartial({ computeType: e.target.value })}>
                {COMPUTE_TYPES.map((c) => (
                  <MenuItem key={c.value} value={c.value}>
                    <Box component="span" className="font-mono" sx={{ minWidth: 110, display: "inline-block" }}>
                      {c.label}
                    </Box>
                    <Box component="span" sx={{ color: "text.muted", fontSize: 12 }}>
                      {c.hint}
                    </Box>
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Stack>
        </Section>

        <Section label={t("settings.performance")}>
          <Stack spacing={2}>
            <TextField select size="small" label={t("settings.processing_label")}
                value={s.processingMode}
                helperText={t("settings.processing_hint")}
                onChange={(e) => s.setPartial({ processingMode: e.target.value as never })}>
              <MenuItem value="sequential">{t("settings.processing_sequential")}</MenuItem>
              <MenuItem value="batched">{t("settings.processing_batched")}</MenuItem>
            </TextField>
            {advanced && s.processingMode === "batched" && (
              <TextField
                  type="number" size="small" label={t("settings.batch_size_label")}
                  value={s.batchSize}
                  inputProps={{ min: 2, max: 32, step: 1 }}
                  onChange={(e) => s.setPartial({ batchSize: Math.max(2, Number(e.target.value) || 8) })} />
            )}
            <BenchmarkPanel />
          </Stack>
        </Section>

        {/* These two bring their own overline + status meta. Don't double-label. */}
        <LoadedModelsCard />
        <HuggingFaceTokenCard />

        <Section label={t("pipeline.translate_text")}>
          <Stack spacing={2}>
            <TextField select label={t("settings.translate_provider_label")} size="small" value={s.translateProvider}
                onChange={(e) => s.setPartial({ translateProvider: e.target.value as never })}>
              <MenuItem value="nllb">NLLB (CC-BY-NC)</MenuItem>
              <MenuItem value="deepl">DeepL</MenuItem>
            </TextField>
            <TextField
                label={t("settings.target_lang_label")} size="small" value={s.translateTarget}
                helperText={t("settings.target_lang_hint")}
                onChange={(e) => s.setPartial({ translateTarget: e.target.value })} />
          </Stack>
        </Section>

        <Section label={t("nav.realtime")}>
          <Toggle label={t("realtime.record_label")} hint={t("realtime.record_hint")}
              value={s.realtimeRecord} onChange={(v) => s.setPartial({ realtimeRecord: v })} />
        </Section>

        <CacheCard />

        {advanced && (
          <Section label={t("pipeline.title")}>
            <Typography variant="caption" sx={{
              display: "block", color: "text.muted", mb: 1.5,
            }}>
              {t("settings.pipeline_default_caption")}
            </Typography>
            <Stack spacing={0.5}>
              <Toggle label={t("pipeline.vad")} hint={t("pipeline.vad_hint")}
                  value={s.vadEnabled} onChange={(v) => s.setPartial({ vadEnabled: v })} />
              <Toggle label={t("pipeline.uvr")} hint={t("pipeline.uvr_hint")}
                  value={s.uvrEnabled} onChange={(v) => s.setPartial({ uvrEnabled: v })} />
              <Toggle label={t("pipeline.diarize")} hint={t("pipeline.diarize_hint")}
                  value={s.diarizeEnabled} onChange={(v) => s.setPartial({ diarizeEnabled: v })} />
              <Toggle label={t("pipeline.translate_text")} hint={t("pipeline.translate_hint")}
                  value={s.translateEnabled} onChange={(v) => s.setPartial({ translateEnabled: v })} />
            </Stack>
          </Section>
        )}
      </Stack>
    </Box>
  );
}

/** Flat section: just an overline + content. No bordered card around it. The
 *  shoulder of vertical space between sections (Stack spacing={5}) does the
 *  grouping work that the borders used to do, and it leaves the eye less to
 *  parse. */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box component="section">
      <Typography variant="overline" sx={{
        display: "block", color: "text.muted", letterSpacing: 0.8, mb: 1.5,
      }}>
        {label}
      </Typography>
      {children}
    </Box>
  );
}

function Toggle({
  label, value, onChange, hint,
}: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}
        sx={{ py: 1 }}>
      <Stack sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2">{label}</Typography>
        {hint && (
          <Typography variant="caption" sx={{ color: "text.muted", lineHeight: 1.4 }}>
            {hint}
          </Typography>
        )}
      </Stack>
      <Switch size="small" checked={value} onChange={(e) => onChange(e.target.checked)} sx={{ mt: -0.5 }} />
    </Stack>
  );
}
