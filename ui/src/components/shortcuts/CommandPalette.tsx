import {
  ArrowForward, DarkMode, GraphicEq, History, Home, LightMode, Mic, Search,
  Settings, SettingsBrightness, Tune, UploadFile, YouTube,
} from "@mui/icons-material";
import {
  Box, Dialog, InputAdornment, Stack, TextField, Typography,
} from "@mui/material";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { create } from "zustand";

import { useSettingsStore } from "../../stores/settingsStore";
import { useThemeStore } from "../../stores/themeStore";
import { useSettingsDialog } from "../settings/SettingsDialog";

/** Global open-state store so a toolbar button (or any component) can launch
 *  the palette, not just the Cmd+K listener. */
interface PaletteState { open: boolean; setOpen: (v: boolean) => void; toggle: () => void }
const usePaletteStore = create<PaletteState>((set, get) => ({
  open: false,
  setOpen: (v) => set({ open: v }),
  toggle: () => set({ open: !get().open }),
}));

/** Returns a function that opens the command palette (for toolbar/menu buttons). */
export function useCommandPalette() {
  return () => usePaletteStore.getState().setOpen(true);
}

/** ⌘K / Ctrl+K palette. Page navigation + ui-mode + theme toggle. No external
 *  cmdk dep — the surface is small enough that a hand-rolled list with arrow
 *  navigation reads cleanly. */

interface Command {
  id: string;
  label: string;
  group: string;
  icon: ReactNode;
  hint?: string;
  run: () => void;
}

