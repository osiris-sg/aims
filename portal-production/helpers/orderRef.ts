// Reference = order link (round 39, WCT group, Elroy 2026-11-20). In the invoice and DO editors (both layouts) the
// Reference field is a combobox: typing searches this customer's quotations / orders (GET /order-refs/options);
// picking one links the document to that quotation's order (POST /order-refs/link, the order is made when missing)
// and the Reference shows "ORD… · QO…" as a chip with × to unlink; typed text that is not picked saves as a plain
// reference, no link. Pure helpers, tested by helpers/orderRef.test.mjs. API: api-server-production/src/orders/doc-order-ref*.ts.

export interface RefOption {
  quotationId: string;
  quotationName: string | null;
  subject: string | null;
  total: number | null;
  billedPct: number | null;
  customerId: string | null;
  customerName: string | null;
  orderId: string | null;
  orderNumber: string | null;
  statusLabel: string;
  /** Accepted and not fully billed (the default list). */
  open: boolean;
  linkable: boolean;
}

export interface RefLink {
  orderId: string;
  orderNumber: string;
  quotationId: string | null;
  quotationName: string | null;
  label: string;
  unlinkable: boolean;
}

type Kind = "INVOICE" | "DELIVERY_ORDER";

/** Which editor documents take the link: invoices and DOs. */
export function refDocKind(type: string | null | undefined): Kind | null {
  const t = String(type ?? "").toUpperCase();
  if (["INVOICE", "TAX_INVOICE", "INV"].includes(t)) return "INVOICE";
  if (["DELIVERY_ORDER", "DO"].includes(t)) return "DELIVERY_ORDER";
  return null;
}

/**
 * The combobox is on for WCT orders companies: a DO everywhere there; an invoice where the order reads linked invoices
 * (manual flow, or imported orders). Everyone else keeps the plain Reference text field.
 */
export function refLinkOn(type: string | null | undefined, f: { wctOrders?: boolean; manualFlow?: boolean; importedOrders?: boolean }): boolean {
  const kind = refDocKind(type);
  if (!kind || !f.wctOrders) return false;
  return kind === "DELIVERY_ORDER" || !!f.manualFlow || !!f.importedOrders;
}

/** The options request: the customer's (when one is picked), the typed text, all or the open ones. */
export function refOptionsPath(q: string, customerId: string | null | undefined, all: boolean): string {
  const p = new URLSearchParams();
  if (q.trim()) p.set("q", q.trim());
  if (customerId) p.set("customerId", customerId);
  if (all) p.set("all", "1");
  const s = p.toString();
  return `/order-refs/options${s ? `?${s}` : ""}`;
}

const money = (n: number | null | undefined) => (n == null ? "" : `S$ ${Number(n).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** A list row: the number (and its order), then subject, total and Billed %. */
export function refOptionRow(o: RefOption): { title: string; detail: string } {
  const title = [o.quotationName || "Quotation", o.orderNumber].filter(Boolean).join(" · ");
  const billed = o.billedPct == null ? "" : `Billed ${Math.round(o.billedPct)}%`;
  return { title, detail: [o.customerName, o.subject, money(o.total), billed, o.open ? "" : o.statusLabel].filter(Boolean).join(" · ") };
}

/** The editor's own Reference text (canonical documentInfo.referenceNo / config.referenceNo). */
export const referenceOf = (formData: any): string => String(formData?.documentInfo?.referenceNo ?? formData?.referenceNo ?? "");

/** The form after the Reference text changes (typed or set by a link): the editor's documentInfo.referenceNo. */
export function withReference<T extends Record<string, any>>(formData: T, text: string): T {
  return { ...formData, documentInfo: { ...(formData?.documentInfo || {}), referenceNo: text } };
}

/** An invoice with no real line yet (a fresh one has a single blank row): "Fill remaining lines" is offered. */
export function isEmptyItems(items: any[] | null | undefined): boolean {
  return !(items ?? []).some((it) => String(it?.description ?? "").trim() || Number(it?.amount) || Number(it?.unitPrice) || it?.itemCode || it?.inventoryItemId);
}

/** The editor's rows from the remaining lines. */
export function itemsFromLines(lines: Array<{ description: string; quantity: number; unitPrice: number; amount: number }>, firstId: number) {
  return lines.map((l, i) => ({
    id: firstId + i,
    itemCode: "",
    inventoryItemId: "",
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    uom: "",
    discount: 0,
    amount: l.amount,
  }));
}
