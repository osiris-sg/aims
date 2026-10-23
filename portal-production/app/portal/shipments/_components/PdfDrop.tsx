"use client";

// Small shared pieces for "Fill from PI / B/L draft": a drop zone for the
// source PDF(s), the side-by-side PDF viewer, and the highlight style for
// fields the AI filled in.

import React, { useRef, useState } from "react";
import { Box, Button, CircularProgress, Paper, Typography, type SxProps, type Theme } from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import DocPages from "./DocPages";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp";
const okFile = (f: File) => /\.(pdf|png|jpe?g|webp)$/i.test(f.name);

export function PdfDropZone({
  title,
  busy,
  busyText,
  multiple = false,
  onFiles,
  dataTour,
}: {
  title: string;
  busy?: boolean;
  busyText?: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  dataTour?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter(okFile);
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };
  return (
    <Paper
      variant="outlined"
      data-tour={dataTour}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!busy) take(e.dataTransfer.files);
      }}
      sx={{ p: 1.5, display: "flex", alignItems: "center", gap: 1.5, borderStyle: "dashed", borderColor: over ? "primary.main" : "divider", bgcolor: over ? "action.hover" : "transparent" }}
    >
      {busy ? <CircularProgress size={22} /> : <AutoAwesomeIcon color="primary" />}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {busy ? busyText || "Reading…" : title}
        </Typography>
      </Box>
      <Button size="small" variant="outlined" disabled={busy} onClick={() => input.current?.click()}>
        Choose PDF{multiple ? "s" : ""}
      </Button>
      <input
        ref={input}
        type="file"
        hidden
        accept={ACCEPT}
        multiple={multiple}
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
    </Paper>
  );
}

/**
 * The source PDF next to the form, rendered in-app (DocPages: pages fitted to
 * the panel width, zoom, full screen). `file` = the PDF being read right now
 * (shown at once, before it is stored); else the stored file.
 */
export function SourcePdfPane({ fileId, fileName, file, stacked = false }: { fileId?: string | null; fileName?: string | null; file?: File | null; stacked?: boolean }) {
  const name = file?.name ?? fileName ?? "Source PDF";
  return (
    <Box
      sx={{
        // Beside the form: sticky, full height. Stacked above it: a fixed-height strip.
        position: stacked ? "static" : "sticky",
        top: 0,
        height: stacked ? 480 : "calc(100vh - 220px)",
        display: "flex",
        flexDirection: "column",
        gap: 0.5,
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ wordBreak: "break-word" }}>
        {file ? `Reading ${name}…` : name}
      </Typography>
      <Box sx={{ flex: 1, minHeight: 0, border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden", bgcolor: "background.default" }}>
        <DocPages src={file ? { file } : fileId ? { fileId } : null} fileName={name} mimeType={file?.type || undefined} />
      </Box>
    </Box>
  );
}

/** Outline + tint for a field the AI filled in (cleared once the user edits it). */
export const filledSx = (on: boolean): SxProps<Theme> =>
  on
    ? {
        "& .MuiOutlinedInput-root": { bgcolor: "rgba(237, 108, 2, 0.08)" },
        "& .MuiOutlinedInput-notchedOutline": { borderColor: "warning.main" },
      }
    : {};
