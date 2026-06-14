import { DeleteSweep } from "@mui/icons-material";
import { Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { clearCache, fetchCacheInfo } from "../../api/system";

function fmtBytes(n: number): string {
  if (n <= 0) return "0 MB";
  const mb = n / 1024 / 1024;
  return mb < 1024 ? `${mb.toFixed(0)} MB` : `${(mb / 1024).toFixed(2)} GB`;
}

/** YouTube download cache: shows current size + the auto-evict ceiling, with a
 *  one-click wipe. Auto-eviction (LRU) happens on the ai side after each
 *  download; this card is the manual half. */
export function CacheCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const cache = useQuery({ queryKey: ["cache-info"], queryFn: fetchCacheInfo, staleTime: 10_000 });
  const clear = useMutation({
    mutationFn: clearCache,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cache-info"] }),
  });

  const info = cache.data;
  const empty = !info || info.file_count === 0;

  return (
    <Stack spacing={1.25}>
      <Typography variant="overline" sx={{ color: "text.secondary" }}>
        {t("cache.title")}
      </Typography>
      <Typography variant="caption" sx={{ color: "text.muted" }}>
        {t("cache.hint")}
      </Typography>

      <Stack direction="row" alignItems="center" spacing={2} sx={{ mt: 0.5 }}>
        <Box>
          <Typography variant="body2" className="font-mono" sx={{ fontWeight: 500 }}>
            {info ? fmtBytes(info.size_bytes) : "·"}
          </Typography>
          <Typography variant="caption" sx={{ color: "text.muted" }}>
            {info ? t("cache.files", { count: info.file_count }) : ""}
            {info ? ` · ${t("cache.auto", { gb: info.max_gb })}` : ""}
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small" variant="outlined" color="error"
          disabled={empty || clear.isPending}
          startIcon={clear.isPending
            ? <CircularProgress size={12} sx={{ color: "inherit" }} />
            : <DeleteSweep fontSize="small" />}
          onClick={() => clear.mutate()}
        >
          {t("cache.clear")}
        </Button>
      </Stack>
    </Stack>
  );
}
