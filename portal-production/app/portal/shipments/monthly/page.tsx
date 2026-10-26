"use client";

// Round AM: Sales › Monthly list became the Orders page's Monthly view — the old URL lands there (query kept).

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Box, CircularProgress } from "@mui/material";

export default function MonthlyListRedirect() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const p = new URLSearchParams(params?.toString() ?? "");
    p.set("view", "monthly");
    router.replace(`/portal/shipments/orders?${p.toString()}`);
  }, [router, params]);
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
      <CircularProgress />
    </Box>
  );
}
