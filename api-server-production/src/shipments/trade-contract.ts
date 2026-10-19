/**
 * Contract master and price check (2026-10). Sayaka checks every PI, CI and
 * invoice by hand against Premium / Unit Price / LME scattered across emails;
 * the contract now holds the pricing basis and a premium schedule, and every
 * document gets an expected-price panel. Pure.
 *
 *   premium schedule  [{ from: "YYYY-MM", to: "YYYY-MM" | null, supplierPremium, clientPremium, upcharge }]
 *                     — the row covering a month wins; ADH margin = client − supplier
 *   expected unit     supplier side (PI / CI):      LME(basis month) + [QMJP(quarter)] + supplier premium
 *                     client side (Invoice #1/#2):  LME(basis month) + QMJP(quarter) + client premium (+ upcharge)
 *   Vedanta's premium is "midpoint of the Main Japanese Port premium for the
 *   quarter (Platts) + N USD PMT" (SUS 6063 +205, SUS 6005 +162, Kato +260,
 *   Hoei +5): with a QMJP rule the schedule holds N and the PI's premium
 *   column is QMJP + N (e.g. 351.5 + 205 = 556.50).
 *
 * The check never changes a document: each line is ✓ / ✗ with the difference.
 */

export interface PremiumRow {
  from: string;
  to: string | null;
  supplierPremium: number | null;
  clientPremium: number | null;
  upcharge: number | null;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const n = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Validate a premium schedule (months YYYY-MM, from ≤ to, no overlaps). */
export function cleanPremiumSchedule(v: unknown, fail: (msg: string) => never): PremiumRow[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v) || v.length > 60) fail('premiumSchedule must be a list (max 60 rows)');
  const rows = (v as Array<Record<string, unknown>>).map((r, i) => {
    if (!r || typeof r !== 'object') fail(`premium row ${i + 1} must be an object`);
    const from = String(r.from ?? '');
    const to = r.to === null || r.to === undefined || r.to === '' ? null : String(r.to);
    if (!MONTH.test(from)) fail(`premium row ${i + 1}: "from" must be YYYY-MM`);
    if (to !== null && (!MONTH.test(to) || to < from)) fail(`premium row ${i + 1}: "to" must be YYYY-MM on or after "from"`);
    return { from, to, supplierPremium: n(r.supplierPremium), clientPremium: n(r.clientPremium), upcharge: n(r.upcharge) };
  });
  rows.sort((a, b) => a.from.localeCompare(b.from));
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    if (prev.to === null || prev.to >= rows[i].from) fail(`premium rows overlap at ${rows[i].from}`);
  }
  return rows;
}

/** The schedule row covering a month (null when none). */
export function premiumAt(schedule: unknown, month: string | null | undefined): PremiumRow | null {
  if (!month || !Array.isArray(schedule)) return null;
  const rows = schedule as PremiumRow[];
  return rows.find((r) => r.from <= month && (r.to === null || r.to >= month)) ?? null;
}

/** ADH's margin per MT for a month: client − supplier premium. */
export function marginAt(schedule: unknown, month: string | null | undefined): number | null {
  const r = premiumAt(schedule, month);
  return r && r.clientPremium !== null && r.supplierPremium !== null ? Math.round((r.clientPremium - r.supplierPremium) * 100) / 100 : null;
}

/** "2026-07" → "2026-3Q" (the docDefaults.qmjpByQuarter key). */
export const quarterOf = (month: string) => `${month.slice(0, 4)}-${Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1}Q`;

export interface MarketPrices {
  /** LME cash monthly average (USD/MT), "YYYY-MM" → price. */
  lmeByMonth: Record<string, number>;
  /** QMJP per quarter (USD/MT), "2026-3Q" → premium. */
  qmjpByQuarter: Record<string, number>;
}

export type CheckMark = 'ok' | 'diff' | 'unknown';
export interface PriceCheckLine {
  key: 'premium' | 'lme' | 'qmjp' | 'unit';
  label: string;
  expected: number | null;
  found: number | null;
  /** found − expected. */
  diff: number | null;
  mark: CheckMark;
}

export interface PriceCheck {
  side: 'supplier' | 'client';
  basisMonth: string | null;
  lines: PriceCheckLine[];
  /** Every line that could be checked agrees. */
  ok: boolean;
  /** Something is missing on the contract / in the prices (shown as "check"). */
  notes: string[];
}

/**
 * Expected vs found for one document line. `found` is what the document says
 * (premium / LME / QMJP / unit price, any may be missing); tolerance ±0.01.
 */
