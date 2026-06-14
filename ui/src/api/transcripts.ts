import { apiClient } from "./client";

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker: string | null;
  translation: string | null;
  words: { start: number; end: number; word: string }[] | null;
}

export interface TranscriptView {
  transcript_id: string;
  language: string | null;
  duration_sec: number | null;
  segments: TranscriptSegment[];
}

export async function getTranscript(transcriptId: string): Promise<TranscriptView> {
  const { data } = await apiClient.get<{ data: TranscriptView }>(`/api/v1/transcripts/${transcriptId}`);
  return data.data;
}

export function exportUrl(transcriptId: string, format: "srt" | "vtt" | "txt"): string {
  return `/api/v1/transcripts/${transcriptId}/export?format=${format}`;
}

export function audioUrl(transcriptId: string): string {
  return `/api/v1/transcripts/${transcriptId}/audio`;
}

export interface PrecomputedPeaks {
  version: number;
  n_peaks: number;
  duration_sec: number;
  peaks: number[];
}

/** Returns `null` when no peaks file exists (older jobs, jobs whose audio
 *  wasn't persisted). The caller should fall back to client-side decode. */
export async function fetchPeaks(transcriptId: string): Promise<PrecomputedPeaks | null> {
  try {
    const { data } = await apiClient.get<PrecomputedPeaks>(
      `/api/v1/transcripts/${transcriptId}/peaks`,
    );
    return data;
  } catch (err) {
    // 404 is expected; surface anything else so it's debuggable.
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status !== 404) console.warn("fetchPeaks failed", err);
    return null;
  }
}

/** Server distinguishes "field omitted" from "field set to null". Use `undefined`
 *  here to omit (no change); `null` (only for speaker/translation) clears the value. */
export interface SegmentPatch {
  text?: string;
  speaker?: string | null;
  translation?: string | null;
  start?: number;
  end?: number;
}

export async function patchSegment(
  transcriptId: string, seq: number, patch: SegmentPatch,
): Promise<TranscriptSegment> {
  const { data } = await apiClient.patch<{ data: TranscriptSegment }>(
    `/api/v1/transcripts/${transcriptId}/segments/${seq}`, patch,
  );
  return data.data;
}

/** Split a segment at the given character index. The server figures out where
 *  in the timecode the boundary should land (based on character ratio unless
 *  `timeRatio` is given). After the call the parent transcript needs to be
 *  refetched — sequence numbers of every later segment have shifted +1. */
export async function splitSegment(
  transcriptId: string, seq: number, splitAt: number, timeRatio?: number,
): Promise<{ head: TranscriptSegment; tail: TranscriptSegment }> {
  const { data } = await apiClient.post<{ data: { head: TranscriptSegment; tail: TranscriptSegment } }>(
    `/api/v1/transcripts/${transcriptId}/segments/${seq}/split`,
    { split_at: splitAt, time_ratio: timeRatio },
  );
  return data.data;
}

/** Synchronous: re-run Whisper on the [startSeq, endSeq] span of an existing
 *  transcript and swap the new segments in. Blocks until the AI worker
 *  responds (~5–60s typical). Caller should show a spinner and refetch the
 *  transcript afterwards because seq numbers of every later row may shift. */
/** Override bag for region retranscription. Plain decode options plus the new
 *  region preprocessing (uvr/vad) and optional model swap for the span. */
export interface RetranscribeOverride {
  backend?: string;
  model?: string;
  language?: string;
  uvr?: { enabled: boolean; model?: string; stem?: "vocals" | "instrumental" };
  vad?: { enabled: boolean; threshold?: number };
  temperature?: number;
  beam_size?: number;
  initial_prompt?: string;
  no_speech_threshold?: number;
  condition_on_previous_text?: boolean;
  compression_ratio_threshold?: number;
  hallucination_silence_threshold?: number | null;
}

interface RetranscribeResult {
  replaced: number; inserted: number; segments: TranscriptSegment[];
}

export async function retranscribeRange(
  transcriptId: string, startSeq: number, endSeq: number,
  optionsOverride?: RetranscribeOverride,
): Promise<RetranscribeResult> {
  const { data } = await apiClient.post<{ data: RetranscribeResult }>(
    `/api/v1/transcripts/${transcriptId}/retranscribe`,
    { start_seq: startSeq, end_seq: endSeq, options_override: optionsOverride ?? null },
    // The synchronous endpoint can take a while; pass a generous client-side
    // timeout above the API's 180s NATS budget so axios doesn't bail first.
    { timeout: 200_000 },
  );
  return data.data;
}

/** Time-addressed region retranscribe — used when there are no subtitle rows
 *  to select (whisper recognised nothing) and the user drags a span on the
 *  waveform. Works on an empty transcript. */
