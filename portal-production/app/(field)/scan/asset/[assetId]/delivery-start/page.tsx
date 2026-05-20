"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, CircularProgress, IconButton, ImageList, ImageListItem, Stack, TextField, Typography } from "@mui/material";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import DeleteIcon from "@mui/icons-material/Delete";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import LocationOffIcon from "@mui/icons-material/LocationOff";
import { request } from "@/helpers/request";
import { uploadImage } from "@/helpers/imageUploader";
import { useGeolocation, formatCoords } from "../../../../hooks/useGeolocation";

interface UploadedPhoto {
  key: string;
  previewUrl: string;
}

/**
 * Start Delivery — first step of the two-step delivery flow. Enabled only
 * when an open DO exists for this asset and has not been started yet
 * (see canStartDelivery in getScanContext).
 *
 * Captures: notes, photos, GPS location, signature.
 * Persists as a MaintenanceServiceReport with kind=DO_START and a documentId
 * FK to the DO so the office side can see "delivery started for DO X".
 */
export default function StartDeliveryPage() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const assetId = params?.assetId as string;
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pull the latest DO so we can attach the MSR to it. Without a DO the action
  // shouldn't have been enabled — but defensive guard regardless.
  const [doId, setDoId] = useState<string | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request(
          { path: `/maintenance-reports/scan-context/${assetId}`, method: "GET" },
          {},
          token,
        );
        if (cancelled) return;
        const data = res.data ?? res;
        if (data?.latestDeliveryOrder?.id) setDoId(data.latestDeliveryOrder.id);
      } catch {
        // ignore — submit will fail loudly later if doId stays null
      } finally {
        if (!cancelled) setContextLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assetId, getToken]);

  const geo = useGeolocation();

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const newPhotos: UploadedPhoto[] = [];
      for (const file of Array.from(files)) {
        const key = await uploadImage({ blob: file, folderName: "delivery-start", token });
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
    if (!doId) {
      setError("No open delivery order found for this asset.");
      return;
    }
    setSubmitting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const description = notes.trim() || "Delivery started";
      const res = await request(
        { path: "/maintenance-reports", method: "POST" },
        {
          assetId,
          description,
          photos: photos.map((p) => p.key),
          kind: "DO_START",
          documentId: doId,
          ...(geo.coords
            ? { latitude: geo.coords.latitude, longitude: geo.coords.longitude }
            : {}),
        },
        token,
      );
      const reportId = res.data?.id ?? res.id;
      if (!reportId) throw new Error("No report id returned");
      router.push(`/scan/asset/${assetId}/sign?reportId=${reportId}&kind=delivery-start`);
    } catch (e: any) {
      setError(e?.message ?? "Failed to save delivery start");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 3 }}>
      <Typography variant="h6" fontWeight={700}>Start Delivery</Typography>
      <Typography variant="body2" color="text.secondary">
        Record the start of delivery for this equipment. Capture notes, photos, GPS, and a recipient signature.
      </Typography>

      <GeoStatus geo={geo} />

      <TextField
        label="Notes (optional)"
        placeholder="e.g. Equipment delivered to loading bay, visually inspected"
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
        <Button variant="contained" onClick={continueToSign} disabled={submitting || uploading || contextLoading || !doId} fullWidth>
          {submitting ? "Saving..." : "Continue to signature"}
        </Button>
      </Stack>
    </Box>
  );
}

/**
 * Shared GPS status block — also used by the DO Ack page. Kept inline rather
 * than a separate component file because it carries no state of its own.
 */
export function GeoStatus({ geo }: { geo: ReturnType<typeof useGeolocation> }) {
  if (geo.state === "capturing") {
    return (
      <Stack direction="row" gap={1} alignItems="center" sx={{ color: "text.secondary" }}>
        <CircularProgress size={14} />
        <Typography variant="caption">Getting location…</Typography>
      </Stack>
    );
  }
  if (geo.state === "captured" && geo.coords) {
    return (
      <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap" sx={{ color: "success.main" }}>
        <LocationOnIcon fontSize="small" />
        <Typography variant="caption">Location: {formatCoords(geo.coords)}</Typography>
        <Button size="small" variant="text" onClick={geo.retry} sx={{ minWidth: 0, py: 0, fontSize: "0.7rem" }}>
          Re-capture
        </Button>
      </Stack>
    );
  }
  // failed | unavailable
  return (
    <Alert severity="warning" icon={<LocationOffIcon fontSize="small" />} sx={{ py: 0.5 }}>
      <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
        <Typography variant="caption">
          {geo.errorMessage ?? "Could not get location."} Submission will proceed without GPS.
        </Typography>
        <Button size="small" variant="text" color="inherit" onClick={geo.retry} sx={{ minWidth: 0, py: 0, fontSize: "0.7rem" }}>
          Try again
        </Button>
      </Stack>
    </Alert>
  );
}
