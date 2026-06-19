import {
  CallMerge, CheckBox, CheckBoxOutlineBlank, Close, ContentCopy, ContentCut,
  DeleteOutline, DragIndicator, MoreHoriz, PersonAddAlt1, PersonRemove, PlaylistAdd,
  PlayArrow, RecordVoiceOver, Replay, Search, SwapVert, Tune, ViewColumn, ViewStream,
  WarningAmber,
} from "@mui/icons-material";
import {
  Box, Button, CircularProgress, Collapse, Divider, IconButton, InputAdornment, Menu,
  MenuItem, Popover, Snackbar, Stack, Switch, TextField, ToggleButton, ToggleButtonGroup,
  Tooltip, Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import {
  alignSpeakers, audioUrl, deleteSegment, duplicateSegment, fetchPeaks, getTranscript,
  insertSegmentAfter, mergeSegmentNext, moveSegment, patchSegment, renameSpeaker,
  replaceTimeRange, retranscribeRange, retranscribeTimeRange, setSpeakersBulk, splitSegment,
  type RetranscribeOverride, type TranscriptSegment, type TranscriptView,
} from "../../api/transcripts";
import { useSettingsStore } from "../../stores/settingsStore";
import { formatTimecode } from "../../utils/time";
import { ModelSelect } from "../pipeline/ModelSelect";
import { presetById, REGION_PRESETS, type RegionPresetId } from "./regionPresets";

function spanLabel(lo: number, hi: number): string {
  return lo === hi ? `#${lo}` : `#${lo}–${hi}`;
}

const COACHMARK_KEY = "ww-transcript-coachmark-seen";

/** First-run hint that surfaces the selection-gated powers (region retranscribe,
 *  waveform retiming) which are otherwise invisible until you happen to select
 *  something. Shows once, then the user dismisses it for good. */
function EditorCoachmark() {
  const { t } = useTranslation();
  const [seen, setSeen] = useState(() => {
    try { return localStorage.getItem(COACHMARK_KEY) === "1"; } catch { return false; }
  });
  if (seen) return null;
  function dismiss() {
    try { localStorage.setItem(COACHMARK_KEY, "1"); } catch { /* ignore */ }
    setSeen(true);
  }
  return (
    <Box sx={{
      display: "flex", alignItems: "flex-start", gap: 1.5,
      px: 1.5, py: 1.25, borderBottom: "1px solid var(--border-default)",
      bgcolor: "var(--accent-soft)",
    }}>
      <Box sx={{ flex: 1 }}>
        <Typography variant="caption" sx={{ fontWeight: 700, color: "var(--accent)", display: "block", mb: 0.25 }}>
          {t("transcript.coach_title")}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block", lineHeight: 1.6 }}>
          {t("transcript.coach_body")}
        </Typography>
      </Box>
      <Button size="small" onClick={dismiss}
          sx={{ flexShrink: 0, color: "var(--accent)", fontWeight: 700, minWidth: 0 }}>
        {t("transcript.coach_dismiss")}
      </Button>
    </Box>
  );
}
import { WaveformPlayer, type WaveformHandle } from "./WaveformPlayer";

interface Props {
  segments: TranscriptSegment[];
  transcriptId: string;
  onSegmentEdited?: (seq: number, next: TranscriptSegment) => void;
}

export function TranscriptViewer({ segments, transcriptId, onSegmentEdited }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const transcriptLayout = useSettingsStore((s) => s.transcriptLayout);
  const setTranscriptLayout = useSettingsStore((s) => s.setPartial);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [editingSeq, setEditingSeq] = useState<number | null>(null);
  const [activeSeq, setActiveSeq] = useState<number | null>(null);
  const [audioMissing, setAudioMissing] = useState(false);
  // Multi-select for the "retranscribe this range" action. We store the set
  // of selected `seq` values (1-indexed) so range math (min/max) is direct.
  // `anchorSeq` is the last single-clicked row; Shift+click extends from
  // there to the just-clicked one.
  const [selectedSeqs, setSelectedSeqs] = useState<Set<number>>(new Set());
  const [anchorSeq, setAnchorSeq] = useState<number | null>(null);
  const [retranscribing, setRetranscribing] = useState(false);
  const [retranscribeError, setRetranscribeError] = useState<string | null>(null);
  // Holds the pre-retranscribe snapshot so the run can be undone.
  const [undo, setUndo] = useState<{
    span: [number, number];
    snapshot: { start: number; end: number; text: string; speaker: string | null }[];
    inserted: number;
    emptied: boolean;
  } | null>(null);
  // Snapshot of the last deleted row so the delete can be undone (re-inserted
  // into its original time slot).
  const [deletedSeg, setDeletedSeg] = useState<{
    start: number; end: number; text: string;
    speaker: string | null; translation: string | null;
  } | null>(null);
  // Reference-based speaker alignment: in-flight flag + undo snapshot (prior
  // labels of the rows the alignment changed).
  const [aligning, setAligning] = useState(false);
  const [alignUndo, setAlignUndo] = useState<{
    changed: number; previous: Record<string, string | null>;
  } | null>(null);
  // Time region selected by dragging the waveform — the only retranscribe
  // entry point when the transcript is empty (whisper recognised nothing).
  const [regionSel, setRegionSel] = useState<[number, number] | null>(null);
  // The seq currently being drag-reordered, so every row can dim/disable
  // itself and show the drop indicator consistently.
  const [draggingSeq, setDraggingSeq] = useState<number | null>(null);
  const virtuoso = useRef<VirtuosoHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const waveRef = useRef<WaveformHandle | null>(null);

  // Pre-computed peaks from the ai pipeline. Mount wavesurfer only after
  // this resolves (success or 404) — peaks let it skip a ~5s in-browser
  // decode, and the ~50ms wait beats double-rendering the player.
  const peaksQuery = useQuery({
    queryKey: ["peaks", transcriptId],
    queryFn: () => fetchPeaks(transcriptId),
    staleTime: Infinity,  // peaks are immutable per transcript_id
    gcTime: Infinity,
    retry: false,
  });

  // Only show the split-layout toggle when at least one segment has a translation —
  // otherwise the second column is just whitespace.
  const hasTranslations = useMemo(
    () => segments.some((s) => s.translation && s.translation.trim().length > 0),
    [segments],
  );
  const splitOn = transcriptLayout === "split" && hasTranslations;

  // Boundary ticks for the waveform overlay. Drop the first (always 0) so we
  // don't draw on top of the play-from-start edge. Cap at 500 — beyond that
  // the overlay turns into visual noise and the DOM cost grows linearly.
  const boundaries = useMemo(() => {
    const all = segments.map((s) => s.start).filter((t) => t > 0);
    if (all.length <= 500) return all;
    const stride = Math.ceil(all.length / 500);
    return all.filter((_, i) => i % stride === 0);
  }, [segments]);

  // Time spans of the selected subtitle rows — drawn on the waveform so the
  // user can see *where* their selection is. Capped so a select-all on a huge
  // transcript doesn't paint thousands of boxes.
  const selectedRegions = useMemo<Array<[number, number]>>(() => {
    // Single selection is drawn as the *editable* region instead (handles), so
    // only paint soft highlights for multi-select.
    if (selectedSeqs.size < 2 || selectedSeqs.size > 300) return [];
    const out: Array<[number, number]> = [];
    for (const seq of selectedSeqs) {
      const s = segments[seq - 1];
      if (s) out.push([s.start, s.end]);
    }
    return out;
  }, [selectedSeqs, segments]);

  // Exactly-one selection → that segment's bounds are editable on the waveform
  // via drag handles. Multiple selections stay read-only highlights (ambiguous
  // which to resize).
  const editableSeq = selectedSeqs.size === 1
    ? Array.from(selectedSeqs)[0]
    : null;

  const matches = useMemo(() => {
    if (!query.trim()) return [] as number[];
    const q = query.toLowerCase();
    const hits: number[] = [];
    segments.forEach((s, i) => { if (s.text.toLowerCase().includes(q)) hits.push(i); });
    return hits;
  }, [segments, query]);

  useEffect(() => { setCursor(0); }, [query]);

  function jumpTo(targetIdx: number) {
    virtuoso.current?.scrollToIndex({ index: targetIdx, align: "center", behavior: "smooth" });
  }

  /** Seek the waveform player to a segment's start and play. */
  function playSegment(seg: TranscriptSegment) {
    waveRef.current?.seekAndPlay(Math.max(0, seg.start));
  }

  /** After a split / merge the *every-row-below* seq has shifted by ±1, so a
   *  per-row optimistic update is too fiddly. Refetch the whole transcript
   *  and let TanStack Query swap. The viewer is virtualised; cost is fine. */
  async function refetchTranscript() {
    await qc.invalidateQueries({ queryKey: ["transcript", transcriptId] });
    // Prefetch one server roundtrip ahead so the Virtuoso doesn't flash
    // empty between invalidate and the network return.
    qc.setQueryData<TranscriptView>(
      ["transcript", transcriptId],
      await getTranscript(transcriptId),
    );
  }

  async function onSplit(seq: number, splitAt: number) {
    try {
      await splitSegment(transcriptId, seq, splitAt);
      await refetchTranscript();
    } catch (err) {
      console.error("splitSegment failed", err);
    }
  }

  async function onMergeNext(seq: number) {
    try {
      await mergeSegmentNext(transcriptId, seq);
      await refetchTranscript();
    } catch (err) {
      console.error("mergeSegmentNext failed", err);
    }
  }

  /** Delete one row outright. Snapshots it first so the Snackbar can offer an
   *  undo (re-inserts into its original time slot via replaceTimeRange). */
  async function onDelete(seq: number) {
    const snap = segments[seq - 1];
    if (!snap) return;
    setDeletedSeg({
      start: snap.start, end: snap.end, text: snap.text,
      speaker: snap.speaker, translation: snap.translation ?? null,
    });
    try {
      await deleteSegment(transcriptId, seq);
      await refetchTranscript();
    } catch (err) {
      console.error("deleteSegment failed", err);
      setDeletedSeg(null);
    }
  }

  async function undoDelete() {
    if (!deletedSeg) return;
    const s = deletedSeg;
    setDeletedSeg(null);
    try {
      await replaceTimeRange(transcriptId, s.start, s.end, [s]);
      await refetchTranscript();
    } catch (err) {
      console.error("undo delete failed", err);
    }
  }

  /** Use the selected rows as voice references and re-assign every other row to
   *  the nearest reference speaker. The selected rows keep their labels. */
  async function onAlignSpeakers() {
    const refs = Array.from(selectedSeqs);
    if (refs.length === 0) return;
    setAligning(true);
    setRetranscribeError(null);
    try {
      const res = await alignSpeakers(transcriptId, refs);
      await refetchTranscript();
      clearSelection();
      setAlignUndo({ changed: res.changed, previous: res.previous });
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: { message?: string } } } })
        ?.response?.data?.detail?.message;
      console.error("alignSpeakers failed", err);
      setRetranscribeError(detail || String(err));
    } finally {
      setAligning(false);
    }
  }

  async function undoAlign() {
    if (!alignUndo) return;
    const { previous } = alignUndo;
    setAlignUndo(null);
    try {
      const items = Object.entries(previous).map(([seq, speaker]) => ({
        seq: Number(seq), speaker,
      }));
      await setSpeakersBulk(transcriptId, items);
      await refetchTranscript();
    } catch (err) {
      console.error("undo align failed", err);
    }
  }

  async function onInsertAfter(seq: number) {
    try {
      await insertSegmentAfter(transcriptId, seq);
      await refetchTranscript();
    } catch (err) {
      console.error("insertSegmentAfter failed", err);
    }
  }

  async function onDuplicate(seq: number) {
    try {
      await duplicateSegment(transcriptId, seq);
      await refetchTranscript();
    } catch (err) {
      console.error("duplicateSegment failed", err);
    }
  }

  async function onMove(seq: number, newStart: number) {
    try {
      await moveSegment(transcriptId, seq, newStart);
      await refetchTranscript();
    } catch (err) {
      console.error("moveSegment failed", err);
    }
  }

  /** Drag-and-drop reorder with overlap-safe placement. Dropping row `fromSeq`
   *  on the top half of `toSeq` puts it JUST BEFORE the target (the dragged
   *  line ends exactly where the target starts); on the bottom half, just
   *  AFTER (starts where the target ends). Either way it can't overlap the
   *  target itself — the main complaint with the old "+0.001" placement. The
   *  dragged line keeps its duration; the transcript re-sorts server-side. */
  async function onReorder(fromSeq: number, toSeq: number, pos: "before" | "after") {
    if (fromSeq === toSeq) return;
    const target = segments[toSeq - 1];
    const from = segments[fromSeq - 1];
    if (!target || !from) return;
    const dur = Math.max(0, from.end - from.start);
    const newStart = pos === "before"
      ? Math.max(0, target.start - dur)  // from.end == target.start
      : target.end;                       // from.start == target.end
    await onMove(fromSeq, newStart);
  }

  async function onPatchTime(seq: number, patch: { start?: number; end?: number }) {
    try {
      const next = await patchSegment(transcriptId, seq, patch);
      onSegmentEdited?.(seq, next);
    } catch (err) {
      console.error("patch time failed", err);
    }
  }

  function toggleSelect(seq: number, shiftKey: boolean) {
    setSelectedSeqs((prev) => {
      const next = new Set(prev);
      if (shiftKey && anchorSeq != null) {
        // Range from anchor → clicked, inclusive. Adds (doesn't toggle) so a
        // shift-click after a partial selection extends rather than subtracts.
        const lo = Math.min(anchorSeq, seq);
        const hi = Math.max(anchorSeq, seq);
        for (let s = lo; s <= hi; s++) next.add(s);
      } else {
        if (next.has(seq)) next.delete(seq); else next.add(seq);
        setAnchorSeq(seq);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedSeqs(new Set());
    setAnchorSeq(null);
    setRegionSel(null);
  }

  /** Re-run Whisper on the active selection — either the chosen subtitle rows
   *  (seq mode) or a dragged waveform span (time mode). Time mode is what makes
   *  this work on an empty transcript. `override` carries the region preset
   *  (UVR / VAD / decode tweaks). */
  async function runRetranscribe(override: RetranscribeOverride) {
    if (retranscribing) return;

    // Resolve the time span + snapshot the segments inside it BEFORE the run,
    // so the result is undoable (retranscribe replaces destructively).
    let span: [number, number];
    if (regionSel) {
      span = regionSel;
    } else if (selectedSeqs.size > 0) {
      const sel = Array.from(selectedSeqs).map((s) => segments[s - 1]).filter(Boolean);
      span = [Math.min(...sel.map((s) => s.start)), Math.max(...sel.map((s) => s.end))];
    } else {
      return;
    }
    const snapshot = segments
      .filter((s) => s.end > span[0] && s.start < span[1])
      .map((s) => ({ start: s.start, end: s.end, text: s.text, speaker: s.speaker }));

    setRetranscribing(true);
    setRetranscribeError(null);
    try {
      const seqs = Array.from(selectedSeqs).sort((a, b) => a - b);
      const result = regionSel
        ? await retranscribeTimeRange(transcriptId, regionSel[0], regionSel[1], override)
        : await retranscribeRange(transcriptId, seqs[0], seqs[seqs.length - 1], override);
      await refetchTranscript();
      clearSelection();
      // Offer an undo. If the pass returned nothing, say so explicitly — that's
      // the "it wiped my lines and gave me nothing" case the user fears.
      setUndo({
        span, snapshot,
        inserted: result.inserted,
        emptied: result.inserted === 0 && snapshot.length > 0,
      });
    } catch (err) {
      // Surface the server's reason (e.g. UVR/demucs failure) instead of a
      // silent console log — the toolbar shows it so the user isn't stranded.
      const detail = (err as { response?: { data?: { detail?: { message?: string } } } })
        ?.response?.data?.detail?.message;
      console.error("retranscribe failed", err);
      setRetranscribeError(detail || String(err));
    } finally {
      setRetranscribing(false);
    }
  }

  async function undoRetranscribe() {
    if (!undo) return;
    const { span, snapshot } = undo;
    setUndo(null);
    try {
      await replaceTimeRange(transcriptId, span[0], span[1], snapshot);
      await refetchTranscript();
    } catch (err) {
      console.error("undo retranscribe failed", err);
    }
  }

  /** Bulk-rename one diarization label across every row that has it
   *  (so "SPEAKER_00" → "Host" updates the whole transcript with one click).
   *  Optimistic local rewrite before the server roundtrip — feels instant on
   *  long transcripts; the API call is the rollback line. */
  async function onRenameSpeaker(fromLabel: string, toLabel: string) {
    const next = toLabel.trim() || null;
    if (next === fromLabel) return;
    qc.setQueryData<TranscriptView>(["transcript", transcriptId], (old) => {
      if (!old) return old;
      return {
        ...old,
        segments: old.segments.map((s) =>
          s.speaker === fromLabel ? { ...s, speaker: next } : s,
        ),
      };
    });
    try {
      await renameSpeaker(transcriptId, fromLabel, next);
    } catch (err) {
      console.error("renameSpeaker failed", err);
      await refetchTranscript();
    }
  }

  /** Set / change / clear the speaker on ONE row (vs `onRenameSpeaker` which
   *  rewrites every row sharing a label). `null` clears it. Optimistic, like
   *  the bulk rename — the patch is the rollback line. */
  async function onSetSpeaker(seq: number, speaker: string | null) {
    const next = speaker?.trim() || null;
    qc.setQueryData<TranscriptView>(["transcript", transcriptId], (old) => {
      if (!old) return old;
      const segs = old.segments.slice();
      if (segs[seq - 1]) segs[seq - 1] = { ...segs[seq - 1], speaker: next };
      return { ...old, segments: segs };
    });
    try {
      await patchSegment(transcriptId, seq, { speaker: next });
    } catch (err) {
      console.error("setSpeaker failed", err);
      await refetchTranscript();
    }
  }

  /** Distinct speaker labels in the transcript, for the "reuse an existing
   *  speaker" picker. Sorted so the list is stable across renders. */
  const allSpeakers = useMemo(() => {
    const set = new Set<string>();
    for (const s of segments) if (s.speaker) set.add(s.speaker);
    return Array.from(set).sort();
  }, [segments]);

  /** wavesurfer's `timeupdate` calls this; we find the matching segment by
   *  start/end. O(n) per tick but Virtuoso hides un-rendered rows so the
   *  linear scan stays cheap. Binary search would be the upgrade for
   *  transcripts >10k segments. */
  function onWaveTime(ct: number) {
    const idx = segments.findIndex((s) => ct >= s.start && ct < s.end);
    setActiveSeq(idx >= 0 ? idx + 1 : null);
  }

  // Hotkeys — only when no text input is focused.
  useEffect(() => {
    function isTypingTarget(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "/" && !isTypingTarget(e.target)) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (isTypingTarget(e.target)) return;
      // Space toggles playback (standard subtitle-editor key). preventDefault
      // stops the page from scrolling and stops a focused row/button from
      // re-firing on the space press.
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        waveRef.current?.togglePlay();
        return;
      }
      if (e.key === "Escape" && selectedSeqs.size > 0) {
        e.preventDefault();
        clearSelection();
        return;
      }
      if (e.key === "j" || e.key === "ArrowDown") {
        if (matches.length) {
          const next = Math.min(cursor + 1, matches.length - 1);
          setCursor(next); jumpTo(matches[next]);
        }
      } else if (e.key === "k" || e.key === "ArrowUp") {
        if (matches.length) {
          const next = Math.max(cursor - 1, 0);
          setCursor(next); jumpTo(matches[next]);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [matches, cursor, selectedSeqs.size]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "80vh",
               border: "1px solid var(--border-default)", borderRadius: 2, bgcolor: "background.paper" }}>
      <Box sx={{ p: 1, borderBottom: "1px solid var(--border-default)" }}>
        {audioMissing ? (
          // Realtime sessions don't persist audio. Be explicit so the user
          // doesn't think the player is "broken" — they should know editing
          // is still available, just without playback.
          <Box sx={{
            display: "flex", alignItems: "center", gap: 1.5,
            px: 1.5, py: 1.25, borderRadius: 1.5,
            bgcolor: "var(--bg-subtle)", color: "text.secondary",
          }}>
            <Box sx={{
              width: 6, height: 6, borderRadius: "50%", bgcolor: "var(--text-muted)",
            }} />
            <Typography variant="caption" sx={{ color: "inherit" }}>
              {t("transcript.audio_unavailable")}
            </Typography>
          </Box>
        ) : peaksQuery.isPending ? (
          // Avoid mounting wavesurfer before peaks resolve — otherwise we'd
          // create it once empty and again once peaks land. Quick neutral
          // placeholder keeps the layout from jumping.
          <Box sx={{ height: 72 }} />
        ) : (
          <WaveformPlayer
            ref={waveRef}
            src={audioUrl(transcriptId)}
            boundaries={boundaries}
            peaks={peaksQuery.data?.peaks}
            precomputedDuration={peaksQuery.data?.duration_sec}
            onTimeUpdate={onWaveTime}
            onMissing={() => setAudioMissing(true)}
            onReady={(d) => { if (d <= 0) setAudioMissing(true); }}
            regionSelectable
            selectedRegion={regionSel}
            highlightRegions={selectedRegions}
            activeRegion={activeSeq != null && segments[activeSeq - 1]
              ? [segments[activeSeq - 1].start, segments[activeSeq - 1].end]
              : null}
            onRegionSelect={(a, b) => { setSelectedSeqs(new Set()); setRegionSel([a, b]); }}
            editableRegion={editableSeq != null && segments[editableSeq - 1]
              ? [segments[editableSeq - 1].start, segments[editableSeq - 1].end]
              : null}
            onRegionEdit={(start, end) => {
              if (editableSeq == null) return;
              void onPatchTime(editableSeq, { start, end });
            }}
          />
        )}
        {/* Hint that the waveform is draggable — and the ONLY way to retry when
            nothing was recognised. */}
        {!audioMissing && (
          <Typography variant="caption" sx={{ color: "text.muted", display: "block", mt: 0.5, px: 0.5 }}>
            {segments.length === 0 ? t("transcript.empty_drag_hint") : t("transcript.drag_hint")}
          </Typography>
        )}
      </Box>

      <EditorCoachmark />

      <Stack direction="row" alignItems="center" spacing={1}
          sx={{ p: 1.5, borderBottom: "1px solid var(--border-default)" }}>
        <TextField inputRef={searchRef} size="small" fullWidth value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("transcript.search_placeholder")}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }} />
        {query && (
          <Typography variant="caption" sx={{ minWidth: 60, textAlign: "right" }}>
            {matches.length === 0 ? "0 / 0" : t("transcript.search_results", { cur: cursor + 1, total: matches.length })}
          </Typography>
        )}
        {hasTranslations && (
          <Tooltip title={t("transcript.layout_tooltip")}>
            <ToggleButtonGroup
              size="small" exclusive value={transcriptLayout}
              onChange={(_, v) => v && setTranscriptLayout({ transcriptLayout: v })}
              sx={{
                "& .MuiToggleButton-root": {
                  border: "1px solid var(--border-default)",
                  paddingInline: 0.75, paddingBlock: 0.25,
                  color: "text.secondary",
                },
                // Layout toggle is a preference, not the live signal — neutral
                // selected state keeps the accent reserved for the playing
                // segment (the actual "now" cue on this page).
                "& .MuiToggleButton-root.Mui-selected": {
                  bgcolor: "var(--bg-subtle)", color: "text.primary",
                },
              }}
            >
              <ToggleButton value="inline" aria-label="inline">
                <ViewStream fontSize="small" />
              </ToggleButton>
              <ToggleButton value="split" aria-label="split">
                <ViewColumn fontSize="small" />
              </ToggleButton>
            </ToggleButtonGroup>
          </Tooltip>
        )}
        <Typography variant="caption" sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>
          {t("transcript.edit_hint")}
        </Typography>
      </Stack>

      {(selectedSeqs.size > 0 || regionSel != null) && (
        <SelectionToolbar
          label={regionSel
            ? t("transcript.selected_region", {
                from: formatTimecode(regionSel[0]), to: formatTimecode(regionSel[1]),
              })
            : t("transcript.selected_range", {
                count: selectedSeqs.size,
                span: spanLabel(Math.min(...selectedSeqs), Math.max(...selectedSeqs)),
              })}
          retranscribing={retranscribing}
          error={retranscribeError}
          onRetranscribe={(override) => void runRetranscribe(override)}
          onClear={clearSelection}
          // Align only applies to a row selection (needs reference labels), not
          // a dragged time region.
          canAlign={selectedSeqs.size > 0 && regionSel == null}
          aligning={aligning}
          onAlign={() => void onAlignSpeakers()}
        />
      )}

      <Box sx={{ flex: 1, minHeight: 0 }}>
        <Virtuoso
          ref={virtuoso}
          data={segments}
          increaseViewportBy={400}
          itemContent={(i, seg) => (
            <SegmentRow
              seg={seg} query={query}
              splitLayout={splitOn}
              isMatchActive={matches[cursor] === i}
              isPlaying={activeSeq === i + 1}
              editing={editingSeq === i + 1}
              isLast={i === segments.length - 1}
              selected={selectedSeqs.has(i + 1)}
              onToggleSelect={(shiftKey) => toggleSelect(i + 1, shiftKey)}
              onPlay={() => playSegment(seg)}
              onStartEdit={() => setEditingSeq(i + 1)}
              onCancelEdit={() => setEditingSeq(null)}
              onSave={async (text) => {
                setEditingSeq(null);
                if (text === seg.text) return;
                try {
                  const next = await patchSegment(transcriptId, i + 1, { text });
                  onSegmentEdited?.(i + 1, next);
                } catch (err) {
                  console.error("patchSegment failed", err);
                }
              }}
              onSplit={(splitAt) => onSplit(i + 1, splitAt)}
              onMergeNext={() => onMergeNext(i + 1)}
              onDelete={() => onDelete(i + 1)}
              onPatchTime={(patch) => onPatchTime(i + 1, patch)}
              onRenameSpeaker={onRenameSpeaker}
              onSetSpeaker={(speaker) => onSetSpeaker(i + 1, speaker)}
              allSpeakers={allSpeakers}
              onInsertAfter={() => onInsertAfter(i + 1)}
              onDuplicate={() => onDuplicate(i + 1)}
              onMove={(newStart) => onMove(i + 1, newStart)}
              seqNum={i + 1}
              onReorder={onReorder}
              draggingSeq={draggingSeq}
              onDragStart={setDraggingSeq}
              onDragEnd={() => setDraggingSeq(null)}
              // Time-sorted, so this row overlaps the next when its end runs
              // past the next row's start. 10ms tolerance ignores float noise.
              overlapsNext={
                i + 1 < segments.length && seg.end > segments[i + 1].start + 0.01
              }
              overlapsPrev={
                i > 0 && segments[i - 1].end > seg.start + 0.01
              }
            />
          )}
        />
      </Box>

      {/* Retranscribe undo — the run replaced segments destructively, so give
          a 8s window to put the originals back. Longer than the delete window
          because reviewing a retranscribe result takes a beat. */}
      <Snackbar
        open={undo != null}
        autoHideDuration={8000}
        onClose={() => setUndo(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        message={undo?.emptied
          ? t("transcript.retranscribe_emptied")
          : t("transcript.retranscribe_done", { count: undo?.inserted ?? 0 })}
        action={
          <Button size="small" onClick={() => void undoRetranscribe()}
              sx={{ color: "var(--accent)", fontWeight: 700 }}>
            {t("history.undo")}
          </Button>
        }
      />

      {/* Delete undo — a 6s window to put a deleted row back in its time slot. */}
      <Snackbar
        open={deletedSeg != null}
        autoHideDuration={6000}
        onClose={() => setDeletedSeg(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        message={t("transcript.delete_done")}
        action={
          <Button size="small" onClick={() => void undoDelete()}
              sx={{ color: "var(--accent)", fontWeight: 700 }}>
            {t("history.undo")}
          </Button>
        }
      />

      {/* Speaker-alignment undo — restores the prior labels of changed rows. */}
      <Snackbar
        open={alignUndo != null}
        autoHideDuration={8000}
        onClose={() => setAlignUndo(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        message={t("transcript.align_done", { count: alignUndo?.changed ?? 0 })}
        action={
          <Button size="small" onClick={() => void undoAlign()}
              sx={{ color: "var(--accent)", fontWeight: 700 }}>
            {t("history.undo")}
          </Button>
        }
      />
    </Box>
  );
}

/** Morph-in-place toolbar for the selected segment range. Carries the region
 *  tuning UX: a preset dropdown (Simple) and, in Advanced mode, an expandable
 *  panel that seeds from the preset and lets the user override UVR / VAD /
 *  decode knobs for just this span. Same chrome as the search row above. */
function SelectionToolbar({
  label, retranscribing, error, onRetranscribe, onClear,
  canAlign, aligning, onAlign,
}: {
  label: string; retranscribing: boolean; error: string | null;
  onRetranscribe: (override: RetranscribeOverride) => void; onClear: () => void;
  canAlign: boolean; aligning: boolean; onAlign: () => void;
}) {
  const { t } = useTranslation();
  const advanced = useSettingsStore((s) => s.uiMode === "advanced");

  const [presetId, setPresetId] = useState<RegionPresetId>("speech");
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Editable override, seeded from the preset. Advanced edits live here.
  const [override, setOverride] = useState<RetranscribeOverride>({});

  function applyPreset(id: RegionPresetId) {
    setPresetId(id);
    setOverride({ ...presetById(id).override });
  }

  function patch(p: Partial<RetranscribeOverride>) {
    setOverride((o) => ({ ...o, ...p }));
    setPresetId("custom"); // any manual edit drops to custom
  }

  return (
    <Box sx={{ bgcolor: "var(--bg-subtle)", borderBottom: "1px solid var(--border-default)" }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 0.5, minHeight: 36 }}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {label}
        </Typography>

        <TextField
          select size="small" value={presetId}
          onChange={(e) => applyPreset(e.target.value as RegionPresetId)}
          disabled={retranscribing}
          sx={{ ml: 1, minWidth: 130, "& .MuiInputBase-input": { fontSize: 12, py: 0.5 } }}
        >
          {REGION_PRESETS.map((p) => (
            <MenuItem key={p.id} value={p.id}>{t(`region.preset_${p.labelKey}`)}</MenuItem>
          ))}
        </TextField>

        {advanced && (
          <Tooltip title={t("region.advanced_toggle")}>
            <IconButton size="small" onClick={() => setShowAdvanced((v) => !v)}
                aria-label="region options"
                sx={{ color: showAdvanced ? "var(--accent)" : "text.muted", p: 0.5 }}>
              <Tune fontSize="small" />
            </IconButton>
          </Tooltip>
        )}

        <Box sx={{ flex: 1 }} />
        {canAlign && (
          <Tooltip title={t("transcript.align_speakers_hint")}>
            <Button
              size="small" variant="outlined"
              disabled={retranscribing || aligning}
              startIcon={aligning
                ? <CircularProgress size={12} sx={{ color: "inherit" }} />
                : <RecordVoiceOver fontSize="small" />}
              onClick={onAlign}
              sx={{ minHeight: 28, py: 0.25, fontSize: 12 }}
            >
              {aligning ? t("transcript.aligning") : t("transcript.align_speakers")}
            </Button>
          </Tooltip>
        )}
        <Button
          size="small" variant="contained" color="primary"
          disabled={retranscribing || aligning}
          startIcon={retranscribing
            ? <CircularProgress size={12} sx={{ color: "inherit" }} />
            : <Replay fontSize="small" />}
          onClick={() => onRetranscribe(override)}
          sx={{ minHeight: 28, py: 0.25, fontSize: 12, boxShadow: "none",
                "&:hover": { boxShadow: "none" } }}
        >
          {retranscribing ? t("transcript.retranscribing") : t("transcript.retranscribe")}
        </Button>
        <IconButton
          size="small" onClick={onClear} disabled={retranscribing}
          aria-label={t("history.clear_selection")}
          title={`${t("history.clear_selection")} (Esc)`}
          sx={{ color: "text.muted", p: 0.5 }}
        >
          <Close fontSize="small" />
        </IconButton>
      </Stack>

      {error && (
        <Box sx={{ px: 1.5, pb: 1, pt: 0 }}>
          <Typography variant="caption" sx={{ color: "var(--danger)" }}>
            {t("transcript.retranscribe_failed")}: {error}
          </Typography>
        </Box>
      )}

      <Collapse in={advanced && showAdvanced}>
        <Box sx={{ px: 1.5, pb: 1.5, pt: 0.5 }}>
          <RegionAdvancedPanel override={override} onPatch={patch} disabled={retranscribing} />
        </Box>
      </Collapse>
    </Box>
  );
}

const REGION_LANGS = ["auto", "ko", "en", "ja", "zh", "es", "fr", "de"];

/** Full per-region override editor (Advanced). Mirrors the breadth of the
 *  initial-transcription Advanced options — backend / model / language plus the
 *  preprocessing and decode knobs — so the user can try genuinely different
 *  settings on a span, not just a UVR toggle. Anything left blank inherits the
 *  parent job's value. */
function RegionAdvancedPanel({
  override, onPatch, disabled,
}: {
  override: RetranscribeOverride;
  onPatch: (p: Partial<RetranscribeOverride>) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const jobBackend = useSettingsStore((s) => s.backend);
  const jobModel = useSettingsStore((s) => s.model);
  const jobLanguage = useSettingsStore((s) => s.language);
  // Display values fall back to the job's settings so the selects aren't blank,
  // but only write to the override when the user actually changes them.
  const backend = override.backend ?? jobBackend;

  return (
    <Stack spacing={1.5} sx={{
      p: 1.5, borderRadius: 1.5, bgcolor: "var(--bg-canvas)",
      border: "1px solid var(--border-default)",
    }}>
      {/* Backend / model / language — same as a fresh job, but scoped to the span. */}
      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
        <TextField select size="small" label={t("common.backend")} value={backend}
            disabled={disabled}
            onChange={(e) => onPatch({ backend: e.target.value, model: undefined })}
            sx={{ minWidth: 150, "& .MuiInputBase-input": { fontSize: 12 } }}>
          <MenuItem value="faster_whisper">faster-whisper</MenuItem>
          <MenuItem value="openai_whisper">openai/whisper</MenuItem>
          <MenuItem value="insanely_fast_whisper">insanely-fast-whisper</MenuItem>
        </TextField>
        <Box sx={{ minWidth: 180 }}>
          <ModelSelect value={override.model ?? jobModel} backend={backend}
              onChange={(v) => onPatch({ model: v })} />
        </Box>
        <TextField select size="small" label={t("common.language")} value={override.language ?? jobLanguage}
            disabled={disabled}
            onChange={(e) => onPatch({ language: e.target.value })}
            sx={{ minWidth: 110, "& .MuiInputBase-input": { fontSize: 12 } }}>
          {REGION_LANGS.map((l) => (
            <MenuItem key={l} value={l}>{l === "auto" ? t("common.auto") : l}</MenuItem>
          ))}
        </TextField>
      </Stack>

      <Stack direction="row" alignItems="center" spacing={1}>
        <Switch size="small" checked={override.uvr?.enabled ?? false} disabled={disabled}
            onChange={(e) => onPatch({ uvr: { enabled: e.target.checked, stem: "vocals" } })} />
        <Typography variant="caption">{t("region.uvr")}</Typography>
        <Typography variant="caption" sx={{ color: "text.muted" }}>{t("region.uvr_hint")}</Typography>
      </Stack>

      <Stack direction="row" alignItems="center" spacing={1}>
        <Switch size="small" checked={override.vad?.enabled ?? false} disabled={disabled}
            onChange={(e) => onPatch({ vad: { enabled: e.target.checked, threshold: override.vad?.threshold ?? 0.4 } })} />
        <Typography variant="caption" sx={{ minWidth: 30 }}>{t("region.vad")}</Typography>
        <TextField
          size="small" type="number" disabled={disabled || !override.vad?.enabled}
          value={override.vad?.threshold ?? 0.4}
          onChange={(e) => onPatch({ vad: { enabled: true, threshold: Number(e.target.value) } })}
          inputProps={{ min: 0.1, max: 0.95, step: 0.05 }}
          sx={{ width: 80, "& .MuiInputBase-input": { fontSize: 12, py: 0.5 } }}
        />
      </Stack>

      <Stack direction="row" alignItems="center" spacing={2} flexWrap="wrap" useFlexGap>
        <RegionNumber label={t("region.temperature")} value={override.temperature ?? 0}
            min={0} max={1} step={0.1} disabled={disabled}
            hint={t("region.temperature_hint")}
            onChange={(v) => onPatch({ temperature: v })} />
        <RegionNumber label={t("region.no_speech")} value={override.no_speech_threshold ?? 0.6}
            min={0} max={1} step={0.05} disabled={disabled}
            hint={t("advanced.no_speech_hint")}
            onChange={(v) => onPatch({ no_speech_threshold: v })} />
        <RegionNumber label={t("region.compression")} value={override.compression_ratio_threshold ?? 2.2}
            min={1} max={5} step={0.1} disabled={disabled}
            hint={t("advanced.compression_hint")}
            onChange={(v) => onPatch({ compression_ratio_threshold: v })} />
      </Stack>

      <Tooltip title={t("advanced.condition_hint")}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ width: "fit-content" }}>
          <Switch size="small" checked={override.condition_on_previous_text ?? false} disabled={disabled}
              onChange={(e) => onPatch({ condition_on_previous_text: e.target.checked })} />
          <Typography variant="caption" className="font-mono">condition_on_previous_text</Typography>
        </Stack>
      </Tooltip>

      <TextField
        size="small" fullWidth disabled={disabled}
        label={t("region.initial_prompt")}
        value={override.initial_prompt ?? ""}
        onChange={(e) => onPatch({ initial_prompt: e.target.value })}
        placeholder={t("region.initial_prompt_placeholder")}
        sx={{ "& .MuiInputBase-input": { fontSize: 12 } }}
      />
    </Stack>
  );
}

function RegionNumber({
  label, value, min, max, step, disabled, onChange, hint,
}: {
  label: string; value: number; min: number; max: number; step: number;
  disabled: boolean; onChange: (v: number) => void; hint?: string;
}) {
  return (
    <Tooltip title={hint ?? ""} disableHoverListener={!hint}>
      <Stack direction="row" alignItems="center" spacing={0.75}>
        <Typography variant="caption" className="font-mono"
            sx={{ color: "text.secondary", borderBottom: hint ? "1px dotted var(--border-strong)" : "none" }}>
          {label}
        </Typography>
        <TextField
          size="small" type="number" disabled={disabled} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          inputProps={{ min, max, step }}
          sx={{ width: 76, "& .MuiInputBase-input": { fontSize: 12, py: 0.5 } }}
        />
      </Stack>
    </Tooltip>
  );
}

interface RowProps {
  seg: TranscriptSegment;
  query: string;
  splitLayout: boolean;
  isMatchActive: boolean;
  isPlaying: boolean;
  editing: boolean;
  isLast: boolean;
  onPlay: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (text: string) => Promise<void> | void;
  onSplit: (splitAt: number) => Promise<void> | void;
  onMergeNext: () => Promise<void> | void;
  onDelete: () => Promise<void> | void;
  onPatchTime: (patch: { start?: number; end?: number }) => Promise<void> | void;
  onRenameSpeaker: (fromLabel: string, toLabel: string) => Promise<void> | void;
  onSetSpeaker: (speaker: string | null) => Promise<void> | void;
  allSpeakers: string[];
  selected: boolean;
  onToggleSelect: (shiftKey: boolean) => void;
  onInsertAfter: () => Promise<void> | void;
  onDuplicate: () => Promise<void> | void;
  onMove: (newStart: number) => Promise<void> | void;
  seqNum: number;
  onReorder: (fromSeq: number, toSeq: number, pos: "before" | "after") => Promise<void> | void;
  draggingSeq: number | null;
  onDragStart: (seq: number) => void;
  onDragEnd: () => void;
  overlapsNext: boolean;
  overlapsPrev: boolean;
}

function SegmentRow({
  seg, query, splitLayout, isMatchActive, isPlaying, editing, isLast,
  selected, onToggleSelect,
  onPlay, onStartEdit, onCancelEdit, onSave, onSplit, onMergeNext, onDelete, onPatchTime,
  onRenameSpeaker, onSetSpeaker, allSpeakers,
  onInsertAfter, onDuplicate, onMove, seqNum, onReorder,
  draggingSeq, onDragStart, onDragEnd, overlapsNext, overlapsPrev,
}: RowProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(seg.text);
  const [movingTo, setMovingTo] = useState<string | null>(null);
  // Drop indicator position relative to this row while a drag hovers it.
  const [dropPos, setDropPos] = useState<"before" | "after" | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const editAreaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { setDraft(seg.text); }, [seg.text, editing]);

  const isDragging = draggingSeq === seqNum;
  const isDragActive = draggingSeq != null;

  const bg = isPlaying ? "var(--accent-soft)"
           : selected ? "var(--bg-subtle)"
           : isMatchActive ? "var(--bg-subtle)"
           : "transparent";

  const speakerColor = seg.speaker ? speakerHue(seg.speaker) : null;

  function commitMove() {
    const parsed = movingTo == null ? null : parseTimecode(movingTo);
    setMovingTo(null);
    if (parsed != null && Math.abs(parsed - seg.start) >= 0.005) void onMove(parsed);
  }

  function trySplitAtCursor() {
    const el = editAreaRef.current;
    if (!el) return;
    const pos = el.selectionStart ?? 0;
    if (pos <= 0 || pos >= draft.length) return; // can't split at edges
    // Save current draft first so split sees the latest text.
    void Promise.resolve(onSave(draft)).then(() => onSplit(pos));
  }

  return (
    <Box
      onDragOver={isDragActive ? (e) => {
        e.preventDefault();
        // Top half → drop before this row, bottom half → after.
        const rect = e.currentTarget.getBoundingClientRect();
        setDropPos(e.clientY - rect.top < rect.height / 2 ? "before" : "after");
      } : undefined}
      onDragLeave={() => setDropPos(null)}
      onDrop={(e) => {
        e.preventDefault();
        const pos = dropPos ?? "before";
        setDropPos(null);
        const from = Number(e.dataTransfer.getData("text/seq"));
        if (Number.isFinite(from) && from > 0) void onReorder(from, seqNum, pos);
      }}
      sx={{
      position: "relative",
      px: 2, py: 1.25, borderBottom: "1px solid var(--border-default)",
      bgcolor: bg,
      opacity: isDragging ? 0.4 : 1,
      transition: "background-color 140ms cubic-bezier(0.16, 1, 0.3, 1), opacity 140ms",
      borderLeft: isPlaying ? "1px solid var(--accent)"
                : selected ? "1px solid var(--accent)"
                : "1px solid transparent",
      // Bright insertion line at the top or bottom edge while a drag hovers.
      "&::after": dropPos ? {
        content: '""', position: "absolute", left: 0, right: 0,
        [dropPos === "before" ? "top" : "bottom"]: "-1px",
        height: "2px", bgcolor: "var(--accent)", zIndex: 3,
        boxShadow: "0 0 4px var(--accent)",
      } : {},
      // Brighten the overflow trigger, select checkbox and drag handle on
      // hover so the grid stays calm at rest but the affordances are findable.
      "&:hover .row-more": { opacity: 1 },
      "&:hover .row-select": { opacity: 1 },
      "&:hover .row-drag": { opacity: 0.45 },
    }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        {/* Drag handle — HTML5 drag to retime/reorder this line. Only the
            handle is draggable so text selection inside the row still works. */}
        <Box
          component="span" className="row-drag"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("text/seq", String(seqNum));
            e.dataTransfer.effectAllowed = "move";
            onDragStart(seqNum);
          }}
          onDragEnd={onDragEnd}
          title={t("transcript.drag_handle_tooltip")}
          sx={{
            display: "inline-flex", alignItems: "center",
            cursor: isDragging ? "grabbing" : "grab",
            color: isDragging ? "var(--accent)" : "text.muted",
            // Always faintly visible so the affordance is discoverable; brighter
            // on row hover (see parent `.row-drag` rule) and while dragging.
            opacity: isDragging ? 1 : 0.2,
            flexShrink: 0,
            transition: "opacity 140ms cubic-bezier(0.16, 1, 0.3, 1), color 140ms",
            "&:active": { cursor: "grabbing" },
          }}
        >
          <DragIndicator sx={{ fontSize: 16 }} />
        </Box>
        <Tooltip title={t("transcript.select_tooltip")}>
          <IconButton size="small"
              className="row-select"
              onClick={(e) => onToggleSelect(e.shiftKey)}
              aria-label="select segment"
              sx={{
                // Always visible (was hover-only, which hid the whole
                // region-select feature). Dim at rest, full on hover/selected.
                p: 0.25, color: selected ? "var(--accent)" : "text.muted",
                opacity: selected ? 1 : 0.4,
                transition: "opacity 140ms cubic-bezier(0.16, 1, 0.3, 1)",
              }}>
            {selected
              ? <CheckBox sx={{ fontSize: 16 }} />
              : <CheckBoxOutlineBlank sx={{ fontSize: 16 }} />}
          </IconButton>
        </Tooltip>
        <Tooltip title={t("transcript.play_tooltip")}>
          <IconButton size="small" onClick={onPlay} aria-label="play segment"
              sx={{ color: isPlaying ? "var(--accent)" : "text.muted" }}>
            <PlayArrow fontSize="small" />
          </IconButton>
        </Tooltip>
        <EditableTime value={seg.start} onCommit={(v) => onPatchTime({ start: v })}
            warn={overlapsPrev} />
        <Box component="span" sx={{ color: "text.muted", fontSize: 11 }}>→</Box>
        <EditableTime value={seg.end}   onCommit={(v) => onPatchTime({ end: v })}
            warn={overlapsNext} />
        {(overlapsNext || overlapsPrev) && (
          <Tooltip title={t("transcript.overlap_warning")}>
            <WarningAmber sx={{ fontSize: 14, color: "var(--warning)" }} />
          </Tooltip>
        )}
        <SpeakerControl
          value={seg.speaker ?? null}
          colors={speakerColor}
          allSpeakers={allSpeakers}
          onSetThis={onSetSpeaker}
          onRenameAll={onRenameSpeaker}
        />

        {/* Move-to-time: a small timecode input that re-sorts the transcript.
            Distinct from editing start time (which keeps order) — this is the
            "cut + paste-at-time" move. */}
        {movingTo != null && (
          <Box
            component="input" autoFocus value={movingTo}
            onChange={(e) => setMovingTo((e.target as HTMLInputElement).value)}
            onBlur={commitMove}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") { e.preventDefault(); commitMove(); }
              else if (e.key === "Escape") { e.preventDefault(); setMovingTo(null); }
            }}
            className="font-mono"
            placeholder={t("transcript.move_placeholder")}
            sx={{
              width: 100, height: 22, px: 0.5, ml: 1, borderRadius: 0.75,
              border: "1px solid var(--accent)", outline: "none",
              bgcolor: "background.paper", color: "text.primary", fontSize: 11,
            }}
          />
        )}

        <Box sx={{ flex: 1 }} />

        {/* Split stays inline ONLY in edit mode — it acts on the cursor, so it
            belongs next to the text being split. Everything else moves into a
            single overflow menu to keep the row calm (was 5 ghost icons). */}
        {editing && (
          <Tooltip title={t("transcript.split_tooltip")}>
            <span>
              <IconButton size="small" onClick={trySplitAtCursor}
                  aria-label="split at cursor" sx={{ color: "text.muted" }}>
                <ContentCut sx={{ fontSize: 14 }} />
              </IconButton>
            </span>
          </Tooltip>
        )}

        {/* One always-present (faint) overflow trigger — satisfies the
            "primary actions always visible" principle while collapsing the
            secondary ops into a menu. */}
        <Tooltip title={t("transcript.more_actions")}>
          <IconButton size="small" className="row-more"
              onClick={(e) => setMenuAnchor(e.currentTarget)}
              aria-label="more actions"
              sx={{
                color: "text.muted", opacity: 0.35,
                transition: "opacity 140ms cubic-bezier(0.16, 1, 0.3, 1)",
              }}>
            <MoreHoriz sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
        <Menu
          anchorEl={menuAnchor} open={menuAnchor != null}
          onClose={() => setMenuAnchor(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
        >
          <MenuItem onClick={() => { setMenuAnchor(null); void onInsertAfter(); }}>
            <PlaylistAdd sx={{ fontSize: 16, mr: 1 }} /> {t("transcript.insert_tooltip")}
          </MenuItem>
          <MenuItem onClick={() => { setMenuAnchor(null); void onDuplicate(); }}>
            <ContentCopy sx={{ fontSize: 16, mr: 1 }} /> {t("transcript.duplicate_tooltip")}
          </MenuItem>
          <MenuItem onClick={() => { setMenuAnchor(null); setMovingTo(formatTimecode(seg.start)); }}>
            <SwapVert sx={{ fontSize: 16, mr: 1 }} /> {t("transcript.move_tooltip")}
          </MenuItem>
          {!isLast && (
            <MenuItem onClick={() => { setMenuAnchor(null); void onMergeNext(); }}>
              <CallMerge sx={{ fontSize: 16, mr: 1, transform: "rotate(180deg)" }} /> {t("transcript.merge_next_tooltip")}
            </MenuItem>
          )}
          <Divider sx={{ my: 0.5 }} />
          <MenuItem
            onClick={() => { setMenuAnchor(null); void onDelete(); }}
            sx={{ color: "var(--danger)" }}
          >
            <DeleteOutline sx={{ fontSize: 16, mr: 1 }} /> {t("transcript.delete_tooltip")}
          </MenuItem>
        </Menu>
      </Stack>

      {splitLayout ? (
        <Box sx={{
          display: "grid", gap: 2, mt: 0.5,
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          alignItems: "start",
        }}>
          <Box>
            {editing ? (
              <TextField
                autoFocus multiline fullWidth size="small" value={draft}
                inputRef={editAreaRef}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { e.preventDefault(); onCancelEdit(); }
                  else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void onSave(draft); }
                }}
                onBlur={() => void onSave(draft)}
              />
            ) : (
              <Typography component="div" title={t("transcript.click_hint")}
                  sx={{ cursor: "pointer" }}
                  onClick={onPlay} onDoubleClick={onStartEdit}>
                {highlightQuery(seg.text, query)}
              </Typography>
            )}
          </Box>
          <Box sx={{ borderLeft: { md: "1px solid var(--border-default)" }, pl: { md: 2 } }}>
            {seg.translation ? (
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                {seg.translation}
              </Typography>
            ) : (
              <Typography variant="caption" sx={{ color: "text.muted" }}>·</Typography>
            )}
          </Box>
        </Box>
      ) : (
        <>
          {editing ? (
            <TextField
              autoFocus multiline fullWidth size="small" value={draft}
              inputRef={editAreaRef}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.preventDefault(); onCancelEdit(); }
                else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void onSave(draft); }
              }}
              onBlur={() => void onSave(draft)}
              sx={{ mt: 0.5 }}
            />
          ) : (
            <Typography component="div" title={t("transcript.click_hint")}
                sx={{ mt: 0.25, cursor: "pointer" }}
                onClick={onPlay} onDoubleClick={onStartEdit}>
              {highlightQuery(seg.text, query)}
            </Typography>
          )}
          {seg.translation && (
            <Typography variant="body2" sx={{ color: "text.secondary", ml: 4, mt: 0.5 }}>
              {seg.translation}
            </Typography>
          )}
        </>
      )}
    </Box>
  );
}

