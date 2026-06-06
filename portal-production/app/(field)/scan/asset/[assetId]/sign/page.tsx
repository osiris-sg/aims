"use client";

import React, { useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import SignatureCanvas from "react-signature-canvas";
import { Alert, Box, Button, Stack, TextField, Typography } from "@mui/material";
import { request } from "@/helpers/request";
import { useBackgroundLocationContext } from "../../../../context/BackgroundLocationContext";

export default function SignPage() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const assetId = params?.assetId as string;
  const reportId = search?.get("reportId");
  // Differentiates which flow the signature is for. Set by the upstream page:
  //   delivery-start → start background tracking after successful sign
  //   do             → stop background tracking after successful sign
  //   (omitted)      → service-report flow, no tracking change
  const flowKind = search?.get("kind");
  // Threaded through the whole flow (chooser → ack → sign → done) so the
  // done page's "Back to this asset" link can restore the full scan context.
  const inventoryId = search?.get("inventoryId") ?? null;
  const sigRef = useRef<SignatureCanvas>(null);
  const [signedByName, setSignedByName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read from the layout-level provider. start/stop dispatch through the
  // long-lived provider so the native callback closure isn't destroyed
  // when this page unmounts on router.replace(/done).
  const bgLocation = useBackgroundLocationContext();

  const clear = () => sigRef.current?.clear();

  const submit = async () => {
    if (!reportId) {
      setError("Missing report id");
      return;
    }
    if (!sigRef.current || sigRef.current.isEmpty()) {
      setError("Signature is required");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const signature = sigRef.current.getTrimmedCanvas().toDataURL("image/png");
      await request(
        { path: `/maintenance-reports/${reportId}/sign`, method: "POST" },
        { signature, signedByName: signedByName.trim() || undefined },
        token,
      );

      // Background location tracking — only acts on delivery flows. The
      // service-report flow (no kind param) is unaffected.
      // eslint-disable-next-line no-console
      console.log("[sign] post-signature dispatch", {
        flowKind,
        reportId,
        isAvailable: bgLocation.isAvailable,
        isTracking: bgLocation.isTracking,
      });
      if (flowKind === "delivery-start") {
        // eslint-disable-next-line no-console
        console.log("[sign] calling bgLocation.start", { reportId });
        // Fire-and-forget — failure to start tracking shouldn't block
        // navigation to /done. The hook surfaces its own errors via state
        // visible on the next mount.
        void bgLocation.start(reportId);
      } else if (flowKind === "do") {
        // eslint-disable-next-line no-console
        console.log("[sign] calling bgLocation.stop");
        void bgLocation.stop();
      } else {
        // eslint-disable-next-line no-console
        console.log("[sign] no flowKind match — service-report flow, no tracking change");
      }

      const invQuery = inventoryId ? `?inventoryId=${encodeURIComponent(inventoryId)}` : "";
      router.replace(`/scan/asset/${assetId}/done${invQuery}`);
    } catch (e: any) {
      setError(e?.message ?? "Failed to submit signature");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="h6" fontWeight={700}>Customer signature</Typography>
      <Typography variant="body2" color="text.secondary">
        Have the recipient sign in the box below to confirm the work / delivery.
      </Typography>

      <TextField
        label="Recipient name (optional)"
        size="small"
        value={signedByName}
        onChange={(e) => setSignedByName(e.target.value)}
      />

      <Box
        sx={{
          border: "1px dashed",
          borderColor: "divider",
          borderRadius: 1,
          bgcolor: "background.paper",
          touchAction: "none",
        }}
      >
        <SignatureCanvas
          ref={sigRef}
          penColor="black"
          canvasProps={{ width: 360, height: 200, style: { width: "100%", height: 200 } }}
        />
      </Box>

      {error && <Alert severity="error">{error}</Alert>}

      <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
        <Button
          variant="outlined"
          onClick={clear}
          fullWidth
          sx={{ py: 1.5, px: 4, fontSize: "1rem", minHeight: 48 }}
        >
          Clear
        </Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={submitting}
          fullWidth
          sx={{ py: 1.5, px: 4, fontSize: "1rem", minHeight: 48 }}
        >
          {submitting ? "Submitting..." : "Submit"}
        </Button>
      </Stack>
    </Box>
  );
}
