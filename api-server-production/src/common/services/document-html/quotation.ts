/**
 * Server-side port of the portal's QUOTATION preview
 * (CleanDocumentPreview.tsx L3435–4174, standard / non-Biofuel branch).
 * Literal strings, label text, column handling and totals maths mirror the
 * portal so the printed PDF matches what the user sees.
 */
import {
  descriptionText,
  escapeHtml,
  formatDate,
  groupDeliveryLines,
  infoRow,
  makeDi,
  money,
  numberToWords,
  richContent,
} from './shared';

const DEFAULT_INTERNAL_COLUMNS = ['discountPrice', 'costPrice'];

const FALLBACK_LABELS: Record<string, string> = {
  item: 'Item',
  taggedAsset: 'Tagged',
  cuModel: 'CU Model',
  fcuModel: 'FCU Model',
  listPrice: 'Unit Price',
  location: 'Location',
  remarks: 'Remarks',
  quantity: 'Quantity',
  unitPrice: 'Unit-Price',
  amount: 'Amount',
  description: 'Description',
  uom: 'uom',
  discount: 'Disc %',
  tax: 'Tax %',
};

const alignFor = (col: string): string =>
  col === 'quantity' ? 'center' : ['unitPrice', 'salePrice', 'listPrice', 'amount'].includes(col) ? 'right' : 'left';