/** Speaker pill with a popover that handles the full range of per-row speaker
 *  edits: assign one to an un-labelled row, switch THIS row to a different
 *  speaker (reuse an existing label or type a new one), clear it, or bulk-rename
 *  the label across the whole transcript. The trigger is a coloured pill when
 *  the row has a speaker, or a faint "+ speaker" chip when it doesn't. */
function SpeakerControl({
  value, colors, allSpeakers, onSetThis, onRenameAll,
}: {
  value: string | null;
  colors: { solid: string; soft: string } | null;
  allSpeakers: string[];
  onSetThis: (speaker: string | null) => Promise<void> | void;
  onRenameAll: (fromLabel: string, toLabel: string) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const open = Boolean(anchorEl);

  function close() {
    setAnchorEl(null);
    setDraft("");
    setRenaming(false);
    setRenameDraft("");
  }
  function pick(sp: string) {
    if (sp !== value) void onSetThis(sp);
    close();
  }
  function addNew() {
    const next = draft.trim();
    if (next && next !== value) void onSetThis(next);
    close();
  }
  function clearThis() {
    void onSetThis(null);
    close();
  }
  function commitRename() {
    const to = renameDraft.trim();
    if (value && to && to !== value) void onRenameAll(value, to);
    close();
  }

  const others = allSpeakers.filter((s) => s !== value);

  return (
    <>
      {value && colors ? (
        <Tooltip title={t("transcript.speaker_edit_tooltip")}>
          <Box
            component="button" type="button"
            onClick={(e) => { e.stopPropagation(); setAnchorEl(e.currentTarget); }}
            sx={{
              display: "inline-flex", alignItems: "center", gap: 0.5,
              px: 1, height: 18, borderRadius: 999, fontSize: 10, fontWeight: 500,
              bgcolor: colors.soft, color: colors.solid,
              border: "1px solid transparent", cursor: "pointer",
              transition: "border-color 140ms cubic-bezier(0.16, 1, 0.3, 1)",
              "&:hover": { borderColor: colors.solid },
            }}
          >
            <Box component="span" sx={{
              width: 6, height: 6, borderRadius: "50%", bgcolor: colors.solid,
            }} />
            {value}
          </Box>
        </Tooltip>
      ) : (
        <Tooltip title={t("transcript.speaker_assign_tooltip")}>
          <Box
            component="button" type="button"
            onClick={(e) => { e.stopPropagation(); setAnchorEl(e.currentTarget); }}
            // Faint until hover so un-labelled rows don't feel cluttered, but the
            // affordance is always there.
            className="speaker-assign"
            sx={{
              display: "inline-flex", alignItems: "center", gap: 0.375,
              px: 0.75, height: 18, borderRadius: 999, fontSize: 10, fontWeight: 500,
              bgcolor: "transparent", color: "text.muted",
              border: "1px dashed var(--border-default)", cursor: "pointer",
              opacity: 0.55, transition: "opacity 140ms, border-color 140ms, color 140ms",
              "&:hover": { opacity: 1, borderColor: "var(--accent)", color: "var(--accent)" },
            }}
          >
            <PersonAddAlt1 sx={{ fontSize: 12 }} />
            {t("transcript.speaker_assign")}
          </Box>
        </Tooltip>
      )}

      <Popover
        open={open} anchorEl={anchorEl} onClose={close}
        // Clicks inside must not bubble to the row (which would play/select it).
        onClick={(e) => e.stopPropagation()}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { sx: {
          mt: 0.5, p: 1.25, width: 248, borderRadius: 2,
          border: "1px solid var(--border-default)",
        } } }}
      >
        {others.length > 0 && (
          <>
            <Typography variant="overline" sx={{
              display: "block", color: "text.muted", fontSize: 10, letterSpacing: 0.6, mb: 0.5,
            }}>
              {t("transcript.speaker_pick")}
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mb: 1 }}>
              {others.map((sp) => {
                const c = speakerHue(sp);
                return (
                  <Box key={sp}
                    component="button" type="button"
                    onClick={() => pick(sp)}
                    sx={{
                      display: "inline-flex", alignItems: "center", gap: 0.5,
                      px: 1, height: 22, borderRadius: 999, fontSize: 11, fontWeight: 500,
                      bgcolor: c.soft, color: c.solid,
                      border: "1px solid transparent", cursor: "pointer",
                      "&:hover": { borderColor: c.solid },
                    }}
                  >
                    <Box component="span" sx={{
                      width: 6, height: 6, borderRadius: "50%", bgcolor: c.solid,
                    }} />
                    {sp}
                  </Box>
                );
              })}
            </Stack>
          </>
        )}

        <Typography variant="overline" sx={{
          display: "block", color: "text.muted", fontSize: 10, letterSpacing: 0.6, mb: 0.5,
        }}>
          {value ? t("transcript.speaker_change_new") : t("transcript.speaker_assign_new")}
        </Typography>
        <Box
          component="input" autoFocus value={draft}
          placeholder={t("transcript.speaker_new_placeholder")}
          onChange={(e) => setDraft((e.target as HTMLInputElement).value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") { e.preventDefault(); addNew(); }
            else if (e.key === "Escape") { e.preventDefault(); close(); }
          }}
          sx={{
            width: "100%", height: 30, px: 1, borderRadius: 1, outline: "none",
            border: "1px solid var(--border-default)", bgcolor: "background.paper",
            color: "text.primary", fontSize: 12,
            "&:focus": { borderColor: "var(--accent)" },
          }}
        />

        {value && (
          <Stack spacing={0.25} sx={{ mt: 1, pt: 1, borderTop: "1px solid var(--border-default)" }}>
            {!renaming ? (
              <Box
                component="button" type="button"
                onClick={() => { setRenaming(true); setRenameDraft(value); }}
                sx={menuRowSx}
              >
                <SwapVert sx={{ fontSize: 15 }} />
                {t("transcript.speaker_rename_all", { label: value })}
              </Box>
            ) : (
              <Box
                component="input" autoFocus value={renameDraft}
                onChange={(e) => setRenameDraft((e.target as HTMLInputElement).value)}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                  else if (e.key === "Escape") { e.preventDefault(); setRenaming(false); }
                }}
                onBlur={commitRename}
                sx={{
                  width: "100%", height: 30, px: 1, borderRadius: 1, outline: "none",
                  border: "1px solid var(--accent)", bgcolor: "background.paper",
                  color: "text.primary", fontSize: 12,
                }}
              />
            )}
            <Box
              component="button" type="button"
              onClick={clearThis}
              sx={{ ...menuRowSx, color: "var(--danger)" }}
            >
              <PersonRemove sx={{ fontSize: 15 }} />
              {t("transcript.speaker_remove")}
            </Box>
          </Stack>
        )}
      </Popover>
    </>
  );
}

