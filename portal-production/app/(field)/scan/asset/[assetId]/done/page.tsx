"use client";

import React from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Box, Button, Stack, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

export default function DonePage() {
  const params = useParams();
  const search = useSearchParams();
  const assetId = params?.assetId as string;
  // Without inventoryId the action chooser can't resolve the DO referencing
  // this inventory unit — "Back to this asset" would show "No delivery order"
  // and force a rescan. Every upstream navigation to /done forwards it.
  const inventoryId = search?.get("inventoryId") ?? null;
  const invQuery = inventoryId ? `?inventoryId=${encodeURIComponent(inventoryId)}` : "";
  return (
    <Box sx={{ flex: 1, p: 3, display: "flex", flexDirection: "column", gap: 3, alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <CheckCircleIcon sx={{ fontSize: 96, color: "success.main" }} />
      <Typography variant="h5" fontWeight={700}>Submitted</Typography>
      <Typography variant="body2" color="text.secondary">
        Sent back to AIMS.
      </Typography>
      <Stack direction="column" spacing={1.5} sx={{ width: "100%", maxWidth: 320, mt: 2 }}>
        <Button
          component={Link}
          href="/scan"
          variant="contained"
          fullWidth
          sx={{ py: 1.5, px: 4, fontSize: "1rem", minHeight: 48 }}
        >
          Scan another asset
        </Button>
        <Button
          component={Link}
          href={`/scan/asset/${assetId}${invQuery}`}
          variant="outlined"
          fullWidth
          sx={{ py: 1.5, px: 4, fontSize: "1rem", minHeight: 48 }}
        >
          Back to this asset
        </Button>
      </Stack>
    </Box>
  );
}
