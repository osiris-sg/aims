/**
 * Round AM (2026-10-26, ADH) — the plain-word statuses of the Monthly view (and the Clients pages), computed from the
 * steps; nobody types them. One value per row (a shipment, or an order without one):
 *
 *   Order status     Waiting for shipment → Invoice #1 to send (SUS) → In transit → Docs sent, waiting for schedule →
 *                    Arrived, arranging delivery → Delivered → Final invoice / Xero → Completed
 *   Supplier status  PI received → Deposit paid → Shipped (B/L issued) → CI received → Balance paid → Done
 *
 * Evidence per stage (first match from the end of the flow wins):
 *   Completed          the order is COMPLETED (or every step of the order and its shipments is done)
 *   Final invoice/Xero every live shipment is delivered and step 11 (invoice) or 13 (Xero) is still open
 *   Delivered          this shipment: its record is COMPLETED or step 12 (transport & storage paid) is done
 *   Arrived            actual arrival / discharge date, step 9 or 10 done, or the latest ETA has passed
 *   Docs sent          step 5 (documents sent & schedule asked) is done
 *   Invoice #1 to send shipped, not delivered, and step 2 (Invoice #1) open and applicable (two-stage customers: SUS)
 *   In transit         B/L issued: a B/L no. and (step 3a done or the ETD has passed)
 *   Waiting            anything earlier, and an order without a shipment
 * Supplier side: Done = the supplier order (or the order) is COMPLETED; Balance paid = step 6 (CI payment) done;
 * CI received = the shipment has its CI no. / amount or step 3b is done; Shipped = as In transit; Deposit paid = step 1
 * done; PI received = a PI no. or date. A supplier without a PI (step 1 N/A) skips the PI stages ("—" before shipping).
 * Pure: no Prisma, no Nest.
 */

export type OrderStage = 'WAITING_SHIPMENT' | 'INVOICE_1_TO_SEND' | 'IN_TRANSIT' | 'DOCS_SENT' | 'ARRIVED' | 'DELIVERED' | 'FINAL_INVOICE' | 'COMPLETED';
export type SupplierStage = 'NONE' | 'PI_RECEIVED' | 'DEPOSIT_PAID' | 'SHIPPED' | 'CI_RECEIVED' | 'BALANCE_PAID' | 'DONE';
export type StageLang = 'en' | 'ja';

export const ORDER_STAGES: OrderStage[] = ['WAITING_SHIPMENT', 'INVOICE_1_TO_SEND', 'IN_TRANSIT', 'DOCS_SENT', 'ARRIVED', 'DELIVERED', 'FINAL_INVOICE', 'COMPLETED'];
export const SUPPLIER_STAGES: SupplierStage[] = ['NONE', 'PI_RECEIVED', 'DEPOSIT_PAID', 'SHIPPED', 'CI_RECEIVED', 'BALANCE_PAID', 'DONE'];

export const ORDER_STAGE_LABELS: Record<OrderStage, Record<StageLang, string>> = {
  WAITING_SHIPMENT: { en: 'Waiting for shipment', ja: '出荷待ち' },
  INVOICE_1_TO_SEND: { en: 'Invoice #1 to send', ja: '請求書#1 送付待ち' },
  IN_TRANSIT: { en: 'In transit', ja: '輸送中' },
  DOCS_SENT: { en: 'Docs sent, waiting for schedule', ja: '書類送付済・納入日程待ち' },
  ARRIVED: { en: 'Arrived, arranging delivery', ja: '到着・配送手配中' },
  DELIVERED: { en: 'Delivered', ja: '納入済' },
  FINAL_INVOICE: { en: 'Final invoice / Xero', ja: '最終請求・Xero' },
  COMPLETED: { en: 'Completed', ja: '完了' },
};
export const SUPPLIER_STAGE_LABELS: Record<SupplierStage, Record<StageLang, string>> = {
  NONE: { en: '—', ja: '—' },
  PI_RECEIVED: { en: 'PI received', ja: 'PI受領' },
  DEPOSIT_PAID: { en: 'Deposit paid', ja: '前払金支払済' },
  SHIPPED: { en: 'Shipped (B/L issued)', ja: '出荷済（B/L発行）' },
  CI_RECEIVED: { en: 'CI received', ja: 'CI受領' },
  BALANCE_PAID: { en: 'Balance paid', ja: '残金支払済' },
  DONE: { en: 'Done', ja: '完了' },
};

