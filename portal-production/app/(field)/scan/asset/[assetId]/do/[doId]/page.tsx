"use client";

import React, { useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Box, Button, IconButton, ImageList, ImageListItem, Stack, TextField, Typography, CircularProgress, Alert } from "@mui/material";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import DeleteIcon from "@mui/icons-material/Delete";
import { request } from "@/helpers/request";
import { uploadImage } from "@/helpers/imageUploader";

interface UploadedPhoto {
  key: string;
  previewUrl: string;
}

// Phone-camera JPEGs run 4–8 MB. Resize to 1280px wide at JPEG q0.7 — typically
// ~200–400 KB — before the multipart upload, otherwise the S3 PUT is painfully
// slow on field LTE and the office gets oversized assets it never zooms into.
//
// Uses canvas.toBlob() rather than canvas.toDataURL() + fetch(dataUrl).blob():
// the round-trip via fetch() on a data URL produces a Blob with an empty
// `.type` in the Capacitor Android WebView, which downstream uploadImage maps
// to a ".unknown" extension and the backend silently drops. toBlob guarantees
// the type we asked for.
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
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

// Best-effort one-shot GPS fix for the acknowledgement point. The DO_START
// flow streams continuous pings via the Capgo background plugin; here we only
// need a single coordinate at the moment of acknowledgement, so the
// web-standard navigator.geolocation is the right tool (works in the Capacitor
// Android WebView and needs no native plugin).
//
// Resolves to null on ANY failure — permission denied, no signal, timeout, or
// the API being unavailable — so acknowledgement is never blocked by GPS. The
// site call is best-effort; latitude/longitude may persist blank.
const capturePosition = (): Promise<{ latitude: number; longitude: number } | null> =>
  new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });

/**
 * Acknowledge Delivery — second step of the two-step delivery flow. Enabled
 * only when a DO_START MSR exists for this DO and no DO_ACK has been
 * submitted yet (see canAckDelivery in getScanContext).
 *
 * For v1 we record this as a MaintenanceServiceReport with kind=DO_ACK and a
 * backend stores it against the asset and the existing report list shows it.
 */
export default function DeliveryOrderAckPage() {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const { getToken } = useAuth();
  const assetId = params?.assetId as string;
  const doId = params?.doId as string;
  const inventoryId = search?.get("inventoryId") ?? null;
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const newPhotos: UploadedPhoto[] = [];
      for (const file of Array.from(files)) {
        const originalDataUrl = await fileToDataUrl(file);
        const compressedBlob = await compressImageToBlob(originalDataUrl);
        const key = await uploadImage({ blob: compressedBlob, folderName: "do-ack", token });
        if (key) newPhotos.push({ key, previewUrl: URL.createObjectURL(compressedBlob) });
      }
      setPhotos((prev) => [...prev, ...newPhotos]);
    } catch (e: any) {
      setError(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const continueToSign = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      // Description now holds just the technician's notes; the activity kind
      // is discriminated by MSR.kind = DO_ACK rather than a description prefix.
      // Fallback string when no notes are entered so the row isn't blank in
      // the office-side Field Reports view.
      const description = notes.trim() || "Delivery acknowledged";
      // Capture a one-shot GPS fix for the acknowledgement point so the
      // coordinates persist on the MSR (the WaterSgService later forwards them
      // to water-sg). Best-effort only: capturePosition resolves null on
      // denial / no signal / timeout, in which case latitude/longitude are
      // simply omitted and the acknowledgement proceeds unblocked.
      setLocating(true);
      const coords = await capturePosition();
      setLocating(false);
      const res = await request(
        { path: "/maintenance-reports", method: "POST" },
        {
          assetId,
          ...(inventoryId ? { inventoryId } : {}),
          description,
          photos: photos.map((p) => p.key),
          kind: "DO_ACK",
          documentId: doId,
          ...(coords ? { latitude: coords.latitude, longitude: coords.longitude } : {}),
        },
        token,
      );
      const reportId = res.data?.id ?? res.id;
      if (!reportId) throw new Error("No report id returned");
      // Forward inventoryId so sign → done → "Back to this asset" keeps the
      // full scan context (the action chooser needs it to resolve the DO).
      const invQuery = inventoryId ? `&inventoryId=${encodeURIComponent(inventoryId)}` : "";
      router.push(`/scan/asset/${assetId}/sign?reportId=${reportId}&kind=do${invQuery}`);
    } catch (e: any) {
      setError(e?.message ?? "Failed to save acknowledgement");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 3 }}>
      <Typography variant="h6" fontWeight={700}>Acknowledge Delivery</Typography>
      <Typography variant="body2" color="text.secondary">DO {doId}</Typography>

      <TextField
        label="Notes (optional)"
        placeholder="Any condition issues or remarks at delivery"
        multiline
        minRows={3}
        fullWidth
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      <Box>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <Typography variant="subtitle2">Proof of delivery ({photos.length})</Typography>
          {uploading && <CircularProgress size={16} />}
        </Stack>

        {photos.length > 0 && (
          <ImageList cols={3} gap={8} sx={{ mb: 2 }}>
            {photos.map((p, idx) => (
              <ImageListItem key={p.key} sx={{ position: "relative" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.previewUrl} alt="" style={{ borderRadius: 4, objectFit: "cover", aspectRatio: "1/1" }} />
                <IconButton
                  size="small"
                  onClick={() => removePhoto(idx)}
                  sx={{ position: "absolute", top: 4, right: 4, bgcolor: "rgba(0,0,0,0.6)", color: "white" }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </ImageListItem>
            ))}
          </ImageList>
        )}

        <Button component="label" variant="outlined" startIcon={<AddPhotoAlternateIcon />} disabled={uploading} fullWidth>
          Add photos
          <input type="file" accept="image/*" multiple capture="environment" hidden onChange={(e) => handleFiles(e.target.files)} />
        </Button>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}

      <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
        <Button variant="outlined" onClick={() => router.back()} fullWidth>Back</Button>
        <Button
          variant="contained"
          onClick={continueToSign}
          disabled={submitting || uploading}
          fullWidth
          sx={{ py: 1.5, px: 4, fontSize: "1rem", minHeight: 48 }}
        >
          {submitting ? (locating ? "Getting location…" : "Saving...") : "Continue to signature"}
        </Button>
      </Stack>
    </Box>
  );
}
