/**
 * Round AN (2026-10-26) — Hoei's own documents, as ADH sends them (Drive "Thailand/", Houeiへ送付資料/Sent and the
 * per-deal folders 202505 … 202608 P1020):
 *
 *   Hoei gets Vedanta's set as received (B/L, COA, COO, PL, container PL, insurance — no ADH re-layout: Sent/ holds
 *   Vedanta's own PDFs) plus two documents ADH makes, both issued by ASIA DEAL HUB PTE. LTD. (Singapore), in USD:
 *
 *   INVOICE & PACKING LIST  SGJP_IV_PL_HOEI (step 7 slot): the sale invoice SG → Thailand, CIF Laem Chabang —
 *                    INVOICE NO. ADH+yyyymmdd · Issued Date; Shipper (Vedanta) · Consignee: Ship To (Hoei); Notify Party
 *                    (ISEWAN, Hoei's broker); Seller (ADH SG) · Buyer (Hoei); place of receipt / loading (Vedanta's port),
 *                    discharge / delivery (Laem Chabang), origin, vessel "KOTA SELAMAT / 0523E"; one line "PRIMARY
 *                    ALUMINIUM INGOT P1020A / HS CODE : 7601.10 CIF", unit price = LME + QMJP + 60 (Billet Premium),
 *                    amount ROUNDDOWN(qty × unit, 2); PACKING DETAILS (… 152 Bundles HS CODE … · 6688 PCS · net · gross);
 *                    "TOTAL : 152 Bundle only"; Payment Term; Bank Account (CFSB); signature + ADH SG address.
 *                    Sample: INVOICE & PACKING LIST_151.157MT_BL GGVCB26000252.xlsx (sheet "PDF ").
 *   請求書           INVOICE_SINGLE_HOEI_USD (step 11): Japanese invoice from Asia Deal Hub Pte. Ltd. to HOEI METAL
 *                    (THAILAND)Co.,Ltd. 御中 — 番号 (yyyymmdd) · 発行日 (· 再発行日), 件名 "Vedanta P1020 アルミニウムインゴット",
 *                    有効期限, 合計(税込) US$; 摘要 | 数量(MT) | 単価(USD) | 金額(USD) | 備考 (LME / QMJP / premium);
 *                    合計; 条件; 支払い条件 (5 business days); 弊社指定口座. USD only: no JPY columns, no 消費税.
 *                    Sample: 請求書_豊栄メタルThailand様_P1020_99.354T_202606-07修正版.pdf (請求書_Thailand_202606.xlsx).
 *
 * Pure: no Prisma, no Nest. The service feeds the shipment / order / profile facts in.
 */
import { docShell, esc, lines as br, money, qty } from './trade-doc-shell';
import { roundTo } from './trade-invoice';
import { sgjpItemAmount, sgjpTotals, sgjpUnitPrice, SgjpItem } from './trade-logistics-docs';

export const HOEI_IVPL_TEMPLATE = 'SGJP_IV_PL_HOEI';
export const HOEI_INVOICE_TEMPLATE = 'INVOICE_SINGLE_HOEI_USD';
/** Step 4 for Hoei: Vedanta's COA / PL go as received — nothing is generated. */
export const AS_RECEIVED_COA = 'CUSTOMER_COA_AS_RECEIVED';
export const AS_RECEIVED_PL = 'CUSTOMER_PL_AS_RECEIVED';
export const isAsReceived = (k: string | null | undefined) => k === AS_RECEIVED_COA || k === AS_RECEIVED_PL;
export const isHoeiLayout = (h: unknown) => (h as { layout?: unknown } | null)?.layout === 'hoei';

/** The parties ADH prints on Hoei's documents (the customer profile's partyBlocks, editable on the draft). */
export interface HoeiParties {
  consignee: string;
  notify: string;
  buyer: string;
}

