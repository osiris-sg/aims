"use client";

import React, { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
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
import { hasNativeCamera, captureNativePhoto } from "@/app/(field)/lib/nativeCamera";

export interface CapturedPhoto {
  key: string;
  previewUrl: string;
}

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

// Phone-camera JPEGs run 4–8 MB. Resize to 1280px wide at JPEG q0.7 — typically
// ~200–400 KB — before upload, otherwise the S3 PUT is painfully slow on field
// LTE and the office gets oversized assets it never zooms into.
//
// Uses canvas.toBlob() rather than canvas.toDataURL() + fetch(dataUrl).blob():
// the round-trip via fetch() on a data URL produces a Blob with an empty `.type`
// in the Capacitor Android WebView, which downstream upload maps to a ".unknown"
// extension and the backend silently drops. toBlob guarantees the type asked for.
const compressImageToBlob = (
  dataUrl: string,
  maxWidth = 1280,
  quality = 0.7,
): Promise<Blob> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let w = img.width;
      let h = img.height;
      if (w > maxWidth) {
        h = (h * maxWidth) / w;
        w = maxWidth;
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => resolve(blob ?? new Blob([], { type: "image/jpeg" })),
        "image/jpeg",
        quality,
      );
    };
    img.src = dataUrl;
  });
};

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/**
 * Presentational proof-photo capture: pick from camera/gallery → compress →
 * upload (via the injected `upload` prop) → preview grid with per-photo delete.
 * No auth inside — mirrors the exact field UI extracted from do/[doId] and
 * install/[doId] so the field and guest flows render/behave identically.
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
  const [uploading, setUploading] = useState(false);
  // Native camera availability: null = still checking / web (use <input>),
  // true = native shell with a camera sensor (prefer Take photo),
  // false = native shell WITHOUT a camera (show the guard + gallery only).
  const isNative = Capacitor.isNativePlatform();
  const [nativeCam, setNativeCam] = useState<boolean | null>(null);
  const [camMsg, setCamMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isNative) return;
    let cancelled = false;
    void hasNativeCamera().then((ok) => {
      if (!cancelled) setNativeCam(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [isNative]);

  const setUploadingFlag = (v: boolean) => {
    setUploading(v);
    onUploadingChange?.(v);
  };

  // Compress + upload each file, appending to the set (preserves multi-photo:
  // both a burst from the gallery picker and repeat "Take photo" taps append).
  const ingestFiles = async (files: File[]) => {
    if (files.length === 0) return;
    onError?.("");
    setUploadingFlag(true);
    try {
      const newPhotos: CapturedPhoto[] = [];
      for (const file of files) {
        const originalDataUrl = await fileToDataUrl(file);
        const compressedBlob = await compressImageToBlob(originalDataUrl);
        const key = await upload(compressedBlob);
        if (key) {
          newPhotos.push({ key, previewUrl: URL.createObjectURL(compressedBlob) });
        }
      }
      onChange([...photos, ...newPhotos]);
    } catch (e: any) {
      onError?.(e?.message ?? "Upload failed");
    } finally {
      setUploadingFlag(false);
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (files) void ingestFiles(Array.from(files));
  };

  // Native "Take photo" — one shot per tap via the in-app camera, appended to
  // the set. A real failure flips to the gallery-only guard.
  const handleTakePhoto = async () => {
    setCamMsg(null);
    try {
      const file = await captureNativePhoto();
      if (file) await ingestFiles([file]);
    } catch {
      setNativeCam(false);
      setCamMsg("Camera unavailable — choose an existing photo below.");
    }
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

      {!isNative ? (
        // Web: unchanged — the browser's capture input (camera on mobile web,
        // file chooser on desktop).
        <Button
          component="label"
          variant="outlined"
          startIcon={<AddPhotoAlternateIcon />}
          disabled={uploading || disabled}
          fullWidth
        >
          Add photos
          <input
            type="file"
            accept="image/*"
            multiple
            capture="environment"
            hidden
            onChange={(e) => handleFiles(e.target.files)}
          />
        </Button>
      ) : (
        // Native shell: prefer the in-app camera (works with no external camera
        // app). Always offer the gallery too; when there's no camera sensor,
        // gallery is the only option and the guard message explains why.
        <Stack spacing={1}>
          {nativeCam !== false && (
            <Button
              variant="contained"
              startIcon={<PhotoCameraIcon />}
              onClick={() => void handleTakePhoto()}
              disabled={uploading || disabled || nativeCam === null}
              fullWidth
            >
              Take photo
            </Button>
          )}
          <Button
            component="label"
            variant="outlined"
            startIcon={<AddPhotoAlternateIcon />}
            disabled={uploading || disabled}
            fullWidth
          >
            Choose from gallery
            <input
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => handleFiles(e.target.files)}
            />
          </Button>
        </Stack>
      )}
    </Box>
  );
}
