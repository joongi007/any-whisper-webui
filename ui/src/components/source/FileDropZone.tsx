import { CloudUpload } from "@mui/icons-material";
import { Box, LinearProgress, Stack, Typography } from "@mui/material";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { uploadFile, type FileUploaded } from "../../api/files";

interface Props { onUploaded: (f: FileUploaded) => void }

export function FileDropZone({ onUploaded }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handle = useCallback(async (file: File) => {
    setError(null); setPct(0);
    try {
      const out = await uploadFile(file, (p) => setPct(p));
      onUploaded(out);
    } catch (e) {
      setError(t("error.upload_failed"));
      console.error(e);
    } finally {
      setPct(null);
    }
  }, [onUploaded, t]);

  return (
    <Box onClick={() => inputRef.current?.click()}
         onDragOver={(e) => e.preventDefault()}
         onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void handle(f); }}
         role="button" tabIndex={0}
         onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
         sx={{
           border: "2px dashed var(--border-default)", borderRadius: 2, cursor: "pointer",
           py: 8, px: 4, textAlign: "center", bgcolor: "background.paper",
           transition: "border-color 200ms ease", "&:hover": { borderColor: "primary.main" },
         }}>
      <input ref={inputRef} type="file" accept="audio/*,video/*" hidden
             onChange={(e) => { const f = e.target.files?.[0]; if (f) void handle(f); }} />
      <Stack alignItems="center" spacing={1}>
        <CloudUpload fontSize="large" color="primary" />
        <Typography>{t("file.drop")}</Typography>
        {pct !== null && (
          <Box sx={{ width: "60%", maxWidth: 360 }}>
            <LinearProgress variant="determinate" value={Math.round(pct * 100)} />
            <Typography variant="caption">{t("file.uploading")} {Math.round(pct * 100)}%</Typography>
          </Box>
        )}
        {error && <Typography color="error" variant="body2">{error}</Typography>}
      </Stack>
    </Box>
  );
}
