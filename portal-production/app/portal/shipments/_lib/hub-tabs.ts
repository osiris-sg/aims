// Documents hub tabs (round L): Shipments-style underlined tabs with counts.

/** The tabs (short labels, like the Shipments tabs); a tab with no documents is hidden — All always shows. */
export const DOC_TABS: Array<{ code: string; label: string }> = [
  { code: "", label: "All" },
  { code: "SUPPLIER", label: "Supplier" },
  { code: "CUSTOMER", label: "Customer" },
  { code: "INVOICES", label: "Invoices" },
  { code: "CUSTOMS_LOGISTICS", label: "Customs & logistics" },
  { code: "PAYMENTS", label: "Payments" },
  { code: "OTHER", label: "Other" },
];
export const visibleTabs = (counts: Record<string, number>, allCount: number, current: string) =>
  DOC_TABS.filter((t) => !t.code || (counts[t.code] ?? 0) > 0 || t.code === current).map((t) => ({ ...t, count: t.code ? (counts[t.code] ?? 0) : allCount }));
