/**
 * WCT (S) Systems layout — quotation, tax invoice and delivery order drawn to
 * match the client's paper documents (photographed 2026-10-22: Quotation
 * -014162-R0, Tax Invoice I-015128, Delivery Order DO011982).
 *
 * Chosen by the template's design knob `layout: 'wct'` (Admin → org →
 * Manage Templates → Design → Layout), the same way CIEL's ID quotation is a
 * renderer of its own. Like that one it is the single source for the screen
 * preview (editor iframe, POST /documents/preview-html) and the PDF, so what
 * the office sees is what the customer gets.
 *
 * Page shape, top to bottom:
 *   letterhead (logo beside the company block: name, address, Company Reg /
 *   GST Reg No, Tel, PayNow UEN, Email, Website) with the document number
 *   bold at the right, over a rule — REPEATED ON EVERY PAGE (outer table
 *   thead, which Chromium repeats when printing)
 *   → title → Bill To block (name, address, Attention, Email, Phone) with
 *   Date (and Invoice Rev) at the right → boxed "Job Location:" and
 *   "Subject:" rows → S/No · Description · Qty · Unit Price · Amount with
 *   boxed header cells → totals (Total / GST n% / Total Amount, or on the
 *   invoice Total / GST n% / Amount Paid / Amount Due) → Terms and
 *   Conditions → Sales Person / Contact / Yours Sincerely beside
 *   Confirmation of Order → closing lines.
 *   The delivery order instead has a centred title over an asterisk rule,
 *   DO No / Quotation Number / Date, Sold To + Ship To boxes and a
 *   S/No · DESCRIPTION · QTY · REMARK table.
 *
 * "Page n/N" and the per-page footer line come from Puppeteer's footer
 * (pdfOptionsFor in ./index.ts) — only the print engine knows the page count.
 * On screen the footer line prints once at the end instead.
 */
import { DocumentDesign } from './design';
import { amountPaidOf, outstandingOf } from '../../document-money';
import { billToText, descriptionText, escapeHtml, makeDi, money, richContent } from './shared';

export type WctDocKind = 'quotation' | 'invoice' | 'do';