export function renderQuotationBody(data: any, organization: any): string {
  const di = makeDi(data);
  const items = groupDeliveryLines(data?.items || []);

  // Totals are derived from the lines, exactly as the portal does.
  const subtotal = items.reduce((s: number, it: any) => s + (Number(it.amount) || 0), 0);
  const discountAmount = Number(di('discountAmount')) || 0;
  const subtotalAfterDiscount = subtotal - discountAmount;
  const currency = di('currency', 'SGD');
  const finalAmount = subtotalAfterDiscount;

  const company = data?.company || {};
  const customer = data?.customer || {};

  // ── company header (centred) ────────────────────────────────────────────
  const coRegNo = company.coRegNo ? ` Co. Reg No. : ${escapeHtml(company.coRegNo)}` : '';
  const fax = company.fax ? ` Fax: ${escapeHtml(company.fax)}` : '';
  const header = `
  <div style="text-align:center;margin-bottom:16px;">
    <p style="font-size:18px;font-weight:700;margin-bottom:2.4px;letter-spacing:0.5px;">${escapeHtml(company.name || organization?.name || '')}</p>
    <p style="font-size:13px;margin-bottom:1.6px;">GST Reg No: ${escapeHtml(company.gstRegNo || organization?.registrationNumber || '')}${coRegNo}</p>
    <p style="font-size:13px;margin-bottom:1.6px;">${escapeHtml(company.address || organization?.address || '')}</p>
    <p style="font-size:13px;">Tel: ${escapeHtml(company.phoneNumber || organization?.phoneNumber || '')}${fax}</p>
  </div>`;

  // ── "To :" box + right-hand details ─────────────────────────────────────
  const docNumber = di('documentNumber', data?.name) || '';
  const detailRows =
    infoRow('UEN', customer.gstRegNo || company.gstRegNo || organization?.registrationNumber) +
    // QUOTATION NO. always renders (bold), unlike the hiding InfoRows.
    `<div style="display:flex;font-size:14px;line-height:1.4;">
       <span style="min-width:110px;font-weight:600;">QUOTATION NO.</span>
       <span style="margin-left:4px;margin-right:8px;font-weight:600;">:</span>
       <span style="flex:1;font-weight:600;">${escapeHtml(docNumber)}</span>
     </div>` +
    infoRow('Date', formatDate(di('date'))) +
    infoRow('Your Ref', di('referenceNo')) +
    infoRow('RE', di('subject')) +
    infoRow('Terms', di('paymentTerms')) +
    infoRow('Customer', customer.customerCode || data?.customerCode);

  const partyRow = `
  <div style="display:flex;justify-content:space-between;margin-bottom:8px;align-items:flex-start;">
    <div style="width:45%;border:1px solid #000;padding:12px;">
      <p style="font-size:14px;font-weight:600;margin-bottom:4px;">To :</p>
      <p style="font-size:14px;font-weight:600;">${escapeHtml(customer.name || data?.customerName || '')}</p>
      <p style="font-size:14px;white-space:pre-line;">${escapeHtml(data?.billTo || customer.address || data?.customerAddress || '')}</p>
    </div>
    <div style="width:45%;display:flex;justify-content:flex-end;padding-left:32px;">
      <div style="line-height:1.4;">
        <p style="font-size:16px;font-weight:700;margin-bottom:8px;">QUOTATION</p>
        ${detailRows}
      </div>
    </div>
  </div>`;

  // ── Attn line ───────────────────────────────────────────────────────────
  const attnName = di('contactName') || di('contact') || data?.attention?.name;
  const attnNumber = di('contactNumber');
  const attn = attnName
    ? `<div style="margin-bottom:8px;"><p style="font-size:14px;font-weight:600;">Attn : ${escapeHtml(attnName)}${attnNumber ? ` (${escapeHtml(attnNumber)})` : ''}</p></div>`
    : '';

  const intro = `<p style="font-size:13px;margin-bottom:16px;">We are pleased to quote you herewith the following items required by you. They are ;-</p>`;

  // ── items table ─────────────────────────────────────────────────────────
  const table = Array.isArray(data?.tableColumnOrder) && data.tableColumnOrder.length
    ? configDrivenTable(data, items)
    : hardcodedTable(items);

  // ── totals ──────────────────────────────────────────────────────────────
  const totals = `
  <div style="margin-top:16px;">
    <div style="display:flex;justify-content:flex-end;border-top:1px solid #000;padding-top:8px;page-break-inside:avoid;break-inside:avoid;">
      <div style="min-width:200px;">
        <div style="display:flex;justify-content:space-between;padding:2.4px 0;font-size:13px;">
          <span>Sub-Total</span><span>${money(subtotal)}</span>
        </div>
        ${discountAmount > 0
          ? `<div style="display:flex;justify-content:space-between;padding:2.4px 0;font-size:13px;"><span>Discount</span><span>${money(discountAmount)}</span></div>`
          : ''}
        <div style="display:flex;justify-content:space-between;padding:4px 0 0;margin-top:4px;border-top:1px solid #000;font-size:13px;">
          <span>Total</span>
          <span style="display:flex;gap:8px;"><span>${escapeHtml(currency)}</span><span style="font-weight:600;">${money(subtotalAfterDiscount)}</span></span>
        </div>
      </div>
    </div>
  </div>`;

  const inWords = `<div style="margin-top:16px;margin-bottom:16px;"><p style="font-size:13px;">${escapeHtml(numberToWords(finalAmount))}</p></div>`;

  // ── footer: closing lines, notes, T&C, configured footer message ────────
  const footerMessage = di('footerMessage');
  const hasDocTypeDefaults = !!footerMessage;

  const notesBlock =
    data?.note || data?.remarks
      ? `<div style="display:flex;gap:24px;margin-bottom:16px;">
           ${data?.note ? `<div style="flex:1;min-width:0;page-break-inside:avoid;"><p style="font-size:13px;font-weight:600;">Note:</p>${richContent(data.note)}</div>` : ''}
           ${data?.remarks ? `<div style="flex:1;min-width:0;page-break-inside:avoid;"><p style="font-size:13px;font-weight:600;">Remarks:</p>${richContent(data.remarks)}</div>` : ''}
         </div>`
      : '';

  const tncBlock = data?.termsAndConditions
    ? `<div style="margin-bottom:16px;">
         <p style="font-size:13px;font-weight:600;page-break-after:avoid;break-after:avoid;">Terms &amp; Conditions:</p>
         ${richContent(data.termsAndConditions)}
       </div>`
    : '';

  // The two hardcoded closing lines are suppressed when the org configures its
  // own footer message, and the note/T&C order flips — same as the portal.
  const closing = hasDocTypeDefaults
    ? tncBlock + notesBlock
    : `<p style="font-size:13px;margin-bottom:16px;">Hope the above Quotation meets your requirement. Pls contact us if you have any doubt.</p>` +
      `<p style="font-size:13px;font-style:italic;margin-bottom:24px;">This is a computer generated Quotation. No signature is required.</p>` +
      notesBlock +
      tncBlock;

  const footerMsgBlock = footerMessage
    ? `<div style="margin-top:16px;padding-top:8px;border-top:1px dashed rgba(0,0,0,0.15);page-break-inside:avoid;">
         ${richContent(footerMessage, 'font-size:13px;line-height:1.6;text-align:center;font-style:italic;')}
       </div>`
    : '';

  return header + partyRow + attn + intro + table + totals + inWords + closing + footerMsgBlock;
}

