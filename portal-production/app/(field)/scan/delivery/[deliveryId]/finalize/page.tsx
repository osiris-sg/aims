"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
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
 * RUN FINALIZE (2026-08). The ONE closing sequence for the whole run, reached when
 * the LAST outstanding item is ended (the run has folded to `delivered`). OUTBOUND
 * asks installation ONCE then the ONE customer signature (POST /finalize -> DO +
 * draft invoice). A RETURN (?return=1) has NO install step: it goes straight to the
 * ONE signature (POST /finalize-return -> stamps every return proof + the RDO).
 * Backing out returns to the run page, where the finalize card re-enters.
 */
export default function FinalizeDeliveryPage() {
  const router = useRouter();
  const { deliveryId } = useParams() as { deliveryId: string };
  const { getToken } = useAuth();
  const isReturn = useSearchParams()?.get("return") === "1";

  // A return has no install step, so it opens straight on the signature.
  const [step, setStep] = useState<"install" | "sign">(isReturn ? "sign" : "install");
  const [installChoice, setInstallChoice] = useState<"yes" | "no" | null>(null);
  const [installPhotos, setInstallPhotos] = useState<CapturedPhoto[]>([]);

  const sigRef = useRef<SignaturePadHandle>(null);
  const [signedByName, setSignedByName] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // PARTIAL SIGN-OFF (2026-09): an outbound run that is still in_progress signs
  // only for the items handed over so far. Read from the run itself so the copy
  // is right after a reload too. null until loaded (the full-run copy shows).
  const [partialCount, setPartialCount] = useState<number | null>(null);
  useEffect(() => {
    if (isReturn) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request({ path: `/deliveries/${deliveryId}`, method: "GET" }, {}, token);
        const run = res?.data ?? res;
        if (cancelled || !run?.items || run.status !== "in_progress") return;
        const n = run.items.filter((it: { deliveryStatus: string }) => it.deliveryStatus === "not_installed").length;
        if (n > 0) setPartialCount(n);
      } catch {
        /* the full-run copy stays; the server decides what the signature covers */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deliveryId, getToken, isReturn]);
  const partial = partialCount !== null;

  const uploadInstallPhoto = async (blob: Blob): Promise<string | null> => {
    const token = await getToken();
    if (!token) return null;
    return uploadImage({ blob, folderName: "do-install", token });
  };

  const submit = async () => {
    if (!sigRef.current || sigRef.current.isEmpty()) {
      setError(isReturn ? "The customer needs to sign to complete the return." : "The customer needs to sign to complete the delivery.");
      return;
    }
    const signature = sigRef.current.toDataUrl();
    setWorking(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = isReturn
        ? await request(
            { path: `/deliveries/${deliveryId}/finalize-return`, method: "POST" },
            {
              signature,
              ...(signedByName.trim() ? { recipientName: signedByName.trim() } : {}),
            },
            token,
          )
        : await request(
            { path: `/deliveries/${deliveryId}/finalize`, method: "POST" },
            {
              signature,
              ...(signedByName.trim() ? { recipientName: signedByName.trim() } : {}),
              installNeeded: installChoice === "yes",
              ...(installChoice === "yes" && installPhotos.length ? { installPhotos: installPhotos.map((p) => p.key) } : {}),
            },
            token,
          );
      if (res?.success === false) throw new Error(res?.message ?? (isReturn ? "Could not finalize the return" : "Could not finalize the delivery"));
      // A RETURN has no printable DO receipt to land on, so go straight back to
      // the scan home. OUTBOUND lands on the finished screen (confirmation +
      // Print DO), the rider's chance to print at hand-off. A PARTIAL sign-off
      // lands on the same screen in its "Signed for N items" form; the count
      // rides in the URL and the screen reads the run, so a reload keeps it.
      const out = res?.data ?? res;
      if (!isReturn && out?.partial) {
        router.replace(`/scan/deliveries/finished/${deliveryId}?signed=${Number(out.signedItemCount) || 0}`);
        return;
      }
      router.replace(isReturn ? "/scan" : `/scan/deliveries/finished/${deliveryId}`);
    } catch (e: any) {
      setError(e?.message ?? (isReturn ? "Could not finalize the return" : "Could not finalize the delivery"));
      setWorking(false);
    }
  };

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" alignItems="center">
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => (step === "sign" && !isReturn ? setStep("install") : router.back())}
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
            {partial
              ? "One answer for the items delivered on this trip. If yes, add installation photos below."
              : "One answer for the whole delivery. If yes, add installation photos for the run below."}
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
              label={partial ? "Installation photos (this trip)" : "Installation photos (whole run)"}
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
            {isReturn
              ? "One signature covers the whole return. It completes the collection and creates the Return Delivery Order."
              : partial
                ? `This signature covers the ${partialCount} ${partialCount === 1 ? "item" : "items"} delivered so far. The rest of this delivery stays open and is signed for when it arrives.`
                : "One signature covers the whole delivery. It completes the run and creates the Delivery Order and its invoice."}
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
            {working ? (
              <CircularProgress size={22} />
            ) : isReturn ? (
              "Complete return"
            ) : partial ? (
              `Sign for ${partialCount} ${partialCount === 1 ? "item" : "items"}`
            ) : (
              "Complete delivery"
            )}
          </Button>
        </>
      )}
    </Box>
  );
}
