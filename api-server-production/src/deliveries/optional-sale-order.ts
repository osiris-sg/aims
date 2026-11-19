/**
 * Optional Sales Order (Biofuel, 2026-11-19; flag enableOptionalSaleOrder).
 *
 * A real (non-draft) scheduled delivery needs a Sales Order, except for
 * service-job orgs (enableQuotationToDelivery, WCT) and orgs with this flag.
 * The flag relaxes ONLY the Sales Order: the Project stays required. A run with
 * no Sales Order gets a DO with no "Your PO No." (blank rows are not printed) and
 * a draft invoice priced from the price list, flagged in the editor for a check.
 */
export const OPTIONAL_SALE_ORDER_FLAG = 'enableOptionalSaleOrder';

export function saleOrderMissing(opts: {
  isDraft: boolean;
  saleOrderId?: string | null;
  serviceJobOrg: boolean;
  optionalSaleOrder: boolean;
}): boolean {
  return !opts.isDraft && !opts.saleOrderId && !opts.serviceJobOrg && !opts.optionalSaleOrder;
}
