"use client";

// /portal/shipments/orders is the Orders list's other spelling (round O): the
// list itself lives at the module route /portal/shipments. Query string kept.

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Box, CircularProgress } from "@mui/material";
import { SHIPMENTS_ORDERS } from "@/helpers/shipmentsNav";

export default function OrdersAlias() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const q = params?.toString();
    router.replace(q ? `${SHIPMENTS_ORDERS}?${q}` : SHIPMENTS_ORDERS);
  }, [router, params]);
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
      <CircularProgress />
    </Box>
  );
}
