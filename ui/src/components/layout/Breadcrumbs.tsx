import { ChevronRight } from "@mui/icons-material";
import { Box, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

/** Location trail in the TopBar. Top-level pages show a single current-page
 *  label; the job detail page shows "History → Job" so the user can climb back
 *  out. Keeps the header from being an empty bar. */

interface Crumb { to?: string; key: string }

function crumbsFor(pathname: string): Crumb[] {
  if (pathname.startsWith("/jobs/")) {
    return [{ to: "/history", key: "history" }, { key: "job_detail" }];
  }
  const map: Record<string, string> = {
    "/": "home", "/file": "file", "/youtube": "youtube",
    "/realtime": "realtime", "/history": "history",
  };
  const key = map[pathname];
  return key ? [{ key }] : [];
}

export function Breadcrumbs() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const crumbs = crumbsFor(pathname);
  if (crumbs.length === 0) return null;

  return (
    <Box component="nav" aria-label="breadcrumb"
        sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        const label = t(c.key === "job_detail" ? "breadcrumb.job_detail" : `nav.${c.key}`);
        return (
          <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
            {i > 0 && <ChevronRight sx={{ fontSize: 15, color: "text.muted", flexShrink: 0 }} />}
            {last || !c.to ? (
              <Typography noWrap sx={{
                fontSize: 14, fontWeight: 500, color: "text.primary", minWidth: 0,
              }}>
                {label}
              </Typography>
            ) : (
              <Box component={Link} to={c.to} sx={{
                fontSize: 14, color: "text.secondary", textDecoration: "none", flexShrink: 0,
                "&:hover": { color: "text.primary" },
              }}>
                {label}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
