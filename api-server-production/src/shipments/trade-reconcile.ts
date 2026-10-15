/**
 * Step 13 "Prepare data for Xero reconciliation" (order level): every money
 * figure of an order in one panel, with the profit
 *
 *   profit = d − a − b − c
 *     a = PI paid (deposit to the supplier, USD)
 *     b = CI paid (balance to the supplier, USD)
 *     c = costs: import tax actual + Mitsui Soko actuals + other costs (JPY at the order's FX, plus USD costs)
 *     d = what the customer pays in total (TWO_STAGE: Invoice #2 合計 = Invoice #1 + 差額; SINGLE: the invoice 合計)
 *
 * Document figures (Invoice #1 / #2, SG→JP IV) are read from the order's
 * documents; payments and actuals are typed (TradeOrder.reconciliation). Pure.
 */

export interface ReconcileInputs {
  /** a / b — typed, or defaulted from the PI deposit and the CI amount. */
  piPaid?: number | null;
  ciPaid?: number | null;
  /** FX for JPY costs (default: the invoice FX / import permit rate). */
  fxRate?: number | null;
  importTaxEstimateJpy?: number | null;
  importTaxActualJpy?: number | null;
  mitsuiActualsJpy?: number | null;
  otherCostsJpy?: number | null;
  otherCostsUsd?: number | null;
  notes?: string | null;
}

export interface ReconcileDocs {
  invoice1: { number: string | null; goods: number; tax: number; total: number } | null;
  sgjpTotal: number | null;
  invoice2: { numbers: string[]; lines: Array<{ description: string; amount: number }>; total: number; tax: number; taxable: number; nonTaxable: number } | null;
  /** SINGLE billing: the one invoice. */
  single: { number: string | null; total: number; tax: number } | null;
}

export interface Reconciliation {
  a: number | null;
  b: number | null;
  c: number;
  d: number | null;
  profit: number | null;
  costs: { importTaxUsd: number | null; mitsuiUsd: number | null; otherUsd: number };
  importTax: { estimateJpy: number | null; actualJpy: number | null; varianceJpy: number | null; fxRate: number | null };
  docs: ReconcileDocs;
  inputs: ReconcileInputs;
}

const r2 = (v: number) => Math.round(v * 100 + (v >= 0 ? 1e-9 : -1e-9)) / 100;
const nz = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function reconcile(inputs: ReconcileInputs, docs: ReconcileDocs, defaults: { piDeposit?: number | null; ciAmount?: number | null; fxRate?: number | null } = {}): Reconciliation {
  const a = nz(inputs.piPaid) ?? nz(defaults.piDeposit);
  const b = nz(inputs.ciPaid) ?? nz(defaults.ciAmount);
  const fx = nz(inputs.fxRate) ?? nz(defaults.fxRate);
  const toUsd = (jpy: number | null) => (jpy === null || !fx ? null : r2(jpy / fx));
  const importTaxUsd = toUsd(nz(inputs.importTaxActualJpy));
  const mitsuiUsd = toUsd(nz(inputs.mitsuiActualsJpy));
  const otherUsd = r2((toUsd(nz(inputs.otherCostsJpy)) ?? 0) + (nz(inputs.otherCostsUsd) ?? 0));
  const c = r2((importTaxUsd ?? 0) + (mitsuiUsd ?? 0) + otherUsd);
  const d = docs.single ? docs.single.total : (docs.invoice2?.total ?? null);
  const profit = d === null || a === null || b === null ? null : r2(d - a - b - c);
  const est = nz(inputs.importTaxEstimateJpy);
  const act = nz(inputs.importTaxActualJpy);
  return {
    a,
    b,
    c,
    d,
    profit,
    costs: { importTaxUsd, mitsuiUsd, otherUsd },
    importTax: { estimateJpy: est, actualJpy: act, varianceJpy: est === null || act === null ? null : act - est, fxRate: fx },
    docs,
    inputs,
  };
}

/** Clean a reconciliation patch from the form. */
export function cleanReconcileInputs(raw: unknown, fail: (msg: string) => never): ReconcileInputs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: ReconcileInputs = {};
  for (const k of ['piPaid', 'ciPaid', 'fxRate', 'importTaxEstimateJpy', 'importTaxActualJpy', 'mitsuiActualsJpy', 'otherCostsJpy', 'otherCostsUsd'] as const) {
    if (!(k in r)) continue;
    const v = r[k];
    if (v === null || v === '') out[k] = null;
    else {
      const n = Number(v);
      if (!Number.isFinite(n) || Math.abs(n) > 1e13) fail(`${k} must be a number`);
      out[k] = n;
    }
  }
  if ('notes' in r) out.notes = r.notes === null ? null : String(r.notes).slice(0, 4000);
  return out;
}
