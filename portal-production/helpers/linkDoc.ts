// Link Document + doc chain (WCT group, 2026-11-22; enableWctOrders). The QO / DO / Invoice editor's "Link Document"
// row: pills for what the document is linked to, and a big picker (tabs Order, QO, DO, Invoice minus the page's own
// type) to add one. The doc chain panel on the left lists the order's QO, DO(s) and Invoice(s). On a QO, DO and
// Invoice (WCT group) the left "Reference" box is gone and the right box is "Remarks" (config.remarks, printed as
// Remarks; 2026-11-24). config.internalRemarks is no longer shown or written (old text stays stored). Link text never
// shows in the remarks. API: api-server-production/src/orders/doc-links*.ts. Pure helpers, tested by helpers/linkDoc.test.mjs.

export type PageKind = "QUOTATION" | "DELIVERY_ORDER" | "INVOICE";
export type PickKind = "ORDER" | PageKind;

const TYPES: Record<PageKind, string[]> = {
  QUOTATION: ["QUOTATION", "QO", "QO1", "QO2", "QT"],
  DELIVERY_ORDER: ["DELIVERY_ORDER", "DO"],
  INVOICE: ["INVOICE", "TAX_INVOICE", "INV", "TI", "TI2"],
};

export function pageKindOf(type: string | null | undefined): PageKind | null {
  const t = String(type ?? "").toUpperCase();
  for (const k of Object.keys(TYPES) as PageKind[]) if (TYPES[k].includes(t)) return k;
  return null;
}

export const PICK_LABEL: Record<PickKind, string> = { ORDER: "Order", QUOTATION: "QO", DELIVERY_ORDER: "DO", INVOICE: "Invoice" };

/** The picker's tabs: Order, QO, DO, Invoice, minus the page's own type. */
export function pickerTabs(page: PageKind): Array<{ value: PickKind; label: string }> {
  return (["ORDER", "QUOTATION", "DELIVERY_ORDER", "INVOICE"] as PickKind[]).filter((k) => k !== page).map((k) => ({ value: k, label: PICK_LABEL[k] }));
}

/** Link Document is on for a WCT orders company, on a saved or unsaved QO / DO / Invoice (not a template being edited). */
export const linkDocOn = (type: string | null | undefined, f: { wctOrders?: boolean; templateEdit?: boolean }): boolean => !!f.wctOrders && !f.templateEdit && !!pageKindOf(type);

/**
 * The WCT remarks layout on a QO, DO and Invoice (WCT group: enableWctDocNav; DO + Invoice since 2026-11-23).
 * Since 2026-11-24: no left Reference / Customer Remarks box; the right box is "Remarks" and edits config.remarks
 * (printed as Remarks). No internal remarks on these pages. Links live only in the Link Document pills.
 */
export const remarksSplitOn = (type: string | null | undefined, f: { wctDocNav?: boolean; templateEdit?: boolean }): boolean => !!f.wctDocNav && !f.templateEdit && !!pageKindOf(type);

export interface PickRow {
  kind: PickKind;
  id: string;
  number: string | null;
  customerId: string | null;
  customer: string | null;
  date: string | null;
  subject: string | null;
  total: number | null;
  status: string | null;
  href: string | null;
}

export interface LinkPill {
  key: string;
  label: string;
  href: string | null;
  /** What × removes (absent = no ×). */
  unlink?: { kind: "ORDER" | "DIRECT"; id?: string };
}

export interface DocLinks {
  kind: PageKind;
  order: { id: string; orderNumber: string; href: string; unlinkable: boolean; quotation: { id: string; name: string | null; href: string | null } | null } | null;
  direct: Array<{ id: string; type: string; name: string | null; href: string | null }>;
}

/** The row's pills: the order (× when this document's link can go), its quotation, then each direct link (×). */
export function linkPills(links: DocLinks | null | undefined): LinkPill[] {
  if (!links) return [];
  const out: LinkPill[] = [];
  if (links.order) {
    out.push({ key: `order:${links.order.id}`, label: links.order.orderNumber, href: links.order.href, ...(links.order.unlinkable ? { unlink: { kind: "ORDER" as const } } : {}) });
    if (links.order.quotation?.name) out.push({ key: `qo:${links.order.quotation.id}`, label: links.order.quotation.name, href: links.order.quotation.href });
  }
  for (const d of links.direct ?? []) out.push({ key: `direct:${d.id}`, label: d.name || "Document", href: d.href, unlink: { kind: "DIRECT", id: d.id } });
  return out;
}

/** The confirm text before a pill's × (no em-dashes). */
export function unlinkConfirmText(pill: LinkPill, docName: string | null | undefined): string {
  const me = docName || "this document";
  return pill.unlink?.kind === "ORDER" ? `Take ${me} off ${pill.label}?` : `Unlink ${me} and ${pill.label}?`;
}

/** The picker's search request for one tab. */
export function pickerPath(documentId: string, kind: PickKind, q: string): string {
  const p = new URLSearchParams({ documentId, kind });
  if (q.trim()) p.set("q", q.trim());
  return `/order-refs/picker?${p.toString()}`;
}

/** What a pick did, for the toast. */
export function linkedToastText(out: { mode?: string; orderNumber?: string | null; targetName?: string | null; already?: boolean; createdOrder?: boolean } | null | undefined): string {
  if (!out) return "Linked";
  if (out.already) return out.mode === "order" ? `Already on ${out.orderNumber}` : `Already linked to ${out.targetName}`;
  if (out.mode === "order") return out.targetName && out.targetName !== out.orderNumber ? `Linked to ${out.orderNumber} (through ${out.targetName})` : `Linked to ${out.orderNumber}${out.createdOrder ? " (new order)" : ""}`;
  return `Linked to ${out.targetName ?? "the document"}`;
}

