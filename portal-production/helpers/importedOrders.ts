// Imported orders (enableImportedOrders, 2026-11-18): orders made from the old ERP's own
// quotation <-> invoice links (api: src/orders/imported-orders.ts). Read-only in the portal.

export type OrderSource = "aims" | "imported" | "all";

export interface ImportedDocRef {
  id: string;
  name: string | null;
  type?: string;
  templateId?: string | null;
  documentTemplateId?: string | null;
}

export interface ImportedOrder {
  id: string;
  orderNumber: string;
  status: string;
  statusLabel?: string;
  imported: true;
  createdAt: string;
  customer?: { id: string; name: string } | null;
  subject?: string | null;
  sourceQuotation?: (ImportedDocRef & { date?: string | null; total?: number | null }) | null;
  tracker: Array<{ key: string; label: string; state: "done" | "na"; note?: string | null }>;
  invoices: Array<ImportedDocRef & { date?: string | null; total?: number | null; owed: number; credit?: number; state?: string; stateLabel?: string; linkSource?: string | null; erpDoNumber?: string | null }>;
  creditNotes: Array<ImportedDocRef & { total?: number | null }>;
  total: number;
  owed: number;
  billed?: number;
  quoteTotal?: number | null;
  credited?: number;
}

/** The orders list's source filter. Default "aims": imported history does not crowd the working list. */
export function matchesOrderSource(row: { imported?: boolean }, source: OrderSource): boolean {
  if (source === "all") return true;
  return source === "imported" ? row.imported === true : row.imported !== true;
}

export const ORDER_SOURCE_OPTIONS: Array<{ key: OrderSource; label: string }> = [
  { key: "aims", label: "AIMS orders" },
  { key: "imported", label: "Imported" },
  { key: "all", label: "All orders" },
];

/** No row actions on an imported order (no DO, job, invoice, service report, cancel). */
export const importedRowActions = (row: { imported?: boolean }) => (row.imported === true ? [] : null);

const LINK_LABEL: Record<string, string> = {
  erp_quotation_link: "ERP quotation link",
  contract_no: "ERP contract no.",
  tracker_quotation_no: "Tracker quotation no.",
  line_text: "ERP line text",
};
export const importedLinkSourceLabel = (s?: string | null) => (s ? LINK_LABEL[s] ?? s : "");

export function importedDocHref(d: ImportedDocRef | null | undefined, fallbackType: string): string | null {
  const t = d?.templateId ?? d?.documentTemplateId;
  return d && t ? `/portal/documents/${d.type || fallbackType}/${t}/${d.id}` : null;
}

export const importedMoney = (n?: number | null) => (n == null ? "" : `S$ ${Number(n).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export const importedStatusHue = (status: string) => (status === "PAID" ? "#22c55e" : status === "PART_BILLED" ? "#f59e0b" : "#6d28d9");

/** Imported order statuses (api imported-orders.ts): Part billed, Invoiced, Paid. */
export const IMPORTED_STATUS_TABS: Array<{ key: string; label: string }> = [
  { key: "PART_BILLED", label: "Part billed" },
  { key: "INVOICED", label: "Invoiced" },
  { key: "PAID", label: "Paid" },
];
const IMP = "imported:";
/** Status filter entries for imported rows (keys prefixed so they never mix with the AIMS order statuses). */
export function importedTabs(rows: Array<{ imported?: boolean; status?: string | null }>) {
  const imp = rows.filter((r) => r.imported === true);
  return IMPORTED_STATUS_TABS.filter((t) => imp.some((r) => r.status === t.key)).map((t) => ({ key: IMP + t.key, label: `${t.label} (imported)`, count: imp.filter((r) => r.status === t.key).length }));
}
export const isImportedTab = (tab: string) => tab.startsWith(IMP);
/** An imported row matches All or its own imported status entry; never an AIMS status entry. */
export const importedMatchesTab = (row: { imported?: boolean; status?: string | null }, tab: string) =>
  row.imported === true && (tab === "all" || tab === IMP + row.status);
