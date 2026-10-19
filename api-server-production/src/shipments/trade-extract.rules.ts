/**
 * Trade PDF extraction — pure parts (no Nest / Prisma / network) so they can
 * be unit tested with the model call mocked:
 *  - the prompts sent with the PDF,
 *  - zod schemas that validate the model's JSON before anything uses it,
 *  - deterministic normalisers (sizes, incoterm/port, payment terms, months,
 *    dates, grades) that turn printed text into contract / shipment fields,
 *  - the advisory B/L draft checks (consignee / notify party / contract no. /
 *    grade / weight / POD / shipment-vs-B/L differences).
 */
import { z } from 'zod';
import { DepositDueUnit, parseDepositDue } from './trade-deposit';
import type { AnData, PermitData } from './trade-customs';

// ── zod helpers: tolerate "1,209,585.00", "", "null" from the model ────────
const blankToNull = (v: unknown) => (v === undefined || v === null || (typeof v === 'string' && ['', 'null', 'n/a', 'na', '-'].includes(v.trim().toLowerCase())) ? null : v);
export const nstr = z.preprocess((v) => {
  const b = blankToNull(v);
  return b === null ? null : String(b).trim();
}, z.string().nullable());
const toNum = (v: unknown) => {
  const b = blankToNull(v);
  if (b === null) return null;
  if (typeof b === 'number') return b;
  const n = Number(
    String(b)
      .replace(/[,\s]/g, '')
      .replace(/^(USD|US\$|\$|MT)/i, '')
      .replace(/(MT|KGS?|USD)$/i, ''),
  );
  return Number.isFinite(n) ? n : b; // leave garbage for z.number() to reject
};
export const nnum = z.preprocess(toNum, z.number().nullable());
export const nint = z.preprocess(toNum, z.number().int().nullable());

export const PI_LINE_SCHEMA = z.object({
  description: nstr.default(null),
  grade: nstr.default(null),
  sizeRaw: nstr.default(null),
  lengthRaw: nstr.default(null),
  quantityMt: nnum.default(null),
  lme: nnum.default(null),
  premium: nnum.default(null),
  rate: nnum.default(null),
  amount: nnum.default(null),
});

export const PI_SCHEMA = z.object({
  contractNo: nstr.default(null),
  piNumber: nstr.default(null),
  piDate: nstr.default(null),
  supplierName: nstr.default(null),
  supplierBank: nstr.default(null),
  buyerName: nstr.default(null),
  customerHint: nstr.default(null),
  product: nstr.default(null),
  portOfLoading: nstr.default(null),
  portOfDischarge: nstr.default(null),
  termsOfDelivery: nstr.default(null),
  paymentTerms: nstr.default(null),
  instrumentDueDate: nstr.default(null),
  shipmentPeriod: nstr.default(null),
  shipmentMonth: nstr.default(null),
  tolerance: nstr.default(null),
  currency: nstr.default(null),
  totalAmount: nnum.default(null),
  amountPayable: nnum.default(null),
  lines: z.array(PI_LINE_SCHEMA).default([]),
});
export type PiRaw = z.infer<typeof PI_SCHEMA>;

export const BL_CONTAINER_SCHEMA = z.object({
  containerNo: nstr.default(null),
  sealNo: nstr.default(null),
  packages: nint.default(null),
  grossKg: nnum.default(null),
});

export const BL_SCHEMA = z.object({
  contractNo: nstr.default(null),
  blNumber: nstr.default(null),
  shippingLine: nstr.default(null),
  vessel: nstr.default(null),
  voyageNo: nstr.default(null),
  etd: nstr.default(null),
  portOfLoading: nstr.default(null),
  portOfDischarge: nstr.default(null),
  placeOfDelivery: nstr.default(null),
  netWeight: nnum.default(null),
  grossWeight: nnum.default(null),
  weightUnit: nstr.default(null),
  totalBundles: nint.default(null),
  totalPieces: nint.default(null),
  hsCode: nstr.default(null),
  countryOfOrigin: nstr.default(null),
  commodity: nstr.default(null),
  grade: nstr.default(null),
  sizeSpec: nstr.default(null),
  containers: z.array(BL_CONTAINER_SCHEMA).default([]),
  containerCount: nint.default(null),
  consigneeText: nstr.default(null),
  notifyPartyText: nstr.default(null),
  freightTerms: nstr.default(null),
});
export type BlRaw = z.infer<typeof BL_SCHEMA>;

/** Validate model output; the error lists the offending paths. */
export function parseWith<S extends z.ZodTypeAny>(schema: S, raw: unknown, what: string): z.infer<S> {
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  const issues = r.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  throw new ExtractionFormatError(`The ${what} reader returned data in an unexpected shape — ${issues.join('; ')}`);
}
export class ExtractionFormatError extends Error {}

// ── prompts ─────────────────────────────────────────────────────────────────
export const PI_SYSTEM_PROMPT =
  'You read Proforma Invoices (PI) for aluminium billet sales from a supplier (e.g. Vedanta) to a trading company. The PDF may be a scanned image with no text layer — read the page images. Transcribe values exactly as printed; never invent a value — use null when it is not on the document. Output STRICT JSON only.';

