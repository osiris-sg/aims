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
  /** The row prices this grade only (a contract with two grades: Kato 6005 / 6063); null = every grade. */
  grade?: string | null;
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
    const grade = typeof r.grade === 'string' && r.grade.trim() ? r.grade.trim().slice(0, 40) : null;
    return { from, to, grade, supplierPremium: n(r.supplierPremium), clientPremium: n(r.clientPremium), upcharge: n(r.upcharge) };
  });
  rows.sort((a, b) => a.from.localeCompare(b.from));
  // Rows of the same grade (or both "every grade") may not overlap.
  for (const g of new Set(rows.map((r) => r.grade))) {
    const same = rows.filter((r) => r.grade === g);
    for (let i = 1; i < same.length; i++) {
      const prev = same[i - 1];
      if (prev.to === null || prev.to >= same[i].from) fail(`premium rows overlap at ${same[i].from}${g ? ` (${g})` : ''}`);
    }
  }
  return rows;
}

/** The schedule row covering a month (null when none). */
export function premiumAt(schedule: unknown, month: string | null | undefined, grade?: string | null): PremiumRow | null {
  if (!month || !Array.isArray(schedule)) return null;
  const rows = (schedule as PremiumRow[]).filter((r) => r.from <= month && (r.to === null || r.to >= month));
  // No grade asked (contract overview): any row. A grade: its own row ("6063" also prices "6063 HSB"), else an every-grade row — never another grade's.
  if (grade === undefined) return rows[0] ?? null;
  const g = (grade ?? '').trim().toUpperCase();
  const own = (r: PremiumRow) => !!r.grade && !!g && (g === r.grade.toUpperCase() || g.startsWith(`${r.grade.toUpperCase()} `));
  return rows.find(own) ?? rows.find((r) => !r.grade) ?? null;
}

/** ADH's margin per MT for a month: client − supplier premium. */
export function marginAt(schedule: unknown, month: string | null | undefined): number | null {
  const r = premiumAt(schedule, month);
  return r && r.clientPremium !== null && r.supplierPremium !== null ? Math.round((r.clientPremium - r.supplierPremium) * 100) / 100 : null;
}

/** "2026-07" → "2026-3Q" (the docDefaults.qmjpByQuarter key). */
export const quarterOf = (month: string) => `${month.slice(0, 4)}-${Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1}Q`;

/** "2026-07" − 1 month → "2026-06". */
const prevMonth = (month: string) => {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

/**
 * Premiums are stored as the FIXED part only (Vedanta 6063 +205, 6005 +162; clients 6063 +230,
 * 6005 190 + 10 upcharge); QMJP is added by quarter when pricing. A Vedanta PI prints QMJP +
 * fixed (556.50 = 2Q 351.5 + 205) and prices on the month before the shipment month, so the
 * fixed part = printed − QMJP of that month's quarter. Null when the quarter's QMJP isn't
 * stored or the result isn't a plausible premium (then the user types it).
 */
export function fixedPremiumFromPi(printed: number | null | undefined, shipmentMonth: string | null | undefined, qmjpByQuarter: Record<string, number>): number | null {
  if (printed === null || printed === undefined || !Number.isFinite(printed) || !shipmentMonth || !MONTH.test(shipmentMonth)) return null;
  const q = qmjpByQuarter[quarterOf(prevMonth(shipmentMonth))];
  if (typeof q !== 'number' || !Number.isFinite(q)) return null;
  const fixed = Math.round((printed - q) * 100) / 100;
  return fixed >= 0 && fixed < printed ? fixed : null;
}

export interface MarketPrices {
  /** LME cash monthly average (USD/MT), "YYYY-MM" → price. */
  lmeByMonth: Record<string, number>;
  /** QMJP per quarter (USD/MT), "2026-3Q" → premium. */
  qmjpByQuarter: Record<string, number>;
  /** Round AK: months whose LME is the feed's provisional average (month not over) — differences are "provisional", not errors. */
  provisionalMonths?: string[];
}

/** provisional (round N): a PI's LME / unit differ — PI prices are provisional and settle on the CI (amber, not an error). */
export type CheckMark = 'ok' | 'diff' | 'unknown' | 'provisional';
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
  /** Every line that could be checked agrees — and the document gave at least one value (else nothing was compared). */
  ok: boolean;
  /** The document gave at least one value (else the panel says "Not read yet", never "Matches"). */
  read: boolean;
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
  /** The order's grade: a schedule row of another grade never applies. */
  grade?: string | null;
  /** Fallback when the schedule has no row: the contract line / order premiums. */
  fallback?: { supplierPremium?: number | null; clientPremium?: number | null; upcharge?: number | null };
  prices: MarketPrices;
  found: { premium?: number | null; lme?: number | null; qmjp?: number | null; unit?: number | null };
  /** A PI (round N): LME / unit differences are "provisional — settles on the CI", never an error; the premium still is. */
  provisional?: boolean;
}): PriceCheck {
  const notes: string[] = [];
  const row = premiumAt(input.schedule, input.basisMonth, input.grade);
  const fb = input.fallback ?? {};
  const fixed = input.side === 'supplier' ? (row?.supplierPremium ?? n(fb.supplierPremium)) : (row?.clientPremium ?? n(fb.clientPremium));
  const upcharge = input.side === 'client' ? (row?.upcharge ?? n(fb.upcharge) ?? 0) : 0;
  if (!row) notes.push(input.basisMonth ? `No premium schedule row for ${input.basisMonth}${input.grade ? ` (${input.grade})` : ''} — using the order / contract line` : 'No basis month');
  const lme = input.basisMonth ? (input.prices.lmeByMonth[input.basisMonth] ?? null) : null;
  const lmeProvisional = !!input.basisMonth && lme !== null && !!input.prices.provisionalMonths?.includes(input.basisMonth);
  if (lmeProvisional) notes.push(`LME ${input.basisMonth} is provisional (month not over yet, Westmetall average so far)`);
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
    const off: CheckMark = (input.provisional || lmeProvisional) && (key === 'lme' || key === 'unit') ? 'provisional' : 'diff';
    return { key, label, expected, found: f, diff, mark: diff === null ? 'unknown' : Math.abs(diff) <= 0.01 ? 'ok' : off };
  };
  const lines = [
    line('premium', input.side === 'supplier' ? (input.mjpBased ? 'Supplier premium (QMJP + contract)' : 'Supplier premium') : 'Client premium', premium, input.found.premium),
    line('lme', `LME${input.basisMonth ? ` (${input.basisMonth})` : ''}`, lme, input.found.lme),
    ...(input.side === 'client' ? [line('qmjp', `QMJP${input.basisMonth ? ` (${quarterOf(input.basisMonth)})` : ''}`, qmjp, input.found.qmjp)] : []),
    line('unit', 'Unit price', unit, input.found.unit),
  ];
  const read = lines.some((l) => l.found !== null);
  if (lines.some((l) => l.mark === 'provisional')) notes.push('PI prices are provisional — the LME settles on the CI');
  return { side: input.side, basisMonth: input.basisMonth, lines, ok: read && lines.every((l) => l.mark !== 'diff'), read, notes };
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
