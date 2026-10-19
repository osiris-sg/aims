/**
 * Warehouse stock (2026-10): SUS plans 400t from December, stored 3–6 periods
 * at Mitsui Soko. Per shipment: bundles in (the PL / B/L) − bundles delivered
 * (出庫・納入依頼書 rows marked delivered) = in stock; storage is billed per
 * 期 (half-month period: 1st–15th, 16th–end), every period started counts.
 * Pure.
 */

export interface SiRowLike {
  bundles?: number | string | null;
  delivered?: boolean | null;
  deliveryDate?: string | null;
}

/** Bundles delivered: the SI rows marked delivered. */
export function deliveredBundles(rows: unknown): number {
  const list = (Array.isArray(rows) ? rows : []) as SiRowLike[];
  return list.filter((r) => r?.delivered === true).reduce((s, r) => s + (Number(r.bundles) || 0), 0);
}

/** The 期 (half-month) index of a date: 2 per month since year 0. */
const periodIndex = (d: Date) => (d.getUTCFullYear() * 12 + d.getUTCMonth()) * 2 + (d.getUTCDate() <= 15 ? 0 : 1);

/** Storage periods (期) from the storage start to `until`, both included — every period started counts. */
export function storagePeriods(start: Date | string | null | undefined, until: Date | string): number {
  if (!start) return 0;
  const a = new Date(start);
  const b = new Date(until);
  if (isNaN(a.getTime()) || isNaN(b.getTime()) || b < a) return 0;
  return periodIndex(b) - periodIndex(a) + 1;
}

export interface StockLine {
  shipmentId: string;
  ref: string;
  blNumber: string | null;
  customerName: string | null;
  warehouse: string;
  bundlesIn: number | null;
  bundlesDelivered: number;
  bundlesInStock: number | null;
  netMtIn: number | null;
  /** Net MT still in stock, pro rata by bundles. */
  netMtInStock: number | null;
  storageStartDate: string | null;
  periods: number;
  /** Storage fee estimate: periods × MT in stock × rate (JPY per MT per 期). */
  storageFeeEstimate: number | null;
}

export function stockLine(
  s: { id: string; ref: string; blNumber: string | null; customerName: string | null; warehouse: string | null; port: string | null; totalBundles: number | null; netWeightMt: number | null; storageStartDate: Date | null; siRows: unknown[] },
  today: string,
  ratePerMtPerPeriod: number,
): StockLine {
  const delivered: number = s.siRows.reduce<number>((sum, rows) => sum + deliveredBundles(rows), 0);
  const inStock = s.totalBundles === null ? null : Math.max(0, s.totalBundles - delivered);
  const netInStock = s.netWeightMt === null || !s.totalBundles || inStock === null ? null : Math.round(((s.netWeightMt * inStock) / s.totalBundles) * 1000) / 1000;
  const periods = storagePeriods(s.storageStartDate, today);
  return {
    shipmentId: s.id,
    ref: s.ref,
    blNumber: s.blNumber,
    customerName: s.customerName,
    warehouse: s.warehouse || (s.port ? `Mitsui Soko ${s.port}` : 'Mitsui Soko'),
    bundlesIn: s.totalBundles,
    bundlesDelivered: delivered,
    bundlesInStock: inStock,
    netMtIn: s.netWeightMt,
    netMtInStock: netInStock,
    storageStartDate: s.storageStartDate ? s.storageStartDate.toISOString().slice(0, 10) : null,
    periods,
    storageFeeEstimate: netInStock === null || !periods ? null : Math.round(periods * netInStock * ratePerMtPerPeriod),
  };
}
