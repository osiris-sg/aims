"use client";

// Invoices tab → a Sales invoice that was finalized from an in-app trade
// document (e.g. the 請求書 template): shows that PDF instead of the generic
// invoice editor, with "Open in editor" (the generated-document editor) and
// links to the contracts / shipments it bills. Opened from DocumentListView
// when the invoice's config carries tradeGeneratedDocId.

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Alert, Box, Button, Chip, CircularProgress, IconButton, Paper, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DownloadIcon from "@mui/icons-material/Download";
import EditIcon from "@mui/icons-material/Edit";
import { toast } from "@/app/portal/shipments/_lib/toast";
import { useShipmentsApi } from "@/app/portal/shipments/_lib/api";
import { useDocTypeLabels, useGeneratedForDocument } from "@/app/portal/shipments/_lib/hooks";
import DocPages from "@/app/portal/shipments/_components/DocPages";

export default function TradeInvoiceViewerPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const api = useShipmentsApi();
  const label = useDocTypeLabels();
  const q = useGeneratedForDocument(documentId);
  const g = q.data;
  const [pdf, setPdf] = useState<{ blob: Blob; name: string } | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const from = params?.get("from");
  const backHref = from && from.startsWith("/portal") ? from : "/portal/invoicing";
  const here = `/portal/trade-documents/invoice/${documentId}${from ? `?from=${encodeURIComponent(from)}` : ""}`;

  // Load the PDF (stored copy when final, else a DRAFT render); DocPages renders it in-app.
  useEffect(() => {
    if (!g?.id) return;
    let cancelled = false;
    setPdfError(null);
    api
      .generatedPdf(g.id)
      .then(({ blob, name }) => {
        if (!cancelled) setPdf({ blob, name });
      })
      .catch((e: Error) => !cancelled && setPdfError(e.message));
    return () => {
      cancelled = true;
    };
  }, [api, g?.id, g?.status]);

  const download = () => {
    if (!g) return;
    setBusy(true);
    api
      .downloadGeneratedPdf(g.id)
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setBusy(false));
  };

  if (q.isLoading) {
    return (
      <Box sx={{ p: 4, display: "flex", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }
  if (q.isError || !g) {
    return (
      <Box sx={{ p: { xs: 1.5, md: 3 } }}>
        <Alert severity="warning">{(q.error as Error)?.message || "This invoice has no in-app document."}</Alert>
        <Button sx={{ mt: 2 }} onClick={() => router.push(backHref)}>
          Back
        </Button>
      </Box>
    );
  }

  const isFinal = g.status === "FINAL";
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 } }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1, flexWrap: "wrap", rowGap: 1 }}>
        <IconButton size="small" aria-label="Back" onClick={() => router.push(backHref)}>
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          {g.number || label(g.docType)}
        </Typography>
        <Chip size="small" variant="outlined" label={label(g.docType)} />
        <Chip size="small" variant="outlined" color={isFinal ? "success" : "warning"} label={isFinal ? "Final" : "Draft"} />
        <Box sx={{ flex: 1 }} />
        <Button variant="outlined" startIcon={busy ? <CircularProgress size={14} /> : <DownloadIcon />} onClick={download} disabled={busy}>
          Download PDF
        </Button>
        <Button variant="contained" startIcon={<EditIcon />} component={Link} href={`/portal/trade-documents/generated/${g.id}?from=${encodeURIComponent(here)}`}>
          Open in editor
        </Button>
      </Stack>

      {(g.contracts.length > 0 || g.shipments.length > 0) && (
        <Stack direction="row" spacing={2} sx={{ mb: 2, ml: 5, flexWrap: "wrap", rowGap: 0.5 }}>
          {g.contracts.map((c) => (
            <Typography key={c.id} variant="body2" color="text.secondary">
              Contract{" "}
              <Link href={`/portal/shipments/contracts/${c.id}`} style={{ color: "inherit", fontWeight: 600 }}>
                {c.contractNo}
              </Link>
            </Typography>
          ))}
          {g.shipments.map((s) => (
            <Typography key={s.id} variant="body2" color="text.secondary">
              Shipment{" "}
              <Link href={`/portal/shipments/${s.id}`} style={{ color: "inherit", fontWeight: 600 }}>
                {s.blNumber ? `B/L ${s.blNumber}` : s.contractNo ? `${s.contractNo} (no B/L yet)` : "Open"}
              </Link>
            </Typography>
          ))}
        </Stack>
      )}

      <Paper variant="outlined" sx={{ p: 1, bgcolor: "background.default" }}>
        {pdfError ? (
          <Alert severity="error">{pdfError}</Alert>
        ) : pdf ? (
          <Box sx={{ height: { xs: "70vh", md: "calc(100vh - 200px)" } }}>
            <DocPages src={{ blob: pdf.blob }} fileName={pdf.name} mimeType="application/pdf" />
          </Box>
        ) : (
          <Box sx={{ p: 6, display: "flex", justifyContent: "center" }}>
            <CircularProgress />
          </Box>
        )}
      </Paper>
    </Box>
  );
}
