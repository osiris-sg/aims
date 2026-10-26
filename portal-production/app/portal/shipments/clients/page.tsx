"use client";

// Round AM: /portal/shipments/clients → Customers (the Clients tab's first list).

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Box, CircularProgress } from "@mui/material";

export default function ClientsHome() {
  const router = useRouter();
  useEffect(() => router.replace("/portal/shipments/clients/customers"), [router]);
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
      <CircularProgress />
    </Box>
  );
}
