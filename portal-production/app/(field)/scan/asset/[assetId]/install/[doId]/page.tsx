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
 * Complete Installation — the stage after delivery acknowledgement. Enabled
 * only when a completed DO_ACK MSR exists for this DO and no DO_INSTALL has been
 * submitted yet (see canAckInstall in getScanContext).
 *
 * Recorded as a MaintenanceServiceReport with kind=DO_INSTALL. Signing it
 * advances the parent DO to delivered_installed (see sign() in the backend).
 * Photo capture + one-shot GPS come from the shared PhotoCaptureField /
 * capturePosition (also used by the guest delivery flow).
 */
export default function InstallationAckPage() {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const { getToken } = useAuth();
  const assetId = params?.assetId as string;
  const doId = params?.doId as string;
  const inventoryId = search?.get("inventoryId") ?? null;
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clerk-auth'd upload closure handed to the shared PhotoCaptureField — the
  // component stays auth-agnostic; the token lives here (folder: do-install).
  const uploadDoInstall = async (blob: Blob): Promise<string | null> => {
    const token = await getToken();
    if (!token) throw new Error("Not signed in");
    return uploadImage({ blob, folderName: "do-install", token });
  };

  const continueToSign = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      // Description holds just the technician's notes; the activity kind is
      // discriminated by MSR.kind = DO_INSTALL. Fallback string when no notes
      // are entered so the row isn't blank in the office-side Field Reports view.
      const description = notes.trim() || "Installation acknowledged";
      // Best-effort one-shot GPS at the installation point (persisted on the
      // MSR). Resolves null on denial/no signal/timeout, so it never blocks.
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
      router.push(`/scan/asset/${assetId}/sign?reportId=${reportId}&kind=install${invQuery}`);
    } catch (e: any) {
      setError(e?.message ?? "Failed to save acknowledgement");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 3 }}>
      <Typography variant="h6" fontWeight={700}>Complete Installation</Typography>
      <Typography variant="body2" color="text.secondary">DO {doId}</Typography>

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
          {submitting ? (locating ? "Getting location…" : "Saving...") : "Continue to signature"}
        </Button>
      </Stack>
    </Box>
  );
}
