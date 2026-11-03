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
import { useFieldAppBar } from "@/app/(field)/components/FieldAppBar";
import { request } from "@/helpers/request";
import { uploadImage } from "@/helpers/imageUploader";
import SignaturePadField, { SignaturePadHandle } from "@/components/delivery/SignaturePadField";
import PhotoCaptureField, { CapturedPhoto } from "@/components/delivery/PhotoCaptureField";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { FINISH_OPTIONS, FinishMode, finishButtonLabel, finishProblem } from "@/helpers/wctFinishModes";
import { useRunWords } from "@/app/portal/hooks/useRunWords";

/**
 * RUN FINALIZE (2026-08). The ONE closing sequence for the whole run, reached when
 * the LAST outstanding item is ended (the run has folded to `delivered`). OUTBOUND
 * asks installation ONCE then the ONE customer signature (POST /finalize -> DO +
 * draft invoice). A RETURN (?return=1) has NO install step: it goes straight to the
 * ONE signature (POST /finalize-return -> stamps every return proof + the RDO).
 * Backing out returns to the run page, where the finalize card re-enters.
 */
export default function FinalizeDeliveryPage() {
  // WCT (enableWctOrders): "Job" wording (helpers/jobWording.ts).
  const w = useRunWords();
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
  // WCT service job (a SERVICE-class line): the sign-off is followed at once by
  // the service report scheduled with the run — finalize lands there, not on
  // the "Delivery completed" screen.
  const [serviceJob, setServiceJob] = useState(false);
  // A SERVICE run (WCT) has nothing to install — the "Installation needed?"
  // question is skipped entirely and the page opens on the signature
  // (guru 2026-10-27: "remove this logic for wct entirely").
  const [serviceRun, setServiceRun] = useState(false);
  // WCT finish modes (enableWctFinishModes): besides the customer's signature,
  // a photo of the DO the customer stamped, or "completed, paper copy later".
  // Full finish only (a partial sign-off is always signed).
  const { isWctFinishModesEnabled, isWctOrderInvoiceEnabled } = useOrganizationFeatures();
  // WCT invoice per order: a job of an order is not invoiced on its own.
  const [orderJob, setOrderJob] = useState(false);
  const [mode, setMode] = useState<FinishMode>("signature");
  const [stampedPhotos, setStampedPhotos] = useState<CapturedPhoto[]>([]);
  const [completionNote, setCompletionNote] = useState("");
  useFieldAppBar({
    title: isReturn ? "Finish return" : `Finish ${w.noun}`,
    onBack: () => (step === "sign" && !isReturn && !serviceRun ? setStep("install") : router.back()),
    backDisabled: working,
  });
  useEffect(() => {
    if (isReturn) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request({ path: `/deliveries/${deliveryId}`, method: "GET" }, {}, token);
        const run = res?.data ?? res;
        if (cancelled || !run?.items) return;
        setOrderJob(!!(run.order?.id || run.orderId));
        // A service job whose report was already written during the job (the
        // normal order now: select lines → report → sign-off) lands on the
        // finished screen; only a run with no report yet is sent to write one.
        const hasReport = Array.isArray(run.reports) && run.reports.some((r: { kind?: string; status?: string }) => r.kind === "SERVICE" && r.status === "completed");
        const isServiceRun = run.items.some((it: { assetClass?: string | null }) => String(it.assetClass ?? "").toUpperCase() === "SERVICE");
        setServiceJob(!hasReport && isServiceRun);
        if (isServiceRun) {
          setServiceRun(true);
          setInstallChoice("no");
          setStep("sign");
        }
        if (run.status !== "in_progress") return;
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
  const modesOffered = isWctFinishModesEnabled && !isReturn && !partial;
  const finishMode: FinishMode = modesOffered ? mode : "signature";

  const uploadInstallPhoto = async (blob: Blob): Promise<string | null> => {
    const token = await getToken();
    if (!token) return null;
    return uploadImage({ blob, folderName: "do-install", token });
  };

  const uploadStampedPhoto = async (blob: Blob): Promise<string | null> => {
    const token = await getToken();
    if (!token) return null;
    return uploadImage({ blob, folderName: "do-stamped", token });
  };

  const submit = async () => {
    if (finishMode !== "signature") {
      const problem = finishProblem(finishMode, stampedPhotos.length);
      if (problem) {
        setError(problem);
        return;
      }
      await send({
        completionMode: finishMode,
        ...(finishMode === "stamped_do" ? { stampedDoPhotos: stampedPhotos.map((p) => p.key) } : {}),
        ...(completionNote.trim() ? { completionNote: completionNote.trim() } : {}),
        installNeeded: installChoice === "yes",
        ...(installChoice === "yes" && installPhotos.length ? { installPhotos: installPhotos.map((p) => p.key) } : {}),
      });
      return;
    }
    if (!sigRef.current || sigRef.current.isEmpty()) {
      setError(isReturn ? "The customer needs to sign to complete the return." : `The customer needs to sign to complete the ${w.noun}.`);
      return;
    }
    const signature = sigRef.current.toDataUrl();
    await send({ signature });
  };

  const send = async (finish: { signature?: string; completionMode?: FinishMode; stampedDoPhotos?: string[]; completionNote?: string; installNeeded?: boolean; installPhotos?: string[] }) => {
    const signature = finish.signature;
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
            finish.completionMode
              ? finish
              : {
                  signature,
                  ...(signedByName.trim() ? { recipientName: signedByName.trim() } : {}),
                  installNeeded: installChoice === "yes",
                  ...(installChoice === "yes" && installPhotos.length ? { installPhotos: installPhotos.map((p) => p.key) } : {}),
                },
            token,
          );
      if (res?.success === false) throw new Error(res?.message ?? (isReturn ? "Could not finalize the return" : `Could not finalize the ${w.noun}`));
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
      // A service job goes straight into its service report (Quotation → DO →
      // service done → invoice → service report); the finished screen comes after.
      if (!isReturn && serviceJob) {
        router.replace(`/scan/delivery/${deliveryId}/service-report`);
        return;
      }
      router.replace(isReturn ? "/scan" : `/scan/deliveries/finished/${deliveryId}`);
    } catch (e: any) {
      setError(e?.message ?? (isReturn ? "Could not finalize the return" : `Could not finalize the ${w.noun}`));
      setWorking(false);
    }
  };

  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}>

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
              ? `One answer for the items ${w.done} on this trip. If yes, add installation photos below.`
              : `One answer for the whole ${w.noun}. If yes, add installation photos for the run below.`}
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
          {modesOffered && (
            <Stack spacing={1} data-tour="field-finish-mode">
              <Typography variant="h6" fontWeight={700}>
                How is the job signed off?
              </Typography>
              {FINISH_OPTIONS.map((o) => (
                <Button key={o.value} fullWidth variant={mode === o.value ? "contained" : "outlined"} onClick={() => setMode(o.value)} sx={{ minHeight: 48, justifyContent: "flex-start", textAlign: "left" }}>
                  <Box>
                    <Typography sx={{ fontWeight: 600, fontSize: 15 }}>{o.label}</Typography>
                    <Typography sx={{ fontSize: 12, opacity: 0.8 }}>{o.hint}</Typography>
                  </Box>
                </Button>
              ))}
            </Stack>
          )}

          {finishMode !== "signature" ? (
            <>
              {finishMode === "stamped_do" && (
                <PhotoCaptureField
                  label="Photo of the stamped DO"
                  photos={stampedPhotos}
                  onChange={setStampedPhotos}
                  upload={uploadStampedPhoto}
                  onError={(m) => setError(m || null)}
                  onUploadingChange={setWorking}
                />
              )}
              <TextField
                label={finishMode === "paper" ? "Note (optional), e.g. who has the paper copy" : "Note (optional)"}
                value={completionNote}
                onChange={(e) => setCompletionNote(e.target.value)}
                size="small"
                fullWidth
                multiline
                minRows={2}
              />
              <Typography variant="body2" color="text.secondary">
                The job is completed now and waits for the office to verify it.
              </Typography>
              <Button fullWidth variant="contained" color="success" onClick={submit} disabled={working} sx={{ minHeight: 48 }}>
                {working ? <CircularProgress size={22} /> : finishButtonLabel(finishMode)}
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
                ? `This signature covers the ${partialCount} ${partialCount === 1 ? "item" : "items"} ${w.done} so far. The rest of this ${w.noun} stays open and is signed for when it arrives.`
                : orderJob && isWctOrderInvoiceEnabled
                  ? "One signature covers the whole job. It completes the job and the Delivery Order. The order is invoiced once every job is verified."
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
              `Complete ${w.noun}`
            )}
          </Button>
          </>
          )}
        </>
      )}
    </Box>
  );
}
