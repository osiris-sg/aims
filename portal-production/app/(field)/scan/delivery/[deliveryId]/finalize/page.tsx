"use client";

import { useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
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
import { request } from "@/helpers/request";
import { uploadImage } from "@/helpers/imageUploader";
import SignaturePadField, { SignaturePadHandle } from "@/components/delivery/SignaturePadField";
import PhotoCaptureField, { CapturedPhoto } from "@/components/delivery/PhotoCaptureField";

/**
 * RUN FINALIZE (2026-08). The ONE closing sequence for the whole delivery, reached
 * when the LAST outstanding item is ended (the run has folded to `delivered`).
 * Installation is asked ONCE for the whole run here (not per item), then the ONE
 * customer signature. POST /deliveries/:id/finalize records a single run-level
 * DO_INSTALL (when installed) with the shared photos, stamps the signature across
 * the per-item proof MSRs, completes the delivered items, and fires the DO + draft
 * invoice. Backing out returns to the run page, where the finalize card re-enters.
 */
export default function FinalizeDeliveryPage() {
  const router = useRouter();
  const { deliveryId } = useParams() as { deliveryId: string };
  const { getToken } = useAuth();

  const [step, setStep] = useState<"install" | "sign">("install");
  const [installChoice, setInstallChoice] = useState<"yes" | "no" | null>(null);
  const [installPhotos, setInstallPhotos] = useState<CapturedPhoto[]>([]);

  const sigRef = useRef<SignaturePadHandle>(null);
  const [signedByName, setSignedByName] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadInstallPhoto = async (blob: Blob): Promise<string | null> => {
    const token = await getToken();
    if (!token) return null;
    return uploadImage({ blob, folderName: "do-install", token });
  };

  const submit = async () => {
    if (!sigRef.current || sigRef.current.isEmpty()) {
      setError("The customer needs to sign to complete the delivery.");
      return;
    }
    const signature = sigRef.current.toDataUrl();
    setWorking(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: `/deliveries/${deliveryId}/finalize`, method: "POST" },
        {
          signature,
          ...(signedByName.trim() ? { recipientName: signedByName.trim() } : {}),
          installNeeded: installChoice === "yes",
          ...(installChoice === "yes" && installPhotos.length ? { installPhotos: installPhotos.map((p) => p.key) } : {}),
        },
        token,
      );
      if (res?.success === false) throw new Error(res?.message ?? "Could not finalize the delivery");
      // The run is complete: go straight back to the scan home (natural exit).
      // No result/summary screen; the receipt is reprintable from the finished
      // list ("Reprint a delivery" on scan home) for 7 days if needed.
      router.replace("/scan");
    } catch (e: any) {
      setError(e?.message ?? "Could not finalize the delivery");
      setWorking(false);
    }
  };

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" alignItems="center">
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => (step === "sign" ? setStep("install") : router.back())}
          disabled={working}
          color="inherit"
        >
          Back
        </Button>
      </Stack>

      {error && (
        <Alert severity="warning" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {step === "install" ? (
        <>
          <Typography variant="h6" fontWeight={700}>
            Installation needed?
          </Typography>
          <Typography variant="body2" color="text.secondary">
            One answer for the whole delivery. If yes, add installation photos for the run below.
          </Typography>

          <Stack direction="row" spacing={1.5}>
            <Button
              fullWidth
              variant={installChoice === "yes" ? "contained" : "outlined"}
              onClick={() => setInstallChoice("yes")}
              sx={{ minHeight: 48 }}
            >
              Yes, installed
            </Button>
            <Button
              fullWidth
              variant={installChoice === "no" ? "contained" : "outlined"}
              onClick={() => setInstallChoice("no")}
              sx={{ minHeight: 48 }}
            >
              No install needed
            </Button>
          </Stack>

          {installChoice === "yes" && (
            <PhotoCaptureField
              label="Installation photos (whole run)"
              photos={installPhotos}
              onChange={setInstallPhotos}
              upload={uploadInstallPhoto}
              onError={(m) => setError(m || null)}
              onUploadingChange={setWorking}
            />
          )}

          <Button
            fullWidth
            variant="contained"
            color="success"
            disabled={!installChoice || working}
            onClick={() => setStep("sign")}
            sx={{ minHeight: 48 }}
          >
            Continue to signature
          </Button>
        </>
      ) : (
        <>
          <Typography variant="h6" fontWeight={700}>
            Customer signature
          </Typography>
          <Typography variant="body2" color="text.secondary">
            One signature covers the whole delivery. It completes the run and creates the Delivery Order and its
            invoice.
          </Typography>

          <TextField
            label="Signed by (name)"
            value={signedByName}
            onChange={(e) => setSignedByName(e.target.value)}
            size="small"
            fullWidth
          />

          <SignaturePadField ref={sigRef} />

          <Button fullWidth variant="contained" color="success" onClick={submit} disabled={working} sx={{ minHeight: 48 }}>
            {working ? <CircularProgress size={22} /> : "Complete delivery"}
          </Button>
        </>
      )}
    </Box>
  );
}
