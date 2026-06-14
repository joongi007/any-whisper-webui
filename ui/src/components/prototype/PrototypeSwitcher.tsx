import { ChevronLeft, ChevronRight } from "@mui/icons-material";
import { Box, IconButton, Typography } from "@mui/material";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

/** Floating bottom bar that cycles through `?variant=A|B|C…` on the *current
 *  route*. The route reads `useVariant()` to decide which subtree to render.
 *  Hidden in production so a stray merge doesn't ship the bar to users.
 *
 *  Per prototype/UI.md: keep visually distinct from the page (high-contrast
 *  pill) so it's obvious it isn't part of the design being evaluated. */
export function PrototypeSwitcher({
  variants, labels = {},
}: { variants: string[]; labels?: Record<string, string> }) {
  const [params, setParams] = useSearchParams();
  const current = params.get("variant") ?? variants[0];

  function cycle(delta: number) {
    const idx = Math.max(0, variants.indexOf(current));
    const next = variants[(idx + delta + variants.length) % variants.length];
    const np = new URLSearchParams(params);
    np.set("variant", next);
    setParams(np, { replace: true });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "ArrowLeft")  { e.preventDefault(); cycle(-1); }
      if (e.key === "ArrowRight") { e.preventDefault(); cycle(+1); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, variants.join("|")]);

  if (import.meta.env.PROD) return null;

  return (
    <Box
      sx={{
        position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)",
        zIndex: 1300,
        display: "flex", alignItems: "center", gap: 1,
        px: 1, py: 0.5, borderRadius: 999,
        bgcolor: "rgba(15, 23, 42, 0.92)", color: "#fff",
        boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        backdropFilter: "blur(6px)",
        fontFamily: "Inter, system-ui, sans-serif",
        userSelect: "none",
      }}
    >
      <IconButton size="small" onClick={() => cycle(-1)} sx={{ color: "inherit" }} aria-label="prev variant">
        <ChevronLeft fontSize="small" />
      </IconButton>
      <Typography variant="caption" sx={{ minWidth: 130, textAlign: "center", fontWeight: 600 }}>
        {current} · {labels[current] ?? "variant"}
      </Typography>
      <IconButton size="small" onClick={() => cycle(+1)} sx={{ color: "inherit" }} aria-label="next variant">
        <ChevronRight fontSize="small" />
      </IconButton>
    </Box>
  );
}

/** Convenience hook for the route to pick its variant. */
export function useVariant(variants: string[]): string {
  const [params] = useSearchParams();
  const v = params.get("variant");
  return v && variants.includes(v) ? v : variants[0];
}
