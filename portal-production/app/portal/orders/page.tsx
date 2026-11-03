"use client";

import React, { Suspense, useEffect } from "react";
import { Box, CircularProgress } from "@mui/material";
import { useOrganizationFeatures } from "../hooks/useOrganizationFeatures";
import { CappitechOrdersList } from "./CappitechOrdersList";
import SlimOrdersList from "./SlimOrdersList";
import WctOrdersList from "./WctOrdersList";
import { useRouter, useSearchParams } from "next/navigation";
import { ordersTabRedirect } from "@/helpers/wctNav";

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

  // WCT: the orders list; its jobs are the Jobs page. The old ?tab=jobs / ?tab=verify
  // links go there (reading ?tab= needs a Suspense boundary).
  if (isWctOrdersEnabled)
    return (
      <Suspense fallback={null}>
        <WctOrdersRoute />
      </Suspense>
    );
  return isCappitechOrdersEnabled ? <CappitechOrdersList /> : <SlimOrdersList />;
}

function WctOrdersRoute() {
  const router = useRouter();
  const to = ordersTabRedirect(useSearchParams().get("tab"));
  useEffect(() => {
    if (to) router.replace(to);
  }, [to, router]);
  return to ? null : <WctOrdersList />;
}
