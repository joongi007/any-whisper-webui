import { MenuItem, Stack, TextField } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchModels } from "../../api/system";

const CUSTOM = "__custom__";

/** Model picker, scoped to a backend. The list comes from the server
 *  (`/system/models?backend=`) so the catalogue is one place to extend when
 *  models are added — and crucially it's backend-specific (faster-whisper and
 *  insanely-fast expose different model sets). A "Custom…" option always
 *  reveals a free-text field for fine-tunes / local paths / anything not yet
 *  in the catalogue.
 *
 *  `backend` drives which list loads; changing the backend refetches. If the
 *  stored model isn't in the loaded list, the picker opens in custom mode so a
 *  valid-but-unlisted value is never silently dropped. */
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
    </Stack>
  );
}
