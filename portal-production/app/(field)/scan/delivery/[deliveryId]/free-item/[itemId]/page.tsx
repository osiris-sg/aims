"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth, useUser } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { request } from "@/helpers/request";
import { uploadImage } from "@/helpers/imageUploader";
import { capturePosition } from "@/helpers/geolocation";
import PhotoCaptureField, { CapturedPhoto } from "@/components/delivery/PhotoCaptureField";
import GuidedPhotoCapture from "@/components/delivery/GuidedPhotoCapture";
import SignaturePadField, { SignaturePadHandle } from "@/components/delivery/SignaturePadField";
import { minPhotosForAssetClass } from "@/helpers/assetClass";

/**
 * FREE-TYPED line — full delivery flow (Route A). A description-only line (a
 * cable etc.) has no asset page and no unit to scan, so it runs its lifecycle
 * here, keyed by DeliveryItem.id:
 *   not_delivered -> guided condition photos -> "Start Delivery" (POST .../start)
 *   delivering    -> customer signature      -> "End Delivery"   (POST .../end)
 * Both write asset-less DO_START / DO_ACK proof MSRs tied to the run, so the
 * office panel and DO proof section show them with no changes.
 */

interface Item {
  id: string;
  description: string | null;
  assetId: string | null;
  inventoryId: string | null;
  assetClass?: string | null;
  deliveryStatus: "not_delivered" | "delivering" | "not_installed" | "completed";
}

