import { InfoOutlined, RecordVoiceOver } from "@mui/icons-material";
import { Box, Stack, Switch, Tooltip, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { fetchSystemInfo } from "../../api/system";
import { useSettingsStore } from "../../stores/settingsStore";

/** Slim diarize toggle for Simple mode — the one pipeline switch that
 *  matters for multi-speaker recordings (podcasts, panels, interviews).
 *  Sits inline with the page flow, no card chrome — Simple stays simple. */
export function DiarizeQuickToggle() {
  const { t } = useTranslation();
  const s = useSettingsStore();
  const sys = useQuery({ queryKey: ["system-info"], queryFn: fetchSystemInfo, staleTime: 30_000 });
  const available = sys.data?.diarize_available ?? true;

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ py: 0.5 }}>
        <RecordVoiceOver fontSize="small" sx={{ color: available ? "text.muted" : "text.disabled" }} />
        <Typography variant="body2" sx={{ color: available ? "text.primary" : "text.disabled" }}>
          {t("pipeline.diarize")}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {t("youtube.diarize_toggle_hint")}
        </Typography>
        {!available && (
          <Tooltip title={t("pipeline.diarize_unavailable")}>
            <InfoOutlined fontSize="inherit" sx={{ fontSize: 14, color: "text.secondary" }} />
          </Tooltip>
        )}
        <Box sx={{ flex: 1 }} />
        <Switch size="small" checked={s.diarizeEnabled} disabled={!available}
            onChange={(e) => s.setPartial({ diarizeEnabled: e.target.checked })} />
      </Stack>
      {/* Cost hint only when actually on — the user has just chosen to pay
          this cost, so explain what they're committing to. Off + idle should
          not nag. */}
      {available && s.diarizeEnabled && (
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block", pl: 4 }}>
          {t("pipeline.diarize_cost_hint")}
        </Typography>
      )}
    </Box>
  );
}
