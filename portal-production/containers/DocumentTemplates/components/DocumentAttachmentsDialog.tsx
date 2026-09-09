"use client";
// Attachments dialog (⋮ menu) — global for EVERY document type (guru
// 2026-09-09), mirroring the bills editor's "Source Documents" section:
// files upload to S3 via /uploads/image, metadata rows live on
// Document.attachments, add/remove are stamped into History & notes.
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Button,
  IconButton,
  Typography,
  CircularProgress,
  Tooltip,
  Stack,
} from "@mui/material";
import {
  Close as CloseIcon,
  AttachFile as AttachFileIcon,
  DeleteOutline as DeleteOutlineIcon,
  OpenInNew as OpenInNewIcon,
  CloudUpload as CloudUploadIcon,
  PictureAsPdf as PdfIcon,
  Image as ImageIcon,
  InsertDriveFile as FileIcon,
} from "@mui/icons-material";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { uploadFile, publicFileUrl } from "@/helpers/fileUploader";

type AttachmentRow = {
  fileKey: string;
  fileName: string;
  mimeType?: string;
  label?: string;
  uploadedAt?: string;
  uploadedBy?: string;
};

const fileIcon = (mimeType?: string) => {
  if ((mimeType || "").includes("pdf")) return <PdfIcon fontSize="small" color="error" />;
  if ((mimeType || "").startsWith("image/")) return <ImageIcon fontSize="small" color="info" />;
  return <FileIcon fontSize="small" color="action" />;
};

const formatWhen = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";

export default function DocumentAttachmentsDialog({
  open,
  onClose,
  documentId,
}: {
  open: boolean;
  onClose: () => void;
  documentId: string;
}) {
  const { getToken } = useAuth();
  const [rows, setRows] = useState<AttachmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const fetchRows = useCallback(async () => {
    if (!documentId) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res: any = await request({ path: `/documents/${documentId}/attachments`, method: "GET" }, {}, token || undefined);
      const list = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
      setRows(list);
    } catch {
      setError("Failed to load attachments");
    } finally {
      setLoading(false);
    }
  }, [documentId, getToken]);

  useEffect(() => {
    if (open) fetchRows();
  }, [open, fetchRows]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !documentId) return;
    setUploading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      const uploaded: AttachmentRow[] = [];
      for (const file of Array.from(files)) {
        const meta = await uploadFile({ file, folder: `documents/${documentId}/attachments`, token });
        uploaded.push({ fileKey: meta.fileKey, fileName: meta.fileName, mimeType: meta.mimeType });
      }
      const res: any = await request(
        { path: `/documents/${documentId}/attachments`, method: "POST" },
        { files: uploaded },
        token,
      );
      const list = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : null;
      if (list) setRows(list);
      else await fetchRows();
    } catch (e: any) {
      setError(e?.message || "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleRemove = async (row: AttachmentRow) => {
    if (!confirm(`Remove "${row.fileName}" from this document?`)) return;
    try {
      const token = await getToken();
      const res: any = await request(
        { path: `/documents/${documentId}/attachments/remove`, method: "POST" },
        { fileKey: row.fileKey },
        token || undefined,
      );
      const list = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : null;
      if (list) setRows(list);
      else await fetchRows();
    } catch (e: any) {
      setError(e?.message || "Remove failed");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pr: 6 }}>
        <AttachFileIcon fontSize="small" />
        Attachments
        <IconButton size="small" onClick={onClose} sx={{ position: "absolute", right: 12, top: 12 }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ minHeight: 180 }}>
        {loading ? (
          <Box sx={{ py: 5, textAlign: "center" }}>
            <CircularProgress size={22} />
          </Box>
        ) : rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
            No files attached. PDFs and images supported — supplier documents, signed copies, payment proof, anything supporting this document.
          </Typography>
        ) : (
          <Stack gap={0.5}>
            {rows.map((r) => (
              <Stack
                key={r.fileKey}
                direction="row"
                alignItems="center"
                gap={1}
                sx={{ px: 1, py: 0.75, borderRadius: 1, border: 1, borderColor: "divider" }}
              >
                {fileIcon(r.mimeType)}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{r.fileName}</Typography>
                  {r.uploadedAt && (
                    <Typography variant="caption" color="text.secondary">{formatWhen(r.uploadedAt)}</Typography>
                  )}
                </Box>
                <Tooltip title="Open">
                  <IconButton size="small" onClick={() => window.open(publicFileUrl(r.fileKey), "_blank", "noopener")}>
                    <OpenInNewIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Remove">
                  <IconButton size="small" sx={{ color: "error.main" }} onClick={() => handleRemove(r)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            ))}
          </Stack>
        )}
        {error && (
          <Typography variant="caption" color="error" sx={{ display: "block", mt: 1 }}>{error}</Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between", px: 2 }}>
        <Typography variant="caption" color="text.secondary">
          {rows.length ? `${rows.length} file${rows.length === 1 ? "" : "s"}` : ""}
        </Typography>
        <Button
          variant="outlined"
          size="small"
          startIcon={uploading ? <CircularProgress size={14} color="inherit" /> : <CloudUploadIcon />}
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? "Uploading…" : "Add files"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          accept="application/pdf,image/*"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </DialogActions>
    </Dialog>
  );
}
