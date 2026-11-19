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
  billedPct?: number | null;
  quoteTotal?: number | null;
  credited?: number;
  /** 2026-11-19: marked complete (by a person, or auto "Imported, assumed closed"). */
  completed?: { reason: string; at: string; byName: string | null; auto: boolean } | null;
  /** What is left to bill (Part billed): the lines a new invoice would carry. */
  remaining?: { matched: boolean; reason: string | null; remainingNet: number; remainingGross: number; lines: Array<{ description: string; quantity: number; unitPrice: number; amount: number; quotedQty: number | null; billedQty: number | null; priced: boolean }> } | null;
  /** "1 of 2" when the quotation has one priced line. */
  progress?: { billed: number; quoted: number } | null;
  draftInvoice?: { id: string; name: string | null; templateId: string | null } | null;
  canInvoice?: boolean;
  canComplete?: boolean;
  canReopen?: boolean;
}

/** The orders list's source filter. Default "aims": imported history does not crowd the working list. */
export function matchesOrderSource(row: { imported?: boolean }, source: OrderSource): boolean {
  if (source === "all") return true;
  return source === "imported" ? row.imported === true : row.imported !== true;
}

/** WCT group with imported orders (enableImportedOrders): the list opens on "All orders"; other orgs keep "AIMS orders". */
export function defaultOrderSource(features?: { enableImportedOrders?: boolean } | null): OrderSource {
  return features?.enableImportedOrders === true ? "all" : "aims";
}

/** Newest first by created date (imported orders carry their quotation date), so live orders stay on top. */
export function newestFirst<T extends { createdAt?: string | null }>(rows: T[]): T[] {
  const t = (r: T) => (r.createdAt ? new Date(r.createdAt).getTime() || 0 : 0);
  return [...rows].sort((a, b) => t(b) - t(a));
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

export const importedStatusHue = (status: string) => (status === "PAID" ? "#22c55e" : status === "PART_BILLED" ? "#d97706" : status === "COMPLETED" ? "#64748b" : "#6d28d9");

/** "1 of 2" (billed of quoted, one priced line), else "". */
export const importedProgress = (p?: { billed: number; quoted: number } | null) => (p && p.quoted > 0 ? `${Number(p.billed).toLocaleString("en-SG")} of ${Number(p.quoted).toLocaleString("en-SG")}` : "");

/** Billed % (billed / quotation total), one decimal; blank without a quotation total. */
export const importedBilledPct = (pct?: number | null) => (pct == null || !Number.isFinite(Number(pct)) ? "" : `${Number(pct).toLocaleString("en-SG", { maximumFractionDigits: 1 })}%`);

/** The Orders list shows the Billed % column only when imported orders are in view (Imported or All). */
export const showBilledPctColumn = (hasImported: boolean, source: OrderSource) => hasImported && source !== "aims";

/** Imported order statuses (api imported-orders.ts, 2026-11-19): Part billed, Invoiced, Paid, Complete. */
export const IMPORTED_STATUS_TABS: Array<{ key: string; label: string }> = [
  { key: "PART_BILLED", label: "Part billed" },
  { key: "INVOICED", label: "Invoiced" },
  { key: "PAID", label: "Paid" },
  { key: "COMPLETED", label: "Complete" },
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
