/**
 * Round AG (2026-10-24, ADH) — the "Monthly order list" in the shape of ADH's own spreadsheet. Pure.
 *
 * One block per client (Kato, SUS, Hoei, then the others A→Z), one row per shipment; an order with no shipment yet is
 * one row with empty shipment cells; an order with several B/Ls is several rows whose order / supplier cells are shown
 * on the first row only (the merged look). Three column groups, in their order:
 *   Order information     Client · Order No. · Order Date · Billet Type · Supplier · Ton · Shipment Month · Delivery Month · Status
 *   Supplier information  Supplier Contract No · Order Date · Order ton · Status
 *   Shipment information  Order Status · 管理NO · BL Number · ETD · ETA
 * Both "Status" columns are COMPUTED (order status; PI / CI payment from steps 1 and 6) — ADH's sheet colours them
 * yellow, so does the export. 管理NO is ADH's number for the client order: #n-s per shipment (#n on an order without one);
 * Order No. is then the customer's PO no. when AIMS has it, else #n.
 */
export type MonthBasis = 'delivery' | 'ship';
export type OrderStatusWord = 'Open' | 'Completed' | 'Unconfirmed';

export interface StepFact {
  code: string;
  status: string;
  notApplicable?: boolean | null;
}
export interface ShipmentFact {
  id: string;
  seqNo: number | null;
  status: string;
  blNumber: string | null;
  etd: Date | string | null;
  eta: Date | string | null;
  deliveryMonth: string | null;
  /** The current step's label ("9. Send arrival notice …") and id, or null when every step is done. */
  currentStep: { id: string | null; label: string; code: string } | null;
  ciPayment: StepFact[];
}
export interface OrderFact {
  id: string;
  orderNo: number;
  status: string;
  checkFields: string[];
  customerId: string;
  customerName: string;
  /** The customer's own PO no. (Order No. when set). */
  customerPoNo: string | null;
  /** Profile key (KATO / SUS / HOEI) when the customer has a profile. */
  customerKey: string | null;
  supplierName: string;
  customerPoDate: Date | string | null;
  grade: string | null;
  size: string | null;
  qtyMt: number | null;
  shipMonth: string | null;
  deliveryMonth: string | null;
  supplierContractNo: string | null;
  piDate: Date | string | null;
  piQtyMt: number | null;
  /** The supplier order (or order) is COMPLETED. */
  supplierDone: boolean;
  piPayment: StepFact[];
  /** The order's first open step id (the deep link of an order row without a shipment). */
  currentStepId: string | null;
  shipments: ShipmentFact[];
}

/** Customer Order Date: the customer's PO date only, else blank. Never the supplier PI date (that shows only in the
 * Supplier "Order Date" column) and never the date AIMS created the order (imported orders would show the import day).
 * The ADH task-list import carries no order date. */
export function orderDateOf(o: Pick<OrderFact, 'customerPoDate'>): Date | string | null {
  return o.customerPoDate ?? null;
}

export interface MonthlyRow {
  orderId: string;
  shipmentId: string | null;
  /** Deep link target: the step to open (the shipment's current step, else the order's). */
  stepId: string | null;
  /** First row of its order — the order / supplier cells are shown on it only. */
  first: boolean;
  /** Rows of this order (the merge height). */
  span: number;
  client: string;
  orderNo: string;
  shipmentRef: string | null;
  orderDate: string | null;
  billetType: string;
  supplier: string;
  ton: number | null;
  shipMonth: string | null;
  deliveryMonth: string | null;
  orderStatus: OrderStatusWord;
  supplierContractNo: string | null;
  supplierOrderDate: string | null;
  supplierTon: number | null;
  supplierStatus: string;
  shipmentStatus: string | null;
  managementNo: string | null;
  blNumber: string | null;
  etd: string | null;
  eta: string | null;
  /** The row's month for the filter (shipment's delivery month, else the order's; ship basis: the order's ship month). */
  month: string | null;
}
export interface MonthlyBlock {
  client: string;
  rows: MonthlyRow[];
  orders: number;
  tons: number;
}