// ── INVOICE & PACKING LIST (SG → Thailand) ───────────────────────────────────
export interface HoeiIvPlHeader {
  layout: 'hoei';
  /** "ADH" + yyyymmdd of the issued date (the sheet's formula). */
  invoiceNo: string;
  issuedDate: string;
  shipperBlock: string;
  consigneeBlock: string;
  notifyBlock: string;
  sellerBlock: string;
  buyerBlock: string;
  placeOfReceipt: string;
  portOfLoading: string;
  portOfDischarge: string;
  placeOfDelivery: string;
  payment: string;
  countryOfOrigin: string;
  /** "VESSEL / VOYAGE" — the B/L's vessel (the sheet: 本船のみでOK). */
  vessel: string;
  others: string;
  shippingMarks: string;
  paymentTerm: string;
  bankBlock: string;
  bankId?: string | null;
  signBlock: string;
  currency: string;
  /** YYYY-MM the LME average is taken from (the shipment month). */
  lmeMonth: string;
}

export const HOEI_PAYMENT_TERM = 'Payment within 5 working days after Copy of BL and Invoice';
export const HOEI_HS_CODE = '7601.10';
/** Hoei's price: LME (shipment month average) + QMJP + 60 USD/t Billet Premium (Vedanta charges ADH +5; ADH adds 55). */
export const HOEI_PREMIUM = 60;

/** "PRIMARY ALUMINIUM INGOT P1020A" for P1020 ingot (Vedanta's grade name); other products in capitals. */
export function hoeiGoods(product: string | null | undefined, grade: string | null | undefined): string {
  const g = (grade ?? '').trim().toUpperCase();
  const p = (product ?? '').trim();
  if (/ingot/i.test(p) || /^P1020/.test(g)) return `PRIMARY ALUMINIUM INGOT ${g === 'P1020' ? 'P1020A' : g}`.trim();
  return [p.toUpperCase(), g].filter(Boolean).join(' ');
}

/** "ADH20260925" for 2026-09-25. */
export const hoeiInvoiceNo = (date: string) => `ADH${(date ?? '').replace(/-/g, '').slice(0, 8)}`;
const upper = (v: string | null | undefined) => (v ?? '').toUpperCase().trim();
const portName = (v: string | null | undefined) => {
  const t = upper(v);
  if (!t) return '';
  if (/LAEM\s*CHABANG/.test(t) && !/THAILAND/.test(t)) return 'LAEM CHABANG, THAILAND';
  if (/(GANGAVARAM|VISAKHAPATNAM|VIZAG)/.test(t) && !/INDIA/.test(t)) return `${/VIZAG/.test(t) ? 'VISAKHAPATNAM' : t.replace(/\s*PORT$/, '')} PORT, INDIA`;
  return t;
};

export interface HoeiIvPlInput {
  today: string;
  shipMonth: string | null;
  supplierBlock: string;
  parties: HoeiParties;
  sellerBlock: string;
  signBlock: string;
  bank: { id: string; block: string } | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  countryOfOrigin: string | null;
  vessel: string | null;
  voyageNo: string | null;
  product: string | null;
  grade: string | null;
  hsCode: string | null;
  incoterm: string | null;
  lme: number | null;
  qmjp: number | null;
  premium: number | null;
  netMt: number | null;
  grossMt: number | null;
  bundles: number | null;
  pieces: number | null;
}