export interface StageStep {
  code: string;
  status: string;
  notApplicable?: boolean | null;
}
export interface StageShipment {
  status: string;
  blNumber: string | null;
  etd: Date | string | null;
  eta: Date | string | null;
  actualArrivalDate?: Date | string | null;
  dischargeDate?: Date | string | null;
  ciNumber?: string | null;
  ciAmount?: number | null;
  steps: StageStep[];
}
export interface StageOrder {
  status: string;
  piNo?: string | null;
  piDate?: Date | string | null;
  /** The supplier order (or the order itself when it has none) is COMPLETED. */
  supplierDone: boolean;
  /** Order-level steps (supplier order's 0 / 1 and the order's 2, 11, 13). */
  steps: StageStep[];
  /** Every live (non-cancelled) shipment of the order — Final invoice waits for all of them. */
  shipments: StageShipment[];
}

const dayOf = (d: Date | string | null | undefined) => {
  if (!d) return null;
  const x = typeof d === 'string' ? new Date(d) : d;
  return Number.isNaN(x.getTime()) ? null : x.toISOString().slice(0, 10);
};
const step = (steps: StageStep[], code: string) => steps.filter((s) => s.code === code && !s.notApplicable);
/** Done: the step exists, applies and every row of it is DONE. */
const isDone = (steps: StageStep[], code: string) => {
  const s = step(steps, code);
  return s.length > 0 && s.every((x) => x.status === 'DONE');
};
/** Open: the step applies and is not done (absent or N/A = not open). */
const isOpen = (steps: StageStep[], code: string) => {
  const s = step(steps, code);
  return s.length > 0 && s.some((x) => x.status !== 'DONE');
};

export function shipped(s: StageShipment, today: string): boolean {
  if (!s.blNumber?.trim()) return false;
  const etd = dayOf(s.etd);
  return isDone(s.steps, 'BL_DRAFT_APPROVAL') || (!!etd && etd <= today);
}
export function delivered(s: StageShipment): boolean {
  return s.status === 'COMPLETED' || isDone(s.steps, 'LOGISTICS_PAYMENT');
}
export function arrived(s: StageShipment, today: string): boolean {
  if (dayOf(s.actualArrivalDate) || dayOf(s.dischargeDate)) return true;
  if (isDone(s.steps, 'AN_INSTRUCTIONS') || isDone(s.steps, 'IMPORT_PERMIT')) return true;
  const eta = dayOf(s.eta);
  return !!eta && eta <= today && shipped(s, today);
}

/** The order status of one row: the shipment `s` of order `o`, or the order alone (s = null). */
export function orderStage(o: StageOrder, s: StageShipment | null, today: string): OrderStage {
  if (o.status === 'COMPLETED') return 'COMPLETED';
  const live = o.shipments.filter((x) => x.status !== 'CANCELLED');
  if (!s) return 'WAITING_SHIPMENT';
  if (delivered(s)) {
    if (!live.every(delivered)) return 'DELIVERED';
    return isOpen(o.steps, 'INVOICE_2') || isOpen(o.steps, 'XERO_HANDOFF') || isOpen(o.steps, 'INVOICE_1') ? 'FINAL_INVOICE' : 'COMPLETED';
  }
  if (!shipped(s, today)) return 'WAITING_SHIPMENT';
  if (isOpen(o.steps, 'INVOICE_1')) return 'INVOICE_1_TO_SEND';
  if (arrived(s, today)) return 'ARRIVED';
  if (isDone(s.steps, 'SEND_DOCS_SCHEDULE')) return 'DOCS_SENT';
  return 'IN_TRANSIT';
}

/** The supplier status of one row (see the header). */
export function supplierStage(o: StageOrder, s: StageShipment | null, today: string): SupplierStage {
  if (o.supplierDone || o.status === 'COMPLETED') return 'DONE';
  if (s) {
    if (isDone(s.steps, 'CI_PAYMENT')) return 'BALANCE_PAID';
    if (s.ciNumber?.trim() || (s.ciAmount !== null && s.ciAmount !== undefined) || isDone(s.steps, 'SHIPPING_DOCS')) return 'CI_RECEIVED';
    if (shipped(s, today)) return 'SHIPPED';
  }
  if (isDone(o.steps, 'PI_PAYMENT')) return 'DEPOSIT_PAID';
  if (o.piNo?.trim() || dayOf(o.piDate)) return 'PI_RECEIVED';
  return 'NONE';
}

export const orderStageLabel = (s: OrderStage, lang: StageLang = 'en') => ORDER_STAGE_LABELS[s][lang];
export const supplierStageLabel = (s: SupplierStage, lang: StageLang = 'en') => SUPPLIER_STAGE_LABELS[s][lang];
