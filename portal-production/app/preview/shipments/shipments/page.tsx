"use client";

// Round BX — Sales › Shipments from the fixture (?tab=tracking: the Tracking list; ?nav=1 adds the 52px top-nav stand-in).
import React from "react";
import { useSearchParams } from "next/navigation";
import { Box } from "@mui/material";
import ShipmentsListView from "@/app/portal/shipments/_components/ShipmentsListView";

export default function PreviewShipmentsList() {
  const nav = useSearchParams()?.get("nav") === "1";
  return (
    <>
      {nav && <Box sx={{ position: "fixed", top: 0, left: 0, right: 0, height: 52, bgcolor: "#041627", zIndex: (t) => t.zIndex.appBar }} />}
      {nav && <Box sx={{ height: 52 }} />}
      <ShipmentsListView canEditTracking />
    </>
  );
}
