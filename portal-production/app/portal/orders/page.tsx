"use client";

import React from "react";
import { Box, CircularProgress } from "@mui/material";
import { useOrganizationFeatures } from "../hooks/useOrganizationFeatures";
import { CappitechOrdersList } from "./CappitechOrdersList";
import SlimOrdersList from "./SlimOrdersList";

// Routing seam (mirrors the order-detail seam): pick the Orders LIST variant by
// org feature flag. enableCappitechOrders=true → the rich multi-column list;
// else → the slim pipeline board (status filter tabs).
export default function OrdersListRouter() {
  const { isCappitechOrdersEnabled, isLoading } = useOrganizationFeatures();

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

  return isCappitechOrdersEnabled ? <CappitechOrdersList /> : <SlimOrdersList />;
}
