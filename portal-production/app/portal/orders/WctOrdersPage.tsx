"use client";

import React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Box, Tab, Tabs } from "@mui/material";
import MainCard from "@/components/MainCard";
import { ordersTab, type OrdersTab } from "@/helpers/wctNav";
import WctOrdersList from "./WctOrdersList";
import WctJobsList from "./WctJobsList";
import VerificationQueue from "../deliveries/_components/VerificationQueue";

// WCT Orders (enableWctOrders, 2026-11-03): Orders | Jobs | To verify. The tab
// is in the URL (?tab=jobs / ?tab=verify), so the old /portal/deliveries links
// land on the right one and Back returns to it.
const TABS: Array<{ key: OrdersTab; label: string }> = [
  { key: "orders", label: "Orders" },
  { key: "jobs", label: "Jobs" },
  { key: "verify", label: "To verify" },
];

export default function WctOrdersPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = ordersTab(params.get("tab"));
  const go = (t: OrdersTab) => router.replace(t === "orders" ? pathname : `${pathname}?tab=${t}`, { scroll: false });

  return (
    <MainCard>
      <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => go(v as OrdersTab)} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile>
          {TABS.map((t) => (
            <Tab key={t.key} value={t.key} label={t.label} sx={{ textTransform: "none", minHeight: 48, fontWeight: 600 }} data-tour={`orders-tab-${t.key}`} />
          ))}
        </Tabs>
      </Box>
      {tab === "orders" && <WctOrdersList embedded />}
      {tab === "jobs" && <WctJobsList />}
      {tab === "verify" && <VerificationQueue embedded />}
    </MainCard>
  );
}
