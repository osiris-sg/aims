"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth, useUser } from "@clerk/nextjs";
import { Alert, Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import { request } from "@/helpers/request";
import { uploadImage } from "@/helpers/imageUploader";
import PhotoCaptureField, { CapturedPhoto } from "@/components/delivery/PhotoCaptureField";
import { useBackgroundLocationContext } from "../../../../context/BackgroundLocationContext";

/**
 * Start Delivery — first step of the two-step delivery flow. Enabled only
 * when an open DO exists for this asset and has not been started yet
 * (see canStartDelivery in getScanContext).
 *
 * Captures OPTIONAL condition photos at custody handover (folder: do-start)
 * — this is where the equipment's outbound state is evidenced. No notes or
 * signature at start; the customer signature is captured at acknowledge
 * time. Photos render in the DO's PROOF OF DELIVERY section under the
 * "Delivery Started" block.
 *
 *   Tap → POST /maintenance-reports {kind: DO_START, documentId, photos?}
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
  // Standalone mode (Layer 3): no DO exists — create a Delivery run first,
  // then the DO_START MSR carries deliveryId instead of documentId.
  const standalone = search?.get("standalone") === "1";
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Optional outbound-condition photos (no minimum) — same shared capture
  // component the ack step used to own; keys land on the DO_START MSR row.
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [uploading, setUploading] = useState(false);

  // Clerk-auth'd upload closure for the shared PhotoCaptureField — the
  // component stays auth-agnostic; the token lives here (folder: do-start).
  const uploadDoStart = async (blob: Blob): Promise<string | null> => {
    const token = await getToken();
    if (!token) throw new Error("Not signed in");
    return uploadImage({ blob, folderName: "do-start", token });
  };

  // Pull the latest DO so we can attach the MSR to it. The action chooser
  // already verified one exists via canStartDelivery — this is a defensive
  // re-fetch in case the user deep-linked or refreshed.
  const [doId, setDoId] = useState<string | null>(null);
  const [doName, setDoName] = useState<string | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Standalone runs have no DO to resolve — skip the context re-fetch.
      if (standalone) {
        setContextLoading(false);
        return;
      }
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
  }, [assetId, getToken, inventoryId, standalone]);

  const confirm = async () => {
    setError(null);
    if (!standalone && !doId) {
      setError("No open delivery order found for this asset.");
      return;
    }
    if (standalone && !inventoryId) {
      setError("Standalone delivery needs a specific scanned unit.");
      return;
    }
    // Standalone runs REQUIRE a condition photo per unit — the outbound state
    // must be evidenced before the unit leaves (backend enforces this too).
    if (standalone && photos.length === 0) {
      setError("A condition photo of the unit is required before starting delivery.");
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

      // Standalone (Layer 3): create the Delivery run FIRST — this atomically
      // reserves the scanned unit (a 400 here means it's already out) — then
      // the DO_START MSR carries deliveryId (documentId stays null).
      let deliveryId: string | null = null;
      if (standalone) {
        const runRes = await request(
          { path: "/deliveries", method: "POST" },
          {
            assetId,
            inventoryId,
            ...(technicianName ? { riderName: technicianName } : {}),
          },
          token,
        );
        if (runRes.success === false) throw new Error(runRes.message ?? "Could not start delivery");
        deliveryId = runRes.data?.id ?? runRes.id;
        if (!deliveryId) throw new Error("No delivery id returned");
      }

      const res = await request(
        { path: "/maintenance-reports", method: "POST" },
        {
          assetId,
          ...(inventoryId ? { inventoryId } : {}),
          description: "Delivery started",
          kind: "DO_START",
          ...(standalone && deliveryId ? { deliveryId } : { documentId: doId }),
          ...(technicianName ? { technicianName } : {}),
          ...(photos.length ? { photos: photos.map((p) => p.key) } : {}),
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
      if (standalone && deliveryId) {
        // Standalone: land on the run's basket so more units can be scanned in.
        router.replace(`/scan/delivery/${deliveryId}`);
        return;
      }
      // Carry inventoryId through to /done so its "Back to this asset" link
      // can restore the full scan context — without it the action chooser
      // can't find the DO that references this inventory unit and shows
      // "No delivery order" until the tech rescans the tag.
      const invQuery = inventoryId ? `?inventoryId=${encodeURIComponent(inventoryId)}` : "";
      router.replace(`/scan/asset/${assetId}/done${invQuery}`);
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

      {standalone ? (
        <Box sx={{ p: 1.5, bgcolor: "action.hover", borderRadius: 1, minWidth: 280, textAlign: "center" }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            New Delivery
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            No DO yet — the office links one later
          </Typography>
        </Box>
      ) : doName ? (
        <Box sx={{ p: 1.5, bgcolor: "action.hover", borderRadius: 1, minWidth: 280, textAlign: "center" }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            Delivery Order
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {doName}
          </Typography>
        </Box>
      ) : null}

      <Box sx={{ width: "100%", maxWidth: 360 }}>
        <PhotoCaptureField
          label={standalone ? "Condition photos (required)" : "Condition photos (optional)"}
          photos={photos}
          onChange={setPhotos}
          upload={uploadDoStart}
          onError={(m) => setError(m || null)}
          onUploadingChange={setUploading}
        />
      </Box>

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
          disabled={submitting || contextLoading || uploading || (!standalone && !doId)}
          fullWidth
          sx={{ py: 1.5, px: 4, fontSize: "1rem", minHeight: 48 }}
        >
          {submitting ? <CircularProgress size={20} color="inherit" /> : uploading ? "Uploading…" : "Confirm & Start"}
        </Button>
      </Stack>
    </Box>
  );
}