const menuRowSx = {
  display: "flex", alignItems: "center", gap: 0.75,
  width: "100%", px: 1, height: 30, borderRadius: 1, fontSize: 12,
  bgcolor: "transparent", border: "none", cursor: "pointer",
  color: "text.secondary", textAlign: "left" as const,
  "&:hover": { bgcolor: "var(--bg-subtle)" },
};

/** Inline-editable timecode chip. Click → text input; Enter / blur commits.
 *  Format is MM:SS.s or HH:MM:SS.s; we parse with a permissive regex.
 *  `warn` paints it in the danger colour when this edge overlaps a neighbour. */
function EditableTime({
  value, onCommit, warn,
}: { value: number; onCommit: (v: number) => void; warn?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => formatTimecode(value));
  useEffect(() => { setDraft(formatTimecode(value)); }, [value, editing]);

  function commit() {
    setEditing(false);
    const parsed = parseTimecode(draft);
    if (parsed == null || Math.abs(parsed - value) < 0.005) return;
    onCommit(parsed);
  }

  if (editing) {
    return (
      <Box
        component="input"
        autoFocus
        value={draft}
        onChange={(e) => setDraft((e.target as HTMLInputElement).value)}
        onBlur={commit}
        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          else if (e.key === "Escape") { e.preventDefault(); setDraft(formatTimecode(value)); setEditing(false); }
        }}
        className="font-mono"
        sx={{
          width: 92, height: 22, px: 0.5, borderRadius: 0.75,
          border: "1px solid var(--accent)", outline: "none",
          bgcolor: "background.paper", color: "text.primary",
          fontSize: 11,
        }}
      />
    );
  }

  return (
    <Box
      component="button" type="button" onClick={() => setEditing(true)}
      className="font-mono"
      sx={{
        background: "none", border: "none", cursor: "text", p: 0,
        fontSize: 11,
        color: warn ? "var(--danger)" : "text.muted",
        fontWeight: warn ? 700 : 400,
        "&:hover": { color: warn ? "var(--danger)" : "text.secondary", textDecoration: "underline dotted" },
      }}
      title="Click to edit"
    >
      {formatTimecode(value)}
    </Box>
  );
}

