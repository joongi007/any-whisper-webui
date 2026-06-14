import { Memory, PlayArrow, PowerSettingsNew } from "@mui/icons-material";
import {
  Box, Button, CircularProgress, IconButton, Stack, Tooltip, Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchSystemInfo, loadModel, type LoadedModel, unloadModel } from "../../api/system";

/** "Which models are currently resident in the AI worker, and how do I warm/evict them?"
 *  Surfaces the silent state that used to confuse first-time users — they'd click
 *  Connect, hit a long wait, and assume the app was broken. */
export function LoadedModelsCard() {
  const qc = useQueryClient();
  const sys = useQuery({
    queryKey: ["system-info"],
    queryFn: fetchSystemInfo,
    refetchInterval: 5_000,
    staleTime: 0,
  });

  const loadMut = useMutation({
    mutationFn: (m: LoadedModel) => loadModel(m.backend, m.model ?? "large-v3-turbo"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["system-info"] }),
  });
  const unloadMut = useMutation({
    mutationFn: (backend: string) => unloadModel(backend),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["system-info"] }),
  });

  const loaded = sys.data?.loaded_models ?? [];
  const defaults = sys.data
    ? { backend: sys.data.default_backend, model: sys.data.default_model }
    : null;
  const isDefaultLoaded = defaults?.backend
    ? loaded.some((m) => m.backend === defaults.backend)
    : false;

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" alignItems="baseline" spacing={1}>
        <Typography variant="overline" sx={{ color: "text.secondary" }}>
          Models in memory
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", ml: "auto" }}>
          {sys.data?.ai_online === false ? "AI offline" : "auto-unload after 5 min idle"}
        </Typography>
      </Stack>

      {loaded.length === 0 && (
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ py: 0.5 }}>
          <Typography variant="body2" sx={{ color: "text.secondary", flex: 1 }}>
            No model is resident.
          </Typography>
          {defaults?.backend && defaults.model && (
            <Button
              size="small" variant="text"
              startIcon={loadMut.isPending ? <CircularProgress size={14} /> : <PlayArrow fontSize="small" />}
              disabled={loadMut.isPending}
              onClick={() => loadMut.mutate({ backend: defaults.backend!, model: defaults.model!, idle_sec: null })}
            >
              Warm {defaults.backend} · {defaults.model}
            </Button>
          )}
        </Stack>
      )}

      {loaded.length > 0 && (
        <Box sx={{
          borderTop: "1px solid var(--border-default)",
          borderBottom: "1px solid var(--border-default)",
        }}>
          {loaded.map((m, i) => (
            <Stack key={m.backend} direction="row" alignItems="center" spacing={1.5}
                sx={{
                  py: 1, px: 0.5,
                  borderTop: i === 0 ? "none" : "1px solid var(--border-default)",
                }}>
              <Memory fontSize="small" sx={{ color: "text.muted" }} />
              <Stack sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }} className="font-mono">{m.backend}</Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {m.model ?? "·"} · idle {m.idle_sec != null ? `${m.idle_sec.toFixed(0)}s` : "·"}
                </Typography>
              </Stack>
              <Tooltip title="Unload (free VRAM)">
                <span>
                  <IconButton size="small" disabled={unloadMut.isPending}
                      onClick={() => unloadMut.mutate(m.backend)}>
                    <PowerSettingsNew fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          ))}
        </Box>
      )}

      {!isDefaultLoaded && loaded.length > 0 && defaults?.backend && defaults.model && (
        <Button
          size="small" variant="text" sx={{ alignSelf: "flex-start" }}
          startIcon={loadMut.isPending ? <CircularProgress size={14} /> : <PlayArrow fontSize="small" />}
          disabled={loadMut.isPending}
          onClick={() => loadMut.mutate({ backend: defaults.backend!, model: defaults.model!, idle_sec: null })}
        >
          Also warm default ({defaults.backend} · {defaults.model})
        </Button>
      )}
    </Stack>
  );
}
