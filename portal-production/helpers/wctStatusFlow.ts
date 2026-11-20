// WCT group status wording (guru 2026-11-19, flag enableWctStatusFlow; WCT (S) Systems,
// WCT Racking, YMM Kitchen, BC Air). The stored statuses do not change; only what the
// user reads:
//   Quotation        Pending → Accepted
//   Invoice          Draft (made by the system, nobody has saved it yet) → Pending (someone
//                    saved it) → Awaiting Payment → Paid (Partially Paid in between)
//   Delivery order   Draft (made by the system, not saved yet) → Pending → Accepted
//                    (delivered and signed: the signed DO was uploaded, or the customer signed)
//   Order            Pending → Completed (its DOs are Accepted and every invoice is Paid)
// "Saved by someone" = config.savedAt: every editor save writes it, and the server strips
// it when it creates a document itself (documents.service createInvoiceFromDeliveryOrder,
// invoiceOrder…). Tested by helpers/wctStatusFlow.test.mjs.

import { docDisplayStatus, isInvoiceType } from "./docStatus";

export type FlowColor = "default" | "primary" | "success" | "warning" | "info" | "error";
export interface FlowStatus {
  /** Stable key, also the value the list Status filter sends. */
  key: string;
  label: string;
  color: FlowColor;
}

const F = (key: string, label: string, color: FlowColor): FlowStatus => ({ key, label, color });
export const FLOW = {
  quotationPending: F("unconfirmed", "Pending", "warning"),
  quotationAccepted: F("confirmed", "Accepted", "success"),
  invoiceDraft: F("flow_draft", "Draft", "default"),
  invoicePending: F("flow_pending", "Pending", "warning"),
  invoiceAwaiting: F("pending_payment", "Awaiting Payment", "info"),
  invoicePartlyPaid: F("partially_paid", "Partially Paid", "info"),
  invoicePaid: F("paid", "Paid", "success"),
  doDraft: F("flow_draft", "Draft", "default"),
  doPending: F("flow_pending", "Pending", "warning"),
  doAccepted: F("delivered_installed", "Accepted", "success"),
  cancelled: F("cancelled", "Cancelled", "default"),
  voided: F("voided", "Voided", "error"),
  orderPending: F("pending", "Pending", "warning"),
  orderCompleted: F("completed", "Completed", "success"),
};

const typeOf = (t?: string | null) => String(t || "").toUpperCase();
// Type codes as the list pages pass them (app/portal/sales/constants.ts).
const isQuotation = (t?: string | null) => ["QUOTATION", "QO1"].includes(typeOf(t));
const isDeliveryOrder = (t?: string | null) => ["DELIVERY_ORDER", "DO"].includes(typeOf(t));
/** The document types this wording covers. */
export const isFlowType = (t?: string | null) => isQuotation(t) || isInvoiceType(t) || isDeliveryOrder(t);

/** A person has saved this document in the editor (the server never writes savedAt itself). */
const touched = (config: any) => !!config?.savedAt;

type FlowDoc = { status?: string | null; config?: any; type?: string | null; cancelled?: boolean | null };

/** The WCT wording for a quotation, invoice or delivery order; null for any other type. */
export function flowDocStatus(doc: FlowDoc | null | undefined): FlowStatus | null {
  if (!doc || !isFlowType(doc.type)) return null;
  const c = doc.config || {};
  const raw = String(doc.status || "unconfirmed").toLowerCase();
  const draftish = raw === "draft" || raw === "unconfirmed";
  if (isQuotation(doc.type)) {
    if (raw === "cancelled" || raw === "voided" || c.cancelled === true || c.voided === true) return FLOW.cancelled;
    return draftish ? FLOW.quotationPending : FLOW.quotationAccepted;
  }
  if (isDeliveryOrder(doc.type)) {
    if (doc.cancelled === true || c.cancelled === true) return FLOW.cancelled;
    if (raw === "delivered_installed") return FLOW.doAccepted;
    // Waiting for the customer's signature, confirmed, or saved by someone = in progress.
    return draftish && !touched(c) && !c.awaitingSignature ? FLOW.doDraft : FLOW.doPending;
  }
  const s = docDisplayStatus(doc);
  if (s === "voided" || s === "cancelled") return FLOW.voided;
  if (s === "paid") return FLOW.invoicePaid;
  if (s === "partially_paid") return FLOW.invoicePartlyPaid;
  if (s === "pending_payment") return FLOW.invoiceAwaiting;
  if (s === "draft" || s === "unconfirmed") return touched(c) ? FLOW.invoicePending : FLOW.invoiceDraft;
  return null;
}

/** List Status filter options per document type (values the server's status filter understands). */
export function flowStatusOptions(types: string[], opts: { voided?: boolean } = {}): { value: string; label: string }[] | null {
  const t = types.map(typeOf);
  if (!t.length) return null;
  const o = (s: FlowStatus) => ({ value: s.key, label: s.label });
  if (t.every(isQuotation)) return [o(FLOW.quotationPending), o(FLOW.quotationAccepted)];
  if (t.every(isDeliveryOrder)) return [o(FLOW.doDraft), o(FLOW.doPending), o(FLOW.doAccepted)];
  if (t.every((x) => isInvoiceType(x)))
    return [o(FLOW.invoiceDraft), o(FLOW.invoicePending), o(FLOW.invoiceAwaiting), o(FLOW.invoicePartlyPaid), o(FLOW.invoicePaid), ...(opts.voided ? [o(FLOW.voided)] : [])];
  return null;
}

/**
 * The order's wording: Completed once nothing is left to do (delivered, signed and paid),
 * Cancelled stays, everything before that is Pending.
 */
export function flowOrderStatus(order: { status?: string | null; completed?: unknown; invoices?: { status?: string | null }[] | null } | null | undefined): FlowStatus {
  const s = String(order?.status || "");
  if (s === "CANCELLED") return FLOW.cancelled;
  // Marked complete by hand (order page → Mark complete) counts as Completed too.
  if (s === "PAID" || s === "CLOSED" || s === "COMPLETED" || !!order?.completed) return FLOW.orderCompleted;
  // The service report can go out before the money comes in: Completed only when paid.
  const live = (order?.invoices ?? []).filter((i) => !["voided", "cancelled"].includes(String(i.status || "")));
  if (s === "SERVICE_REPORT_SENT" && live.length > 0 && live.every((i) => i.status === "paid")) return FLOW.orderCompleted;
  return FLOW.orderPending;
}