/** Template-driven columns (tableColumnOrder / columnLabels / internalColumns). */
function configDrivenTable(data: any, items: any[]): string {
  const internalColumns: string[] = Array.isArray(data.internalColumns) ? data.internalColumns : DEFAULT_INTERNAL_COLUMNS;
  const columnLabels: Record<string, string> = data.columnLabels || {};

  const columnHasData = (c: string): boolean => {
    if (c === 'location') return items.some((i) => String(i.location ?? '').trim() !== '');
    if (c === 'cuModel') return items.some((i) => String(i.cuCode ?? '').trim() !== '');
    if (c === 'fcuModel') return items.some((i) => (i.fcus?.length ?? 0) > 0 || String(i.fcuCode ?? '').trim() !== '');
    return true;
  };

  // S/No and Item Code are dropped on all quotations (portal behaviour).
  const columns: string[] = data.tableColumnOrder.filter(
    (c: string) => !internalColumns.includes(c) && columnHasData(c) && c !== 'no' && c !== 'item',
  );

  const labelFor = (col: string) => columnLabels[col] || FALLBACK_LABELS[col] || col;

  const valueFor = (col: string, item: any, index: number): string => {
    switch (col) {
      case 'no':
        return String(index + 1);
      case 'item':
        return escapeHtml(item.itemCode || item.code || '');
      case 'taggedAsset':
        return escapeHtml(item.taggedAssetCode || '');
      case 'cuModel':
        return escapeHtml(item.cuCode || '');
      case 'masterQty':
        return escapeHtml(item.masterQty ?? 1);
      case 'fcuModel':
        return item.fcus?.length
          ? item.fcus.map((f: any) => `<span style="display:block;">${escapeHtml(f.code || '')}</span>`).join('')
          : escapeHtml(item.fcuCode || '');
      case 'listPrice':
        return item.listPrice == null ? '' : Number(item.listPrice).toFixed(2);
      case 'description':
        return descriptionText(item.description || '');
      case 'quantity':
        return item.fcus?.length
          ? item.fcus.map((f: any) => `<span style="display:block;">${escapeHtml(f.qty ?? 1)}</span>`).join('')
          : escapeHtml(item.quantity?.toLocaleString?.('en-US') ?? item.quantity ?? '');
      case 'unitPrice':
        return item.unitPrice == null ? '' : Number(item.unitPrice).toFixed(2);
      // Two-rate quotation: the sale-price money column beside the rental
      // unitPrice. Money-formatted + right-aligned (alignFor), not the raw
      // item[col] default. Empty when the line has no sale price.
      case 'salePrice':
        return item.salePrice == null || item.salePrice === '' ? '' : Number(item.salePrice).toFixed(2);
      case 'amount':
        return money(item.amount);
      case 'discount':
        return item.discount == null ? '' : escapeHtml(item.discount);
      case 'tax':
        return item.tax == null ? '' : escapeHtml(item.tax);
      case 'uom':
        return escapeHtml(item.uom || '');
      default:
        return escapeHtml(item[col] || '');
    }
  };

  const head = columns
    .map((c) => `<th style="text-align:${alignFor(c)};">${escapeHtml(labelFor(c))}</th>`)
    .join('');

  const nonTag = items.filter((i) => !i.isTagGroup);
  const body = nonTag
    .map(
      (item, idx) =>
        `<tr style="vertical-align:top;">${columns
          .map((c) => `<td style="text-align:${alignFor(c)};">${valueFor(c, item, idx)}</td>`)
          .join('')}</tr>`,
    )
    .join('');

  // "Tagged CUs" sub-section
  const tagItems = items.filter((i) => i.isTagGroup);
  const tagged = tagItems.length
    ? `<tr><td colspan="${columns.length}" style="padding-top:16px;padding-bottom:4px;font-weight:600;border-top:1px solid #000;">Tagged CUs</td></tr>` +
      tagItems
        .map(
          (tag) =>
            `<tr style="vertical-align:top;">${columns
              .map((c) =>
                c === 'description'
                  ? `<td>${escapeHtml(tag.taggedAssetName || tag.description || '')}${
                      tag.linkedCount > 0
                        ? `<span style="font-size:12px;color:#666;margin-left:8px;">(shared by ${tag.linkedCount} FCU${tag.linkedCount === 1 ? '' : 's'})</span>`
                        : ''
                    }</td>`
                  : `<td style="text-align:${alignFor(c)};"></td>`,
              )
              .join('')}</tr>`,
        )
        .join('')
    : '';

  const filler =
    nonTag.length < 8
      ? Array.from({ length: 8 - nonTag.length })
          .map(() => `<tr style="height:35px;">${columns.map(() => '<td>&nbsp;</td>').join('')}</tr>`)
          .join('')
      : '';

  return `<div style="margin-bottom:24px;"><table><thead><tr>${head}</tr></thead><tbody>${body}${tagged}${filler}</tbody></table></div>`;
}