/** A new draft's header + its one item, from the shipment / order / profile facts. */
export function hoeiIvPlDraft(i: HoeiIvPlInput): { header: HoeiIvPlHeader; items: SgjpItem[] } {
  const pod = portName(i.portOfDischarge) || 'LAEM CHABANG, THAILAND';
  const pol = portName(i.portOfLoading);
  return {
    header: {
      layout: 'hoei',
      invoiceNo: hoeiInvoiceNo(i.today),
      issuedDate: i.today,
      shipperBlock: i.supplierBlock,
      consigneeBlock: i.parties.consignee,
      notifyBlock: i.parties.notify,
      sellerBlock: i.sellerBlock,
      buyerBlock: i.parties.buyer || i.parties.consignee,
      placeOfReceipt: pol,
      portOfLoading: pol,
      portOfDischarge: pod,
      placeOfDelivery: pod,
      payment: '',
      countryOfOrigin: upper(i.countryOfOrigin) || 'INDIA',
      vessel: [i.vessel, i.voyageNo].filter(Boolean).join(' / ').toUpperCase(),
      others: '',
      shippingMarks: '',
      paymentTerm: HOEI_PAYMENT_TERM,
      bankBlock: i.bank?.block ?? '',
      bankId: i.bank?.id ?? null,
      signBlock: i.signBlock,
      currency: 'USD',
      lmeMonth: i.shipMonth ?? '',
    },
    items: [
      {
        goods: hoeiGoods(i.product, i.grade),
        hsCode: (i.hsCode ?? '').trim() || HOEI_HS_CODE,
        terms: (i.incoterm ?? '').trim() || 'CIF',
        lme: i.lme,
        qmjp: i.qmjp,
        premium: i.premium ?? HOEI_PREMIUM,
        upcharge: null,
        unitPrice: null,
        quantity: i.netMt,
        bundles: i.bundles,
        pieces: i.pieces,
        netMt: i.netMt,
        grossMt: i.grossMt ?? i.netMt,
        dimension: '',
      },
    ],
  };
}

const slash = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '');
  return m ? `${m[1]}/${Number(m[2])}/${Number(m[3])}` : esc(d ?? '');
};
const has = (v: unknown) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const num = (v: unknown) => (has(v) ? Number(v) : null);
const usd = (v: number | null) => (v === null ? '' : `US$${money(v)}`);

