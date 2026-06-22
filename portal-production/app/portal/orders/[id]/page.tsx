"use client";

import React from "react";
import { Box, CircularProgress } from "@mui/material";
import { useOrganizationFeatures } from "../../hooks/useOrganizationFeatures";
import { CappitechOrderDetail } from "./CappitechOrderDetail";
import SlimOrderDetail from "./SlimOrderDetail";

// Routing seam: pick the Orders variant by org feature flag. Default export so
// Next.js routes to it; it threads `params` (the route's { id }) to whichever
// variant renders. enableCappitechOrders=true → rich; else → slim. Phase A:
// the slim branch is a passthrough to rich, so both branches look identical.
export default function OrderDetailRouter({ params }: { params: { id: string } }) {
  const { isCappitechOrdersEnabled, isLoading } = useOrganizationFeatures();

  // Hold on a loader until the flag resolves, rather than painting one variant
  // and swapping. Chosen over "default to rich during load" because slim is the
  // default (Biofuel et al.): defaulting to rich would flash the rich UI then
  // swap to slim for the majority of orgs once Phase C ships the real slim UI.
  // A loader flashes neither direction. (This phase both branches are rich, so
  // it only ever shows the brief loader on a cold flag load.)
  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  return isCappitechOrdersEnabled ? (
    <CappitechOrderDetail params={params} />
  ) : (
    <SlimOrderDetail params={params} />
  );
}
