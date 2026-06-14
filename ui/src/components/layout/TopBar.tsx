import { Menu as MenuIcon, Search } from "@mui/icons-material";
import { AppBar, Box, IconButton, Stack, Toolbar, Tooltip } from "@mui/material";
import { useTranslation } from "react-i18next";

import { useCommandPalette } from "../shortcuts/CommandPalette";
import { Breadcrumbs } from "./Breadcrumbs";
import { PreferencesMenu } from "./PreferencesMenu";

export function TopBar({ onMenuClick }: { onMenuClick: () => void }) {
  const { t } = useTranslation();
  const openPalette = useCommandPalette();

  return (
    <AppBar
      position="sticky" color="transparent" elevation={0}
      sx={{ borderBottom: "1px solid var(--border-default)", bgcolor: "background.paper" }}
    >
      <Toolbar variant="dense" sx={{ gap: 0.5, minHeight: 48, px: { xs: 1, sm: 2 } }}>
        {/* Mobile menu — the rail is hidden below md. */}
        <IconButton size="small" edge="start" onClick={onMenuClick} aria-label={t("nav.menu")}
            sx={{ display: { xs: "inline-flex", md: "none" }, color: "text.secondary", mr: 0.5 }}>
          <MenuIcon fontSize="small" />
        </IconButton>

        <Breadcrumbs />

        <Stack sx={{ flex: 1 }} />

        {/* Command launcher — styled like a search field; opens the palette.
            Works on touch (no keyboard ⌘K) and signals "this app has search". */}
        <Tooltip title={t("nav.command")}>
          <Box
            component="button" type="button" onClick={openPalette} aria-label={t("nav.command")}
            sx={{
              display: "inline-flex", alignItems: "center", gap: 0.75,
              height: 30, px: { xs: 0.75, sm: 1.25 }, mr: 0.5,
              borderRadius: 1, cursor: "pointer",
              border: "1px solid var(--border-default)", bgcolor: "transparent",
              color: "text.muted",
              transition: "border-color 140ms, color 140ms, background-color 140ms",
              "&:hover": { borderColor: "var(--border-strong)", color: "text.secondary", bgcolor: "var(--bg-subtle)" },
            }}
          >
            <Search sx={{ fontSize: 15 }} />
            <Box component="span" sx={{ display: { xs: "none", sm: "inline" }, fontSize: 12 }}>
              {t("nav.command")}
            </Box>
            <Box component="kbd" sx={{
              display: { xs: "none", sm: "inline-flex" }, alignItems: "center",
              ml: 1.5, px: 0.5, height: 18, borderRadius: 0.5,
              border: "1px solid var(--border-default)", bgcolor: "var(--bg-subtle)",
              fontFamily: "JetBrains Mono, ui-monospace, monospace", fontSize: 10,
            }}>
              ⌘K
            </Box>
          </Box>
        </Tooltip>

        <PreferencesMenu />
      </Toolbar>
    </AppBar>
  );
}
