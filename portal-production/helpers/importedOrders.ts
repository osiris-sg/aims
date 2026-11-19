// Imported orders (enableImportedOrders, 2026-11-18): orders made from the old ERP's own
// quotation <-> invoice links (api: src/orders/imported-orders.ts). Round 19 (2026-11-19): open for
// backfilling (Add DO, Add job, service report, Create invoice on any status, Link existing document /
// Unlink; api: src/orders/imported-order-links.ts). The imported documents themselves stay read-only.
// Round 24 (2026-11-19): the order page itself (cards, Documents rows) is helpers/orderPage.ts, one layout for both kinds.

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
  /** subNote: a plain second line (the ERP DO no.); action: the card's add link when nothing is there yet. */
  /** docs: the step's documents (DO / service report), each a link; the card opens the first. */
  tracker: Array<{
    key: string;
    label: string;
    state: "done" | "na" | "todo";
    note?: string | null;
    subNote?: string | null;
    action?: "addDo" | "addServiceReport" | null;
    docs?: Array<{ label: string; status?: string | null; href?: string | null }>;
  }>;
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
  /** "1 of 2 Paid · 2 of 2 Draft" (one priced quotation line). */
  billingSteps?: Array<{ label: string; state: string }>;
  canInvoice?: boolean;
  canComplete?: boolean;
  canReopen?: boolean;
  /** Round 19: Create invoice's prefilled lines (what is left; billed in full: the quotations' lines; else one empty line). */
  invoiceLines?: Array<{ description: string; quantity: number; unitPrice: number; amount: number; priced: boolean }>;
  canLink?: boolean;
  /** Quotations linked on top of the order's own. */
  quotations?: Array<ImportedDocRef & { status?: string; date?: string | null; total?: number | null; unlinkable?: boolean; linked?: LinkStamp | null }>;
  /** DOs made on the order in AIMS (Add DO): the native order page's DO rows. */
  deliveryOrders?: Array<{ id: string; name: string | null; status: string; templateId: string | null; date?: string | null; completed: boolean; awaitingSignature: boolean; jobs: any[]; products?: any[]; hasProducts?: boolean; invoiceId?: string | null; tag?: string | null }>;
  /** Imported ERP DOs on the order and AIMS DOs linked to it. */
  linkedDos?: Array<{ id: string | null; name: string | null; templateId: string | null; date?: string | null; done: boolean; imported: boolean; unlinkable: boolean; linked?: LinkStamp | null }>;
  jobs?: Array<{ id: string; deliveryNumber: number; status: string; isDraft: boolean; scheduledFor: string | null; deliveryOrder?: { name: string | null } | null }>;
  jobReports?: Array<{ id: string; reportNumber: number | null; status: string; jobNumber: number | null; uploaded?: boolean }>;
  attachments?: Array<{ id: string; kind: "file" | "report"; reportId?: string; reportNumber?: number | null; fileKey?: string; fileName?: string; label?: string | null; report?: { reportNumber: number | null; status: string } | null }>;
  manualFlow?: boolean;
  prefill?: { siteAddress?: string | null; lines?: any[] } | null;
  statusDates?: Record<string, string> | null;
}

export interface LinkStamp {
  at: string | null;
  byName: string | null;
}

// ── Link existing document (round 19) ───────────────────────────────────────

export type ImportedLinkType = "QUOTATION" | "INVOICE" | "DELIVERY_ORDER" | "SERVICE_REPORT";
export const IMPORTED_LINK_TYPES: Array<{ key: ImportedLinkType; label: string }> = [
  { key: "QUOTATION", label: "Quotation" },
  { key: "INVOICE", label: "Invoice" },
  { key: "DELIVERY_ORDER", label: "DO" },
  { key: "SERVICE_REPORT", label: "Service report" },
];

export interface LinkOption {
  id: string;
  type: ImportedLinkType;
  name: string | null;
  date?: string | null;
  status?: string | null;
  total?: number | null;
  imported?: boolean;
  onOrder: { id: string; orderNumber: string } | null;
  onThisOrder: boolean;
}

/** A search result in the Link dialog: only a document on no order can be picked. */
export function linkOptionState(o: Pick<LinkOption, "onOrder" | "onThisOrder">): { disabled: boolean; note: string } {
  if (o.onThisOrder) return { disabled: true, note: "On this order" };
  if (o.onOrder) return { disabled: true, note: `On ${o.onOrder.orderNumber}` };
  return { disabled: false, note: "" };
}

/** Create invoice's lines as the dialog edits them (strings), from the order's prefill (imported orders; AIMS orders' invoiceLines, round 36). */
export function invoiceDialogLines(order: Pick<ImportedOrder, "invoiceLines" | "remaining">): Array<{ description: string; quantity: string; unitPrice: string; priced: boolean }> {
  const src = order.invoiceLines?.length ? order.invoiceLines : order.remaining?.lines ?? [];
  const lines = src.map((l) => ({ description: l.description, quantity: String(l.quantity), unitPrice: String(l.unitPrice), priced: l.priced }));
  return lines.length ? lines : [{ description: "", quantity: "1", unitPrice: "0", priced: true }];
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

/** No row menu on an imported order in the list (its page has the actions, round 19). */
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

export const importedStatusHue = (status: string) =>
  status === "PAID" ? "#22c55e" : status === "PART_BILLED" ? "#d97706" : status === "COMPLETED" ? "#64748b" : status === "DO_DRAFT" || status === "DO_COMPLETED" ? "#0284c7" : "#6d28d9";

/** "1 of 2 Paid · 2 of 2 Draft" from the order's billing steps. */
export const importedSteps = (steps?: Array<{ label: string; state: string }> | null) => (steps ?? []).map((x) => `${x.label} ${x.state}`).join(" · ");

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
  { key: "DO_DRAFT", label: "DO draft" },
  { key: "DO_COMPLETED", label: "DO completed, invoice pending" },
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
