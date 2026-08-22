"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PrintIcon from "@mui/icons-material/Print";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { request } from "@/helpers/request";
import {
  isPrinterAvailable,
  getSavedPrinter,
  savePrinter,
  listBondedDevices,
  buildDeliveryReceipt,
  formatUnitLabel,
  printBytes,
  type SavedPrinter,
} from "../../../../lib/btPrinter";

/**
 * "Delivery completed" final screen (field). Reached both as the LANDING right
 * after a run completes (finalize / standalone install-sign redirect here) and
 * from the reprint list (/scan/deliveries/finished). Deliberately minimal:
 * a completion confirmation, the Print DO action, and the way back to scan.
 *
 * Print rebuilds the itemised delivery receipt (buildDeliveryReceipt) from data
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
  const [printerDialogOpen, setPrinterDialogOpen] = useState(false);
  const [bondedDevices, setBondedDevices] = useState<SavedPrinter[] | null>(null);

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

  const doPrint = useCallback(
    async (device?: SavedPrinter) => {
      if (!run) return;
      const target = device ?? getSavedPrinter();
      if (!target) {
        setPrintMsg(null);
        setPrinterDialogOpen(true);
        setBondedDevices(null);
        try {
          setBondedDevices(await listBondedDevices());
        } catch (e: any) {
          setPrintMsg({ ok: false, text: e?.message ?? "Could not list Bluetooth devices" });
        }
        return;
      }
      setPrinting(true);
      setPrintMsg(null);
      try {
        const bytes = await buildDeliveryReceipt({
          deliveryNumber: run.deliveryNumber,
          items: run.items.map((i) => ({ label: itemLabel(i), quantity: i.quantity ?? undefined })),
          customer: run.customer?.name ?? null,
          project: run.project?.name ?? null,
          siteAddress: run.siteAddress,
          gps: ack?.latitude != null && ack?.longitude != null ? { latitude: ack.latitude, longitude: ack.longitude } : null,
          // Keep the original hand-off date, not today's.
          dateLabel: new Date(ack?.signedAt ?? run.completedAt ?? run.createdAt).toLocaleString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }),
          installNeeded,
          signatureDataUrl: ack?.signature ?? null,
          recipientName: ack?.signedByName ?? null,
        });
        await printBytes(bytes, target);
        setPrintMsg({ ok: true, text: `Printed on ${target.name}` });
      } catch (e: any) {
        setPrintMsg({ ok: false, text: e?.message ?? "Print failed. Check the printer is on and in range." });
      } finally {
        setPrinting(false);
      }
    },
    [run, ack, installNeeded],
  );

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
          Back to scan
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

      {/* Print DO — native shell only (Classic SPP; Web Bluetooth can't reach a
          58mm SPP printer), same gate as the live after-ack flow. */}
      {isPrinterAvailable() ? (
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
        <Tooltip title="Printing needs the AIMS Field app (Bluetooth printer support)">
          <span style={{ width: "100%" }}>
            <Button variant="contained" startIcon={<PrintIcon />} disabled fullWidth sx={FIELD_BUTTON_SX}>
              Print DO
            </Button>
          </span>
        </Tooltip>
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
        Back to scan
      </Button>

      {/* First-print device picker: bonded devices only; pairing lives in
          Android Settings. Remembered per phone in localStorage. */}
      <Dialog open={printerDialogOpen} onClose={() => !printing && setPrinterDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Choose printer</DialogTitle>
        <DialogContent>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            Showing devices already paired in Android Settings. Pair the printer
            there first if it isn&apos;t listed.
          </Typography>
          {!bondedDevices ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
              <CircularProgress size={26} />
            </Box>
          ) : bondedDevices.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
              No paired Bluetooth devices found.
            </Typography>
          ) : (
            <List dense>
              {bondedDevices.map((d) => (
                <ListItemButton
                  key={d.mac}
                  onClick={() => {
                    savePrinter(d);
                    setPrinterDialogOpen(false);
                    void doPrint(d);
                  }}
                >
                  <ListItemText primary={d.name} secondary={d.mac} />
                </ListItemButton>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPrinterDialogOpen(false)}>Cancel</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
