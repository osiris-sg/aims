// Invoice list Status filter options (2026-11-17). The base four are unchanged for every org.
// "Voided" (2026-11-20): every org can void an invoice now (the editor's Void button, a voided
// journal, a cancelled order), so the filter is offered everywhere; voided rows are hidden from
// the default list and shown only under it.
export const INVOICE_STATUS_BASE = [
  { value: "unconfirmed", label: "Unconfirmed" },
  { value: "pending_payment", label: "Awaiting Payment" },
  { value: "partially_paid", label: "Partially Paid" },
  { value: "paid", label: "Paid" },
];

export const VOIDED_STATUS_OPTION = { value: "voided", label: "Voided" };

export function invoiceStatusOptions(_manualOrderFlow?: boolean) {
  return [...INVOICE_STATUS_BASE, VOIDED_STATUS_OPTION];
}
