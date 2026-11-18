"use client";

// Round BF — the real order page from the fixture (the cancelled order banner).
// Round BW: ?nav=1 adds a 52px stand-in for the portal's sticky top nav (the preview has no app chrome), so the sticky
// shipment bar is seen where it sits in the app.
import React from "react";
import { useSearchParams } from "next/navigation";
import { Box } from "@mui/material";
import OrderPage from "@/app/portal/shipments/orders/[id]/page";

export default function PreviewOrder() {
  const nav = useSearchParams()?.get("nav") === "1";
  return (
    <>
      {nav && <Box sx={{ position: "fixed", top: 0, left: 0, right: 0, height: 52, bgcolor: "#041627", zIndex: (t) => t.zIndex.appBar }} />}
      {nav && <Box sx={{ height: 52 }} />}
      <OrderPage />
    </>
  );
}
