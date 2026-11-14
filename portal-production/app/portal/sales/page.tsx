"use client";

// Sales main page (guru 2026-11-14): the module's front door — this month's
// figures from the role-home snapshot and a tile per sales document type.
import * as React from "react";
import ModuleHome, { type ModuleStat } from "@/app/portal/components/ModuleHome/ModuleHome";
import { useRoleHomeSnapshot } from "@/app/portal/components/RoleHome/RoleHome";

const money = (n: number, currency: string) =>
  new Intl.NumberFormat("en-SG", { style: "currency", currency: currency || "SGD", currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(Math.round(n));
const count = (n: number) => n.toLocaleString("en-SG");

export default function SalesPage() {
  const { snapshot: s, loading } = useRoleHomeSnapshot("30");
  const cur = s?.currency || "SGD";
  const stats: ModuleStat[] = [
    { label: "Invoices issued", value: s ? count(s.invoicesIssued.current) : null, sub: "Last 30 days", href: "/portal/sales/invoices" },
    { label: "Revenue", value: s ? money(s.revenue.current, cur) : null, sub: "Last 30 days", tone: "accent" },
    { label: "Outstanding", value: s ? money(s.receivables.outstanding, cur) : null, sub: s ? `${money(s.receivables.overdue, cur)} overdue` : undefined, href: "/portal/accounting/receivables", tone: s && s.receivables.overdue > 0 ? "warn" : "default" },
    { label: "Quotations awaiting", value: s ? count(s.pending.quotationsAwaiting) : null, href: "/portal/sales/quotations" },
    { label: "Pending delivery", value: s ? count(s.pending.deliveryOrdersPending) : null, sub: "Confirmed delivery orders", href: "/portal/sales/delivery-orders" },
    { label: "To confirm", value: s ? count(s.pending.unconfirmedDocuments) : null, href: "/portal/accounting/posting-queue" },
  ];
  return <ModuleHome code="SALES" title="Sales" stats={stats} loading={loading} />;
}