export interface MonthlyFilter {
  from: string;
  to: string;
  basis: MonthBasis;
  customerId?: string | null;
  supplier?: string | null;
  grade?: string | null;
  status?: OrderStatusWord | null;
}

const CLIENT_ORDER = ['KATO', 'SUS', 'HOEI'];
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "2026-10" + n months. */
export function addMonth(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
/** The default window: the current delivery month and the next two. */
export function defaultMonths(today: string): { from: string; to: string } {
  const from = today.slice(0, 7);
  return { from, to: addMonth(from, 2) };
}
export function cleanMonths(from: string | null | undefined, to: string | null | undefined, today: string): { from: string; to: string } {
  const d = defaultMonths(today);
  let f = YM.test(from ?? '') ? from! : d.from;
  let t = YM.test(to ?? '') ? to! : YM.test(from ?? '') ? from! : d.to;
  if (t < f) [f, t] = [t, f];
  return { from: f, to: t };
}

const day = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const x = typeof d === 'string' ? new Date(d) : d;
  return Number.isNaN(x.getTime()) ? null : x.toISOString().slice(0, 10);
};
/** "Vedanta Limited" → "Vedanta", "PT Sri Indah Aluminium Extrusion" → "SIAE". */
export function shortSupplier(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  if (/vedanta/i.test(n)) return 'Vedanta';
  if (/siae|sri indah/i.test(n)) return 'SIAE';
  if (/mind id/i.test(n)) return 'MIND ID';
  if (/inalum/i.test(n)) return 'Inalum';
  return n.replace(/\b(pte\.?|ltd\.?|limited|co\.?,?|inc\.?|llc|株式会社|合同会社)\b/gi, '').replace(/\s+/g, ' ').trim() || n;
}
/** The client's block name: "Kato" / "SUS" / "Hoei" for the profile keys, else the customer's short name. */
export function clientName(key: string | null, name: string): string {
  if (key === 'KATO') return 'Kato';
  if (key === 'SUS') return 'SUS';
  if (key === 'HOEI') return 'Hoei';
  return name.replace(/\b(株式会社|合同会社|co\.?,?\s*ltd\.?|corporation|corp\.?|inc\.?)\b/gi, '').replace(/\s+/g, ' ').trim() || name;
}
const clientRank = (key: string | null) => {
  const i = CLIENT_ORDER.indexOf(key ?? '');
  return i < 0 ? CLIENT_ORDER.length : i;
};

export const orderStatusWord = (o: Pick<OrderFact, 'status' | 'checkFields'>): OrderStatusWord => (o.status === 'COMPLETED' ? 'Completed' : (o.checkFields ?? []).includes('status') ? 'Unconfirmed' : 'Open');

const live = (s: StepFact[]) => s.filter((x) => !x.notApplicable);
const done = (s: StepFact[]) => s.length > 0 && s.every((x) => x.status === 'DONE');
/** Supplier status from steps 1 (PI payment) and 6 (CI payment): "PI open" → "PI paid" → "CI paid 1/2" → "CI paid" → "Done". */
export function supplierStatus(o: Pick<OrderFact, 'supplierDone' | 'piPayment' | 'shipments'>): string {
  if (o.supplierDone) return 'Done';
  const ci = o.shipments.filter((s) => s.status !== 'CANCELLED').map((s) => live(s.ciPayment)).filter((s) => s.length);
  const ciDone = ci.filter(done).length;
  if (ci.length && ciDone === ci.length) return 'CI paid';
  if (ciDone > 0) return `CI paid ${ciDone}/${ci.length}`;
  const pi = live(o.piPayment);
  if (pi.length && done(pi)) return 'PI paid';
  if (!pi.length && !ci.length) return '—';
  return 'PI open';
}
/** Shipment status in short words: the current step ("9. Send arrival notice") or "Delivered" once every step is done. */
export function shipmentStatus(s: ShipmentFact): string {
  if (s.status === 'COMPLETED' || !s.currentStep) return 'Delivered';
  return s.currentStep.label.replace(/\s*\(.*?\)\s*$/, '');
}

