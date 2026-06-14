import { CheckCircle, Close, ErrorOutline, InfoOutlined, WarningAmber } from "@mui/icons-material";
import { Box, IconButton, Typography } from "@mui/material";
import { useEffect, useMemo, type ReactNode } from "react";
import { create } from "zustand";

/** Lightweight global toast system. Distinct from the delete-undo snackbar
 *  (bottom-center, one-at-a-time, action-bearing): toasts stack bottom-right,
 *  auto-dismiss, and report the outcome of an action ("job started", "export
 *  failed"). No external dep — a small zustand store + a fixed stack. */

type Severity = "success" | "error" | "info" | "warning";
interface Toast { id: number; message: string; severity: Severity }

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
}

let _id = 0;
const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  // Cap at 4 visible so a burst of events can't bury the screen.
  push: (t) => set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id: ++_id }] })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

/** `const toast = useToast(); toast.success("...")`. Stable across renders. */
export function useToast() {
  const push = useToastStore((s) => s.push);
  return useMemo(() => ({
    success: (message: string) => push({ message, severity: "success" }),
    error: (message: string) => push({ message, severity: "error" }),
    info: (message: string) => push({ message, severity: "info" }),
    warning: (message: string) => push({ message, severity: "warning" }),
  }), [push]);
}

const TONE: Record<Severity, { fg: string; icon: ReactNode }> = {
  success: { fg: "var(--success)", icon: <CheckCircle /> },
  error: { fg: "var(--danger)", icon: <ErrorOutline /> },
  info: { fg: "var(--accent)", icon: <InfoOutlined /> },
  warning: { fg: "var(--warning)", icon: <WarningAmber /> },
};

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  useEffect(() => {
    const ms = toast.severity === "error" ? 6000 : 4000;
    const id = window.setTimeout(onClose, ms);
    return () => window.clearTimeout(id);
  }, [onClose, toast.severity]);

  const tone = TONE[toast.severity];
  return (
    <Box sx={{
      display: "flex", alignItems: "flex-start", gap: 1.25,
      minWidth: 280, maxWidth: 380, p: 1.5, borderRadius: 1.5,
      bgcolor: "var(--bg-surface)", border: "1px solid var(--border-default)",
      boxShadow: "var(--shadow-2)",
      "@keyframes toastIn": {
        from: { opacity: 0, transform: "translateY(8px)" },
        to: { opacity: 1, transform: "none" },
      },
      animation: "toastIn 200ms cubic-bezier(0.16, 1, 0.3, 1)",
    }}>
      <Box sx={{ color: tone.fg, display: "flex", flexShrink: 0, "& svg": { fontSize: 18 } }}>
        {tone.icon}
      </Box>
      <Typography sx={{ flex: 1, fontSize: 13, color: "text.primary", lineHeight: 1.5 }}>
        {toast.message}
      </Typography>
      <IconButton size="small" onClick={onClose} aria-label="dismiss"
          sx={{ m: -0.5, color: "text.muted", flexShrink: 0 }}>
        <Close sx={{ fontSize: 16 }} />
      </IconButton>
    </Box>
  );
}

/** Mounted once at the AppShell root. */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <Box sx={{
      position: "fixed", bottom: 16, right: 16, zIndex: 1600,
      display: "flex", flexDirection: "column", gap: 1, pointerEvents: "none",
    }}>
      {toasts.map((tst) => (
        <Box key={tst.id} sx={{ pointerEvents: "auto" }}>
          <ToastItem toast={tst} onClose={() => dismiss(tst.id)} />
        </Box>
      ))}
    </Box>
  );
}
