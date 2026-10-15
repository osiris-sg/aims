/**
 * In-app logistics documents (pure: types, prefill, A4 HTML):
 *  - SG→JP INVOICE & PACKING LIST (SGJP_IV_PL): ADH Singapore sells to ADH
 *    Japan for import; one PDF with an invoice page and packing-list page(s).
 *  - SHIPPING INSTRUCTIONS / 出荷指示 (SHIPPING_INSTRUCTIONS): to the
 *    warehouse / forwarder, bilingual labels, with a delivery schedule grid.
 */
import { roundDown, roundTo } from './trade-invoice';
import { docShell, enDate, esc, jpDate, lines as br, money, qty } from './trade-doc-shell';

const has = (v: unknown) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const num = (v: unknown) => (has(v) ? Number(v) : null);

// ── SG→JP invoice & packing list ────────────────────────────────────────────
export interface SgjpHeader {
  invoiceNo: string | null;
  invoiceDate: string;
  sellerBlock: string;
  buyerBlock: string;
  blNumber: string;
  vessel: string;
  voyageNo: string;
  portOfLoading: string;
  portOfDischarge: string;
  terms: string;
  description: string;
  hsCode: string;
  countryOfOrigin: string;
  netWeightMt: number | null;
  grossWeightMt: number | null;
  bundles: number | null;
  pieces: number | null;
  unitPrice: number | null;
  currency: string;
  remarks: string;
}
export interface PackingRow {
  containerNo: string;
  bundles: number | null;
  netMt: number | null;
  grossMt: number | null;
}

export const sgjpAmount = (h: Pick<SgjpHeader, 'netWeightMt' | 'unitPrice'>) => (has(h.netWeightMt) && has(h.unitPrice) ? roundTo(Number(h.netWeightMt) * Number(h.unitPrice), 2) : null);

export function packingTotals(rows: PackingRow[]) {
  const s = (k: 'bundles' | 'netMt' | 'grossMt') =>
    roundTo(
      rows.reduce((a, r) => a + (num(r[k]) ?? 0), 0),
      3,
    );
  return { containers: rows.filter((r) => r.containerNo).length, bundles: s('bundles'), netMt: s('netMt'), grossMt: s('grossMt') };
}

/** Packing rows per container from Customer-PL style rows (container + net/gross per bundle). */
export function packingFromBundles(rows: Array<{ container?: unknown; netMt?: unknown; grossMt?: unknown }>): PackingRow[] {
  const by = new Map<string, PackingRow>();
  for (const r of rows) {
    const c = String(r.container ?? '').trim();
    if (!c) continue;
    const p = by.get(c) ?? { containerNo: c, bundles: 0, netMt: 0, grossMt: 0 };
    p.bundles = (p.bundles ?? 0) + 1;
    p.netMt = roundTo((p.netMt ?? 0) + (num(r.netMt) ?? 0), 3);
    p.grossMt = roundTo((p.grossMt ?? 0) + (num(r.grossMt) ?? 0), 3);
    by.set(c, p);
  }
  return [...by.values()];
}