const CSS = `
<style>
  .wct { font-size: 12.5px; color: #000; line-height: 1.45; }
  .wct p { margin: 0; }
  /* The outer sheet: letterhead in a thead so every printed page carries it. */
  table.wct-sheet { width: 100%; border-collapse: collapse; }
  table.wct-sheet > thead { display: table-header-group; }
  table.wct-sheet > thead > tr > td, table.wct-sheet > tbody > tr > td { padding: 0; border: none; font-size: inherit; vertical-align: top; }
  .wct .lh { display: flex; align-items: flex-start; gap: 18px; }
  .wct .lh img { max-height: 62px; max-width: 200px; object-fit: contain; display: block; }
  .wct .lh .co { font-size: 11.5px; line-height: 1.4; flex: 1; }
  .wct .lh .co .nm { font-size: 14px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; }
  .wct .lh .co .sp { display: inline-block; margin-right: 14px; }
  .wct .docno { text-align: right; font-weight: 700; font-size: 13px; margin-top: -4px; }
  .wct .rule { border-bottom: 1.5px solid #000; margin: 2px 0 10px; }
  .wct .title { text-align: center; font-weight: 700; font-size: 16px; letter-spacing: .5px; margin: 2px 0 10px; }
  .wct .title.do { margin-bottom: 0; }
  .wct .stars { text-align: center; font-size: 10px; letter-spacing: 1px; line-height: 1; margin-bottom: 8px; overflow: hidden; white-space: nowrap; }
  .wct .party { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 8px; }
  .wct .party .bill { flex: 1; min-width: 0; white-space: pre-line; }
  .wct .party .bill b { font-weight: 700; }
  .wct .kv { display: grid; grid-template-columns: auto auto; column-gap: 10px; row-gap: 1px; white-space: nowrap; align-content: start; }
  .wct .kv .k::after { content: ":"; margin-left: 24px; }
  .wct .kv .k { text-align: left; }
  .wct .boxes { border: 1.2px solid #000; margin: 6px 0 12px; }
  .wct .boxes .row { padding: 4px 7px; }
  .wct .boxes .row + .row { border-top: 1.2px solid #000; }
  .wct .boxes b { font-weight: 700; }
  table.wct-lines { width: 100%; border-collapse: separate; border-spacing: 0; }
  table.wct-lines th { border: 1.2px solid #000; padding: 5px 6px; font-weight: 400; font-size: 12.5px; text-align: left; white-space: nowrap; background: #fff; }
  table.wct-lines th + th { border-left: none; }
  table.wct-lines td { border: none; padding: 6px 6px 2px; font-size: 12.5px; vertical-align: top; }
  /* A line item never splits across pages (seen: item 12's second line alone on page 2). */
  table.wct-lines tbody tr { page-break-inside: avoid; break-inside: avoid; }
  table.wct-lines tbody tr:first-child td { padding-top: 10px; }
  table.wct-lines td.no { text-align: center; width: 34px; }
  table.wct-lines td.qty { text-align: center; white-space: nowrap; }
  table.wct-lines td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.wct-lines td.desc p { white-space: pre-wrap; }
  .wct .totals { display: flex; justify-content: flex-end; margin: 14px 0 18px; page-break-inside: avoid; break-inside: avoid; }
  .wct .totals table { border-collapse: collapse; width: auto; }
  .wct .totals td { border: none; padding: 2px 8px; font-size: 12.5px; white-space: nowrap; }
  .wct .totals td.l { font-weight: 700; text-align: right; }
  .wct .totals td.v { text-align: right; font-weight: 700; min-width: 96px; font-variant-numeric: tabular-nums; }
  .wct .tnc { margin: 6px 0 18px; }
  .wct .tnc h3 { font-size: 12.5px; font-weight: 700; margin: 0 0 6px; page-break-after: avoid; break-after: avoid; }
  .wct .tnc p, .wct .tnc div { font-size: 12px; line-height: 1.6; }
  .wct .remarks { margin: 6px 0 14px; }
  .wct .sign { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; margin-top: 36px; page-break-inside: avoid; break-inside: avoid; }
  .wct .sign .l p { margin-bottom: 12px; }
  .wct .sign .r { text-align: right; padding-bottom: 12px; }
  .wct .sign .r .accept { font-size: 11.5px; }
  .wct .sign .r .accept img { display: block; max-height: 48px; max-width: 170px; margin: 6px 0 2px auto; }
  .wct .closing { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; margin-top: 56px; page-break-inside: avoid; break-inside: avoid; }
  .wct .closing .director { font-weight: 700; }
  .wct .footnote { margin-top: 10px; font-weight: 700; }
  .wct .doboxes { display: flex; gap: 40px; margin: 14px 0 16px; }
  .wct .doboxes .bx { flex: 1; border: 1.2px solid #000; padding: 5px 8px 12px; min-height: 86px; white-space: pre-line; }
  @media print { .wct .screen-only { display: none; } }
</style>`;

