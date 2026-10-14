/**
 * Server-side port of the portal's CREDIT NOTE / DEBIT NOTE preview
 * (CleanDocumentPreview.tsx, the CN/DN branch). Before this port a credit
 * note rendered through the legacy generic layout: titled "Tax Invoice",
 * with a due date, payment instructions and 9% GST added to a tax-free
 * document (guru 2026-10-15, chat home side panel).
 *
 * Literal strings, labels, column widths and the totals maths mirror the
 * portal so the side panel, the emailed PDF and the printed page agree.
 */
import { descriptionText, escapeHtml, formatDate, infoRow, makeDi, numberToWords, richContent } from './shared';

export type NoteKind = 'credit' | 'debit';

export function renderNoteBody(data: any, organization: any, kind: NoteKind): string {
  const di = makeDi(data);
  const items: any[] = Array.isArray(data?.items) ? data.items : [];
  const company = data?.company || {};
  const customer = data?.customer || {};
  const isCredit = kind === 'credit';
  const title = isCredit ? 'CREDIT NOTE' : 'DEBIT NOTE';
  const noun = isCredit ? 'Credit Note' : 'Debit Note';

  const subtotal = items.reduce((s: number, it: any) => s + (Number(it.amount) || 0), 0);

  // ── Totals maths, identical to the portal block ─────────────────────────
  const rate = Number(di('rate')) || 1;
  const currency = di('currency', 'SGD');
  const discountPercent = Number(di('discountPercent') ?? di('discount')) || 0;
  const taxApplicable = di('taxApplicable');
  const isTaxApplicable = taxApplicable !== 'N' && taxApplicable !== false;
  const gstPercent = isTaxApplicable ? Number(di('gstPercent')) || 9 : 0;
  const isAbsorbTax = di('absorbTax') === 'Y' || di('absorbTax') === true;
  const grossTotal = subtotal;
  const discountAmount =
    di('discountAmount') != null && di('discountAmount') !== '' ? Number(di('discountAmount')) || 0 : grossTotal * (discountPercent / 100);
  const subtotalAfterDiscount = grossTotal - discountAmount;
  const gstAmount =
    isAbsorbTax && gstPercent > 0 ? (subtotalAfterDiscount * gstPercent) / (100 + gstPercent) : subtotalAfterDiscount * (gstPercent / 100);
  const finalTotal = isAbsorbTax ? subtotalAfterDiscount : subtotalAfterDiscount + gstAmount;
  const displayGross = isAbsorbTax ? grossTotal - gstAmount : grossTotal;
  const displayNet = isAbsorbTax ? subtotalAfterDiscount - gstAmount : subtotalAfterDiscount;

  // ── company header (centred, no logo: same as the portal's CN/DN page) ──
  const coReg = company.coRegNo ? ` Co. Reg No: ${escapeHtml(company.coRegNo)}` : '';
  const fax = company.fax ? ` Fax: ${escapeHtml(company.fax)}` : '';
  const header = `
  <div style="text-align:center;margin-bottom:16px;">
    <p style="font-size:18px;font-weight:700;margin-bottom:2.4px;letter-spacing:0.5px;">${escapeHtml(company.name || organization?.name || '')}</p>
    <p style="font-size:13px;margin-bottom:1.6px;">GST Reg No: ${escapeHtml(company.gstRegNo || organization?.registrationNumber || '')}${coReg}</p>
    <p style="font-size:13px;margin-bottom:1.6px;">${escapeHtml(company.address || organization?.address || '')}</p>
    <p style="font-size:13px;">Tel: ${escapeHtml(company.phoneNumber || organization?.phoneNumber || '')}${fax}</p>
  </div>`;

  // ── Bill To / Deliver To (left) + note details (right) ──────────────────
  const attnName = di('contactName') || di('contact') || data?.contact;
  const attnNumber = di('contactNumber');
  const deliverTo = data?.deliveryTo
    ? `<div>
         <p style="font-size:13px;font-weight:600;margin-bottom:4px;">Deliver To :</p>
         <p style="font-size:13px;white-space:pre-line;">${escapeHtml(data.deliveryTo)}</p>
         ${attnName ? `<p style="font-size:13px;">Attn: ${escapeHtml(attnName)}${attnNumber ? ` (${escapeHtml(attnNumber)})` : ''}</p>` : ''}
       </div>`
    : '';

  const detailRows =
    infoRow(`${noun} No.`, di('documentNumber', data?.name), '110px') +
    infoRow('Date', formatDate(di('date')), '110px') +
    infoRow('Customer code', customer.customerCode || data?.customerCode, '110px') +
    infoRow('Salesman code', di('salesPerson') || di('salesman'), '110px') +
    infoRow('Invoice No.', di('invoiceNo'), '110px') +
    infoRow('Delivery Order No.', di('doNo'), '110px') +
    infoRow('Contact Name', attnName, '110px') +
    infoRow('Contact No.', attnNumber, '110px') +
    infoRow('Terms', di('paymentTerms', '0 DAYS'), '110px');

  const partyRow = `
  <div style="display:flex;justify-content:space-between;margin-bottom:8px;align-items:flex-start;">
    <div style="width:45%;">
      <div style="margin-bottom:24px;">
        <p style="font-size:13px;font-weight:600;margin-bottom:4px;">Bill To :</p>
        <p style="font-size:13px;font-weight:600;">${escapeHtml(customer.name || data?.customerName || '')}</p>
        <p style="font-size:13px;white-space:pre-line;">${escapeHtml(data?.billTo || customer.address || data?.customerAddress || '')}</p>
      </div>
      ${deliverTo}
    </div>
    <div style="width:45%;display:flex;justify-content:flex-end;padding-left:32px;">
      <div style="line-height:1.4;">
        <p style="font-size:16px;font-weight:700;margin-bottom:8px;">${title}</p>
        ${detailRows}
      </div>
    </div>
  </div>`;

  // ── items table ─────────────────────────────────────────────────────────
  const num2 = (v: any): string => (v == null || v === '' || !Number.isFinite(Number(v)) ? '' : Number(v).toFixed(2));
  const rows = items
    .map(
      (item: any) =>
        `<tr style="vertical-align:top;">` +
        `<td style="padding:10px 8px;">${descriptionText(item.description || '')}${
          item.details ? `<div style="padding-left:8px;">${richContent(item.details, 'font-size:13px;color:#666;line-height:1.4;')}</div>` : ''
        }</td>` +
        `<td style="padding:10px 8px;text-align:center;">${num2(item.quantity)}</td>` +
        `<td style="padding:10px 8px;text-align:right;">${num2(item.unitPrice)}</td>` +
        `<td style="padding:10px 8px;text-align:right;">${num2(item.amount)}</td>` +
        `</tr>`,
    )
    .join('');
  const filler =
    items.length < 5
      ? Array.from({ length: 5 - items.length })
          .map(() => `<tr style="height:40px;"><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>`)
          .join('')
      : '';
  const table = `
  <div style="margin-bottom:24px;margin-top:4px;">
    <table>
      <thead><tr>
        <th style="width:55%;text-align:left;">Description</th>
        <th style="width:15%;text-align:center;">Quantity</th>
        <th style="width:15%;text-align:right;">Unit Price</th>
        <th style="width:15%;text-align:right;">Amount SGD</th>
      </tr></thead>
      <tbody>${rows}${filler}</tbody>
    </table>
  </div>`;

  // ── reason ──────────────────────────────────────────────────────────────
  const reason = di('reason') || data?.remarks;
  const reasonBlock = reason
    ? `<div style="margin-bottom:16px;font-size:13px;">
         <p style="font-weight:600;margin-bottom:4px;">Reason:</p>
         <p style="white-space:pre-line;">${escapeHtml(reason)}</p>
       </div>`
    : '';

  // ── bottom block: totals, amount in words, footer ───────────────────────
  const totalsLeft = `
    <div style="display:flex;align-items:center;gap:24px;">
      <div style="display:flex;align-items:center;"><span style="font-size:13px;">(Rate :</span><span style="font-size:13px;margin-left:8px;min-width:60px;">${rate.toFixed(6)}</span></div>
      <div style="display:flex;align-items:center;"><span style="font-size:13px;">Sub-total:</span><span style="font-size:13px;margin-left:8px;min-width:50px;text-align:right;">${displayNet.toFixed(2)}</span></div>
      <div style="display:flex;align-items:center;"><span style="font-size:13px;">GST</span><span style="font-size:13px;margin-left:8px;">:</span><span style="font-size:13px;margin-left:8px;min-width:40px;text-align:right;">${gstAmount.toFixed(2)})</span></div>
    </div>`;

  const discountRows =
    discountPercent > 0
      ? `<div style="display:flex;justify-content:space-between;padding:2.4px 0;font-size:13px;"><span>Discount</span><span style="display:flex;gap:16px;"><span>${discountPercent.toFixed(2)}</span><span style="min-width:50px;text-align:right;">${discountAmount.toFixed(2)}</span></span></div>` +
        `<div style="display:flex;justify-content:space-between;padding:2.4px 0;font-size:13px;"><span>Sub-Total</span><span>${displayNet.toFixed(2)}</span></div>`
      : '';

  const totalsRight = `
    <div style="min-width:200px;">
      <div style="display:flex;justify-content:space-between;padding:2.4px 0;font-size:13px;"><span>Sub-Total</span><span>${displayGross.toFixed(2)}</span></div>
      ${discountRows}
      <div style="display:flex;justify-content:space-between;padding:2.4px 0;font-size:13px;"><span>GST</span><span style="display:flex;gap:16px;"><span>${gstPercent.toFixed(2)} %</span><span style="min-width:50px;text-align:right;">${gstAmount.toFixed(2)}</span></span></div>
      <div style="display:flex;justify-content:space-between;padding:4px 0 2.4px;border-top:1px solid #000;margin-top:4px;font-size:13px;"><span>Total</span><span style="display:flex;gap:16px;"><span>${escapeHtml(currency)}</span><span style="font-weight:600;min-width:50px;text-align:right;">${finalTotal.toFixed(2)}</span></span></div>
      ${isAbsorbTax && gstPercent > 0 ? `<p style="font-size:11px;font-style:italic;text-align:right;margin-top:2.4px;">Amounts shown are tax inclusive</p>` : ''}
    </div>`;

  const totals = `
  <div style="display:flex;justify-content:space-between;border-top:1px solid #000;padding-top:8px;page-break-inside:avoid;break-inside:avoid;">
    ${totalsLeft}${totalsRight}
  </div>`;

  const inWords = `
  <div style="margin-top:16px;border-bottom:2px solid #000;padding-bottom:8px;">
    <p style="font-size:13px;font-weight:500;">${escapeHtml(numberToWords(finalTotal))}</p>
  </div>`;

  // Due date only when the terms carry days (the portal shows the same).
  const termDays = parseInt(String(di('paymentTerms') ?? '').replace(/\D/g, ''), 10) || 0;
  let dueLine = '';
  if (di('date') && termDays > 0) {
    const due = new Date(di('date'));
    due.setDate(due.getDate() + termDays);
    dueLine = `<p style="font-size:13px;font-weight:700;margin-bottom:4px;">Due Date: ${escapeHtml(
      due.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    )}</p>`;
  }

  const bank: any = organization?.bankDetails || null;
  const oneBank = (b: any) =>
    `${b.accountName ? `<p style="font-size:13px;">All Cheque should be crossed and made payable to: ${escapeHtml(b.accountName)}</p>` : ''}
     ${b.bankName ? `<p style="font-size:13px;">By Bank Transfer: ${escapeHtml(b.bankName)}</p>` : ''}
     ${b.branchCode ? `<p style="font-size:13px;">Branch: ${escapeHtml(b.branchCode)}</p>` : ''}
     ${b.bankCode || b.swiftCode ? `<p style="font-size:13px;">Bank Branch No.: ${escapeHtml(b.bankCode || '')}${b.swiftCode ? ` Swift Code: ${escapeHtml(b.swiftCode)}` : ''}</p>` : ''}
     ${b.accountNumber ? `<p style="font-size:13px;">Bank Account No.: ${escapeHtml(b.accountNumber)}</p>` : ''}`;
  const banks = [bank, ...(Array.isArray(bank?.additionalBanks) ? bank.additionalBanks : [])].filter(
    (b: any) => b && (b.accountName || b.accountNumber || b.bankName),
  );
  const bankBlock = banks.length
    ? `<div style="font-size:13px;line-height:1.6;">
         ${banks.map(oneBank).join(`<p style="font-size:13px;font-weight:700;margin:4px 0;">OR</p>`)}
         ${organization?.registrationNumber ? `<p style="font-size:13px;">PayNow to UEN: ${escapeHtml(organization.registrationNumber)}</p>` : ''}
       </div>`
    : `<p style="font-size:13px;">&nbsp;</p>`;

  const footerRow = `
  <div style="margin-top:16px;border-top:2px solid #000;padding-top:12px;">
    ${dueLine}
    <div style="display:flex;justify-content:space-between;gap:16px;">
      <div style="flex:1;max-width:55%;">${bankBlock}</div>
      <div style="text-align:right;">
        <p style="font-size:13px;font-style:italic;">This is a computer generated ${noun}.</p>
        <p style="font-size:13px;font-style:italic;">No signature is required.</p>
      </div>
    </div>`;

  const notesBlock =
    data?.note || data?.termsAndConditions
      ? `<div style="display:flex;gap:24px;margin-top:8px;">
           ${data?.note ? `<div style="flex:1;min-width:0;page-break-inside:avoid;"><p style="font-size:13px;font-weight:600;">Note:</p>${richContent(data.note)}</div>` : ''}
           ${data?.termsAndConditions ? `<div style="flex:1;min-width:0;page-break-inside:avoid;"><p style="font-size:13px;font-weight:600;">Terms &amp; Conditions:</p>${richContent(data.termsAndConditions)}</div>` : ''}
         </div>`
      : '';

  const footerMessage = data?.footerMessage || di('footerMessage');
  const footerMsgBlock = footerMessage
    ? `<div style="margin-top:16px;padding-top:8px;border-top:1px dashed rgba(0,0,0,0.15);page-break-inside:avoid;">
         ${richContent(footerMessage, 'font-size:13px;line-height:1.6;text-align:center;font-style:italic;')}
       </div>`
    : '';

  const footer = footerRow + notesBlock + footerMsgBlock + `</div>`;

  return header + partyRow + table + reasonBlock + `<div style="margin-top:auto;">` + totals + inWords + footer + `</div>`;
}