export default function FreeTypedItemFlowPage() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const { user } = useUser();
  const deliveryId = params?.deliveryId as string;
  const itemId = params?.itemId as string;

  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [recipient, setRecipient] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const sigRef = React.useRef<SignaturePadHandle>(null);

  const backToBasket = () => router.replace(`/scan/delivery/${deliveryId}`);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const res = await request({ path: `/deliveries/${deliveryId}`, method: "GET" }, {}, token);
        if (cancelled) return;
        const run = res?.data ?? res;
        const found = (run?.items ?? []).find((i: Item) => i.id === itemId) ?? null;
        if (!found) throw new Error("Item is not on this delivery");
        if (found.assetId || found.inventoryId) throw new Error("This screen is only for free-typed lines");
        setItem(found);
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message ?? "Could not load the item");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deliveryId, itemId, getToken]);

  const technicianName =
    user?.fullName ?? user?.firstName ?? user?.username ?? user?.primaryEmailAddress?.emailAddress ?? undefined;

  const uploadPhoto = (folder: string) => async (blob: Blob): Promise<string | null> => {
    const token = await getToken();
    if (!token) throw new Error("Not signed in");
    return uploadImage({ blob, folderName: folder, token });
  };

  const requiredPhotos = minPhotosForAssetClass(item?.assetClass ?? null);

  const submitStart = async () => {
    setError(null);
    if (photos.length < requiredPhotos) {
      setError(
        requiredPhotos === 1
          ? "A condition photo is required to start."
          : `This line is equipment, so it needs ${requiredPhotos} condition photos to start. ${photos.length} so far.`,
      );
      return;
    }
    setSubmitting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const gps = await capturePosition().catch(() => null);
      const res = await request(
        { path: `/deliveries/${deliveryId}/items/${itemId}/start`, method: "POST" },
        {
          photos: photos.map((p) => p.key),
          ...(photos.some((p) => p.angle) ? { angles: photos.map((p) => p.angle ?? "") } : {}),
          ...(technicianName ? { technicianName } : {}),
          ...(gps ? { latitude: gps.latitude, longitude: gps.longitude } : {}),
        },
        token,
      );
      if (res?.success === false) throw new Error(res?.message ?? "Could not start delivery");
      backToBasket();
    } catch (e: any) {
      setError(e?.message ?? "Could not start delivery");
      setSubmitting(false);
    }
  };

  const submitEnd = async () => {
    setError(null);
    const sig = sigRef.current && !sigRef.current.isEmpty() ? sigRef.current.toDataUrl() : "";
    if (!sig) {
      setError("Customer signature is required.");
      return;
    }
    setSubmitting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const gps = await capturePosition().catch(() => null);
      const res = await request(
        { path: `/deliveries/${deliveryId}/items/${itemId}/end`, method: "POST" },
        {
          signature: sig,
          ...(recipient.trim() ? { signedByName: recipient.trim() } : {}),
          ...(photos.length ? { photos: photos.map((p) => p.key) } : {}),
          ...(technicianName ? { technicianName } : {}),
          ...(gps ? { latitude: gps.latitude, longitude: gps.longitude } : {}),
        },
        token,
      );
      if (res?.success === false) throw new Error(res?.message ?? "Could not end delivery");
      setDone(true);
    } catch (e: any) {
      setError(e?.message ?? "Could not end delivery");
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (loadError || !item) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{loadError ?? "Could not load the item"}</Alert>
        <Button sx={{ mt: 2 }} onClick={backToBasket}>Back to delivery</Button>
      </Box>
    );
  }

  if (done || item.deliveryStatus === "completed") {
    return (
      <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2.5, alignItems: "center", textAlign: "center" }}>
        <CheckCircleIcon sx={{ fontSize: 96, color: "success.main", mt: 6 }} />
        <Typography variant="h5" fontWeight={700}>Delivered</Typography>
        <Typography variant="body2" color="text.secondary">{item.description || "Item"} is done.</Typography>
        <Button variant="contained" onClick={backToBasket} fullWidth sx={{ maxWidth: 360, py: 1.5, minHeight: 48, mt: 2 }}>
          Back to delivery
        </Button>
      </Box>
    );
  }

  const isStart = item.deliveryStatus === "not_delivered";
  const label = item.description || "Free-typed line";

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2.5 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Button startIcon={<ArrowBackIcon />} size="small" onClick={backToBasket} disabled={submitting} sx={{ color: "text.secondary" }}>
          Back
        </Button>
      </Stack>

      <Box>
        <Typography variant="h6" fontWeight={700}>{isStart ? "Start Delivery" : "End Delivery"}</Typography>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5, flexWrap: "wrap" }}>
          <Typography variant="body2" color="text.secondary">{label}</Typography>
          <Chip size="small" label={requiredPhotos === 1 ? "Accessory" : "Equipment"} />
        </Stack>
      </Box>

      {isStart ? (
        <>
          {requiredPhotos > 1 ? (
            <GuidedPhotoCapture
              photos={photos}
              onChange={setPhotos}
              upload={uploadPhoto("do-start")}
              minPhotos={requiredPhotos}
              onError={(m) => setError(m || null)}
              onUploadingChange={setUploading}
            />
          ) : (
            <PhotoCaptureField
              label="Condition photo (required)"
              photos={photos}
              onChange={setPhotos}
              upload={uploadPhoto("do-start")}
              onError={(m) => setError(m || null)}
              onUploadingChange={setUploading}
            />
          )}
          {error && <Alert severity="error">{error}</Alert>}
          <Button
            variant="contained"
            onClick={submitStart}
            disabled={submitting || uploading || photos.length < requiredPhotos}
            fullWidth
            sx={{ py: 1.5, minHeight: 48 }}
          >
            {submitting ? <CircularProgress size={20} color="inherit" /> : "Confirm and Start Delivery"}
          </Button>
        </>
      ) : (
        <>
          <PhotoCaptureField
            label="Delivery photos (optional)"
            photos={photos}
            onChange={setPhotos}
            upload={uploadPhoto("do-ack")}
            onError={(m) => setError(m || null)}
            onUploadingChange={setUploading}
          />
          <TextField
            label="Received by (optional)"
            size="small"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            fullWidth
          />
          <Typography variant="subtitle2">Customer signature</Typography>
          <SignaturePadField ref={sigRef} />
          {error && <Alert severity="error">{error}</Alert>}
          <Button
            variant="contained"
            onClick={submitEnd}
            disabled={submitting || uploading}
            fullWidth
            sx={{ py: 1.5, minHeight: 48 }}
          >
            {submitting ? <CircularProgress size={20} color="inherit" /> : "End Delivery"}
          </Button>
        </>
      )}
    </Box>
  );
}
