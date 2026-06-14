import { Box, useMediaQuery, useTheme } from "@mui/material";

import { PrimaryNav } from "./PrimaryNav";

/** Desktop rail. Collapsed to icons at md, expanded with labels + group
 *  headings at lg. Hidden on small screens (the TopBar hamburger opens the
 *  mobile drawer instead). */
export function Sidebar() {
  const theme = useTheme();
  const expanded = useMediaQuery(theme.breakpoints.up("lg"));
  return (
    <Box
      component="nav" aria-label="primary"
      sx={{
        display: { xs: "none", md: "flex" }, flexDirection: "column",
        width: { md: 64, lg: 232 }, flexShrink: 0,
        bgcolor: "background.paper",
        borderRight: "1px solid var(--border-default)",
      }}
    >
      <PrimaryNav expanded={expanded} />
    </Box>
  );
}
