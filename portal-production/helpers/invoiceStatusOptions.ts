// Invoice list Status filter options (2026-11-17). The base four are unchanged for every org;
// "Voided" (invoices voided with a cancelled order, hidden from the default list) is added only
// on the manual order flow, the only place such invoices exist.
export const INVOICE_STATUS_BASE = [
  { value: "unconfirmed", label: "Unconfirmed" },
  { value: "pending_payment", label: "Awaiting Payment" },
  { value: "partially_paid", label: "Partially Paid" },
  { value: "paid", label: "Paid" },
];

export function invoiceStatusOptions(manualOrderFlow: boolean) {
  return manualOrderFlow ? [...INVOICE_STATUS_BASE, { value: "voided", label: "Voided" }] : INVOICE_STATUS_BASE;
}
