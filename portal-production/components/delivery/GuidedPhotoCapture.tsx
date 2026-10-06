"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CloseIcon from "@mui/icons-material/Close";
import ReplayIcon from "@mui/icons-material/Replay";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { canUseInAppCamera, captureNativePhotos, chooseNativeGalleryPhotos } from "@/app/(field)/lib/nativeCamera";
import { compressImageBlob } from "@/app/(field)/lib/imageCompress";
import type { CapturedPhoto } from "./usePhotoUploader";

export type { CapturedPhoto };

/**
 * The reference angles for EQUIPMENT (walk-around order), each with an example
 * image in public/guide-angles. Guidance only: the rider is not walked through
 * them one by one and a photo is not tied to an angle. The keys are still
 * stamped positionally on the photos so the payload keeps its `angles` array
 * and a later return can pair shots the way it always has.
 */
const STEPS = [
  { key: "front", label: "Front", example: "/guide-angles/front.jpeg" },
  { key: "left", label: "Left", example: "/guide-angles/left.jpeg" },
  { key: "back", label: "Back", example: "/guide-angles/back.jpeg" },
  { key: "right", label: "Right", example: "/guide-angles/right.jpeg" },
] as const;

/** Ordered angle KEYS for the guided set, used to pair returns by angle. */
export const PHOTO_ANGLE_KEYS: readonly string[] = STEPS.map((s) => s.key);

/** Human label for a stored angle key (front -> Front); "" / extra -> "". */
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
  /** How many photos this unit needs (equipment 4, accessory 1). */
  minPhotos: number;
  onError?: (message: string) => void;
  /** true while any photo is still uploading: callers hold Continue on it. */
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
  /** Cap on photos (default MAX_PHOTOS). Service reports allow 12. */
  maxPhotos?: number;
  /** Section heading (default "Condition photos"). */
  title?: string;
  /** What the photos belong to, for the cap message (default "a unit"). */
  noun?: string;
  /** Return flow: the unit's OUTBOUND photos, shown as "How it went out". */
  comparison?: { photos: string[]; angles: string[] };
  /**
   * Per-photo damage (returns). Parallel arrays to `photos`: each added photo
   * gets a Damaged? answer and an optional comment.
   */
  damage?: {
    flags: boolean[];
    comments: string[];
    onChange: (flags: boolean[], comments: string[]) => void;
  };
}

/** A photo on its way to storage (or stuck there). Not in `photos` until it lands. */
interface Pending {
  id: string;
  previewUrl: string;
  /** The compressed blob once compression finished, kept for a retry. */
  blob: Blob | null;
  file: File;
  status: "uploading" | "failed";
}

const TILE = 96;
/** Most photos one unit can carry. Continue needs only `minPhotos`. */
export const MAX_PHOTOS = 8;

