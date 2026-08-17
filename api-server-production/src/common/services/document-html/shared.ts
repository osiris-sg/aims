/**
 * Shared primitives for the server-side port of the portal's document preview
 * (`portal-production/containers/DocumentTemplates/components/CleanDocumentPreview.tsx`).
 *
 * Goal: server-generated PDFs (Telegram/operator, pay page, emailed docs) look
 * the same as what users see and print from the portal. The portal builds its
 * design with MUI `sx`, so these helpers restate those computed values as plain
 * CSS. MUI spacing unit = 8px; htmlFontSize = 16 (so 0.8125rem = 13px).
 */

/** The family the portal ACTUALLY renders in: MUI's Typography variants override
 *  the Paper's Carlito with the theme family, so text is Helvetica/Arial. */
export const FONT_STACK = `'Helvetica Neue', Helvetica, Arial, sans-serif`;

export const escapeHtml = (v: any): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Mirrors the portal's decodeHtmlEntities (same order). */
export const decodeHtmlEntities = (s: string): string =>
  String(s ?? '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&');

/** Portal's RichContent: stored rich text passes through as HTML, plain text is
 *  entity-decoded and wrapped with preserved whitespace. */
export function richContent(text: any, css = 'font-size:13px;line-height:1.6;'): string {
  const raw = String(text ?? '');
  if (!raw.trim()) return '';
  const isHtml = /<[a-z][\s\S]*>/i.test(raw);
  if (isHtml) {
    return `<div style="${css}display:block;white-space:pre-wrap;word-break:break-word;">${raw}</div>`;
  }
  return `<p style="${css}margin:0;white-space:pre-wrap;word-break:break-word;">${escapeHtml(decodeHtmlEntities(raw))}</p>`;
}

/** Line-item description cell (portal DescriptionText — 13px base). */
export const descriptionText = (text: any): string => richContent(text, 'font-size:13px;line-height:1.6;');

/** Portal formatDate: en-GB "3 Aug 2026". Locale pinned so container locale
 *  can't change the output. */
export function formatDate(date: any): string {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** 2-dp grouped number, locale pinned (portal uses toLocaleString with 2dp). */
export const money = (n: any): string =>
  (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Portal InfoRow: label : value — renders NOTHING when the value is blank.
 */
export function infoRow(label: string, value: any, minWidth = '110px', fontSize = '0.875rem'): string {
  const v = value === 0 ? '0' : value;
  if (v === null || v === undefined || String(v).trim() === '') return '';
  const fs = fontSize === '0.875rem' ? '14px' : fontSize;
  return (
    `<div style="display:flex;font-size:${fs};line-height:1.4;">` +
    `<span style="min-width:${minWidth};line-height:1.4;">${escapeHtml(label)}</span>` +
    `<span style="margin-left:4px;margin-right:8px;">:</span>` +
    `<span style="flex:1;">${escapeHtml(v)}</span>` +
    `</div>`
  );
}

/**
 * Amount in words, ported from the quotation branch (the richest of the
 * several copies in the portal). Quirks preserved deliberately so output
 * matches the portal exactly: bare "ZERO" for 0, no "AND" between hundreds
 * and tens, cents rendered as "AND CENTS ...".
 */
export function numberToWords(num: number): string {
  if (!num) return 'ZERO';
  const isNegative = num < 0;
  num = Math.abs(num);
  const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
  const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
  const convertHundreds = (n: number): string => {
    let str = '';
    if (n >= 100) {
      str += ones[Math.floor(n / 100)] + ' HUNDRED ';
      n %= 100;
    }
    if (n >= 20) {
      str += tens[Math.floor(n / 10)] + ' ';
      n %= 10;
    }
    if (n > 0) str += ones[n] + ' ';
    return str;
  };
  let result = isNegative ? 'NEGATIVE ' : '';
  const dollars = Math.floor(num);
  const cents = Math.round((num - dollars) * 100);
  if (dollars >= 1e12) result += convertHundreds(Math.floor(dollars / 1e12)) + 'TRILLION ';
  if (dollars >= 1e9) result += convertHundreds(Math.floor((dollars % 1e12) / 1e9)) + 'BILLION ';
  if (dollars >= 1e6) result += convertHundreds(Math.floor((dollars % 1e9) / 1e6)) + 'MILLION ';
  if (dollars >= 1000) result += convertHundreds(Math.floor((dollars % 1e6) / 1000)) + 'THOUSAND ';
  result += convertHundreds(dollars % 1000);
  if (cents > 0) result += 'AND CENTS ' + convertHundreds(cents);
  return "S'PORE DOLLAR " + result.trim() + ' ONLY.';
}

/**
 * The portal receives `documentInfo` built client-side by
 * transformBackendDataForForm; the server only has the flat `config`. This
 * shim gives every reader a nested view with a flat fallback, so
 * `di('documentNumber')` works regardless of where the value was stored.
 */
export function makeDi(data: any) {
  const info = (data && data.documentInfo) || {};
  return (key: string, fallback?: any) => {
    const fromInfo = info[key];
    if (fromInfo !== undefined && fromInfo !== null && fromInfo !== '') return fromInfo;
    const flat = data?.[key];
    if (flat !== undefined && flat !== null && flat !== '') return flat;
    return fallback;
  };
}

/** Portal groupDeliveryLines: collapse consecutive lines sharing a deliveryGroup. */
export function groupDeliveryLines(raw: any[]): any[] {
  if (!Array.isArray(raw)) return [];
  const out: any[] = [];
  let i = 0;
  while (i < raw.length) {
    const item = raw[i];
    const group = item?.deliveryGroup;
    if (!group) {
      out.push(item);
      i++;
      continue;
    }
    const members: any[] = [];
    while (i < raw.length && raw[i]?.deliveryGroup === group) {
      members.push(raw[i]);
      i++;
    }
    const first = members[0];
    const qty = members.reduce((s, m) => s + (Number(m.quantity) || 0), 0);
    const amount = members.reduce((s, m) => s + (Number(m.amount) || 0), 0);
    const serials = members.flatMap((m) => (Array.isArray(m.serialNumbers) ? m.serialNumbers : []));
    const lines = [
      `Rental of ${qty} unit${qty === 1 ? '' : 's'} of ${first.description || first.name || ''}`,
      first.skuKey ? `Model: ${first.skuKey}` : '',
      ...serials.map((s: any) => `S/No.: ${s}`),
    ].filter(Boolean);
    out.push({ ...first, description: lines.join('\n'), quantity: qty, amount });
  }
  return out;
}

/** Page shell. Server PDFs use the printed geometry (@page margin, no padding)
 *  rather than the on-screen 20mm padding — the portal's print CSS does the
 *  same via `[data-print-paper]{padding:0}`. */
export function pageShell(body: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  /* Margins are applied by Puppeteer (PORTED_PDF_MARGIN) so they repeat on
     every page; declaring them here too would double up. */
  @page { size: A4; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: ${FONT_STACK};
    font-weight: 400;
    font-size: 13px;
    line-height: 1.6;
    color: #000;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  p { margin: 0; }
  table { width: 100%; border-collapse: collapse; table-layout: auto; }
  td, th { border: none; padding: 6px 8px; font-size: 13px; vertical-align: top; }
  thead th { border-bottom: 2px solid #000; font-weight: 600; font-size: 13px; }
  thead { display: table-row-group; }
  .doc { width: 100%; display: flex; flex-direction: column; min-height: 257mm; }
</style>
</head><body><div class="doc">${body}</div></body></html>`;
}