/** ADH's sheet "PDF " (A4 portrait): every block boxed, the item and packing tables, payment term, bank and signature. */
export function renderHoeiIvPlHtml(h: HoeiIvPlHeader, items: SgjpItem[], opts: { draft?: boolean } = {}): string {
  const t = sgjpTotals(items);
  const block = (label: string, value: string) => `<div class="lb">${label}</div><div class="v pre">${br(value)}</div>`;
  const notify = (h.notifyBlock ?? '').split(/\r?\n/);
  const body = `
<h1>INVOICE &amp; PACKING LIST</h1>
<table class="box top"><tr><td class="no">INVOICE NO.:&nbsp; ${esc(h.invoiceNo)}</td><td class="dl">Issued Date：</td><td class="dt">${slash(h.issuedDate)}</td></tr></table>
<table class="box parties"><colgroup><col style="width:47%"><col style="width:53%"></colgroup>
  <tr><td>${block('（Shipper)', h.shipperBlock)}</td><td>${block('(Consignee: Ship To)', h.consigneeBlock)}</td></tr>
  <tr><td colspan="2"><div class="v pre"><span class="lb in">（Notify Party)</span>${esc(notify[0] ?? '')}${notify.length > 1 ? `<br>${br(notify.join('\n'))}` : ''}</div></td></tr>
  <tr><td>${block('（Seller)', h.sellerBlock)}</td><td>${block('(Buyer)', h.buyerBlock)}</td></tr>
</table>
<table class="box route">
  <colgroup><col style="width:35.5%"><col style="width:30%"><col style="width:34.5%"></colgroup>
  <tr><td>${block('(Place Of receipt)', upper(h.placeOfReceipt))}</td><td>${block('(Payment)', h.payment)}</td><td rowspan="4" class="marks">${block('(Shipping Marks)', h.shippingMarks)}</td></tr>
  <tr><td>${block('(Port Of Loading)', upper(h.portOfLoading))}</td><td class="ctr">${block('(Country Of Origin)', upper(h.countryOfOrigin))}</td></tr>
  <tr><td>${block('(Port Of Discharge)', upper(h.portOfDischarge))}</td><td class="ctr">${block('(Vessel)', h.vessel)}</td></tr>
  <tr><td>${block('(Place Of Delivery)', upper(h.placeOfDelivery))}</td><td>${block('(Others)', h.others)}</td></tr>
</table>
<table class="grid inv">
  <colgroup><col style="width:10.5%"><col style="width:36.5%"><col style="width:17.5%"><col style="width:15%"><col style="width:20.5%"></colgroup>
  <thead><tr><th>C/No.</th><th>DESCRIPTION</th><th>UNIT PRICE</th><th>QUANTITY</th><th>TOTAL PRICE</th></tr></thead>
  <tbody>${items
    .map(
      (i, k) =>
        `<tr><td class="c">${k + 1}</td><td class="pre mono">${br(i.goods)}<br>HS CODE : ${esc(i.hsCode)}${i.terms ? ` ${esc(i.terms)}` : ''}</td><td class="c mono">${money(sgjpUnitPrice(i))}</td><td class="c mono">${money(num(i.quantity), 3)}</td><td class="num mono">${usd(sgjpItemAmount(i))}</td></tr>`,
    )
    .join('')}
  <tr class="gap"><td></td><td></td><td></td><td></td><td></td></tr>
  <tr class="tot"><td colspan="3">TOTAL</td><td class="num">${money(t.quantity, 3)}</td><td class="num">${usd(t.amount)}</td></tr></tbody>
</table>
<h2>PACKING DETAILS</h2>
<table class="grid pk">
  <colgroup><col style="width:10.5%"><col style="width:23%"><col style="width:13.5%"><col style="width:15%"><col style="width:15%"><col style="width:23%"></colgroup>
  <thead><tr><th>C/No.</th><th>DESCRIPTION</th><th>Q'TY</th><th>Net Weight(MT)</th><th>Gross Weight(MT)</th><th>Dimention</th></tr></thead>
  <tbody>${items
    .map(
      (i, k) =>
        `<tr><td class="c">${k + 1}</td><td class="pre mono">${esc(i.goods)}${has(i.bundles) ? ` ${qty(num(i.bundles))} Bundles` : ''}&nbsp; HS CODE : ${esc(i.hsCode)}</td><td class="c mono">${has(i.pieces) ? `${num(i.pieces)} PCS` : ''}</td><td class="c mono">${money(num(i.netMt), 3)}</td><td class="c mono">${money(num(i.grossMt), 3)}</td><td class="pre">${br(i.dimension)}</td></tr>`,
    )
    .join('')}
  <tr class="gap"><td></td><td></td><td></td><td></td><td></td><td></td></tr>
  <tr class="tot"><td>TOTAL :</td><td class="c">${qty(t.bundles)} Bundle only</td><td></td><td class="c">${money(t.netMt, 3)}</td><td class="c">${money(t.grossMt, 3)}</td><td></td></tr></tbody>
</table>
<div class="pt"><div class="h">Payment Term</div><div class="u">${esc(h.paymentTerm)}</div></div>
<div class="foot">
  <div class="bank"><div class="h">Bank Account</div><div class="pre">${br((h.bankBlock ?? '').replace(/\t/g, '：'))}</div></div>
  <div class="sign pre">${br(h.signBlock)}</div>
</div>`;
  const css = `
body { font-family: Arial, Helvetica, sans-serif; font-size: 9.6pt; line-height: 1.22; }
h1 { text-align: center; font-size: 15.5pt; margin: 2mm 0 4mm; }
h2 { font-size: 10.5pt; margin: 4mm 0 .5mm; }
table.box { width: 100%; table-layout: fixed; }
.box td { border: 1px solid #222; padding: .6mm 1mm; vertical-align: top; }
.top td { font-size: 8pt; border-bottom: none; } .top .no { width: 35.5%; } .top .dl { text-align: right; border-right: none; } .top .dt { width: 19%; text-align: center; font-size: 10.5pt; border-left: 1px solid #222; }
.parties td { height: 1px; }
.lb { font-size: 9.6pt; } .lb.in { margin-right: 1mm; }
.route .lb { font-size: 7.4pt; } .route .v { font-size: 10.5pt; padding-left: 6mm; }
.route td { height: 8.5mm; } .route td.ctr .v { text-align: center; padding-left: 0; } .route td.marks { padding: .6mm 1mm; }
table.grid { width: 100%; table-layout: fixed; }
.grid th { border: 1px solid #222; font-weight: 400; padding: 2mm 1mm; font-size: 9pt; }
.pk th { padding: .6mm 1mm; }
.grid td { border: 1px solid #222; padding: .6mm 1mm; vertical-align: middle; font-size: 9pt; }
.grid td.c { text-align: center; } .grid td.num { text-align: right; }
.grid tr.gap td { height: 4mm; }
.grid tr.tot td { font-size: 10pt; }
.mono { font-family: 'Courier New', monospace; font-size: 8.4pt; line-height: 1.15; }
.pt { margin-top: .5mm; } .pt .h, .bank .h { font-size: 10.5pt; } .pt .u { text-decoration: underline; margin-bottom: 5mm; }
.foot { display: flex; justify-content: space-between; align-items: flex-start; } .bank { flex: 1; }
.bank .pre { line-height: 1.4; font-size: 9pt; }
.sign { width: 75mm; flex: none; margin-top: 20mm; border-top: 1.5px solid #111; padding-top: .5mm; font-size: 9.6pt; line-height: 1.45; }
`;
  return docShell({ title: `INVOICE & PACKING LIST ${h.invoiceNo ?? ''}`.trim(), css, body, draft: opts.draft });
}

