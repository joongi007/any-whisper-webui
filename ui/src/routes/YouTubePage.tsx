import { Box, Button, Stack, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { createTranscribeJob } from "../api/jobs";
import { fetchYouTubeMeta, type YouTubeMeta } from "../api/youtube";
import { useToast } from "../components/feedback/toast";
import { AdvancedWhisperOptions } from "../components/pipeline/AdvancedWhisperOptions";
import { DiarizeQuickToggle } from "../components/pipeline/DiarizeQuickToggle";
import { PipelinePlan } from "../components/pipeline/PipelinePlan";
import { useJobsStore } from "../stores/jobsStore";
import { buildTranscribeOptions, useSettingsStore } from "../stores/settingsStore";
import { formatDuration } from "../utils/time";

export function YouTubePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const settings = useSettingsStore();
  const upsert = useJobsStore((s) => s.upsert);
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [meta, setMeta] = useState<YouTubeMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const advanced = settings.uiMode === "advanced";

  async function loadMeta() {
    if (!url) return;
    setBusy(true);
    try {
      setMeta(await fetchYouTubeMeta(url));
    } catch (err) {
      console.error("fetchYouTubeMeta failed", err);
      toast.error(t("toast.youtube_meta_failed"));
    } finally { setBusy(false); }
  }

  async function run() {
    setBusy(true);
    try {
      const { job_id } = await createTranscribeJob({
        source: { kind: "youtube", url },
        backend: settings.backend, model: settings.model, language: settings.language,
        preprocess: {
          vad: { enabled: settings.vadEnabled, threshold: settings.vadThreshold },
          uvr: { enabled: settings.uvrEnabled },
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
        <TextField label={t("youtube.url_label")} placeholder={t("youtube.url_placeholder")}
            value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => void loadMeta()} fullWidth />
        {meta && (
          <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
            {meta.thumbnail && <img src={meta.thumbnail} alt="" style={{ width: 160, borderRadius: 6 }} />}
            <Stack sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>{meta.title}</Typography>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {meta.uploader} · {formatDuration(meta.duration_sec)}
              </Typography>
              <Typography variant="caption" sx={{ color: "warning.main", mt: 1 }}>
                {t("youtube.responsibility")}
              </Typography>
            </Stack>
          </Stack>
        )}

        {/* Simple-mode promotion of the one pipeline knob that genuinely
            changes the *output* (not just speed). YouTube is mostly podcasts
            and panels — having to switch to Advanced to find the speaker
            split was the silent failure mode. */}
        {!advanced && <DiarizeQuickToggle />}

        {advanced && <AdvancedWhisperOptions />}

        <Stack direction="row">
          <Button variant="contained" disabled={!url || busy} onClick={() => void run()}>
            {advanced ? t("common.run") : t("file.transcribe_simple")}
          </Button>
        </Stack>
      </Stack>
      {advanced && <PipelinePlan />}
    </Box>
  );
}
