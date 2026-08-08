import { Bolt, Memory, PowerSettingsNew } from "@mui/icons-material";
import {
  Box, Button, CircularProgress, Divider, IconButton, Stack, Tooltip, Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { fetchSystemInfo, loadModel, type LoadedModel, unloadModel } from "../../api/system";
import { ModelSelect } from "../pipeline/ModelSelect";

/** "Which models are currently resident in the AI worker, and how do I warm/evict them?"
 *  Surfaces the silent state that used to confuse first-time users — they'd click
 *  Connect, hit a long wait, and assume the app was broken.
 *
 *  It also names the startup auto-warm model (the env-set default the worker
 *  loads on boot) and lets you warm any model on demand, so "what's warmed" is
 *  never a mystery and isn't locked to the boot default. */
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
  const bootBackend = sys.data?.default_backend ?? "faster_whisper";
  const bootModel = sys.data?.default_model ?? "large-v3-turbo";

  // The model to warm on demand. Defaults to the boot model until the user picks
  // another; warming loads it now (this session) without touching the env-set
  // startup default.
  const [pick, setPick] = useState("");
  const warmModel = pick || bootModel;
  const alreadyResident = loaded.some(
    (m) => m.backend === bootBackend && m.model === warmModel,
  );

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

      {loaded.length === 0 ? (
        <Typography variant="body2" sx={{ color: "text.secondary", py: 0.5 }}>
          No model is resident.
        </Typography>
      ) : (
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

      <Divider />

      {/* Warm a chosen model on demand. The picker starts on the boot default,
          so warming that is one click, but any catalogue model (CrisperWhisper
          included) can be warmed here. */}
      <Stack spacing={1}>
        <Typography variant="overline" sx={{ color: "text.secondary" }}>
          Warm a model
        </Typography>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <ModelSelect backend={bootBackend} value={warmModel} onChange={setPick} />
          </Box>
          <Button
            variant="text"
            startIcon={loadMut.isPending ? <CircularProgress size={14} /> : <Bolt fontSize="small" />}
            disabled={loadMut.isPending || alreadyResident || sys.data?.ai_online === false}
            onClick={() => loadMut.mutate({ backend: bootBackend, model: warmModel, idle_sec: null })}
          >
            {alreadyResident ? "Resident" : "Warm"}
          </Button>
        </Stack>
        <Typography variant="caption" sx={{ color: "text.secondary", lineHeight: 1.4 }}>
          Startup auto-warm: <span className="font-mono">{bootBackend} · {bootModel}</span>{" "}
          (change the boot default via <span className="font-mono">AI_PREWARM_MODEL</span>).
        </Typography>
      </Stack>
    </Stack>
  );
}