/** S$ amount, 2dp; blank for none. */
export const pickMoney = (n: number | null | undefined): string => (n == null || !Number.isFinite(Number(n)) ? "" : `S$ ${Number(n).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** A stored status as words ("unconfirmed" -> "Unconfirmed", "PART_BILLED" -> "Part billed"). */
export function statusWords(s: string | null | undefined): string {
  const t = String(s ?? "").trim();
  if (!t) return "";
  if (/[a-z]/.test(t) && /[A-Z]/.test(t) && !t.includes("_")) return t; // already a label ("Part billed", "Complete")
  const w = t.replace(/_/g, " ").toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** dd/mm/yyyy from yyyy-mm-dd (the portal's date). */
export const pickDate = (d: string | null | undefined): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d ?? "");
};

export interface DocChain {
  kind: PageKind;
  order: { id: string; orderNumber: string; href: string } | null;
  quotations: Array<{ id: string; name: string | null; href: string | null }>;
  dos: Array<{ id: string; name: string | null; href: string | null }>;
  invoices: Array<{ id: string; name: string | null; href: string | null; placeholder?: boolean }>;
  canCreateDo: boolean;
  canCreateInvoice: boolean;
  direct: Array<{ id: string; type: string; name: string | null; href: string | null }>;
}

/** The hover text on a greyed cross-company placeholder pill (owner wording, 2026-11-23). */
export const PLACEHOLDER_TIP = "placeholder, not counted";

/** The panel's sections in the old ERP's order: Order, QO, DO(s), Invoice(s); "+ Create" where the order has none. */
export function chainSections(c: DocChain | null | undefined): Array<{ key: string; label: string; items: Array<{ id: string; name: string; href: string | null; current?: boolean; placeholder?: boolean }>; create?: "do" | "invoice" }> {
  if (!c?.order) return [];
  // A placeholder (another company's $1-or-less "(NG)" invoice) is shown greyed: "placeholder, not counted".
  const items = (list: Array<{ id: string; name: string | null; href: string | null; placeholder?: boolean }>) => list.map((d) => ({ id: d.id, name: d.name || "Draft", href: d.href, ...(d.placeholder ? { placeholder: true } : {}) }));
  return [
    { key: "order", label: "Order", items: [{ id: c.order.id, name: c.order.orderNumber, href: c.order.href }] },
    { key: "qo", label: "QO", items: items(c.quotations) },
    { key: "do", label: c.dos.length > 1 ? "DOs" : "DO", items: items(c.dos), ...(c.canCreateDo ? { create: "do" as const } : {}) },
    { key: "invoice", label: c.invoices.length > 1 ? "Invoices" : "Invoice", items: items(c.invoices), ...(c.canCreateInvoice ? { create: "invoice" as const } : {}) },
  ];
}

/**
 * The editor's header fields with Link Document applied. Split on (WCT group): the Reference row is removed (the
 * remarks live in the right-hand Remarks box) and, with Link Document on, a full-row "Link Document" takes its place.
 * Split off but Link Document on (a DO / Invoice): the Reference row is renamed "Link Document" (its input is the pills).
 */
export function withLinkDocFields<F extends { fieldName: string; displayLabel?: string; displayOrder?: number; gridSize?: number }>(fields: F[], opts: { page: PageKind | null; linkOn: boolean; remarksSplit: boolean }): F[] {
  const isRef = (f: F) => f.fieldName === "documentInfo.referenceNo" || f.fieldName === "referenceNo";
  if (opts.remarksSplit && opts.page) {
    const out: F[] = [];
    for (const f of fields) {
      if (!isRef(f)) {
        out.push(f);
        continue;
      }
      // The Reference row goes (2026-11-24: no Customer Remarks on the left); Link Document takes its place as a full
      // row (gridSize 12: a half-width row would pair with its neighbour and squeeze both).
      if (opts.linkOn) out.push({ ...f, fieldName: LINK_DOC_FIELD, displayLabel: "Link Document", gridSize: 12 } as F);
    }
    return out;
  }
  if (!opts.linkOn || (opts.page !== "DELIVERY_ORDER" && opts.page !== "INVOICE")) return fields;
  return fields.map((f) => (isRef(f) ? { ...f, displayLabel: "Link Document" } : f));
}

/** The quotation's own Link Document row (a field name no template uses). */
export const LINK_DOC_FIELD = "wctLinkDocument";

/** The invoice's PO Number field (documentInfo.poNo, the key QO / DO already use). */
export const INVOICE_PO_FIELD = "documentInfo.poNo";

/**
 * WCT group (enableWctDocNav, 2026-11-24): an optional "PO Number" row on the INVOICE header (saved, searched by the
 * Invoices list, not printed). Never twice; every other page and org unchanged.
 */
export function withInvoicePoField<F extends { fieldName: string; displayLabel?: string; fieldType?: string; required?: boolean; gridSize?: number }>(fields: F[], opts: { page: PageKind | null; remarksSplit: boolean }): F[] {
  if (!opts.remarksSplit || opts.page !== "INVOICE") return fields;
  if (fields.some((f) => f.fieldName === INVOICE_PO_FIELD || f.fieldName === "poNo")) return fields.map((f) => (f.fieldName === INVOICE_PO_FIELD || f.fieldName === "poNo" ? { ...f, displayLabel: "PO Number" } : f));
  return [...fields, { fieldName: INVOICE_PO_FIELD, displayLabel: "PO Number", fieldType: "text", required: false } as unknown as F];
}