export function CommandPalette() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const setUi = useSettingsStore((s) => s.setPartial);
  const setTheme = useThemeStore((s) => s.setMode);
  const openSettings = useSettingsDialog();

  const open = usePaletteStore((s) => s.open);
  const setOpen = usePaletteStore((s) => s.setOpen);
  const toggle = usePaletteStore((s) => s.toggle);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global ⌘K / Ctrl+K. Don't intercept when typing in an input — the user
  // is mid-text, hijacking ⌘K would feel hostile.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  // Reset query + cursor on open so the next session starts fresh.
  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      // Autofocus the input — MUI Dialog's autoFocus on TextField is flaky
      // in StrictMode, so do it explicitly after the open animation lands.
      const id = window.setTimeout(() => inputRef.current?.focus(), 20);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => [
    { id: "nav:home",     group: t("nav.home"),     label: t("nav.home"),     icon: <Home fontSize="small" />,       run: () => nav("/") },
    { id: "nav:file",     group: t("nav.file"),     label: t("nav.file"),     icon: <UploadFile fontSize="small" />, run: () => nav("/file") },
    { id: "nav:youtube",  group: t("nav.youtube"),  label: t("nav.youtube"),  icon: <YouTube fontSize="small" />,    run: () => nav("/youtube") },
    { id: "nav:realtime", group: t("nav.realtime"), label: t("nav.realtime"), icon: <Mic fontSize="small" />,        run: () => nav("/realtime") },
    { id: "nav:history",  group: t("nav.history"),  label: t("nav.history"),  icon: <History fontSize="small" />,    run: () => nav("/history") },
    { id: "nav:settings", group: t("nav.settings"), label: t("nav.settings"), icon: <Settings fontSize="small" />,   run: () => openSettings() },
    { id: "mode:simple",   group: t("palette.group_mode"),  label: t("palette.mode_simple"),   icon: <Tune fontSize="small" />,               hint: "settings.uiMode = simple",   run: () => setUi({ uiMode: "simple" }) },
    { id: "mode:advanced", group: t("palette.group_mode"),  label: t("palette.mode_advanced"), icon: <Tune fontSize="small" />,               hint: "settings.uiMode = advanced", run: () => setUi({ uiMode: "advanced" }) },
    { id: "theme:system", group: t("palette.group_theme"), label: t("palette.theme_system"),  icon: <SettingsBrightness fontSize="small" />, run: () => setTheme("system") },
    { id: "theme:light",  group: t("palette.group_theme"), label: t("palette.theme_light"),   icon: <LightMode fontSize="small" />,          run: () => setTheme("light") },
    { id: "theme:dark",   group: t("palette.group_theme"), label: t("palette.theme_dark"),    icon: <DarkMode fontSize="small" />,           run: () => setTheme("dark") },
  ], [t, nav, setUi, setTheme, openSettings]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) =>
      c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q),
    );
  }, [commands, query]);

  // Clamp cursor when matches shrink under it.
  useEffect(() => {
    if (cursor >= matches.length) setCursor(Math.max(0, matches.length - 1));
  }, [matches.length, cursor]);

  function execute(c: Command) {
    c.run();
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(matches.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = matches[cursor];
      if (c) execute(c);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  // Keep the focused row in view when arrow-keying past the viewport.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  // Decorate matches with a group separator row when the group changes.
  const rows = useMemo(() => {
    const out: ({ kind: "header"; label: string } | { kind: "cmd"; cmd: Command; idx: number })[] = [];
    let lastGroup: string | null = null;
    matches.forEach((c, i) => {
      const groupKey = inferSection(c);
      if (groupKey !== lastGroup) {
        out.push({ kind: "header", label: groupKey });
        lastGroup = groupKey;
      }
      out.push({ kind: "cmd", cmd: c, idx: i });
    });
    return out;
  }, [matches]);

  return (
    <Dialog
      open={open} onClose={() => setOpen(false)}
      maxWidth="sm" fullWidth
      slotProps={{
        paper: {
          sx: {
            mt: { xs: 4, sm: 10 }, alignSelf: "flex-start",
            borderRadius: 2, border: "1px solid var(--border-default)",
            overflow: "hidden",
          },
        },
      }}
    >
      <Box onKeyDown={onKeyDown}>
        <TextField
          inputRef={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
          fullWidth variant="standard"
          placeholder={t("palette.placeholder")}
          InputProps={{
            disableUnderline: true,
            startAdornment: (
              <InputAdornment position="start" sx={{ pl: 2 }}>
                <Search fontSize="small" sx={{ color: "text.muted" }} />
              </InputAdornment>
            ),
            sx: {
              fontSize: 15, py: 1.5, pr: 2,
              borderBottom: "1px solid var(--border-default)",
            },
          }}
        />

        <Box ref={listRef} sx={{ maxHeight: 360, overflow: "auto", py: 0.5 }}>
          {matches.length === 0 && (
            <Box sx={{ px: 2, py: 3, color: "text.muted" }}>
              <Typography variant="body2">No matches.</Typography>
            </Box>
          )}
          {rows.map((row, ri) => {
            if (row.kind === "header") {
              return (
                <Typography key={`h-${ri}`} variant="overline" sx={{
                  display: "block", px: 2, pt: ri === 0 ? 0.5 : 1.25, pb: 0.5,
                  color: "text.muted", letterSpacing: 0.8, fontSize: 10,
                }}>
                  {row.label}
                </Typography>
              );
            }
            const active = row.idx === cursor;
            return (
              <Stack key={row.cmd.id} data-idx={row.idx}
                direction="row" alignItems="center" spacing={1.5}
                onClick={() => execute(row.cmd)}
                onMouseEnter={() => setCursor(row.idx)}
                sx={{
                  px: 2, py: 1, cursor: "pointer",
                  bgcolor: active ? "var(--bg-subtle)" : "transparent",
                  "& .cmd-arrow": { opacity: active ? 0.6 : 0 },
                }}>
                <Box sx={{ color: "text.secondary", display: "grid", placeItems: "center", width: 18 }}>
                  {row.cmd.icon}
                </Box>
                <Typography variant="body2" sx={{ flex: 1, color: "text.primary" }}>
                  {row.cmd.label}
                </Typography>
                {row.cmd.hint && (
                  <Typography variant="caption" className="font-mono" sx={{ color: "text.muted" }}>
                    {row.cmd.hint}
                  </Typography>
                )}
                <ArrowForward className="cmd-arrow" sx={{ fontSize: 14, color: "text.muted" }} />
              </Stack>
            );
          })}
        </Box>

        <Stack direction="row" spacing={2} sx={{
          px: 2, py: 1, borderTop: "1px solid var(--border-default)",
          bgcolor: "var(--bg-subtle)", color: "text.muted",
        }}>
          <Hint k="↑↓">navigate</Hint>
          <Hint k="↵">open</Hint>
          <Hint k="esc">close</Hint>
          <Box sx={{ flex: 1 }} />
          <Stack direction="row" alignItems="center" spacing={0.75}>
            <GraphicEq sx={{ fontSize: 12, color: "text.muted" }} />
            <Typography variant="caption" sx={{ color: "text.muted" }}>
              ⌘K
            </Typography>
          </Stack>
        </Stack>
      </Box>
    </Dialog>
  );
}

function Hint({ k, children }: { k: string; children: ReactNode }) {
  return (
    <Stack direction="row" alignItems="center" spacing={0.5}>
      <Box component="kbd" sx={{
        px: 0.75, py: 0.125, borderRadius: 0.75,
        border: "1px solid var(--border-default)", bgcolor: "var(--bg-surface)",
        fontFamily: "JetBrains Mono, ui-monospace, monospace", fontSize: 10,
        color: "text.secondary", minWidth: 18, textAlign: "center",
      }}>
        {k}
      </Box>
      <Typography variant="caption" sx={{ color: "inherit", fontSize: 10 }}>{children}</Typography>
    </Stack>
  );
}

/** Top-level grouping for the visual header rows. Anchored by command id
 *  prefix so it's stable across i18n. */
function inferSection(c: Command): string {
  if (c.id.startsWith("nav:"))   return "Pages";
  if (c.id.startsWith("mode:"))  return "Mode";
  if (c.id.startsWith("theme:")) return "Theme";
  return "Other";
}
