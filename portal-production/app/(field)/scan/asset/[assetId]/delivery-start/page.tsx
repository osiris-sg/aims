"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth, useUser } from "@clerk/nextjs";
import { Alert, Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import { request } from "@/helpers/request";
import { useBackgroundLocationContext } from "../../../../context/BackgroundLocationContext";

/**
 * Start Delivery — first step of the two-step delivery flow. Enabled only
 * when an open DO exists for this asset and has not been started yet
 * (see canStartDelivery in getScanContext).
 *
 * Simplified flow: a single confirmation button. No notes, photos, or
 * signature are captured at start — the action is just "I'm taking custody
 * of this delivery now, start tracking my route." Proof of delivery
 * (photos + customer signature) is captured at acknowledge time.
 *
 *   Tap → POST /maintenance-reports {kind: DO_START, documentId}
 *       → bgLocationContext.start(reportId)  (foreground service + pings)
 *       → /scan/asset/:id/done
 */
export default function StartDeliveryPage() {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const { getToken } = useAuth();
  const { user } = useUser();
  const bgLocation = useBackgroundLocationContext();
  const assetId = params?.assetId as string;
  const inventoryId = search?.get("inventoryId") ?? null;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pull the latest DO so we can attach the MSR to it. The action chooser
  // already verified one exists via canStartDelivery — this is a defensive
  // re-fetch in case the user deep-linked or refreshed.
  const [doId, setDoId] = useState<string | null>(null);
  const [doName, setDoName] = useState<string | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const invQuery = inventoryId ? `?inventoryId=${encodeURIComponent(inventoryId)}` : "";
        const res = await request(
          { path: `/maintenance-reports/scan-context/${assetId}${invQuery}`, method: "GET" },
          {},
          token,
        );
        if (cancelled) return;
        const data = res.data ?? res;
        if (data?.latestDeliveryOrder?.id) {
          setDoId(data.latestDeliveryOrder.id);
          setDoName(data.latestDeliveryOrder.name ?? null);
        }
      } catch {
        // ignore — confirm will fail loudly later if doId stays null
      } finally {
        if (!cancelled) setContextLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assetId, getToken, inventoryId]);

  const confirm = async () => {
    setError(null);
    if (!doId) {
      setError("No open delivery order found for this asset.");
      return;
    }
    setSubmitting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      // Snapshot the tech's display name onto the report so the office side
      // can render "Delivery By: <name>" in the printed DO without a Clerk
      // round-trip. Fallback chain: full name → first name → username →
      // primary email. Stored as MSR.technicianName (nullable column).
      const technicianName =
        user?.fullName ??
        user?.firstName ??
        user?.username ??
        user?.primaryEmailAddress?.emailAddress ??
        undefined;

      const res = await request(
        { path: "/maintenance-reports", method: "POST" },
        {
          assetId,
          ...(inventoryId ? { inventoryId } : {}),
          description: "Delivery started",
          kind: "DO_START",
          documentId: doId,
          ...(technicianName ? { technicianName } : {}),
        },
        token,
      );
      const reportId = res.data?.id ?? res.id;
      if (!reportId) throw new Error("No report id returned");
      // eslint-disable-next-line no-console
      console.log("[delivery-start] POST OK, starting background tracking", {
        reportId,
        assetId,
      });
      // Kick off the layout-level background tracker. Fire-and-forget — the
      // navigation below shouldn't be gated on the foreground service start
      // (which awaits Android permission prompts that can take seconds).
      void bgLocation.start(reportId);
      router.replace(`/scan/asset/${assetId}/done`);
    } catch (e: any) {
      setError(e?.message ?? "Failed to start delivery");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
      <LocalShippingIcon sx={{ fontSize: 80, color: "primary.main", mt: 4 }} />
      <Typography variant="h6" fontWeight={700} sx={{ textAlign: "center" }}>
        Start Delivery
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", maxWidth: 360 }}>
        Confirm you&apos;re taking this equipment out for delivery. GPS tracking
        will begin and continue until you tap Acknowledge Delivery at the
        destination.
      </Typography>

      {doName && (
        <Box sx={{ p: 1.5, bgcolor: "action.hover", borderRadius: 1, minWidth: 280, textAlign: "center" }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            Delivery Order
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {doName}
          </Typography>
        </Box>
      )}

      {error && <Alert severity="error" sx={{ width: "100%", maxWidth: 360 }}>{error}</Alert>}

      <Stack direction="row" spacing={2} sx={{ mt: 2, width: "100%", maxWidth: 360 }}>
        <Button
          variant="outlined"
          onClick={() => router.back()}
          fullWidth
          disabled={submitting}
          sx={{ py: 1.5, px: 4, fontSize: "1rem", minHeight: 48 }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={confirm}
          disabled={submitting || contextLoading || !doId}
          fullWidth
          sx={{ py: 1.5, px: 4, fontSize: "1rem", minHeight: 48 }}
        >
          {submitting ? <CircularProgress size={20} color="inherit" /> : "Confirm & Start"}
        </Button>
      </Stack>
    </Box>
  );
}