export async function retranscribeTimeRange(
  transcriptId: string, tStart: number, tEnd: number,
  optionsOverride?: RetranscribeOverride,
): Promise<RetranscribeResult> {
  const { data } = await apiClient.post<{ data: RetranscribeResult }>(
    `/api/v1/transcripts/${transcriptId}/retranscribe`,
    { t_start: tStart, t_end: tEnd, options_override: optionsOverride ?? null },
    { timeout: 200_000 },
  );
  return data.data;
}

/** Restore a snapshot of segments over a time range — used by the retranscribe
 *  Undo to put back the pre-retranscribe lines. No inference. */
export async function replaceTimeRange(
  transcriptId: string, tStart: number, tEnd: number,
  segments: { start: number; end: number; text: string; speaker: string | null; translation?: string | null }[],
): Promise<void> {
  await apiClient.post(
    `/api/v1/transcripts/${transcriptId}/segments/replace_time_range`,
    { t_start: tStart, t_end: tEnd, segments },
  );
}

/** Bulk-rename one speaker label across the whole transcript. `toLabel=null`
 *  clears the label entirely. Returns the count of rows updated. The caller
 *  should refetch (or optimistically rewrite) the transcript afterwards —
 *  every matching segment changed. */
export async function renameSpeaker(
  transcriptId: string, fromLabel: string, toLabel: string | null,
): Promise<number> {
  const { data } = await apiClient.post<{ data: { updated: number } }>(
    `/api/v1/transcripts/${transcriptId}/speakers/rename`,
    { from: fromLabel, to: toLabel },
  );
  return data.data.updated;
}

/** Reference-based speaker re-assignment. The given seqs are the references
 *  (each keeps its current label); every other line is matched to the nearest
 *  reference voice by embedding. Returns the changed rows + their previous
 *  labels (for undo). Runs on the GPU worker, so allow a generous timeout. */
export interface AlignResult {
  changed: number;
  assignments: Record<string, string>;
  previous: Record<string, string | null>;
}
export async function alignSpeakers(
  transcriptId: string, referenceSeqs: number[],
): Promise<AlignResult> {
  const { data } = await apiClient.post<{ data: AlignResult }>(
    `/api/v1/transcripts/${transcriptId}/speakers/align`,
    { reference_seqs: referenceSeqs },
    { timeout: 200_000 },
  );
  return data.data;
}

/** Set the speaker on many segments at once (used by the alignment undo). */
export async function setSpeakersBulk(
  transcriptId: string, items: { seq: number; speaker: string | null }[],
): Promise<void> {
  await apiClient.post(
    `/api/v1/transcripts/${transcriptId}/speakers/set_bulk`,
    { items },
  );
}

/** Insert a new (default empty) segment after `seq`. seq=0 prepends. Later
 *  seq numbers shift +1 → refetch after. */
export async function insertSegmentAfter(
  transcriptId: string, seq: number,
  body: { text?: string; start?: number; end?: number; speaker?: string | null } = {},
): Promise<TranscriptSegment> {
  const { data } = await apiClient.post<{ data: TranscriptSegment }>(
    `/api/v1/transcripts/${transcriptId}/segments/${seq}/insert_after`, body,
  );
  return data.data;
}

/** Clone `seq` into a new row right after it. Later seq numbers shift +1. */
export async function duplicateSegment(
  transcriptId: string, seq: number,
): Promise<TranscriptSegment> {
  const { data } = await apiClient.post<{ data: TranscriptSegment }>(
    `/api/v1/transcripts/${transcriptId}/segments/${seq}/duplicate`, {},
  );
  return data.data;
}

/** Move `seq` to start at `newStart` seconds; transcript re-sorts + renumbers.
 *  Every seq may change → refetch after. */
export async function moveSegment(
  transcriptId: string, seq: number, newStart: number,
): Promise<TranscriptSegment & { new_seq: number }> {
  const { data } = await apiClient.post<{ data: TranscriptSegment & { new_seq: number } }>(
    `/api/v1/transcripts/${transcriptId}/segments/${seq}/move`, { new_start: newStart },
  );
  return data.data;
}

/** Merge segment `seq` with `seq+1`. Subsequent seq numbers shift -1, so the
 *  caller should refetch (or shift its local copy). */
export async function mergeSegmentNext(
  transcriptId: string, seq: number,
): Promise<TranscriptSegment> {
  const { data } = await apiClient.post<{ data: TranscriptSegment }>(
    `/api/v1/transcripts/${transcriptId}/segments/${seq}/merge_next`,
    {},
  );
  return data.data;
}

/** Delete a segment outright; rows after it shift up by 1, so the caller must
 *  refetch the transcript. Returns the deleted row (for an undo affordance). */
export async function deleteSegment(
  transcriptId: string, seq: number,
): Promise<TranscriptSegment> {
  const { data } = await apiClient.delete<{ data: TranscriptSegment }>(
    `/api/v1/transcripts/${transcriptId}/segments/${seq}`,
  );
  return data.data;
}
