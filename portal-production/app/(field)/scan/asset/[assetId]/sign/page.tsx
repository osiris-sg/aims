"use client";

import React, { useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import SignatureCanvas from "react-signature-canvas";
import { Alert, Box, Button, Stack, TextField, Typography } from "@mui/material";
import { request } from "@/helpers/request";

export default function SignPage() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const assetId = params?.assetId as string;
  const reportId = search?.get("reportId");
  const sigRef = useRef<SignatureCanvas>(null);
  const [signedByName, setSignedByName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      router.replace(`/scan/asset/${assetId}/done`);
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
        <Button variant="outlined" onClick={clear} fullWidth>Clear</Button>
        <Button variant="contained" onClick={submit} disabled={submitting} fullWidth>
          {submitting ? "Submitting..." : "Submit"}
        </Button>
      </Stack>
    </Box>
  );
}