/** Default columns when the template defines none. */
function hardcodedTable(items: any[]): string {
  const hasUom = items.some((i) => i.uom && String(i.uom).trim() !== '');
  const descWidth = hasUom ? '40%' : '48%';

  const head =
    `<th style="width:4%;text-align:left;">No</th>` +
    `<th style="width:${descWidth};text-align:left;">Description</th>` +
    `<th style="width:10%;text-align:center;">Quantity</th>` +
    (hasUom ? `<th style="width:10%;text-align:center;">uom</th>` : '') +
    `<th style="width:14%;text-align:right;">Unit-Price</th>` +
    `<th style="width:16%;text-align:right;">Amount</th>`;

  const body = items
    .map(
      (item, index) =>
        `<tr style="vertical-align:top;">` +
        `<td>${index + 1}</td>` +
        `<td>${descriptionText(item.description || '')}${
          item.details ? `<p style="font-size:13px;color:#666;">${escapeHtml(item.details)}</p>` : ''
        }</td>` +
        `<td style="text-align:center;">${escapeHtml(item.quantity?.toLocaleString?.('en-US') ?? item.quantity ?? '')}</td>` +
        (hasUom ? `<td style="text-align:center;">${escapeHtml(item.uom || '')}</td>` : '') +
        `<td style="text-align:right;">${item.unitPrice == null ? '' : Number(item.unitPrice).toFixed(2)}</td>` +
        `<td style="text-align:right;">${money(item.amount)}</td>` +
        `</tr>`,
    )
    .join('');

  const colCount = hasUom ? 6 : 5;
  const filler =
    items.length <= 3
      ? Array.from({ length: Math.max(0, 8 - items.length) })
          .map(() => `<tr style="height:35px;">${Array.from({ length: colCount }).map(() => '<td>&nbsp;</td>').join('')}</tr>`)
          .join('')
      : '';

  return `<div style="margin-bottom:24px;"><table><thead><tr>${head}</tr></thead><tbody>${body}${filler}</tbody></table></div>`;
}
