"use client";

import React, { useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, Stack, TextField, Typography } from "@mui/material";
import { request } from "@/helpers/request";
import { capturePosition } from "@/helpers/geolocation";

/**
 * Acknowledge Delivery — STANDALONE-run twin of do/[doId]/page.tsx (Layer 3).
 * Identical capture flow (notes → one-shot GPS via the shared capturePosition
 * → MSR POST → shared sign page); the only difference is the MSR carries
 * deliveryId instead of documentId (the run has no DO yet). assetId +
 * inventoryId arrive as query params from the basket's per-item action.
 */
export default function StandaloneDeliveryAckPage() {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const { getToken } = useAuth();
  const deliveryId = params?.deliveryId as string;
  const assetId = search?.get("assetId") ?? "";
  const inventoryId = search?.get("inventoryId") ?? null;
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const continueToSign = async () => {
    setError(null);
    if (!assetId) {
      setError("Missing asset context — go back to the delivery and retry.");
      return;
    }
    setSubmitting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const description = notes.trim() || "Delivery acknowledged";
      // Best-effort one-shot GPS (same helper as the DO flow) — never blocks.
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
          deliveryId,
          ...(coords ? { latitude: coords.latitude, longitude: coords.longitude } : {}),
        },
        token,
      );
      const reportId = res.data?.id ?? res.id;
      if (!reportId) throw new Error("No report id returned");
      // Shared sign page (reportId-based). kind=do stops the background GPS
      // tracking on signature; deliveryId keeps the post-sign routing inside
      // the run (after-ack step: project picker + install prompt).
      const invQuery = inventoryId ? `&inventoryId=${encodeURIComponent(inventoryId)}` : "";
      router.push(
        `/scan/asset/${assetId}/sign?reportId=${reportId}&kind=do&deliveryId=${encodeURIComponent(deliveryId)}${invQuery}`,
      );
    } catch (e: any) {
      setError(e?.message ?? "Failed to save acknowledgement");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 3 }}>
      <Typography variant="h6" fontWeight={700}>Acknowledge Delivery</Typography>
      <Typography variant="body2" color="text.secondary">Standalone delivery — no DO yet</Typography>

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