export function hoeiIvPlFinalizeProblems(h: HoeiIvPlHeader, items: SgjpItem[]): string[] {
  const p: string[] = [];
  if (!(h.consigneeBlock ?? '').trim()) p.push('enter the Consignee (Hoei)');
  if (!(h.bankBlock ?? '').trim()) p.push('pick the bank account');
  items.forEach((it, i) => {
    if (!(it.goods ?? '').trim() && !has(it.quantity)) return;
    if (sgjpUnitPrice(it) === null) p.push([it.qmjp, it.premium, it.upcharge].some(has) ? `item ${i + 1} needs the LME` : `item ${i + 1} needs a unit price`);
  });
  if (sgjpTotals(items).amount === 0) p.push('the total is US$0.00');
  return p;
}

// ── 請求書 (USD, Asia Deal Hub Pte. Ltd.) ─────────────────────────────────────
export interface HoeiInvoiceHeader {
  layout: 'hoei';
  title: string;
  /** 番号 — default the 発行日 as yyyymmdd. */
  invoiceNo: string | null;
  issueDate: string;
  /** 再発行日 (blank = not printed). */
  reissueDate: string;
  toName: string;
  toSuffix: string;
  fromName: string;
  fromAddress: string;
  subject: string;
  /** 有効期限 (a date). */
  validity: string;
  conditions: string;
  paymentBlock: string;
  /** "2026年7月17日 着金済" — printed bold under the payment terms when filled. */
  paidNote: string;
  bankBlock: string;
  bankId?: string | null;
  lmeMonth: string;
  currency: 'USD';
  dueDate: string;
}

export interface HoeiInvoiceLine {
  description: string;
  quantity: number | null;
  /** Price helper (USD/MT): unit = LME + QMJP + premium, else the typed unit price. */
  lme: number | null;
  qmjp: number | null;
  premium: number | null;
  unitPrice: number | null;
  remarks: string;
  /** Always false: no 消費税 (also read by the payments' invoice total, which treats the row as a goods line). */
  taxable: false;
  shipmentId?: string | null;
  orderId?: string | null;
  grade?: string | null;
}

