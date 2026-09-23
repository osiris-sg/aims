"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, CircularProgress, LinearProgress, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PrintIcon from "@mui/icons-material/Print";
import DownloadIcon from "@mui/icons-material/Download";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { request } from "@/helpers/request";
import { isSystemPrintAvailable } from "../../../../lib/systemPrint";
import { useMsrPrint } from "../../../../components/MsrPrintSurface";

/**
 * PRINT / DOWNLOAD A SIGNED MAINTENANCE REPORT.
 *
 * Reached automatically after signing, and from the completed list. The two
 * actions mirror Print DO exactly: print goes to Android's dialog; download
 * saves a PDF to the tablet, because the X1000's WiFi hotspot has no internet
 * and the rider cannot be on it and on ours at once.
 *
 * GATED ON BOTH SIGNATURES. An unsigned report must not be printable from
 * here: what would come out is a document with an empty "Received in good
 * order by" line, which reads as an acknowledgment that never happened. A
 * report still awaiting signature is redirected to the signing screen.
 */
export default function PrintReportPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const router = useRouter();
  const { getToken } = useAuth();
  const { surface, printReport, downloadReport, busy } = useMsrPrint();

  const [report, setReport] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const res = await request({ path: `/maintenance-reports/${reportId}`, method: "GET" }, {}, token);
        const data = res?.data ?? res;
        if (!data?.id) throw new Error("Report not found");
        setReport(data);
      } catch (e: any) {
        setError(e?.message ?? "Could not load the report");
      }
    })();
  }, [reportId, getToken]);

  // Both signatures must exist — see the docblock.
  const sd = report?.serviceData ?? {};
  const signed = Boolean(report && report.status === "completed" && sd.techSignatureKey && sd.clientSignatureKey);

  useEffect(() => {
    if (report && report.status !== "completed") {
      router.replace(`/scan/reports/${reportId}/sign`);
    }
  }, [report, reportId, router]);

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
        <Button sx={{ mt: 2 }} startIcon={<ArrowBackIcon />} onClick={() => router.push("/scan/reports")}>
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

  const act = async (what: "print" | "download") => {
    setMsg(null);
    try {
      if (what === "print") {
        await printReport(reportId);
        setMsg({ ok: true, text: "Print dialog opened — pick the printer there." });
      } else {
        const saved = await downloadReport(reportId);
        setMsg({ ok: true, text: `Saved to Downloads as ${saved.fileName}` });
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? "That did not work." });
    }
  };

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2, alignItems: "center", textAlign: "center" }}>
      <CheckCircleIcon sx={{ fontSize: 80, color: "success.main", mt: 3 }} />
      <Typography variant="h6" fontWeight={700}>
        Report #{report.reportNumber ?? "—"} signed
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360 }}>
        {[sd.customerName, sd.model ?? report.asset?.name, sd.serial ?? report.inventory?.sku]
          .filter(Boolean)
          .join(" · ")}
      </Typography>

      <Stack spacing={1.5} sx={{ width: "100%", maxWidth: 360, mt: 1 }}>
        <Button
          variant="contained"
          startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <PrintIcon />}
          onClick={() => void act("print")}
          disabled={!signed || !!busy || !isSystemPrintAvailable()}
          fullWidth
          sx={{ minHeight: 52 }}
        >
          Print Report
        </Button>
        <Button
          variant="outlined"
          startIcon={<DownloadIcon />}
          onClick={() => void act("download")}
          disabled={!signed || !!busy || !isSystemPrintAvailable()}
          fullWidth
          sx={{ minHeight: 52 }}
        >
          Download Report
        </Button>
      </Stack>

      {!isSystemPrintAvailable() && (
        <Alert severity="info" sx={{ width: "100%", maxWidth: 360 }}>
          Printing and saving need the AIMS Field app.
        </Alert>
      )}

      {busy && (
        <Box sx={{ width: "100%", maxWidth: 360 }}>
          <LinearProgress />
          <Typography variant="caption" color="text.secondary">{busy}</Typography>
        </Box>
      )}

      {msg && (
        <Alert severity={msg.ok ? "success" : "error"} sx={{ width: "100%", maxWidth: 360 }} onClose={() => setMsg(null)}>
          {msg.text}
        </Alert>
      )}

      <Button onClick={() => router.push("/scan/reports")} sx={{ mt: 1 }}>
        Back to reports
      </Button>

      {/* Offscreen render of the office layout — nothing visible. */}
      {surface}
    </Box>
  );
}