/** Accepts `HH:MM:SS.sss` / `MM:SS.sss` / raw seconds. Returns null on garbage. */
function parseTimecode(s: string): number | null {
  s = s.trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const m = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d+))?$/);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  const frac = m[4] ? Number(`0.${m[4]}`) : 0;
  if (mm >= 60 || ss >= 60) return null;
  return h * 3600 + mm * 60 + ss + frac;
}

/** Stable speaker → OKLCH hue mapping. Six well-separated hues (lightness +
 *  chroma tuned to read on both light + dark surfaces). */
const SPEAKER_HUES = [295, 220, 160, 30, 0, 260];
function speakerHue(label: string): { solid: string; soft: string } {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  const hue = SPEAKER_HUES[h % SPEAKER_HUES.length];
  return {
    solid: `oklch(50% 0.16 ${hue})`,
    soft:  `oklch(94% 0.03 ${hue})`,
  };
}

function highlightQuery(text: string, query: string): ReactNode {
  if (!query.trim()) return text;
  const q = query.toLowerCase();
  const out: ReactNode[] = [];
  let cursor = 0;
  const lower = text.toLowerCase();
  let key = 0;
  while (true) {
    const idx = lower.indexOf(q, cursor);
    if (idx === -1) { out.push(text.slice(cursor)); break; }
    if (idx > cursor) out.push(text.slice(cursor, idx));
    out.push(
      <mark key={key++} style={{ backgroundColor: "var(--accent)", color: "var(--accent-fg)", padding: "0 2px", borderRadius: 2 }}>
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    cursor = idx + q.length;
  }
  return <>{out}</>;
}