/** The rows of the list, grouped by client, filtered by the month window and the filters. Test / cancelled orders are the caller's to drop. */
export function buildMonthlyList(orders: OrderFact[], f: MonthlyFilter): MonthlyBlock[] {
  const rows: Array<MonthlyRow & { rank: number; sortNo: number }> = [];
  for (const o of orders) {
    const status = orderStatusWord(o);
    if (f.customerId && o.customerId !== f.customerId) continue;
    if (f.supplier && shortSupplier(o.supplierName).toLowerCase() !== f.supplier.toLowerCase() && o.supplierName.toLowerCase() !== f.supplier.toLowerCase()) continue;
    if (f.grade && !(o.grade ?? '').toLowerCase().startsWith(f.grade.toLowerCase())) continue;
    if (f.status && status !== f.status) continue;
    const ships = o.shipments.filter((s) => s.status !== 'CANCELLED').sort((a, b) => (a.seqNo ?? 0) - (b.seqNo ?? 0));
    const monthOf = (s: ShipmentFact | null) => (f.basis === 'ship' ? o.shipMonth : (s?.deliveryMonth ?? o.deliveryMonth));
    const inWindow = (m: string | null) => !!m && m >= f.from && m <= f.to;
    const kept = ships.filter((s) => inWindow(monthOf(s)));
    const list: Array<ShipmentFact | null> = ships.length ? kept : inWindow(monthOf(null)) ? [null] : [];
    if (!list.length) continue;
    const client = clientName(o.customerKey, o.customerName);
    const base = {
      orderId: o.id,
      client,
      orderNo: o.customerPoNo?.trim() || `#${o.orderNo}`,
      orderDate: day(orderDateOf(o)),
      billetType: [o.grade, o.size].filter(Boolean).join(' ') || '—',
      supplier: shortSupplier(o.supplierName),
      ton: o.qtyMt,
      shipMonth: o.shipMonth,
      deliveryMonth: o.deliveryMonth,
      orderStatus: status,
      supplierContractNo: o.supplierContractNo,
      supplierOrderDate: day(o.piDate),
      supplierTon: o.piQtyMt,
      supplierStatus: supplierStatus(o),
    };
    list.forEach((s, i) =>
      rows.push({
        ...base,
        shipmentId: s?.id ?? null,
        stepId: s ? (s.currentStep?.id ?? null) : o.currentStepId,
        first: i === 0,
        span: list.length,
        shipmentRef: s ? `#${o.orderNo}${s.seqNo ? `-${s.seqNo}` : ''}` : null,
        shipmentStatus: s ? shipmentStatus(s) : null,
        managementNo: s ? `#${o.orderNo}${s.seqNo ? `-${s.seqNo}` : ''}` : `#${o.orderNo}`,
        blNumber: s?.blNumber ?? null,
        etd: day(s?.etd),
        eta: day(s?.eta),
        month: monthOf(s),
        rank: clientRank(o.customerKey),
        sortNo: o.orderNo,
      }),
    );
  }
  const blocks = new Map<string, { rank: number; rows: typeof rows }>();
  for (const r of rows) {
    const b = blocks.get(r.client) ?? { rank: r.rank, rows: [] };
    b.rows.push(r);
    blocks.set(r.client, b);
  }
  return [...blocks.entries()]
    .sort(([a, x], [b, y]) => x.rank - y.rank || a.localeCompare(b))
    .map(([client, b]) => {
      // Orders by delivery month, then order no.; an order's rows stay together in seq order.
      const ordered = [...b.rows].sort((p, q) => (p.deliveryMonth ?? '').localeCompare(q.deliveryMonth ?? '') || p.sortNo - q.sortNo || Number(q.first) - Number(p.first) || (p.shipmentRef ?? '').localeCompare(q.shipmentRef ?? '', undefined, { numeric: true }));
      const clean = ordered.map(({ rank: _r, sortNo: _s, ...r }) => r);
      const firsts = clean.filter((r) => r.first);
      return { client, rows: clean, orders: firsts.length, tons: Math.round(firsts.reduce((a, r) => a + (r.ton ?? 0), 0) * 1000) / 1000 };
    });
}

