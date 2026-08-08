"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PrintIcon from "@mui/icons-material/Print";
import { request } from "@/helpers/request";
import {
  isPrinterAvailable,
  getSavedPrinter,
  savePrinter,
  listBondedDevices,
  buildDeliveryReceipt,
  printBytes,
  type SavedPrinter,
} from "../../../../lib/btPrinter";

/**
 * Finished-delivery detail + REPRINT (field). Read-only view of one of the
 * rider's completed runs, reached from /scan/deliveries/finished. The REPRINT
 * button rebuilds the exact same itemised run receipt as the live after-ack
 * flow (buildDeliveryReceipt) — full manifest, one signature at the bottom —
 * from data already stored on the run (items + the DO_ACK proof MSR). No new
 * signature is captured; this reprints what was signed at hand-off.
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
  [i.inventory?.sku, i.asset?.name].filter(Boolean).join(" — ") || i.description || "Item";

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
  // signedByName is the recipient; its lat/long the GPS at hand-off.
  const ack = useMemo(() => {
    if (!run) return null;
    const acks = run.reports.filter((r) => r.kind === "DO_ACK" && r.signature);
    if (!acks.length) return null;
    return acks.reduce((a, b) =>
      new Date(b.signedAt ?? b.createdAt).getTime() >= new Date(a.signedAt ?? a.createdAt).getTime() ? b : a,
    );
  }, [run]);

  // Installation happened if any real unit was installed (completed & not
  // skip-installed). Free-typed / skipped items don't flip this on.
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
          // Reprint keeps the original hand-off date, not today's.
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
        setPrintMsg({ ok: false, text: e?.message ?? "Print failed — check the printer is on and in range" });
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
        <Button startIcon={<ArrowBackIcon />} onClick={() => router.replace("/scan/deliveries/finished")}>
          Back to finished deliveries
        </Button>
      </Box>
    );
  }

  const dateLabel = new Date(run.completedAt ?? run.createdAt).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Button
          startIcon={<ArrowBackIcon />}
          size="small"
          onClick={() => router.replace("/scan/deliveries/finished")}
          sx={{ color: "text.secondary" }}
        >
          Back
        </Button>
      </Stack>

      <Stack direction="row" alignItems="baseline" spacing={1}>
        <Typography variant="h6" fontWeight={700} sx={{ fontFamily: "monospace" }}>
          Delivery #{run.deliveryNumber}
        </Typography>
      </Stack>

      <Card variant="outlined">
        <CardContent sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
          {run.customer?.name && (
            <Typography variant="body2">
              <b>Customer:</b> {run.customer.name}
            </Typography>
          )}
          {run.project?.name && (
            <Typography variant="body2">
              <b>Project:</b> {run.project.name}
            </Typography>
          )}
          {run.siteAddress && (
            <Typography variant="body2">
              <b>Site:</b> {run.siteAddress}
            </Typography>
          )}
          <Typography variant="body2">
            <b>Completed:</b> {dateLabel}
          </Typography>
          <Typography variant="body2">
            <b>Installation:</b> {installNeeded ? "completed" : "not required"}
          </Typography>
          {ack?.signedByName && (
            <Typography variant="body2">
              <b>Received by:</b> {ack.signedByName}
            </Typography>
          )}
        </CardContent>
      </Card>

      <Typography variant="subtitle2" color="text.secondary">
        Items ({run.items.length})
      </Typography>
      <Card variant="outlined">
        <CardContent sx={{ py: 1 }}>
          <Stack divider={<Divider flexItem />} spacing={0.5}>
            {run.items.map((i) => (
              <Box key={i.id} sx={{ py: 0.75 }}>
                <Typography variant="body2" fontWeight={600}>
                  {itemLabel(i)}
                  {i.quantity && i.quantity > 1 ? ` ×${i.quantity}` : ""}
                </Typography>
              </Box>
            ))}
          </Stack>
        </CardContent>
      </Card>

      {!ack && (
        <Alert severity="info">
          No signed acknowledgement is stored for this run — the reprint will show the items without a signature.
        </Alert>
      )}

      {/* REPRINT — native shell only (Classic SPP; Web Bluetooth can't reach a
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
          {printing ? "Printing…" : "Reprint receipt"}
        </Button>
      ) : (
        <Tooltip title="Printing needs the AIMS Field app (Bluetooth printer support)">
          <span style={{ width: "100%" }}>
            <Button variant="contained" startIcon={<PrintIcon />} disabled fullWidth sx={FIELD_BUTTON_SX}>
              Reprint receipt
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
