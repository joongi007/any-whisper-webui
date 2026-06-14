import {
  DarkMode, KeyboardCommandKey, LightMode, SettingsBrightness, Tune,
} from "@mui/icons-material";
import { Box, IconButton, Popover, Stack, Tooltip, Typography } from "@mui/material";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useSettingsStore } from "../../stores/settingsStore";
import { useThemeStore, type ThemeMode } from "../../stores/themeStore";
import { useHotkeysDialog } from "../shortcuts/useHotkeysDialog";

/** A single preferences popover replaces the old row of toolbar icons (theme,
 *  language, mode, hotkeys). Each preference is an inline segmented control —
 *  current value visible at a glance, one click to change, no dropdown chains. */

interface SegOption<T> { value: T; label?: string; icon?: ReactNode; title?: string }

function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: SegOption<T>[]; onChange: (v: T) => void;
}) {
  return (
    <Box sx={{
      display: "inline-flex", p: "2px", gap: "2px",
      borderRadius: 1, bgcolor: "var(--bg-sunken)",
      border: "1px solid var(--border-default)",
    }}>
      {options.map((o) => {
        const active = o.value === value;
        const btn = (
          <Box
            component="button" type="button" onClick={() => onChange(o.value)}
            aria-pressed={active}
            sx={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 0.5,
              minWidth: 30, height: 24, px: 1, borderRadius: 0.75,
              border: "none", cursor: "pointer", fontSize: 11, fontWeight: 500,
              bgcolor: active ? "var(--bg-surface)" : "transparent",
              color: active ? "text.primary" : "text.muted",
              boxShadow: active ? "var(--shadow-1)" : "none",
              transition: "background-color 140ms, color 140ms",
              "&:hover": { color: "text.primary" },
              "& svg": { fontSize: 15 },
            }}
          >
            {o.icon}{o.label}
          </Box>
        );
        return o.title
          ? <Tooltip key={o.value} title={o.title}>{btn}</Tooltip>
          : <Box key={o.value}>{btn}</Box>;
      })}
    </Box>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ gap: 2 }}>
      <Typography sx={{ fontSize: 13, color: "text.secondary" }}>{label}</Typography>
      {children}
    </Stack>
  );
}

export function PreferencesMenu() {
  const { t, i18n } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const uiMode = useSettingsStore((s) => s.uiMode);
  const setSettings = useSettingsStore((s) => s.setPartial);
  const themeMode = useThemeStore((s) => s.mode);
  const setThemeMode = useThemeStore((s) => s.setMode);
  const openHotkeys = useHotkeysDialog();

  const lang = (i18n.resolvedLanguage ?? i18n.language ?? "en").startsWith("ko") ? "ko" : "en";

  return (
    <>
      <Tooltip title={t("prefs.title")}>
        <IconButton size="small" onClick={(e) => setAnchorEl(e.currentTarget)}
            aria-label={t("prefs.title")} sx={{ color: "text.muted" }}>
          <Tune fontSize="small" />
        </IconButton>
      </Tooltip>

      <Popover
        open={open} anchorEl={anchorEl} onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: {
          mt: 0.5, p: 2, width: 300, borderRadius: 2,
          border: "1px solid var(--border-default)",
        } } }}
      >
        <Typography variant="overline" sx={{
          display: "block", color: "text.muted", fontSize: 10, letterSpacing: 0.8, mb: 1.5,
        }}>
          {t("prefs.title")}
        </Typography>

        <Stack spacing={1.75}>
          <Row label={t("prefs.ui_mode")}>
            <Segmented<"simple" | "advanced">
              value={uiMode}
              onChange={(v) => setSettings({ uiMode: v })}
              options={[
                { value: "simple", label: t("mode.simple") },
                { value: "advanced", label: t("mode.advanced") },
              ]}
            />
          </Row>

          <Row label={t("prefs.theme")}>
            <Segmented<ThemeMode>
              value={themeMode}
              onChange={setThemeMode}
              options={[
                { value: "system", icon: <SettingsBrightness />, title: "System" },
                { value: "light", icon: <LightMode />, title: "Light" },
                { value: "dark", icon: <DarkMode />, title: "Dark" },
              ]}
            />
          </Row>

          <Row label={t("prefs.language")}>
            <Segmented<"en" | "ko">
              value={lang}
              onChange={(v) => void i18n.changeLanguage(v)}
              options={[
                { value: "en", label: "EN" },
                { value: "ko", label: "한국어" },
              ]}
            />
          </Row>
        </Stack>

        <Box sx={{ mt: 1.5, pt: 1.5, borderTop: "1px solid var(--border-default)" }}>
          <Box
            component="button" type="button"
            onClick={() => { setAnchorEl(null); openHotkeys(); }}
            sx={{
              display: "flex", alignItems: "center", gap: 1, width: "100%",
              px: 1, height: 34, borderRadius: 1, border: "none", cursor: "pointer",
              bgcolor: "transparent", color: "text.secondary", textAlign: "left",
              "&:hover": { bgcolor: "var(--bg-subtle)", color: "text.primary" },
            }}
          >
            <KeyboardCommandKey sx={{ fontSize: 16 }} />
            <Box component="span" sx={{ flex: 1, fontSize: 13 }}>{t("hotkeys.title")}</Box>
            <Box component="kbd" sx={{
              px: 0.5, height: 18, display: "inline-flex", alignItems: "center", borderRadius: 0.5,
              border: "1px solid var(--border-default)", bgcolor: "var(--bg-subtle)",
              fontFamily: "JetBrains Mono, ui-monospace, monospace", fontSize: 10,
            }}>?</Box>
          </Box>
        </Box>
      </Popover>
    </>
  );
}