export function hoeiLineUnit(l: HoeiInvoiceLine): number | null {
  if (has(l.lme)) return roundTo(Number(l.lme) + (num(l.qmjp) ?? 0) + (num(l.premium) ?? 0), 4);
  return num(l.unitPrice);
}
/** The sheet's ROUND(qty × unit, 3), printed to 2 dp. */
export function hoeiLineAmount(l: HoeiInvoiceLine): number {
  const u = hoeiLineUnit(l);
  return u === null || !has(l.quantity) ? 0 : roundTo(roundTo(Number(l.quantity) * u, 3), 2);
}
export const hoeiInvoiceTotal = (rows: HoeiInvoiceLine[]) => roundTo(rows.reduce((a, l) => a + hoeiLineAmount(l), 0), 2);

const ordinalQ = (q: string) => ({ '1': '1st', '2': '2nd', '3': '3rd', '4': '4th' })[q] ?? q;
/** 備考 (単価明細): "LME Cash\n2026/8月平均 3249.63\n+ 3rdQ MJP 395\n+ Billet Premium 60" (the 150 t sheet). */
export function hoeiRemarks(lmeMonth: string, l: Pick<HoeiInvoiceLine, 'lme' | 'qmjp' | 'premium'>): string {
  const m = /^(\d{4})-(\d{2})$/.exec(lmeMonth ?? '');
  const q = m ? String(Math.ceil(Number(m[2]) / 3)) : '';
  return [
    'LME Cash',
    `${m ? `${m[1]}/${Number(m[2])}月平均` : '平均'} ${has(l.lme) ? Number(l.lme) : ''}`.trim(),
    `+ ${q ? `${ordinalQ(q)}Q ` : ''}MJP ${has(l.qmjp) ? Number(l.qmjp) : ''}`.trim(),
    `+ Billet Premium ${has(l.premium) ? Number(l.premium) : ''}`.trim(),
  ].join('\n');
}

export interface HoeiInvoiceInput {
  today: string;
  toName: string;
  fromName: string;
  fromAddress: string;
  bank: { id: string; block: string } | null;
  shipMonth: string | null;
  validity: string;
  dueDate: string;
  lines: Array<{ quantity: number | null; lme: number | null; qmjp: number | null; premium: number | null; product: string | null; grade: string | null; shipmentId?: string | null; orderId?: string | null }>;
}

export function hoeiInvoiceDraft(i: HoeiInvoiceInput): { header: HoeiInvoiceHeader; rows: HoeiInvoiceLine[] } {
  const month = i.shipMonth ?? '';
  const mm = /^(\d{4})-(\d{2})$/.exec(month);
  const rows: HoeiInvoiceLine[] = i.lines.map((l) => {
    const line: HoeiInvoiceLine = {
      description: hoeiGoods(l.product, l.grade).replace(/P1020A$/, 'P1020'),
      quantity: l.quantity,
      lme: l.lme,
      qmjp: l.qmjp,
      premium: l.premium ?? HOEI_PREMIUM,
      unitPrice: null,
      remarks: '',
      taxable: false,
      shipmentId: l.shipmentId ?? null,
      orderId: l.orderId ?? null,
      grade: l.grade ?? null,
    };
    line.remarks = hoeiRemarks(month, line);
    return line;
  });
  const grade = i.lines[0]?.grade ?? 'P1020';
  return {
    header: {
      layout: 'hoei',
      title: '請 求 書',
      invoiceNo: null,
      issueDate: i.today,
      reissueDate: '',
      toName: i.toName,
      toSuffix: '御中',
      fromName: i.fromName,
      fromAddress: i.fromAddress,
      subject: `Vedanta ${grade} アルミニウムインゴット`,
      validity: i.validity,
      conditions: `・アルミニウムインゴットの価格は、${mm ? `${Number(mm[2])}月` : '船積み月'}平均LME Cash により決定\n･CIF Leamchabang`,
      paymentBlock: '・請求書受領後営業日　5日以内　下記指定口座振込',
      paidNote: '',
      bankBlock: i.bank?.block ?? '',
      bankId: i.bank?.id ?? null,
      lmeMonth: month,
      currency: 'USD',
      dueDate: i.dueDate,
    },
    rows,
  };
}

