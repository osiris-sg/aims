"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  CircularProgress,
  Divider,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { request } from "@/helpers/request";
import SignatureCapture, { CapturedSignatures } from "../../../components/SignatureCapture";
import { BatchSignResult, signReports, uploadSignaturePair } from "../../../lib/signReports";

/**
 * SIGN SEVERAL REPORTS AT ONCE.
 *
 * The case this exists for: one technician spends the morning on three machines
 * for one client, submits each report with Skip because the signatory is not
 * around, and at the end that one person signs ONCE for all three.
 *
 * Reached from Pending Sign with ?ids=a,b,c — the selection is made there, where
 * the reports are already grouped by customer, and that list is what enforces
 * ONE CUSTOMER PER BATCH. This screen re-reads every id and refuses to continue
 * if they do not all belong to the same customer, because a client can only
 * certify their own machines and the URL is editable.
 *
 * It uses the SAME pads (SignatureCapture) and the SAME per-report endpoint
 * (lib/signReports -> POST /maintenance-reports/:id/sign) as the single-report
 * screen. One signature pair is uploaded and its two S3 keys are applied to
 * every report, which is the honest record of what happened: one signature, on
 * one piece of paper, covering all of them.
 */
function SignBatchInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { getToken } = useAuth();

  const ids = useMemo(
    () => (params.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    [params],
  );

  const [reports, setReports] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<BatchSignResult[] | null>(null);

  useEffect(() => {
    (async () => {
      if (!ids.length) { setError("No reports were selected."); setReports([]); return; }
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const loaded = await Promise.all(
          ids.map(async (id) => {
            const res = await request({ path: `/maintenance-reports/${id}`, method: "GET" }, {}, token);
            return res?.data ?? res;
          }),
        );
        const found = loaded.filter((r) => r?.id);
        if (found.length !== ids.length) throw new Error("One of the selected reports could not be loaded.");
        // Already signed elsewhere while the selection sat on screen — drop them
        // rather than posting a sign the endpoint would refuse anyway.
        const open = found.filter((r) => r.status !== "completed");
        if (!open.length) throw new Error("Every selected report has already been signed.");
        // The URL is editable: re-prove the one-customer rule server-side data,
        // not just in the list's UI.
        // Array, not a Set spread — the portal's tsconfig target predates
        // downlevelIteration, so spreading a Set does not compile.
        const customers = Array.from(
          new Set(open.map((r) => ((r.serviceData?.customerName ?? "").trim() || "Unknown customer"))),
        );
        if (customers.length > 1) {
          throw new Error(
            `These reports belong to ${customers.length} different customers (${customers.join(", ")}). ` +
              "One client cannot sign for another — go back and select one customer's reports.",
          );
        }
        setReports(open);
      } catch (e: any) {
        setError(e?.message ?? "Could not load the selected reports");
        setReports([]);
      }
    })();
  }, [ids, getToken]);

  const finish = useCallback(
    async ({ techDataUrl, clientDataUrl, clientName }: CapturedSignatures) => {
      if (!reports?.length) return;
      setSubmitting(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        // Upload ONCE. Every report in the batch references the same two keys.
        const pair = await uploadSignaturePair(techDataUrl, clientDataUrl, token);
        const res = await signReports(reports.map((r) => r.id), pair, clientName, token);
        setResults(res);
        // All good and nothing to choose between — straight back to the list,
        // which re-reads on focus and will show them gone.
        if (res.every((r) => r.ok)) router.replace("/scan/reports/ongoing");
      } catch (e: any) {
        setError(e?.message ?? "Could not sign the reports");
      } finally {
        setSubmitting(false);
      }
    },
    [reports, getToken, router],
  );

  if (!reports) {
    return <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}><CircularProgress /></Box>;
  }

  const byId = new Map(reports.map((r) => [r.id, r]));
  const label = (r: any) =>
    `#${r?.reportNumber ?? "—"} ${r?.serviceData?.model ?? r?.asset?.name ?? "Report"}` +
    (r?.serviceData?.serial ?? r?.inventory?.sku ? ` · ${r?.serviceData?.serial ?? r?.inventory?.sku}` : "");

  // PARTIAL RESULT. Not a failure screen — the ones that went through are signed
  // and stay signed. The technician is still in front of the client, so the only
  // useful thing to show is exactly which ones still need them.
  if (results && results.some((r) => !r.ok)) {
    const ok = results.filter((r) => r.ok);
    const bad = results.filter((r) => !r.ok);
    return (
      <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
        <Typography variant="h6" fontWeight={700}>Partly signed</Typography>
        <Alert severity="warning">
          <AlertTitle>{ok.length} of {results.length} signed</AlertTitle>
          The rest are still waiting and stay in Pending Sign. Nothing was undone — retry just those.
        </Alert>
        <List dense sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
          {results.map((r) => (
            <ListItem key={r.reportId}>
              {r.ok ? <CheckCircleIcon color="success" sx={{ mr: 1.5 }} /> : <ErrorOutlineIcon color="error" sx={{ mr: 1.5 }} />}
              <ListItemText primary={label(byId.get(r.reportId))} secondary={r.ok ? "Signed" : r.error} />
            </ListItem>
          ))}
        </List>
        <Button
          variant="contained"
          sx={{ minHeight: 48 }}
          onClick={() => router.replace(`/scan/reports/sign-batch?ids=${bad.map((b) => b.reportId).join(",")}`)}
        >
          Retry the {bad.length} unsigned
        </Button>
        <Button onClick={() => router.push("/scan/reports/ongoing")}>Back to Pending Sign</Button>
      </Box>
    );
  }

  if (error && !reports.length) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
        <Button sx={{ mt: 2 }} startIcon={<ArrowBackIcon />} onClick={() => router.push("/scan/reports/ongoing")}>Back</Button>
      </Box>
    );
  }

  const customer = (reports[0]?.serviceData?.customerName ?? "").trim() || "Unknown customer";

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2.5 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => router.push("/scan/reports/ongoing")} sx={{ alignSelf: "flex-start" }}>
        Back
      </Button>

      <Box>
        <Typography variant="h6" fontWeight={700}>
          Sign {reports.length} report{reports.length === 1 ? "" : "s"}
        </Typography>
        <Typography variant="body2" color="text.secondary">{customer}</Typography>
      </Box>

      {/* What the client is putting their name to — shown before the pad, not
          after, so the signatory can see the machines listed. */}
      <List dense sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 0 }}>
        {reports.map((r) => (
          <ListItem key={r.id}><ListItemText primary={label(r)} secondary={r.serviceData?.serviceDate} /></ListItem>
        ))}
      </List>

      <Divider />

      <Stack spacing={0.5}>
        <Typography variant="body2" color="text.secondary">
          One signature covers all {reports.length}.
        </Typography>
      </Stack>

      <SignatureCapture
        initialClientName={reports[0]?.serviceData?.clientSignerName ?? ""}
        submitLabel={`Sign all ${reports.length}`}
        submitting={submitting}
        onComplete={(captured) => void finish(captured)}
        onBackFromTech={() => router.push("/scan/reports/ongoing")}
      />

      {error && <Alert severity="error">{error}</Alert>}
    </Box>
  );
}

// useSearchParams needs a Suspense boundary for the static build.
export default function SignBatchPage() {
  return (
    <Suspense fallback={<Box sx={{ display: "flex", justifyContent: "center", py: 10 }}><CircularProgress /></Box>}>
      <SignBatchInner />
    </Suspense>
  );
}
