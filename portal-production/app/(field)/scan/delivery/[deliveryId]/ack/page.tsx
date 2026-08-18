"use client";

import React, { useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, Stack, TextField, Typography } from "@mui/material";
import { request } from "@/helpers/request";
import { uploadImage } from "@/helpers/imageUploader";
import { capturePosition } from "@/helpers/geolocation";
import PhotoCaptureField, { CapturedPhoto } from "@/components/delivery/PhotoCaptureField";

/**
 * Acknowledge Delivery — ACK-CAPTURE step of the reordered standalone flow:
 *   ack (GPS + photos, MSR created as DRAFT) → assign → install prompt →
 *   customer signature LAST ("Confirm and Print DO" on the after-ack page).
 *
 * The DO_ACK MSR is created here UNSIGNED and signed at the flow's end — the
 * item stays `delivering` until the final Confirm (sign() is what advances it
 * to not_installed / fires water-sg, now with project+customer attached).
 * Back from here exits to the basket; the draft MSR persists and re-entry
 * resumes from it (no MSR deletion by design).
 */
export default function StandaloneDeliveryAckPage() {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const { getToken } = useAuth();
  const deliveryId = params?.deliveryId as string;
  const assetId = search?.get("assetId") ?? "";
  const inventoryId = search?.get("inventoryId") ?? null;
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clerk-auth'd upload closure for the shared capture component (folder:
  // do-ack) — same pattern as the start/install steps.
  const uploadDoAck = async (blob: Blob): Promise<string | null> => {
    const token = await getToken();
    if (!token) throw new Error("Not signed in");
    return uploadImage({ blob, folderName: "do-ack", token });
  };

  const continueToAssign = async () => {
    setError(null);
    if (!assetId) {
      setError("Missing asset context — go back to the delivery and retry.");
      return;
    }
    setSubmitting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const description = notes.trim() || "Delivery acknowledged";
      // Best-effort one-shot GPS (same helper as the DO flow) — never blocks.
      setLocating(true);
      const coords = await capturePosition();
      setLocating(false);
      const res = await request(
        { path: "/maintenance-reports", method: "POST" },
        {
          assetId,
          ...(inventoryId ? { inventoryId } : {}),
          description,
          kind: "DO_ACK",
          deliveryId,
          ...(photos.length ? { photos: photos.map((p) => p.key) } : {}),
          ...(coords ? { latitude: coords.latitude, longitude: coords.longitude } : {}),
        },
        token,
      );
      const reportId = res.data?.id ?? res.id;
      if (!reportId) throw new Error("No report id returned");
      // Reordered flow: continue to ASSIGN — the signature comes at the END
      // (after-ack's Confirm signs this draft MSR).
      const q = `assetId=${encodeURIComponent(assetId)}${
        inventoryId ? `&inventoryId=${encodeURIComponent(inventoryId)}` : ""
      }&ackMsrId=${encodeURIComponent(reportId)}`;
      router.replace(`/scan/delivery/${deliveryId}/after-ack?${q}`);
    } catch (e: any) {
      setError(e?.message ?? "Failed to save delivery");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 3 }}>
      <Typography variant="h6" fontWeight={700}>Confirm delivery</Typography>
      <Typography variant="body2" color="text.secondary">
        Record the drop-off — the customer signs once at the end of the flow.
      </Typography>

      <TextField
        label="Notes (optional)"
        placeholder="Any condition issues or remarks at delivery"
        multiline
        minRows={3}
        fullWidth
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      <PhotoCaptureField
        label="Delivery photos (optional)"
        photos={photos}
        onChange={setPhotos}
        upload={uploadDoAck}
        onError={(m) => setError(m || null)}
        onUploadingChange={setUploading}
      />

      {error && <Alert severity="error">{error}</Alert>}

      <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
        <Button variant="outlined" onClick={() => router.back()} fullWidth>Back</Button>
        <Button
          variant="contained"
          onClick={continueToAssign}
          disabled={submitting || uploading}
          fullWidth
          sx={{ py: 1.5, px: 4, fontSize: "1rem", minHeight: 48 }}
        >
          {submitting ? (locating ? "Getting location…" : "Saving...") : "Continue"}
        </Button>
      </Stack>
    </Box>
  );
}
