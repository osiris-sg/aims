"use client";

// A shipment lives on its order's page ("#19-1" under "#19"); shipments from
// before orders on their contract's deal page. Old links to
// /portal/shipments/:id land there with the shipment selected; ?tab= is
// carried over (overview → details).

import React, { useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Alert, Box, CircularProgress } from "@mui/material";
import { useShipment } from "../_lib/hooks";

export default function ShipmentRedirect() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const q = useShipment(id);
  const contractId = q.data?.contractId;
  const orderId = q.data?.orderId;

  useEffect(() => {
    if (!orderId && !contractId) return;
    const t = params?.get("tab");
    const tab = t === "files" ? "files" : t === "overview" ? "details" : null;
    const base = orderId ? `/portal/shipments/orders/${orderId}` : `/portal/shipments/contracts/${contractId}`;
    router.replace(`${base}?shipment=${id}${tab ? `&tab=${tab}` : ""}`);
  }, [orderId, contractId, id, params, router]);

  if (q.isError) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{(q.error as Error)?.message || "Shipment not found"}</Alert>
      </Box>
    );
  }
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
      <CircularProgress />
    </Box>
  );
}
