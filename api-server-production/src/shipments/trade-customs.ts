/**
 * Japanese import consumption tax, and reading the two customs / shipping-line
 * documents that feed it — pure, so the numbers can be checked against ADH's
 * real permits.
 *
 * Import tax, as on 輸入許可書 IM3Z680452 (#11, 198GX04630):
 *   申告価格     = ⌊CIF USD × customs weekly rate⌋ + JPY add-on (運賃 E, = the A/N's EQMC)
 *                = ⌊1,156,238.80 × 159.00⌋ + 27,000 = ¥183,868,969
 *   消費税       = ⌊⌊申告価格⌋₁₀₀₀ × 7.8%⌋ = 14,341,704 → ⌊⌋₁₀₀ 14,341,700
 *   地方消費税   = ⌊消費税 × 22/78⌋ = 4,045,094 → ⌊⌋₁₀₀ 4,045,000
 *   納税額合計   = ¥18,386,700
 *
 * Readers (text layer first — free and exact; the AI read is the fallback for
 * scans and other layouts):
 *   parsePermitText   NACCS 輸入許可書 (import permit)
 *   parseAnText       Wan Hai "(WEB)ARRIVAL NOTICE" — the vessel printed between
 *                     the ports is the one arriving in Japan (after T/S); the
 *                     "VSL/VOY" line is the B/L's first-leg vessel.
 */

/** National consumption tax rate on imports and the local share (22/78 of it). */
export const IMPORT_TAX = { nationalRate: 0.078, localNumerator: 22, localDenominator: 78 } as const;

export interface ImportTaxBreakdown {
  cifUsd: number;
  fxRate: number;
  /** ⌊CIF × FX⌋ before the add-on. */
  cifJpy: number;
  addOnJpy: number;
  /** 申告価格 (課税価格). */
  customsValue: number;
  /** 課税標準: 申告価格 with yen below 1,000 dropped. */
  taxBase: number;
  /** 消費税 before / after dropping yen below 100. */
  nationalRaw: number;
  national: number;
  localRaw: number;
  local: number;
  /** 納税額合計. */
  total: number;
}

const cents = (v: number) => Math.round(v * 100);

/** The permit's arithmetic, in integers (CIF and FX to 2 dp) so nothing drifts. */
export function importTax(cifUsd: number, fxRate: number, addOnJpy = 0): ImportTaxBreakdown {
  const cifJpy = Math.floor((cents(cifUsd) * cents(fxRate)) / 10000);
  const customsValue = cifJpy + Math.round(addOnJpy || 0);
  return taxFromCustomsValue(customsValue, { cifUsd, fxRate, cifJpy, addOnJpy: Math.round(addOnJpy || 0) });
}

/** From a 申告価格 already known (e.g. read off the permit). */
export function taxFromCustomsValue(
  customsValue: number,
  parts: { cifUsd?: number; fxRate?: number; cifJpy?: number; addOnJpy?: number } = {},
): ImportTaxBreakdown {
  const taxBase = Math.floor(customsValue / 1000) * 1000;
  // 7.8% as 78 / 1000 — exact in integers.
  const nationalRaw = Math.floor((taxBase * 78) / 1000);
  const national = Math.floor(nationalRaw / 100) * 100;
  const localRaw = Math.floor((national * IMPORT_TAX.localNumerator) / IMPORT_TAX.localDenominator);
  const local = Math.floor(localRaw / 100) * 100;
  return {
    cifUsd: parts.cifUsd ?? 0,
    fxRate: parts.fxRate ?? 0,
    cifJpy: parts.cifJpy ?? customsValue - (parts.addOnJpy ?? 0),
    addOnJpy: parts.addOnJpy ?? 0,
    customsValue,
    taxBase,
    nationalRaw,
    national,
    localRaw,
    local,
    total: national + local,
  };
}

// ── Number helpers ─────────────────────────────────────────────────────────
const num = (s: string | null | undefined): number | null => {
  if (s === null || s === undefined) return null;
  const v = Number(String(s).replace(/[,\s¥\\]/g, ''));
  return Number.isFinite(v) ? v : null;
};
const MONTHS: Record<string, string> = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
/** "AUG 24 2026" → "2026-08-24"; "2026/08/24" → "2026-08-24". */
export function textDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const a = /\b([A-Z]{3})\s+(\d{1,2}),?\s+(\d{4})\b/i.exec(s);
  if (a && MONTHS[a[1].toUpperCase()]) return `${a[3]}-${MONTHS[a[1].toUpperCase()]}-${a[2].padStart(2, '0')}`;
  const b = /\b(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})\b/.exec(s);
  return b ? `${b[1]}-${b[2].padStart(2, '0')}-${b[3].padStart(2, '0')}` : null;
}

