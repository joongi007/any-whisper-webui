import {
  Check, FiberManualRecord, Mic, PlayCircleFilledWhite, Stop, Tv,
} from "@mui/icons-material";
import {
  Box, Button, CircularProgress, MenuItem, Slider, Stack, Switch, TextField,
  Typography,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { startCapture, type AudioCaptureHandle, type CaptureSource } from "../audio/AudioCaptureWorklet";
import { RealtimeStream } from "../audio/RealtimeStream";
import { StatusBlock } from "../components/feedback/StatusBlock";
import { AdvancedWhisperOptions } from "../components/pipeline/AdvancedWhisperOptions";
import { ModelSelect } from "../components/pipeline/ModelSelect";
import { VadMeter } from "../components/realtime/VadMeter";
import { LiveTranscript } from "../components/transcript/LiveTranscript";
import { useRealtimeStore } from "../stores/realtimeStore";
import { buildTranscribeOptions, useSettingsStore } from "../stores/settingsStore";

const LANGS = ["auto", "ko", "en", "ja", "zh", "es", "fr", "de"];

/** A session is in one of these visible states. Drives the big status block
 *  at the top of the page so the user knows whether to wait, talk, or stop.
 *
 *  - idle:      no session active, never started in this page-mount
 *  - preparing: ws open, waiting for ai `ready` (model may be loading)
 *  - ready:     ai accepted the session, but the user hasn't spoken yet
 *  - listening: connected + at least one audio chunk has been routed
 *  - stopped:   user pressed Stop (or the ws closed). transcript persisted. */
type Phase = "idle" | "preparing" | "ready" | "listening" | "stopped";

export function RealtimePage() {
  const { t } = useTranslation();
  const settings = useSettingsStore();
  const rt = useRealtimeStore();
  const [source, setSource] = useState<CaptureSource>("mic");
  const [translateOn, setTranslateOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [prepStart, setPrepStart] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [savedSid, setSavedSid] = useState<string | null>(null);
  const advanced = settings.uiMode === "advanced";

  const captureRef = useRef<AudioCaptureHandle | null>(null);
  const streamRef = useRef<RealtimeStream | null>(null);

  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Elapsed-time tick for the preparing block — purely cosmetic but it gives
  // the user a "yes, things are happening" signal during the cold start.
  useEffect(() => {
    if (phase !== "preparing" || prepStart == null) return;
    const id = window.setInterval(
      () => setElapsed(Math.round((Date.now() - prepStart) / 1000)),
      250,
    );
    return () => window.clearInterval(id);
  }, [phase, prepStart]);

  // Esc during preparing exits the cold-start wait. The wait can be ~10s on
  // first connect; without an out the only escape is page refresh.
  useEffect(() => {
    if (phase !== "preparing") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        stop();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // stop() is defined in scope but referentially stable enough; rebinding
    // on every render is harmless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  async function connect() {
    setError(null);
    rt.clear();
    setSavedSid(null);
    setPhase("preparing");
    setPrepStart(Date.now());
    setElapsed(0);
    try {
      const stream = new RealtimeStream({
        onEvent: (e) => {
          if (e.type === "level") rt.setLevel(e.rms_db);
          else if (e.type === "vad") rt.setLive(e.speech);
          else if (e.type === "vad_meter") rt.setVadMeter(e.prob, e.threshold, e.speech);
          else if (e.type === "partial") {
            if (phase !== "listening") setPhase("listening");
            rt.applyPartial({ start: e.start, end: e.end, text: e.text });
          }
          else if (e.type === "final") {
            if (phase !== "listening") setPhase("listening");
            rt.applyFinal({
              start: e.start, end: e.end, text: e.text, speaker: e.speaker,
              translation: e.translation?.text ?? null,
            });
          }
          else if (e.type === "ready") {
            setPhase("ready");
            if (e.session_id) setSavedSid(e.session_id);
          }
          else if (e.type === "error") {
            setError(`${e.code}: ${e.message}`);
            setPhase("idle");
          }
        },
        onClose: () => { rt.setLive(false); setPhase((p) => (p === "idle" ? "idle" : "stopped")); },
      });
      await stream.connect({
        backend: settings.backend, model: settings.model,
        language: settings.language, task: "transcribe",
        vad: { enabled: settings.vadEnabled, threshold: settings.vadThreshold },
        translateText: {
          enabled: translateOn, provider: settings.translateProvider, target_lang: settings.translateTarget,
        },
        options: buildTranscribeOptions(settings),
        record: settings.realtimeRecord,
      });
      streamRef.current = stream;
      const cap = await startCapture(source, {
        onChunk: (pcm) => stream.sendPcm(pcm),
        onError: (e) => setError(String(e)),
      });
      captureRef.current = cap;
      rt.setLive(true);
    } catch (e) {
      setError(String(e));
      setPhase("idle");
    }
  }

  function stop() {
    captureRef.current?.stop();
    streamRef.current?.stop();
    captureRef.current = null;
    streamRef.current = null;
    rt.setLive(false);
    setPhase((p) => (p === "idle" ? "idle" : "stopped"));
  }

  function onThresholdChange(_e: Event, v: number | number[]) {
    const val = Array.isArray(v) ? v[0] : v;
    settings.setPartial({ vadThreshold: val });
    streamRef.current?.sendConfig({ vad: { enabled: settings.vadEnabled, threshold: val } });
  }

  const active = phase === "ready" || phase === "listening";

  return (
    <Box sx={{ maxWidth: 880 }}>
      <Stack spacing={2}>
        <PhaseStatus phase={phase} elapsed={elapsed}
            segmentCount={rt.segments.length}
            savedSid={phase === "stopped" ? savedSid : null} />

        <Stack direction="row" alignItems="center" spacing={2} flexWrap="wrap" useFlexGap>
          {/* Binary source choice — a slim text-toggle reads cleaner than
              a heavy ToggleButtonGroup. The icons did no work the labels
              didn't already do. `flexShrink: 0` so the labels don't
              character-wrap when the connect button is wide. */}
          <Stack direction="row" alignItems="center" spacing={0.25}
              sx={{ color: "text.muted", flexShrink: 0 }}>
            <SourceText label={t("realtime.source_mic")} icon={<Mic sx={{ fontSize: 14 }} />}
                active={source === "mic"} disabled={active}
                onClick={() => setSource("mic")} />
            <Box sx={{ width: "1px", height: 14, bgcolor: "var(--border-default)", flexShrink: 0 }} />
            <SourceText label={t("realtime.source_tab")} icon={<Tv sx={{ fontSize: 14 }} />}
                active={source === "tab"} disabled={active}
                onClick={() => setSource("tab")} />
          </Stack>

          <Box sx={{ flex: 1 }} />

          {!active ? (
            <Button variant="contained" onClick={() => void connect()} disabled={phase === "preparing"}
                sx={{ minWidth: 120, flexShrink: 0 }}>
              {phase === "preparing"
                ? t("realtime.preparing")
                : phase === "stopped"
                  ? t("realtime.new_session")
                  : t("realtime.connect")}
            </Button>
          ) : (
            <Button variant="outlined" color="error" startIcon={<Stop />} onClick={stop}
                sx={{ minWidth: 120, flexShrink: 0 }}>
              {t("realtime.stop")}
            </Button>
          )}
          {rt.isLive && (
            // Match the listening StatusBlock's success tone — having the same
            // signal in two opposite colours (was: error red here vs. success
            // green in the StatusBlock) made the page read as inconsistent.
            <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flexShrink: 0, color: "var(--success)" }}>
              <FiberManualRecord sx={{ color: "inherit", fontSize: 12 }} className="ww-pulse" />
              <Typography variant="caption" sx={{ color: "inherit", fontWeight: 700, letterSpacing: 0.6 }}>
                {t("realtime.live")}
              </Typography>
            </Stack>
          )}
        </Stack>

        {source === "tab" && (
          <Typography variant="caption" sx={{ color: "warning.main" }}>
            {t("realtime.tab_share_hint")}
          </Typography>
        )}

        <VadMeter prob={rt.vadProb} threshold={rt.vadThreshold || settings.vadThreshold} speech={rt.vadSpeech} />

        {advanced && (
          <Stack spacing={1.5} sx={{
            p: 2, borderRadius: 1.5, bgcolor: "var(--bg-subtle)",
          }}>
            <Stack spacing={0.25}>
              <Stack direction="row" alignItems="center" spacing={2}>
                <Typography variant="body2" sx={{ minWidth: 130, fontWeight: 500 }}>
                  {t("realtime.vad_threshold_label")}
                </Typography>
                <Slider size="small" value={settings.vadThreshold}
                    min={0.1} max={0.95} step={0.05} onChange={onThresholdChange}
                    sx={{ maxWidth: 320 }} />
                <Typography variant="caption" className="font-mono" sx={{ minWidth: 36 }}>
                  {settings.vadThreshold.toFixed(2)}
                </Typography>
              </Stack>
              <Typography variant="caption" sx={{ color: "text.secondary", pl: "146px" }}>
                {t("realtime.vad_hint")}
              </Typography>
            </Stack>
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
          </Stack>
        )}

        {/* Same hallucination/decoding knobs File and YouTube get. Realtime
            users (Alex) need symmetric controls — same knobs everywhere
            inference happens. */}
        {advanced && <AdvancedWhisperOptions />}

        <Stack direction="row" alignItems="center" spacing={1}>
          <Switch checked={translateOn} disabled={active} onChange={(e) => setTranslateOn(e.target.checked)} />
          <Typography variant="body2">{t("pipeline.translate_text")} → {settings.translateTarget}</Typography>
        </Stack>

        <Stack direction="row" alignItems="center" spacing={1}>
          <Switch checked={settings.realtimeRecord} disabled={active}
              onChange={(e) => settings.setPartial({ realtimeRecord: e.target.checked })} />
          <Box>
            <Typography variant="body2">{t("realtime.record_label")}</Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {t("realtime.record_hint")}
            </Typography>
          </Box>
        </Stack>

        {error && <Typography variant="body2" color="error">{error}</Typography>}

        <LiveTranscript />
      </Stack>
    </Box>
  );
}

/** Slim source toggle — like a tab strip without the chrome. The active
 *  option uses 500-weight + text.primary; inactive is text.muted. Clicking
 *  an inactive one swaps. Disabled (during an active session) goes to
 *  text.disabled so it reads as locked, not just unfocused. */
function SourceText({
  label, icon, active, disabled, onClick,
}: {
  label: string; icon: React.ReactNode;
  active: boolean; disabled: boolean; onClick: () => void;
}) {
  return (
    <Box
      component="button" type="button" onClick={onClick} disabled={disabled}
      sx={{
        display: "inline-flex", alignItems: "center", gap: 0.5,
        background: "none", border: "none", cursor: disabled ? "not-allowed" : "pointer",
        px: 0.75, py: 0.5, borderRadius: 0.75,
        fontSize: 12, lineHeight: 1.2,
        fontWeight: active ? 500 : 400,
        color: disabled ? "text.disabled" : active ? "text.primary" : "text.muted",
        whiteSpace: "nowrap", flexShrink: 0,
        transition: "color 140ms cubic-bezier(0.16, 1, 0.3, 1)",
        "&:hover": disabled ? {} : { color: "text.primary" },
      }}
    >
      {icon}
      {label}
    </Box>
  );
}

/** Large status block at the top — the user shouldn't have to interpret a
 *  small button label to know whether the system is busy. All five phases
 *  funnel through the shared `StatusBlock`, so padding / radius / no-border
 *  are guaranteed-consistent with JobDetailPage and the HF card. */
function PhaseStatus({
  phase, elapsed, segmentCount, savedSid,
}: { phase: Phase; elapsed: number; segmentCount: number; savedSid: string | null }) {
  const { t } = useTranslation();

  if (phase === "idle") {
    return (
      <StatusBlock tone="neutral">
        <Typography variant="body2" sx={{ color: "inherit" }}>
          {t("realtime.idle_hint")}
        </Typography>
      </StatusBlock>
    );
  }

  if (phase === "preparing") {
    return (
      <StatusBlock tone="accent" icon={<CircularProgress size={18} sx={{ color: "inherit" }} />}>
        <Typography variant="body2" sx={{ fontWeight: 500, color: "inherit" }}>
          {t("realtime.preparing_title", { sec: elapsed })}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
          {t("realtime.preparing_hint")}
        </Typography>
      </StatusBlock>
    );
  }

  if (phase === "ready") {
    return (
      <StatusBlock tone="accent" icon={<PlayCircleFilledWhite sx={{ color: "inherit", fontSize: 18 }} />}>
        <Typography variant="body2" sx={{ fontWeight: 500, color: "inherit" }}>
          {t("realtime.ready_hint")}
        </Typography>
      </StatusBlock>
    );
  }

  if (phase === "listening") {
    return (
      <StatusBlock tone="success"
          icon={<FiberManualRecord className="ww-pulse" sx={{ color: "inherit", fontSize: 14 }} />}>
        <Typography variant="body2" sx={{ fontWeight: 500, color: "inherit" }}>
          {t("realtime.listening_hint", { count: segmentCount })}
        </Typography>
      </StatusBlock>
    );
  }

  // stopped — also the home for the "saved to History" link when the
  // session actually produced a transcript. Tone switches between success
  // (we saved something) and neutral (empty session), keeping a single
  // banner instead of two.
  const wasSaved = savedSid != null && segmentCount > 0;
  return (
    <StatusBlock
      tone={wasSaved ? "success" : "neutral"}
      icon={<Check fontSize="small" sx={{ color: "inherit" }} />}
      action={wasSaved ? (
        <Button
          size="small" variant="text"
          component={Link} to={`/jobs/${savedSid}`}
          sx={{
            color: "inherit", fontWeight: 500,
            "&:hover": { bgcolor: "transparent", textDecoration: "underline" },
          }}
        >
          {t("realtime.open_saved")} →
        </Button>
      ) : undefined}
    >
      <Typography variant="body2" sx={{ color: "inherit" }}>
        {t("realtime.stopped_hint", { count: segmentCount })}
      </Typography>
    </StatusBlock>
  );
}
