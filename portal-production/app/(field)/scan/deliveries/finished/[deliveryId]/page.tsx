"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PrintIcon from "@mui/icons-material/Print";
import DownloadIcon from "@mui/icons-material/Download";
import LinearProgress from "@mui/material/LinearProgress";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { request } from "@/helpers/request";
import { formatUnitLabel } from "../../../../lib/btPrinter";
import { isSystemPrintAvailable } from "../../../../lib/systemPrint";
import { useDoA4Print } from "../../../../components/DoA4Print";

/**
 * "Delivery completed" final screen (field). Reached both as the LANDING right
 * after a run completes (finalize / standalone install-sign redirect here) and
 * from the reprint list (/scan/deliveries/finished). Deliberately minimal:
 * a completion confirmation, the Print DO action, and the way back to scan.
 *
 * Print renders the run's DELIVERY ORDER — the same A4 document the portal
 * prints — and sends it to a Bluetooth printer as ESC/POS raster, from data
 * already stored on the RUN (items + the DO_ACK proof MSR) — one signature at
 * the bottom, the original hand-off date. No new signature is captured. The run
 * is still fetched in full below; the print reads that object, not the screen,
 * so trimming the visible summary does not change what the printer receives.
 */

const FIELD_BUTTON_SX = { py: 1.5, fontSize: "1rem", minHeight: 48 } as const;

interface RunItem {
  id: string;
  deliveryStatus: "not_delivered" | "delivering" | "not_installed" | "completed";
  quantity: number | null;
  description: string | null;
  installSkipped: boolean | null;
  inventory: { sku: string | null; serialNumber: string | null } | null;
  asset: { name: string | null } | null;
  // Each item carries its own DO — GET /deliveries/:id includes it. Printing
  // needs the document id, not the run id: the A4 render IS the DO.
  document: { id: string; name: string | null } | null;
}

interface Report {
  kind: string;
  signature: string | null;
  signedByName: string | null;
  signedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
}

interface Run {
  id: string;
  deliveryNumber: number;
  // Run-level DO, derived server-side: set only when every linked item shares
  // one document. Null on a multi-DO run — see printableDoId.
  document: { id: string; name: string | null } | null;
  status: string;
  siteAddress: string | null;
  completedAt: string | null;
  createdAt: string;
  items: RunItem[];
  reports: Report[];
  project: { id: string; name: string } | null;
  customer: { id: string; name: string } | null;
}

// Unit-based → "SKU — Asset name"; free-typed → description; else "Item".
const itemLabel = (i: RunItem): string =>
  formatUnitLabel({ sku: i.inventory?.sku, assetName: i.asset?.name, description: i.description });

export default function FinishedDeliveryDetailPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const params = useParams();
  const deliveryId = String(params?.deliveryId ?? "");

  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Printing UI (mirrors the after-ack "done" step).
  const [printing, setPrinting] = useState(false);
  const [printMsg, setPrintMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          setError("Not signed in");
          return;
        }
        const res = await request({ path: `/deliveries/${deliveryId}`, method: "GET" }, {}, token);
        if (res.success === false) throw new Error(res.message ?? "Failed to load delivery");
        setRun((res.data ?? res) as Run);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load delivery");
      } finally {
        setLoading(false);
      }
    })();
  }, [getToken, deliveryId]);

  // The hand-off proof: latest DO_ACK MSR carrying a signature. That row's
  // signedByName is the recipient; its lat/long the GPS at hand-off. Feeds the
  // printed receipt (signature + recipient + GPS).
  const ack = useMemo(() => {
    if (!run) return null;
    const acks = run.reports.filter((r) => r.kind === "DO_ACK" && r.signature);
    if (!acks.length) return null;
    return acks.reduce((a, b) =>
      new Date(b.signedAt ?? b.createdAt).getTime() >= new Date(a.signedAt ?? a.createdAt).getTime() ? b : a,
    );
  }, [run]);

  // Installation happened if any real unit was installed (completed & not
  // skip-installed). Free-typed / skipped items don't flip this on. Printed on
  // the receipt.
  const installNeeded = useMemo(
    () => !!run?.items.some((i) => i.deliveryStatus === "completed" && !i.installSkipped),
    [run],
  );

  // Print DO goes through ANDROID'S print system now: the printer is a 小篆
  // X1000, a WiFi colour inkjet, which no Bluetooth path can reach. `surface`
  // must be mounted — it is the offscreen A4 render being printed.
  const { surface: printSurface, printDoViaSystem, downloadDo, progress: printProgress } = useDoA4Print();

  // The DO this run delivered. The API derives a run-level `document` —
  // "exactly one distinct DO across linked items" — and it is deliberately null
  // when a run spans two, because printing one of them arbitrarily would hand
  // the customer the wrong paperwork. Fall back to the first linked item only
  // when that field is absent. With neither, there is nothing to print and the
  // button says so rather than emitting a blank page.
  const printableDoId = useMemo(
    () => run?.document?.id ?? run?.items.find((i) => i.document?.id)?.document?.id ?? null,
    [run],
  );

  const doPrint = useCallback(async () => {
    if (!run) return;
    if (!printableDoId) {
      setPrintMsg({ ok: false, text: "This run has no delivery order linked to it yet, so there is nothing to print." });
      return;
    }
    setPrinting(true);
    setPrintMsg(null);
    try {
      await printDoViaSystem(printableDoId);
      // The dialog is now Android's. It owns printer choice, settings and
      // cancellation, and reports none of that back — so this says the handover
      // happened, not that paper came out.
      setPrintMsg({ ok: true, text: "Print dialog opened — pick the printer there." });
    } catch (e: any) {
      setPrintMsg({ ok: false, text: e?.message ?? "Could not open the print dialog." });
    } finally {
      setPrinting(false);
    }
  }, [run, printableDoId, printDoViaSystem]);

  /**
   * Download DO — save the PDF to the tablet, then offer the share sheet.
   * Same render, same print CSS, same serialiser as Print DO; only the
   * destination differs, so the saved file is the document that would print.
   */
  const doDownload = async () => {
    if (!printableDoId) {
      setPrintMsg({ ok: false, text: "This run has no delivery order linked to it yet, so there is nothing to download." });
      return;
    }
    setPrinting(true);
    setPrintMsg(null);
    try {
      const saved = await downloadDo(printableDoId);
      setPrintMsg({ ok: true, text: `Saved to Downloads as ${saved.fileName}` });
    } catch (e: any) {
      setPrintMsg({ ok: false, text: e?.message ?? "Could not save the PDF." });
    } finally {
      setPrinting(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !run) {
    return (
      <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
        <Alert severity="error">{error ?? "Delivery not found"}</Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={() => router.replace("/scan")}>
          Back
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      {/* Confirmation only — no summary of what was created. */}
      <Stack alignItems="center" spacing={1} sx={{ py: 2 }}>
        <CheckCircleIcon color="success" sx={{ fontSize: 56 }} />
        <Typography variant="h5" fontWeight={800}>
          Delivery completed
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ fontFamily: "monospace" }}>
          Delivery #{run.deliveryNumber}
        </Typography>
      </Stack>

      {!ack && (
        <Alert severity="info">
          No signed delivery is stored for this run. The printout will show the items without a signature.
        </Alert>
      )}

      {/* Print DO — native shell only: window.print() is a no-op in an Android
          WebView, so this goes through the native SystemPrint plugin to
          Android's PrintManager. Same gate as the live after-ack flow. */}
      {isSystemPrintAvailable() ? (
        <Button
          variant="contained"
          startIcon={printing ? <CircularProgress size={18} /> : <PrintIcon />}
          onClick={() => void doPrint()}
          disabled={printing}
          fullWidth
          sx={FIELD_BUTTON_SX}
        >
          {printing ? "Printing…" : "Print DO"}
        </Button>
      ) : (
        <Tooltip title="Printing needs the AIMS Field app">
          <span style={{ width: "100%" }}>
            <Button variant="contained" startIcon={<PrintIcon />} disabled fullWidth sx={FIELD_BUTTON_SX}>
              Print DO
            </Button>
          </span>
        </Tooltip>
      )}

      {/* Download DO — the X1000 serves its own WiFi hotspot with no internet,
          so the tablet cannot be on the printer's network and on ours at once.
          Saving the PDF first lets the rider join that hotspot afterwards and
          print from the printer's own app. */}
      {isSystemPrintAvailable() && (
        <Button
          variant="outlined"
          startIcon={<DownloadIcon />}
          onClick={() => void doDownload()}
          disabled={printing}
          fullWidth
          sx={FIELD_BUTTON_SX}
        >
          Download DO
        </Button>
      )}

      {/* A full page is a large transfer over SPP — show the rider it is moving. */}
      {printing && (
        <Box sx={{ width: "100%", maxWidth: 360, mb: 1 }}>
          <LinearProgress
            variant={printProgress ? "determinate" : "indeterminate"}
            value={printProgress ? Math.round(printProgress.fraction * 100) : undefined}
          />
          <Typography variant="caption" color="text.secondary">
            {printProgress?.label ?? "Preparing…"}
            {printProgress ? ` ${Math.round(printProgress.fraction * 100)}%` : ""}
          </Typography>
        </Box>
      )}

      {printMsg && (
        <Alert
          severity={printMsg.ok ? "success" : "error"}
          action={
            !printMsg.ok ? (
              <Button size="small" onClick={() => void doPrint()} disabled={printing}>
                Retry
              </Button>
            ) : undefined
          }
          onClose={() => setPrintMsg(null)}
        >
          {printMsg.text}
        </Alert>
      )}

      <Button
        variant="outlined"
        startIcon={<ArrowBackIcon />}
        onClick={() => router.replace("/scan")}
        fullWidth
        sx={FIELD_BUTTON_SX}
      >
        Back
      </Button>

      {/* Offscreen A4 render — nothing visible. */}
      {printSurface}
    </Box>
  );
}
