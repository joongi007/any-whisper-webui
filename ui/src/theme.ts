import { createTheme } from "@mui/material/styles";
import type { Theme } from "@mui/material/styles";

/** MUI theme is a thin layer — colour truth lives in CSS variables in
 *  `index.css` (per DESIGN.md). MUI handles component shape, MUI doesn't pick
 *  the palette.
 *
 *  Why hex and not oklch() here: MUI's `colorManipulator` (used by ripples,
 *  hover overlays, alpha tints, `lighten/darken`) only parses #rrggbb / rgb()
 *  / hsl() / color(). Feeding it `oklch(...)` throws at theme-build time.
 *  These hexes are precomputed visual matches of the design-token OKLCH values
 *  in `index.css`; the live UI still pulls colour from the CSS vars directly. */
export function buildTheme(mode: "light" | "dark"): Theme {
  const accent   = mode === "light" ? "#6D28D9" : "#A78BFA";
  const accentFg = mode === "light" ? "#FBFAFD" : "#1A1822";
  const surface  = mode === "light" ? "#FFFFFF" : "#1A1A24";
  const canvas   = mode === "light" ? "#FBFAF7" : "#131320";
  const text     = mode === "light" ? "#1F1E29" : "#ECEAEF";
  const textSec  = mode === "light" ? "#5C5A69" : "#B5B2BB";
  const border   = mode === "light" ? "#E6E3DC" : "#2E2C39";

  return createTheme({
    palette: {
      mode,
      primary:   { main: accent, contrastText: accentFg },
      success:   { main: mode === "light" ? "#16A34A" : "#4ADE80" },
      warning:   { main: mode === "light" ? "#D97706" : "#FBBF24" },
      error:     { main: mode === "light" ? "#DC2626" : "#F87171" },
      background:{ default: canvas, paper: surface },
      text:      { primary: text, secondary: textSec },
      divider:   border,
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily: 'Inter, "SF Pro Text", system-ui, sans-serif',
      fontSize: 14,
      htmlFontSize: 14,
      h1: { fontSize: 28, lineHeight: 1.28, fontWeight: 700, letterSpacing: "-0.01em" },
      h2: { fontSize: 22, lineHeight: 1.32, fontWeight: 700, letterSpacing: "-0.005em" },
      h3: { fontSize: 18, lineHeight: 1.38, fontWeight: 700 },
      h4: { fontSize: 16, lineHeight: 1.5,  fontWeight: 700 },
      h5: { fontSize: 14, lineHeight: 1.55, fontWeight: 700 },
      h6: { fontSize: 13, lineHeight: 1.55, fontWeight: 700 },
      body1:   { fontSize: 14, lineHeight: 1.55 },
      body2:   { fontSize: 13, lineHeight: 1.55 },
      caption: { fontSize: 11, lineHeight: 1.45, color: textSec, letterSpacing: 0.1 },
      overline:{ fontSize: 10, lineHeight: 1.4, fontWeight: 500, letterSpacing: 0.8, textTransform: "uppercase" },
      button:  { textTransform: "none", fontWeight: 700, letterSpacing: 0 },
    },
    components: {
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: {
          borderWidth: 1, borderStyle: "solid", borderColor: border, backgroundImage: "none",
        } },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 8, paddingInline: 14, paddingBlock: 8 },
          outlinedPrimary: { borderColor: border },
        },
      },
      MuiIconButton: { styleOverrides: { root: { borderRadius: 8 } } },
      MuiChip: { styleOverrides: { root: { borderRadius: 999, fontWeight: 500 } } },
      MuiTextField: { defaultProps: { variant: "outlined", size: "small" } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: 8 },
          notchedOutline: { borderColor: border },
        },
      },
      MuiTooltip: {
        styleOverrides: { tooltip: {
          background: "#21202A", color: "#FBFAFD",
          fontSize: 11, padding: "6px 10px",
        } },
      },
      MuiSwitch: { styleOverrides: { root: { padding: 7 } } },
      MuiAppBar:  { styleOverrides: { root: { boxShadow: "none" } } },
      MuiToolbar: { styleOverrides: { dense: { minHeight: 48 } } },
    },
  });
}
