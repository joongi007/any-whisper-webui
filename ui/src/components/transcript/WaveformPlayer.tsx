import { Pause, PlayArrow } from "@mui/icons-material";
import { Box, IconButton, Skeleton, Typography } from "@mui/material";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import WaveSurfer from "wavesurfer.js";

import { formatTimecode } from "../../utils/time";

export interface WaveformHandle {
  /** Jump to `sec` and resume playback. No-op until the waveform is decoded. */
  seekAndPlay: (sec: number) => void;
  /** Pause without losing position. */
  pause: () => void;
  /** Toggle play/pause at the current position. No-op until decoded. */
  togglePlay: () => void;
  /** Current playback position in seconds; 0 before decode. */
  getCurrentTime: () => number;
}

interface Props {
  src: string;
  /** Fires on every `timeupdate` from wavesurfer (~60Hz while playing). */
  onTimeUpdate?: (currentTime: number) => void;
  /** Fires once when the audio is decoded and ready to play. */
  onReady?: (duration: number) => void;
  /** Fires when wavesurfer hits an error fetching/decoding (typically 404 from
   *  realtime sessions). The parent can then swap the player for an
   *  explanation instead of leaving an empty frame. */
  onMissing?: () => void;
  /** Optional segment-boundary times (seconds). Drawn as 1px tick marks at
   *  the top of the waveform — quick visual scaffold for "where am I". */
  boundaries?: readonly number[];
  /** Optional pre-computed waveform peaks from the ai pipeline. When provided,
   *  wavesurfer skips its in-browser decode and renders immediately — for a
   *  60-min recording that's ~5s of wait removed. */
  peaks?: readonly number[];
  /** Required when `peaks` is provided — wavesurfer needs the total duration
   *  to map peaks across the visible width. */
  precomputedDuration?: number;
  /** When true, dragging across the waveform selects a time region (instead of
   *  only seeking). A plain click still seeks. Used to pick a span to
   *  retranscribe — the only way in when the transcript is empty. */
  regionSelectable?: boolean;
  /** Fires on drag-release with the selected [start, end] in seconds. */
  onRegionSelect?: (tStart: number, tEnd: number) => void;
  /** The currently-selected region to highlight (controlled by the parent), or
   *  null for none. Drawn as the strong "drag selection" band. */
  selectedRegion?: readonly [number, number] | null;
  /** Additional time spans to highlight softly — e.g. the subtitle rows the
   *  user has selected — so they can see *where* on the waveform they are. */
  highlightRegions?: ReadonlyArray<readonly [number, number]>;
  /** The segment currently playing, highlighted distinctly ("you are here"). */
  activeRegion?: readonly [number, number] | null;
  /** A single segment's [start, end] made editable on the waveform: drag the
   *  left/right handles to retime its bounds, drag the middle to move it.
   *  `onRegionEdit` fires once on release with the new [start, end]. */
  editableRegion?: readonly [number, number] | null;
  onRegionEdit?: (start: number, end: number) => void;
}

/** Replaces the bare <audio> with a visual waveform: it gives the user a
 *  spatial sense of where in the recording they're scrubbing, plus
 *  click-to-seek that's much faster than dragging the native scrubber on a
 *  60-min file. Renders nothing until decode completes — for hour-long files
 *  that's ~5s; the skeleton + status message keep the surface honest. */
