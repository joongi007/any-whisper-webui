import { Dialog, DialogContent, DialogTitle, IconButton, Stack, Typography } from "@mui/material";
import { Close } from "@mui/icons-material";
import { create } from "zustand";
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

interface HotkeysState { open: boolean; show: () => void; hide: () => void; toggle: () => void }
const useHotkeysStore = create<HotkeysState>((set, get) => ({
  open: false,
  show:   () => set({ open: true }),
  hide:   () => set({ open: false }),
  toggle: () => set({ open: !get().open }),
}));

/** Returns a function that opens the global hotkeys dialog. The dialog itself
 *  is mounted once at the AppShell root via <HotkeysDialog />. */
export function useHotkeysDialog() {
  return useHotkeysStore.getState().show;
}

// keys are universal; the description is translated at render via `k`.
const SHORTCUTS: { keys: string[]; k: string }[] = [
  { keys: ["⌘", "K"],  k: "palette" },
  { keys: ["?"],       k: "help" },
  { keys: ["/"],       k: "search" },
  { keys: ["Space"],   k: "play" },
  { keys: ["j", "↓"],  k: "next" },
  { keys: ["k", "↑"],  k: "prev" },
  { keys: ["Enter"],   k: "save" },
  { keys: ["Esc"],     k: "cancel" },
  { keys: ["←", "→"],  k: "variants" },
];

export function HotkeysDialog() {
  const { t } = useTranslation();
  const { open, hide, toggle } = useHotkeysStore();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const isTyping = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (isTyping) return;
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        toggle();
      } else if (e.key === "Escape" && open) {
        hide();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, toggle, hide]);

  return (
    <Dialog
      open={open} onClose={hide} maxWidth="xs" fullWidth
      PaperProps={{ sx: { borderRadius: 2, border: "1px solid var(--border-default)" } }}
    >
      <DialogTitle sx={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        fontSize: 14, fontWeight: 700, py: 1.5, borderBottom: "1px solid var(--border-default)",
      }}>
        {t("hotkeys.title")}
        <IconButton size="small" onClick={hide} aria-label="close">
          <Close fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        <Stack spacing={0.5} sx={{ px: 2, pt: 2, pb: 2 }}>
          {SHORTCUTS.map((sc) => (
            <Stack key={sc.k} direction="row" alignItems="center" justifyContent="space-between"
                sx={{ py: 0.75 }}>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>{t(`hotkeys.sc_${sc.k}`)}</Typography>
              <Stack direction="row" spacing={0.5}>
                {sc.keys.map((k) => <Key key={k}>{k}</Key>)}
              </Stack>
            </Stack>
          ))}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

function Key({ children }: { children: ReactNode }) {
  return (
    <Typography component="kbd" className="font-mono" sx={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      minWidth: 22, height: 22, px: 0.75, borderRadius: 0.75,
      bgcolor: "var(--bg-subtle)", border: "1px solid var(--border-default)",
      fontSize: 11, fontWeight: 500, color: "text.primary",
    }}>
      {children}
    </Typography>
  );
}
