import { Button, Snackbar } from "@mui/material";
import { useTranslation } from "react-i18next";

import { UNDO_WINDOW_MS, usePendingDeleteStore } from "../../stores/pendingDeleteStore";

/** Single app-wide undo Snackbar for scheduled deletions. Mounted once in
 *  AppShell so it survives route changes — that's what lets JobDetailPage
 *  delete-and-navigate while the undo affordance keeps showing on History. */
export function DeletionSnackbar() {
  const { t } = useTranslation();
  const active = usePendingDeleteStore((s) => s.active);
  const undo = usePendingDeleteStore((s) => s.undo);

  return (
    <Snackbar
      open={active != null}
      autoHideDuration={UNDO_WINDOW_MS}
      // The store's timer owns the actual commit + auto-clear; let the
      // Snackbar's own close be a no-op so the two don't race.
      onClose={() => { /* store timer owns the lifecycle */ }}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      message={active ? t("history.bulk_delete_pending", { count: active.count }) : ""}
      action={
        <Button size="small" onClick={undo}
            sx={{ color: "var(--accent)", fontWeight: 700 }}>
          {t("history.undo")}
        </Button>
      }
    />
  );
}
