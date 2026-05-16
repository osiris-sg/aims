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

export default function NewServiceReportPage() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const assetId = params?.assetId as string;
  const [description, setDescription] = useState("");
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
        const key = await uploadImage({ blob: file, folderName: "maintenance-reports", token });
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
    if (!description.trim()) {
      setError("Description is required");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: "/maintenance-reports", method: "POST" },
        { assetId, description: description.trim(), photos: photos.map((p) => p.key) },
        token,
      );
      const reportId = res.data?.id ?? res.id;
      if (!reportId) throw new Error("No report id returned");
      router.push(`/scan/asset/${assetId}/sign?reportId=${reportId}`);
    } catch (e: any) {
      setError(e?.message ?? "Failed to save report");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 3 }}>
      <Typography variant="h6" fontWeight={700}>Maintenance service report</Typography>

      <TextField
        label="Description of work"
        placeholder="What was serviced, parts replaced, issues found, etc."
        multiline
        minRows={4}
        fullWidth
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <Box>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <Typography variant="subtitle2">Proof of service ({photos.length})</Typography>
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

        <Button
          component="label"
          variant="outlined"
          startIcon={<AddPhotoAlternateIcon />}
          disabled={uploading}
          fullWidth
        >
          Add photos
          <input
            type="file"
            accept="image/*"
            multiple
            capture="environment"
            hidden
            onChange={(e) => handleFiles(e.target.files)}
          />
        </Button>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}

      <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
        <Button variant="outlined" onClick={() => router.back()} fullWidth>Back</Button>
        <Button
          variant="contained"
          onClick={continueToSign}
          disabled={submitting || uploading || !description.trim()}
          fullWidth
        >
          {submitting ? "Saving..." : "Continue to signature"}
        </Button>
      </Stack>
    </Box>
  );
}
