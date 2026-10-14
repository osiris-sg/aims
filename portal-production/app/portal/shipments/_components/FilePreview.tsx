"use client";

// File previews for trade documents:
// - FileThumb: the server-made first-page / image thumbnail (made on upload),
//   or a file-type icon for Office / Outlook files. Click → FileViewer.
// - FileViewer: a larger in-app viewer (every page of a PDF in the browser's
//   viewer, images full size) with Download / Open in new tab.
// - LocalPreview: a file chosen in the upload dialog, before it is uploaded.

import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton, Stack, Typography } from "@mui/material";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import MailOutlineIcon from "@mui/icons-material/MailOutline";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import { useOrganization } from "@hooks/useOrganization";
import { useShipmentsApi } from "../_lib/api";
import { SHIPMENT_KEYS } from "../_lib/hooks";
import DocPages, { FirstPagePreview } from "./DocPages";

export type PreviewFile = { id: string; fileName: string; mimeType: string; hasThumb?: boolean; docRef?: string | null };

const extOf = (name: string) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();
const isPdf = (f: { fileName: string; mimeType?: string }) => f.mimeType === "application/pdf" || extOf(f.fileName) === "pdf";
const isImage = (f: { fileName: string; mimeType?: string }) => /^image\//.test(f.mimeType ?? "") || ["png", "jpg", "jpeg", "webp"].includes(extOf(f.fileName));

/** Icon by file type: PDF, image, spreadsheet, Word, Outlook mail, other. */
export function FileTypeIcon({ fileName, mimeType, size = 28 }: { fileName: string; mimeType?: string; size?: number }) {
  const ext = extOf(fileName);
  const sx = { fontSize: size };
  if (isPdf({ fileName, mimeType })) return <PictureAsPdfOutlinedIcon sx={{ ...sx, color: "error.main" }} />;
  if (isImage({ fileName, mimeType })) return <ImageOutlinedIcon sx={{ ...sx, color: "info.main" }} />;
  if (["xls", "xlsx", "csv"].includes(ext)) return <TableChartOutlinedIcon sx={{ ...sx, color: "success.main" }} />;
  if (["doc", "docx"].includes(ext)) return <DescriptionOutlinedIcon sx={{ ...sx, color: "primary.main" }} />;
  if (["msg", "eml"].includes(ext)) return <MailOutlineIcon sx={{ ...sx, color: "warning.main" }} />;
  return <InsertDriveFileOutlinedIcon sx={{ ...sx, color: "text.secondary" }} />;
}

const frameSx = (w: number, h: number) => ({
  width: w,
  height: h,
  flexShrink: 0,
  borderRadius: 1,
  border: 1,
  borderColor: "divider",
  bgcolor: "#fff",
  overflow: "hidden",
  position: "relative" as const,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
});

/** Thumbnail (A4-ish proportions) of a stored trade file; click opens the viewer. */
export function FileThumb({ file, width = 96, onOpen }: { file: PreviewFile; width?: number; onOpen?: (f: PreviewFile) => void }) {
  const api = useShipmentsApi();
  const { organization } = useOrganization();
  const height = Math.round(width * 1.38);
  // Signed URLs last 10 minutes: refetch well before that.
  const q = useQuery({
    queryKey: [...SHIPMENT_KEYS.files, organization?.id, "thumb", file.id],
    enabled: !!organization?.id && file.hasThumb !== false && (isPdf(file) || isImage(file)),
    staleTime: 8 * 60_000,
    queryFn: () => api.fileThumb(file.id),
  });
  const url = q.data?.url ?? null;
  return (
    <Box
      component={onOpen ? "button" : "div"}
      type={onOpen ? "button" : undefined}
      onClick={
        onOpen
          ? (e: React.MouseEvent) => {
              e.stopPropagation();
              onOpen(file);
            }
          : undefined
      }
      aria-label={onOpen ? `Preview ${file.fileName}` : undefined}
      sx={{ ...frameSx(width, height), p: 0, cursor: onOpen ? "zoom-in" : "default", font: "inherit" }}
    >
      {q.isLoading ? (
        <CircularProgress size={18} />
      ) : url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
      ) : (
        <FileTypeIcon fileName={file.fileName} mimeType={file.mimeType} size={Math.round(width / 2.6)} />
      )}
    </Box>
  );
}

/**
 * A larger viewer: PDFs and images rendered in-app (pages fitted to the width,
 * stacked, zoom, click for full screen — see DocPages); other types show their
 * icon and a Download button.
 */
export function FileViewer({ file, onClose }: { file: PreviewFile | null; onClose: () => void }) {
  const api = useShipmentsApi();
  const viewable = !!file && (isPdf(file) || isImage(file));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [file]);
  const downloadOther = async () => {
    // Not rendered in-app (Excel, Word, Outlook): fetch the bytes and save them under the file's name.
    setBusy(true);
    try {
      const blob = await api.fileContent(file!.id);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = file!.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    } catch (e) {
      setError((e as Error)?.message || "Could not download the file");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!file} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pr: 6 }}>
        {file && <FileTypeIcon fileName={file.fileName} mimeType={file.mimeType} size={22} />}
        {file?.docRef && (
          <Typography component="span" variant="h6" sx={{ fontFamily: "monospace", fontWeight: 800, whiteSpace: "nowrap" }}>
            {file.docRef}
          </Typography>
        )}
        <Typography component="span" variant={file?.docRef ? "body1" : "h6"} color={file?.docRef ? "text.secondary" : undefined} noWrap sx={{ minWidth: 0 }}>
          {file?.fileName}
        </Typography>
        <IconButton aria-label="Close" onClick={onClose} sx={{ position: "absolute", right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {file && viewable ? (
          <DocPages src={{ fileId: file.id }} fileName={file.fileName} mimeType={file.mimeType} height="80vh" />
        ) : (
          <Stack alignItems="center" spacing={1.5} sx={{ py: 8 }}>
            {file && <FileTypeIcon fileName={file.fileName} mimeType={file.mimeType} size={64} />}
            <Typography variant="body2" color="text.secondary">
              No preview for this file type — download it to open it.
            </Typography>
            {error && <Alert severity="error">{error}</Alert>}
            <Button variant="contained" startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <DownloadIcon />} disabled={busy} onClick={() => void downloadOther()}>
              Download
            </Button>
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Viewer state + element, for lists of thumbnails. */
export function useFileViewer() {
  const [file, setFile] = useState<PreviewFile | null>(null);
  return { open: setFile, viewer: <FileViewer file={file} onClose={() => setFile(null)} /> };
}

/** Preview of a file picked for upload (not stored yet): first page of a PDF, the image, or its type icon. */
export function LocalPreview({ file, width = 96 }: { file: File; width?: number }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const height = Math.round(width * 1.38);
  const f = { fileName: file.name, mimeType: file.type };
  return (
    <Box sx={frameSx(width, height)}>
      {isImage(f) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
      ) : isPdf(f) ? (
        // First page rendered in-app (pdf.js), fitted to the thumbnail width.
        <Box sx={{ position: "absolute", top: 0, left: 0 }}>
          <FirstPagePreview file={file} width={width} />
        </Box>
      ) : (
        <FileTypeIcon fileName={file.name} mimeType={file.type} size={Math.round(width / 2.6)} />
      )}
    </Box>
  );
}
