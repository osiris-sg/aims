"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Box, Button, Stack, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

export default function DonePage() {
  const params = useParams();
  const assetId = params?.assetId as string;
  return (
    <Box sx={{ flex: 1, p: 3, display: "flex", flexDirection: "column", gap: 3, alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <CheckCircleIcon sx={{ fontSize: 96, color: "success.main" }} />
      <Typography variant="h5" fontWeight={700}>Submitted</Typography>
      <Typography variant="body2" color="text.secondary">
        Sent back to AIMS.
      </Typography>
      <Stack direction="column" spacing={1} sx={{ width: "100%", maxWidth: 320, mt: 2 }}>
        <Button component={Link} href="/scan" variant="contained" fullWidth>Scan another asset</Button>
        <Button component={Link} href={`/scan/asset/${assetId}`} variant="outlined" fullWidth>Back to this asset</Button>
      </Stack>
    </Box>
  );
}
