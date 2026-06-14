import type { RetranscribeOverride } from "../../api/transcripts";

/** Region tuning presets — each bundles the decode + preprocessing options
 *  that work for a kind of audio. Simple mode picks a preset; Advanced mode
 *  takes the preset as a starting point and lets the user tweak individual
 *  knobs. Adding a preset is a one-object change here.
 *
 *  `speech` is the no-op default (inherit the job's options). `song` is the
 *  reason this whole feature exists — UVR vocal isolation + a low VAD floor so
 *  the model hears sung vocals over a backing track. */
export type RegionPresetId = "speech" | "song" | "noisy" | "custom";

export interface RegionPreset {
  id: RegionPresetId;
  /** i18n key suffix under `region.preset_*`. */
  labelKey: string;
  /** Override sent to the API. `custom` carries nothing — the Advanced panel
   *  supplies everything. */
  override: RetranscribeOverride;
}

export const REGION_PRESETS: RegionPreset[] = [
  {
    id: "speech",
    labelKey: "speech",
    // Inherit the parent job's options unchanged.
    override: {},
  },
  {
    id: "song",
    labelKey: "song",
    override: {
      uvr: { enabled: true, stem: "vocals" },
      // VAD OFF on purpose: silero is tuned for spoken speech and rejects sung
      // vocals as "non-speech", filtering everything out. UVR already isolates
      // the vocal, so we feed the whole span to whisper without a VAD gate.
      vad: { enabled: false },
      temperature: 0,
      condition_on_previous_text: false,
      // Lower silence threshold so quiet/held vocal notes aren't skipped.
      no_speech_threshold: 0.3,
      initial_prompt: "Lyrics:",
    },
  },
  {
    id: "noisy",
    labelKey: "noisy",
    override: {
      vad: { enabled: true, threshold: 0.6 },
      no_speech_threshold: 0.7,
      compression_ratio_threshold: 2.0,
      condition_on_previous_text: false,
    },
  },
  {
    id: "custom",
    labelKey: "custom",
    override: {},
  },
];

export function presetById(id: RegionPresetId): RegionPreset {
  return REGION_PRESETS.find((p) => p.id === id) ?? REGION_PRESETS[0];
}