export function toHoeiLines(rows: unknown): HoeiInvoiceLine[] {
  return (Array.isArray(rows) ? rows : []).map((r: any) => ({
    description: String(r?.description ?? ''),
    quantity: num(r?.quantity),
    lme: num(r?.lme),
    qmjp: num(r?.qmjp),
    premium: num(r?.premium),
    unitPrice: num(r?.unitPrice),
    remarks: String(r?.remarks ?? ''),
    taxable: false as const,
    shipmentId: r?.shipmentId ?? null,
    orderId: r?.orderId ?? null,
    grade: r?.grade ?? null,
  }));
}

export function hoeiInvoiceFinalizeProblems(h: HoeiInvoiceHeader, rows: HoeiInvoiceLine[]): string[] {
  const p: string[] = [];
  rows.forEach((l, i) => {
    if (!l.description.trim() && !has(l.quantity)) return;
    if (hoeiLineUnit(l) === null) p.push(has(l.qmjp) || has(l.premium) ? `line ${i + 1} needs the LME` : `line ${i + 1} needs a unit price`);
  });
  if (!(h.bankBlock ?? '').trim()) p.push('pick the bank account (弊社指定口座)');
  if (hoeiInvoiceTotal(rows) === 0) p.push('the total is US$0.00');
  return p;
}

/** "label<TAB>value" bank lines print as two columns (as the sheet: Bank address / Routing number …). */
const bankRows = (text: string) =>
  (text ?? '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      const m = /^(Bank address|Routing number|Bank SWIFT\/BIC|Beneficially name)\s*[:：\t]\s*(.*)$/i.exec(l.trim());
      const [k, ...v] = m ? [m[1], m[2]] : l.split('\t');
      return v.length ? `<tr><td class="bk">${esc(k.trim())}</td><td>${esc(v.join(' ').trim())}</td></tr>` : `<tr><td colspan="2">${esc(l.trim())}</td></tr>`;
    })
    .join('');