// ── 輸入許可書 ──────────────────────────────────────────────────────────────

export interface PermitData {
  declarationNo: string | null;
  declarationDate: string | null;
  /** As printed (NACCS adds a prefix, e.g. "BE22AA198GX04630"). */
  blNumber: string | null;
  packages: number | null;
  grossWeightKg: number | null;
  containerCount: number | null;
  vessel: string | null;
  /** 仕入書番号 = ADH's SG→JP invoice no. */
  invoiceNo: string | null;
  invoiceTerms: string | null;
  invoiceCurrency: string | null;
  invoiceAmount: number | null;
  /** 運賃 add-on (code E) in JPY. */
  addOnJpy: number | null;
  fxRate: number | null;
  customsValue: number | null;
  national: number | null;
  local: number | null;
  total: number | null;
}

export const EMPTY_PERMIT: PermitData = {
  declarationNo: null,
  declarationDate: null,
  blNumber: null,
  packages: null,
  grossWeightKg: null,
  containerCount: null,
  vessel: null,
  invoiceNo: null,
  invoiceTerms: null,
  invoiceCurrency: null,
  invoiceAmount: null,
  addOnJpy: null,
  fxRate: null,
  customsValue: null,
  national: null,
  local: null,
  total: null,
};

/**
 * Read a NACCS 輸入許可書 from its text layer (labels come out garbled; the
 * values and the coded lines "A - CIF - USD - 1,156,238.80", "E - JPY - 27,000",
 * "USD - 159.00", "\14,341,704 / 7.8% / \183,868,969" are reliable). Taxes are
 * accepted only when the printed figures agree with the formula; anything not
 * found stays null. `complete` = enough to fill step 10 without the AI read.
 */
export function parsePermitText(text: string): { data: PermitData; complete: boolean } {
  const t = text.replace(/\r/g, '');
  const d: PermitData = { ...EMPTY_PERMIT };
  // Declaration no. (11 digits printed 3-4-4) glued to the declaration date.
  const decl = /(\d{3}) (\d{4}) (\d{4})(\d{4}\/\d{2}\/\d{2})/.exec(t);
  if (decl) {
    d.declarationNo = `${decl[1]}${decl[2]}${decl[3]}`;
    d.declarationDate = textDate(decl[4]);
  }
  const inv = /\b([A-Z])\s*-\s*([A-Z]{3})\s*-\s*([A-Z]{3})\s*-\s*([\d,]+\.\d{2})/.exec(t);
  if (inv) {
    d.invoiceTerms = inv[2];
    d.invoiceCurrency = inv[3];
    d.invoiceAmount = num(inv[4]);
  }
  const addOn = /\bE\s*-\s*JPY\s*-\s*([\d,]+)/.exec(t);
  d.addOnJpy = addOn ? num(addOn[1]) : null;
  const fx = /\b([A-Z]{3})\s*-\s*(\d{2,3}\.\d{2})\b/.exec(t.replace(inv?.[0] ?? '\u0000', ''));
  d.fxRate = fx ? num(fx[2]) : null;
  // "\<national before rounding>" / "7.8%" / "\<申告価格>".
  const nat = /\\([\d,]+)\s*\n\s*7\.8%\s*\n\s*\\([\d,]+)/.exec(t);
  const yen = [...t.matchAll(/\\([\d,]{3,})/g)].map((m) => num(m[1])).filter((v): v is number => v !== null);
  const value = nat ? num(nat[2]) : yen.length ? Math.max(...yen) : null;
  if (value !== null) {
    const calc = taxFromCustomsValue(value);
    // Only figures the permit itself prints are taken; the formula picks which is which.
    if (yen.includes(calc.national)) d.national = calc.national;
    if (yen.includes(calc.local)) d.local = calc.local;
    if (yen.includes(calc.total)) d.total = calc.total;
    d.customsValue = value;
  }
  const bl = /\b([A-Z]{2}\d{2}[A-Z]{2}[A-Z0-9]{8,})\b/.exec(t);
  d.blNumber = bl ? bl[1] : null;
  const pkgW = /\n(\d{1,5})\n([\d,]+\.\d{3})\n/.exec(t);
  if (pkgW) {
    d.packages = num(pkgW[1]);
    d.grossWeightKg = num(pkgW[2]);
  }
  // 積載船: printed after the arrival date and a one-letter code ("2026/08/23 / F / WAN HAI 365"); else any
  // "NAME 123" line that isn't an address (HONMOKU FUTO 3).
  const vessel =
    /\d{4}\/\d{2}\/\d{2}\n[A-Z]\n([A-Z][A-Z .]*[A-Z] \d{1,4})\n/.exec(t) ??
    [...t.matchAll(/^([A-Z][A-Z .]*[A-Z] \d{1,4})$/gm)].find((m) => !/\b(FUTO|BLDG|OFFICE|KU|CHOME|PIER|BERTH)\b/.test(m[1])) ??
    null;
  d.vessel = vessel ? vessel[1].trim() : null;
  const invNo = /\b(ADH\d{8}[A-Z0-9_]*)-?/.exec(t);
  d.invoiceNo = invNo ? invNo[1] : null;
  const complete = d.total !== null && d.customsValue !== null && d.fxRate !== null;
  return { data: d, complete };
}

