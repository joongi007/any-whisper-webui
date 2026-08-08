import { Box } from "@mui/material";
import { useState, type ReactNode } from "react";

import { ConfirmProvider } from "../feedback/ConfirmDialog";
import { ConnectionBanner } from "../feedback/ConnectionBanner";
import { DeletionSnackbar } from "../feedback/DeletionSnackbar";
import { Toaster } from "../feedback/toast";
import { JobsPanel } from "../job/JobsPanel";
import { JobWatcher } from "../job/JobWatcher";
import { SettingsDialog } from "../settings/SettingsDialog";
import { CommandPalette } from "../shortcuts/CommandPalette";
import { HotkeysDialog } from "../shortcuts/useHotkeysDialog";
import { MobileNav } from "./MobileNav";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  return (
    <ConfirmProvider>
      <Box sx={{
        display: "flex", height: "100%", bgcolor: "background.default",
      }}>
        <Sidebar />
        <MobileNav open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
        <Box sx={{ display: "flex", flex: 1, flexDirection: "column", minWidth: 0 }}>
          <TopBar onMenuClick={() => setMobileNavOpen(true)} />
          <ConnectionBanner />
          {/* The scroller is the full-width container, so the scrollbar sits at
              the window's right edge instead of floating at the edge of the
              centred 1400 box (which looks detached on tabs whose content is
              narrower than 1400). `scrollbar-gutter: stable` reserves its width
              so shorter tabs don't shift the content sideways. Width-capping and
              centring live on the inner wrapper, not the scroller. */}
          <Box component="main" sx={{
            flex: 1, overflow: "auto", scrollbarGutter: "stable",
          }}>
            <Box sx={{
              maxWidth: 1400, mx: "auto", width: "100%",
              p: { xs: 2.5, md: 3, lg: 4 },
            }}>
              {children}
            </Box>
          </Box>
        </Box>
        <JobsPanel />
        <HotkeysDialog />
        <CommandPalette />
        <DeletionSnackbar />
        <Toaster />
        <JobWatcher />
        <SettingsDialog />
      </Box>
    </ConfirmProvider>
  );
}
