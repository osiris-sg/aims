"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth, useUser } from "@clerk/nextjs";
import SignatureCanvas from "react-signature-canvas";
import { Alert, Box, Button, CircularProgress, Divider, Stack, TextField, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { request } from "@/helpers/request";
import { uploadImage } from "@/helpers/imageUploader";

/**
 * SIGN A REPORT THAT WAS SKIPPED.
 *
 * Opening a Pending Sign report lands here — straight on the signature steps, not
 * back through the whole form. The findings were captured when the work was
 * done; the only thing missing is the acknowledgment.
 *
 * It finishes with POST /maintenance-reports/:id/sign, the endpoint that has
 * always existed for exactly this: it refuses a report already `completed`,
 * stamps signature/signedByName/signedAt, flips `status` to `completed`, and
 * (with the change that accompanies this screen) sends the customer email that
 * the unsigned submit deliberately withheld.
 */
export default function SignReportPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const router = useRouter();
  const { getToken } = useAuth();
  const { user } = useUser();

  const [report, setReport] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"tech" | "client">("tech");
  const [submitting, setSubmitting] = useState(false);

  const techRef = useRef<SignatureCanvas>(null);
  const clientRef = useRef<SignatureCanvas>(null);
  const [techUrl, setTechUrl] = useState<string | null>(null);
  const [techDrawn, setTechDrawn] = useState(false);
  const [clientDrawn, setClientDrawn] = useState(false);
  const [clientName, setClientName] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const res = await request({ path: `/maintenance-reports/${reportId}`, method: "GET" }, {}, token);
        const data = res?.data ?? res;
        if (!data?.id) throw new Error("Report not found");
        if (data.status === "completed") {
          // Already signed by someone else while this sat in the list.
          router.replace(`/scan/reports/${reportId}/print`);
          return;
        }
        setReport(data);
        setClientName(data.serviceData?.clientSignerName ?? "");
      } catch (e: any) {
        setError(e?.message ?? "Could not load the report");
      }
    })();
  }, [reportId, getToken, router]);

  const dataUrlToBlob = async (dataUrl: string) => (await fetch(dataUrl)).blob();

  const finish = useCallback(async () => {
    if (!techUrl) {
      setError("Service signature is required");
      setStep("tech");
      return;
    }
    if (!clientRef.current || clientRef.current.isEmpty()) {
      setError("Client signature is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const clientUrl = clientRef.current.getTrimmedCanvas().toDataURL("image/png");
      const [techKey, clientKey] = await Promise.all([
        uploadImage({ blob: await dataUrlToBlob(techUrl), folderName: "maintenance-reports", token }),
        uploadImage({ blob: await dataUrlToBlob(clientUrl), folderName: "maintenance-reports", token }),
      ]);
      // Say what actually happened. uploadImage swallows its own errors and
      // returns "" — reporting that as a signature problem sends the
      // technician back to a pad that was never at fault.
      if (!techKey || !clientKey) {
        throw new Error(
          "Your signatures could not be uploaded — the connection dropped. " +
            "They are still on screen: move somewhere with signal and press Sign and finish again.",
        );
      }

      // ONE call finishes the report: the gate column, the name, and both
      // signature images that the renderers actually draw. Split across two
      // calls the second could fail alone and leave a "signed" report showing
      // no signature.
      const res = await request(
        { path: `/maintenance-reports/${reportId}/sign`, method: "POST" },
        {
          signature: clientKey,
          signedByName: clientName.trim() || undefined,
          techSignatureKey: techKey,
          clientSignatureKey: clientKey,
        },
        token,
      );
      if (res?.success === false) throw new Error(res?.message ?? "Could not sign the report");

      router.replace(`/scan/reports/${reportId}/print`);
    } catch (e: any) {
      setError(e?.message ?? "Could not sign the report");
      setSubmitting(false);
    }
  }, [techUrl, clientName, reportId, getToken, router]);

  if (error && !report) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
        <Button sx={{ mt: 2 }} startIcon={<ArrowBackIcon />} onClick={() => router.push("/scan/reports/ongoing")}>
          Back
        </Button>
      </Box>
    );
  }

  if (!report) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  const sd = report.serviceData ?? {};

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2.5 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => router.push("/scan/reports/ongoing")} sx={{ alignSelf: "flex-start" }}>
        Back
      </Button>

      <Box>
        <Typography variant="h6" fontWeight={700}>
          Sign report #{report.reportNumber ?? "—"}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {[sd.customerName, sd.model ?? report.asset?.name, sd.serial ?? report.inventory?.sku]
            .filter(Boolean)
            .join(" · ")}
        </Typography>
      </Box>

      <Divider />

      {step === "tech" ? (
        <Stack spacing={1.5}>
          <Typography variant="body2" fontWeight={600}>Service technician signature</Typography>
          <Box sx={{ border: "1px dashed", borderColor: "divider", borderRadius: 1, touchAction: "none" }}>
            <SignatureCanvas
              ref={techRef}
              penColor="black"
              onEnd={() => setTechDrawn(true)}
              canvasProps={{ width: 360, height: 200, style: { width: "100%", height: 200 } }}
            />
          </Box>
          <Stack direction="row" spacing={1}>
            <Button size="small" onClick={() => { techRef.current?.clear(); setTechDrawn(false); }}>Clear</Button>
          </Stack>
          <Button
            variant="contained"
            disabled={!techDrawn}
            onClick={() => {
              if (!techRef.current || techRef.current.isEmpty()) return;
              setTechUrl(techRef.current.getTrimmedCanvas().toDataURL("image/png"));
              setStep("client");
            }}
            sx={{ minHeight: 48 }}
          >
            Next
          </Button>
        </Stack>
      ) : (
        <Stack spacing={1.5}>
          <Typography variant="body2" sx={{ lineHeight: 1.5 }}>
            I / WE, the undersigned, certify that the above services are satisfied &amp; have
            examined the said machines are in good and proper condition.
          </Typography>
          <TextField label="Client name" value={clientName} onChange={(e) => setClientName(e.target.value)} fullWidth />
          <Box sx={{ border: "1px dashed", borderColor: "divider", borderRadius: 1, touchAction: "none" }}>
            <SignatureCanvas
              ref={clientRef}
              penColor="black"
              onEnd={() => setClientDrawn(true)}
              canvasProps={{ width: 360, height: 200, style: { width: "100%", height: 200 } }}
            />
          </Box>
          <Stack direction="row" spacing={1}>
            <Button size="small" onClick={() => { clientRef.current?.clear(); setClientDrawn(false); }}>Clear</Button>
            <Button size="small" onClick={() => setStep("tech")}>Back</Button>
          </Stack>
          <Button
            variant="contained"
            disabled={!clientDrawn || submitting}
            onClick={() => void finish()}
            sx={{ minHeight: 48 }}
          >
            {submitting ? <CircularProgress size={20} color="inherit" /> : "Sign and finish"}
          </Button>
        </Stack>
      )}

      {error && <Alert severity="error">{error}</Alert>}
    </Box>
  );
}
