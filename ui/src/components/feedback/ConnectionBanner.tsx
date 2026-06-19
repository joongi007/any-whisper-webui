import { CloudOff } from "@mui/icons-material";
import { Box, Button, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchSystemInfo } from "../../api/system";

/** Full-width strip shown when the browser is offline or the backend is
 *  unreachable. Modern apps never fail silently — if the api is down, every
 *  action would error with no explanation, so we say so once, up top. Reuses
 *  the shared ["system-info"] query as a liveness probe. */
export function ConnectionBanner() {
  const { t } = useTranslation();
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const sys = useQuery({
    queryKey: ["system-info"], queryFn: fetchSystemInfo,
    refetchInterval: 15_000, retry: 1,
  });
  const backendDown = sys.isError;
  const show = !online || backendDown;
  if (!show) return null;

  const offline = !online;
  return (
    <Box role="status" sx={{
      display: "flex", alignItems: "center", gap: 1,
      px: { xs: 2, md: 3 }, py: 1,
      bgcolor: "var(--bg-sunken)", borderBottom: "1px solid var(--border-default)",
      color: "var(--danger)",
    }}>
      <CloudOff sx={{ fontSize: 16, flexShrink: 0 }} />
      <Typography sx={{ flex: 1, fontSize: 13, color: "text.primary" }}>
        {offline ? t("conn.offline") : t("conn.backend_down")}
      </Typography>
      {!offline && (
        <Button size="small" onClick={() => void sys.refetch()}
            sx={{ fontSize: 12, color: "var(--accent)", fontWeight: 700, minWidth: 0 }}>
          {t("common.retry")}
        </Button>
      )}
    </Box>
  );
}
