/**
 * Canonical set of document templates every organization needs so that the
 * "create document" lookups (getDocumentTemplateByType) resolve. One active +
 * default template per document type. config is intentionally left null — the
 * document creator falls back to per-type default field/column layouts when a
 * template has no config, so these are functional out of the box.
 *
 * `type` values match the createDocumentType strings the portal uses
 * (see SALES_DOCUMENT_TYPES / INVENTORY_DOCUMENT_TYPES). Short forms (PO/PR/
 * SAI/SAO) are covered here; long-form lookups (PURCHASE_ORDER, etc.) fall
 * back to the short form in the convert/order flows.
 */
export interface DefaultTemplateSpec {
  type: string;
  templateVariant: string;
  name: string;
}

export const DEFAULT_DOCUMENT_TEMPLATES: DefaultTemplateSpec[] = [
  { type: 'QUOTATION', templateVariant: 'QO1', name: 'Quotation' },
  { type: 'SALES_ORDER', templateVariant: 'SO', name: 'Sales Order' },
  { type: 'DELIVERY_ORDER', templateVariant: 'DO', name: 'Delivery Order' },
  { type: 'INVOICE', templateVariant: 'TI', name: 'Invoice' },
  { type: 'CREDIT_NOTE', templateVariant: 'CN', name: 'Credit Note' },
  { type: 'DEBIT_NOTE', templateVariant: 'DN', name: 'Debit Note' },
  { type: 'PO', templateVariant: 'PO', name: 'Purchase Order' },
  { type: 'PR', templateVariant: 'PR', name: 'Purchase Return' },
  { type: 'SAI', templateVariant: 'SAI', name: 'Stock Adjustment In' },
  { type: 'SAO', templateVariant: 'SAO', name: 'Stock Adjustment Out' },
  { type: 'RETURN_DELIVERY_ORDER', templateVariant: 'RDO', name: 'Return Delivery Order' },
  { type: 'MAINTENANCE_SERVICE_REPORT', templateVariant: 'MSR', name: 'Maintenance Service Report' },
];
