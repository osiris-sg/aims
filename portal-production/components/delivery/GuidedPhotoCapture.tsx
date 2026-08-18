"use client";

import React, { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteIcon from "@mui/icons-material/Delete";
import { usePhotoUploader, type CapturedPhoto } from "./usePhotoUploader";

export type { CapturedPhoto };

/**
 * The angles an equipment unit is walked through, in order (5 for equipment:
 * Front, Back, Left, Right, Top). These match the equipment minimum, so every
 * named slot is required; anything past them is an extra angle the rider chooses.
 *
 * DEFERRED (not built): an example reference photo per angle to show the
 * operator what "good" looks like. Tracked on OSI-81.
 */
const STEPS = [
  { key: "front", label: "Front", hint: "Face the unit head on, whole unit in frame." },
  { key: "back", label: "Back", hint: "Walk around and shoot the rear panel." },
  { key: "left", label: "Left", hint: "Shoot the left side square on." },
  { key: "right", label: "Right", hint: "Shoot the right side square on." },
  { key: "top", label: "Top", hint: "Shoot from above so the top surface is visible." },
] as const;

interface Props {
  /** Controlled list of captured (uploaded) photos. */
  photos: CapturedPhoto[];
  onChange: (photos: CapturedPhoto[]) => void;
  /** Uploads ONE compressed blob and resolves its stored key. */
  upload: (blob: Blob) => Promise<string | null>;
  /** How many photos this unit needs before delivery can start. */
  minPhotos: number;
  onError?: (message: string) => void;
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
}

/**
 * Guided condition capture for EQUIPMENT: front, back, left, right, top, then
 * any extra angles the minimum still needs. One shot per step rather than a
 * free-for-all picker, so the office gets a comparable set for every unit
 * instead of several photos of the same corner.
 *
 * The angle labels are guidance for the rider, not stored metadata. The
 * submitted payload is still a flat photos[] of S3 keys, so nothing downstream
 * (the DO_START report, the office proof panel, the printed DO) has to change.
 * Accessories keep the free-form single-photo grid in PhotoCaptureField.
 */
export default function GuidedPhotoCapture({
  photos,
  onChange,
  upload,
  minPhotos,
  onError,
  onUploadingChange,
  disabled,
}: Props) {
  const { uploading, isNative, nativeCam, camMsg, setCamMsg, ingestFiles, takeNativePhotoOnce } =
    usePhotoUploader({ upload, onError, onUploadingChange });
  // Which slot the rider is filling. Slots past STEPS.length are extra angles.
  const [stepIndex, setStepIndex] = useState(0);

  // Total slots to walk: the named angles, plus however many extras the minimum
  // still demands (the equipment minimum equals the named angles, so no extras).
  const totalSlots = Math.max(STEPS.length, minPhotos);
  const current = STEPS[stepIndex];
  const currentLabel = current?.label ?? `Additional angle ${stepIndex - STEPS.length + 1}`;
  const currentHint =
    current?.hint ?? "Any angle that shows the unit's condition, for example a serial plate or existing damage.";
  const done = photos.length >= minPhotos;

  const append = async (captured: CapturedPhoto[]) => {
    if (captured.length === 0) return;
    onChange([...photos, ...captured]);
    setStepIndex((i) => Math.min(i + captured.length, Math.max(totalSlots - 1, i + captured.length)));
  };

  const handleFiles = (files: FileList | null) => {
    if (files) void ingestFiles(Array.from(files)).then(append);
  };

  const removePhoto = (index: number) => {
    onChange(photos.filter((_, i) => i !== index));
    setStepIndex((i) => Math.max(0, i - 1));
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
        <Typography variant="subtitle2">
          Condition photos ({photos.length} of {minPhotos})
        </Typography>
        {uploading && <CircularProgress size={16} />}
        {done && <CheckCircleIcon color="success" fontSize="small" />}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
        This is equipment, so it needs a set of angles before it leaves.
      </Typography>

      {/* Slot strip: what is captured, what is next, what is still empty. */}
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
        {Array.from({ length: totalSlots }, (_, i) => {
          const filled = i < photos.length;
          const isCurrent = !done && i === photos.length;
          return (
            <Chip
              key={i}
              size="small"
              label={STEPS[i]?.label ?? `Extra ${i - STEPS.length + 1}`}
              color={filled ? "success" : isCurrent ? "primary" : "default"}
              variant={filled || isCurrent ? "filled" : "outlined"}
            />
          );
        })}
      </Stack>

      {photos.length > 0 && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
          {photos.map((p, idx) => (
            <Box key={p.key} sx={{ position: "relative", width: 84, height: 84 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.previewUrl}
                alt=""
                style={{ width: "100%", height: "100%", borderRadius: 4, objectFit: "cover" }}
              />
              <IconButton
                size="small"
                onClick={() => removePhoto(idx)}
                disabled={uploading || disabled}
                sx={{ position: "absolute", top: 2, right: 2, bgcolor: "rgba(0,0,0,0.6)", color: "white" }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
              <Typography
                variant="caption"
                sx={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  px: 0.5,
                  bgcolor: "rgba(0,0,0,0.6)",
                  color: "white",
                  fontSize: "0.6rem",
                  borderRadius: "0 0 4px 4px",
                }}
              >
                {STEPS[idx]?.label ?? `Extra ${idx - STEPS.length + 1}`}
              </Typography>
            </Box>
          ))}
        </Stack>
      )}

      {camMsg && (
        <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setCamMsg(null)}>
          {camMsg}
        </Alert>
      )}

      {done ? (
        <Alert severity="success" sx={{ mb: 1 }}>
          All {minPhotos} photos captured. Add more below if this unit needs them.
        </Alert>
      ) : (
        <Box sx={{ mb: 1 }}>
          <Typography variant="body2" fontWeight={600}>
            Next: {currentLabel}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {currentHint}
          </Typography>
        </Box>
      )}

      {!isNative ? (
        // Web: the browser's capture input (camera on mobile web, chooser on
        // desktop). One shot at a time so the rider stays on the prompted angle.
        <Button
          component="label"
          variant={done ? "outlined" : "contained"}
          startIcon={<PhotoCameraIcon />}
          disabled={uploading || disabled}
          fullWidth
        >
          {done ? "Add another photo" : `Take ${currentLabel.toLowerCase()} photo`}
          <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => handleFiles(e.target.files)} />
        </Button>
      ) : (
        <Stack spacing={1}>
          {nativeCam !== false && (
            <Button
              variant={done ? "outlined" : "contained"}
              startIcon={<PhotoCameraIcon />}
              onClick={() => void takeNativePhotoOnce().then(append)}
              disabled={uploading || disabled || nativeCam === null}
              fullWidth
            >
              {done ? "Add another photo" : `Take ${currentLabel.toLowerCase()} photo`}
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
            <input type="file" accept="image/*" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
          </Button>
        </Stack>
      )}
    </Box>
  );
}
