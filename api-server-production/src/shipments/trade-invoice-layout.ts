/**
 * Round BN — where the 請求書's company seal and the From (address) block sit on the page, adjustable by the user
 * (Sayaka, 2026-11-09: the stamp covered the address on the 11/6 draft). The 請求書 layout itself is fixed in code
 * (trade-invoice.ts renderInvoiceHtml, trade-invoice-single.ts); these are offsets on top of it.
 *
 * Stored: org default = TradeSetting.docDefaults.invoiceLayout; per customer = customerProfiles[id].docFormats.INVOICE.layout
 * (a customer value wins field by field over the org's, which wins over the built-in default). Applied at render time,
 * so a FINAL invoice (its stored PDF) never changes.
 *
 * Built-in default (ADH's own Oct 請求書): the seal sits to the RIGHT of the From block, level with its first line (the
 * company name). The block keeps a right padding as wide as the seal, so with zero offsets the seal never covers text.
 */

export type FromAlign = 'right' | 'left';

export interface InvoiceLayout {
  /** Seal offset from its default place, mm: + = right / down. */
  sealX: number;
  sealY: number;
  /** Seal width, mm (height follows the image). */
  sealSize: number;
  /** From block text alignment. */
  fromAlign: FromAlign;
  /** From block offset, mm: + = right / down. */
  fromX: number;
  fromY: number;
}

export const DEFAULT_INVOICE_LAYOUT: InvoiceLayout = { sealX: 0, sealY: 0, sealSize: 17, fromAlign: 'right', fromX: 0, fromY: 0 };

/** Allowed ranges (mm). Offsets stay on the page; the seal stays legible. */
export const LAYOUT_LIMITS = {
  offset: { min: -40, max: 40 },
  sealSize: { min: 10, max: 35 },
} as const;

export const LAYOUT_NUMBER_KEYS = ['sealX', 'sealY', 'sealSize', 'fromX', 'fromY'] as const;
export type LayoutNumberKey = (typeof LAYOUT_NUMBER_KEYS)[number];

/** Labels for change summaries (EN / JA). */
export const LAYOUT_LABELS: Record<keyof InvoiceLayout, { en: string; ja: string }> = {
  sealX: { en: 'Stamp left/right', ja: '印影 左右' },
  sealY: { en: 'Stamp up/down', ja: '印影 上下' },
  sealSize: { en: 'Stamp size', ja: '印影サイズ' },
  fromAlign: { en: 'Address alignment', ja: '住所の揃え' },
  fromX: { en: 'Address left/right', ja: '住所 左右' },
  fromY: { en: 'Address up/down', ja: '住所 上下' },
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (k: LayoutNumberKey, n: number) => {
  const r = k === 'sealSize' ? LAYOUT_LIMITS.sealSize : LAYOUT_LIMITS.offset;
  return round1(Math.min(r.max, Math.max(r.min, n)));
};

/**
 * A stored / posted layout, cleaned: only known keys, numbers in range (mm, 0.1 steps), align right|left. `fail` is
 * called for a value that is not a number / not an alignment (out-of-range numbers are an error too, so the user
 * sees why). Returns a PARTIAL layout (unset keys inherit); null when nothing is set.
 */
export function cleanInvoiceLayout(raw: unknown, fail: (msg: string) => never): Partial<InvoiceLayout> | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) fail('layout must be an object');
  const r = raw as Record<string, unknown>;
  const out: Partial<InvoiceLayout> = {};
  for (const k of Object.keys(r)) if (!(k in DEFAULT_INVOICE_LAYOUT)) fail(`Unknown layout setting "${k}"`);
  for (const k of LAYOUT_NUMBER_KEYS) {
    const v = r[k];
    if (v === undefined || v === null || v === '') continue;
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) fail(`${k} must be a number (mm)`);
    const lim = k === 'sealSize' ? LAYOUT_LIMITS.sealSize : LAYOUT_LIMITS.offset;
    if (n < lim.min || n > lim.max) fail(`${k} must be between ${lim.min} and ${lim.max} mm`);
    out[k] = round1(n);
  }
  if (r.fromAlign !== undefined && r.fromAlign !== null && r.fromAlign !== '') {
    if (r.fromAlign !== 'right' && r.fromAlign !== 'left') fail('fromAlign must be "right" or "left"');
    out.fromAlign = r.fromAlign;
  }
  return Object.keys(out).length ? out : null;
}

/** Lenient read of a stored value (never throws): bad keys / values are dropped. */
export function readInvoiceLayout(raw: unknown): Partial<InvoiceLayout> | null {
  try {
    return cleanInvoiceLayout(raw, (m) => {
      throw new Error(m);
    });
  } catch {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const out: Partial<InvoiceLayout> = {};
    for (const k of LAYOUT_NUMBER_KEYS) {
      const n = Number(r[k]);
      if (r[k] !== null && r[k] !== undefined && r[k] !== '' && Number.isFinite(n)) out[k] = clamp(k, n);
    }
    if (r.fromAlign === 'left' || r.fromAlign === 'right') out.fromAlign = r.fromAlign;
    return Object.keys(out).length ? out : null;
  }
}