// ── their layout: headers, CSV ──────────────────────────────────────────────

export const GROUPS = [
  { title: 'Order information', cols: 9 },
  { title: 'Supplier information', cols: 4 },
  { title: 'Shipment information', cols: 5 },
] as const;
export const HEADERS = ['Client', 'Order No.', 'Order Date', 'Billet Type', 'Supplier', 'Ton', 'Shipment Month', 'Delivery Month', 'Status', 'Supplier Contract No', 'Order Date', 'Order ton', 'Status', 'Order Status', '管理NO', 'BL Number', 'ETD', 'ETA'] as const;
/** The 0-based columns ADH colours yellow (the two Status columns). */
export const YELLOW_COLS = [8, 12];

const monthLabel = (ym: string | null) => {
  if (!ym || !YM.test(ym)) return ym ?? '';
  const [y, m] = ym.split('-').map(Number);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
};
export { monthLabel };

/** One row's cells in their column order; the order / supplier cells empty on the follow-on rows of an order. */
export function rowCells(r: MonthlyRow): Array<string | number | null> {
  const o = r.first;
  return [
    o ? r.client : null,
    o ? r.orderNo : null,
    o ? r.orderDate : null,
    o ? r.billetType : null,
    o ? r.supplier : null,
    o ? r.ton : null,
    o ? monthLabel(r.shipMonth) : null,
    o ? monthLabel(r.deliveryMonth) : null,
    o ? r.orderStatus : null,
    o ? r.supplierContractNo : null,
    o ? r.supplierOrderDate : null,
    o ? r.supplierTon : null,
    o ? r.supplierStatus : null,
    r.shipmentStatus,
    r.managementNo,
    r.blNumber,
    r.etd,
    r.eta,
  ];
}

const csvCell = (v: string | number | null) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** CSV in their layout: the group row, the header row, then each client's block (a block title row, its rows). UTF-8 with BOM (Excel opens Japanese right). */
export function monthlyCsv(blocks: MonthlyBlock[]): string {
  const lines: string[] = [];
  const group: string[] = [];
  for (const g of GROUPS) group.push(g.title, ...Array(g.cols - 1).fill(''));
  lines.push(group.map(csvCell).join(','));
  lines.push(HEADERS.map(csvCell).join(','));
  for (const b of blocks) {
    lines.push(csvCell(b.client));
    for (const r of b.rows) lines.push(rowCells(r).map(csvCell).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** The WhatsApp summary: "Monthly list Nov 2026: 9 orders · 1,260 t" + one line per client. */
export function monthlySummary(blocks: MonthlyBlock[], f: Pick<MonthlyFilter, 'from' | 'to' | 'basis'>, lang: 'en' | 'ja' = 'en'): string {
  const range = f.from === f.to ? monthLabel(f.from) : `${monthLabel(f.from)} – ${monthLabel(f.to)}`;
  const orders = blocks.reduce((a, b) => a + b.orders, 0);
  const tons = blocks.reduce((a, b) => a + b.tons, 0);
  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 });
  const basis = f.basis === 'ship' ? (lang === 'ja' ? '出荷月' : 'shipment month') : lang === 'ja' ? '納入月' : 'delivery month';
  if (!orders) return lang === 'ja' ? `月次注文リスト ${range}（${basis}）: 該当する注文はありません。` : `Monthly order list ${range} (${basis}): no orders.`;
  const head = lang === 'ja' ? `月次注文リスト ${range}（${basis}）: 注文 ${orders} 件 · ${fmt(tons)} t` : `Monthly order list ${range} (${basis}): ${orders} order${orders === 1 ? '' : 's'} · ${fmt(tons)} t`;
  const lines = blocks.map((b) => {
    const open = b.rows.filter((r) => r.first && r.orderStatus !== 'Completed').length;
    return lang === 'ja' ? `${b.client}: ${b.orders} 件 · ${fmt(b.tons)} t（未完了 ${open} 件）` : `${b.client}: ${b.orders} order${b.orders === 1 ? '' : 's'} · ${fmt(b.tons)} t (${open} open)`;
  });
  return [head, '', ...lines].join('\n');
}
