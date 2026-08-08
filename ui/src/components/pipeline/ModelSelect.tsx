import {
  Box, Divider, Link, MenuItem, Popover, Stack, TextField, Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchModels, type WhisperModelOption } from "../../api/system";

const CUSTOM = "__custom__";

/** A licence name is non-commercial if it carries the CC "NC" clause. Kept as a
 *  pure string test so the catalogue stays the single source of the terms. */
function isNonCommercialLicense(license: string): boolean {
  return /(^|[-\s])NC([-\s]|$)/i.test(license) || /noncommercial/i.test(license);
}

/** Fallback for custom (user-entered) models, whose licence the server can't
 *  know: flag the ones we recognise by name. */
const NONCOMMERCIAL_NAMES = ["crisperwhisper"];
function customLooksNonCommercial(model: string): boolean {
  const m = model.toLowerCase();
  return NONCOMMERCIAL_NAMES.some((s) => m.includes(s));
}

/** Model picker, scoped to a backend. The list comes from the server
 *  (`/system/models?backend=`) so the catalogue is one place to extend when
 *  models are added — and crucially it's backend-specific (faster-whisper and
 *  insanely-fast expose different model sets). A "Custom…" option always
 *  reveals a free-text field for fine-tunes / local paths / anything not yet
 *  in the catalogue.
 *
 *  `backend` drives which list loads; changing the backend refetches. If the
 *  stored model isn't in the loaded list, the picker opens in custom mode so a
 *  valid-but-unlisted value is never silently dropped.
 *
 *  Each row's size stays in its label; the licence rides alongside (shown for
 *  the current pick, and browsable for every model via the licences popover) so
 *  the dropdown itself never trades size text for licence text. */
export function ModelSelect({
  value, onChange, backend, label, size = "small",
}: {
  value: string;
  onChange: (v: string) => void;
  backend: string;
  label?: string;
  size?: "small" | "medium";
}) {
  const { t } = useTranslation();
  const models = useQuery({
    queryKey: ["models", backend],
    queryFn: () => fetchModels(backend),
    staleTime: 5 * 60_000,
  });
  const options = models.data ?? [];
  const isKnown = options.some((m) => m.id === value);
  // Sticky custom mode once chosen. While the list is still loading we don't
  // know if `value` is known, so don't force custom — wait for data.
  const [customForced, setCustomForced] = useState(false);
  const inCustom = customForced || (models.isSuccess && !isKnown);

  const selectValue = inCustom ? CUSTOM : (isKnown ? value : "");
  const selected = options.find((m) => m.id === value);
  const license = selected?.license ?? null;
  const nonCommercial = license
    ? isNonCommercialLicense(license)
    : (inCustom && customLooksNonCommercial(value));

  const [licAnchor, setLicAnchor] = useState<HTMLElement | null>(null);

  return (
    <Stack spacing={1} sx={{ minWidth: 0 }}>
      <TextField
        select size={size} label={label ?? t("common.model")}
        value={selectValue}
        disabled={models.isPending}
        onChange={(e) => {
          const v = e.target.value;
          if (v === CUSTOM) { setCustomForced(true); return; }
          setCustomForced(false);
          onChange(v);
        }}
      >
        {options.map((m) => (
          <MenuItem key={m.id} value={m.id}>{m.label}</MenuItem>
        ))}
        <MenuItem value={CUSTOM}>{t("common.model_custom")}</MenuItem>
      </TextField>
      {inCustom && (
        <TextField
          size={size} value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("common.model_custom_placeholder")}
          sx={{ "& .MuiInputBase-input": { fontFamily: "JetBrains Mono, ui-monospace, monospace", fontSize: 13 } }}
        />
      )}

      <Stack
        direction="row" spacing={1} useFlexGap
        sx={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap" }}
      >
        {license && (
          <Typography
            variant="caption"
            sx={{ color: nonCommercial ? "warning.main" : "text.secondary", lineHeight: 1.4 }}
          >
            {t("model.license")}: {license}
            {nonCommercial && ` · ${t("model.noncommercial")}`}
          </Typography>
        )}
        {options.length > 0 && (
          <Link
            component="button" type="button" variant="caption"
            underline="hover" color="text.secondary"
            sx={{ ml: "auto" }}
            onClick={(e) => setLicAnchor(e.currentTarget)}
          >
            {t("model.all_licenses")}
          </Link>
        )}
      </Stack>

      {nonCommercial && (
        <Typography variant="caption" sx={{ color: "warning.main", lineHeight: 1.4 }}>
          {t("model.noncommercial_warning")}
        </Typography>
      )}

      <Popover
        open={Boolean(licAnchor)}
        anchorEl={licAnchor}
        onClose={() => setLicAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Box sx={{ px: 2, py: 1.5, maxWidth: 340 }}>
          <Typography variant="overline" sx={{ color: "text.secondary" }}>
            {t("model.all_licenses")}
          </Typography>
          <Divider sx={{ my: 1 }} />
          <Stack spacing={0.75}>
            {options.map((m: WhisperModelOption) => {
              const nc = m.license ? isNonCommercialLicense(m.license) : false;
              return (
                <Stack
                  key={m.id} direction="row" spacing={2}
                  sx={{ justifyContent: "space-between", alignItems: "baseline" }}
                >
                  <Typography variant="body2" sx={{ minWidth: 0 }}>{m.label}</Typography>
                  <Typography
                    variant="caption"
                    sx={{ color: nc ? "warning.main" : "text.secondary", whiteSpace: "nowrap" }}
                  >
                    {m.license ?? "—"}
                  </Typography>
                </Stack>
              );
            })}
          </Stack>
        </Box>
      </Popover>
    </Stack>
  );
}
