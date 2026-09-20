"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Alert, Box, Button, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";

/**
 * AD-HOC DELIVERY — the two-button screen.
 *
 * Reached from the assign phase of delivery-start when the office has scheduled
 * nothing for this drop. By the time the rider arrives the run ALREADY exists:
 * it is numbered, this unit is an item on it, the guided condition photos are on
 * a DO_START report, GPS is running and the unit is reserved. Nothing is created
 * here — this only offers the two ways forward.
 *
 *   SCAN MORE ITEMS → /scan, the existing scan + serial entry. Each unit the
 *   rider starts from there joins THIS run (the backend's join-on-scan), and
 *   they come back to this screen to add another or finish.
 *
 *   START DELIVERY → POST /deliveries/:id/adhoc-ack, which marks every item
 *   delivered WITHOUT the hand-off stock flip (the unit must stay reserved —
 *   there is no project to deploy against), folding the run to `delivered`.
 *   Then the NORMAL signature page, which now sees an ordinary delivered run
 *   and needs no ad-hoc branch of its own.
 */
export default function AdHocDeliveryPage() {
  const { deliveryId } = useParams<{ deliveryId: string }>();
  const router = useRouter();
  const { getToken } = useAuth();

  const [run, setRun] = useState<{
    deliveryNumber: number;
    status: string;
    items: Array<{ id: string; description: string | null; sku: string | null; deliveryStatus: string }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-read on every return from the scan loop, so a newly added unit shows up.
  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await request({ path: `/deliveries/${deliveryId}`, method: "GET" }, {}, token);
      const data = res?.data ?? res;
      if (data?.id) setRun(data);
    } catch (e: any) {
      setError(e?.message ?? "Could not load this delivery");
    } finally {
      setLoading(false);
    }
  }, [deliveryId, getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const startDelivery = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request({ path: `/deliveries/${deliveryId}/adhoc-ack`, method: "POST" }, {}, token);
      if (res?.success === false) throw new Error(res?.message ?? "Could not start the delivery");
      // The run is now `delivered` — the ordinary signature page takes it from here.
      router.push(`/scan/delivery/${deliveryId}/finalize`);
    } catch (e: any) {
      setError(e?.message ?? "Could not start the delivery");
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ p: 3, display: "flex", justifyContent: "center", mt: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  const items = run?.items ?? [];

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2.5, alignItems: "center" }}>
      <LocalShippingIcon sx={{ fontSize: 64, color: "primary.main", mt: 2 }} />
      <Typography variant="h6" fontWeight={700} sx={{ textAlign: "center" }}>
        New delivery
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", maxWidth: 360 }}>
        {run ? `Delivery #${run.deliveryNumber}. ` : ""}
        Add every item going out on this trip, then take the customer&apos;s signature. The office
        attaches the project afterwards.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ width: "100%", maxWidth: 360 }}>
          {error}
        </Alert>
      )}

      {/* What is on the run so far — the rider's check before they sign. */}
      <Box sx={{ width: "100%", maxWidth: 360 }}>
        <Typography variant="caption" color="text.secondary">
          On this delivery ({items.length})
        </Typography>
        <Stack spacing={1} sx={{ mt: 0.5 }}>
          {items.length === 0 ? (
            <Alert severity="info">Nothing on this delivery yet — scan an item to add it.</Alert>
          ) : (
            items.map((it) => (
              <Box key={it.id} sx={{ p: 1.25, border: 1, borderColor: "divider", borderRadius: 1 }}>
                <Typography variant="body2" fontWeight={600}>
                  {it.description || "Item"}
                </Typography>
                {it.sku && (
                  <Typography variant="caption" color="text.secondary">
                    {it.sku}
                  </Typography>
                )}
              </Box>
            ))
          )}
        </Stack>
      </Box>

      <Divider flexItem sx={{ maxWidth: 360, width: "100%" }} />

      <Stack spacing={1.5} sx={{ width: "100%", maxWidth: 360 }}>
        <Button
          variant="outlined"
          startIcon={<QrCodeScannerIcon />}
          onClick={() => router.push("/scan")}
          fullWidth
          sx={{ minHeight: 52 }}
          disabled={busy}
        >
          Scan More Items
        </Button>
        <Button
          variant="contained"
          onClick={() => void startDelivery()}
          fullWidth
          sx={{ minHeight: 52 }}
          disabled={busy || items.length === 0}
        >
          {busy ? "Starting…" : "Start Delivery"}
        </Button>
      </Stack>

      <Button size="small" onClick={() => router.push("/scan")} disabled={busy}>
        Back to scan
      </Button>
    </Box>
  );
}
