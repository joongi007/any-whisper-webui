import {
  GraphicEq, History, Home, Mic, Settings, UploadFile, YouTube,
} from "@mui/icons-material";
import {
  Box, Divider, ListItemButton, ListItemIcon, ListItemText, Tooltip, Typography,
} from "@mui/material";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";

import { useSettingsDialog } from "../settings/SettingsDialog";

/** Shared navigation body used by both the desktop Sidebar and the mobile
 *  Drawer. Grouped so the six destinations read as "create" vs "library"
 *  instead of a flat icon strip. `expanded` shows text labels + group
 *  headings; collapsed (md rail) shows icons + tooltips with group dividers. */

interface NavItem { to: string; icon: ReactNode; key: string }

const NAV_GROUPS: { labelKey?: string; items: NavItem[] }[] = [
  { items: [{ to: "/", icon: <Home />, key: "home" }] },
  {
    labelKey: "create",
    items: [
      { to: "/file", icon: <UploadFile />, key: "file" },
      { to: "/youtube", icon: <YouTube />, key: "youtube" },
      { to: "/realtime", icon: <Mic />, key: "realtime" },
    ],
  },
  {
    labelKey: "library",
    items: [{ to: "/history", icon: <History />, key: "history" }],
  },
];

const SETTINGS_ITEM: NavItem = { to: "/settings", icon: <Settings />, key: "settings" };

function NavButton({ item, expanded, onNavigate, onClick }: {
  item: NavItem; expanded: boolean; onNavigate?: () => void; onClick?: () => void;
}) {
  const { t } = useTranslation();
  const label = t(`nav.${item.key}`);
  // Action buttons (e.g. Settings → dialog) render as a plain button with no
  // NavLink/active state; navigation items render as a NavLink.
  const linkProps = onClick
    ? { onClick: () => { onClick(); onNavigate?.(); } }
    : { component: NavLink, to: item.to, end: item.to === "/", onClick: onNavigate };
  return (
    <Tooltip title={label} placement="right" disableHoverListener={expanded}
        disableFocusListener={expanded} disableTouchListener={expanded}>
      <ListItemButton
        {...linkProps} disableRipple
        sx={{
          mx: 1, my: 0.25, borderRadius: 1.5, minHeight: 38,
          paddingInline: 1.25,
          justifyContent: expanded ? "flex-start" : "center",
          color: "text.secondary",
          transition: "background-color 140ms cubic-bezier(0.16, 1, 0.3, 1), color 140ms",
          "&:hover": { bgcolor: "var(--bg-subtle)", color: "text.primary" },
          // Structural-active = neutral tint + 500 weight (accent is reserved
          // for live state / current action, per DESIGN.md).
          "&.active": { bgcolor: "var(--bg-subtle)", color: "text.primary", fontWeight: 500 },
        }}
      >
        <ListItemIcon sx={{
          minWidth: expanded ? 30 : 0, justifyContent: "center",
          color: "inherit", "& svg": { fontSize: 19 },
        }}>
          {item.icon}
        </ListItemIcon>
        {expanded && (
          <ListItemText primary={label} sx={{ m: 0 }}
            primaryTypographyProps={{ fontSize: 13, fontWeight: "inherit" }} />
        )}
      </ListItemButton>
    </Tooltip>
  );
}

export function PrimaryNav({ expanded, onNavigate }: {
  expanded: boolean; onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const openSettings = useSettingsDialog();
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}>
      {/* Brand */}
      <Box sx={{
        height: 48, px: expanded ? 2 : 0, flexShrink: 0,
        display: "flex", alignItems: "center", gap: 1.25,
        justifyContent: expanded ? "flex-start" : "center",
        borderBottom: "1px solid var(--border-default)",
      }}>
        <Box sx={{ width: 22, height: 22, display: "grid", placeItems: "center", color: "text.primary" }}>
          <GraphicEq sx={{ fontSize: 16 }} />
        </Box>
        {expanded && (
          <Box component="span" sx={{ fontWeight: 700, fontSize: 14, letterSpacing: "-0.005em" }}>
            {t("app.name")}
          </Box>
        )}
      </Box>

      {/* Grouped destinations */}
      <Box sx={{ flex: 1, overflowY: "auto", overflowX: "hidden", py: 1 }}>
        {NAV_GROUPS.map((group, gi) => (
          <Box key={gi} sx={{ mb: 0.5 }}>
            {group.labelKey && (expanded ? (
              <Typography variant="overline" sx={{
                display: "block", px: 2.25, pt: 1, pb: 0.25,
                color: "text.muted", fontSize: 10, letterSpacing: 0.8,
              }}>
                {t(`nav_group.${group.labelKey}`)}
              </Typography>
            ) : (
              <Divider sx={{ mx: 1.5, my: 1 }} />
            ))}
            {group.items.map((it) => (
              <NavButton key={it.key} item={it} expanded={expanded} onNavigate={onNavigate} />
            ))}
          </Box>
        ))}
      </Box>

      {/* Settings pinned at the bottom — opens the global dialog, not a route. */}
      <Box sx={{ py: 1, borderTop: "1px solid var(--border-default)", flexShrink: 0 }}>
        <NavButton item={SETTINGS_ITEM} expanded={expanded}
          onNavigate={onNavigate} onClick={openSettings} />
      </Box>
    </Box>
  );
}
