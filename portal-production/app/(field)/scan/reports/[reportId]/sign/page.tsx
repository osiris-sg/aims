"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, CircularProgress, Divider, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { request } from "@/helpers/request";
import SignatureCapture, { CapturedSignatures } from "../../../../components/SignatureCapture";
import { signOneReport, uploadSignaturePair } from "../../../../lib/signReports";
import { uploadImage } from "@/helpers/imageUploader";
import GuidedPhotoCapture, { type CapturedPhoto } from "@/components/delivery/GuidedPhotoCapture";
import { photoSrc } from "@/components/maintenance/ReportPhotos";

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
 * sends the customer email that the unsigned submit deliberately withheld.
 *
 * The pads and the upload+post now live in SignatureCapture and lib/signReports
 * so the BATCH screen reuses them rather than a second signing surface existing
 * beside this one. This screen's behaviour is unchanged by that move: still one
 * report, still its own fresh signature pair, still straight to the print page.
 */
export default function SignReportPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const router = useRouter();
  const { getToken } = useAuth();

  const [report, setReport] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Optional photos on the draft: add or remove before signing. Each change is
  // saved to the draft; signing waits for the last save.
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [photosUploading, setPhotosUploading] = useState(false);
  const [photoState, setPhotoState] = useState<"saved" | "saving" | "error" | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());

  const savePhotos = useCallback(
    (next: CapturedPhoto[]) => {
      setPhotoState("saving");
      saveChain.current = saveChain.current.then(async () => {
        try {
          const token = await getToken();
          if (!token) throw new Error("Not signed in");
          const res = await request(
            { path: `/maintenance-reports/${reportId}/photos`, method: "PATCH" },
            { photos: next.map((p) => p.key) },
            token,
          );
          if (res?.success === false) throw new Error(res?.message ?? "Could not save the photos");
          setPhotoState("saved");
        } catch {
          setPhotoState("error");
        }
      });
    },
    [getToken, reportId],
  );

  const onPhotosChange = (next: CapturedPhoto[]) => {
    setPhotos(next);
    savePhotos(next);
  };

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
        setPhotos(((data.photos ?? []) as string[]).map((key) => ({ key, previewUrl: photoSrc(key) })));
      } catch (e: any) {
        setError(e?.message ?? "Could not load the report");
      }
    })();
  }, [reportId, getToken, router]);

  const finish = useCallback(
    async ({ techDataUrl, clientDataUrl, clientName }: CapturedSignatures) => {
      setSubmitting(true);
      setError(null);
      try {
        // The draft's photos must be saved before the report is signed.
        await saveChain.current;
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const pair = await uploadSignaturePair(techDataUrl, clientDataUrl, token);
        await signOneReport(reportId, pair, clientName, token);
        router.replace(`/scan/reports/${reportId}/print`);
      } catch (e: any) {
        setError(e?.message ?? "Could not sign the report");
        setSubmitting(false);
      }
    },
    [reportId, getToken, router],
  );

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

      {report.kind === "SERVICE" && (
        <>
          <GuidedPhotoCapture
            photos={photos}
            onChange={onPhotosChange}
            upload={async (blob) => {
              const token = await getToken();
              if (!token) throw new Error("Not signed in");
              return uploadImage({ blob, folderName: "maintenance-reports", token });
            }}
            minPhotos={0}
            maxPhotos={12}
            title="Photos (optional)"
            noun="a report"
            disabled={submitting}
            onError={(m) => setError(m || null)}
            onUploadingChange={setPhotosUploading}
          />
          {photoState === "saving" && (
            <Typography variant="caption" color="text.secondary">
              Saving photos…
            </Typography>
          )}
          {photoState === "error" && <Alert severity="warning">The photos could not be saved. Remove and add one again to retry.</Alert>}
          <Divider />
        </>
      )}

      <SignatureCapture
        initialClientName={sd.clientSignerName ?? ""}
        submitting={submitting || photosUploading}
        onComplete={(captured) => void finish(captured)}
      />

      {error && <Alert severity="error">{error}</Alert>}
    </Box>
  );
}
