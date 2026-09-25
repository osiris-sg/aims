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
 *   SCAN MORE ITEMS → the RUN BASKET for this delivery, /scan/delivery/:id.
 *   That is the run-first entry point and it already does exactly this job:
 *   inline NFC or manual serial resolve, a MANDATORY condition-photo step, then
 *   POST /deliveries/:id/items + DO_START — all bound to THIS run. It is passed
 *   ?returnTo=adhoc so the basket offers a "Done adding" button back to here.
 *
 *   It used to push to bare /scan. That had no run id at all, so the second unit
 *   started its own standalone run and never joined this one — a two-unit drop
 *   finished as a one-item DO. There is no join-on-scan on that route; the
 *   basket is the mechanism, so it is reused rather than rebuilt.
 *
 *   ACKNOWLEDGE DELIVERY → POST /deliveries/:id/adhoc-ack, which marks every
 *   item delivered WITHOUT the hand-off stock flip (the unit must stay reserved —
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

  // Re-read whenever the tab regains focus. The rider leaves for the basket to
  // add units and comes back; without this the item list below would still show
  // the run as it was before they added anything.
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load]);

  // NAMED FOR WHAT IT DOES. This does not start anything — the delivery started
  // when the first unit was scanned. It acknowledges every item and goes to the
  // signature page, and the proof row it writes is a DO_ACK, shown in the office
  // as "Delivery Acknowledged". The button used to read "Start Delivery", which
  // described a step that had already happened two screens earlier.
  const acknowledgeDelivery = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request({ path: `/deliveries/${deliveryId}/adhoc-ack`, method: "POST" }, {}, token);
      if (res?.success === false) throw new Error(res?.message ?? "Could not acknowledge the delivery");
      // The run is now `delivered` — the ordinary signature page takes it from here.
      router.push(`/scan/delivery/${deliveryId}/finalize`);
    } catch (e: any) {
      setError(e?.message ?? "Could not acknowledge the delivery");
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
          onClick={() => router.push(`/scan/delivery/${deliveryId}?returnTo=adhoc`)}
          fullWidth
          sx={{ minHeight: 52 }}
          disabled={busy}
        >
          Scan More Items
        </Button>
        <Button
          variant="contained"
          onClick={() => void acknowledgeDelivery()}
          fullWidth
          sx={{ minHeight: 52 }}
          disabled={busy || items.length === 0}
        >
          {busy ? "Acknowledging…" : "Acknowledge Delivery"}
        </Button>
      </Stack>

      <Button size="small" onClick={() => router.push("/scan")} disabled={busy}>
        Back
      </Button>
    </Box>
  );
}