export const PI_USER_PROMPT = `Extract this Proforma Invoice into exactly this JSON (null when absent):
{
  "contractNo": "sales contract / contract no. as printed (digits only, e.g. \\"454003422\\")",
  "piNumber": "proforma invoice no. (e.g. \\"9331004128\\")",
  "piDate": "PI date as YYYY-MM-DD (the document prints dates as DD/MM/YYYY or DD.MM.YYYY)",
  "supplierName": "the seller / issuing company",
  "supplierBank": "one-line summary of the seller's bank: bank name, branch, account no., SWIFT",
  "buyerName": "the buyer / consignee company named on the PI",
  "customerHint": "any END customer named anywhere (marks, remarks, notify, destination buyer), e.g. a Japanese company — else null",
  "product": "generic product name, e.g. \\"Aluminium Billet\\"",
  "portOfLoading": "as printed",
  "portOfDischarge": "as printed",
  "termsOfDelivery": "as printed, e.g. \\"CIF YOKOHAMA, JAPAN\\"",
  "paymentTerms": "as printed, e.g. \\"10% Adv with 5 business days\\"",
  "instrumentDueDate": "YYYY-MM-DD or null",
  "shipmentPeriod": "shipment / delivery period as printed",
  "shipmentMonth": "that period as YYYY-MM (e.g. \\"JULY 2026\\" → \\"2026-07\\")",
  "tolerance": "quantity tolerance as printed, e.g. \\"+/-5%\\"",
  "currency": "3-letter code, e.g. USD",
  "totalAmount": number (total PI value),
  "amountPayable": number (the advance / amount payable now, if printed),
  "lines": [
    {
      "description": "line description as printed",
      "grade": "alloy grade digits only, e.g. \\"6063\\" for \\"ALLOY 6063V1-C\\"",
      "sizeRaw": "diameter as printed, e.g. \\"8 INCH\\" or \\"203 MM\\"",
      "lengthRaw": "billet length as printed (e.g. \\"5800 MM\\") or null if no length is stated",
      "quantityMt": number,
      "lme": number (LME price per MT),
      "premium": number (premium per MT),
      "rate": number (unit rate per MT),
      "amount": number (line amount)
    }
  ]
}
Numbers are plain JSON numbers without thousands separators or currency symbols.`;

export const BL_SYSTEM_PROMPT =
  'You read draft Bills of Lading (B/L) for containerised aluminium billet shipments. The PDF may be a scanned image — read the page images. Transcribe exactly what is printed (keep line breaks in the consignee and notify-party boxes as \\n); never invent values — use null when absent. Output STRICT JSON only.';

export const BL_USER_PROMPT = `Extract this draft Bill of Lading into exactly this JSON (null when absent):
{
  "contractNo": "supplier sales contract no. if printed anywhere (e.g. in the goods description or marks)",
  "blNumber": "B/L number",
  "shippingLine": "the carrier issuing the B/L, e.g. \\"WAN HAI LINES\\"",
  "vessel": "vessel name only",
  "voyageNo": "voyage number only",
  "etd": "shipped-on-board / laden-on-board date (else ETD) as YYYY-MM-DD",
  "portOfLoading": "as printed",
  "portOfDischarge": "as printed",
  "placeOfDelivery": "as printed",
  "netWeight": number (total net weight),
  "grossWeight": number (total gross weight),
  "weightUnit": "KG or MT — the unit those two weights are printed in",
  "totalBundles": integer (packages / bundles),
  "totalPieces": integer (pieces / billets, if printed),
  "hsCode": "as printed, e.g. \\"7601.20\\"",
  "countryOfOrigin": "as printed",
  "commodity": "goods description as printed, short (e.g. \\"ALUMINIUM ALLOY BILLETS 6063\\")",
  "grade": "alloy grade digits, e.g. \\"6063\\"",
  "sizeSpec": "billet size as printed, e.g. \\"203 MM X 5800 MM\\"",
  "containers": [ { "containerNo": "e.g. WHLU0636631", "sealNo": "", "packages": integer, "grossKg": number } ],
  "containerCount": integer,
  "consigneeText": "full consignee box text, line breaks as \\\\n",
  "notifyPartyText": "full notify party box text, line breaks as \\\\n",
  "freightTerms": "e.g. FREIGHT PREPAID"
}
Party boxes are often too small: when the consignee or notify-party box ends with "***", "**", "CONT'D" or similar, the rest of that party's text is printed elsewhere on the document (e.g. in the goods-description area or an attached rider page, starting with the same marker). Append that continuation to the party text (without the marker) so the text is complete.
Numbers are plain JSON numbers without thousands separators.`;

// ── normalisers ─────────────────────────────────────────────────────────────
const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
const pad2 = (n: number | string) => String(n).padStart(2, '0');
const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());

/** YYYY-MM-DD from ISO, DD/MM/YYYY, DD.MM.YYYY, DD-MM-YYYY or "30-JUN-2026"; else null. */
export function isoDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
  if (m) return valid(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[\s./-]*([A-Za-z]{3})[A-Za-z]*[\s./,-]*(\d{4})$/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return valid(+m[3], +MONTHS[m[2].toLowerCase()], +m[1]);
  return null;
  function valid(y: number, mo: number, d: number) {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? `${y}-${pad2(mo)}-${pad2(d)}` : null;
  }
}

/** "2026-07", "JULY 2026", "Jul'26", "07/2026" → "2026-07". */
export function monthOf(...candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    if (!c) continue;
    const s = c.trim();
    let m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(s);
    if (m) return `${m[1]}-${m[2]}`;
    m = /\b([A-Za-z]{3})[A-Za-z]*[\s'’.,-]*(\d{4}|\d{2})\b/.exec(s);
    if (m && MONTHS[m[1].toLowerCase()]) return `${m[2].length === 2 ? `20${m[2]}` : m[2]}-${MONTHS[m[1].toLowerCase()]}`;
    m = /\b(0?[1-9]|1[0-2])[/.-](\d{4})\b/.exec(s);
    if (m) return `${m[2]}-${pad2(m[1])}`;
  }
  return null;
}

/** "ALLOY 6063V1-C" → "6063". */
export function gradeOf(...texts: Array<string | null | undefined>): string | null {
  for (const t of texts) {
    // Primary ingot grades keep their letter: P1020, P0507 (Hoei / the Thai supplier).
    const ingot = t ? /(?:^|[^A-Z0-9])(P[01]\d{3})(?!\d)/i.exec(t) : null;
    if (ingot) return ingot[1].toUpperCase();
    const m = t ? /(?:^|[^0-9])([1-8]\d{3})(?!\d)/.exec(t) : null;
    if (m) return m[1];
  }
  return null;
}

/** Diameters ADH quotes: 6" = 152 MM, 7" = 178 MM, 8" = 203 MM (else inch × 25.4, rounded). */
const INCH_MM: Record<string, number> = { '6': 152, '7': 178, '8': 203 };
export function inchToMm(inch: number): number {
  return INCH_MM[String(inch)] ?? Math.round(inch * 25.4);
}

/**
 * Size spec from the printed diameter (+ length): "8 INCH" + "5800 MM" →
 * "203 MM X 5800 MM"; with no length → "203 MM (8 INCH)"; "203 MM" stays.
 */
