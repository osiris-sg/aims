"use client";

import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, CircularProgress, Stack } from "@mui/material";
import PrintIcon from "@mui/icons-material/Print";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import { request } from "@/helpers/request";

/**
 * A WCT service report on the office page (2026-10-27).
 *
 * The WCT paper is drawn ONLY by the server (letterhead on every page, photo
 * pages, the SCDF / NEA advisory, the frequency table) — the same HTML the
 * customer's PDF is printed from. The office sees that HTML in an iframe
 * instead of a second, hand-drawn copy of the paper: what the office sees is
 * what the customer got. Print prints the iframe (the paper, not the portal
 * chrome); Download fetches the server's PDF through the authenticated API.
 */

const API = (process.env.NEXT_PUBLIC_BACKEND_API_URL || "").replace(/\/$/, "");
const A4_WIDTH_PX = 794;

export default function WctReportView({ reportId, reportNumber }: { reportId: string; reportNumber: number | null }) {
  const { getToken } = useAuth();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [height, setHeight] = useState(1123);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const res = await request({ path: `/maintenance-reports/${reportId}/html`, method: "GET" }, {}, token);
        if (cancelled) return;
        const served: string | undefined = res?.data?.html ?? res?.html;
        if (!served) throw new Error(res?.message ?? "Could not render the report");
        setHtml(served);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Could not render the report");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reportId, getToken]);

  // Size the frame to its document so the page scrolls, not the frame.
  const fit = () => {
    const doc = frameRef.current?.contentDocument;
    const h = doc?.documentElement?.scrollHeight ?? doc?.body?.scrollHeight;
    if (h && h > 200) setHeight(h + 24);
  };

  const print = () => {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    win.focus();
    win.print();
  };

  const download = async () => {
    setBusy("Preparing the PDF…");
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      // Admin "Viewing as org": the API scopes the read to this org.
      try {
        const aorg = window.sessionStorage.getItem("aims-admin-active-org");
        if (aorg) headers["X-Active-Org-Id"] = aorg;
      } catch {
        /* sessionStorage unavailable — plain org read */
      }
      const res = await fetch(`${API}/maintenance-reports/${reportId}/pdf`, { headers });
      if (!res.ok) throw new Error(`Could not download the PDF (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `service-report-${reportNumber != null ? String(reportNumber).padStart(6, "0") : reportId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e: any) {
      setError(e?.message ?? "Could not download the PDF");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap" sx={{ "@media print": { display: "none" } }}>
        <Button variant="outlined" startIcon={<PictureAsPdfIcon />} onClick={download} disabled={!html || !!busy} data-tour="service-report-download-pdf">
          {busy ?? "Download PDF"}
        </Button>
        <Button variant="contained" startIcon={<PrintIcon />} onClick={print} disabled={!html} data-tour="service-report-print">
          Print
        </Button>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {!html && !error && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      )}
      {html && (
        // White paper on a neutral backdrop in both themes; the frame is the
        // document, so the portal's dark palette never reaches it.
        <Box sx={{ bgcolor: "action.hover", p: { xs: 1, md: 3 }, borderRadius: 1, overflowX: "auto" }}>
          <Box
            component="iframe"
            ref={frameRef}
            title="Service report"
            srcDoc={html}
            onLoad={fit}
            sx={{ display: "block", width: A4_WIDTH_PX, maxWidth: "100%", height, border: 0, bgcolor: "#fff", mx: "auto", boxShadow: 3 }}
          />
        </Box>
      )}
    </Box>
  );
}