/**
 * The single invoice's (Kato / Hoei) built-in placement: its From block is left-aligned as on Kato's sample. Its
 * approved print is kept as it was until a layout is saved (renderSingleInvoiceHtml only applies a saved one).
 */
export const SINGLE_INVOICE_LAYOUT: InvoiceLayout = { ...DEFAULT_INVOICE_LAYOUT, fromAlign: 'left' };

/** The layout in force: customer over org over the built-in default (`base`), key by key. */
export function resolveInvoiceLayout(org?: Partial<InvoiceLayout> | null, customer?: Partial<InvoiceLayout> | null, base: InvoiceLayout = DEFAULT_INVOICE_LAYOUT): InvoiceLayout {
  return { ...base, ...(readInvoiceLayout(org) ?? {}), ...(readInvoiceLayout(customer) ?? {}) };
}

export interface LayoutChange {
  /** Relative moves, mm ("move the stamp 8 mm right" = { sealX: 8 }). */
  move?: Partial<Record<LayoutNumberKey, number>>;
  /** Absolute values. */
  set?: Partial<InvoiceLayout>;
}

/** Apply a change to the layout in force; numbers clamped to the limits. Returns the new full layout. */
export function applyLayoutChange(current: InvoiceLayout, change: LayoutChange): InvoiceLayout {
  const next: InvoiceLayout = { ...current };
  for (const k of LAYOUT_NUMBER_KEYS) {
    const s = change.set?.[k];
    if (s !== undefined && s !== null && Number.isFinite(Number(s))) next[k] = clamp(k, Number(s));
    const m = change.move?.[k];
    if (m !== undefined && m !== null && Number.isFinite(Number(m))) next[k] = clamp(k, next[k] + Number(m));
  }
  if (change.set?.fromAlign === 'left' || change.set?.fromAlign === 'right') next.fromAlign = change.set.fromAlign;
  return next;
}

/** The keys whose value differs from `base` (what a scope stores: only what it overrides). */
export function layoutDiff(base: InvoiceLayout, next: InvoiceLayout): Partial<InvoiceLayout> {
  const out: Partial<InvoiceLayout> = {};
  for (const k of Object.keys(DEFAULT_INVOICE_LAYOUT) as Array<keyof InvoiceLayout>) if (next[k] !== base[k]) (out as any)[k] = next[k];
  return out;
}

const mm = (n: number) => `${n > 0 ? '+' : ''}${n} mm`;
const val = (k: keyof InvoiceLayout, v: InvoiceLayout[keyof InvoiceLayout], lang: 'en' | 'ja') =>
  k === 'fromAlign' ? (v === 'left' ? (lang === 'ja' ? '左揃え' : 'left') : lang === 'ja' ? '右揃え' : 'right') : k === 'sealSize' ? `${v} mm` : mm(v as number);

/** "Stamp left/right: 0 mm → +8 mm" lines for a Confirm card / log. */
export function describeLayoutChange(before: InvoiceLayout, after: InvoiceLayout, lang: 'en' | 'ja' = 'en'): string[] {
  return (Object.keys(DEFAULT_INVOICE_LAYOUT) as Array<keyof InvoiceLayout>)
    .filter((k) => before[k] !== after[k])
    .map((k) => `${LAYOUT_LABELS[k][lang]}: ${val(k, before[k], lang)} → ${val(k, after[k], lang)}`);
}

/**
 * CSS for the From block + seal (appended after the template's own CSS, so it wins). The seal is anchored at the top
 * right of the From block, inside the block's right padding (as wide as the seal + 2 mm), its middle level with the
 * first line (the company name, ~4.5 mm high at 8.3pt × 1.55).
 */
export function invoiceLayoutCss(layout: InvoiceLayout, opts: { firstLineMm?: number } = {}): string {
  const l = { ...DEFAULT_INVOICE_LAYOUT, ...(readInvoiceLayout(layout) ?? {}) };
  const line = opts.firstLineMm ?? 4.5;
  // Most seals are square: the middle of a W-mm seal sits W/2 below its top.
  const top = round1(line / 2 - l.sealSize / 2 + l.sealY);
  return `
.from { position: relative; text-align: ${l.fromAlign}; padding-right: ${round1(l.sealSize + 2)}mm; left: ${l.fromX}mm; top: ${l.fromY}mm; }
.from .seal { position: absolute; right: ${round1(-l.sealX)}mm; top: ${top}mm; bottom: auto; width: ${l.sealSize}mm; height: auto; opacity: .92; }
`;
}
