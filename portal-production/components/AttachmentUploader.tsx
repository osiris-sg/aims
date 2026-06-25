"use client";

import React, { useRef, useState } from "react";
import { Box, Button, IconButton, Stack, Tooltip, Typography, CircularProgress, Chip } from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { useAuth } from "@clerk/nextjs";
import { uploadFile, publicFileUrl, UploadedFileMeta } from "@/helpers/fileUploader";
import { toast } from "react-toastify";

export type Attachment = {
  fileKey: string;
  fileName: string;
  mimeType?: string;
  size?: number;
  label?: string;
  uploadedAt?: string;
  uploadedBy?: string;
};

interface Props {
  // Where to put new files in S3 (e.g. "bills/<billId>/attachments").
  folder: string;
  value: Attachment[];
  onChange: (next: Attachment[]) => void;
  // Optional label for the section header.
  label?: string;
  // Limit MIME types via the file picker — default accepts PDFs + images.
  accept?: string;
  // True to render a compact single-line variant (used inside dialogs).
  compact?: boolean;
  disabled?: boolean;
}

const DEFAULT_ACCEPT = "application/pdf,image/*";

export default function AttachmentUploader({
  folder,
  value,
  onChange,
  label = "Attachments",
  accept = DEFAULT_ACCEPT,
  compact = false,
  disabled,
}: Props) {
  const { getToken } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    setUploading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      const uploads: UploadedFileMeta[] = [];
      for (const file of Array.from(fileList)) {
        const meta = await uploadFile({ file, folder, token });
        uploads.push(meta);
      }
      const merged: Attachment[] = [
        ...value,
        ...uploads.map((m) => ({
          fileKey: m.fileKey,
          fileName: m.fileName,
          mimeType: m.mimeType,
          size: m.size,
        })),
      ];
      onChange(merged);
      toast.success(`${uploads.length} file${uploads.length === 1 ? "" : "s"} uploaded`);
    } catch (e: any) {
      toast.error(e?.message || "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const removeAt = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary", textTransform: "uppercase", letterSpacing: 0.5 }}>
          {label}
          {value.length > 0 && (
            <Chip size="small" label={value.length} sx={{ ml: 1, height: 18, fontSize: "0.7rem" }} />
          )}
        </Typography>
        <Button
          size="small"
          variant="outlined"
          startIcon={uploading ? <CircularProgress size={14} /> : <CloudUploadIcon fontSize="small" />}
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading}
        >
          {uploading ? "Uploading..." : "Add file"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          style={{ display: "none" }}
          onChange={(e) => handleFiles(e.target.files)}
        />
      </Stack>

      {value.length === 0 ? (
        <Typography variant="caption" sx={{ color: "text.disabled", fontStyle: "italic" }}>
          No files attached. PDFs and images supported.
        </Typography>
      ) : (
        <Stack gap={0.5}>
          {value.map((a, i) => (
            <Stack
              key={a.fileKey}
              direction="row"
              alignItems="center"
              gap={1}
              sx={{
                px: 1,
                py: 0.5,
                borderRadius: 1,
                bgcolor: "action.hover",
              }}
            >
              <Typography variant="body2" sx={{ flex: 1, fontSize: compact ? "0.8rem" : "0.875rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {a.fileName}
              </Typography>
              {a.size != null && (
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {(a.size / 1024).toFixed(0)} KB
                </Typography>
              )}
              <Tooltip title="Open in new tab">
                <IconButton size="small" component="a" href={publicFileUrl(a.fileKey)} target="_blank" rel="noreferrer">
                  <OpenInNewIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              {!disabled && (
                <Tooltip title="Remove">
                  <IconButton size="small" onClick={() => removeAt(i)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          ))}
        </Stack>
      )}
    </Box>
  );
}
