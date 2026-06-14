import { Box, Typography } from "@mui/material";
import { useEffect, useRef } from "react";

import { useRealtimeStore } from "../../stores/realtimeStore";
import { formatTimecode } from "../../utils/time";

// Mirror TranscriptViewer's OKLCH speaker hash so the same speaker reads as
// the same colour across live and saved views. Six hues, well-separated.
const SPK_HUES = [295, 220, 160, 30, 0, 260];
function color(spk: string | null | undefined) {
  if (!spk) return "var(--text-muted)";
  let h = 0;
  for (let i = 0; i < spk.length; i++) h = (h * 31 + spk.charCodeAt(i)) >>> 0;
  return `oklch(50% 0.16 ${SPK_HUES[h % SPK_HUES.length]})`;
}

export function LiveTranscript() {
  const segs = useRealtimeStore((s) => s.segments);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const d = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (d < 80) el.scrollTop = el.scrollHeight;
  }, [segs.length]);

  return (
    <Box ref={ref} role="log" aria-live="polite" aria-atomic="false"
         sx={{ height: 320, overflow: "auto", p: 2, border: "1px solid var(--border-default)",
               borderRadius: 2, bgcolor: "background.paper" }}>
      {segs.length === 0 && <Typography variant="body2" sx={{ color: "text.secondary" }}>·</Typography>}
      {segs.map((seg) => (
        <Box key={seg.id} sx={{ mb: 1, opacity: seg.isPartial ? 0.6 : 1 }}>
          <Typography variant="caption" className="font-mono" sx={{ color: "text.secondary", mr: 1 }}>
            {formatTimecode(seg.start)}
          </Typography>
          {seg.speaker && (
            <Box component="span" sx={{ display: "inline-block", bgcolor: color(seg.speaker), color: "var(--accent-fg)",
                                        px: 0.75, borderRadius: 0.75, mr: 1, fontSize: 11, fontWeight: 500 }}>
              {seg.speaker}
            </Box>
          )}
          <Typography component="span" sx={{ fontStyle: seg.isPartial ? "italic" : "normal" }}>
            {seg.text}
          </Typography>
          {seg.translation && (
            <Typography variant="body2" sx={{ color: "text.secondary", ml: 8 }}>↳ {seg.translation}</Typography>
          )}
        </Box>
      ))}
    </Box>
  );
}
