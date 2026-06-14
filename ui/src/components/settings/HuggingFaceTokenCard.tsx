import { CheckCircle, OpenInNew, WarningAmber } from "@mui/icons-material";
import { Box, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { fetchSystemInfo } from "../../api/system";
import { StatusBlock } from "../feedback/StatusBlock";

/** Tells the user whether diarization (and any other HF-gated feature) is
 *  actually wired up. We deliberately do NOT accept the token from the UI —
 *  storing a long-lived HF token in browser-accessible state, then sending it
 *  through the API for env-var injection, is more surface than the project
 *  warrants. The user pastes it once into `.env` and restarts the container.
 *  The card just answers "did that work?" so the failure mode isn't silent. */
export function HuggingFaceTokenCard() {
  const { t } = useTranslation();
  const sys = useQuery({
    queryKey: ["system-info"], queryFn: fetchSystemInfo, refetchInterval: 30_000,
  });
  const ok = sys.data?.diarize_available === true;
  const reason = sys.data?.diarize_reason ?? null;
  // Token set but access not yet confirmed. Two distinct causes, now told
  // apart by `reason`: model terms not accepted vs. token lacking the
  // gated-repo scope (the silent 403 the user hit).
  const tokenButNoAccess = !ok && sys.data?.diarize_token_present === true;
  const isPermission = tokenButNoAccess && reason === "permission";

  return (
    <Stack spacing={1.25}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="overline" sx={{ color: "text.secondary" }}>
          HuggingFace token
        </Typography>
        <StatusPill ok={ok} tokenButNoAccess={tokenButNoAccess} />
      </Stack>

      {ok ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {t("hf.ready_body")}
        </Typography>
      ) : isPermission ? (
        // The silent-403 case: token is valid AND terms accepted, but the
        // (fine-grained) token lacks the "access public gated repos" scope.
        // This is the gotcha that gave the user zero feedback before.
        <Box sx={{ p: 2, borderRadius: 1.5, bgcolor: "var(--warning-soft)" }}>
          <Stack spacing={1.25}>
            <Typography variant="body2" sx={{ color: "text.primary", fontWeight: 500 }}>
              {t("hf.perm_title")}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {t("hf.perm_body")}
            </Typography>
            <Box component="ol" sx={{
              m: 0, pl: 2.5,
              "& li": { marginBottom: "4px", color: "text.secondary", fontSize: 13 },
            }}>
              <li>{t("hf.perm_step_a")}</li>
              <li>
                {t("hf.perm_step_b")}{" "}
                <ExtLink href="https://huggingface.co/settings/tokens">
                  {t("hf.perm_step_b_link")}
                </ExtLink>
              </li>
              <li>{t("hf.perm_step_restart")}</li>
            </Box>
            <Typography variant="caption" sx={{ color: "text.muted" }}>
              {t("hf.access_note")}
            </Typography>
          </Stack>
        </Box>
      ) : tokenButNoAccess ? (
        // Token works, but the account hasn't accepted the model terms.
        <Box sx={{ p: 2, borderRadius: 1.5, bgcolor: "var(--warning-soft)" }}>
          <Stack spacing={1.25}>
            <Typography variant="body2" sx={{ color: "text.primary", fontWeight: 500 }}>
              {t("hf.access_title")}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {t("hf.access_body")}
            </Typography>
            <Box component="ul" sx={{
              m: 0, pl: 2.5,
              "& li": { marginBottom: "4px", color: "text.secondary", fontSize: 13 },
            }}>
              <li>
                <ExtLink href="https://huggingface.co/pyannote/speaker-diarization-3.1">
                  pyannote/speaker-diarization-3.1
                </ExtLink>
              </li>
              <li>
                <ExtLink href="https://huggingface.co/pyannote/segmentation-3.0">
                  pyannote/segmentation-3.0
                </ExtLink>
              </li>
              <li>
                <ExtLink href="https://huggingface.co/pyannote/speaker-diarization-community-1">
                  pyannote/speaker-diarization-community-1
                </ExtLink>
              </li>
            </Box>
            <Typography variant="caption" sx={{ color: "text.muted" }}>
              {t("hf.access_note")}
            </Typography>
          </Stack>
        </Box>
      ) : (
        // Soft warning surface — the rest of Settings is flat, but a task the
        // user actually needs to perform earns visible framing. Without this
        // wash the four-step instructions disappear into the page. Use
        // `padding={2}` because this is an instructional surface, not the
        // tighter status banner default.
        <StatusBlock tone="warning" padding={2}>
          <Stack spacing={1.5}>
            <Typography variant="body2" sx={{ color: "text.primary" }}>
              {t("hf.needs_intro")}
            </Typography>

            <Box component="ol" sx={{
              m: 0, pl: 2.5,
              "& li": { marginBottom: "6px", color: "text.secondary", fontSize: 13 },
            }}>
              <li>
                <ExtLink href="https://huggingface.co/pyannote/speaker-diarization-3.1">
                  speaker-diarization-3.1
                </ExtLink>
                {" / "}
                <ExtLink href="https://huggingface.co/pyannote/segmentation-3.0">
                  segmentation-3.0
                </ExtLink>
                {" / "}
                <ExtLink href="https://huggingface.co/pyannote/speaker-diarization-community-1">
                  community-1
                </ExtLink>
                {t("hf.step_terms_suffix")}
              </li>
              <li>
                <ExtLink href="https://huggingface.co/settings/tokens">
                  {t("hf.step_token")}
                </ExtLink>
              </li>
              <li>
                {t("hf.step_env")}
                <Box component="pre" sx={{
                  mt: 0.5, p: 1, borderRadius: 1,
                  // Use the canvas tint, which is lighter than the warning
                  // wash in light theme and darker in dark theme — either way
                  // the code block reads as a distinct surface against
                  // `--warning-soft`, not a sunken hole.
                  bgcolor: "var(--bg-canvas)", color: "var(--text-primary)",
                  border: "1px solid var(--border-default)",
                  fontSize: 12, fontFamily: "JetBrains Mono, ui-monospace, monospace",
                  overflowX: "auto",
                }}>
{`AI_HUGGINGFACE_TOKEN=hf_xxxxxxxxxxxxxxxxx`}
                </Box>
              </li>
              <li>{t("hf.step_restart")}</li>
            </Box>

            <Typography variant="caption" sx={{ color: "text.muted" }}>
              {t("hf.auto_refresh_note")}
            </Typography>
          </Stack>
        </StatusBlock>
      )}
    </Stack>
  );
}

function StatusPill({ ok, tokenButNoAccess }: { ok: boolean; tokenButNoAccess: boolean }) {
  const { t } = useTranslation();
  const label = ok
    ? t("hf.status_ready")
    : tokenButNoAccess
      ? t("hf.status_needs_access")
      : t("hf.status_needs_token");
  return (
    <Box component="span" sx={{
      display: "inline-flex", alignItems: "center", gap: 0.5,
      height: 20, px: 0.75, borderRadius: 999,
      fontSize: 11, fontWeight: 500,
      bgcolor: ok ? "var(--success-soft)" : "var(--warning-soft)",
      color: ok ? "var(--success)" : "var(--warning)",
    }}>
      {ok
        ? <CheckCircle sx={{ fontSize: 12 }} />
        : <WarningAmber sx={{ fontSize: 12 }} />}
      {label}
    </Box>
  );
}

function ExtLink({ href, children }: { href: string; children?: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
       style={{ color: "var(--accent)", textDecoration: "none" }}>
      {children}
      <OpenInNew sx={{ fontSize: 12, ml: 0.25, verticalAlign: "text-bottom" }} />
    </a>
  );
}