/** dd/mm/yyyy — the client's paper prints dates this way. */
const paperDate = (v: any): string => {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

/** "$1,850.00" for SGD (the paper's symbol); "USD 1,850.00" otherwise. */
const cash = (n: any, currency: string): string => (currency === 'SGD' || !currency ? `$${money(n)}` : `${currency} ${money(n)}`);

const qtyText = (q: any): string => {
  if (q === null || q === undefined || q === '') return '';
  const n = Number(q);
  if (!isFinite(n)) return escapeHtml(q);
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

const first = (...vals: any[]): string => {
  for (const v of vals) {
    const s = v === null || v === undefined ? '' : String(v).trim();
    if (s) return s;
  }
  return '';
};

function letterhead(org: any, data: any, numberLabel: string, docNumber: string): string {
  const company = data?.company || {};
  const name = first(org?.name, company.name);
  const address = first(org?.address, company.address);
  const reg = first(org?.registrationNumber, company.gstRegNo, company.coRegNo);
  const tel = first(org?.phoneNumber, company.phoneNumber);
  const email = first(org?.email, company.email);
  const website = first(org?.website, company.website);
  const bank = (org?.bankDetails && typeof org.bankDetails === 'object' ? org.bankDetails : {}) as any;
  const paynow = first(bank.paynowUen);
  const logoUrl = data?.logoUrl;
  const lines = [
    address ? escapeHtml(address) : '',
    reg ? `<span class="sp">Company Reg: ${escapeHtml(reg)}</span><span class="sp">GST Reg No: ${escapeHtml(reg)}</span>` : '',
    tel ? `Tel: ${escapeHtml(tel)}` : '',
    paynow ? `PayNow UEN: ${escapeHtml(paynow)}` : '',
    email ? `Email: ${escapeHtml(email)}` : '',
    website ? `Website: ${escapeHtml(website)}` : '',
  ].filter(Boolean);
  return `
  <div class="lh">
    ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="" />` : ''}
    <div class="co"><div class="nm">${escapeHtml(name)}</div>${lines.map((l) => `<div>${l}</div>`).join('')}</div>
  </div>
  <div class="docno">${escapeHtml(numberLabel)}: ${escapeHtml(docNumber)}</div>
  <div class="rule"></div>`;
}

/** Totals maths — the same formulas as the standard invoice renderer. */
function totalsOf(di: (k: string, d?: any) => any, items: any[]) {
  const subtotal = items.reduce((s: number, it: any) => s + (Number(it.amount) || 0), 0);
  const currency = String(di('currency', 'SGD') || 'SGD').toUpperCase();
  const taxApplicable = di('taxApplicable');
  const isTaxApplicable = taxApplicable !== 'N' && taxApplicable !== false;
  const gstPercent = isTaxApplicable ? Number(di('gstPercent')) || 9 : 0;
  const isAbsorbTax = di('absorbTax') === 'Y' || di('absorbTax') === true;
  const discountPercent = Number(di('discountPercent') ?? di('discount')) || 0;
  const discountAmount =
    di('discountAmount') != null && di('discountAmount') !== '' ? Number(di('discountAmount')) || 0 : subtotal * (discountPercent / 100);
  const net = subtotal - discountAmount;
  const gstAmount = isAbsorbTax && gstPercent > 0 ? (net * gstPercent) / (100 + gstPercent) : net * (gstPercent / 100);
  const total = isAbsorbTax ? net : net + gstAmount;
  const displayNet = isAbsorbTax ? net - gstAmount : net;
  return { currency, gstPercent, gstAmount, discountAmount, displayNet, total };
}

function linesTable(data: any, items: any[], kind: WctDocKind, currency: string): string {
  const defaults = kind === 'do' ? ['no', 'description', 'quantity', 'remarks'] : ['no', 'description', 'quantity', 'unitPrice', 'amount'];
  const labelsDefault: Record<string, string> =
    kind === 'do'
      ? { no: 'S/No', description: 'DESCRIPTION', quantity: 'QTY', remarks: 'REMARK' }
      : { no: 'S/No', description: 'Description', quantity: 'Qty', unitPrice: 'Unit Price', amount: 'Amount' };
  const internal: string[] = Array.isArray(data?.internalColumns) ? data.internalColumns : ['discountPrice', 'costPrice'];
  const order: string[] = Array.isArray(data?.tableColumnOrder) && data.tableColumnOrder.length ? data.tableColumnOrder : defaults;
  const columns = order.filter((c) => !internal.includes(c));
  const labels: Record<string, string> = { ...labelsDefault, ...(data?.columnLabels || {}) };
  const cls = (c: string) => (c === 'no' ? 'no' : c === 'quantity' ? 'qty' : ['unitPrice', 'amount', 'salePrice', 'listPrice'].includes(c) ? 'num' : c === 'description' ? 'desc' : '');
  const headStyle = (c: string) =>
    c === 'quantity' ? 'text-align:center;' : ['unitPrice', 'amount', 'salePrice', 'listPrice'].includes(c) ? 'text-align:center;' : c === 'remarks' ? 'text-align:center;' : '';
  const widths: Record<string, string> = { no: '42px', quantity: kind === 'do' ? '110px' : '64px', unitPrice: '96px', amount: '110px', remarks: '170px' };
  const value = (c: string, it: any, i: number): string => {
    switch (c) {
      case 'no':
        return String(i + 1);
      case 'description':
        return descriptionText(it.description || it.name || '');
      case 'quantity':
        return qtyText(it.quantity);
      case 'unitPrice':
        return it.unitPrice == null || it.unitPrice === '' ? '' : cash(it.unitPrice, currency);
      case 'salePrice':
        return it.salePrice == null || it.salePrice === '' ? '' : cash(it.salePrice, currency);
      case 'amount':
        return it.amount == null || it.amount === '' ? '' : cash(it.amount, currency);
      case 'uom':
        return escapeHtml(it.uom || '');
      case 'remarks':
        return escapeHtml(it.remarks ?? it.remark ?? '');
      default:
        return escapeHtml(it[c] ?? '');
    }
  };
  // Header cells are each boxed in one continuous row. (The paper leaves a
  // sliver between the Description and Qty boxes; a spacer cell reproducing
  // it rendered as a broken border, so it is gone — guru 2026-10-27.)
  const head = columns
    .map((c) => `<th style="${headStyle(c)}${widths[c] ? `width:${widths[c]};` : ''}">${escapeHtml(labels[c] || c)}</th>`)
    .join('');
  const rows = items
    .map((it, i) => {
      if (it.isGroupHeader) {
        return `<tr><td colspan="${columns.length}" style="font-weight:700;text-decoration:underline;">${escapeHtml(it.description || '')}</td></tr>`;
      }
      return `<tr>${columns.map((c) => `<td class="${cls(c)}">${value(c, it, i)}</td>`).join('')}</tr>`;
    })
    .join('');
  return `<table class="wct-lines"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function billToBlock(data: any, di: (k: string, d?: any) => any): string {
  const customer = data?.customer || {};
  const name = first(customer.name, data?.customerName);
  const address = billToText(first(data?.billTo, customer.address, data?.customerAddress), name);
  // The editor's Attention trio stores the person in attention.name /
  // documentInfo.contactName, the phone in contactNumber, and the email in
  // attention.email — read all three so the printout matches what was typed.
  const attention = first(di('contactName'), data?.attention?.name, di('contact'), customer.contactPerson);
  const email = first(di('contactEmail'), data?.attention?.email, customer.email);
  const phone = first(di('contactNumber'), data?.attention?.phoneNumber, customer.phoneNumber, customer.mobile, customer.phone);
  return `<div class="bill"><b>Bill To: ${escapeHtml(name)}</b>${address ? `\n${escapeHtml(address)}` : ''}${attention ? `\nAttention: ${escapeHtml(attention)}` : ''}${
    email || phone ? `\n${email ? `Email: ${escapeHtml(email)}` : ''}${email && phone ? '    ' : ''}${phone ? `Phone: ${escapeHtml(phone)}` : ''}` : ''
  }</div>`;
}

function jobBoxes(di: (k: string, d?: any) => any): string {
  const location = first(di('location'), di('jobLocation'), di('siteAddress'));
  const subject = first(di('subject'), di('title'));
  if (!location && !subject) return '';
  return `<div class="boxes">${location ? `<div class="row"><b>Job Location:</b> ${escapeHtml(location)}</div>` : ''}${
    subject ? `<div class="row"><b>Subject:</b> ${escapeHtml(subject)}</div>` : ''
  }</div>`;
}

function signBlock(di: (k: string, d?: any) => any, cfg?: any): string {
  const sales = first(di('salesPersonName'), typeof di('salesPerson') === 'string' ? di('salesPerson') : di('salesPerson')?.name);
  const contact = first(di('salesContact'), di('salesPersonContact'));
  // E-signed quotation (public /sign link): the client's drawn signature
  // prints under "Confirmation of Order". The data URL is re-validated here
  // so only the shape public-sign stores can reach the src attribute.
  const sig: any = cfg?.clientSignature;
  const sigImg = typeof sig?.image === 'string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(sig.image) ? sig.image : '';
  const accepted = sigImg
    ? `<div class="accept"><img src="${sigImg}" alt="" /><div>Accepted by ${escapeHtml(sig.name || '')}${sig.signedAt ? ` on ${escapeHtml(paperDate(sig.signedAt))}` : ''}</div></div>`
    : '';
  return `
  <div class="sign">
    <div class="l">
      <p>Sales Person: ${escapeHtml(sales)}</p>
      <p>Contact: ${escapeHtml(contact)}</p>
      <p style="margin-bottom:0;">Yours Sincerely</p>
    </div>
    <div class="r">Confirmation of Order${accepted}</div>
  </div>`;
}

export function renderWctBody(kind: WctDocKind, data: any, organization: any, design: DocumentDesign): string {
  const di = makeDi(data);
  const org = organization || data?.organization || {};
  const items: any[] = (Array.isArray(data?.items) ? data.items : []).filter((it: any) => it && !it.isTagGroup);
  const docNumber = first(di('documentNumber'), data?.name);
  const footerMessage = first(di('footerMessage'), data?.footerMessage);

  // ── delivery order ──────────────────────────────────────────────────────
  if (kind === 'do') {
    const customer = data?.customer || {};
    const soldName = first(customer.name, data?.customerName);
    const soldAddr = billToText(first(data?.billTo, customer.address, data?.customerAddress), soldName);
    const attention = first(di('contact'), di('contactName'), data?.attention?.name, data?.deliveryAddress?.attention);
    const mobile = first(di('contactNumber'), customer.mobile, customer.phoneNumber);
    const da = data?.deliveryAddress || {};
    const shipLines = first(
      data?.deliveryTo,
      [da.line1, da.line2, [da.city, da.postalCode].filter(Boolean).join(' '), da.country].filter((x: any) => String(x || '').trim()).join('\n'),
    );
    const shipTo = shipLines || soldAddr;
    const quotationNo = first(di('quotationNo'), di('quotationNumber'), di('referenceNo'), data?.sourceDocumentNumber);
    const body = `
    <div class="title do">${escapeHtml(design.titleText || 'DELIVERY ORDER')}</div>
    <div class="stars">${'*'.repeat(46)}</div>
    <div style="display:flex;justify-content:center;margin-bottom:4px;">
      <div class="kv" style="column-gap:28px;">
        <span>Delivery Order No</span><span>${escapeHtml(docNumber)}</span>
        <span>Quotation Number</span><span>${escapeHtml(quotationNo)}</span>
        <span>Date</span><span>${escapeHtml(paperDate(di('date')))}</span>
      </div>
    </div>
    <div class="doboxes">
      <div class="bx">Sold To:\n${escapeHtml(soldName)}${soldAddr ? `\n${escapeHtml(soldAddr)}` : ''}${attention || mobile ? '\n' : ''}${attention ? `\nAttention: ${escapeHtml(attention)}` : ''}${mobile ? `\nMobile: ${escapeHtml(mobile)}` : ''}</div>
      <div class="bx">Ship To:\n${escapeHtml(soldName)}${shipTo ? `\n${escapeHtml(shipTo)}` : ''}</div>
    </div>
    ${linesTable(data, items, 'do', 'SGD')}
    ${data?.remarks || di('remarks') ? `<div class="remarks" style="margin-top:16px;"><b>Remarks:</b>${richContent(first(data?.remarks, di('remarks')), 'font-size:12.5px;line-height:1.5;')}</div>` : ''}
    ${footerMessage ? `<div class="footnote screen-only">${escapeHtml(footerMessage)}</div>` : ''}`;
    return sheet(letterhead(org, data, 'Delivery Order No', docNumber), body);
  }

  // ── quotation / tax invoice ─────────────────────────────────────────────
  const isInvoice = kind === 'invoice';
  const t = totalsOf(di, items);
  const cfg = data?.config && typeof data.config === 'object' ? data.config : data;
  const paid = amountPaidOf(cfg) ?? 0;
  const outstanding = outstandingOf(cfg);
  const due = outstanding !== null ? Math.max(0, outstanding) : Math.max(0, Math.round((t.total - paid) * 100) / 100);
  const revision = first(di('revision'), di('invoiceRev'));
  const showTotals = ((data?.showTotals ?? data?.documentInfo?.showTotals) ?? true) !== false;

  const header = `
  <div class="title">${escapeHtml(design.titleText || (isInvoice ? 'TAX INVOICE' : 'QUOTATION'))}</div>
  <div class="party">
    ${billToBlock(data, di)}
    <div class="kv">
      <span class="k">Date</span><span>${escapeHtml(paperDate(di('date')))}</span>
      ${isInvoice && revision ? `<span class="k">Invoice Rev</span><span>${escapeHtml(revision)}</span>` : ''}
      ${!isInvoice && di('validityPeriod') ? `<span class="k">Validity</span><span>${escapeHtml(di('validityPeriod'))}</span>` : ''}
      ${di('paymentTerms') && isInvoice ? `<span class="k">Terms</span><span>${escapeHtml(di('paymentTerms'))}</span>` : ''}
    </div>
  </div>
  ${jobBoxes(di)}`;

  const gstRow = t.gstPercent > 0 ? `<tr><td class="l">GST ${escapeHtml(String(t.gstPercent))}%:</td><td class="v">${cash(t.gstAmount, t.currency)}</td></tr>` : '';
  const discountRow = t.discountAmount > 0 ? `<tr><td class="l">Discount:</td><td class="v">(${cash(t.discountAmount, t.currency)})</td></tr>` : '';
  const totals = !showTotals
    ? ''
    : `<div class="totals"><table>
    <tr><td class="l">Total:</td><td class="v">${cash(t.displayNet + t.discountAmount, t.currency)}</td></tr>
    ${discountRow}${gstRow}
    ${
      isInvoice
        ? `<tr><td class="l">Amount Paid:</td><td class="v">${cash(paid, t.currency)}</td></tr><tr><td class="l">Amount Due:</td><td class="v">${cash(due, t.currency)}</td></tr>`
        : `<tr><td class="l">Total Amount:</td><td class="v">${cash(t.total, t.currency)}</td></tr>`
    }
  </table></div>`;

  const remarks = first(data?.remarks, di('remarks'), data?.note);
  const remarksBlock = remarks ? `<div class="remarks"><b>Remarks:</b>${richContent(remarks, 'font-size:12.5px;line-height:1.5;')}</div>` : '';
  const tnc = first(data?.termsAndConditions, di('termsAndConditions'));
  const tncBlock = tnc ? `<div class="tnc"><h3>Terms and Conditions:</h3>${richContent(tnc, 'font-size:12px;line-height:1.6;')}</div>` : '';

  const closing = isInvoice
    ? footerMessage
      ? `<div class="footnote screen-only">${escapeHtml(footerMessage)}</div>`
      : ''
    : `<div class="closing">
        <div><div class="director">Director of ${escapeHtml(first(org?.name, data?.company?.name))}</div>${
          footerMessage ? `<div class="screen-only">${escapeHtml(footerMessage)}</div>` : ''
        }</div>
        <div>Company Stamp &amp; Authorized Signature</div>
      </div>`;

  const body = `${header}${linesTable(data, items, kind, t.currency)}${totals}${remarksBlock}${tncBlock}${signBlock(di, cfg)}${closing}`;
  return sheet(letterhead(org, data, isInvoice ? 'Invoice No' : 'Quotation No', docNumber), body);
}

function sheet(head: string, body: string): string {
  return `${CSS}<div class="wct"><table class="wct-sheet"><thead><tr><td>${head}</td></tr></thead><tbody><tr><td>${body}</td></tr></tbody></table></div>`;
}

/** Footer line for the PDF's per-page footer (left of "Page n/N"). */
export function wctFooterLine(data: any): string {
  const di = makeDi(data);
  return first(di('footerMessage'), data?.footerMessage);
}
