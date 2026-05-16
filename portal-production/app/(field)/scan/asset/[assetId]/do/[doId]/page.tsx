"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
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

/**
 * DO acknowledgement: technician/driver confirms delivery on-site.
 * For v1 we record this as a MaintenanceServiceReport with a "DO ack" prefix
 * and the DO id in the description, so we don't need a separate model. The
 * backend stores it against the asset and the existing report list shows it.
 */
export default function DeliveryOrderAckPage() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const assetId = params?.assetId as string;
  const doId = params?.doId as string;
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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
        const key = await uploadImage({ blob: file, folderName: "do-ack", token });
        if (key) newPhotos.push({ key, previewUrl: URL.createObjectURL(file) });
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
      const description = `DO Acknowledgement (DO ${doId})${notes.trim() ? ` — ${notes.trim()}` : ""}`;
      const res = await request(
        { path: "/maintenance-reports", method: "POST" },
        { assetId, description, photos: photos.map((p) => p.key) },
        token,
      );
      const reportId = res.data?.id ?? res.id;
      if (!reportId) throw new Error("No report id returned");
      router.push(`/scan/asset/${assetId}/sign?reportId=${reportId}&kind=do`);
    } catch (e: any) {
      setError(e?.message ?? "Failed to save acknowledgement");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 3 }}>
      <Typography variant="h6" fontWeight={700}>Acknowledge Delivery Order</Typography>
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
        <Button variant="contained" onClick={continueToSign} disabled={submitting || uploading} fullWidth>
          {submitting ? "Saving..." : "Continue to signature"}
        </Button>
      </Stack>
    </Box>
  );
}