/**
 * Condition photos, fast: a reference strip of example angles, then "Take
 * photos" (the camera reopens after each shot until the minimum is met) or
 * "Choose from gallery" (multi-select). Past the minimum the rider may add more,
 * up to MAX_PHOTOS; a pick over the cap is trimmed with a note. Photos
 * upload in parallel with a per-photo state and retry; the caller's Continue
 * waits on onUploadingChange and `photos.length >= minPhotos`.
 *
 * The payload is unchanged: a flat photos[] of S3 keys, plus positional angle
 * keys for equipment (accessories carry none, as before).
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
  maxPhotos = MAX_PHOTOS,
  title = "Condition photos",
  noun = "a unit",
}: Props) {
  const isEquipment = minPhotos > 1;
  // Accessories get no example strip until a real accessory image exists.
  const examples = isEquipment ? STEPS : [];

  // Latest controlled values, so parallel uploads that land together each
  // append to the list the previous one produced rather than to a stale prop.
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const damageRef = useRef(damage);
  damageRef.current = damage;

  const [pending, setPending] = useState<Pending[]>([]);
  const [camMsg, setCamMsg] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  // Native shell: in-app camera / gallery unless a call has actually failed,
  // then the WebView <input> takes over (one tap more, but it works).
  const [inAppFailed, setInAppFailed] = useState(false);
  const [galleryFailed, setGalleryFailed] = useState(false);
  const inApp = canUseInAppCamera();
  const useNativeCamera = inApp && !inAppFailed;
  const useNativeGallery = inApp && !galleryFailed;

  const uploadingNow = pending.some((p) => p.status === "uploading");
  useEffect(() => {
    onUploadingChange?.(uploadingNow);
  }, [uploadingNow, onUploadingChange]);

  // Failed uploads hold their slot until retried or removed.
  const held = photos.length + pending.length;
  /** Still needed before Continue. */
  const remaining = Math.max(0, minPhotos - held);
  /** Still allowed under the cap. */
  const room = Math.max(0, maxPhotos - held);
  const done = photos.length >= minPhotos;
  const locked = disabled || capturing;

  // Equipment keeps positional angle keys (the payload's `angles`); accessories
  // never had any.
  const withAngles = (list: CapturedPhoto[]): CapturedPhoto[] =>
    isEquipment
      ? list.map((p, idx) => ({ ...p, angle: STEPS[idx]?.key ?? "" }))
      : list.map((p) => {
          const copy = { ...p };
          delete copy.angle;
          return copy;
        });

  const commit = (next: CapturedPhoto[]) => {
    photosRef.current = next;
    onChange(withAngles(next));
  };

  const appendPhoto = (photo: CapturedPhoto) => {
    commit([...photosRef.current, photo]);
    const d = damageRef.current;
    if (d) {
      const flags = [...d.flags, false];
      const comments = [...d.comments, ""];
      damageRef.current = { ...d, flags, comments };
      d.onChange(flags, comments);
    }
  };

  const runUpload = async (item: Pending) => {
    try {
      const blob = item.blob ?? (await compressImageBlob(item.file));
      setPending((ps) => ps.map((p) => (p.id === item.id ? { ...p, blob } : p)));
      const key = await upload(blob);
      if (!key) throw new Error("Upload failed");
      setPending((ps) => ps.filter((p) => p.id !== item.id));
      appendPhoto({ key, previewUrl: item.previewUrl });
    } catch (e: any) {
      setPending((ps) => ps.map((p) => (p.id === item.id ? { ...p, status: "failed" } : p)));
      onError?.(e?.message ? `A photo did not upload: ${e.message}` : "A photo did not upload. Tap retry on it.");
    }
  };

  const addFiles = (files: File[]) => {
    if (!files.length) return;
    onError?.("");
    const items: Pending[] = files.map((file, i) => ({
      id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      previewUrl: URL.createObjectURL(file),
      blob: null,
      file,
      status: "uploading",
    }));
    setPending((ps) => [...ps, ...items]);
    items.forEach((it) => void runUpload(it));
  };

  const retry = (id: string) => {
    const item = pending.find((p) => p.id === id);
    if (!item) return;
    const again = { ...item, status: "uploading" as const };
    setPending((ps) => ps.map((p) => (p.id === id ? again : p)));
    void runUpload(again);
  };

  const dropPending = (id: string) => setPending((ps) => ps.filter((p) => p.id !== id));

  const removePhoto = (index: number) => {
    commit(photosRef.current.filter((_, i) => i !== index));
    const d = damageRef.current;
    if (d) {
      const flags = d.flags.filter((_, i) => i !== index);
      const comments = d.comments.filter((_, i) => i !== index);
      damageRef.current = { ...d, flags, comments };
      d.onChange(flags, comments);
    }
  };

  const setDamage = (index: number, flag: boolean, comment: string) => {
    const d = damageRef.current;
    if (!d) return;
    const flags = [...d.flags];
    const comments = [...d.comments];
    flags[index] = flag;
    comments[index] = comment;
    damageRef.current = { ...d, flags, comments };
    d.onChange(flags, comments);
  };

  /** Keep at most what fits under the cap; say so when a pick was trimmed. */
  const takeNeeded = (files: File[]) => {
    const fits = Math.max(0, maxPhotos - photosRef.current.length - pending.length);
    if (files.length > fits) {
      const who = noun.charAt(0).toUpperCase() + noun.slice(1);
      setInfo(`${who} can have up to ${maxPhotos} photos, so the first ${fits} ${fits === 1 ? "was" : "were"} added.`);
    } else setInfo(null);
    return files.slice(0, fits);
  };

  // Native camera: reopens after every shot until the minimum is met (past the
  // minimum, one shot per tap). Backing out ends the run and keeps what was
  // taken. Each shot starts uploading as soon as it is taken.
  const takeNative = async () => {
    setCamMsg(null);
    setInfo(null);
    setCapturing(true);
    try {
      await captureNativePhotos({ max: Math.min(room, Math.max(remaining, 1)), onShot: (f) => addFiles([f]) });
    } catch {
      setInAppFailed(true);
      setCamMsg("Switched to the device camera. Tap Take photos again.");
    } finally {
      setCapturing(false);
    }
  };

  const chooseNative = async () => {
    setCamMsg(null);
    setCapturing(true);
    try {
      addFiles(takeNeeded(await chooseNativeGalleryPhotos(room)));
    } catch {
      setGalleryFailed(true);
      setCamMsg("Switched to the phone's file picker. Tap Choose from gallery again.");
    } finally {
      setCapturing(false);
    }
  };

  const onInputFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = ""; // the same file can be picked again after a remove
    addFiles(takeNeeded(list));
  };

  const takeLabel = held === 0 ? "Take photos" : remaining > 0 ? `Take photo ${held + 1} of ${minPhotos}` : "Add another photo";

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle2">
          {minPhotos > 0
            ? `${title} (${photos.length < minPhotos ? `${photos.length} of ${minPhotos}` : `${photos.length} added`})`
            : `${title}${photos.length ? ` (${photos.length} added)` : ""}`}
        </Typography>
        {uploadingNow && <CircularProgress size={16} />}
        {done && !uploadingNow && <CheckCircleIcon color="success" fontSize="small" />}
      </Stack>

      {/* Reference strip: what a good set covers. Not enforced, not slots. */}
      {examples.length > 0 && (
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
          Try to cover these angles
        </Typography>
        <Stack direction="row" spacing={1} sx={{ overflowX: "auto", pb: 0.5 }}>
          {examples.map((s) => (
            <Box key={s.key} sx={{ flexShrink: 0, width: 72, textAlign: "center" }}>
              <Box
                component="img"
                src={s.example}
                alt={`${s.label} example`}
                sx={{ display: "block", width: 72, height: 54, objectFit: "cover", borderRadius: 1, border: "1px solid", borderColor: "divider" }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.7rem" }}>
                {s.label}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Box>
      )}

      {/* Return: how the unit went out, for comparison (tap to enlarge). */}
      {comparison && comparison.photos.length > 0 && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
            How it went out (tap to enlarge)
          </Typography>
          <Stack direction="row" spacing={1} sx={{ overflowX: "auto", pb: 0.5 }}>
            {comparison.photos.map((src, i) => (
              <Box
                key={i}
                component="img"
                src={src}
                alt=""
                onClick={() => setViewerSrc(src)}
                sx={{ width: 72, height: 72, flexShrink: 0, borderRadius: 1, objectFit: "cover", border: "1px solid", borderColor: "divider", cursor: "pointer" }}
              />
            ))}
          </Stack>
        </Box>
      )}

      {/* Added photos, then the ones still uploading or failed. */}
      {(photos.length > 0 || pending.length > 0) && (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fill, minmax(${TILE}px, 1fr))`,
            gap: 1,
            mb: 1.5,
          }}
        >
          {photos.map((p, idx) => (
            <Box key={p.key} sx={{ position: "relative", aspectRatio: "1 / 1" }}>
              <Box
                component="img"
                src={p.previewUrl}
                alt={`Photo ${idx + 1}`}
                onClick={() => setViewerSrc(p.previewUrl)}
                sx={{ width: "100%", height: "100%", borderRadius: 1, objectFit: "cover", display: "block", cursor: "pointer" }}
              />
              <IconButton
                size="small"
                aria-label={`Remove photo ${idx + 1}`}
                onClick={() => removePhoto(idx)}
                disabled={locked}
                sx={{ position: "absolute", top: 4, right: 4, p: 0.25, bgcolor: "rgba(0,0,0,0.6)", color: "#fff", "&:hover": { bgcolor: "rgba(0,0,0,0.75)" } }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
              <Box sx={{ position: "absolute", bottom: 4, left: 4, px: 0.75, borderRadius: 1, bgcolor: "rgba(0,0,0,0.6)", color: "#fff", fontSize: "0.7rem", fontWeight: 600 }}>
                Photo {idx + 1}
              </Box>
              {damage?.flags[idx] && (
                <Box sx={{ position: "absolute", top: 4, left: 4, px: 0.75, borderRadius: 1, bgcolor: "error.main", color: "#fff", fontSize: "0.65rem", fontWeight: 700 }}>
                  Damaged
                </Box>
              )}
            </Box>
          ))}
          {pending.map((p) => (
            <Box key={p.id} sx={{ position: "relative", aspectRatio: "1 / 1" }}>
              <Box
                component="img"
                src={p.previewUrl}
                alt=""
                sx={{ width: "100%", height: "100%", borderRadius: 1, objectFit: "cover", display: "block", opacity: 0.45 }}
              />
              <Box sx={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 0.5 }}>
                {p.status === "uploading" ? (
                  <>
                    <CircularProgress size={22} />
                    <Typography variant="caption" sx={{ fontWeight: 700, color: "text.primary" }}>Uploading</Typography>
                  </>
                ) : (
                  <>
                    <ErrorOutlineIcon color="error" fontSize="small" />
                    <Button size="small" variant="contained" color="error" startIcon={<ReplayIcon />} onClick={() => retry(p.id)} sx={{ py: 0, minHeight: 28 }}>
                      Retry
                    </Button>
                  </>
                )}
              </Box>
              {p.status === "failed" && (
                <IconButton
                  size="small"
                  aria-label="Remove failed photo"
                  onClick={() => dropPending(p.id)}
                  sx={{ position: "absolute", top: 4, right: 4, p: 0.25, bgcolor: "rgba(0,0,0,0.6)", color: "#fff", "&:hover": { bgcolor: "rgba(0,0,0,0.75)" } }}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              )}
            </Box>
          ))}
        </Box>
      )}

      {/* Return: a Damaged? answer per added photo (parallel to photos[]). */}
      {damage && photos.length > 0 && (
        <Stack spacing={1.5} sx={{ mb: 1.5 }}>
          {photos.map((p, idx) => {
            const flag = damage.flags[idx] ?? false;
            const comment = damage.comments[idx] ?? "";
            return (
              <Box key={p.key} sx={{ display: "flex", gap: 1.5, p: 1, borderRadius: 1, bgcolor: "action.hover" }}>
                <Box component="img" src={p.previewUrl} alt="" sx={{ width: 56, height: 56, borderRadius: 1, objectFit: "cover", flexShrink: 0 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography variant="body2" fontWeight={600} sx={{ mr: "auto" }}>
                      Photo {idx + 1}: damaged?
                    </Typography>
                    <Button size="small" variant={flag ? "contained" : "outlined"} color={flag ? "error" : "primary"} onClick={() => setDamage(idx, true, comment)} disabled={locked}>
                      Yes
                    </Button>
                    <Button size="small" variant={!flag ? "contained" : "outlined"} onClick={() => setDamage(idx, false, comment)} disabled={locked}>
                      No
                    </Button>
                  </Stack>
                  <TextField
                    placeholder="Comment (optional)"
                    value={comment}
                    onChange={(e) => setDamage(idx, flag, e.target.value)}
                    disabled={locked}
                    size="small"
                    fullWidth
                    sx={{ mt: 0.75 }}
                  />
                </Box>
              </Box>
            );
          })}
        </Stack>
      )}

      {camMsg && (
        <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setCamMsg(null)}>
          {camMsg}
        </Alert>
      )}
      {info && (
        <Alert severity="info" sx={{ mb: 1 }} onClose={() => setInfo(null)}>
          {info}
        </Alert>
      )}

      {done && photos.length > 0 && (
        <Alert severity="success" sx={{ mb: 1 }}>
          {room === 0
            ? `${maxPhotos} photos added, the most ${noun} can have. Remove one to replace it.`
            : `${photos.length} ${photos.length === 1 ? "photo" : "photos"} added. You can add more, up to ${maxPhotos}.`}
        </Alert>
      )}
      {!done && remaining === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {pending.some((p) => p.status === "failed") ? "Retry or remove the failed photo to continue." : "Uploading, one moment."}
        </Typography>
      )}
      {room > 0 && (
        <Stack spacing={1}>
          {useNativeCamera ? (
            <Button variant={done ? "outlined" : "contained"} startIcon={capturing ? <CircularProgress size={18} color="inherit" /> : <PhotoCameraIcon />} onClick={() => void takeNative()} disabled={locked} fullWidth sx={{ minHeight: 48 }}>
              {takeLabel}
            </Button>
          ) : (
            // Browser (or a native shell whose camera call failed): the device
            // camera through <input capture>. A page cannot reopen the camera by
            // itself, so each further shot is one tap on this button.
            <Button component="label" variant={done ? "outlined" : "contained"} startIcon={<PhotoCameraIcon />} disabled={locked} fullWidth sx={{ minHeight: 48 }}>
              {takeLabel}
              <input type="file" accept="image/*" capture="environment" hidden onChange={onInputFiles} />
            </Button>
          )}
          {useNativeGallery ? (
            <Button variant="outlined" startIcon={<AddPhotoAlternateIcon />} onClick={() => void chooseNative()} disabled={locked} fullWidth sx={{ minHeight: 48 }}>
              Choose from gallery
            </Button>
          ) : (
            <Button component="label" variant="outlined" startIcon={<AddPhotoAlternateIcon />} disabled={locked} fullWidth sx={{ minHeight: 48 }}>
              Choose from gallery
              <input type="file" accept="image/*" multiple={room > 1} hidden onChange={onInputFiles} />
            </Button>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center" }}>
            {remaining > 0
              ? `${remaining} more ${remaining === 1 ? "photo" : "photos"} needed`
              : `Optional, ${room} more allowed`}
          </Typography>
        </Stack>
      )}

      {/* Fullscreen viewer: a black overflow-auto box so the phone can pinch-zoom. */}
      <Dialog open={!!viewerSrc} onClose={() => setViewerSrc(null)} fullScreen>
        <Box sx={{ display: "flex", alignItems: "center", p: 1 }}>
          <IconButton onClick={() => setViewerSrc(null)} aria-label="Close photo">
            <CloseIcon />
          </IconButton>
        </Box>
        {viewerSrc && (
          <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "common.black", overflow: "auto" }}>
            <Box component="img" src={viewerSrc} alt="" sx={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
          </Box>
        )}
      </Dialog>
    </Box>
  );
}
