import { Box, Button, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { type FileUploaded } from "../api/files";
import { createTranscribeJob } from "../api/jobs";
import { useToast } from "../components/feedback/toast";
import { AdvancedWhisperOptions } from "../components/pipeline/AdvancedWhisperOptions";
import { ModelSelect } from "../components/pipeline/ModelSelect";
import { PipelinePlan } from "../components/pipeline/PipelinePlan";
import { FileDropZone } from "../components/source/FileDropZone";
import { useJobsStore } from "../stores/jobsStore";
import { buildTranscribeOptions, useSettingsStore } from "../stores/settingsStore";
import { formatDuration } from "../utils/time";

const LANGS = ["auto", "ko", "en", "ja", "zh", "es", "fr", "de"];

export function FilePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const settings = useSettingsStore();
  const upsert = useJobsStore((s) => s.upsert);
  const toast = useToast();
  const [file, setFile] = useState<FileUploaded | null>(null);
  const [busy, setBusy] = useState(false);
  const advanced = settings.uiMode === "advanced";

  async function run() {
    if (!file) return;
    setBusy(true);
    try {
      const { job_id } = await createTranscribeJob({
        source: { kind: "file", file_id: file.file_id },
        backend: settings.backend, model: settings.model, language: settings.language, task: "transcribe",
        preprocess: {
          vad: { enabled: settings.vadEnabled, threshold: settings.vadThreshold },
          uvr: { enabled: settings.uvrEnabled, model: "htdemucs", stem: "vocals" },
        },
        postprocess: {
          diarize: {
            enabled: settings.diarizeEnabled,
            min_speakers: settings.diarizeMinSpeakers,
            max_speakers: settings.diarizeMaxSpeakers,
          },
          translate_text: { enabled: settings.translateEnabled,
                            provider: settings.translateProvider,
                            target_lang: settings.translateTarget },
        },
        options: buildTranscribeOptions(settings),
      });
      upsert({ job_id, kind: "transcribe", status: "queued", stage: "queued", progress: 0,
               started_at: null, finished_at: null, error: null, result: null });
      toast.success(t("toast.job_started"));
      nav(`/jobs/${job_id}`);
    } catch (err) {
      console.error("createTranscribeJob failed", err);
      toast.error(t("toast.job_start_failed"));
    } finally { setBusy(false); }
  }

  return (
    <Box className={advanced ? "grid gap-4 lg:grid-cols-[1fr_320px]" : "max-w-2xl"}>
      <Stack spacing={2}>
        <FileDropZone onUploaded={setFile} />
        {file && (
          <Typography variant="body2" sx={{ color: "text.secondary", pl: 0.5 }}>
            {t("file.selected")}: <Box component="span" sx={{ color: "text.primary", fontWeight: 500 }}>{file.filename}</Box> · <Box component="span" className="font-mono">{formatDuration(file.duration_sec)}</Box>
          </Typography>
        )}

        {advanced && (
          <>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <TextField select size="small" label={t("common.backend")} value={settings.backend}
                  onChange={(e) => settings.setPartial({ backend: e.target.value as never })}>
                <MenuItem value="faster_whisper">faster-whisper</MenuItem>
                <MenuItem value="openai_whisper">openai/whisper</MenuItem>
                <MenuItem value="insanely_fast_whisper">insanely-fast-whisper</MenuItem>
              </TextField>
              <ModelSelect value={settings.model} backend={settings.backend}
                  onChange={(v) => settings.setPartial({ model: v })} />
              <TextField select size="small" label={t("common.language")} value={settings.language}
                  onChange={(e) => settings.setPartial({ language: e.target.value })}>
                {LANGS.map((l) => <MenuItem key={l} value={l}>{l === "auto" ? t("common.auto") : l}</MenuItem>)}
              </TextField>
            </Stack>
            <AdvancedWhisperOptions />
          </>
        )}

        <Stack direction="row">
          <Button variant="contained" disabled={!file || busy} onClick={() => void run()}>
            {advanced ? t("common.run") : t("file.transcribe_simple")}
          </Button>
          {!advanced && (
            <Typography variant="caption" sx={{ ml: 2, alignSelf: "center", color: "text.secondary" }}>
              {t("file.simple_hint")}
            </Typography>
          )}
        </Stack>
      </Stack>
      {advanced && <PipelinePlan />}
    </Box>
  );
}
