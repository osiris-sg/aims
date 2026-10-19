/**
 * Credit notes and early Invoice #2 (2026-10, meeting / improvement sheet) —
 * pure rules.
 *
 *  - Invoice #2 may go out on the final delivery date with ESTIMATED costs
 *    (header.costsBasis = 'ESTIMATED', shown in AIMS only, never on the PDF).
 *    When Mitsui Soko's actuals are in (step 12), the variance is shown;
 *    nothing is re-invoiced unless the user clicks "Issue adjustment".
 *  - Falling LME can make Invoice #2 negative: it is a CREDIT NOTE in AIMS
 *    (same PDF layout as the sample) and an open credit for the customer,
 *    offset on a later Invoice #1 with a "前回差額充当 (Invoice no.)" line.
 */
import type { InvoiceLine } from './trade-invoice';

const r2 = (v: number) => Math.round(v * 100) / 100;

/** A finalized Invoice #2 with a negative total is a credit note. */
export const isCreditNote = (docType: string, total: number) => docType === 'INVOICE_2' && total < -0.004;

/**
 * The Invoice #1 line that uses a credit: no tax (the credit note already
 * carried its own), the full credit as a negative amount.
 */
export function creditLine(credit: { id: string; amount: number; sourceNumber: string | null }): InvoiceLine & { creditId: string } {
  return {
    description: `前回差額充当 (${credit.sourceNumber ?? 'credit note'})`,
    quantity: null,
    unit: '',
    unitPrice: null,
    amountOverride: -r2(credit.amount),
    remarks: 'Credit from a previous Invoice #2',
    dueDate: null,
    taxable: false,
    creditId: credit.id,
  };
}

/** Credit ids an Invoice #1's rows apply. */
export const creditIdsOf = (rows: unknown): string[] =>
  (Array.isArray(rows) ? rows : []).map((r) => (r as { creditId?: unknown })?.creditId).filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x));

/** An Invoice #2 / single invoice's cost lines (USD): Invoice #2 rows not tied to a shipment; single-invoice yen rows. */
export function estimatedCostsUsd(docType: string, rows: unknown, amountOf: (row: Record<string, unknown>) => number): number {
  const list = (Array.isArray(rows) ? rows : []) as Array<Record<string, unknown>>;
  const cost = docType === 'INVOICE_SINGLE' ? list.filter((r) => r.kind === 'jpy') : list.filter((r) => !r.shipmentId && !r.creditId && (r.lme === null || r.lme === undefined));
  return r2(cost.reduce((s, r) => s + amountOf(r), 0));
}

export interface CostVariance {
  estimatedUsd: number;
  actualJpy: number | null;
  fxRate: number | null;
  actualUsd: number | null;
  /** actual − estimate (USD); positive = ADH under-billed. */
  varianceUsd: number | null;
  /** Every covered shipment has its step 12 actuals. */
  complete: boolean;
}

/** Estimated cost lines vs Mitsui Soko actuals (JPY at the invoice's FX). */
export function costVariance(estimatedUsd: number, actualsJpy: Array<number | null>, fxRate: number | null): CostVariance {
  const complete = actualsJpy.length > 0 && actualsJpy.every((a) => a !== null && a > 0);
  const actualJpy = complete ? actualsJpy.reduce((s: number, a) => s + (a as number), 0) : null;
  const actualUsd = actualJpy !== null && fxRate ? r2(actualJpy / fxRate) : null;
  return { estimatedUsd, actualJpy, fxRate, actualUsd, varianceUsd: actualUsd === null ? null : r2(actualUsd - estimatedUsd), complete };
}

/** The adjustment invoice's one line: the cost variance (taxable, like the cost lines it corrects). */
export function adjustmentLine(sourceNumber: string | null, varianceUsd: number, dueDate: string | null): InvoiceLine {
  return {
    description: `通関、車輸送料 差額調整 (${sourceNumber ?? 'Invoice #2'} 見積 → 確定)`,
    quantity: null,
    unit: '',
    unitPrice: null,
    amountOverride: r2(varianceUsd),
    remarks: 'Actual Mitsui Soko costs vs the estimate billed',
    dueDate,
    taxable: true,
  };
}
