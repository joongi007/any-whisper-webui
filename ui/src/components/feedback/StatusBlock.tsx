import { Box } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";

/** Tone aligns with the project's color tokens (var(--accent), var(--success),
 *  var(--warning), var(--danger)) plus a neutral fallback that uses
 *  --bg-subtle. Keep this list in sync with the tokens defined in index.css. */
export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

interface Props {
  tone: Tone;
  /** Leading icon (or any element). The wrapper sets `color: inherit` so MUI
   *  icons and CircularProgress inherit the tone automatically. */
  icon?: ReactNode;
  /** Trailing element (typically a small Button or Link). */
  action?: ReactNode;
  /** Body. Pass plain text for the common case, or a Stack for multi-line. */
  children: ReactNode;
  /** Override the default 1.5 padding. Use 2 for content-heavy surfaces
   *  (instructional cards) where the inner Stack needs more breathing room. */
  padding?: number;
  sx?: SxProps<Theme>;
}

/** Single source of truth for status banners across the app.
 *
 *  Why this exists: before extracting, RealtimePage had five
 *  visually-different status banners (mixed padding, inconsistent borders,
 *  two LIVE indicators in opposite colours) while JobDetailPage and the
 *  HF card had their own near-duplicates. The contract is now:
 *  `p: 1.5`, `borderRadius: 1.5`, tinted background, no border, icon-inherits.
 *  Add a tone, don't add a Box. */
export function StatusBlock({
  tone, icon, action, children, padding = 1.5, sx,
}: Props) {
  return (
    <Box sx={{
      display: "flex", alignItems: "center", gap: 1.5,
      p: padding, borderRadius: 1.5,
      bgcolor: bgFor(tone),
      color: colorFor(tone),
      ...(sx ?? {}),
    }}>
      {icon && (
        <Box sx={{ display: "inline-flex", color: "inherit", flexShrink: 0 }}>
          {icon}
        </Box>
      )}
      <Box sx={{ flex: 1, minWidth: 0, color: "inherit" }}>
        {children}
      </Box>
      {action && (
        <Box sx={{ flexShrink: 0 }}>{action}</Box>
      )}
    </Box>
  );
}

function bgFor(tone: Tone): string {
  switch (tone) {
    case "neutral": return "var(--bg-subtle)";
    case "accent":  return "var(--accent-soft)";
    case "success": return "var(--success-soft)";
    case "warning": return "var(--warning-soft)";
    case "danger":  return "var(--danger-soft)";
  }
}

function colorFor(tone: Tone): string {
  switch (tone) {
    case "neutral": return "var(--text-secondary)";
    case "accent":  return "var(--accent)";
    case "success": return "var(--success)";
    case "warning": return "var(--warning)";
    case "danger":  return "var(--danger)";
  }
}
