"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { request } from "@/helpers/request";
import { formatUnitLabel } from "../../../../lib/btPrinter";
import { DoPrintActions } from "../../../../components/DoPrintActions";

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

  // PARTIAL SIGN-OFF (2026-09): finalize sends a partly signed run here with
  // ?signed=N. The screen then reads "Signed for N items"; the run itself says it
  // is still open (status in_progress), so a reload keeps the right form.
  const signedParam = useSearchParams()?.get("signed");

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

  // The DO this run delivered. The API derives a run-level `document` —
  // "exactly one distinct DO across linked items" — and it is deliberately null
  // when a run spans two, because printing one of them arbitrarily would hand
  // the customer the wrong paperwork. Fall back to the first linked item only
  // when that field is absent. With neither, there is nothing to print and the
  // print button says so rather than emitting a blank page.
  const printableDoId = useMemo(
    () => run?.document?.id ?? run?.items.find((i) => i.document?.id)?.document?.id ?? null,
    [run],
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
          Back
        </Button>
      </Box>
    );
  }

  // Still open = a partial sign-off landed here. N comes from ?signed, falling
  // back to the run's completed items when the param is absent.
  const partlySigned = run.status !== "completed";
  const signedCount = Number(signedParam) || run.items.filter((i) => i.deliveryStatus === "completed").length;
  const remaining = run.items.filter((i) => i.deliveryStatus !== "completed").length;

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      {/* Confirmation only — no summary of what was created. */}
      <Stack alignItems="center" spacing={1} sx={{ py: 2 }}>
        <CheckCircleIcon color="success" sx={{ fontSize: 56 }} />
        <Typography variant="h5" fontWeight={800}>
          {partlySigned ? `Signed for ${signedCount} ${signedCount === 1 ? "item" : "items"}` : "Delivery completed"}
        </Typography>
        {partlySigned && remaining > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
            {remaining} {remaining === 1 ? "item is" : "items are"} still to deliver on this delivery. The customer signs
            again when they arrive.
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ fontFamily: "monospace" }}>
          Delivery #{run.deliveryNumber}
        </Typography>
      </Stack>

      {!ack && (
        <Alert severity="info">
          No signed delivery is stored for this run. The printout will show the items without a signature.
        </Alert>
      )}

      {/* Print DO / Download DO (native shell only), shared with the basket of a
          partly signed run. */}
      <DoPrintActions doId={printableDoId} />

      <Button
        variant="outlined"
        startIcon={<ArrowBackIcon />}
        onClick={() => router.replace(partlySigned ? "/scan?tab=progress" : "/scan")}
        fullWidth
        sx={FIELD_BUTTON_SX}
      >
        {partlySigned ? "Back to Deliveries" : "Back"}
      </Button>

    </Box>
  );
}
