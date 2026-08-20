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
  TextField,
  Typography,
} from "@mui/material";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteIcon from "@mui/icons-material/Delete";
import { usePhotoUploader, type CapturedPhoto } from "./usePhotoUploader";

export type { CapturedPhoto };

/**
 * The angles an equipment unit is walked through, in WALK-AROUND order (5 for
 * equipment: Front, Left, Back, Right, Top — a continuous loop around the unit
 * rather than front/back/side hopping). These match the equipment minimum, so
 * every named slot is required; anything past them is an extra angle the rider
 * chooses. Each has an `example` placeholder image (public/guide-angles) shown
 * under the prompt — swap those files for real reference photos anytime.
 */
const STEPS = [
  { key: "front", label: "Front", hint: "Face the unit head on, whole unit in frame.", example: "/guide-angles/front.svg" },
  { key: "left", label: "Left", hint: "Step to the left side and shoot it square on.", example: "/guide-angles/left.svg" },
  { key: "back", label: "Back", hint: "Walk around and shoot the rear panel.", example: "/guide-angles/back.svg" },
  { key: "right", label: "Right", hint: "Step to the right side and shoot it square on.", example: "/guide-angles/right.svg" },
  { key: "top", label: "Top", hint: "Shoot from above so the top surface is visible.", example: "/guide-angles/top.svg" },
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
  /**
   * Per-photo damage (returns). When set, each shot is followed by a
   * "Damaged?" answer plus an optional comment before the rider advances, so
   * five angles produce five answers. Parallel arrays to `photos`, mirroring
   * how the angle labels travel; photos[] itself is never reshaped.
   */
  damage?: {
    flags: boolean[];
    comments: string[];
    onChange: (flags: boolean[], comments: string[]) => void;
  };
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
  damage,
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
    // Grow the damage arrays in step so index N always describes photo N.
    if (damage) {
      damage.onChange(
        [...damage.flags, ...captured.map(() => false)],
        [...damage.comments, ...captured.map(() => "")],
      );
    }
    // Return mode: drop into the side-by-side review of the shot just taken.
    if (comparisonMode) setReviewing(true);
  };

  // The answer for the shot under review (always the last one taken).
  const lastIndex = photos.length - 1;
  const lastDamaged = damage?.flags[lastIndex] ?? false;
  const lastComment = damage?.comments[lastIndex] ?? "";
  const setLastDamage = (flag: boolean, comment: string) => {
    if (!damage || lastIndex < 0) return;
    const flags = [...damage.flags];
    const comments = [...damage.comments];
    flags[lastIndex] = flag;
    comments[lastIndex] = comment;
    damage.onChange(flags, comments);
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
    // Drop the matching answer so the arrays stay index-aligned with photos[].
    if (damage) {
      damage.onChange(
        damage.flags.filter((_, i) => i !== index),
        damage.comments.filter((_, i) => i !== index),
      );
    }
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

      {/* ONE angle at a time. The full set is deliberately NOT listed: the rider
          is asked for a single named shot, takes it, and the prompt advances. The
          prompt is identical outbound and on a return (angle + example only); the
          delivered comparison appears in the review AFTER the shot, not here. */}
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
        </Box>
      )}

      {/* (#4b) Large example photo for the current angle, directly under the
          "Photo N of M" prompt and above the Take/Choose buttons, so the rider
          frames the same shot. Shown for BOTH outbound and return capture (hidden
          only during the return review, where the delivered comparison takes
          over). Static placeholders live in public/guide-angles. */}
      {!done && !(comparisonMode && reviewing) && current?.example && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
            Example: {currentLabel}
          </Typography>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current.example}
            alt={`${currentLabel} example`}
            style={{
              display: "block",
              width: "100%",
              maxWidth: 360,
              aspectRatio: "4 / 3",
              objectFit: "cover",
              borderRadius: 8,
              border: "1px solid rgba(0,0,0,0.12)",
            }}
          />
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
            {/* Stacked comparison: the DELIVERED photo on top, the RETURNING one
                directly below it, so the rider reads the same angle top-to-bottom.
                Per-angle pairing is unchanged (angle-labelled units pair exactly;
                older units fall back to index-pairing). */}
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                {ref ? (ref.matched ? "Delivered" : "Delivered (angle not guaranteed)") : "No delivered photo"}
              </Typography>
              {ref ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={ref.src}
                  alt=""
                  style={{ display: "block", width: "100%", maxWidth: 260, aspectRatio: "1 / 1", borderRadius: 4, objectFit: "cover" }}
                />
              ) : (
                <Box
                  sx={{
                    width: "100%",
                    maxWidth: 260,
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
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1, mb: 0.5 }}>
                Returning
              </Typography>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={last.previewUrl}
                alt=""
                style={{ display: "block", width: "100%", maxWidth: 260, aspectRatio: "1 / 1", borderRadius: 4, objectFit: "cover" }}
              />
            </Box>
            {damage && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  Damaged?
                </Typography>
                <Stack direction="row" spacing={1}>
                  <Button
                    variant={lastDamaged ? "contained" : "outlined"}
                    color={lastDamaged ? "error" : "primary"}
                    onClick={() => setLastDamage(true, lastComment)}
                    disabled={uploading || disabled}
                    fullWidth
                    sx={{ minHeight: 44 }}
                  >
                    Yes
                  </Button>
                  <Button
                    variant={!lastDamaged ? "contained" : "outlined"}
                    onClick={() => setLastDamage(false, lastComment)}
                    disabled={uploading || disabled}
                    fullWidth
                    sx={{ minHeight: 44 }}
                  >
                    No
                  </Button>
                </Stack>
                <TextField
                  label="Comment (optional)"
                  placeholder="Note anything visible on this angle"
                  value={lastComment}
                  onChange={(e) => setLastDamage(lastDamaged, e.target.value)}
                  disabled={uploading || disabled}
                  fullWidth
                  multiline
                  minRows={2}
                  size="small"
                  sx={{ mt: 1.5 }}
                />
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
