// Orders list "+" (round 38, WCT group, enableWctOrders orgs, 2026-11-20). The API marks, per row, which empty
// Quotation / DO(s) / Invoice cells the order page would fill (row.add, api orders/order-list-add.ts); the portal adds
// the person's permissions, the same ones the API checks for each step. Tested by helpers/orderListAdd.test.mjs.

export type ListAddKind = "quotation" | "do" | "invoice";

/** What each "+" needs (every one): the API's @Permissions on the call it makes. */
export const LIST_ADD_PERMISSIONS: Record<ListAddKind, Array<[string, string]>> = {
  // POST /orders/:id/new-quotation
  quotation: [
    ["orders", "update"],
    ["documents", "create-basic"],
  ],
  // POST /deliveries/order/:orderId/dos (the order page's Add DO)
  do: [["documents", "create-basic"]],
  // POST /orders/:id/invoice-now and /invoice-remaining (the order page's Create invoice)
  invoice: [["documents", "update"]],
};

export interface ListAddAccess {
  /** The global admin (admin@osiris.sg) or a superadmin / osirisadmin role: every "+". */
  admin: boolean;
  has: (resource: string, action: string) => boolean;
}

/** The cell's "+": the row allows it and the person may do it. Unknown access (still loading) = no "+". */
export function canAddCell(row: { add?: Partial<Record<ListAddKind, boolean>> | null } | null | undefined, kind: ListAddKind, access: ListAddAccess | null): boolean {
  if (!row?.add?.[kind] || !access) return false;
  return access.admin || LIST_ADD_PERMISSIONS[kind].every(([r, a]) => access.has(r, a));
}

/** "+" Invoice opens the order page with its own Create invoice (the same dialog and rules). */
export const createInvoiceHref = (orderId: string) => `/portal/orders/${orderId}?open=create-invoice`;

export const LIST_ADD_LABEL: Record<ListAddKind, string> = { quotation: "New quotation", do: "Add DO", invoice: "Create invoice" };
