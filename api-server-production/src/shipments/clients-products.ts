/**
 * Round BA — Clients › Products and Packing (customer AND supplier profiles).
 *
 * One row per product the customer buys / the supplier sells: grade, form,
 * size, spec reference, chemistry limits, tolerances, bundle data, monthly
 * quantity, price basis, notes; with spec sheets and packing photos. Plus a
 * per-company Packing gallery, packing notes and linked issues (e.g. Sankyo
 * Tateyama's geta / base ingots). Stored on the trade profile JSON
 * (TradeSetting.customerProfiles / supplierProfiles) and written by the
 * Clients service only — a settings save never adds or changes them. Files
 * are S3 objects; hiding never deletes (rows and files are kept).
 */

export const PRODUCT_FORMS = ['BILLET', 'INGOT', 'REMELT_INGOT', 'SCRAP', 'OTHER'] as const;
export type ProductForm = (typeof PRODUCT_FORMS)[number];

/** An uploaded file kept on the profile (spec sheet or packing photo). */
export interface ProfileFile {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  s3Key: string;
  uploadedAt: string;
  uploadedByName?: string | null;
  /** Packing photos: what it shows ("strapping", "geta / base ingots") and when it was taken. */
  caption?: string | null;
  takenOn?: string | null;
  hidden?: boolean;
}

export interface ChemLimit {
  element: string;
  min?: number | null;
  max?: number | null;
}

export interface ClientProduct {
  id: string;
  grade?: string | null;
  form?: ProductForm | null;
  diameterMm?: number | null;
  lengthMm?: number | null;
  /** Free size text when it isn't diameter × length ("1000 × 500 × 80"). */
  sizeText?: string | null;
  standard?: string | null;
  chemistry?: ChemLimit[];
  tolerances?: string | null;
  piecesPerBundle?: number | null;
  bundleWeightKg?: number | null;
  monthlyQtyMt?: number | null;
  /** "LME + premium", "MJP + premium", "upcharge 30 USD/t"… */
  priceBasis?: string | null;
  notes?: string | null;
  /**
   * Round BF: how the product prints on the 出庫・納入依頼書 — Japanese lines, English lines (one per line, printed
   * "(High speed)" under its Japanese line) and the size ("152×5800"). Empty = today's text.
   */
  docNameJa?: string | null;
  docNameEn?: string | null;
  docSize?: string | null;
  specFiles?: ProfileFile[];
  packingImages?: ProfileFile[];
  /** Where a seeded row came from ("order #21, contract 454003255") and what is still to confirm. */
  source?: string | null;
  toConfirm?: string[];
  hidden?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface PackingInfo {
  notes?: string | null;
  images?: ProfileFile[];
  /** Linked issue ids (the general issues list), e.g. a customer's packing complaint. */
  issueIds?: string[];
}

const ELEMENT = /^[A-Z][a-z]?$/;
const text = (v: unknown, max: number): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
const num = (v: unknown, max = 1e9): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
};

/** "152 × 5800", "152x5800 mm", "203 MM X 5800 MM" → { d: 152, l: 5800 }. */
export function parseSize(s: string | null | undefined): { diameterMm: number; lengthMm: number } | null {
  const m = /(\d+(?:\.\d+)?)\s*(?:mm)?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(?:mm)?/i.exec(s ?? '');
  return m ? { diameterMm: Number(m[1]), lengthMm: Number(m[2]) } : null;
}

/** "152 × 5800" (or the free size text). */
export const productSize = (p: Pick<ClientProduct, 'diameterMm' | 'lengthMm' | 'sizeText'>) =>
  p.diameterMm && p.lengthMm ? `${p.diameterMm} × ${p.lengthMm}` : p.sizeText ?? '';

/** "6063 billet 152 × 5800". */
export const productLabel = (p: ClientProduct) =>
  [p.grade, p.form ? p.form.toLowerCase().replace('_', ' ') : null, productSize(p)].filter(Boolean).join(' ');

/**
 * Validate one product from the screen. Ids, files, source and timestamps are
 * the server's: kept from `prev` (an edit) or new. Throws via `bad`.
 */