export function sizeSpecOf(sizeRaw: string | null | undefined, lengthRaw?: string | null): string | null {
  if (!sizeRaw && !lengthRaw) return null;
  const s = (sizeRaw ?? '').toUpperCase();
  const inch = /(\d+(?:\.\d+)?)\s*(?:INCH(?:ES)?|IN\b|"|”|'')/.exec(s);
  const mm = /(\d{2,4})\s*MM/.exec(s);
  const len = lengthRaw ? /(\d{3,5})\s*(?:MM)?/.exec(lengthRaw.toUpperCase()) : null;
  const dia = inch ? inchToMm(Number(inch[1])) : mm ? Number(mm[1]) : null;
  if (dia === null) return sizeRaw?.trim() || null;
  if (len) return `${dia} MM X ${len[1]} MM`;
  return inch ? `${dia} MM (${inch[1]} INCH)` : `${dia} MM`;
}

const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CNF', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];
/** "CIF YOKOHAMA, JAPAN" → { incoterm: "CIF", port: "Yokohama", country: "Japan" }. */
export function parseTermsOfDelivery(t: string | null | undefined): { incoterm: string | null; port: string | null; country: string | null } {
  if (!t) return { incoterm: null, port: null, country: null };
  const m = /^\s*([A-Za-z]{3})\b[\s,:-]*(.*)$/.exec(t.trim());
  const code = m && INCOTERMS.includes(m[1].toUpperCase()) ? m[1].toUpperCase() : null;
  const rest = (code ? m![2] : t).trim();
  const [port, country] = rest
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  return { incoterm: code === 'CNF' ? 'CFR' : code, port: port ? titleCase(port) : null, country: country ? titleCase(country) : null };
}

/** "10% Adv with 5 business days" → { depositPercent: 10, depositDueNote: "within 5 business days" }. */
export function parsePaymentTerms(t: string | null | undefined): { depositPercent: number | null; depositDueNote: string | null } {
  if (!t) return { depositPercent: null, depositDueNote: null };
  const pct = /(\d+(?:\.\d+)?)\s*%/.exec(t);
  const days = /(\d+)\s*(business|working|banking|calendar)?\s*days?/i.exec(t);
  return {
    depositPercent: pct ? Number(pct[1]) : null,
    depositDueNote: days ? `within ${days[1]} ${days[2] ? `${days[2].toLowerCase()} ` : ''}days` : null,
  };
}

/** "+/-5%", "±5 %" → 5. */
export function tolerancePctOf(t: string | null | undefined): number | null {
  const m = t ? /(\d+(?:\.\d+)?)\s*%/.exec(t) : null;
  return m ? Number(m[1]) : null;
}

/** Pick the one party whose first word appears as a word in `text` (e.g. "SUS" in "… SUS CO., LTD …"). */
export function matchParty<P extends { id: string; name: string }>(parties: P[], ...texts: Array<string | null | undefined>): P | null {
  const hay = ` ${texts
    .filter(Boolean)
    .join(' ')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')} `;
  if (!hay.trim()) return null;
  const hits = parties.filter((p) => {
    const first = p.name
      .toUpperCase()
      .replace(/[^A-Z0-9 ]+/g, ' ')
      .trim()
      .split(/\s+/)[0];
    return first && first.length >= 3 && hay.includes(` ${first} `);
  });
  return hits.length === 1 ? hits[0] : null;
}

// ── drafts ──────────────────────────────────────────────────────────────────
export interface ContractDraft {
  contractNo: string | null;
  piNumber: string | null;
  piDate: string | null;
  supplierId: string | null;
  supplierName: string | null;
  customerId: string | null;
  destinationPort: string | null;
  destinationCountry: string | null;
  incoterm: string | null;
  shipmentMonth: string | null;
  currency: string | null;
  piAmount: number | null;
  depositPercent: number | null;
  depositAmount: number | null;
  depositDueNote: string | null;
  /** The note as a term: "within 3 business days" → 3 / BUSINESS; null when it isn't a day count. */
  depositDueDays: number | null;
  depositDueUnit: DepositDueUnit | null;
  lines: Array<{ grade: string | null; sizeSpec: string | null; product: string | null; quantityMt: number | null; tolerancePct: number | null; supplierPremium: number | null }>;
}

export function contractDraftFromPi(pi: PiRaw, parties: { suppliers: Array<{ id: string; name: string }>; customers: Array<{ id: string; name: string }> }): ContractDraft {
  const tod = parseTermsOfDelivery(pi.termsOfDelivery);
  const pay = parsePaymentTerms(pi.paymentTerms);
  const tol = tolerancePctOf(pi.tolerance);
  const supplier = matchParty(parties.suppliers, pi.supplierName);
  // The PI's buyer is ADH itself; only an end customer named on the PI picks one.
  const customer = matchParty(parties.customers, pi.customerHint);
  return {
    contractNo: pi.contractNo?.replace(/\s+/g, '') || null,
    piNumber: pi.piNumber?.replace(/\s+/g, '') || null,
    piDate: isoDate(pi.piDate),
    supplierId: supplier?.id ?? null,
    supplierName: pi.supplierName,
    customerId: customer?.id ?? null,
    destinationPort: tod.port ?? (pi.portOfDischarge ? titleCase(pi.portOfDischarge.split(',')[0].trim()) : null),
    destinationCountry: tod.country,
    incoterm: tod.incoterm,
    shipmentMonth: monthOf(pi.shipmentMonth, pi.shipmentPeriod),
    currency: pi.currency && /^[A-Za-z]{3}$/.test(pi.currency) ? pi.currency.toUpperCase() : null,
    piAmount: pi.totalAmount,
    depositPercent: pay.depositPercent,
    depositAmount: pi.amountPayable,
    depositDueNote: pay.depositDueNote,
    depositDueDays: parseDepositDue(pay.depositDueNote)?.days ?? null,
    depositDueUnit: parseDepositDue(pay.depositDueNote)?.unit ?? null,
    lines: pi.lines.map((l) => ({
      grade: gradeOf(l.grade, l.description),
      sizeSpec: sizeSpecOf(l.sizeRaw, l.lengthRaw),
      product: pi.product ?? 'Aluminium Billet',
      quantityMt: l.quantityMt,
      tolerancePct: tol,
      supplierPremium: l.premium,
    })),
  };
}

export interface ShipmentDraft {
  contractNo: string | null;
  blNumber: string | null;
  shippingLine: string | null;
  vessel: string | null;
  voyageNo: string | null;
  etd: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  netWeightMt: number | null;
  grossWeightMt: number | null;
  totalBundles: number | null;
  totalPieces: number | null;
  containerCount: number | null;
  hsCode: string | null;
  countryOfOrigin: string | null;
  commodity: string | null;
  grade: string | null;
  sizeSpec: string | null;
  containers: BlRaw['containers'];
  consigneeText: string | null;
  notifyPartyText: string | null;
  freightTerms: string | null;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
/** B/L weights are usually printed in KG; contracts and shipments use MT. */
export function toMt(v: number | null, unit: string | null): number | null {
  if (v === null) return null;
  const u = (unit ?? '').toUpperCase();
  if (u.startsWith('KG') || (!u.startsWith('MT') && v > 1000)) return round3(v / 1000);
  return round3(v);
}

export function shipmentDraftFromBl(bl: BlRaw): ShipmentDraft {
  const containers = bl.containers.filter((c) => c.containerNo || c.sealNo);
  return {
    contractNo: bl.contractNo?.replace(/\s+/g, '') || null,
    blNumber: bl.blNumber?.replace(/\s+/g, '') || null,
    shippingLine: bl.shippingLine,
    vessel: bl.vessel,
    voyageNo: bl.voyageNo,
    etd: isoDate(bl.etd),
    portOfLoading: bl.portOfLoading,
    portOfDischarge: bl.portOfDischarge ?? bl.placeOfDelivery,
    netWeightMt: toMt(bl.netWeight, bl.weightUnit),
    grossWeightMt: toMt(bl.grossWeight, bl.weightUnit),
    totalBundles: bl.totalBundles,
    totalPieces: bl.totalPieces,
    containerCount: bl.containerCount ?? (containers.length || null),
    hsCode: bl.hsCode,
    countryOfOrigin: bl.countryOfOrigin,
    commodity: bl.commodity,
    grade: gradeOf(bl.grade, bl.commodity, bl.sizeSpec),
    sizeSpec: bl.sizeSpec && /INCH|"/i.test(bl.sizeSpec) ? sizeSpecOf(bl.sizeSpec) : bl.sizeSpec,
    containers,
    consigneeText: bl.consigneeText,
    notifyPartyText: bl.notifyPartyText,
    freightTerms: bl.freightTerms,
  };
}

/** The contract line a B/L ships: the one whose grade matches (only if exactly one does). */
export function lineForGrade<L extends { id: string; grade: string | null }>(lines: L[], grade: string | null): L | null {
  if (lines.length === 1) return lines[0];
  if (!grade) return null;
  const hits = lines.filter((l) => gradeOf(l.grade) === grade);
  return hits.length === 1 ? hits[0] : null;
}

// ── B/L checks ──────────────────────────────────────────────────────────────
export type ItemStatus = 'ok' | 'mismatch' | 'missing';
export type CheckStatus = 'ok' | 'issue' | 'missing' | 'info';
export interface CheckItem {
  item: string;
  expected: string;
  found: string | null;
  status: ItemStatus;
}
export interface BlCheck {
  key: 'consignee' | 'notifyParty' | 'contractNo' | 'grade' | 'weight' | 'pod' | 'fields';
  label: string;
  status: CheckStatus;
  detail: string;
  items?: CheckItem[];
}

/** Letters + digits only, upper case: line breaks, punctuation and words split across lines ("CENT, RE") vanish. */
export const compact = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

/** Legal-form words that don't make two names different ("WAN HAI LINES LTD." ≙ "Wan Hai Lines"). */
const COMPANY_SUFFIXES = new Set(['LTD', 'LIMITED', 'CO', 'COMPANY', 'CORP', 'CORPORATION', 'INC', 'INCORPORATED', 'PVT', 'PTE', 'PRIVATE', 'LLC', 'PLC', 'KK', 'GMBH', 'SDN', 'BHD']);
/** Generic words in a port / place name ("VISAKHAPATNAM PORT, INDIA" ≙ "Visakhapatnam, India"). */
const PLACE_NOISE = new Set(['PORT']);

/**
 * Loose comparison key: case, punctuation and spacing ignored, company
 * suffixes (and, for places, the word PORT) dropped — so only a real
 * difference in the name is flagged.
 */
export function looseKey(s: string | null | undefined, opts: { place?: boolean } = {}): string {
  return (s ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w && !COMPANY_SUFFIXES.has(w) && !(opts.place && PLACE_NOISE.has(w)))
    .join('');
}

/** Same name / place after looseKey (and not both empty). */
export const looselySame = (a: string | null | undefined, b: string | null | undefined, opts: { place?: boolean } = {}) => {
  const x = looseKey(a, opts);
  return x !== '' && x === looseKey(b, opts);
};

type PartyKey = 'company' | 'address' | 'phone' | 'taxId' | 'uen' | 'contact' | 'email';
const PARTY_LABEL: Record<PartyKey, string> = { company: 'Company name', address: 'Address', phone: 'Phone', taxId: 'Tax ID', uen: 'UEN', contact: 'Contact name', email: 'Email' };

/** Split an expected consignee / notify text into its key items. */
export function partyItems(text: string): Array<{ key: PartyKey; label: string; value: string }> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const out: Array<{ key: PartyKey; label: string; value: string }> = [{ key: 'company', label: PARTY_LABEL.company, value: lines[0] }];
  const after = (l: string) => l.replace(/^[^:]*:\s*/, '').trim();
  const address: string[] = [];
  for (const l of lines.slice(1)) {
    if (/^(PHONE|TEL|TELEPHONE|PH|MOBILE)\b/i.test(l)) out.push({ key: 'phone', label: PARTY_LABEL.phone, value: after(l) });
    else if (/^TAX\s*(ID|NO|NUMBER)\b/i.test(l)) out.push({ key: 'taxId', label: PARTY_LABEL.taxId, value: after(l) });
    else if (/^(UNIQUE ENTITY NUMBER|UEN)\b/i.test(l)) out.push({ key: 'uen', label: PARTY_LABEL.uen, value: after(l) });
    else if (/^CONTACT\b/i.test(l)) out.push({ key: 'contact', label: PARTY_LABEL.contact, value: after(l) });
    else if (/^E-?MAIL\b/i.test(l) || /\S+@\S+/.test(l)) out.push({ key: 'email', label: PARTY_LABEL.email, value: /:/.test(l) ? after(l) : l });
    else address.push(l.replace(/^ADDRESS\s*:\s*/i, ''));
  }
  if (address.length) out.splice(1, 0, { key: 'address', label: PARTY_LABEL.address, value: address.join('\n') });
  return out;
}

/** Phone digits with and without the country code ("+(81) 90-…" ≙ "+81 90…" ≙ "090-…"). */
function phoneFound(expected: string, foundText: string): boolean {
  const e = digits(expected);
  const f = digits(foundText);
  if (!e) return false;
  if (f.includes(e)) return true;
  for (const cc of ['81', '65', '91', '1', '86', '852']) {
    if (e.startsWith(cc) && e.length - cc.length >= 7 && f.includes(`0${e.slice(cc.length)}`)) return true;
    if (e.startsWith(cc) && e.length - cc.length >= 7 && f.includes(e.slice(cc.length))) return true;
  }
  return false;
}

/**
 * Compare the contract's consignee / notify text item by item against what the
 * B/L prints. ✓ = found (after normalising), ✗ = that kind of item is on the
 * B/L but differs, missing = not on the B/L at all.
 */
export function compareParty(label: string, key: 'consignee' | 'notifyParty', expected: string | null | undefined, found: string | null | undefined): BlCheck {
  if (!expected?.trim()) return { key, label, status: 'info', detail: `No ${label.toLowerCase()} on the contract to compare with` };
  const items = partyItems(expected);
  if (!found?.trim()) {
    return { key, label, status: 'missing', detail: `No ${label.toLowerCase()} read from the B/L`, items: items.map((i) => ({ item: i.label, expected: i.value, found: null, status: 'missing' })) };
  }
  const f = compact(found);
  const has = (re: RegExp) => re.test(found);
  const rows: CheckItem[] = items.map((i) => {
    let ok: boolean;
    let presentKind: boolean;
    switch (i.key) {
      case 'phone':
        ok = phoneFound(i.value, found);
        presentKind = has(/\b(PHONE|TEL|TELEPHONE|PH|MOBILE)\b/i);
        break;
      case 'taxId':
        ok = f.includes(compact(i.value));
        presentKind = has(/\bTAX\b/i);
        break;
      case 'uen':
        ok = f.includes(compact(i.value));
        presentKind = has(/\b(UEN|UNIQUE ENTITY)\b/i);
        break;
      case 'email':
        ok = f.includes(compact(i.value));
        presentKind = has(/@/);
        break;
      case 'contact':
        ok = f.includes(compact(i.value));
        presentKind = has(/\b(CONTACT|ATTN|ATTENTION)\b/i);
        break;
      case 'address': {
        const parts = i.value.split('\n').filter((p) => compact(p));
        const missing = parts.filter((p) => !f.includes(compact(p)));
        ok = !missing.length;
        presentKind = missing.length < parts.length;
        if (!ok && presentKind) return { item: i.label, expected: i.value, found: `differs: ${missing.join(' / ')}`, status: 'mismatch' };
        break;
      }
      default:
        // Company name: a missing / different legal suffix ("LLC." / "PTE. LTD.") is not a difference.
        ok = f.includes(compact(i.value)) || (looseKey(i.value) !== '' && looseKey(found).includes(looseKey(i.value)));
        presentKind = true;
    }
    return { item: i.label, expected: i.value, found: ok ? 'found' : null, status: ok ? 'ok' : presentKind ? 'mismatch' : 'missing' };
  });
  const bad = rows.filter((r) => r.status !== 'ok');
  return {
    key,
    label,
    status: bad.length ? 'issue' : 'ok',
    detail: bad.length ? bad.map((r) => `${r.item} ${r.status === 'missing' ? `${r.expected} missing on B/L` : 'differs'}`).join('; ') : 'Matches the contract',
    items: rows,
  };
}

const nearlyEqual = (a: number, b: number) => Math.abs(a - b) < 0.0005;

export interface CheckInputs {
  draft: ShipmentDraft;
  contract: { contractNo: string; consignee: string | null; notifyParty: string | null; destinationPort: string | null } | null;
  line: { grade: string | null; quantityMt: unknown; tolerancePct: unknown } | null;
  /** Net MT already shipped on the same line by OTHER shipments. */
  lineShippedElsewhereMt?: number;
  /** The saved shipment, to list fields edited after extraction (or never filled). */
  shipment?: Partial<Record<keyof ShipmentDraft, unknown>> | null;
}

const SHIPMENT_FIELDS: Array<[keyof ShipmentDraft, string, 'text' | 'num' | 'date']> = [
  ['blNumber', 'B/L no.', 'text'],
  ['shippingLine', 'Shipping line', 'text'],
  ['vessel', 'Vessel', 'text'],
  ['voyageNo', 'Voyage no.', 'text'],
  ['etd', 'ETD', 'date'],
  ['portOfLoading', 'Port of loading', 'text'],
  ['portOfDischarge', 'Port of discharge', 'text'],
  ['netWeightMt', 'Net weight (MT)', 'num'],
  ['grossWeightMt', 'Gross weight (MT)', 'num'],
  ['totalBundles', 'Bundles', 'num'],
  ['totalPieces', 'Pieces', 'num'],
  ['containerCount', 'Containers', 'num'],
  ['hsCode', 'HS code', 'text'],
  ['countryOfOrigin', 'Country of origin', 'text'],
];

const PLACE_FIELDS = new Set<keyof ShipmentDraft>(['portOfLoading', 'portOfDischarge', 'countryOfOrigin']);

const show = (v: unknown) => (v === null || v === undefined || v === '' ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

/** All advisory checks for a B/L draft. None of them blocks completing the step. */
export function blDraftChecks(input: CheckInputs): BlCheck[] {
  const { draft, contract, line } = input;
  const checks: BlCheck[] = [];
  checks.push(compareParty('Consignee', 'consignee', contract?.consignee, draft.consigneeText));
  checks.push(compareParty('Notify party', 'notifyParty', contract?.notifyParty, draft.notifyPartyText));

  // 3. Contract no.
  if (!contract) checks.push({ key: 'contractNo', label: 'Contract no.', status: 'info', detail: 'No contract to compare with' });
  // Vedanta's B/Ls don't print the contract no.: absent is informational; only a printed, different number is an issue.
  else if (!draft.contractNo) checks.push({ key: 'contractNo', label: 'Contract no.', status: 'info', detail: `Not printed on the B/L (contract ${contract.contractNo})` });
  else {
    const a = compact(draft.contractNo);
    const b = compact(contract.contractNo);
    const ok = a === b || a.includes(b) || b.includes(a);
    checks.push({
      key: 'contractNo',
      label: 'Contract no.',
      status: ok ? 'ok' : 'issue',
      detail: ok ? `${draft.contractNo} matches` : `B/L says ${draft.contractNo}, contract is ${contract.contractNo}`,
    });
  }

  // 4. Grade / commodity vs the selected line
  if (!line) checks.push({ key: 'grade', label: 'Grade / commodity', status: 'info', detail: 'No product line selected on the shipment' });
  else {
    const want = gradeOf(line.grade);
    const got = draft.grade ?? gradeOf(draft.commodity, draft.sizeSpec);
    if (!want) checks.push({ key: 'grade', label: 'Grade / commodity', status: 'info', detail: 'The product line has no grade' });
    else if (!got) checks.push({ key: 'grade', label: 'Grade / commodity', status: 'missing', detail: `Grade ${want} not found on the B/L` });
    else
      checks.push({
        key: 'grade',
        label: 'Grade / commodity',
        status: got === want ? 'ok' : 'issue',
        detail: got === want ? `Grade ${want} matches the line` : `B/L grade ${got}, line grade ${want}`,
      });
  }

  // 5. Net weight vs the line quantity ± tolerance (informational: a line ships over several B/Ls)
  const qty = line && line.quantityMt !== null && line.quantityMt !== undefined && line.quantityMt !== '' ? Number(line.quantityMt) : null;
  if (draft.netWeightMt === null) checks.push({ key: 'weight', label: 'Net weight vs line', status: 'missing', detail: 'No net weight read from the B/L' });
  else if (qty === null || !Number.isFinite(qty)) checks.push({ key: 'weight', label: 'Net weight vs line', status: 'info', detail: `${draft.netWeightMt} MT (the line has no quantity)` });
  else {
    const tol = line!.tolerancePct === null || line!.tolerancePct === undefined || line!.tolerancePct === '' ? 0 : Number(line!.tolerancePct);
    const total = round3((input.lineShippedElsewhereMt ?? 0) + draft.netWeightMt);
    const lo = round3(qty * (1 - tol / 100));
    const hi = round3(qty * (1 + tol / 100));
    const span = `${lo}–${hi} MT (${qty} MT ±${tol}%)`;
    if (total > hi + 0.0005) checks.push({ key: 'weight', label: 'Net weight vs line', status: 'issue', detail: `Line total with this B/L is ${total} MT — over ${span}` });
    else if (total >= lo - 0.0005) checks.push({ key: 'weight', label: 'Net weight vs line', status: 'ok', detail: `Line total ${total} MT is within ${span}` });
    else checks.push({ key: 'weight', label: 'Net weight vs line', status: 'info', detail: `This B/L ${draft.netWeightMt} MT; line total so far ${total} of ${span} — more B/Ls expected` });
  }

  // 6. POD vs contract destination port
  if (!contract?.destinationPort) checks.push({ key: 'pod', label: 'Port of discharge', status: 'info', detail: 'The contract has no destination port' });
  else if (!draft.portOfDischarge) checks.push({ key: 'pod', label: 'Port of discharge', status: 'missing', detail: 'No port of discharge read from the B/L' });
  else {
    const a = looseKey(draft.portOfDischarge, { place: true });
    const b = looseKey(contract.destinationPort, { place: true });
    const ok = !!a && !!b && (a.includes(b) || b.includes(a));
    checks.push({
      key: 'pod',
      label: 'Port of discharge',
      status: ok ? 'ok' : 'issue',
      detail: ok ? `${draft.portOfDischarge} matches ${contract.destinationPort}` : `B/L ${draft.portOfDischarge}, contract ${contract.destinationPort}`,
    });
  }

  // 7. Saved shipment vs what the B/L says
  if (input.shipment) {
    const items: CheckItem[] = [];
    for (const [k, label, kind] of SHIPMENT_FIELDS) {
      const bl = draft[k] as unknown;
      if (bl === null || bl === undefined || bl === '') continue;
      const sv = input.shipment[k];
      const same =
        kind === 'num'
          ? sv !== null && sv !== undefined && sv !== '' && nearlyEqual(Number(sv), Number(bl))
          : kind === 'date'
            ? show(sv)?.slice(0, 10) === String(bl).slice(0, 10)
            : compact(show(sv)) === compact(String(bl)) || looselySame(show(sv), String(bl), { place: PLACE_FIELDS.has(k) });
      if (!same) items.push({ item: label, expected: String(bl), found: show(sv), status: show(sv) === null ? 'missing' : 'mismatch' });
    }
    // A value that differs is an issue (edited after the read, or a typo);
    // one the shipment simply hasn't filled yet is only listed.
    const differ = items.filter((i) => i.status === 'mismatch');
    const empty = items.filter((i) => i.status === 'missing');
    const parts = [
      differ.length ? `${differ.length} field(s) differ from the B/L: ${differ.map((i) => i.item).join(', ')}` : null,
      empty.length ? `${empty.length} B/L value(s) not on the shipment yet: ${empty.map((i) => i.item).join(', ')}` : null,
    ].filter(Boolean);
    checks.push({
      key: 'fields',
      label: 'Shipment vs B/L',
      status: differ.length ? 'issue' : empty.length ? 'info' : 'ok',
      detail: parts.length ? parts.join('. ') : 'Shipment fields match the B/L',
      items,
    });
  }
  return checks;
}

/** Issues shown on the chip: failing party items and differing shipment fields count one each; info never counts. */
export function issueCount(checks: BlCheck[]): number {
  return checks.reduce((n, c) => {
    if (c.status === 'ok' || c.status === 'info') return n;
    if (c.key === 'fields') return n + (c.items ?? []).filter((i) => i.status === 'mismatch').length;
    if (c.items?.length && (c.key === 'consignee' || c.key === 'notifyParty')) return n + c.items.filter((i) => i.status !== 'ok').length;
    return n + 1;
  }, 0);
}

// ── Arrival notice ──────────────────────────────────────────────────────────
// The shipping line's arrival notice (WAN HAI's A/N): vessel arriving at the
// destination, ETA, CY terminal, containers + seals, weights, bundles, pieces
// and the charges collect. A transhipped cargo prints the feeder vessel too —
// the arriving one is the "VSL/VOY" line.
export const AN_SCHEMA = z.object({
  blNumber: nstr.default(null),
  vessel: nstr.default(null),
  voyageNo: nstr.default(null),
  tsVessel: nstr.default(null),
  tsVoyageNo: nstr.default(null),
  cbm: nnum.default(null),
  telexRelease: z.boolean().nullable().default(null),
  eta: nstr.default(null),
  cyTerminal: nstr.default(null),
  portOfLoading: nstr.default(null),
  portOfDischarge: nstr.default(null),
  grossWeightKg: nnum.default(null),
  netWeightKg: nnum.default(null),
  totalBundles: nint.default(null),
  totalPieces: nint.default(null),
  containerCount: nint.default(null),
  containers: z
    .array(z.object({ containerNo: nstr.default(null), sealNo: nstr.default(null), size: nstr.default(null) }))
    .nullable()
    .default([])
    .transform((v) => v ?? []),
  charges: z
    .array(
      z.object({
        code: nstr.default(null),
        unit: nnum.default(null),
        rate: nnum.default(null),
        amount: nnum.default(null),
        currency: nstr.default(null),
        collect: z.boolean().nullable().default(null),
      }),
    )
    .nullable()
    .default([])
    .transform((v) => v ?? []),
});
export type AnRaw = z.infer<typeof AN_SCHEMA>;

export const AN_SYSTEM_PROMPT =
  'You read shipping-line Arrival Notices (A/N) for containerised aluminium billet cargo arriving in Japan. The PDF may be a scanned image — read the page images. Transcribe exactly what is printed; never invent values — use null when absent. Output STRICT JSON only.';

export const AN_USER_PROMPT = `Extract this Arrival Notice into exactly this JSON (null when absent):
{
  "blNumber": "B/L number",
  "vessel": "the B/L's vessel — the \\"VSL/VOY\\" line, name only",
  "voyageNo": "its voyage number only",
  "tsVessel": "when transhipped: the vessel ARRIVING at the destination (printed between the port of loading and the port of discharge, often with its voyage glued in front, e.g. N044WAN HAI 365 → WAN HAI 365); null when the same as vessel",
  "tsVoyageNo": "that vessel's voyage (e.g. N044)",
  "cbm": "measurement in CBM as a number",
  "telexRelease": "true when the notice says TELEX RELEASE / SURRENDERED",
  "eta": "estimated arrival date as YYYY-MM-DD",
  "cyTerminal": "CY terminal as printed (name, without phone / fax)",
  "portOfLoading": "as printed",
  "portOfDischarge": "as printed",
  "grossWeightKg": "total gross weight in KG as a number",
  "netWeightKg": "total net weight in KG as a number, if printed",
  "totalBundles": "total bundles (BDL) as a number",
  "totalPieces": "total pieces as a number, if printed",
  "containers": [{ "containerNo": "e.g. BMOU1217219", "sealNo": "seal no.", "size": "e.g. 20SD86" }],
  "charges": [{ "code": "charge code, e.g. THC / DOC / EQMC", "unit": "units (e.g. containers) or null", "rate": "rate per unit or null", "amount": "the line total", "currency": "e.g. JPY", "collect": "true when in the COLLECT column, false when prepaid" }]
}`;

/** What the A/N gives the shipment (MT, as the shipment stores weights) plus the rest for display. */
export interface ArrivalNoticeDraft {
  blNumber: string | null;
  vessel: string | null;
  voyageNo: string | null;
  /** Transhipped: the vessel arriving in Japan (= 積載船 on the import permit). */
  tsVessel: string | null;
  tsVoyageNo: string | null;
  eta: string | null;
  cyTerminal: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  grossWeightMt: number | null;
  netWeightMt: number | null;
  totalBundles: number | null;
  totalPieces: number | null;
  containerCount: number | null;
  cbm: number | null;
  telexRelease: boolean | null;
  containers: Array<{ containerNo: string | null; sealNo: string | null; size: string | null }>;
  charges: Array<{ code: string | null; unit: number | null; rate: number | null; amount: number | null; currency: string | null; collect: boolean | null }>;
  /** Sum of the collect charges per currency ("JPY 232,800"). */
  chargesCollect: Array<{ currency: string; amount: number }>;
}

const kgToMt = (kg: number | null) => (kg === null || !Number.isFinite(kg) ? null : Math.round(kg) / 1000);

export function arrivalNoticeDraft(an: AnRaw): ArrivalNoticeDraft {
  const containers = an.containers.filter((c) => c.containerNo).map((c) => ({ containerNo: c.containerNo ?? null, sealNo: c.sealNo ?? null, size: c.size ?? null }));
  const charges = an.charges.map((c) => ({
    code: c.code ? c.code.toUpperCase() : null,
    unit: c.unit ?? null,
    rate: c.rate ?? null,
    amount: c.amount ?? null,
    currency: c.currency ?? null,
    collect: c.collect ?? null,
  }));
  const totals = new Map<string, number>();
  for (const c of charges) {
    if (c.collect !== true || c.amount === null) continue;
    const cur = (c.currency ?? '').toUpperCase() || '—';
    totals.set(cur, Math.round(((totals.get(cur) ?? 0) + c.amount) * 100) / 100);
  }
  return {
    blNumber: an.blNumber?.replace(/\s+/g, '') || null,
    vessel: an.vessel,
    voyageNo: an.voyageNo,
    tsVessel: an.tsVessel && an.tsVessel !== an.vessel ? an.tsVessel : null,
    tsVoyageNo: an.tsVessel && an.tsVessel !== an.vessel ? an.tsVoyageNo : null,
    eta: isoDate(an.eta),
    cyTerminal: an.cyTerminal,
    portOfLoading: an.portOfLoading,
    portOfDischarge: an.portOfDischarge,
    grossWeightMt: kgToMt(an.grossWeightKg),
    netWeightMt: kgToMt(an.netWeightKg),
    totalBundles: an.totalBundles,
    totalPieces: an.totalPieces,
    containerCount: containers.length || an.containerCount || null,
    cbm: an.cbm,
    telexRelease: an.telexRelease,
    containers,
    charges,
    chargesCollect: [...totals].map(([currency, amount]) => ({ currency, amount })),
  };
}

/** Estimator inputs (step 9) from the A/N's charge lines: THC / DOC / EQMC in JPY (EQMC is also the import-tax 加算運賃). */
export function anCostInputs(draft: Pick<ArrivalNoticeDraft, 'charges'>): { thc: number | null; docFee: number | null; equipmentFee: number | null } {
  const pick = (code: string) => {
    const hits = draft.charges.filter((c) => c.code === code && (c.currency ?? 'JPY').toUpperCase() === 'JPY' && c.amount !== null);
    return hits.length ? hits.reduce((a, c) => a + (c.amount as number), 0) : null;
  };
  return { thc: pick('THC'), docFee: pick('DOC'), equipmentFee: pick('EQMC') };
}

/** Shipment fields still blank that the A/N can fill (the user confirms before anything is written). */
export const AN_FILL_FIELDS = ['vessel', 'voyageNo', 'eta', 'grossWeightMt', 'netWeightMt', 'totalBundles', 'totalPieces', 'containerCount', 'portOfLoading', 'portOfDischarge'] as const;
export function anFillable(draft: ArrivalNoticeDraft, shipment: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of AN_FILL_FIELDS) {
    const v = draft[k];
    const cur = shipment[k];
    if (v !== null && v !== undefined && (cur === null || cur === undefined || cur === '')) out[k] = v;
  }
  return out;
}

/** A Wan Hai A/N read from its text layer (trade-customs.ts), in the AI read's shape. */
export function anRawFromText(d: AnData): AnRaw {
  return {
    blNumber: d.blNumber,
    vessel: d.vessel,
    voyageNo: d.voyageNo,
    tsVessel: d.tsVessel,
    tsVoyageNo: d.tsVoyageNo,
    cbm: d.cbm,
    telexRelease: d.telexRelease,
    eta: d.eta,
    cyTerminal: d.cyTerminal,
    portOfLoading: null,
    portOfDischarge: null,
    grossWeightKg: d.grossWeightKg,
    netWeightKg: null,
    totalBundles: d.bundles,
    totalPieces: null,
    containerCount: d.containerCount,
    containers: [],
    charges: d.charges.map((c) => ({ code: c.code, unit: c.unit, rate: c.rate, amount: c.total, currency: c.currency, collect: true })),
  };
}

// ── 輸入許可書 (import permit) — the AI read for scans / other layouts ─────────
export const PERMIT_SCHEMA = z.object({
  declarationNo: nstr.default(null),
  declarationDate: nstr.default(null),
  blNumber: nstr.default(null),
  packages: nint.default(null),
  grossWeightKg: nnum.default(null),
  containerCount: nint.default(null),
  vessel: nstr.default(null),
  invoiceNo: nstr.default(null),
  invoiceTerms: nstr.default(null),
  invoiceCurrency: nstr.default(null),
  invoiceAmount: nnum.default(null),
  addOnJpy: nnum.default(null),
  fxRate: nnum.default(null),
  customsValue: nnum.default(null),
  national: nnum.default(null),
  local: nnum.default(null),
  total: nnum.default(null),
});
export type PermitRaw = z.infer<typeof PERMIT_SCHEMA>;

export const PERMIT_SYSTEM_PROMPT =
  'You read Japanese customs import permits (輸入許可書 / 輸入許可通知書, NACCS layout) for aluminium cargo. The PDF may be a scan — read the page images. Transcribe exactly what is printed; never compute or invent values — use null when absent. Output STRICT JSON only.';

export const PERMIT_USER_PROMPT = `Extract this import permit into exactly this JSON (null when absent; numbers without commas or ¥):
{
  "declarationNo": "申告番号 (11 digits, no spaces)",
  "declarationDate": "申告年月日 as YYYY-MM-DD",
  "blNumber": "B/L番号 as printed",
  "packages": "貨物個数 (number of packages)",
  "grossWeightKg": "貨物重量 in KG",
  "containerCount": "コンテナ本数",
  "vessel": "積載船 (vessel name)",
  "invoiceNo": "仕入書番号 (invoice no.)",
  "invoiceTerms": "仕入書価格 terms, e.g. CIF",
  "invoiceCurrency": "仕入書価格 currency, e.g. USD",
  "invoiceAmount": "仕入書価格 amount",
  "addOnJpy": "運賃 adjustment in JPY (the line coded E - JPY - …)",
  "fxRate": "通貨レート (customs rate, 円 per unit of the invoice currency)",
  "customsValue": "申告価格 / 課税価格 in JPY",
  "national": "消費税 amount (after rounding to 100 yen)",
  "local": "地方消費税 amount (after rounding to 100 yen)",
  "total": "納税額合計 in JPY"
}`;

export function permitFromRaw(raw: PermitRaw): PermitData {
  const v = <T>(x: T | undefined) => (x === undefined ? null : x);
  return {
    declarationNo: v(raw.declarationNo)?.replace(/\s+/g, '') ?? null,
    declarationDate: isoDate(raw.declarationDate),
    blNumber: v(raw.blNumber),
    packages: v(raw.packages),
    grossWeightKg: v(raw.grossWeightKg),
    containerCount: v(raw.containerCount),
    vessel: v(raw.vessel),
    invoiceNo: raw.invoiceNo?.replace(/-+$/, '') ?? null,
    invoiceTerms: v(raw.invoiceTerms),
    invoiceCurrency: v(raw.invoiceCurrency),
    invoiceAmount: v(raw.invoiceAmount),
    addOnJpy: v(raw.addOnJpy),
    fxRate: v(raw.fxRate),
    customsValue: v(raw.customsValue),
    national: v(raw.national),
    local: v(raw.local),
    total: v(raw.total),
  };
}
