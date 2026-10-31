/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round AM — fixture QueryClient for /preview/shipments/*: every query the pages create is answered from the dump
// (by its key) the moment it is added, so nothing is fetched. Unknown queries stay empty.

import React, { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TradeTheme from "@/app/portal/shipments/_components/TradeTheme";

// Round AN: the shared-header variants (tab, search) are keyed by the normalised query (scripts/_an-preview-fixtures.ts).
const norm = (q: Record<string, unknown>) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(q ?? {})
        .filter(([, v]) => v !== undefined && v !== "")
        .sort(([a], [b]) => a.localeCompare(b))
    )
  );

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
    if (!q.customerId && d.monthlyQ?.[norm(q)]) return d.monthlyQ[norm(q)];
    return q.customerId ? d.monthlyBy?.[q.customerId] : d.monthlyAll;
  }
  // Round AV: the add / edit drawer — an order's detail (quantity left), a shipment's detail (edit), the email facts.
  if (k0 === "trade-orders" && key[2] === "detail") return d.orderDetail?.[key[3] as string];
  if (k0 === "trade-shipments" && key[2] === "detail") return d.shipmentDetail?.[key[3] as string];
  if (k0 === "inbox-shipment-facts") return d.answer?.facts;
  if (k0 === "trade-orders" && key[2] === "list" && d.answer?.orders) return d.answer.orders;
  if (k0 === "trade-orders" && key[2] === "list") {
    const f: any = key[3] ?? {};
    if (!f.customerId && d.ordersQ?.[norm(f)]) return d.ordersQ[norm(f)];
    return f.customerId ? d.ordersBy?.[f.customerId] : d.ordersAll;
  }
  // Round AR: issues (by supplier / customer / order), the step banner, a record's emails, and the Answer flow's queries.
  if (k0 === "trade-issues") {
    if (key[2] === "shipment") return d.issuesShipment?.[key[3] as string] ?? [];
    const q: any = key[3] ?? {};
    return d.issues?.[q.supplierId ?? q.customerId ?? q.orderId ?? q.shipmentId] ?? [];
  }
  if (k0 === "trade-record-emails") return d.recordEmails ?? [];
  if (k0 === "trade-shipments" && key[2] === "list") {
    const f: any = key[3] ?? {};
    if (d.answer) return f.status === "COMPLETED" ? d.answer.shipsDone : d.answer.shipsOpen;
  }
  if (k0 === "trade-parties") return key[2] === "suppliers" ? (d.answer?.suppliers ?? d.suppliers) : (d.answer?.customers ?? d.customers);
  if (k0 === "inbox-placements") return d.answer?.placements;
  if (k0 === "inbox-issue-draft") return d.answer?.draft;
  if (k0 === "trade-cast-search") return d.answer?.cast?.[key[1] as string] ?? [];
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
