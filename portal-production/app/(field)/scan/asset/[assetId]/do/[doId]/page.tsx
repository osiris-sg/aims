"use client";

import React, { useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, Stack, TextField, Typography } from "@mui/material";
import { request } from "@/helpers/request";
import { capturePosition } from "@/helpers/geolocation";

/**
 * Acknowledge Delivery — second step of the two-step delivery flow. Enabled
 * only when a DO_START MSR exists for this DO and no DO_ACK has been
 * submitted yet (see canAckDelivery in getScanContext).
 *
 * Records a MaintenanceServiceReport with kind=DO_ACK, then routes to the
 * shared signature page. Condition photos are captured at START-delivery
 * (custody handover), not here — the GUEST ack flow keeps its own capture
 * (guests never perform a start step). One-shot GPS via capturePosition.
 */
export default function DeliveryOrderAckPage() {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const { getToken } = useAuth();
  const assetId = params?.assetId as string;
  const doId = params?.doId as string;
  const inventoryId = search?.get("inventoryId") ?? null;
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const continueToSign = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      // Description holds just the technician's notes; the activity kind is
      // discriminated by MSR.kind = DO_ACK. Fallback string when no notes are
      // entered so the row isn't blank in the office-side Field Reports view.
      const description = notes.trim() || "Delivery acknowledged";
      // Best-effort one-shot GPS at the acknowledgement point (persisted on the
      // MSR; WaterSgService later forwards it). Resolves null on denial/no
      // signal/timeout, so acknowledgement is never blocked.
      setLocating(true);
      const coords = await capturePosition();
      setLocating(false);
      const res = await request(
        { path: "/maintenance-reports", method: "POST" },
        {
          assetId,
          ...(inventoryId ? { inventoryId } : {}),
          description,
          kind: "DO_ACK",
          documentId: doId,
          ...(coords ? { latitude: coords.latitude, longitude: coords.longitude } : {}),
        },
        token,
      );
      const reportId = res.data?.id ?? res.id;
      if (!reportId) throw new Error("No report id returned");
      // Forward inventoryId so sign → done → "Back to this asset" keeps the
      // full scan context (the action chooser needs it to resolve the DO).
      const invQuery = inventoryId ? `&inventoryId=${encodeURIComponent(inventoryId)}` : "";
      router.push(`/scan/asset/${assetId}/sign?reportId=${reportId}&kind=do${invQuery}`);
    } catch (e: any) {
      setError(e?.message ?? "Failed to save acknowledgement");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 3 }}>
      <Typography variant="h6" fontWeight={700}>Acknowledge Delivery</Typography>
      <Typography variant="body2" color="text.secondary">DO {doId}</Typography>

      <TextField
        label="Notes (optional)"
        placeholder="Any condition issues or remarks at delivery"
        multiline
        minRows={3}
        fullWidth
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      {error && <Alert severity="error">{error}</Alert>}

      <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
        <Button variant="outlined" onClick={() => router.back()} fullWidth>Back</Button>
        <Button
          variant="contained"
          onClick={continueToSign}
          disabled={submitting}
          fullWidth
          sx={{ py: 1.5, px: 4, fontSize: "1rem", minHeight: 48 }}
        >
          {submitting ? (locating ? "Getting location…" : "Saving...") : "Continue to signature"}
        </Button>
      </Stack>
    </Box>
  );
}
