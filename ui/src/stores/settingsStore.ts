import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface SettingsState {
  uiMode: "simple" | "advanced";
  backend: "faster_whisper" | "openai_whisper" | "insanely_fast_whisper";
  model: string;
  language: string;
  computeType: string;

  // Pre/post pipeline toggles
  vadEnabled: boolean;
  vadThreshold: number;           // 0..1 (silero), default 0.5
  uvrEnabled: boolean;
  diarizeEnabled: boolean;
  // Diarization hints. null = let pyannote estimate. Setting these tightens
  // clustering when the user knows the cast size (typical for podcasts).
  diarizeMinSpeakers: number | null;
  diarizeMaxSpeakers: number | null;
  translateEnabled: boolean;
  translateProvider: "nllb" | "deepl";
  translateTarget: string;

  // Whisper hallucination guards — Advanced mode exposes these.
  noSpeechThreshold: number;            // higher → more aggressive silence skip
  conditionOnPreviousText: boolean;     // false kills cross-segment repetition
  compressionRatioThreshold: number;    // drop suspiciously redundant text
  logProbThreshold: number;             // filter low-confidence segments
  repetitionPenalty: number;            // faster-whisper / HF only
  // faster-whisper: when VAD finds a silent run longer than this (sec), drop
  // any text Whisper produced during that span — kills the "Thanks for
  // watching" hallucination at the end of files. 0 = disabled.
  hallucinationSilenceThreshold: number;

  // Transcript viewer layout — only meaningful when translate_text was enabled
  // (otherwise no translation column to split into).
  transcriptLayout: "inline" | "split";

  // Realtime: persist session audio to disk so the session can be played back,
  // edited, and region-retranscribed like a file job. Default on.
  realtimeRecord: boolean;

  setPartial: (patch: Partial<SettingsState>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      uiMode: "simple",
      backend: "faster_whisper",
      model: "large-v3-turbo",
      language: "auto",
      computeType: "float16",

      vadEnabled: true,
      vadThreshold: 0.5,
      uvrEnabled: false,
      diarizeEnabled: false,
      diarizeMinSpeakers: null,
      diarizeMaxSpeakers: null,
      translateEnabled: false,
      translateProvider: "nllb",
      translateTarget: "en",

      noSpeechThreshold: 0.6,
      conditionOnPreviousText: false,
      compressionRatioThreshold: 2.2,
      logProbThreshold: -1.0,
      repetitionPenalty: 1.0,
      hallucinationSilenceThreshold: 2.0,

      transcriptLayout: "inline",
      realtimeRecord: true,

      setPartial: (patch) => set((s) => ({ ...s, ...patch })),
    }),
    {
      name: "whisper-settings",
      version: 5,
      migrate: (persisted, fromVersion) => {
        const old = (persisted ?? {}) as Partial<SettingsState>;
        let next = old;
        if (fromVersion < 2) {
          next = {
            ...next,
            vadThreshold: 0.5,
            noSpeechThreshold: 0.6,
            conditionOnPreviousText: false,
            compressionRatioThreshold: 2.4,
            logProbThreshold: -1.0,
            repetitionPenalty: 1.0,
          };
        }
        if (fromVersion < 3) {
          // v3 added diarize speaker-count hints. null = auto-estimate.
          next = { ...next, diarizeMinSpeakers: null, diarizeMaxSpeakers: null };
        }
        if (fromVersion < 4) {
          // v4 added hallucination_silence_threshold. Default 2.0s — pulls
          // existing users in with the new guard on. They can disable in
          // Advanced if it's too aggressive on their content.
          next = { ...next, hallucinationSilenceThreshold: 2.0 };
        }
        if (fromVersion < 5) {
          // v5 added realtime audio recording. Default on.
          next = { ...next, realtimeRecord: true };
        }
        return next as SettingsState;
      },
    },
  ),
);

/** Build the options dict the API expects under `TranscribeRequest.options`. */
export function buildTranscribeOptions(s: SettingsState): Record<string, unknown> {
  return {
    word_timestamps: true,
    compute_type: s.computeType,
    no_speech_threshold: s.noSpeechThreshold,
    condition_on_previous_text: s.conditionOnPreviousText,
    compression_ratio_threshold: s.compressionRatioThreshold,
    log_prob_threshold: s.logProbThreshold,
    repetition_penalty: s.repetitionPenalty,
    // 0 (or negative) is "disabled" on the backend side — passing null instead
    // would force every backend to interpret it; explicit zero is cleaner.
    hallucination_silence_threshold:
      s.hallucinationSilenceThreshold > 0 ? s.hallucinationSilenceThreshold : null,
  };
}
