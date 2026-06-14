import { Close } from "@mui/icons-material";
import { Dialog, DialogContent, DialogTitle, IconButton } from "@mui/material";
import { create } from "zustand";
import { useTranslation } from "react-i18next";

import { SettingsPage } from "../../routes/SettingsPage";

/** Settings as a global dialog instead of a standalone route. Keeps the user in
 *  their working context (the page behind it doesn't unmount) — the Linear /
 *  Slack / Discord pattern. Opened from the sidebar, the command palette, or a
 *  direct /settings link. */

interface SettingsDialogState { open: boolean; show: () => void; hide: () => void }
const useStore = create<SettingsDialogState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

/** Returns a function that opens the settings dialog. */
export function useSettingsDialog() {
  return useStore.getState().show;
}

export function SettingsDialog() {
  const { t } = useTranslation();
  const open = useStore((s) => s.open);
  const hide = useStore((s) => s.hide);

  return (
    <Dialog
      open={open} onClose={hide} maxWidth="md" fullWidth scroll="paper"
      slotProps={{ paper: { sx: {
        borderRadius: 2, border: "1px solid var(--border-default)",
        backgroundImage: "none", maxHeight: "85vh",
      } } }}
    >
      <DialogTitle sx={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        fontSize: 16, fontWeight: 700, py: 1.5,
        borderBottom: "1px solid var(--border-default)",
      }}>
        {t("nav.settings")}
        <IconButton size="small" onClick={hide} aria-label={t("common.close")}>
          <Close fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ p: 3 }}>
        <SettingsPage />
      </DialogContent>
    </Dialog>
  );
}