export function renderHoeiInvoiceHtml(h: HoeiInvoiceHeader, rows: HoeiInvoiceLine[], opts: { draft?: boolean } = {}): string {
  const total = hoeiInvoiceTotal(rows);
  const no = h.invoiceNo?.trim() || (/^(\d{4})-(\d{2})-(\d{2})/.test(h.issueDate ?? '') ? h.issueDate.replace(/-/g, '').slice(0, 8) : '（確定時に採番）');
  const tr = rows
    .map(
      (l) =>
        `<tr class="ln"><td class="desc pre">${br(l.description)}</td><td class="num">${has(l.quantity) ? money(Number(l.quantity), 3) : ''}</td><td class="num">${money(hoeiLineUnit(l))}</td><td class="num">${money(hoeiLineAmount(l))}</td><td class="rem pre">${br(l.remarks)}</td></tr>`,
    )
    .join('');
  const body = `
<div class="meta"><div><span class="k">番号：</span>${esc(no)}</div><div><span class="k">発行日：</span>${slash(h.issueDate)}</div>${h.reissueDate ? `<div><span class="k">再発行日：</span>${slash(h.reissueDate)}</div>` : ''}</div>
<div class="title">${esc(h.title || '請 求 書')}</div>
<div class="to">${esc(h.toName)}&nbsp; ${esc(h.toSuffix || '御中')}</div>
<div class="mid">
  <table class="hd"><tr><th>件名：</th><td>${esc(h.subject)}</td></tr><tr><th>有効期限：</th><td class="small">${slash(h.validity)}</td></tr></table>
  <div class="from"><div class="fn">${esc(h.fromName)}</div><div class="pre">${br(h.fromAddress)}</div></div>
</div>
<div class="sum"><span>合計(税込)</span><span>US$${money(total)}</span></div>
<table class="grid">
  <colgroup><col style="width:39%"><col style="width:10.5%"><col style="width:13%"><col style="width:15%"><col style="width:22.5%"></colgroup>
  <thead><tr><th>摘要</th><th>数量(MT)</th><th>単価(USD)</th><th>金額(USD)</th><th>備考(単価明細)</th></tr></thead>
  <tbody>${tr}<tr class="blank"><td></td><td></td><td></td><td></td><td></td></tr>
  <tr class="tot"><td class="none"></td><td class="none"></td><td class="lb">合計</td><td class="num">${money(total)}</td><td class="none"></td></tr></tbody>
</table>
<div class="sec"><div class="h">条件</div><div class="pre sm">${br(h.conditions)}</div></div>
<div class="sec"><div class="sm">支払い条件</div><div class="pre sm">${br(h.paymentBlock)}</div>${h.paidNote ? `<div class="paid">${esc(h.paidNote)}</div>` : ''}</div>
<div class="sec"><div class="sm">弊社指定口座</div><table class="bank">${bankRows(h.bankBlock)}</table></div>`;
  const css = `
body { font-size: 9.5pt; }
.meta { margin-left: auto; width: 46mm; font-size: 8.2pt; line-height: 2; }
.meta .k { display: inline-block; width: 16mm; text-align: right; }
.title { text-align: center; font-size: 15pt; font-weight: 700; letter-spacing: .3em; margin: 7mm 0 6mm; }
.to { font-weight: 700; font-size: 11pt; margin-bottom: 9mm; }
.mid { display: flex; justify-content: space-between; align-items: flex-start; }
table.hd { margin-top: 9mm; } .hd th { text-align: left; font-weight: 400; width: 30mm; padding: 1.2mm 0; } .hd td.small { font-size: 8.2pt; }
.from { text-align: right; line-height: 2.1; font-size: 10.5pt; } .from .fn { margin-bottom: 4mm; }
.sum { display: inline-flex; gap: 10mm; border-bottom: 1px solid #111; font-size: 11.5pt; padding: 0 2mm .5mm 0; margin: 1mm 0 6mm; min-width: 70mm; }
table.grid { width: 100%; table-layout: fixed; }
.grid th { border: 1px solid #111; font-weight: 400; padding: 2.4mm 1mm; font-size: 10.5pt; }
.grid td { border: 1px solid #111; padding: 1mm; vertical-align: middle; }
.grid tr.ln td { height: 18mm; } .grid td.desc { font-size: 10.5pt; } .grid td.num { font-size: 11pt; text-align: right; }
.grid td.rem { font-size: 8pt; line-height: 1.5; vertical-align: top; }
.grid tr.blank td { height: 5mm; }
.grid td.none { border: none; } .grid tr.tot td.lb { text-align: right; } .grid tr.tot td { font-size: 10.5pt; }
.sec { margin-top: 6mm; } .sec .h { font-size: 10.5pt; } .sm { font-size: 8pt; line-height: 1.6; }
.paid { font-size: 8pt; font-weight: 700; }
table.bank { margin-top: 4mm; font-size: 8pt; line-height: 1.7; } .bank td.bk { width: 38mm; padding-right: 2mm; }
`;
  return docShell({ title: `請求書 ${no}`, css, body, draft: opts.draft });
}

/** Hoei's party blocks from the customer profile, else the customer's master record (name + address). */
export function hoeiParties(profile: { partyBlocks?: Partial<HoeiParties> | null } | null | undefined, customer: { name?: string | null; address?: string | null } | null | undefined): HoeiParties {
  const master = [customer?.name, customer?.address].filter(Boolean).join('\n');
  const pb = profile?.partyBlocks ?? {};
  const consignee = (pb.consignee ?? '').trim() || master;
  return { consignee, buyer: (pb.buyer ?? '').trim() || consignee, notify: (pb.notify ?? '').trim() };
}
