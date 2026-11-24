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
import { resolveTimeZone } from '../../org-today';
import { DocumentDesign } from './design';
import { amountPaidOf, outstandingOf } from '../../document-money';
import { billToText, decodeHtmlEntities as decodeEntities, escapeHtml, makeDi, money, printableSalesman, richContent } from './shared';
import { erpStoredTotalsOf, moneySignature, type ErpStoredTotals } from '../../erp-import';
import { BCAIR_DOC } from './wct-brand';
import { withSingapore } from '../../sg-address';

export type WctDocKind = 'quotation' | 'invoice' | 'do';

/** Line-item description: the shared cell is 13px (other layouts); the WCT print is 2px smaller (2026-11-23). */
const descriptionText = (text: any): string => richContent(text, 'font-size:11px;line-height:1.6;');

const CSS = `
<style>
  .wct { font-size: 10.5px; color: #000; line-height: 1.45; }
  .wct p { margin: 0; }
  /* The outer sheet: letterhead in a thead so every printed page carries it. */
  table.wct-sheet { width: 100%; border-collapse: collapse; }
  table.wct-sheet > thead { display: table-header-group; }
  table.wct-sheet > thead > tr > td, table.wct-sheet > tbody > tr > td { padding: 0; border: none; font-size: inherit; vertical-align: top; }
  /* Page-margin spacers (2026-11-23): a top row in the repeating thead and a bottom row in the repeating tfoot.
     0 high on screen and in the server PDF (Puppeteer gives that its margins); the portal's browser print
     (ServerDocumentPreview) prints with @page margin 0, so Chrome has no room for its own header/footer, and
     sets these rows to ~12mm so every printed page keeps its top and bottom margin. */
  table.wct-sheet > thead > tr.wct-pgtop > td, table.wct-sheet > tfoot > tr.wct-pgbot > td { height: 0; padding: 0; border: none; line-height: 0; font-size: 0; }
  table.wct-sheet > tfoot { display: table-footer-group; }
  .wct .lh { display: flex; align-items: flex-start; gap: 18px; }
  .wct .lh img { max-height: 62px; max-width: 200px; object-fit: contain; display: block; }
  .wct .lh .co { font-size: 9.5px; line-height: 1.4; flex: 1; }
  .wct .lh .co .nm { font-size: 12px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; }
  .wct .lh .co .sp { display: inline-block; margin-right: 14px; }
  .wct .docno { text-align: right; font-weight: 700; font-size: 11px; margin-top: -4px; }
  .wct .rule { border-bottom: 1.5px solid #000; margin: 2px 0 10px; }
  .wct .title { text-align: center; font-weight: 700; font-size: 14px; letter-spacing: .5px; margin: 2px 0 10px; }
  .wct .title.do { margin-bottom: 0; }
  .wct .stars { text-align: center; font-size: 8px; letter-spacing: 1px; line-height: 1; margin-bottom: 8px; overflow: hidden; white-space: nowrap; }
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
  table.wct-lines th { border: 1.2px solid #000; padding: 5px 6px; font-weight: 400; font-size: 10.5px; text-align: left; white-space: nowrap; background: #fff; }
  table.wct-lines th + th { border-left: none; }
  table.wct-lines td { border: none; padding: 6px 6px 2px; font-size: 10.5px; vertical-align: top; }
  /* A line item never splits across pages (seen: item 12's second line alone on page 2). */
  table.wct-lines tbody tr { page-break-inside: avoid; break-inside: avoid; }
  table.wct-lines tbody tr:first-child td { padding-top: 10px; }
  table.wct-lines td.no { text-align: center; width: 34px; }
  table.wct-lines td.qty { text-align: center; white-space: nowrap; }
  table.wct-lines td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.wct-lines td.desc p { white-space: pre-wrap; }
  .wct .totals { display: flex; justify-content: flex-end; margin: 14px 0 18px; page-break-inside: avoid; break-inside: avoid; }
  .wct .totals table { border-collapse: collapse; width: auto; }
  .wct .totals td { border: none; padding: 2px 8px; font-size: 10.5px; white-space: nowrap; }
  .wct .totals td.l { font-weight: 700; text-align: right; }
  .wct .totals td.v { text-align: right; font-weight: 700; min-width: 96px; font-variant-numeric: tabular-nums; }
  .wct .tnc { margin: 6px 0 18px; }
  .wct .tnc h3 { font-size: 10.5px; font-weight: 700; margin: 0 0 6px; page-break-after: avoid; break-after: avoid; }
  .wct .tnc p, .wct .tnc div { font-size: 10px; line-height: 1.6; }
  .wct .remarks { margin: 6px 0 14px; }
  .wct .sign { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; margin-top: 36px; page-break-inside: avoid; break-inside: avoid; }
  .wct .sign .l p { margin-bottom: 12px; }
  .wct .sign .r { text-align: right; padding-bottom: 12px; }
  /* Delivery order: the customer's sign-off under the lines (field app /
     guest link), then the condition photos on a page of their own. */
  .wct .rcv { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; margin-top: 28px; page-break-inside: avoid; break-inside: avoid; }
  .wct .rcv .box { min-width: 230px; }
  .wct .rcv .box .lbl { font-weight: 700; margin-bottom: 4px; }
  .wct .rcv .box .sig { height: 56px; display: flex; align-items: flex-end; margin: 2px 0 4px; }
  .wct .rcv .box .sig img { display: block; max-height: 56px; max-width: 200px; }
  .wct .rcv .box .ln { border-top: 1px solid #000; padding-top: 3px; font-size: 9.5px; }
  .wct .proof { page-break-before: always; break-before: page; }
  .wct .proof h3 { text-align: center; font-size: 12px; font-weight: 700; letter-spacing: 1px; margin: 4px 0 12px; }
  .wct .proof .rep { margin-bottom: 14px; page-break-inside: avoid; break-inside: avoid; }
  .wct .proof .rep + .rep { border-top: 1px solid #ccc; padding-top: 12px; }
  .wct .proof .rep .hd { display: flex; gap: 14px; align-items: baseline; flex-wrap: wrap; margin-bottom: 6px; font-size: 9.5px; color: #333; }
  .wct .proof .rep .hd b { font-size: 10.5px; color: #000; }
  .wct .proof .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .wct .proof .grid .ph { width: 100%; aspect-ratio: 4 / 3; overflow: hidden; border: 1px solid #ccc; }
  .wct .proof .grid .ph img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .wct .closing { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; margin-top: 56px; page-break-inside: avoid; break-inside: avoid; }
  .wct .closing .director { font-weight: 700; }
  /* E-signed quotation: the client's signature sits in the blank space between "Confirmation of Order" and
     "Company Stamp & Authorized Signature" (absolutely placed, so the left column and the label do not move),
     the signer and date in small type under the label (the only added height, ~16px). Unsigned quotations keep
     the plain layout. */
  .wct .closing.signed { padding-bottom: 16px; }
  /* The signature line above the label (2026-11-13), signed or not. */
  .wct .closing .stamp { position: relative; border-top: 1px solid #000; padding-top: 4px; min-width: 230px; text-align: center; }
  .wct .closing .stamp .sigimg { position: absolute; right: 0; bottom: 100%; display: block; max-width: 180px; max-height: 68px; }
  .wct .closing .stamp .who { position: absolute; right: 0; top: 100%; white-space: nowrap; font-size: 8.5px; color: #333; }
  .wct .footnote { margin-top: 10px; font-weight: 700; }
  .wct .doboxes { display: flex; gap: 40px; margin: 14px 0 16px; }
  .wct .doboxes .bx { flex: 1; border: 1.2px solid #000; padding: 5px 8px 12px; min-height: 86px; white-space: pre-line; }
  /* Company stamp (2026-11-24): "Add company stamp" on the document; bottom-left after the closing. */
  .wct .cstamp { margin-top: 18px; text-align: left; page-break-inside: avoid; break-inside: avoid; }
  .wct .cstamp img { display: block; max-width: 150px; max-height: 110px; object-fit: contain; }
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

/** dd/mm/yyyy in a time zone (the paper's date for an instant). */
const paperDateIn = (v: any, timeZone: string): string => {
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return new Intl.DateTimeFormat('en-GB', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
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

/** BC Air (features.wctDocumentBrand = 'BCAIR', invoice + DO): its letterhead lines as printed on I003278. */
const BC_CSS = `
<style>
  .wct.bc .lh .co .nm { text-transform: none; letter-spacing: 0; font-size: 16px; }
  .wct.bc .lh .co { font-size: 10.5px; }
  .wct.bc .lh img { max-height: 80px; }
  .wct.bc .tnc .ln { font-size: 10px; line-height: 1.5; font-weight: 700; margin-bottom: 4px; }
  /* I003278 prints its terms from the top of page 2. */
  .wct.bc .tnc { page-break-before: always; break-before: page; margin-top: 0; }
  .wct.bc .totals table { border-collapse: collapse; }
  .wct.bc .totals td { border: 1px solid #000; padding: 3px 8px; }
  .wct.bc .totals tr.due td { background: #ddeef5; }
  .wct.bc .bcsign { display: flex; justify-content: space-between; gap: 24px; margin-top: 40px; font-weight: 700; page-break-inside: avoid; break-inside: avoid; }
  .wct.bc .bcsign .scr { font-family: "Brush Script MT", "Segoe Script", cursive; font-size: 28px; font-weight: 400; margin: 6px 0 4px; }
  .wct.bc .bcsign .r { display: flex; flex-direction: column; justify-content: space-between; text-align: right; }
</style>`;

/**
 * WCT Racking (features.enableRackingLayout -> design.racking, 2026-11-18). Its quotation on the WCT
 * layout: a UOM column, section titles without an S/No, Total Amount / Goodwill Discount / Final Amount,
 * the footer text with its headings in capitals (no "Remarks" heading), and the closing "Yours Sincerely,"
 * + the signer in a script font + "<title> of" + the company in orange. The letterhead of every Racking
 * document drops "GST Reg No" (Racking is not GST registered). Other orgs never get design.racking.
 */
const RK_CSS = `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Great+Vibes&display=swap');
  .wct.rk .rkfoot { margin: 6px 0 18px; font-size: 10px; line-height: 1.6; }
  .wct.rk .rkfoot .hd { font-weight: 700; margin-top: 10px; page-break-after: avoid; break-after: avoid; }
  .wct.rk .rkfoot .hd:first-child { margin-top: 0; }
  /* The quotation's payment terms always start a new page (guru 2026-11-19). */
  .wct.rk .rkfoot .pb { page-break-before: always; break-before: page; margin-top: 0; }
  .wct.rk .rkfoot .ln { white-space: pre-wrap; word-break: break-word; }
  .wct.rk .rkfoot .gap { height: 6px; }
  .wct.rk .rkfoot .gap + .hd { margin-top: 4px; }
  .wct.rk .rkfoot .bl { display: flex; gap: 6px; }
  .wct.rk .rkfoot .bl > span:first-child { flex: 0 0 10px; }
  .wct.rk .rkfoot .bl > span:last-child { flex: 1; min-width: 0; white-space: pre-wrap; word-break: break-word; }
  .wct.rk .rksig { line-height: 1.5; }
  /* The round Racking mark: taller than the wide WCT one so it reads at the same weight. */
  .wct.rk .lh img { max-height: 86px; max-width: 120px; }
  /* Watermark: fixed, so Chromium prints it centred on every page, behind the content (z-index -1, the
     body's white is the canvas). */
  .rkwm { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 150mm; z-index: -1; pointer-events: none; }
  .rkwm img { width: 100%; display: block; opacity: 0.11; }
  .wct.rk .rksig .scr { font-family: 'Great Vibes', 'Brush Script MT', 'Segoe Script', cursive; font-size: 30px; line-height: 1.2; margin: 4px 0 2px; }
  .wct.rk .rksig .co { color: ${'#E8731A'}; font-weight: 700; }
</style>`;

/** A footer heading as the Racking paper prints it (capitals, colon), or null when the line is not one. */
const RK_HEADING = /^\s*(payment\s+terms|payment\s+method|terms\s*(?:&|and)\s*conditions)\s*:?\s*$/i;
const rkHeadingOf = (line: string): string | null => {
  const m = RK_HEADING.exec(line);
  if (!m) return null;
  return `${m[1].replace(/\s+/g, ' ').toUpperCase().replace(/\s*(?:&|\bAND\b)\s*/, ' & ')}:`;
};

/**
 * The Racking footer text: plain text line by line (headings bold in capitals, "•" / "-" bullets with a
 * hanging indent); HTML from the rich editor keeps its markup with the heading words in capitals.
 */
function rackingFooterText(text: string): string {
  const raw = String(text ?? '');
  if (!raw.trim()) return '';
  if (/<[a-z][\s\S]*>/i.test(raw)) {
    return `<div class="ln">${raw.replace(/(payment\s+terms|payment\s+method|terms\s*(?:&amp;|&|and)\s*conditions)\s*:/gi, (_m, w) => `${String(w).replace(/\s+/g, ' ').toUpperCase().replace(/\s*(?:&AMP;|&|\bAND\b)\s*/, ' &amp; ')}:`)}</div>`;
  }
  const lines = decodeEntities(raw).split(/\r?\n/);
  return lines
    .map((l) => {
      const h = rkHeadingOf(l);
      if (h) return `<div class="hd">${escapeHtml(h)}</div>`;
      const b = /^\s*(•|-)\s?(.*)$/.exec(l);
      if (b) return `<div class="bl"><span>${b[1] === '•' ? '•' : '-'}</span><span>${escapeHtml(b[2])}</span></div>`;
      return l.trim() ? `<div class="ln">${escapeHtml(l)}</div>` : '<div class="gap"></div>';
    })
    .join('');
}

/** True when the footer text already carries a TERMS & CONDITIONS heading line. */
const hasTermsHeading = (text: string): boolean =>
  /(^|\n|>)\s*(?:<b>\s*)?terms\s*(?:&amp;|&|and)\s*conditions\s*:?/i.test(String(text ?? ''));

function bcLetterhead(data: any, numberLabel: string, docNumber: string): string {
  const logoUrl = data?.logoUrl;
  const line = (parts: Array<{ label?: string; text: string; mail?: boolean }>) =>
    parts.map((p) => `${p.label ? `<b>${escapeHtml(p.label)}</b> ` : ''}${escapeHtml(p.text)}`).join(' ');
  return `
  <div class="lh">
    ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="" />` : ''}
    <div class="co"><div class="nm">${escapeHtml(BCAIR_DOC.name)}</div>${BCAIR_DOC.lines.map((l) => `<div>${line(l)}</div>`).join('')}</div>
  </div>
  <div class="rule"></div>
  <div class="docno">${escapeHtml(numberLabel)} : ${escapeHtml(docNumber)}</div>`;
}

function letterhead(org: any, data: any, numberLabel: string, docNumber: string, racking = false): string {
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
    reg ? `<span class="sp">Company Reg: ${escapeHtml(reg)}</span>${racking ? '' : `<span class="sp">GST Reg No: ${escapeHtml(reg)}</span>`}` : '',
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

/** An imported document's stored totals, when its lines' money still matches them. */
function erpTotalsOf(data: any, cfg: any, di: (k: string, d?: any) => any, items: any[]) {
  const s: ErpStoredTotals | null = data?.erpStoredTotals ?? erpStoredTotalsOf(cfg);
  if (!s || s.sig !== moneySignature(items)) return null;
  const currency = String(di('currency', 'SGD') || 'SGD').toUpperCase();
  return {
    currency,
    gstPercent: s.gstPercent,
    gstAmount: s.gstAmount,
    discountAmount: s.discountAmount,
    displayNet: s.subTotal,
    total: s.nettTotal,
    paid: s.paid ?? amountPaidOf(cfg),
    outstanding: s.outstanding !== undefined ? s.outstanding : outstandingOf(cfg),
  };
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

function linesTable(data: any, items: any[], kind: WctDocKind, currency: string, racking = false, skipTitles = false): string {
  const defaults = kind === 'do' ? ['no', 'description', 'quantity', 'remarks'] : ['no', 'description', 'quantity', 'unitPrice', 'amount'];
  const labelsDefault: Record<string, string> =
    kind === 'do'
      ? { no: 'S/No', description: 'DESCRIPTION', quantity: 'QTY', remarks: 'REMARK' }
      : { no: 'S/No', description: 'Description', quantity: 'Qty', unitPrice: 'Unit Price', amount: 'Amount' };
  const internal: string[] = Array.isArray(data?.internalColumns) ? data.internalColumns : ['discountPrice', 'costPrice'];
  const order: string[] = Array.isArray(data?.tableColumnOrder) && data.tableColumnOrder.length ? data.tableColumnOrder : defaults;
  let columns = order.filter((c) => !internal.includes(c));
  // Racking quotation: a UOM column right after Qty (free text, blank prints blank).
  const rkQuote = racking && kind === 'quotation';
  if (rkQuote && !columns.includes('uom')) {
    const q = columns.indexOf('quantity');
    columns = q >= 0 ? [...columns.slice(0, q + 1), 'uom', ...columns.slice(q + 1)] : columns;
  }
  const labels: Record<string, string> = { ...labelsDefault, ...(rkQuote ? { uom: 'UOM' } : {}), ...(data?.columnLabels || {}) };
  const cls = (c: string) => (c === 'no' ? 'no' : c === 'quantity' || (rkQuote && c === 'uom') ? 'qty' : ['unitPrice', 'amount', 'salePrice', 'listPrice'].includes(c) ? 'num' : c === 'description' ? 'desc' : '');
  const headStyle = (c: string) =>
    c === 'quantity' || (rkQuote && c === 'uom') ? 'text-align:center;' : ['unitPrice', 'amount', 'salePrice', 'listPrice'].includes(c) ? 'text-align:center;' : c === 'remarks' ? 'text-align:center;' : '';
  const widths: Record<string, string> = { no: '42px', quantity: kind === 'do' ? '110px' : '64px', unitPrice: '96px', amount: '110px', remarks: '170px', ...(rkQuote ? { uom: '64px' } : {}) };
  // S/No: Racking quotation section titles take none (the first item is 1); everyone else counts every row.
  const serial: number[] = [];
  let n = 0;
  // …and so do the section titles of any WCT-layout document made after the org's snoSkipTitlesSince (design.snoSkipTitles).
  const noTitleNumbers = rkQuote || skipTitles;
  for (const it of items) serial.push(noTitleNumbers ? (it.isGroupHeader ? 0 : ++n) : ++n);
  const value = (c: string, it: any, i: number): string => {
    switch (c) {
      case 'no':
        return String(serial[i]);
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
  const address = withSingapore(billToText(first(data?.billTo, customer.address, data?.customerAddress), name));
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
  const location = withSingapore(first(di('location'), di('jobLocation'), di('siteAddress')));
  const subject = first(di('subject'), di('title'));
  if (!location && !subject) return '';
  return `<div class="boxes">${location ? `<div class="row"><b>Job Location:</b> ${escapeHtml(location)}</div>` : ''}${
    subject ? `<div class="row"><b>Subject:</b> ${escapeHtml(subject)}</div>` : ''
  }</div>`;
}

/** The salesperson's printed name (the editor stores the name beside the code / user id). */
const salesNameOf = (di: (k: string, d?: any) => any): string =>
  first(di('salesPersonName'), typeof di('salesPerson') === 'string' ? printableSalesman(di('salesPerson')) : di('salesPerson')?.name);

function signBlock(di: (k: string, d?: any) => any, racking = false): string {
  // A salesperson saved as a bare user id prints its name, else blank, never the id (salesNameOf).
  const sales = salesNameOf(di);
  const contact = first(di('salesContact'), di('salesPersonContact'));
  // Racking: "Yours Sincerely," opens its own closing block (rackingClosing).
  if (racking) {
    return `
  <div class="sign">
    <div class="l">
      <p>Sales Person: ${escapeHtml(sales)}</p>
      <p style="margin-bottom:0;">Contact: ${escapeHtml(contact)}</p>
    </div>
    <div class="r">Confirmation of Order</div>
  </div>`;
  }
  // The e-signature (public /sign link) prints in the closing block, see clientSignatureOf / closing.
  return `
  <div class="sign">
    <div class="l">
      <p>Sales Person: ${escapeHtml(sales)}</p>
      <p>Contact: ${escapeHtml(contact)}</p>
      <p style="margin-bottom:0;">Yours Sincerely</p>
    </div>
    <div class="r">Confirmation of Order</div>
  </div>`;
}

/**
 * E-signed quotation (public /sign link): the client's drawn signature, or null. The data URL is re-validated
 * here so only the shape public-sign stores can reach the src attribute.
 */
function clientSignatureOf(cfg: any): { image: string; who: string } | null {
  const sig: any = cfg?.clientSignature;
  if (typeof sig?.image !== 'string' || !SIG_RE.test(sig.image)) return null;
  // The signed date as the org reads it: stamped at signing in the org's time zone; older signatures are
  // formatted in the org's zone (default Asia/Singapore), never the server's UTC (2026-11-13).
  const date = first(sig.signedDateText, sig.signedAt ? paperDateIn(sig.signedAt, resolveTimeZone(cfg?.timeZone)) : '');
  const who = [first(sig.name), date].filter(Boolean).map((x) => escapeHtml(x)).join(' &nbsp;·&nbsp; ');
  return { image: sig.image, who };
}

/** A field photo key → URL. Keys are S3 object keys (public-read bucket, the
 *  same base the portal uses); data: and http(s) values pass through. */
function photoUrl(key: any, base: string): string {
  const k = String(key || '').trim();
  if (!k) return '';
  if (/^(data:|https?:\/\/)/i.test(k)) return k;
  return `${base}${k}`;
}

const SIG_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;

/**
 * Delivery order sign-off + proof photos (field app / guest link), read from
 * the DO's linked field reports — the same rows the portal's stock sheet
 * draws. Received by: the LATEST customer signature (a later partial sign-off
 * replaces the displayed one). Delivered by: the DO_START technician. The
 * photos go on a page of their own so page 1 stays the paper document.
 */
function doProof(data: any): { received: string; appendix: string } {
  const reports: any[] = Array.isArray(data?.maintenanceReports) ? data.maintenanceReports : [];
  if (!reports.length) return { received: '', appendix: '' };
  const base = String(data?.photoBaseUrl || 'https://aims-osiris.s3.ap-southeast-1.amazonaws.com/');
  const at = (r: any) => new Date(r?.signedAt ?? r?.createdAt ?? 0).getTime() || 0;
  const signed = reports.filter((r) => (r.kind === 'DO_ACK' || r.kind === 'DO_INSTALL') && typeof r.signature === 'string' && SIG_RE.test(r.signature));
  const latest = signed.length ? signed.reduce((best, r) => (at(r) >= at(best) ? r : best)) : null;
  const start = reports.find((r) => r.kind === 'DO_START');
  const tech = first(start?.technicianName, reports.find((r) => r.technicianName)?.technicianName);
  const signedDate = latest ? first(latest.signedDateText, latest.signedAt ? paperDate(latest.signedAt) : '') : '';
  const received =
    latest || tech
      ? `<div class="rcv">
    <div class="box">
      <div class="lbl">Received by:</div>
      <div class="sig">${latest ? `<img src="${latest.signature}" alt="" />` : ''}</div>
      <div class="ln">${latest ? `${escapeHtml(latest.signedByName || '')}${signedDate ? ` &nbsp;·&nbsp; ${escapeHtml(signedDate)}` : ''}` : 'Name / Signature / Date'}</div>
    </div>
    <div class="box">
      <div class="lbl">Delivered by:</div>
      <div class="sig"></div>
      <div class="ln">${escapeHtml(tech)}</div>
    </div>
  </div>`
      : '';
  const withPhotos = reports.filter((r) => Array.isArray(r.photos) && r.photos.length > 0);
  const label = (k: string) => (k === 'DO_START' ? 'Delivery Started' : k === 'DO_INSTALL' ? 'Installation Acknowledged' : 'Delivery Acknowledged');
  const appendix = withPhotos.length
    ? `<div class="proof"><h3>PROOF OF DELIVERY</h3>${withPhotos
        .map((r) => {
          const subject = first(r.subjectLabel, r.subjectAsset && r.subjectSku ? `${r.subjectAsset} (${r.subjectSku})` : r.subjectAsset, r.subjectSku);
          return `<div class="rep">
      <div class="hd"><b>${label(String(r.kind))}</b><span>${escapeHtml(r.createdAt ? new Date(r.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore' }) : '')}</span>${r.technicianName ? `<span>By: ${escapeHtml(r.technicianName)}</span>` : ''}${subject ? `<span><b>${escapeHtml(subject)}</b></span>` : ''}</div>
      <div class="grid">${(r.photos as any[]).map((k) => `<div class="ph"><img src="${escapeHtml(photoUrl(k, base))}" alt="" /></div>`).join('')}</div>
    </div>`;
        })
        .join('')}</div>`
    : '';
  return { received, appendix };
}

/** A clearly marked SAMPLE stamp, printed until the company uploads its own (Settings > Company profile > Stamp). */
const SAMPLE_STAMP = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="110" viewBox="0 0 150 110"><g fill="none" stroke="#1a3fa0" stroke-width="3"><ellipse cx="75" cy="55" rx="70" ry="50"/><ellipse cx="75" cy="55" rx="60" ry="40" stroke-width="1.5"/></g><text x="75" y="50" text-anchor="middle" font-family="Arial" font-size="22" font-weight="700" fill="#1a3fa0">SAMPLE</text><text x="75" y="72" text-anchor="middle" font-family="Arial" font-size="11" fill="#1a3fa0">COMPANY STAMP</text></svg>',
).toString('base64')}`;

/** "Add company stamp" ticked on the document: the stamp image, bottom-left; nothing otherwise. */
function companyStamp(data: any, di: (k: string, d?: any) => any): string {
  if (di('addCompanyStamp') !== true && data?.addCompanyStamp !== true) return '';
  const src = typeof data?.stampUrl === 'string' && data.stampUrl ? data.stampUrl : SAMPLE_STAMP;
  return `<div class="cstamp"><img src="${escapeHtml(src)}" alt="Company stamp" /></div>`;
}

export function renderWctBody(kind: WctDocKind, data: any, organization: any, design: DocumentDesign): string {
  const di = makeDi(data);
  const stamp = companyStamp(data, di);
  const org = organization || data?.organization || {};
  const items: any[] = (Array.isArray(data?.items) ? data.items : []).filter((it: any) => it && !it.isTagGroup);
  const docNumber = first(di('documentNumber'), data?.name);
  const footerMessage = first(di('footerMessage'), data?.footerMessage);
  // BC Air (wct-brand.ts): its letterhead, totals, terms and sign-off on the invoice and DO.
  const bc = data?.design?.brand === 'BCAIR' && kind !== 'quotation';
  // WCT Racking (design.racking): no GST Reg No on any document; the quotation's own look below.
  const racking = (design as any)?.racking === true || data?.design?.racking === true;
  const rkQuote = racking && kind === 'quotation';
  const skipTitles = (design as any)?.snoSkipTitles === true || data?.design?.snoSkipTitles === true;
  // Racking quotation watermark (design.watermark): the org logo, large and pale, behind the content.
  const wmUrl = rkQuote && ((design as any)?.watermark === true || data?.design?.watermark === true) ? String(data?.logoUrl || '') : '';

  // ── delivery order ──────────────────────────────────────────────────────
  if (kind === 'do') {
    const proof = doProof(data);
    const customer = data?.customer || {};
    const soldName = first(customer.name, data?.customerName);
    const soldAddr = withSingapore(billToText(first(data?.billTo, customer.address, data?.customerAddress), soldName));
    const attention = first(di('contact'), di('contactName'), data?.attention?.name, data?.deliveryAddress?.attention);
    const mobile = first(di('contactNumber'), customer.mobile, customer.phoneNumber);
    const da = data?.deliveryAddress || {};
    const shipLines = first(
      data?.deliveryTo,
      [da.line1, da.line2, [da.city, da.postalCode].filter(Boolean).join(' '), da.country].filter((x: any) => String(x || '').trim()).join('\n'),
    );
    const shipTo = withSingapore(shipLines) || soldAddr;
    const quotationNo = first(di('quotationNo'), di('quotationNumber'), di('referenceNo'), data?.sourceDocumentNumber);
    // WCT orders (enableWctOrders): the job's order. No line at all on a DO without one.
    const orderNo = first(di('orderNo'), data?.orderNo);
    const body = `
    <div class="title do">${escapeHtml(design.titleText || 'DELIVERY ORDER')}</div>
    <div class="stars">${'*'.repeat(46)}</div>
    <div style="display:flex;justify-content:center;margin-bottom:4px;">
      <div class="kv" style="column-gap:28px;">
        <span>Delivery Order No</span><span>${escapeHtml(docNumber)}</span>
        <span>Quotation Number</span><span>${escapeHtml(quotationNo)}</span>${orderNo ? `
        <span>Order No</span><span>${escapeHtml(orderNo)}</span>` : ''}
        <span>Date</span><span>${escapeHtml(paperDate(di('date')))}</span>
      </div>
    </div>
    <div class="doboxes">
      <div class="bx">Sold To:\n${escapeHtml(soldName)}${soldAddr ? `\n${escapeHtml(soldAddr)}` : ''}${attention || mobile ? '\n' : ''}${attention ? `\nAttention: ${escapeHtml(attention)}` : ''}${mobile ? `\nMobile: ${escapeHtml(mobile)}` : ''}</div>
      <div class="bx">Ship To:\n${escapeHtml(soldName)}${shipTo ? `\n${escapeHtml(shipTo)}` : ''}</div>
    </div>
    ${linesTable(data, items, 'do', 'SGD', false, skipTitles)}
    ${first(data?.remarks, di('remarks')) ? `<div class="remarks" style="margin-top:16px;"><b>Remarks:</b>${richContent(first(data?.remarks, di('remarks')), 'font-size:10.5px;line-height:1.5;')}</div>` : ''}
    ${proof.received}
    ${stamp}
    ${footerMessage ? `<div class="footnote screen-only">${escapeHtml(footerMessage)}</div>` : ''}
    ${proof.appendix}`;
    return bc ? sheet(bcLetterhead(data, BCAIR_DOC.numberLabel.do, docNumber), body, true) : sheet(letterhead(org, data, 'Delivery Order No', docNumber, racking), body, false, racking);
  }

  // ── quotation / tax invoice ─────────────────────────────────────────────
  const isInvoice = kind === 'invoice';
  const cfg = data?.config && typeof data.config === 'object' ? data.config : data;
  // ERP-imported documents print their stored subtotal / GST / total while the lines' money is
  // unchanged (common/erp-import.ts); the editor paths pass them as data.erpStoredTotals.
  const erp = erpTotalsOf(data, cfg, di, items);
  const t = erp ?? totalsOf(di, items);
  // …and its stored paid / owed amounts (the editor's form data does not carry them).
  const paid = (erp?.paid ?? amountPaidOf(cfg)) ?? 0;
  const outstanding = erp && erp.outstanding !== undefined ? erp.outstanding : outstandingOf(cfg);
  const due = outstanding !== null ? Math.max(0, outstanding) : Math.max(0, Math.round((t.total - paid) * 100) / 100);
  // Invoice Rev = the document's revision from "Create Revision" (Document.
  // revisionNumber: R0 = the original, R1… each revision); a legacy typed
  // value still prints.
  const revision = first(
    di('revision'),
    di('invoiceRev'),
    data?.revisionNumber !== undefined && data?.revisionNumber !== null && data?.revisionNumber !== '' ? `R${data.revisionNumber}` : '',
  );
  // Hidden only for orgs with enableQuotationTotalsToggle (data.quotationTotalsToggle, 2026-11-14).
  const showTotals = data?.quotationTotalsToggle !== true || ((data?.showTotals ?? data?.documentInfo?.showTotals) ?? true) !== false;
  // The DOs the invoice covers (2026-11-24: "DO No" replaces "Order No"). The server resolves them
  // (documents/invoice-do-nos.ts: the order's DOs billed by it, its source DO, directly linked DOs) as
  // data.invoiceDoNos; without it, the invoice's own list. No DO: the line is left out.
  const doList: unknown[] = Array.isArray(data?.invoiceDoNos) ? data.invoiceDoNos : Array.isArray(data?.deliveryOrderNos) ? data.deliveryOrderNos : [];
  const doNos = isInvoice ? [...new Set(doList.map((x) => String(x ?? '').trim()).filter(Boolean))].join(', ') : '';

  const header = `
  <div class="title">${escapeHtml(design.titleText || (isInvoice ? (bc ? BCAIR_DOC.invoiceTitle : 'TAX INVOICE') : 'QUOTATION'))}</div>
  <div class="party">
    ${billToBlock(data, di)}
    <div class="kv">
      <span class="k">Date</span><span>${escapeHtml(paperDate(di('date')))}</span>
      ${isInvoice && revision ? `<span class="k">Invoice Rev</span><span>${escapeHtml(revision)}</span>` : ''}
      ${doNos ? `<span class="k">DO No</span><span>${escapeHtml(doNos)}</span>` : ''}
      ${!isInvoice && di('validityPeriod') ? `<span class="k">Validity</span><span>${escapeHtml(di('validityPeriod'))}</span>` : ''}
      ${di('paymentTerms') && isInvoice ? `<span class="k">Terms</span><span>${escapeHtml(di('paymentTerms'))}</span>` : ''}
    </div>
  </div>
  ${jobBoxes(di)}`;

  const gstRow = t.gstPercent > 0 ? `<tr><td class="l">GST ${escapeHtml(String(t.gstPercent))}%:</td><td class="v">${cash(t.gstAmount, t.currency)}</td></tr>` : '';
  // Racking prints its discount as "$150.00", like its old quotation; everyone else keeps the brackets.
  const discountRow = t.discountAmount > 0 ? `<tr><td class="l">Discount:</td><td class="v">${racking ? cash(t.discountAmount, t.currency) : `(${cash(t.discountAmount, t.currency)})`}</td></tr>` : '';
  const L = BCAIR_DOC.totals;
  // Racking quotation: Total Amount, then (only when there is one) Goodwill Discount and the Final Amount.
  const rkFinal = t.discountAmount > 0 || t.gstPercent > 0;
  const totals = !showTotals
    ? ''
    : rkQuote
    ? `<div class="totals"><table>
    <tr><td class="l">Total Amount:</td><td class="v">${cash(t.displayNet + t.discountAmount, t.currency)}</td></tr>
    ${t.discountAmount > 0 ? `<tr><td class="l">Goodwill Discount:</td><td class="v">${cash(t.discountAmount, t.currency)}</td></tr>` : ''}${gstRow}
    ${rkFinal ? `<tr><td class="l">Final Amount:</td><td class="v">${cash(t.total, t.currency)}</td></tr>` : ''}
  </table></div>`
    : bc
    ? `<div class="totals"><table>
    <tr><td class="l">${L.total}</td><td class="v">${cash(t.displayNet + t.discountAmount, t.currency)}</td></tr>
    <tr><td class="l">${L.discount}</td><td class="v">${cash(t.discountAmount, t.currency)}</td></tr>
    ${gstRow}
    <tr><td class="l">${L.paid}</td><td class="v">${cash(paid, t.currency)}</td></tr>
    <tr class="due"><td class="l">${L.due}</td><td class="v">${cash(due, t.currency)}</td></tr>
    <tr><td class="l">${L.paymentType}</td><td class="v"></td></tr>
  </table></div>`
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
  const remarksBlock = remarks ? `<div class="remarks"><b>Remarks:</b>${richContent(remarks, 'font-size:10.5px;line-height:1.5;')}</div>` : '';
  const tnc = first(data?.termsAndConditions, di('termsAndConditions'));
  const tncBlock = tnc ? `<div class="tnc"><h3>Terms and Conditions:</h3>${richContent(tnc, 'font-size:10px;line-height:1.6;')}</div>` : '';
  const bcTnc = `<div class="tnc"><h3>${escapeHtml(BCAIR_DOC.tncTitle)}</h3>${
    tnc ? richContent(tnc, 'font-size:10px;line-height:1.6;') : BCAIR_DOC.tnc.map((l) => `<div class="ln">${escapeHtml(l)}</div>`).join('')
  }</div>`;
  const S = BCAIR_DOC.sign;
  const bcSign = `<div class="bcsign"><div class="l"><div>${escapeHtml(S.closing)}</div><div class="scr">${escapeHtml(S.name)}</div><div>${escapeHtml(S.title)}</div><div>${escapeHtml(S.company)}</div></div><div class="r"><div>${escapeHtml(S.confirm)}</div><div>${escapeHtml(S.stamp)}</div></div></div>`;

  const signature = isInvoice ? null : clientSignatureOf(cfg);
  // Racking quotation: the Notes and the terms as one footer, no "Remarks" heading; a TERMS & CONDITIONS
  // heading is added when the terms do not carry one.
  const rkNote = first(data?.note, di('note'), data?.remarks, di('remarks'));
  // The PAYMENT TERMS heading (and everything after it) always starts on a new page (guru
  // 2026-11-19); terms with no such heading start the new page at their first line instead.
  const rkTnc = tnc ? `${hasTermsHeading(tnc) ? '' : `<div class="hd">TERMS &amp; CONDITIONS:</div>`}${rackingFooterText(tnc)}` : '';
  const RK_PAY = '<div class="hd">PAYMENT TERMS:</div>';
  const rkTncPaged = rkTnc.includes(RK_PAY) ? rkTnc.replace(RK_PAY, '<div class="hd pb">PAYMENT TERMS:</div>') : rkTnc ? `<div class="pb">${rkTnc}</div>` : '';
  const rkFooter = rkQuote && (rkNote || tnc)
    ? `<div class="rkfoot">${rkNote ? rackingFooterText(rkNote) : ''}${rkTncPaged}</div>`
    : '';
  const stampHtml = signature
    ? `<div class="stamp"><img class="sigimg" src="${signature.image}" alt="" />Company Stamp &amp; Authorized Signature${signature.who ? `<div class="who">${signature.who}</div>` : ''}</div>`
    : '<div class="stamp">Company Stamp &amp; Authorized Signature</div>';
  // Signed by: the quotation's own field, else its salesperson (never a raw user id); title default Manager.
  const rkSigner = first(di('signedBy'), salesNameOf(di));
  const rkClosing = `<div class="closing${signature ? ' signed' : ''}">
        <div class="rksig"><div>Yours Sincerely,</div><div class="scr">${escapeHtml(rkSigner) || '&nbsp;'}</div><div>${escapeHtml(first(di('signedByTitle'), 'Manager'))} of</div><div class="co">${escapeHtml(first(org?.name, data?.company?.name))}</div></div>
        ${stampHtml}
      </div>`;
  const closing = isInvoice
    ? footerMessage
      ? `<div class="footnote screen-only">${escapeHtml(footerMessage)}</div>`
      : ''
    : `<div class="closing${signature ? ' signed' : ''}">
        <div><div class="director">Director of ${escapeHtml(first(org?.name, data?.company?.name))}</div>${
          footerMessage ? `<div class="screen-only">${escapeHtml(footerMessage)}</div>` : ''
        }</div>
        ${
          signature
            ? `<div class="stamp"><img class="sigimg" src="${signature.image}" alt="" />Company Stamp &amp; Authorized Signature${
                signature.who ? `<div class="who">${signature.who}</div>` : ''
              }</div>`
            : '<div class="stamp">Company Stamp &amp; Authorized Signature</div>'
        }
      </div>`;

  if (bc) {
    const bcBody = `${header}${linesTable(data, items, kind, t.currency, false, skipTitles)}${totals}${remarksBlock}${bcTnc}${bcSign}${stamp}${footerMessage ? `<div class="footnote screen-only">${escapeHtml(footerMessage)}</div>` : ''}`;
    return sheet(bcLetterhead(data, BCAIR_DOC.numberLabel.invoice, docNumber), bcBody, true);
  }
  if (rkQuote) {
    const rkBody = `${header}${linesTable(data, items, kind, t.currency, true)}${totals}${rkFooter}${signBlock(di, true)}${rkClosing}${stamp}`;
    const wm = wmUrl ? `<div class="rkwm"><img src="${escapeHtml(wmUrl)}" alt="" /></div>` : '';
    return sheet(letterhead(org, data, 'Quotation No', docNumber, true), rkBody, false, true, wm);
  }
  // Racking invoice: its terms print like the quotation footer (headings in capitals, a TERMS & CONDITIONS
  // heading only when the text has none), not under a separate "Terms and Conditions:" title.
  const rkInvTnc = racking && isInvoice && tnc
    ? `<div class="rkfoot">${hasTermsHeading(tnc) ? '' : `<div class="hd">TERMS &amp; CONDITIONS:</div>`}${rackingFooterText(tnc)}</div>`
    : null;
  const body = `${header}${linesTable(data, items, kind, t.currency, false, skipTitles)}${totals}${remarksBlock}${rkInvTnc ?? tncBlock}${signBlock(di)}${closing}${stamp}`;
  return sheet(letterhead(org, data, isInvoice ? 'Invoice No' : 'Quotation No', docNumber, racking), body, false, racking);
}

/** The outer sheet: letterhead + page-top spacer in the repeating thead, page-bottom spacer in the repeating tfoot. */
const sheetTable = (head: string, body: string): string =>
  `<table class="wct-sheet"><thead><tr class="wct-pgtop"><td></td></tr><tr><td>${head}</td></tr></thead><tbody><tr><td>${body}</td></tr></tbody><tfoot><tr class="wct-pgbot"><td></td></tr></tfoot></table>`;

function sheet(head: string, body: string, bc = false, rk = false, watermark = ''): string {
  if (rk) return `${CSS}${RK_CSS}${watermark}<div class="wct rk">${sheetTable(head, body)}</div>`;
  if (bc) return `${CSS}${BC_CSS}<div class="wct bc">${sheetTable(head, body)}</div>`;
  return `${CSS}<div class="wct">${sheetTable(head, body)}</div>`;
}

/** Footer line for the PDF's per-page footer (left of "Page n/N"). */
export function wctFooterLine(data: any, type?: string): string {
  const di = makeDi(data);
  // Racking quotation: no "computer generated" line (it is signed by the manager).
  const t = String(type || data?.documentType || data?.type || '').toUpperCase();
  if (data?.design?.racking === true && ['QUOTATION', 'QO', 'QO1', 'QO2', 'QT'].includes(t)) return '';
  return first(di('footerMessage'), data?.footerMessage);
}
