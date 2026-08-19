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

/** Ordered angle KEYS for the guided set — used to pair returns by angle. */
export const PHOTO_ANGLE_KEYS: readonly string[] = STEPS.map((s) => s.key);

/** Human label for a stored angle key (front → Front); "" / extra → "". */
export function angleLabel(key: string | undefined): string {
  if (!key) return "";
  const step = STEPS.find((s) => s.key === key);
  return step ? step.label : "";
}

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
  /**
   * Return flow (#2): the unit's OUTBOUND condition photos + parallel angle
   * labels. When set, capture becomes strictly one-angle-at-a-time WITH a review
   * step — after each shot the rider sees it beside the matching outbound angle,
   * then advances. Angle-matched when `angles` line up; otherwise index-paired
   * with the full outbound strip and a "not a guaranteed angle match" caption.
   */
  comparison?: { photos: string[]; angles: string[] };
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
  comparison,
}: Props) {
  const { uploading, captureMode, camMsg, setCamMsg, ingestFiles, takeNativePhotoOnce } =
    usePhotoUploader({ upload, onError, onUploadingChange });

  // Comparison (return) mode: after each capture the rider reviews the shot
  // beside its outbound angle before advancing. `reviewing` gates that step.
  const comparisonMode = !!comparison;
  const [reviewing, setReviewing] = useState(false);
  // Does the outbound set carry angle labels? (Units captured before angle-
  // labelling shipped won't — then we fall back to index pairing + full strip.)
  const outboundHasAngles = !!comparison?.angles?.some((a) => a);

  // The outbound reference photo for the unit's angle at position `idx`:
  // angle-matched when labels exist, else the same index (best-effort).
  const outboundFor = (
    idx: number,
  ): { src: string; matched: boolean } | null => {
    if (!comparison) return null;
    const key = STEPS[idx]?.key;
    if (outboundHasAngles && key) {
      const at = comparison.angles.findIndex((a) => a === key);
      if (at >= 0 && comparison.photos[at]) return { src: comparison.photos[at], matched: true };
    }
    if (comparison.photos[idx]) return { src: comparison.photos[idx], matched: false };
    return null;
  };

  // STRICTLY SEQUENTIAL: the angle being asked for is derived from how many
  // photos exist, so there is no separate cursor to drift out of sync. Deleting
  // a photo shortens the list and therefore steps the prompt back to that angle
  // on its own.
  const totalSlots = Math.max(STEPS.length, minPhotos);
  const stepIndex = Math.min(photos.length, totalSlots - 1);
  const current = STEPS[stepIndex];
  const currentLabel = current?.label ?? `Additional angle ${stepIndex - STEPS.length + 1}`;
  const currentHint =
    current?.hint ?? "Any angle that shows the unit's condition, for example a serial plate or existing damage.";
  const done = photos.length >= minPhotos;

  // Re-stamp every photo's angle by its CURRENT position so the stored labels
  // always match the thumbnail captions below (which read STEPS[idx]). Positional
  // is exactly right for this strictly-sequential capture; deleting a photo
  // shifts the rest and re-labels them here on the next onChange.
  const withAngles = (list: CapturedPhoto[]): CapturedPhoto[] =>
    list.map((p, idx) => ({ ...p, angle: STEPS[idx]?.key ?? "" }));

  const append = (captured: CapturedPhoto[]) => {
    if (captured.length === 0) return;
    onChange(withAngles([...photos, ...captured]));
    // Return mode: drop into the side-by-side review of the shot just taken.
    if (comparisonMode) setReviewing(true);
  };

  // Review controls (comparison mode only).
  const retakeLast = () => {
    onChange(withAngles(photos.slice(0, -1)));
    setReviewing(false);
  };
  const advanceReview = () => setReviewing(false);

  // One shot per step: only ever take the FIRST file so a multi-select cannot
  // skip past an angle the rider has not actually photographed.
  const handleFiles = (files: FileList | null) => {
    const one = files && files[0] ? [files[0]] : [];
    if (one.length) void ingestFiles(one).then(append);
  };

  const removePhoto = (index: number) => {
    onChange(withAngles(photos.filter((_, i) => i !== index)));
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
        {comparisonMode
          ? "Capture each angle, then compare it to how the unit went out."
          : "This is equipment, so it needs a set of angles before it leaves."}
      </Typography>

      {/* ONE angle at a time. The full set is deliberately NOT listed: the
          rider is asked for a single named shot, takes it, and the prompt
          advances. In comparison mode the outbound reference for THIS angle
          sits beside the prompt so the rider frames the same shot. */}
      {!done && !(comparisonMode && reviewing) && (
        <Box sx={{ mb: 1.5, p: 1.5, borderRadius: 1, bgcolor: "action.hover" }}>
          <Typography variant="overline" color="text.secondary" sx={{ display: "block", lineHeight: 1.4 }}>
            Photo {photos.length + 1} of {minPhotos}
          </Typography>
          <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.3 }}>
            {currentLabel}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {currentHint}
          </Typography>
          {comparisonMode && (() => {
            const ref = outboundFor(stepIndex);
            if (!ref) return null;
            return (
              <Box sx={{ mt: 1.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                  {ref.matched ? `Delivered ${currentLabel}` : "Delivered (angle not guaranteed)"}
                </Typography>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={ref.src}
                  alt=""
                  style={{ width: 120, height: 120, borderRadius: 4, objectFit: "cover" }}
                />
              </Box>
            );
          })()}
        </Box>
      )}

      {/* Comparison review: the shot just taken beside the outbound same angle. */}
      {comparisonMode && reviewing && photos.length > 0 && (() => {
        const idx = photos.length - 1;
        const ref = outboundFor(idx);
        const label = STEPS[idx]?.label ?? `Extra ${idx - STEPS.length + 1}`;
        const last = photos[idx];
        const isLastAngle = photos.length >= minPhotos;
        return (
          <Box sx={{ mb: 2, p: 1.5, borderRadius: 1, bgcolor: "action.hover" }}>
            <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.3, mb: 1 }}>
              {label}: compare
            </Typography>
            <Stack direction="row" spacing={1.5}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                  {ref ? (ref.matched ? "Delivered" : "Delivered (angle not guaranteed)") : "No delivered photo"}
                </Typography>
                {ref ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={ref.src}
                    alt=""
                    style={{ width: "100%", aspectRatio: "1 / 1", borderRadius: 4, objectFit: "cover" }}
                  />
                ) : (
                  <Box
                    sx={{
                      width: "100%",
                      aspectRatio: "1 / 1",
                      borderRadius: 1,
                      bgcolor: "action.disabledBackground",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Typography variant="caption" color="text.secondary">None on file</Typography>
                  </Box>
                )}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                  Returning
                </Typography>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={last.previewUrl}
                  alt=""
                  style={{ width: "100%", aspectRatio: "1 / 1", borderRadius: 4, objectFit: "cover" }}
                />
              </Box>
            </Stack>
            {/* Legacy outbound (no angle labels): the paired shot is a best-effort
                index match, so also show the whole outbound set for the rider to
                eyeball the right angle. */}
            {!outboundHasAngles && comparison && comparison.photos.length > 0 && (
              <Box sx={{ mt: 1.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                  Full outbound set (not a guaranteed angle match)
                </Typography>
                <Stack direction="row" spacing={1} sx={{ overflowX: "auto", pb: 1 }}>
                  {comparison.photos.map((src, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={src}
                      alt=""
                      style={{ width: 64, height: 64, flexShrink: 0, borderRadius: 4, objectFit: "cover" }}
                    />
                  ))}
                </Stack>
              </Box>
            )}
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              <Button variant="outlined" onClick={retakeLast} disabled={uploading || disabled} fullWidth>
                Retake
              </Button>
              <Button variant="contained" onClick={advanceReview} disabled={uploading || disabled} fullWidth>
                {isLastAngle ? "Done" : "Next angle"}
              </Button>
            </Stack>
          </Box>
        );
      })()}

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

      {done && !(comparisonMode && reviewing) && (
        <Alert severity="success" sx={{ mb: 1 }}>
          All {minPhotos} photos captured. Add more below if this unit needs them.
        </Alert>
      )}

      {/* Capture buttons hidden during the comparison review (Retake / Next own
          that step). */}
      {!(comparisonMode && reviewing) && (
      <Stack spacing={1}>
        {captureMode === "inapp" ? (
          // Native shell, in-app CameraX: the Sunmi's only working path.
          <Button
            variant={done ? "outlined" : "contained"}
            startIcon={<PhotoCameraIcon />}
            onClick={() => void takeNativePhotoOnce().then(append)}
            disabled={uploading || disabled}
            fullWidth
          >
            {done ? "Add another photo" : `Take ${currentLabel.toLowerCase()} photo`}
          </Button>
        ) : (
          // Web, or a native shell whose in-app camera failed: the device
          // camera via <input capture>. One shot so the rider stays on the
          // prompted angle.
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
        )}
        <Button
          component="label"
          variant="outlined"
          startIcon={<AddPhotoAlternateIcon />}
          disabled={uploading || disabled}
          fullWidth
        >
          Choose from gallery
          <input type="file" accept="image/*" hidden onChange={(e) => handleFiles(e.target.files)} />
        </Button>
      </Stack>
      )}
    </Box>
  );
}