export const WaveformPlayer = forwardRef<WaveformHandle, Props>(
  function WaveformPlayer({
    src, onTimeUpdate, onReady, onMissing, boundaries, peaks, precomputedDuration,
    regionSelectable, onRegionSelect, selectedRegion, highlightRegions, activeRegion,
    editableRegion, onRegionEdit,
  }, ref) {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const wsRef = useRef<WaveSurfer | null>(null);
    const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [playing, setPlaying] = useState(false);
    // Deferred seek: if the user clicks a segment before wavesurfer's `ready`
    // event fires (common right after job completion — TranscriptViewer mounts
    // but the MediaElement is still buffering), buffer the target time here
    // and replay it in the `ready` handler. Was: silent drop → row never
    // highlighted until refresh.
    const pendingSeekRef = useRef<number | null>(null);

    // Drag-to-select-region state. `drag` holds the in-progress selection in
    // seconds; null when not dragging.
    const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
    const dragStartXRef = useRef<number | null>(null);
    const overlayRef = useRef<HTMLDivElement | null>(null);

    // Editable-region drag state (resize start/end, or move the whole span).
    const [editPreview, setEditPreview] = useState<[number, number] | null>(null);
    const editDragRef = useRef<
      { mode: "start" | "end" | "move"; t0: number; t1: number; anchor: number } | null
    >(null);
    // Coalesce mousemove → one state update per animation frame. Raw mousemove
    // fires far faster than 60Hz; without this each event triggers a re-render.
    const rafRef = useRef<number | null>(null);

    // Callback refs — the document-level drag effects are bound once (on
    // duration change), so capturing the prop closures directly would freeze
    // a stale version (e.g. onRegionEdit from before any row was selected,
    // where the parent's editableSeq was still null → saves silently no-op'd).
    // Reading through a ref always calls the latest closure.
    const onRegionEditRef = useRef(onRegionEdit);
    onRegionEditRef.current = onRegionEdit;
    const onRegionSelectRef = useRef(onRegionSelect);
    onRegionSelectRef.current = onRegionSelect;
    // The wavesurfer event handlers are registered once per `src` (audio doesn't
    // change on retranscribe), so calling these props directly would freeze the
    // version captured at mount — `onTimeUpdate` would index into a stale
    // segments array and highlight the wrong line until a refresh. Read through
    // refs so playback always uses the latest segments.
    const onTimeUpdateRef = useRef(onTimeUpdate);
    onTimeUpdateRef.current = onTimeUpdate;
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;
    const onMissingRef = useRef(onMissing);
    onMissingRef.current = onMissing;

    // Boundary ticks can be up to 500 absolute boxes. Memoise them so a drag
    // (which re-renders this component on every mousemove via setDrag) doesn't
    // rebuild all of them each frame — the cause of the sluggish drag.
    const boundaryOverlay = useMemo(() => {
      if (phase !== "ready" || duration <= 0 || !boundaries || boundaries.length === 0) return null;
      return (
        <Box aria-hidden="true" sx={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {boundaries.map((sec, i) => {
            if (sec <= 0 || sec >= duration) return null;
            return (
              <Box key={i} sx={{
                position: "absolute", top: 0, bottom: 0,
                left: `${(sec / duration) * 100}%`, width: "1px",
                bgcolor: "var(--border-strong)", opacity: 0.45,
              }} />
            );
          })}
        </Box>
      );
    }, [phase, duration, boundaries]);

    function timeFromClientX(clientX: number): number {
      // Measure against the waveform container — always present once ready,
      // unlike the drag overlay (which we hide while editing a region).
      const el = containerRef.current ?? overlayRef.current;
      if (!el || duration <= 0) return 0;
      const rect = el.getBoundingClientRect();
      const ratio = (clientX - rect.left) / Math.max(1, rect.width);
      return Math.max(0, Math.min(duration, ratio * duration));
    }

    function doSeekAndPlay(ws: WaveSurfer, sec: number) {
      const d = ws.getDuration() || 0;
      if (d > 0) ws.setTime(Math.max(0, Math.min(sec, d - 0.05)));
      void ws.play();
    }

    // Document-level drag tracking: once a drag starts on the overlay, follow
    // the mouse anywhere (even outside the waveform) and only finish on mouseup.
    // This fixes the "leave the bar → selection resets + page text selected"
    // problem. Bound while the component is mounted; cheap no-ops when idle.
    useEffect(() => {
      if (!regionSelectable) return;
      function onMove(e: MouseEvent) {
        if (dragStartXRef.current == null) return;
        if (rafRef.current != null) return;  // throttle to one update per frame
        const x = e.clientX;
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          setDrag((d) => (d ? { ...d, b: timeFromClientX(x) } : d));
        });
      }
      function onUp(e: MouseEvent) {
        if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
        const startX = dragStartXRef.current;
        if (startX == null) return;
        dragStartXRef.current = null;
        const moved = Math.abs(e.clientX - startX) >= 4;
        setDrag((cur) => {
          if (moved && cur) {
            const lo = Math.min(cur.a, cur.b);
            const hi = Math.max(cur.a, cur.b);
            if (hi - lo > 0.1) onRegionSelectRef.current?.(lo, hi);
          } else {
            const ws = wsRef.current;
            if (ws) ws.setTime(timeFromClientX(e.clientX));
          }
          return null;
        });
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      return () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      // timeFromClientX/onRegionSelect are stable enough; rebinding per render
      // is harmless and keeps the latest closures.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [regionSelectable, duration]);

    // Editable-region drag: resize a handle or move the whole span. Tracks on
    // document so the cursor can leave the waveform mid-drag.
    useEffect(() => {
      function onMove(e: MouseEvent) {
        const d = editDragRef.current;
        if (!d) return;
        if (rafRef.current != null) return;  // one update per frame
        const x = e.clientX;
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          const t = timeFromClientX(x);
          const MIN = 0.05;
          if (d.mode === "start") {
            setEditPreview([Math.min(t, d.t1 - MIN), d.t1]);
          } else if (d.mode === "end") {
            setEditPreview([d.t0, Math.max(t, d.t0 + MIN)]);
          } else {
            const span = d.t1 - d.t0;
            let s = d.t0 + (t - d.anchor);
            s = Math.max(0, Math.min(s, duration - span));
            setEditPreview([s, s + span]);
          }
        });
      }
      function onUp() {
        const d = editDragRef.current;
        if (!d) return;
        editDragRef.current = null;
        setEditPreview((prev) => {
          if (prev) onRegionEditRef.current?.(prev[0], prev[1]);
          return null;
        });
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      return () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [duration]);

    function startEditDrag(mode: "start" | "end" | "move", e: React.MouseEvent) {
      if (!editableRegion) return;
      e.preventDefault();
      e.stopPropagation();
      editDragRef.current = {
        mode, t0: editableRegion[0], t1: editableRegion[1],
        anchor: timeFromClientX(e.clientX),
      };
      setEditPreview([editableRegion[0], editableRegion[1]]);
    }

    useImperativeHandle(ref, () => ({
      seekAndPlay: (sec) => {
        const ws = wsRef.current;
        if (!ws) return;
        if (phase !== "ready") { pendingSeekRef.current = sec; return; }
        doSeekAndPlay(ws, sec);
      },
      pause: () => wsRef.current?.pause(),
      togglePlay: () => {
        const ws = wsRef.current;
        if (!ws || phase !== "ready") return;
        if (ws.isPlaying()) ws.pause(); else void ws.play();
      },
      getCurrentTime: () => wsRef.current?.getCurrentTime() ?? 0,
    }), [phase]);

    // Colours are read off the design tokens at mount. We have to resolve OKLCH
    // strings ourselves because wavesurfer wants a fillStyle, not a CSS var.
    useEffect(() => {
      if (!containerRef.current) return;
      const cs = getComputedStyle(document.documentElement);
      const waveColor     = cs.getPropertyValue("--text-muted").trim() || "#888";
      const progressColor = cs.getPropertyValue("--accent").trim() || "#6D28D9";
      const cursorColor   = cs.getPropertyValue("--accent-strong").trim() || "#4F1AAA";

      // With pre-computed peaks, hand wavesurfer the peaks array + total
      // duration so it skips the decode entirely and renders synchronously.
      // The MediaElement backend still lazy-loads `url` for playback, so
      // play/seek work the same way; we just removed the front-loaded decode.
      const hasPeaks = peaks && peaks.length > 0 && (precomputedDuration ?? 0) > 0;
      const ws = WaveSurfer.create({
        container: containerRef.current,
        url: src,
        height: 56,
        waveColor,
        progressColor,
        cursorColor,
        cursorWidth: 1,
        barWidth: 2,
        barGap: 1,
        barRadius: 1,
        normalize: true,
        backend: "MediaElement",
        ...(hasPeaks
          ? { peaks: [Array.from(peaks!)], duration: precomputedDuration }
          : {}),
      });
      wsRef.current = ws;

      ws.on("ready", () => {
        setPhase("ready");
        const d = ws.getDuration();
        setDuration(d);
        onReadyRef.current?.(d);
        // Replay a click that fired before we were ready.
        const queued = pendingSeekRef.current;
        if (queued != null) {
          pendingSeekRef.current = null;
          doSeekAndPlay(ws, queued);
        }
      });
      ws.on("timeupdate", (t) => {
        setCurrentTime(t);
        onTimeUpdateRef.current?.(t);
      });
      ws.on("play",  () => setPlaying(true));
      ws.on("pause", () => setPlaying(false));
      ws.on("finish", () => setPlaying(false));
      ws.on("error", (e) => {
        // 404 is normal for realtime sessions (no audio persisted). Don't
        // shout in the UI; bubble up so the parent can swap in an explanation.
        // eslint-disable-next-line no-console
        console.warn("wavesurfer error", e);
        setPhase("error");
        onMissingRef.current?.();
      });

      return () => { ws.destroy(); wsRef.current = null; };
      // src is the cache key — recreate the surfer if it changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [src]);

    if (phase === "error") return null;

    return (
      <Box sx={{
        display: "grid", gap: 1,
        gridTemplateColumns: "auto 1fr auto",
        alignItems: "center",
        p: 1, borderRadius: 2,
        border: "1px solid var(--border-default)",
        bgcolor: "background.paper",
        // DESIGN: the audio player frame carries shadow-2 (it's a tool the user
        // returns to while scrolling a long transcript — lift it off the page).
        boxShadow: "var(--shadow-2)",
      }}>
        <IconButton
          size="small" disabled={phase !== "ready"}
          onClick={() => {
            const ws = wsRef.current; if (!ws) return;
            if (ws.isPlaying()) ws.pause(); else void ws.play();
          }}
          aria-label={playing ? t("common.pause") : t("common.play")}
          sx={{
            width: 36, height: 36,
            bgcolor: "var(--accent)", color: "var(--accent-fg)",
            "&:hover": { bgcolor: "var(--accent-strong)" },
            "&.Mui-disabled": { bgcolor: "var(--bg-subtle)", color: "var(--text-muted)" },
          }}
        >
          {playing ? <Pause fontSize="small" /> : <PlayArrow fontSize="small" />}
        </IconButton>

        <Box sx={{ position: "relative", minWidth: 0 }}>
          <Box ref={containerRef} sx={{ width: "100%" }} />

          {/* Soft highlights for selected subtitle rows — shows where on the
              waveform the current selection sits. */}
          {phase === "ready" && duration > 0 && highlightRegions && highlightRegions.map(([a, b], i) => (
            <Box key={`hl-${i}`} aria-hidden="true" sx={{
              position: "absolute", top: 0, bottom: 0, pointerEvents: "none",
              left: `${(a / duration) * 100}%`,
              width: `${(Math.max(0, b - a) / duration) * 100}%`,
              bgcolor: "var(--accent)", opacity: 0.18,
            }} />
          ))}

          {/* The playing segment — distinct, brighter band. */}
          {phase === "ready" && duration > 0 && activeRegion && (
            <Box aria-hidden="true" sx={{
              position: "absolute", top: 0, bottom: 0, pointerEvents: "none",
              left: `${(activeRegion[0] / duration) * 100}%`,
              width: `${(Math.max(0, activeRegion[1] - activeRegion[0]) / duration) * 100}%`,
              bgcolor: "var(--success)", opacity: 0.28,
            }} />
          )}

          {/* Selected region highlight (controlled by parent). */}
          {phase === "ready" && duration > 0 && selectedRegion && (
            <Box aria-hidden="true" sx={{
              position: "absolute", top: 0, bottom: 0, pointerEvents: "none",
              left: `${(selectedRegion[0] / duration) * 100}%`,
              width: `${((selectedRegion[1] - selectedRegion[0]) / duration) * 100}%`,
              bgcolor: "var(--accent-soft)", border: "1px solid var(--accent)",
              opacity: 0.7,
            }} />
          )}

          {/* Editable region — a single subtitle's bounds, with grab handles.
              Sits above the drag-select overlay (higher zIndex) so the handles
              are clickable. */}
          {phase === "ready" && duration > 0 && (editPreview || editableRegion) && (() => {
            const [rs, re] = editPreview ?? (editableRegion as readonly [number, number]);
            const leftPct = (rs / duration) * 100;
            const widthPct = (Math.max(0, re - rs) / duration) * 100;
            const HANDLE = 10; // px hit area
            return (
              <Box sx={{
                position: "absolute", top: 0, bottom: 0, zIndex: 3,
                left: `${leftPct}%`, width: `${widthPct}%`,
                bgcolor: "var(--accent)", opacity: 0.22,
                border: "1px solid var(--accent)",
              }}>
                {/* Middle — move the whole span. */}
                <Box
                  onMouseDown={(e) => startEditDrag("move", e)}
                  sx={{ position: "absolute", inset: 0, cursor: "grab",
                        "&:active": { cursor: "grabbing" } }}
                />
                {/* Left handle — resize start. */}
                <Box
                  onMouseDown={(e) => startEditDrag("start", e)}
                  sx={{
                    position: "absolute", left: -HANDLE / 2, top: 0, bottom: 0,
                    width: HANDLE, cursor: "ew-resize", zIndex: 1,
                    "&::after": { content: '""', position: "absolute", left: "50%",
                      top: 0, bottom: 0, width: 2, bgcolor: "var(--accent)", transform: "translateX(-50%)" },
                  }}
                />
                {/* Right handle — resize end. */}
                <Box
                  onMouseDown={(e) => startEditDrag("end", e)}
                  sx={{
                    position: "absolute", right: -HANDLE / 2, top: 0, bottom: 0,
                    width: HANDLE, cursor: "ew-resize", zIndex: 1,
                    "&::after": { content: '""', position: "absolute", left: "50%",
                      top: 0, bottom: 0, width: 2, bgcolor: "var(--accent)", transform: "translateX(-50%)" },
                  }}
                />
              </Box>
            );
          })()}

          {/* In-progress drag selection. */}
          {phase === "ready" && duration > 0 && drag && (
            <Box aria-hidden="true" sx={{
              position: "absolute", top: 0, bottom: 0, pointerEvents: "none",
              left: `${(Math.min(drag.a, drag.b) / duration) * 100}%`,
              width: `${(Math.abs(drag.b - drag.a) / duration) * 100}%`,
              bgcolor: "var(--accent)", opacity: 0.25,
            }} />
          )}

          {/* Drag-capture overlay — only active when regionSelectable. A drag
              selects a span; a plain click (< 4px) falls through to a seek so
              click-to-seek still works. Drag tracking happens on `document`
              (see the effect) so leaving the waveform mid-drag doesn't cancel
              it and the page text doesn't get selected. */}
          {phase === "ready" && regionSelectable && !editableRegion && (
            <Box
              ref={overlayRef}
              onMouseDown={(e) => {
                e.preventDefault();  // suppress text selection
                dragStartXRef.current = e.clientX;
                const t = timeFromClientX(e.clientX);
                setDrag({ a: t, b: t });
              }}
              sx={{
                position: "absolute", inset: 0, cursor: "crosshair", zIndex: 2,
                userSelect: "none",
              }}
            />
          )}

          {/* Boundary overlay: 1px ticks at segment start times (memoised
              above so drag re-renders don't rebuild them). Pointer-events none
              → doesn't steal wavesurfer's click-to-seek. */}
          {boundaryOverlay}

          {phase === "loading" && (
            <Box sx={{
              position: "absolute", inset: 0, display: "flex", alignItems: "center",
            }}>
              <Skeleton variant="rectangular" width="100%" height={56}
                  sx={{ bgcolor: "var(--bg-subtle)" }} />
            </Box>
          )}
        </Box>

        <Typography variant="caption" className="font-mono"
            sx={{ color: "text.muted", minWidth: 100, textAlign: "right" }}>
          {formatTimecode(currentTime)} / {formatTimecode(duration)}
        </Typography>
      </Box>
    );
  },
);