export function renderSgjpHtml(h: SgjpHeader, rows: PackingRow[], opts: { draft?: boolean } = {}): string {
  const amount = sgjpAmount(h);
  const t = packingTotals(rows);
  const refs = (title: string) => `
<div class="hd"><div class="seller pre">${br(h.sellerBlock)}</div><div class="ttl"><h1>${title}</h1><table class="kv"><tr><th>Invoice No.</th><td>${esc(h.invoiceNo ?? '(on finalize)')}</td></tr><tr><th>Date</th><td>${enDate(h.invoiceDate)}</td></tr></table></div></div>
<table class="refs">
  <tr><th>Buyer / Consignee</th><td class="pre" rowspan="3">${br(h.buyerBlock)}</td><th>B/L No.</th><td>${esc(h.blNumber)}</td></tr>
  <tr><th></th><th>Vessel / Voyage</th><td>${esc([h.vessel, h.voyageNo].filter(Boolean).join(' / '))}</td></tr>
  <tr><th></th><th>Port of loading</th><td>${esc(h.portOfLoading)}</td></tr>
  <tr><th>Terms</th><td>${esc(h.terms)}</td><th>Port of discharge</th><td>${esc(h.portOfDischarge)}</td></tr>
</table>`;
  const body = `
<section>
${refs('COMMERCIAL INVOICE')}
<table class="grid">
  <thead><tr><th>Description of goods</th><th>HS code</th><th>Origin</th><th>Net weight (MT)</th><th>Unit price (${esc(h.currency)}/MT)</th><th>Amount (${esc(h.currency)})</th></tr></thead>
  <tbody><tr>
    <td class="pre">${br(h.description)}${has(h.bundles) || has(h.pieces) ? `<br><span class="muted">${has(h.bundles) ? `${qty(h.bundles)} bundles` : ''}${has(h.bundles) && has(h.pieces) ? ' / ' : ''}${has(h.pieces) ? `${qty(h.pieces)} pieces` : ''}</span>` : ''}</td>
    <td>${esc(h.hsCode)}</td><td>${esc(h.countryOfOrigin)}</td>
    <td class="num">${money(h.netWeightMt, 3)}</td><td class="num">${money(h.unitPrice)}</td><td class="num">${money(amount)}</td>
  </tr></tbody>
  <tfoot><tr><td colspan="3">Total</td><td class="num">${money(h.netWeightMt, 3)}</td><td></td><td class="num"><b>${esc(h.currency)} ${money(amount)}</b></td></tr></tfoot>
</table>
<table class="kv2"><tr><th>Gross weight</th><td>${money(h.grossWeightMt, 3)} MT</td><th>Net weight</th><td>${money(h.netWeightMt, 3)} MT</td></tr></table>
${h.remarks ? `<div class="pre rem">${br(h.remarks)}</div>` : ''}
<div class="sign">For and on behalf of<br>${esc(h.sellerBlock.split('\n')[0] ?? '')}</div>
</section>
<section class="pb">
${refs('PACKING LIST')}
<table class="grid">
  <thead><tr><th>#</th><th>Container No.</th><th>Bundles</th><th>Net weight (MT)</th><th>Gross weight (MT)</th></tr></thead>
  <tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.containerNo)}</td><td class="num">${qty(r.bundles)}</td><td class="num">${money(r.netMt, 3)}</td><td class="num">${money(r.grossMt, 3)}</td></tr>`).join('')}</tbody>
  <tfoot><tr><td colspan="2">Total (${t.containers} container${t.containers === 1 ? '' : 's'})</td><td class="num">${qty(t.bundles)}</td><td class="num">${money(t.netMt, 3)}</td><td class="num">${money(t.grossMt, 3)}</td></tr></tfoot>
</table>
<p class="muted">${esc(h.description.split('\n')[0] ?? '')}${has(h.pieces) ? ` · ${qty(h.pieces)} pieces` : ''}</p>
</section>`;
  const css = `
