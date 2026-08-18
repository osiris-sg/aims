"use client";

import React from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  ImageList,
  ImageListItem,
  Stack,
  Typography,
} from "@mui/material";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import DeleteIcon from "@mui/icons-material/Delete";
import { usePhotoUploader, type CapturedPhoto } from "./usePhotoUploader";

export type { CapturedPhoto };

interface Props {
  /** Section label, e.g. "Proof of delivery" / "Proof of installation". */
  label: string;
  /** Controlled list of captured (uploaded) photos. */
  photos: CapturedPhoto[];
  onChange: (photos: CapturedPhoto[]) => void;
  /**
   * Uploads ONE compressed blob and resolves its stored key (or null to skip).
   * Auth lives here, in the CALLER — the field flow wraps uploadImage()+Clerk
   * token; the guest flow wraps the token-scoped /public photo endpoint. This
   * component never sees a token.
   */
  upload: (blob: Blob) => Promise<string | null>;
  onError?: (message: string) => void;
  /** Notifies the parent while an upload is in flight (to disable submit). */
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
}

/**
 * Presentational proof-photo capture: pick from camera/gallery → compress →
 * upload (via the injected `upload` prop) → preview grid with per-photo delete.
 * No auth inside — mirrors the exact field UI extracted from do/[doId] and
 * install/[doId] so the field and guest flows render/behave identically.
 *
 * This is the FREE-FORM grid: any number of photos, no prompted order. Equipment
 * condition capture at delivery start uses GuidedPhotoCapture instead, which
 * walks named angles; the capture plumbing is shared via usePhotoUploader.
 */
export default function PhotoCaptureField({
  label,
  photos,
  onChange,
  upload,
  onError,
  onUploadingChange,
  disabled,
}: Props) {
  const { uploading, captureMode, camMsg, setCamMsg, ingestFiles, takeNativePhotos } =
    usePhotoUploader({ upload, onError, onUploadingChange });

  const append = (captured: CapturedPhoto[]) => {
    if (captured.length > 0) onChange([...photos, ...captured]);
  };

  const handleFiles = (files: FileList | null) => {
    if (files) void ingestFiles(Array.from(files)).then(append);
  };

  const removePhoto = (index: number) => {
    onChange(photos.filter((_, i) => i !== index));
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle2">
          {label} ({photos.length})
        </Typography>
        {uploading && <CircularProgress size={16} />}
      </Stack>

      {photos.length > 0 && (
        <ImageList cols={3} gap={8} sx={{ mb: 2 }}>
          {photos.map((p, idx) => (
            <ImageListItem key={p.key} sx={{ position: "relative" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.previewUrl}
                alt=""
                style={{ borderRadius: 4, objectFit: "cover", aspectRatio: "1/1" }}
              />
              <IconButton
                size="small"
                onClick={() => removePhoto(idx)}
                sx={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  bgcolor: "rgba(0,0,0,0.6)",
                  color: "white",
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </ImageListItem>
          ))}
        </ImageList>
      )}

      {camMsg && (
        <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setCamMsg(null)}>
          {camMsg}
        </Alert>
      )}

      <Stack spacing={1}>
        {captureMode === "inapp" ? (
          // Native shell, in-app CameraX. The Sunmi has no camera app, so this
          // is its only working path.
          <>
            <Button
              variant="contained"
              startIcon={<PhotoCameraIcon />}
              onClick={() => void takeNativePhotos().then(append)}
              disabled={uploading || disabled}
              fullWidth
            >
              Take photos
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center" }}>
              The camera stays open. Keep shooting, then press back on the
              camera when you&apos;re done. Photos are kept.
            </Typography>
          </>
        ) : (
          // Web, or a native shell whose in-app camera failed: the device
          // camera via <input capture>. This is what worked before the in-app
          // path existed and is what a normal phone needs.
          <Button
            component="label"
            variant="contained"
            startIcon={<PhotoCameraIcon />}
            disabled={uploading || disabled}
            fullWidth
          >
            Take photos
            <input
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              hidden
              onChange={(e) => handleFiles(e.target.files)}
            />
          </Button>
        )}
        {/* Gallery is always available as a last resort. */}
        <Button
          component="label"
          variant="outlined"
          startIcon={<AddPhotoAlternateIcon />}
          disabled={uploading || disabled}
          fullWidth
        >
          Choose from gallery
          <input type="file" accept="image/*" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
        </Button>
      </Stack>
    </Box>
  );
}