export function cleanProduct(raw: unknown, prev: ClientProduct | undefined, id: string, now: string, bad: (m: string) => never): ClientProduct {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('A product must be an object');
  const r = raw as Record<string, unknown>;
  const form = r.form === undefined || r.form === null || r.form === '' ? null : String(r.form);
  if (form && !(PRODUCT_FORMS as readonly string[]).includes(form)) bad(`Unknown form "${form}"`);
  const chemistry: ChemLimit[] = [];
  if (r.chemistry !== undefined && r.chemistry !== null) {
    if (!Array.isArray(r.chemistry)) bad('chemistry must be a list');
    for (const c of r.chemistry as unknown[]) {
      const e = c as Record<string, unknown>;
      const element = text(e?.element, 3);
      if (!element) continue;
      if (!ELEMENT.test(element)) bad(`"${element}" is not an element symbol`);
      const min = num(e.min, 100);
      const max = num(e.max, 100);
      if (min === null && max === null) continue;
      if (min !== null && max !== null && min > max) bad(`${element}: min is above max`);
      chemistry.push({ element, min, max });
    }
  }
  let diameterMm = num(r.diameterMm, 5000);
  let lengthMm = num(r.lengthMm, 50000);
  const sizeText = text(r.sizeText, 80);
  if ((diameterMm === null || lengthMm === null) && sizeText) {
    const s = parseSize(sizeText);
    if (s) ({ diameterMm, lengthMm } = s);
  }
  const p: ClientProduct = {
    id,
    grade: text(r.grade, 40),
    form: (form as ProductForm) ?? null,
    diameterMm,
    lengthMm,
    sizeText: diameterMm && lengthMm ? null : sizeText,
    standard: text(r.standard, 200),
    chemistry,
    tolerances: text(r.tolerances, 1000),
    piecesPerBundle: num(r.piecesPerBundle, 10000),
    bundleWeightKg: num(r.bundleWeightKg, 100000),
    monthlyQtyMt: num(r.monthlyQtyMt, 1e6),
    priceBasis: text(r.priceBasis, 200),
    notes: text(r.notes, 4000),
    // A caller that doesn't send the document name (older screens) keeps it.
    docNameJa: r.docNameJa === undefined ? (prev?.docNameJa ?? null) : text(r.docNameJa, 200),
    docNameEn: r.docNameEn === undefined ? (prev?.docNameEn ?? null) : text(r.docNameEn, 200),
    docSize: r.docSize === undefined ? (prev?.docSize ?? null) : text(r.docSize, 40),
    specFiles: prev?.specFiles ?? [],
    packingImages: prev?.packingImages ?? [],
    source: prev?.source ?? null,
    // Fields still "to confirm" (a seeded row): editing one clears it.
    toConfirm: (prev?.toConfirm ?? []).filter((k) => r[k] === undefined || JSON.stringify(r[k]) === JSON.stringify((prev as unknown as Record<string, unknown> | undefined)?.[k])),
    hidden: prev?.hidden ?? false,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  if (!p.grade && !p.form && !productSize(p) && !p.notes) bad('Give the product at least a grade, form, size or note');
  return p;
}

/** Packing notes / linked issues from the screen (images are added by upload only). */
export function cleanPacking(raw: unknown, prev: PackingInfo | undefined, bad: (m: string) => never): PackingInfo {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('Packing must be an object');
  const r = raw as Record<string, unknown>;
  let issueIds = prev?.issueIds ?? [];
  if (r.issueIds !== undefined) {
    if (!Array.isArray(r.issueIds) || !r.issueIds.every((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x))) bad('issueIds must be a list of issue ids');
    issueIds = [...new Set(r.issueIds as string[])];
  }
  return {
    notes: r.notes === undefined ? prev?.notes ?? null : text(r.notes, 4000),
    images: prev?.images ?? [],
    issueIds,
  };
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').toUpperCase();

/**
 * How well a supplier product fits a customer product: "exact" (grade, form
 * and size), "grade" (grade + form, other size) or null. Unknown parts don't
 * block a match (a product without a size matches on grade + form).
 */
export function productMatch(want: ClientProduct, have: ClientProduct): 'exact' | 'grade' | null {
  if (have.hidden) return null;
  if (want.grade && have.grade && norm(want.grade) !== norm(have.grade)) return null;
  if (want.form && have.form && want.form !== have.form) return null;
  if (!want.grade && !want.form) return null;
  const ws = norm(productSize(want));
  const hs = norm(productSize(have));
  return ws && hs && ws !== hs ? 'grade' : 'exact';
}