export function priceCheck(input: {
  side: 'supplier' | 'client';
  basisMonth: string | null;
  schedule: unknown;
  /** The supplier premium is MJP-based (contract has a QMJP rule): QMJP is added on the supplier side too. */
  mjpBased?: boolean;
  /** Fallback when the schedule has no row: the contract line / order premiums. */
  fallback?: { supplierPremium?: number | null; clientPremium?: number | null; upcharge?: number | null };
  prices: MarketPrices;
  found: { premium?: number | null; lme?: number | null; qmjp?: number | null; unit?: number | null };
}): PriceCheck {
  const notes: string[] = [];
  const row = premiumAt(input.schedule, input.basisMonth);
  const fb = input.fallback ?? {};
  const fixed = input.side === 'supplier' ? (row?.supplierPremium ?? n(fb.supplierPremium)) : (row?.clientPremium ?? n(fb.clientPremium));
  const upcharge = input.side === 'client' ? (row?.upcharge ?? n(fb.upcharge) ?? 0) : 0;
  if (!row) notes.push(input.basisMonth ? `No premium schedule row for ${input.basisMonth} — using the contract line` : 'No basis month');
  const lme = input.basisMonth ? (input.prices.lmeByMonth[input.basisMonth] ?? null) : null;
  if (input.basisMonth && lme === null) notes.push(`No LME average stored for ${input.basisMonth} (Org Settings → Shipping → prices)`);
  const useQmjp = input.side === 'client' || !!input.mjpBased;
  const qmjp = useQmjp && input.basisMonth ? (input.prices.qmjpByQuarter[quarterOf(input.basisMonth)] ?? null) : null;
  if (useQmjp && input.basisMonth && qmjp === null) notes.push(`No QMJP stored for ${quarterOf(input.basisMonth)}`);
  // Supplier side with an MJP rule: the PI / CI premium is QMJP + the contract's fixed part.
  const premium = input.side === 'supplier' && input.mjpBased ? (fixed === null || qmjp === null ? null : round2(fixed + qmjp)) : fixed;
  // The expected unit uses the document's own LME when the stored one is missing (premium arithmetic is still checked).
  const lmeForUnit = lme ?? n(input.found.lme);
  const qmjpForUnit = input.side === 'client' ? (qmjp ?? n(input.found.qmjp)) : 0;
  const unit = premium === null || lmeForUnit === null || (input.side === 'client' && qmjpForUnit === null) ? null : round2(lmeForUnit + (qmjpForUnit ?? 0) + premium + (upcharge ?? 0));
  if (input.side === 'supplier' && input.mjpBased && fixed !== null) notes.push(`Supplier premium = QMJP${input.basisMonth ? ` ${quarterOf(input.basisMonth)}` : ''} + ${fixed}`);
  const line = (key: PriceCheckLine['key'], label: string, expected: number | null, found: number | null | undefined): PriceCheckLine => {
    const f = n(found);
    const diff = expected === null || f === null ? null : round2(f - expected);
    return { key, label, expected, found: f, diff, mark: diff === null ? 'unknown' : Math.abs(diff) <= 0.01 ? 'ok' : 'diff' };
  };
  const lines = [
    line('premium', input.side === 'supplier' ? (input.mjpBased ? 'Supplier premium (QMJP + contract)' : 'Supplier premium') : 'Client premium', premium, input.found.premium),
    line('lme', `LME${input.basisMonth ? ` (${input.basisMonth})` : ''}`, lme, input.found.lme),
    ...(input.side === 'client' ? [line('qmjp', `QMJP${input.basisMonth ? ` (${quarterOf(input.basisMonth)})` : ''}`, qmjp, input.found.qmjp)] : []),
    line('unit', 'Unit price', unit, input.found.unit),
  ];
  return { side: input.side, basisMonth: input.basisMonth, lines, ok: lines.every((l) => l.mark !== 'diff'), notes };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Validate docDefaults.lmeByMonth ({ "2026-07": 3155.98 }). */
export function cleanLmeByMonth(v: unknown, fail: (msg: string) => never): Record<string, number> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail('lmeByMonth must map months ("2026-07") to prices');
  const out: Record<string, number> = {};
  for (const [m, p] of Object.entries(v as Record<string, unknown>)) {
    if (!MONTH.test(m)) fail(`LME month "${m}" must look like 2026-07`);
    if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0 || p > 100000) fail(`LME for ${m} must be a price`);
    out[m] = p;
  }
  return out;
}
