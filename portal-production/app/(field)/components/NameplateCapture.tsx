"use client";

import React, { useRef, useState } from "react";
import { Alert, Button, CircularProgress } from "@mui/material";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { canUseInAppCamera, captureNativePhoto } from "../lib/nativeCamera";
import { compressImageDataUrl } from "../lib/imageCompress";

/**
 * "Scan nameplate" — photograph an equipment label, have Claude read the model
 * and serial off it, and hand the serial back to the caller.
 *
 * Extracted from /scan/manual so the mid-run scan dialog can reuse it verbatim
 * instead of growing a second copy of the camera + extract + error handling.
 *
 * DELIBERATELY OWNS ONLY THE READ. It never resolves, navigates or mutates:
 * what happens to an extracted serial differs per surface (/scan/manual routes
 * to the unit page; the mid-run dialog adds to the open run), so the caller
 * keeps that. This component's whole contract is "here is a serial I read".
 *
 * It also never auto-advances. The rider still taps to resolve — that tap is
 * where a misread gets caught, and the resolver's nearMatches typo-guard exists
 * precisely because these serials arrive from a camera.
 *
 * Endpoint: POST /assets/manual-entry/extract-label, which carries
 * `field-scan:access` (the field permission a rider's token has) rather than
 * the bind permission its /assets/extract-label twin requires.
 */

interface Props {
  /** Called with the serial read off the plate. Never called with an empty string. */
  onSerial: (serial: string) => void;
  /**
   * Optional: the model text, when the plate carried one. /scan/manual uses it
   * to preselect the asset; the mid-run dialog has no asset picker and omits it.
   */
  onModel?: (model: string) => void;
  /** Caller-owned error surface (so each page keeps its own placement). */
  onError?: (message: string | null) => void;
  disabled?: boolean;
  sx?: object;
}

export default function NameplateCapture({ onSerial, onModel, onError, disabled, sx }: Props) {
  const { getToken } = useAuth();
  const cameraRef = useRef<HTMLInputElement>(null);
  const [extracting, setExtracting] = useState(false);
  const [readSummary, setReadSummary] = useState<string | null>(null);
  const [plateFailed, setPlateFailed] = useState(false);

  const extractPlate = async (source: File | string) => {
    setExtracting(true);
    setPlateFailed(false);
    setReadSummary(null);
    onError?.(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      // Compress every source (off the main thread) before the AI call — the
      // native Sunmi camera hands back raw 8 MP frames despite takePhoto's resize.
      const image = await compressImageDataUrl(source);
      const res = await request(
        { path: "/assets/manual-entry/extract-label", method: "POST", timeout: 120000 },
        { image },
        token,
      );
      const payload = res?.data ?? res;
      const model = typeof payload?.model === "string" && payload.model.trim() ? payload.model.trim() : null;
      const serialRead =
        typeof payload?.serial === "string" && payload.serial.trim() ? payload.serial.trim() : null;

      // Nothing legible at all → the caller's field stays empty and the rider types.
      if (!model && !serialRead) {
        setPlateFailed(true);
        return;
      }
      if (serialRead) onSerial(serialRead);
      if (model) onModel?.(model);
      // A model-only read is a PARTIAL success, not a failure: it tells the rider
      // the photo worked and only the serial line was unreadable, so the message
      // asks for the serial rather than another photo.
      setReadSummary(
        serialRead
          ? `Read: ${serialRead}${model ? ` (${model})` : ""}`
          : `Read model ${model} — enter the serial manually.`,
      );
    } catch {
      setPlateFailed(true);
    } finally {
      setExtracting(false);
    }
  };

  const onPlatePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (cameraRef.current) cameraRef.current.value = ""; // allow re-picking the same file
    if (file) void extractPlate(file);
  };

  // In-app camera on native (works on devices with no external camera app);
  // fall back to the file input on web, or when the camera itself fails.
  const onScanPlate = async () => {
    setPlateFailed(false);
    if (canUseInAppCamera()) {
      try {
        const file = await captureNativePhoto();
        if (file) void extractPlate(file);
        return;
      } catch {
        setPlateFailed(true); // camera unavailable — let them pick a photo instead
      }
    }
    cameraRef.current?.click();
  };

  return (
    <>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={onPlatePhoto}
      />
      <Button
        variant="outlined"
        fullWidth
        startIcon={extracting ? <CircularProgress size={18} /> : <PhotoCameraIcon />}
        disabled={disabled || extracting}
        onClick={() => void onScanPlate()}
        sx={{ py: 1.5, fontSize: "1rem", minHeight: 48, ...sx }}
      >
        {extracting ? "Reading plate…" : "Scan nameplate"}
      </Button>
      {readSummary && <Alert severity="success">{readSummary}</Alert>}
      {plateFailed && (
        <Alert severity="warning">Couldn&apos;t read the plate — enter the serial manually.</Alert>
      )}
    </>
  );
}
