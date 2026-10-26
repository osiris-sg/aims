/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round AM — fixture QueryClient for /preview/shipments/*: every query the pages create is answered from the dump
// (by its key) the moment it is added, so nothing is fetched. Unknown queries stay empty.

import React, { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TradeTheme from "@/app/portal/shipments/_components/TradeTheme";

function answer(d: any, key: readonly unknown[]): unknown {
  const [k0] = key;
  if (k0 === "trade-clients") {
    if (key[1] === "preview-shipments") return d.previewShipments?.[key[2] as string] ?? [];
    if (key[2] === "customers") return d.customers;
    if (key[2] === "suppliers") return d.suppliers;
    if (key[2] === "customer") return d.detail?.[key[3] as string];
    if (key[2] === "supplier") return d.sdetail?.[key[3] as string];
  }
  if (k0 === "trade-monthly-list") {
    const q: any = key[1] ?? {};
    return q.customerId ? d.monthlyBy?.[q.customerId] : d.monthlyAll;
  }
  if (k0 === "trade-orders" && key[2] === "list") {
    const f: any = key[3] ?? {};
    return f.customerId ? d.ordersBy?.[f.customerId] : d.ordersAll;
  }
  return undefined;
}

export default function PreviewShipmentsProvider({ data, children }: { data: any; children: React.ReactNode }) {
  const [qc] = useState(() => {
    const c = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false } } });
    c.getQueryCache().subscribe((e) => {
      if (e.type !== "added") return;
      const v = answer(data, e.query.queryKey);
      if (v !== undefined) c.setQueryData(e.query.queryKey, v);
    });
    return c;
  });
  return (
    <QueryClientProvider client={qc}>
      <TradeTheme>{children}</TradeTheme>
    </QueryClientProvider>
  );
}