section.pb { page-break-before: always; }
@media screen { section.pb { margin-top: 14mm; border-top: 2px dashed #bbb; padding-top: 8mm; } }
.hd { display: flex; justify-content: space-between; gap: 8mm; border-bottom: 2px solid #111; padding-bottom: 3mm; }
.seller { font-size: 8.5pt; }
.seller::first-line { font-weight: 700; font-size: 11pt; }
.ttl { text-align: right; }
.ttl h1 { font-size: 15pt; margin: 0 0 2mm; letter-spacing: .06em; white-space: nowrap; }
.kv th, .kv2 th { text-align: left; font-weight: 400; color: #555; padding-right: 8px; }
table.refs { width: 100%; margin: 3mm 0; font-size: 8.5pt; }
.refs th { text-align: left; color: #555; font-weight: 400; padding: 2px 6px 2px 0; vertical-align: top; width: 18%; }
.refs td { padding: 2px 8px 2px 0; vertical-align: top; }
table.grid { width: 100%; font-size: 8.5pt; margin-top: 2mm; }
.grid th { background: #eee; border: 1px solid #888; padding: 3px 5px; }
.grid td { border: 1px solid #aaa; padding: 3px 5px; vertical-align: top; }
.grid tfoot td { font-weight: 700; background: #f7f7f7; }
.kv2 { margin-top: 2mm; font-size: 8.5pt; } .kv2 td { padding-right: 14px; }
.rem { margin-top: 3mm; font-size: 8.5pt; }
.sign { margin-top: 14mm; margin-left: auto; width: 45%; border-top: 1px solid #111; padding-top: 3px; text-align: center; font-size: 8.5pt; }
`;
  return docShell({ title: `SG-JP Invoice & Packing List ${h.invoiceNo ?? ''}`.trim(), css, body, draft: opts.draft });
}

// ── Shipping instructions / 出荷指示 ─────────────────────────────────────────
export interface SiHeader {
  title: string;
  number: string | null;
  date: string;
  to: string;
  fromBlock: string;
  contactName: string;
  blNumber: string;
  vessel: string;
  voyageNo: string;
  eta: string | null;
  containerCount: number | null;
  telexReleaseCode: string;
  cargoDescription: string;
  netWeightMt: number | null;
  grossWeightMt: number | null;
  bundles: number | null;
  pieces: number | null;
  deliveryAddress: string;
  specialInstructions: string;
}
export interface ScheduleRow {
  date: string;
  trucks: number | null;
  mt: number | null;
  notes: string;
}

export function renderSiHtml(h: SiHeader, rows: ScheduleRow[], opts: { draft?: boolean } = {}): string {
  const total = roundTo(
    rows.reduce((a, r) => a + (num(r.mt) ?? 0), 0),
    3,
  );
  const trucks = rows.reduce((a, r) => a + (num(r.trucks) ?? 0), 0);
  const kv = (ja: string, en: string, v: string) => `<tr><th>${ja}<span>${en}</span></th><td>${v}</td></tr>`;
  const body = `
<div class="hd"><h1>${esc(h.title || '出荷指示書 / SHIPPING INSTRUCTIONS')}</h1><div class="no">${h.number ? `No. ${esc(h.number)}<br>` : ''}${jpDate(h.date)}</div></div>
<div class="parties">
  <div><div class="lbl">宛先 <span>To</span></div><div class="pre big">${br(h.to)} 御中</div></div>
  <div><div class="lbl">差出人 <span>From</span></div><div class="pre">${br(h.fromBlock)}</div>${h.contactName ? `<div>担当 / Contact: ${esc(h.contactName)}</div>` : ''}</div>
</div>
<p>下記貨物の引取り・配送をお願い致します。 Please arrange collection and delivery of the cargo below.</p>
<table class="kv">
  ${kv('B/L番号', 'B/L No.', esc(h.blNumber))}
  ${kv('本船 / 航海', 'Vessel / Voyage', esc([h.vessel, h.voyageNo].filter(Boolean).join(' / ')))}
  ${kv('入港予定日', 'Latest ETA', h.eta ? jpDate(h.eta) : '')}
  ${kv('コンテナ本数', 'Containers', has(h.containerCount) ? `${qty(h.containerCount)}` : '')}
  ${kv('テレックスリリース', 'Telex release code', esc(h.telexReleaseCode))}
  ${kv('品名', 'Cargo', br(h.cargoDescription))}
  ${kv('重量', 'Weight', `${has(h.netWeightMt) ? `N.W. ${money(h.netWeightMt, 3)} MT` : ''}${has(h.grossWeightMt) ? ` / G.W. ${money(h.grossWeightMt, 3)} MT` : ''}`)}
  ${kv('数量', 'Packages', `${has(h.bundles) ? `${qty(h.bundles)} bundles` : ''}${has(h.pieces) ? ` / ${qty(h.pieces)} pieces` : ''}`)}
  ${kv('納入先', 'Delivery address', br(h.deliveryAddress))}
</table>
<div class="lbl sec">配送スケジュール <span>Delivery schedule</span></div>
<table class="grid">
  <thead><tr><th>日付 / Date</th><th>台数 / Trucks</th><th>数量 / MT</th><th>備考 / Notes</th></tr></thead>
  <tbody>${rows.map((r) => `<tr><td>${esc(r.date)}</td><td class="num">${qty(r.trucks)}</td><td class="num">${money(r.mt, 3)}</td><td class="pre">${br(r.notes)}</td></tr>`).join('')}</tbody>
  <tfoot><tr><td>合計 / Total</td><td class="num">${trucks || ''}</td><td class="num">${total ? money(total, 3) : ''}</td><td></td></tr></tfoot>
</table>
${h.specialInstructions ? `<div class="lbl sec">特記事項 <span>Special instructions</span></div><div class="pre box">${br(h.specialInstructions)}</div>` : ''}
`;
  const css = `
.hd { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 2mm; }
.hd h1 { font-size: 15pt; margin: 0; }
.no { text-align: right; font-size: 8.5pt; }
.parties { display: flex; gap: 10mm; margin: 4mm 0 2mm; } .parties > div { flex: 1; }
.lbl { font-weight: 700; font-size: 8.5pt; } .lbl span, .kv th span { font-weight: 400; color: #666; margin-left: 4px; font-size: 7.5pt; }
.big { font-size: 12pt; font-weight: 700; }
table.kv { width: 100%; font-size: 9pt; margin-top: 2mm; }
.kv th { text-align: left; width: 30%; padding: 3px 6px; background: #f3f3f3; border: 1px solid #ccc; font-weight: 600; }
.kv td { padding: 3px 6px; border: 1px solid #ccc; }
.sec { margin-top: 4mm; }
table.grid { width: 100%; font-size: 8.5pt; margin-top: 1mm; }
.grid th { background: #eee; border: 1px solid #888; padding: 3px 5px; }
.grid td { border: 1px solid #aaa; padding: 3px 5px; vertical-align: top; }
.grid tfoot td { font-weight: 700; background: #f7f7f7; }
.box { border: 1px solid #aaa; padding: 2mm 3mm; font-size: 9pt; margin-top: 1mm; }
`;
  return docShell({ title: 'Shipping Instructions', css, body, draft: opts.draft });
}

// ── SG→JP INVOICE & PACKING LIST, ADH layout (header.layout = 2) ────────────
/**
 * Laid out after ADH's own sheet ("INVOICE & PACKING LIST_…_SG-JP.xlsx", PDF用):
 * Shipper / Consignee / Seller / Buyer boxes, the receipt–delivery grid, one
 * invoice table and one PACKING DETAILS table (a row per item), and the seller's
 * signature block. A shipment may have several (split arrival 先着 / 後着), each
 * with its own quantity, bundles, pieces and vessel.
 */
export interface SgjpHeaderV2 {
  layout: 2;
  /** Default "ADH" + yyyymmdd of the invoice date. */
  invoiceNo: string;
  invoiceDate: string;
  shipperBlock: string;
  consigneeBlock: string;
  sellerBlock: string;
  buyerBlock: string;
  placeOfReceipt: string;
  portOfLoading: string;
  portOfDischarge: string;
  placeOfDelivery: string;
  payment: string;
  countryOfOrigin: string;
  /** "VESSEL / VOYAGE". */
  vessel: string;
  others: string;
  shippingMarks: string;
  signBlock: string;
  currency: string;
  /** YYYY-MM the LME average is taken from (the shipment month). */
  lmeMonth: string;
}
export interface SgjpItem {
  /** "Aluminium Billet Alloy 6063-8 inch". */
  goods: string;
  hsCode: string;
  /** Printed after the HS code on the invoice line ("CIF"). */
  terms: string;
  /** Customer price helper (USD/MT): with LME filled, unit price = LME + QMJP + premium + upcharge. */
  lme: number | null;
  qmjp: number | null;
  premium: number | null;
  upcharge: number | null;
  unitPrice: number | null;
  /** Invoice quantity (MT) — normally the net weight. */
  quantity: number | null;
  bundles: number | null;
  pieces: number | null;
  netMt: number | null;
  grossMt: number | null;
  dimension: string;
}

/** "ADH20260820" for 2026-08-20. */
export const sgjpInvoiceNo = (date: string) => `ADH${(date ?? '').replace(/-/g, '').slice(0, 8)}`;

export function sgjpUnitPrice(i: Pick<SgjpItem, 'lme' | 'qmjp' | 'premium' | 'upcharge' | 'unitPrice'>): number | null {
  if (has(i.lme)) return roundTo((num(i.lme) ?? 0) + (num(i.qmjp) ?? 0) + (num(i.premium) ?? 0) + (num(i.upcharge) ?? 0), 4);
  return num(i.unitPrice);
}
/** Ports and places print in capitals, as on ADH's SG→JP invoice ("VISAKHAPATNAM PORT, INDIA"); the stored value stays as typed. */
const upper = (v: string | null | undefined) => (v ?? '').toUpperCase();

/** ROUNDDOWN(unit price × quantity, 2), as ADH's sheet. */
export function sgjpItemAmount(i: SgjpItem): number | null {
  const p = sgjpUnitPrice(i);
  const q = num(i.quantity);
  return p === null || q === null ? null : roundDown(q * p, 2);
}
export function sgjpTotals(items: SgjpItem[]) {
  const s = (f: (i: SgjpItem) => number | null, dp: number) =>
    roundTo(
      items.reduce((a, i) => a + (f(i) ?? 0), 0),
      dp,
    );
  return {
    quantity: s((i) => num(i.quantity), 3),
    amount: s(sgjpItemAmount, 2),
    bundles: s((i) => num(i.bundles), 0),
    pieces: s((i) => num(i.pieces), 0),
    netMt: s((i) => num(i.netMt), 3),
    grossMt: s((i) => num(i.grossMt), 3),
  };
}

export function renderSgjpV2Html(h: SgjpHeaderV2, items: SgjpItem[], opts: { draft?: boolean } = {}): string {
  const t = sgjpTotals(items);
  const slash = (d: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '');
    return m ? `${m[1]}/${Number(m[2])}/${Number(m[3])}` : esc(d);
  };
  const cell = (label: string, value: string) => `<div class="lb">${label}</div><div class="v pre">${br(value)}</div>`;
  const body = `
<h1>INVOICE &amp; PACKING LIST</h1>
<div class="no"><span>INVOICE NO.: ${esc(h.invoiceNo)}</span><span>Invoice Date：${slash(h.invoiceDate)}</span></div>
<table class="parties">
  <tr><td>${cell('（Shipper)', h.shipperBlock)}</td><td>${cell('(Consignee: Ship To)', h.consigneeBlock)}</td></tr>
  <tr><td>${cell('（Seller)', h.sellerBlock)}</td><td>${cell('(Buyer)', h.buyerBlock)}</td></tr>
</table>
<table class="route">
  <tr><td>${cell('(Place Of receipt)', upper(h.placeOfReceipt))}</td><td>${cell('(Payment)', h.payment)}</td><td rowspan="4" class="marks">${cell('(Shipping Marks)', h.shippingMarks)}</td></tr>
  <tr><td>${cell('(Port Of Loading)', upper(h.portOfLoading))}</td><td>${cell('(Country Of Origin)', upper(h.countryOfOrigin))}</td></tr>
  <tr><td>${cell('(Port Of Discharge)', upper(h.portOfDischarge))}</td><td>${cell('(Vessel)', h.vessel)}</td></tr>
  <tr><td>${cell('(Place Of Delivery)', upper(h.placeOfDelivery))}</td><td>${cell('(Others)', h.others)}</td></tr>
</table>
<table class="grid inv">
  <colgroup><col style="width:9%"><col style="width:41%"><col style="width:16%"><col style="width:16%"><col style="width:18%"></colgroup>
  <thead><tr><th>C/No.</th><th>DESCRIPTION</th><th>UNIT PRICE</th><th>QUANTITY</th><th>TOTAL PRICE</th></tr></thead>
  <tbody>${items
    .map(
      (i, k) =>
        `<tr><td class="c">${k + 1}</td><td class="pre">${br(i.goods)}<br>HS Code: ${esc(i.hsCode)}${i.terms ? ` ${esc(i.terms)}` : ''}</td><td class="num">${money(sgjpUnitPrice(i))}</td><td class="num">${money(num(i.quantity), 3)}</td><td class="num">${usdAmount(sgjpItemAmount(i))}</td></tr>`,
    )
    .join('')}
  <tr class="tot"><td colspan="3">TOTAL</td><td class="num">${money(t.quantity, 3)}</td><td class="num">${usdAmount(t.amount)}</td></tr></tbody>
</table>
<h2>PACKING DETAILS</h2>
<table class="grid pk">
  <colgroup><col style="width:9%"><col style="width:37%"><col style="width:12%"><col style="width:13%"><col style="width:13%"><col style="width:16%"></colgroup>
  <thead><tr><th>C/No.</th><th>DESCRIPTION</th><th>Q'TY</th><th>Net Weight(MT)</th><th>Gross Weight(MT)</th><th>Dimention</th></tr></thead>
  <tbody>${items
    .map(
      (i, k) =>
        `<tr><td class="c">${k + 1}</td><td class="pre">${br(i.goods)}${has(i.bundles) ? `- ${qty(num(i.bundles))} Bundles` : ''}<br>HS Code: ${esc(i.hsCode)}</td><td class="num">${has(i.pieces) ? `${qty(num(i.pieces))} PCS` : ''}</td><td class="num">${money(num(i.netMt), 3)}</td><td class="num">${money(num(i.grossMt), 3)}</td><td class="pre">${br(i.dimension)}</td></tr>`,
    )
    .join('')}
  <tr class="tot"><td>TOTAL :</td><td>${qty(t.bundles)}  Bundle only</td><td></td><td class="num">${money(t.netMt, 3)}</td><td class="num">${money(t.grossMt, 3)}</td><td></td></tr></tbody>
</table>
<div class="sign pre">${br(h.signBlock)}</div>`;
  const css = `
body { font-size: 8.4pt; }
h1 { text-align: center; font-size: 15pt; margin: 0 0 4mm; letter-spacing: .04em; }
h2 { font-size: 9.5pt; margin: 5mm 0 1.5mm; }
.no { display: flex; justify-content: space-between; font-weight: 700; margin-bottom: 2mm; }
table.parties, table.route { width: 100%; table-layout: fixed; }
.parties td, .route td { border: 1px solid #333; padding: 1.5mm 2mm; vertical-align: top; }
.parties td { height: 27mm; }
.route td { height: 10mm; }
.lb { font-size: 7.4pt; color: #333; }
.v { font-size: 8.2pt; margin-top: .5mm; }
table.grid { width: 100%; table-layout: fixed; margin-top: 3mm; }
.grid th { border: 1px solid #333; background: #eee; padding: 1.5mm; font-weight: 700; }
.grid td { border: 1px solid #333; padding: 1.5mm; vertical-align: top; }
.grid td.c { text-align: center; }
.grid tfoot td, .grid tr.tot td { font-weight: 700; }
.sign { margin: 10mm 0 0 auto; width: 70mm; font-size: 8pt; border-top: 1px solid #111; padding-top: 1.5mm; }
`;
  return docShell({ title: `INVOICE & PACKING LIST ${h.invoiceNo ?? ''}`.trim(), css, body, draft: opts.draft });
}

// ── 出庫・納入依頼書 (Shipping instructions), ADH layout (header.layout = 2) ───
/**
 * After ADH's "出荷・納入依頼書" (sheet PDF): to the warehouse 御中, request
 * date, issuer, 本船 / 海事№ (voyage) / B/L № (last 5 digits) / 倉庫名, one row
 * per truck day (出荷日 · 納入日 · 納入先 · ビレット · 束数) with the 重量 cell
 * (総重量 / 正味重量) spanning them, 出荷主, 運送会社 and the 備考 lines.
 */
export interface SiHeaderV2 {
  layout: 2;
  requestDate: string;
  toName: string;
  issuerName: string;
  title: string;
  vessel: string;
  voyageNo: string;
  blNumber: string;
  warehouseName: string;
  grossWeightMt: number | null;
  netWeightMt: number | null;
  shipper: string;
  carrier: string;
  /** 備考, one line each; the first prints with "・". */
  remarks: string;
  /** The delivery profile the 納入先 / 備考 came from (docDefaults.deliveryProfiles[].id). */
  deliveryProfileId?: string | null;
}
export interface SiRowV2 {
  shipDate: string;
  deliveryDate: string;
  destination: string;
  billet: string;
  bundles: number | null;
}

/** "末尾・・・04630": the B/L number's last five characters, as ADH prints it. */
export const blTail = (bl: string) => {
  const t = (bl ?? '').trim();
  return t.length > 5 ? `末尾・・・${t.slice(-5)}` : t;
};
/** "203 MM X 5800 MM" → "203 X 5800". */
export const billetSize = (size: string | null | undefined) =>
  (size ?? '')
    .replace(/\s*MM\b/gi, '')
    .replace(/\s*[x×]\s*/gi, ' X ')
    .trim();

const md = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '');
  return m ? `${Number(m[2])}/${Number(m[3])}` : esc(d);
};

export function renderSiV2Html(h: SiHeaderV2, rows: SiRowV2[], opts: { draft?: boolean } = {}): string {
  const weight = [has(h.grossWeightMt) ? `総重量\n${money(num(h.grossWeightMt), 3)}トン` : '', has(h.netWeightMt) ? `(正味重量\n${money(num(h.netWeightMt), 3)}トン)` : ''].filter(Boolean).join('\n');
  const billet = (b: string) =>
    br(b)
      .replace(/(\d+\s*X\s*\d+)/, '<br>$1')
      .replace(/^<br>/, '');
  const notes = (h.remarks ?? '').split(/\r?\n/);
  const body = `
<div class="req">手配依頼日<span>${slashDay(h.requestDate)}</span></div>
<div class="to">${esc(addressee(h.toName))}</div>
<div class="iss">${esc(h.issuerName)}</div>
<h1>${esc(h.title || '出庫・納入依頼書')}</h1>
<table class="kv">
  <tr><th>本船</th><td>${esc(h.vessel)}</td><td class="gap"></td><th>海事№</th><td>${esc(h.voyageNo)}</td></tr>
  <tr><th>B/L №</th><td>${esc(blTail(h.blNumber))}</td><td class="gap"></td><th>倉庫名</th><td>${esc(h.warehouseName)}</td></tr>
</table>
<table class="grid">
  <colgroup><col style="width:11%"><col style="width:12%"><col style="width:36%"><col style="width:16%"><col style="width:8%"><col style="width:17%"></colgroup>
  <thead><tr><th>出荷日</th><th>納入日</th><th>納入先</th><th>ビレット</th><th>束数</th><th>重 量</th></tr></thead>
  <tbody>${rows
    .map(
      (r, i) =>
        `<tr><td class="c">${md(r.shipDate)}</td><td class="c">${md(r.deliveryDate)}</td><td class="c">${esc(r.destination)}</td><td class="c">${billet(r.billet)}</td><td class="c">${qty(num(r.bundles))}</td>${i === 0 ? `<td class="w pre" rowspan="${rows.length}">${br(weight)}</td>` : ''}</tr>`,
    )
    .join('')}</tbody>
</table>
<table class="kv2"><tr><th>出 荷 主</th><td>${esc(h.shipper)}</td></tr><tr><th>運送会社</th><td>${esc(h.carrier)}</td></tr></table>
<table class="rem"><tr><th>備　　考</th><td>${notes[0] ? `・　${esc(notes[0].trim())}` : ''}</td></tr>${notes
    .slice(1)
    .map((l) => `<tr><td class="nb"></td><td class="ind">${esc(l.trim())}</td></tr>`)
    .join('')}<tr><td class="nb"></td><td></td></tr></table>`;
  const css = `
body { font-size: 9.5pt; }
.req { text-align: right; margin: 6mm 8mm 3mm 0; } .req span { margin-left: 6mm; }
.to { font-weight: 700; font-size: 10.5pt; display: inline-block; border-bottom: 1px solid #111; padding: 0 30mm 1mm 0; }
.iss { text-align: right; font-weight: 700; font-size: 10.5pt; margin: 10mm 2mm 0 0; }
h1 { text-align: center; font-size: 12pt; font-weight: 400; text-decoration: underline; margin: 16mm 0 7mm; }
table.kv { width: 100%; margin-bottom: 5mm; }
.kv th { text-align: left; font-weight: 400; width: 11%; padding: 2mm 0; border-bottom: 1px solid #111; }
.kv td { width: 27%; padding: 2mm 0; border-bottom: 1px solid #111; } .kv td.gap { width: 12%; border: 0; }
table.grid { width: 100%; table-layout: fixed; }
.grid th { border: 1px solid #111; font-weight: 400; padding: 1mm; }
.grid td { border: 1px solid #111; padding: 1mm; vertical-align: top; height: 10mm; }
.grid td.c { text-align: center; }
.grid td.w { font-size: 8.5pt; }
table.kv2 { width: 76%; margin-top: 6mm; } .kv2 th, .kv2 td { border: 1px solid #111; padding: 1mm 3mm; font-weight: 400; } .kv2 th { width: 30%; text-align: center; }
table.rem { width: 100%; margin-top: 6mm; } .rem th { width: 24%; border: 1px solid #111; font-weight: 400; vertical-align: top; padding: 1mm; }
.rem td { border-bottom: 1px solid #111; padding: 1mm 0 1mm 4mm; height: 6.5mm; } .rem td.ind { padding-left: 9mm; } .rem td.nb { border: 0; }
`;
  return docShell({ title: h.title || '出庫・納入依頼書', css, body, draft: opts.draft });
}

/** What stops a SG→JP invoice from being finalized: an item without a unit price (or without its LME) and a US$0.00 total. */
export function sgjpFinalizeProblems(items: SgjpItem[]): string[] {
  const problems: string[] = [];
  items.forEach((it, i) => {
    if (!(it.goods ?? '').trim() && !has(it.quantity)) return;
    if (sgjpUnitPrice(it) !== null) return;
    const helper = [it.qmjp, it.premium, it.upcharge].some(has);
    problems.push(helper ? `item ${i + 1} needs the LME` : `item ${i + 1} needs a unit price`);
  });
  if (sgjpTotals(items).amount === 0) problems.push('the total is US$0.00');
  return problems;
}

/** "US$459,412.52" — the SG→JP amount cells, as ADH's sheet prints them. */
function usdAmount(v: number | null): string {
  return v === null ? '' : `US$${money(v)}`;
}
/** "2026-09-01" → "2026/9/1" (出庫・納入依頼書's request date). */
function slashDay(d: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '');
  return m ? `${m[1]}/${Number(m[2])}/${Number(m[3])}` : esc(d ?? '');
}
/** The 宛先 line is a setting with its own 御中 ("三井倉庫 株式会社 御中"); an older name-only value gets 御中 added. */
export function addressee(toName: string | null | undefined): string {
  const t = (toName ?? '').trim();
  return !t || /御中$/.test(t) ? t : `${t} 御中`;
}
