"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth, useUser } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
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
import SignaturePadField, { SignaturePadHandle } from "@/components/delivery/SignaturePadField";
import { useBackgroundLocationContext } from "../../../../context/BackgroundLocationContext";

/**
 * COMPLETE — the unified end-of-run capture (#3b / #3a). One flow (photos →
 * install → signature) applied to MANY units: the rider captures the customer's
 * proof once and it is fanned across every unit still delivering on the run,
 * instead of the old cramped in-basket dialog. Two modes:
 *
 *   - Bulk (default): every delivering unit. OUTBOUND asks the install question
 *     and posts /ack-all { installNeeded, installPhotos, signature, ... }; RETURN
 *     skips install and collects all via the same endpoint.
 *   - Single return (`?inventoryId=`): the per-unit "End Return" twin of End
 *     Delivery — posts /items/:inventoryId/collect-return with the same proof.
 *
 * The signature/photos/GPS are identical to the single-item flow the outbound
 * per-unit path runs, so bulk and single now feel the same.
 */

type ItemStatus = "not_delivered" | "delivering" | "not_installed" | "completed";

interface RunItem {
  id: string;
  inventoryId: string | null;
  deliveryStatus: ItemStatus;
  inventory: { id: string; sku: string } | null;
  asset: { id: string; name: string } | null;
  description: string | null;
}

interface Run {
  id: string;
  deliveryNumber: number;
  direction?: "OUTBOUND" | "RETURN";
  status: "in_progress" | "delivered" | "completed" | "cancelled";
  items: RunItem[];
}

