"use client";

import React, { Suspense } from "react";
import { Box, CircularProgress } from "@mui/material";
import { useOrganizationFeatures } from "../hooks/useOrganizationFeatures";
import { CappitechOrdersList } from "./CappitechOrdersList";
import SlimOrdersList from "./SlimOrdersList";
import WctOrdersPage from "./WctOrdersPage";

// Routing seam (mirrors the order-detail seam): pick the Orders LIST variant by
// org feature flag. enableCappitechOrders=true → the rich multi-column list;
// else → the slim pipeline board (status filter tabs). enableWctOrders → WCT's
// orders with their jobs (one order per accepted quotation).
export default function OrdersListRouter() {
  const { isCappitechOrdersEnabled, isWctOrdersEnabled, isLoading } = useOrganizationFeatures();

  // Hold on a loader until the flag resolves, rather than painting one variant
  // and swapping. Same no-flash choice as the detail router: slim is the
  // default, so "default to rich during load" would flash rich→slim for most
  // orgs; a loader flashes neither direction.
  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  // WCT: Orders | Jobs | To verify (WctOrdersPage reads ?tab=, so it needs a Suspense boundary).
  if (isWctOrdersEnabled)
    return (
      <Suspense fallback={null}>
        <WctOrdersPage />
      </Suspense>
    );
  return isCappitechOrdersEnabled ? <CappitechOrdersList /> : <SlimOrdersList />;
}
