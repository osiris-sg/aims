/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Small shared pieces for "Fill from PI / B/L draft": a drop zone for the
// source PDF(s), the side-by-side PDF viewer, and the highlight style for
// fields the AI filled in.

import React, { useEffect, useRef, useState } from "react";
import { Box, Button, CircularProgress, Paper, Typography, type SxProps, type Theme } from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import { useShipmentsApi } from "../_lib/api";

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

/** The stored source PDF next to the form (signed URL, refreshed per file). */
export function SourcePdfPane({ fileId, fileName, stacked = false }: { fileId: string; fileName?: string | null; stacked?: boolean }) {
  const api = useShipmentsApi();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    setError(null);
    api
      .fileUrl(fileId)
      .then((r) => live && setUrl(r.url))
      .catch((e: any) => live && setError(e?.message || "Could not open the PDF"));
    return () => {
      live = false;
    };
  }, [api, fileId]);
  return (
    <Box
      sx={{
        // Beside the form: sticky, full height. Stacked above it: a fixed-height strip.
        position: stacked ? "static" : "sticky",
        top: 0,
        height: stacked ? 420 : "calc(100vh - 220px)",
        display: "flex",
        flexDirection: "column",
        gap: 0.5,
      }}
    >
      <Typography variant="caption" color="text.secondary" noWrap title={fileName ?? undefined}>
        {fileName ?? "Source PDF"}
      </Typography>
      <Box sx={{ flex: 1, border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden", bgcolor: "background.default" }}>
        {url ? (
          <iframe title="Source PDF" src={url} style={{ width: "100%", height: "100%", border: 0 }} />
        ) : (
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color={error ? "error" : "text.secondary"}>
              {error ?? "Loading…"}
            </Typography>
          </Box>
        )}
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