export default function CompleteRunPage() {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const { getToken } = useAuth();
  const { user } = useUser();
  const bgLocation = useBackgroundLocationContext();
  const deliveryId = params?.deliveryId as string;
  // Single-unit return mode when an inventoryId is supplied; bulk otherwise.
  const singleInventoryId = search?.get("inventoryId");

  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState<"photos" | "install" | "sign" | "done">("photos");
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [recipient, setRecipient] = useState("");
  const [installChoice, setInstallChoice] = useState<"yes" | "no" | null>(null);
  const [installPhotos, setInstallPhotos] = useState<CapturedPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState(0);
  const sigRef = React.useRef<SignaturePadHandle>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const res = await request({ path: `/deliveries/${deliveryId}`, method: "GET" }, {}, token);
        if (cancelled) return;
        const data = (res?.data ?? res) as Run;
        setRun(data);
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message ?? "Could not load delivery");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deliveryId, getToken]);

  const isReturn = run?.direction === "RETURN";
  // Units this flow covers: the single unit in single mode, else all delivering.
  const targetUnits = useMemo(() => {
    if (!run) return [] as RunItem[];
    const delivering = run.items.filter((it) => it.inventoryId && it.deliveryStatus === "delivering");
    if (singleInventoryId) return delivering.filter((it) => it.inventoryId === singleInventoryId);
    return delivering;
  }, [run, singleInventoryId]);

  const uploadProof = async (blob: Blob): Promise<string | null> => {
    const token = await getToken();
    if (!token) throw new Error("Not signed in");
    return uploadImage({ blob, folderName: "do-ack", token });
  };
  const uploadInstall = async (blob: Blob): Promise<string | null> => {
    const token = await getToken();
    if (!token) throw new Error("Not signed in");
    return uploadImage({ blob, folderName: "do-install", token });
  };

  const technicianName =
    user?.fullName ?? user?.firstName ?? user?.username ?? user?.primaryEmailAddress?.emailAddress ?? undefined;

  const verbTitle = isReturn
    ? singleInventoryId
      ? "End return"
      : "Complete all deliveries"
    : "Deliver all";

  // Advance from the photos step: OUTBOUND asks the install question next;
  // RETURN goes straight to the signature.
  const afterPhotos = () => {
    setError(null);
    if (isReturn) setStep("sign");
    else setStep("install");
  };

  const submit = async () => {
    setError(null);
    const sig = sigRef.current && !sigRef.current.isEmpty() ? sigRef.current.toDataUrl() : "";
    if (!sig) {
      setError("Customer signature is required.");
      return;
    }
    if (targetUnits.length === 0) {
      setError("No units are awaiting completion.");
      return;
    }
    setSubmitting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const gps = await capturePosition().catch(() => null);
      const body = {
        signature: sig,
        ...(recipient.trim() ? { recipientName: recipient.trim() } : {}),
        ...(photos.length ? { photos: photos.map((p) => p.key) } : {}),
        ...(gps ? { latitude: gps.latitude, longitude: gps.longitude } : {}),
        ...(technicianName ? { technicianName } : {}),
      };

      let acknowledged = 0;
      if (singleInventoryId) {
        // Per-unit return collect (#3a).
        const res = await request(
          { path: `/deliveries/${deliveryId}/items/${encodeURIComponent(singleInventoryId)}/collect-return`, method: "POST" },
          body,
          token,
        );
        if (res?.success === false) throw new Error(res?.message ?? "Collect failed");
        acknowledged = (res?.data ?? res)?.acknowledged ?? 0;
      } else {
        // Bulk fan-out (#3b) — OUTBOUND carries the install choice.
        const res = await request(
          { path: `/deliveries/${deliveryId}/ack-all`, method: "POST" },
          {
            ...body,
            ...(!isReturn && installChoice === "yes"
              ? { installNeeded: true, ...(installPhotos.length ? { installPhotos: installPhotos.map((p) => p.key) } : {}) }
              : {}),
          },
          token,
        );
        if (res?.success === false) throw new Error(res?.message ?? "Completion failed");
        acknowledged = (res?.data ?? res)?.acknowledged ?? 0;
      }

      // The delivery leg is over — stop background tracking (fire-and-forget).
      void bgLocation.stop();
      setDoneCount(acknowledged);
      setStep("done");
    } catch (e: any) {
      setError(e?.message ?? "Completion failed");
    } finally {
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

  if (loadError || !run) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{loadError ?? "Could not load delivery"}</Alert>
        <Button sx={{ mt: 2 }} onClick={() => router.replace(`/scan/delivery/${deliveryId}`)}>
          Back to delivery
        </Button>
      </Box>
    );
  }

  if (step === "done") {
    return (
      <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2.5, alignItems: "center", textAlign: "center" }}>
        <CheckCircleIcon sx={{ fontSize: 96, color: "success.main", mt: 6 }} />
        <Typography variant="h5" fontWeight={700}>
          {isReturn ? "Return collected" : "Delivered"}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {doneCount} unit{doneCount === 1 ? "" : "s"} {isReturn ? "collected back to stock" : "marked delivered"}.
        </Typography>
        <Button
          variant="contained"
          onClick={() => router.replace(`/scan/delivery/${deliveryId}`)}
          fullWidth
          sx={{ maxWidth: 360, py: 1.5, minHeight: 48, mt: 2 }}
        >
          Back to delivery
        </Button>
      </Box>
    );
  }

  const unitCountLabel = `${targetUnits.length} unit${targetUnits.length === 1 ? "" : "s"}`;

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2.5 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Button
          startIcon={<ArrowBackIcon />}
          size="small"
          onClick={() => (step === "photos" ? router.back() : setStep("photos"))}
          disabled={submitting}
          sx={{ color: "text.secondary" }}
        >
          Back
        </Button>
      </Stack>

      <Box>
        <Typography variant="h6" fontWeight={700}>{verbTitle}</Typography>
        <Typography variant="body2" color="text.secondary">
          {isReturn
            ? `Collecting ${unitCountLabel} back to stock. One signature applies to ${targetUnits.length === 1 ? "it" : "them all"}.`
            : `${unitCountLabel} out for delivery. One signature applies to ${targetUnits.length === 1 ? "it" : "them all"}.`}
        </Typography>
      </Box>

      {targetUnits.length === 0 && (
        <Alert severity="info">No units are awaiting completion on this run.</Alert>
      )}

      {step === "photos" && (
        <>
          <TextField
            label="Received by (optional)"
            size="small"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            fullWidth
          />
          <PhotoCaptureField
            label={isReturn ? "Return condition photos (optional)" : "Delivery photos (optional)"}
            photos={photos}
            onChange={setPhotos}
            upload={uploadProof}
            onError={(m) => setError(m || null)}
            onUploadingChange={setUploading}
          />
          {error && <Alert severity="error">{error}</Alert>}
          <Button
            variant="contained"
            onClick={afterPhotos}
            disabled={uploading || submitting || targetUnits.length === 0}
            fullWidth
            sx={{ py: 1.5, minHeight: 48 }}
          >
            Continue
          </Button>
        </>
      )}

      {step === "install" && !isReturn && (
        <>
          <Typography variant="subtitle1" fontWeight={600}>
            Do these units need installation?
          </Typography>
          <Typography variant="body2" color="text.secondary">
            The same answer applies to all {unitCountLabel}. Choose No to mark them delivered only.
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button
              variant={installChoice === "yes" ? "contained" : "outlined"}
              onClick={() => setInstallChoice("yes")}
              fullWidth
              sx={{ minHeight: 44 }}
            >
              Yes
            </Button>
            <Button
              variant={installChoice === "no" ? "contained" : "outlined"}
              onClick={() => setInstallChoice("no")}
              fullWidth
              sx={{ minHeight: 44 }}
            >
              No
            </Button>
          </Stack>
          {installChoice === "yes" && (
            <PhotoCaptureField
              label="Installation photos (optional)"
              photos={installPhotos}
              onChange={setInstallPhotos}
              upload={uploadInstall}
              onError={(m) => setError(m || null)}
              onUploadingChange={setUploading}
            />
          )}
          {error && <Alert severity="error">{error}</Alert>}
          <Button
            variant="contained"
            onClick={() => {
              setError(null);
              setStep("sign");
            }}
            disabled={installChoice === null || uploading || submitting}
            fullWidth
            sx={{ py: 1.5, minHeight: 48 }}
          >
            Continue
          </Button>
        </>
      )}

      {step === "sign" && (
        <>
          <Typography variant="subtitle1" fontWeight={600}>Customer signature</Typography>
          <Typography variant="body2" color="text.secondary">
            One signature confirms {isReturn ? "the collection" : "the delivery"}
            {!isReturn && installChoice === "yes" ? " and the installation" : ""} for all {unitCountLabel}.
          </Typography>
          <SignaturePadField ref={sigRef} />
          {error && <Alert severity="error">{error}</Alert>}
          <Button
            variant="contained"
            onClick={submit}
            disabled={submitting || uploading || targetUnits.length === 0}
            fullWidth
            sx={{ py: 1.5, minHeight: 48 }}
          >
            {submitting ? <CircularProgress size={20} color="inherit" /> : isReturn ? `Collect ${unitCountLabel}` : `Deliver ${unitCountLabel}`}
          </Button>
        </>
      )}
    </Box>
  );
}