/** 輸入許可書 file names often carry the amount: "輸入許可書202607-09_JPY18,386,700_SUS305.804t …pdf". */
export function permitTotalFromFileName(fileName: string | null | undefined): number | null {
  const m = /JPY\s?([\d,]{5,})/i.exec(fileName ?? '');
  return m ? num(m[1]) : null;
}

/** B/L numbers on the permit carry a NACCS prefix: "BE22AA198GX04630" matches "198GX04630". */
export function sameBl(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const y = (b ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!x || !y) return false;
  return x === y || (y.length >= 8 && x.endsWith(y)) || (x.length >= 8 && y.endsWith(x));
}

export interface PermitCheck {
  field: 'blNumber' | 'invoiceNo' | 'total';
  label: string;
  status: 'ok' | 'mismatch' | 'missing';
  expected: string | null;
  found: string | null;
}

/** Step 10: the permit against the shipment (warnings only — never blocks). */
export function permitChecks(p: PermitData, shipment: { blNumber?: string | null; sgjpInvoiceNo?: string | null; estimatedTax?: number | null }): PermitCheck[] {
  const out: PermitCheck[] = [];
  const row = (field: PermitCheck['field'], label: string, expected: string | null, found: string | null, ok: boolean): PermitCheck => ({
    field,
    label,
    expected,
    found,
    status: !expected || !found ? 'missing' : ok ? 'ok' : 'mismatch',
  });
  out.push(row('blNumber', 'B/L番号', shipment.blNumber ?? null, p.blNumber, sameBl(p.blNumber, shipment.blNumber)));
  out.push(
    row(
      'invoiceNo',
      '仕入書番号 (SG→JP invoice no.)',
      shipment.sgjpInvoiceNo ?? null,
      p.invoiceNo,
      (p.invoiceNo ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase() === (shipment.sgjpInvoiceNo ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase(),
    ),
  );
  return out;
}

// ── Wan Hai Arrival Notice ─────────────────────────────────────────────────

export interface AnChargeLine {
  code: string;
  unit: number | null;
  rate: number | null;
  total: number;
  currency: string;
}

export interface AnData {
  blNumber: string | null;
  /** The B/L's vessel ("VSL/VOY" line — the first leg). */
  vessel: string | null;
  voyageNo: string | null;
  /** The vessel arriving in Japan after transhipment (printed between the ports); = 積載船 on the permit. */
  tsVessel: string | null;
  tsVoyageNo: string | null;
  tsPort: string | null;
  eta: string | null;
  cyTerminal: string | null;
  containerCount: number | null;
  bundles: number | null;
  grossWeightKg: number | null;
  cbm: number | null;
  telexRelease: boolean;
  charges: AnChargeLine[];
  chargesTotal: number | null;
}

/**
 * Wan Hai's web A/N text layer. Charges come out as codes and amounts in
 * separate runs; THC is the amount that is containers × a printed rate, DOC /
 * EQMC take the rest in print order, and the result must add up to TOTAL —
 * otherwise `charges` is left empty and the AI read decides.
 */
export function parseAnText(text: string): { data: AnData; complete: boolean } {
  const t = text.replace(/\r/g, '');
  const bl = /B\/L No:\s*([A-Z0-9]+)/.exec(t);
  const vsl = /VSL\/VOY:\s*(.+?)\s*\/\s*([A-Z0-9]+)\s*$/m.exec(t);
  // "N044WAN HAI 365": voyage glued to the arriving vessel's name.
  const ts = /^([A-Z]?\d{3}[A-Z]??)([A-Z][A-Z .]*[A-Z] \d{1,4})$/m.exec(t);
  const tsPort = /T\/S PORT:\s*(.+)$/m.exec(t);
  const eta = /Est\. Arrival Date:\s*(.+)$/m.exec(t);
  const cy = /CY-Terminal:\s*(.+?)(?:\s+TEL\s*[:：].*)?$/m.exec(t);
  const ctr = /(\d+)\s*CTR\b/.exec(t);
  const bdl = /\((\d+)\s*BDL\)/.exec(t);
  // Measurement (CBM, 4 dp) then gross weight (KGS, 3 dp) on consecutive lines.
  const mw = /\n(\d{1,6}\.\d{4})\n([\d,]+\.\d{3})\n/.exec(t);
  const containerCount = ctr ? Number(ctr[1]) : null;
  const data: AnData = {
    blNumber: bl ? bl[1] : null,
    vessel: vsl ? vsl[1].trim() : null,
    voyageNo: vsl ? vsl[2].trim() : null,
    tsVessel: ts ? ts[2].trim() : null,
    tsVoyageNo: ts ? ts[1] : null,
    tsPort: tsPort ? tsPort[1].trim() : null,
    eta: textDate(eta?.[1]),
    cyTerminal: cy ? cy[1].trim() : null,
    containerCount,
    bundles: bdl ? Number(bdl[1]) : null,
    grossWeightKg: mw ? num(mw[2]) : null,
    cbm: mw ? num(mw[1]) : null,
    telexRelease: /TELEX RELEASE/i.test(t),
    charges: [],
    chargesTotal: null,
  };
  const totalM = /TOTAL\s+([A-Z]{3})\s?([\d,]+\.\d{2})/.exec(t);
  const total = totalM ? num(totalM[2]) : null;
  const currency = totalM ? totalM[1] : 'JPY';
  data.chargesTotal = total;
  // Amounts in the charges block (before TOTAL), and the codes in print order.
  const block = t.slice(t.indexOf('VANTYPE') >= 0 ? t.indexOf('VANTYPE') : 0, totalM ? totalM.index : undefined);
  const amounts = [...block.matchAll(/[A-Z]{3}\s?([\d,]+\.\d{2})/g)].map((m) => num(m[1]) as number);
  const codes = [...block.matchAll(/^(THC|DOC|EQMC|[A-Z]{3,5})$/gm)].map((m) => m[1]).filter((c) => !['TOTAL', 'JPY', 'USD'].includes(c));
  if (codes.includes('THC') && containerCount && amounts.length) {
    const pool = [...amounts];
    // THC total and its rate: a pair with total = containers × rate.
    let thc: AnChargeLine | null = null;
    for (const a of pool) {
      const rate = a / containerCount;
      if (pool.includes(rate) && rate !== a) {
        thc = { code: 'THC', unit: containerCount, rate, total: a, currency };
        pool.splice(pool.indexOf(a), 1);
        pool.splice(pool.indexOf(rate), 1);
        break;
      }
    }
    const rest = codes.filter((c) => c !== 'THC');
    if (thc && rest.length === pool.length) {
      const lines = [thc, ...rest.map((code, i) => ({ code, unit: null, rate: null, total: pool[i], currency }))];
      const sum = lines.reduce((s, l) => s + l.total, 0);
      if (total === null || Math.abs(sum - total) < 0.005) data.charges = lines;
    }
  }
  const complete = !!data.blNumber && !!data.eta && data.charges.length > 0;
  return { data, complete };
}

/** The estimator's AN inputs (step 9): THC / DOC / EQMC; EQMC is also the import-tax add-on by default. */
export function anChargesForCosts(an: Pick<AnData, 'charges'>): { thc: number | null; docFee: number | null; equipmentFee: number | null } {
  const pick = (code: string) => an.charges.find((c) => c.code === code && c.currency === 'JPY')?.total ?? null;
  return { thc: pick('THC'), docFee: pick('DOC'), equipmentFee: pick('EQMC') };
}
