"use client";

import { useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { request } from "@/helpers/request";
import SignaturePadField, { SignaturePadHandle } from "@/components/delivery/SignaturePadField";

/**
 * RUN FINALIZE (2026-08 signature-at-end). The ONE customer signature for the
 * whole delivery, captured only once every item on the run is resolved
 * (delivered or skipped) - the run has folded to `delivered`. POST
 * /deliveries/:id/finalize stamps this signature across every per-item proof MSR,
 * completes the delivered items, and fires the DO commit + invoice. The signature
 * used to be captured per item at End Delivery, which signed the run while items
 * were still outstanding and re-signed on a second pass ("report already signed").
 */
export default function FinalizeDeliveryPage() {
  const router = useRouter();
  const { deliveryId } = useParams() as { deliveryId: string };
  const { getToken } = useAuth();
  const sigRef = useRef<SignaturePadHandle>(null);
  const [signedByName, setSignedByName] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!sigRef.current || sigRef.current.isEmpty()) {
      setError("The customer needs to sign to complete the delivery.");
      return;
    }
    const signature = sigRef.current.toDataUrl();
    setWorking(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: `/deliveries/${deliveryId}/finalize`, method: "POST" },
        { signature, ...(signedByName.trim() ? { recipientName: signedByName.trim() } : {}) },
        token,
      );
      if (res?.success === false) throw new Error(res?.message ?? "Could not finalize the delivery");
      // The run is complete: land on the finished screen (DO + invoice summary).
      router.replace(`/scan/deliveries/finished/${deliveryId}`);
    } catch (e: any) {
      setError(e?.message ?? "Could not finalize the delivery");
      setWorking(false);
    }
  };

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" alignItems="center">
        <Button startIcon={<ArrowBackIcon />} onClick={() => router.back()} disabled={working} color="inherit">
          Back
        </Button>
      </Stack>

      <Typography variant="h6" fontWeight={700}>
        Customer signature
      </Typography>
      <Typography variant="body2" color="text.secondary">
        One signature covers the whole delivery. It completes the run and creates the Delivery Order and its
        invoice. Every item has already been delivered or skipped.
      </Typography>

      {error && (
        <Alert severity="warning" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <TextField
        label="Signed by (name)"
        value={signedByName}
        onChange={(e) => setSignedByName(e.target.value)}
        size="small"
        fullWidth
      />

      <SignaturePadField ref={sigRef} />

      <Button
        fullWidth
        variant="contained"
        color="success"
        onClick={submit}
        disabled={working}
        sx={{ minHeight: 48 }}
      >
        {working ? <CircularProgress size={22} /> : "Complete delivery"}
      </Button>
    </Box>
  );
}
