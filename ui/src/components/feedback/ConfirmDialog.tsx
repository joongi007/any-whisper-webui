import {
  Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
} from "@mui/material";
import {
  createContext, useCallback, useContext, useRef, useState, type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

/** Imperative confirm dialog — `const confirm = useConfirm()` then
 *  `if (!(await confirm({...}))) return;`. Replaces `window.confirm`, which
 *  renders an OS-native box that ignores the app's theme and copy.
 *
 *  One dialog instance lives at the provider; calls queue is unnecessary
 *  because a confirm is always a direct response to a user click (no two can
 *  be in flight). A second call while one is open resolves the first as
 *  cancelled, which matches "the user did something else". */

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` paints the confirm button red — for destructive, non-undoable
   *  actions (cancel a running job). */
  tone?: "default" | "danger";
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((next) => {
    // If a prior dialog is somehow still open, resolve it as cancelled.
    resolveRef.current?.(false);
    setOpts(next);
    return new Promise<boolean>((resolve) => { resolveRef.current = resolve; });
  }, []);

  function close(result: boolean) {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setOpts(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={opts != null}
        onClose={() => close(false)}
        PaperProps={{ sx: { borderRadius: 2, border: "1px solid var(--border-default)", maxWidth: 380 } }}
      >
        {opts && (
          <>
            <DialogTitle sx={{ fontSize: 16, fontWeight: 700, pb: 1 }}>
              {opts.title}
            </DialogTitle>
            {opts.body && (
              <DialogContent sx={{ pb: 1 }}>
                <DialogContentText sx={{ fontSize: 14, color: "text.secondary" }}>
                  {opts.body}
                </DialogContentText>
              </DialogContent>
            )}
            <DialogActions sx={{ px: 3, pb: 2, pt: 1 }}>
              <Button size="small" onClick={() => close(false)}
                  sx={{ color: "text.secondary" }}>
                {opts.cancelLabel ?? t("common.cancel")}
              </Button>
              <Button
                size="small" variant="contained"
                color={opts.tone === "danger" ? "error" : "primary"}
                onClick={() => close(true)}
                sx={{ boxShadow: "none", "&:hover": { boxShadow: "none" } }}
                autoFocus
              >
                {opts.confirmLabel ?? t("common.confirm")}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx;
}
