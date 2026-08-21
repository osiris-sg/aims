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
 * Complete Installation — STANDALONE-run twin of install/[doId]/page.tsx
 * (Layer 3). Identical capture flow (notes + shared PhotoCaptureField +
 * one-shot GPS → MSR POST → shared sign page); the MSR carries deliveryId
 * instead of documentId. assetId + inventoryId arrive as query params from
 * the basket's per-item action.
 */
export default function StandaloneInstallPage() {
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

  // Same shared upload closure pattern as the DO install page (folder:
  // do-install) — the capture component stays auth-agnostic.
  const uploadDoInstall = async (blob: Blob): Promise<string | null> => {
    const token = await getToken();
    if (!token) throw new Error("Not signed in");
    return uploadImage({ blob, folderName: "do-install", token });
  };

  const continueToSign = async () => {
    setError(null);
    if (!assetId) {
      setError("Missing asset context — go back to the delivery and retry.");
      return;
    }
    setSubmitting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const description = notes.trim() || "Installation acknowledged";
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
          kind: "DO_INSTALL",
          deliveryId,
          ...(coords ? { latitude: coords.latitude, longitude: coords.longitude } : {}),
        },
        token,
      );
      const reportId = res.data?.id ?? res.id;
      if (!reportId) throw new Error("No report id returned");
      // 2026-08 signature-at-end: install records an UNSIGNED DO_INSTALL proof and
      // returns straight to the run. No per-item signature here - the item stays
      // not_installed and the run's single finalize signature covers installation
      // too, stamping this DO_INSTALL along with every delivery proof.
      router.push(`/scan/delivery/${deliveryId}`);
    } catch (e: any) {
      setError(e?.message ?? "Failed to save installation");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 3 }}>
      <Typography variant="h6" fontWeight={700}>Complete Installation</Typography>
      <Typography variant="body2" color="text.secondary">Standalone delivery — no DO yet</Typography>

      <TextField
        label="Notes (optional)"
        placeholder="Any remarks at installation"
        multiline
        minRows={3}
        fullWidth
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      <PhotoCaptureField
        label="Proof of installation"
        photos={photos}
        onChange={setPhotos}
        upload={uploadDoInstall}
        onError={(m) => setError(m || null)}
        onUploadingChange={setUploading}
      />

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
          {submitting ? (locating ? "Getting location…" : "Saving...") : "Save installation"}
        </Button>
      </Stack>
    </Box>
  );
}
