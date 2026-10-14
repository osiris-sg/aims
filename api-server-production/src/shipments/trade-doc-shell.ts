/**
 * Shared HTML shell for every in-app trade document: the embedded Japanese
 * font (only the glyphs the page uses) and A4 base styles. No DRAFT
 * watermark — drafts and finalized documents print the same (ADH 2026-10);
 * `draft` is kept in the signature for callers but no longer changes the page.
 */
import { DOC_FONT_STACK, japaneseFontCss } from './trade-doc-font';

export const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Multi-line text → escaped HTML with <br>. */
export const lines = (v: unknown) => esc(v).replace(/\r?\n/g, '<br>');

const stripTags = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');

export function docShell(opts: { title: string; css: string; body: string; draft?: boolean }): string {
  // Glyphs needed: the visible text plus fallback characters.
  const fontCss = japaneseFontCss(`${stripTags(opts.body)}${opts.title}0123456789.,-()%/:`);
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(opts.title)}</title><style>
${fontCss}
@page { size: A4; margin: 12mm 11mm 14mm 11mm; }
* { box-sizing: border-box; }
html, body { margin: 0; }
body { font-family: ${DOC_FONT_STACK}; color: #111; font-size: 9pt; line-height: 1.35; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@media screen { body { padding: 10mm 9mm; background: #fff; } }
table { border-collapse: collapse; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.muted { color: #555; }
.pre { white-space: pre-line; }
${opts.css}
</style></head><body>${opts.body}</body></html>`;
}

// ── formatting shared by the templates ─────────────────────────────────────
const sign = (n: number) => (n < 0 ? '-' : '');
/** 1,234.56 (2 dp), negative with a leading minus; '' for null. */
export const money = (v: number | null | undefined, dp = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? '' : `${sign(v)}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
/** Quantities: up to 3 dp, no trailing zeros. */
export const qty = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '' : `${sign(v)}${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 3 })}`);
/** "2026-07-10" → "2026年7月10日". */
export const jpDate = (d: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '');
  return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : esc(d ?? '');
};
/** "2026-07-10" → "10 Jul 2026". */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const enDate = (d: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '');
  return m ? `${Number(m[3])} ${MON[Number(m[2]) - 1]} ${m[1]}` : esc(d ?? '');
};
