/**
 * Invoice + DO on the WCT layout for a WCT group org whose own templates are
 * the stock ones (BC Air, 2026-11-16). Chosen by the org setting
 * features.wctDocumentBrand = 'BCAIR'; every other org (WCT (S), Racking,
 * YMM and all others) has no setting and is unchanged.
 *
 * The setting only changes how a BC Air invoice / DO is DRAWN: no document
 * row, number, money or journal is touched. A template that already picks a
 * named layout (BC Air's quotation is on 'wct') is left as it is, and imported
 * documents (config.erpImport: BC Air's 3,693 ABSS invoices) keep their stock look.
 *
 * BC Air's text is taken from its invoice I003278 (13/11/2026), as printed.
 */
import { DocumentDesign, resolveDesign } from './design';

export const WCT_DOC_BRAND_SETTING = 'wctDocumentBrand';
/** Same key as DOC_REMARKS_FLAG in common/org-features.ts. */
const DOC_REMARKS_SETTING = 'enableDocRemarks';
/** Same key as RACKING_LAYOUT_FLAG in common/org-features.ts (WCT Racking, 2026-11-18). */
const RACKING_LAYOUT_SETTING = 'enableRackingLayout';
/** Same key as RACKING_WATERMARK_FLAG in common/org-features.ts. */
const RACKING_WATERMARK_SETTING = 'enableRackingWatermark';
/** Same key as SNO_SKIP_TITLES_SINCE_SETTING in common/org-features.ts (an ISO date-time). */
const SNO_SKIP_TITLES_SINCE_SETTING = 'snoSkipTitlesSince';

/**
 * Section titles take no S/No on WCT-layout documents CREATED at or after the org's
 * features.snoSkipTitlesSince (2026-11-18: WCT (S), BC Air, WCT Racking). A document made before it, or one
 * whose age is unknown, prints exactly as before. `isNew` = not saved yet (the editor's first preview).
 */
export function skipsTitleNumbers(features: any, doc?: { createdAt?: Date | string | null; isNew?: boolean }): boolean {
  const raw = features && features[SNO_SKIP_TITLES_SINCE_SETTING];
  const since = typeof raw === 'string' ? new Date(raw).getTime() : NaN;
  if (!isFinite(since)) return false;
  if (doc?.isNew) return true;
  const at = doc?.createdAt ? new Date(doc.createdAt).getTime() : NaN;
  return isFinite(at) && at >= since;
}
export type WctDocBrand = 'BCAIR';

const INVOICE_TYPES = ['INVOICE', 'TI', 'TI2'];
const DELIVERY_ORDER_TYPES = ['DELIVERY_ORDER', 'DO'];

export const wctDocBrandOf = (features: any): WctDocBrand | null => (features && features[WCT_DOC_BRAND_SETTING] === 'BCAIR' ? 'BCAIR' : null);

/** The design a document of `templateType` prints with: the template's own, or (branded orgs) the WCT layout in the org's brand. */
export function effectiveDesign(
  rawStyle: any,
  templateType: string | null | undefined,
  features: any,
  doc?: { imported?: boolean; createdAt?: Date | string | null; isNew?: boolean },
): DocumentDesign & { brand?: WctDocBrand; docRemarks?: true; racking?: true; watermark?: true; snoSkipTitles?: true } {
  const design = resolveDesign(rawStyle);
  const brand = wctDocBrandOf(features);
  const t = String(templateType || '').toUpperCase();
  // Imported documents (ABSS / ERP: config.erpImport) keep the look they always had.
  if (doc?.imported) return design;
  // Remarks on the stock invoice / DO print (features.enableDocRemarks, WCT group 2026-11-18). Orgs without it: no key.
  const remarks = features && features[DOC_REMARKS_SETTING] === true && (INVOICE_TYPES.includes(t) || DELIVERY_ORDER_TYPES.includes(t)) ? { docRemarks: true as const } : {};
  // WCT Racking (features.enableRackingLayout): its look on the WCT layout (wct.ts). Orgs without it: no key.
  const racking = features && features[RACKING_LAYOUT_SETTING] === true && design.layout === 'wct' ? { racking: true as const } : {};
  // Racking quotation watermark (features.enableRackingWatermark): the org logo, pale, behind the content (wct.ts).
  const watermark = racking.racking && features[RACKING_WATERMARK_SETTING] === true ? { watermark: true as const } : {};
  const branded = !(!brand || design.layout !== 'standard' || !(INVOICE_TYPES.includes(t) || DELIVERY_ORDER_TYPES.includes(t)));
  // Section titles without an S/No (features.snoSkipTitlesSince): WCT layout, documents created from that date on.
  const sno = (branded || design.layout === 'wct') && skipsTitleNumbers(features, doc) ? { snoSkipTitles: true as const } : {};
  if (!branded) return { ...design, ...remarks, ...racking, ...watermark, ...sno };
  return { ...design, layout: 'wct', logoPosition: design.logoPosition === 'none' ? 'left' : design.logoPosition, brand, ...remarks, ...sno };
}

