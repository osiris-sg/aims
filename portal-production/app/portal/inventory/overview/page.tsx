"use client";

// Inventory main page (guru 2026-11-14): the module's front door — stock
// figures (items with stock, valuation, missing costs, low stock) and a tile
// per inventory screen. Lives beside the item list at /portal/inventory, which
// other orgs' sidebars still open directly.
import * as React from "react";
import ModuleHome, { type ModuleStat } from "@/app/portal/components/ModuleHome/ModuleHome";
import { useRoleHomeSnapshot } from "@/app/portal/components/RoleHome/RoleHome";
import { useAccountingApi } from "@/app/portal/accounting/_lib/api";

const money = (n: number, currency: string) =>
  new Intl.NumberFormat("en-SG", { style: "currency", currency: currency || "SGD", currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(Math.round(n));
const count = (n: number) => n.toLocaleString("en-SG");

type Stock = { itemCount: number; total: number; itemsWithMissingCost: number };

export default function InventoryOverviewPage() {
  const { snapshot: s, loading } = useRoleHomeSnapshot("30");
  const { request } = useAccountingApi();
  const [stock, setStock] = React.useState<Stock | null>(null);
  const [stockLoading, setStockLoading] = React.useState(true);
  React.useEffect(() => {
    let alive = true;
    request<Stock>("/accounting/closing-stock?limit=1")
      .then((r) => { if (alive) setStock(r); })
      .catch(() => { if (alive) setStock(null); })
      .finally(() => { if (alive) setStockLoading(false); });
    return () => { alive = false; };
  }, [request]);
  const cur = s?.currency || "SGD";
  const stats: ModuleStat[] = [
    { label: "Items with stock", value: stock ? count(stock.itemCount) : null, href: "/portal/inventory/stock-card" },
    { label: "Stock value", value: stock ? money(stock.total, cur) : null, sub: "At cost", tone: "accent", href: "/portal/settings/accounting-setup" },
    { label: "Low stock", value: s ? count(s.stock.low) : null, sub: "At or below minimum", tone: s && s.stock.low > 0 ? "warn" : "default", href: "/portal/inventory/stock-card" },
    { label: "Missing cost", value: stock ? count(stock.itemsWithMissingCost) : null, sub: "Items without a cost price", tone: stock && stock.itemsWithMissingCost > 0 ? "warn" : "default", href: "/portal/settings/accounting-setup" },
  ];
  return <ModuleHome code="INVENTORY" title="Inventory" stats={stats} loading={loading || stockLoading} />;
}