/** BC Air's paper (I003278). */
export const BCAIR_DOC = {
  name: 'BC Air Pte Ltd',
  // Letterhead lines under the name, label bold as printed.
  lines: [
    [{ text: '19 Kaki Bukit Industrial Terrace, Level 3, Singapore 416099' }],
    [{ label: 'Reg No:', text: '202205130K' }],
    [{ label: 'Paynow Reg No:', text: '202205130K001' }],
    [{ label: 'Tel:', text: '6741 1697' }, { label: 'Email:', text: 'admin@bcair.com.sg', mail: true }],
    // In I003278's text layer but not visible on the printed page (listed for Elroy).
    [{ label: 'Website:', text: 'https://www.bcair.co' }],
  ] as Array<Array<{ label?: string; text: string; mail?: boolean }>>,
  numberLabel: { invoice: 'Invoice No', do: 'Delivery Order No' },
  invoiceTitle: 'INVOICE',
  totals: { total: 'Total Amount:', discount: 'Discount:', paid: 'Amount Paid:', due: 'Amount Due:', paymentType: 'Type of Payment:' },
  tncTitle: 'Terms & Conditions:',
  // The invoice's Terms & Conditions as printed (used when the document carries none of its own).
  tnc: [
    '- GIRO Transferring payments to " BC Air Pte Ltd " Bank: OCBC Account No: 604-567-263-001 Type of account: Current',
    '- All goods remain the property to BC Air Pte Ltd for as long as any account due is left unpaid & shall be released to BC Air Pte Ltd when on demand.',
    '- All cheques should be crossed and made payable to " BC Air Pte Ltd " upon the receipt of invoice.',
    '- Terms & Conditions may change without prior notice to the customer',
    '- All cutting & plastering of ceiling, hacking of provision for inlet/ discharge, roof opening is excluded in this quotation unless stated in above works mentioned',
    "-Goods herein remain the property of BC Air Pte Ltd until the full sum of this Project has been received. The buyer irrevocably agrees to allow representative/agent of the seller to enter upon any premises owned or controlled by the buyer. The Company shall not be responsible for any loss or damage to assets, items or valuables found in or connected to the goods. And in such an event that the goods are deliberately withheld by the client, the Company shall have recourse to the recovery of the racks under law and the Client shall indemnify the Company for all costs involved in the said recovery and any damage or compensation connected to the recourse.",
    '- Kindly make the cheque payable to " BC Air Pte Ltd " and mail to 19 Kaki Bukit Industrial Terrace, Level 3, Singapore 416099.',
    '- Please indicate the invoice number when making payment.',
    "- Please note that any overdue payment/s will be listed in DP Credit Bureau's records and this record may be accessed by financial institutions and other approving credit companies.",
    '- If the deposit has failed to be received by the Company within three (12) months or otherwise stated, an administrative charge of 20% of the Project Value will be charged to the Client.',
  ],
  sign: { closing: 'Yours Sincerely,', name: 'Ms Yew', title: 'Admin Manager of', company: 'BC Air Pte Ltd', confirm: 'Confirmation of Order :', stamp: 'Company Stamp & Authorized Signature' },
  footer: 'Thank You for Your Patronage . We look forward to serving you again!',
} as const;

/** An imported (ABSS / ERP) document: its config carries erpImport. */
export const isImportedDoc = (config: any): boolean => !!(config && typeof config === 'object' && config.erpImport);
