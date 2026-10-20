/**
 * 計量検収票 "attach" body (Kato's layout): the document's body is Vedanta's
 * container packing list "INVOICE NO. 以降 VEDANTA印影まで" — from the INVOICE
 * NO. line down to and including the "FOR VEDANTA ALUMINIUM METAL LIMITED /
 * AUTHORISED SIGNATORY" seal — not a typed table.
 *
 * Auto crop (the default): the start / end are found in the PDF's text; when the
 * seal is on a later page (a long PL), every page up to it becomes a piece and
 * the 計量検収票 gets a continuation page per extra piece. Blank margins around
 * the content are trimmed so the piece fills its frame. Manual crop: the typed
 * top % applies to the first piece and the bottom % to the last.
 *
 * Pages are rendered to PNG (pdf.js + @napi-rs/canvas, as for thumbnails) at
 * print resolution. Screenshots (PNG / JPEG) are used as they are, trimmed.
 * Rendered pieces are cached in memory.
 */
const CACHE = new Map<string, Buffer[]>();
const CACHE_MAX = 24;

export interface AttachCrop {
  /** 0–0.9: fraction of the page height cut from the top (first piece) / bottom (last piece). */
  top?: number;
  bottom?: number;
  /** Find INVOICE NO. → AUTHORISED SIGNATORY in the PDF (default for new documents). */
  auto?: boolean;
}

/** A page band to print: fractions of the page height cut from its top / bottom. */
export interface AttachPiece {
  page: number;
  top: number;
  bottom: number;
}

/** A PDF page's text lines: y = top of the text from the page top, in the page's units. */
export interface PageText {
  height: number;
  items: Array<{ str: string; y: number; h: number }>;
}

const START_RE = /INVOICE\s*NO/i;
const END_RE = /AUTHORI[SZ]ED\s*SIGNATORY/i;
/** How many pages after the attached one may still hold the seal. */
const MAX_EXTRA_PAGES = 2;

const clampCrop = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(0.9, Math.max(0, v)) : 0);

/**
 * The bands to print, from the attached page on: INVOICE NO. (auto) or the typed
 * top on the first page, down to AUTHORISED SIGNATORY (+ a little air) on the
 * page that has it, or the typed bottom. Without text (a scan) or without the
 * markers: the attached page alone with the typed crop.
 */
export function planPieces(pages: PageText[], start: number, crop: AttachCrop | null): AttachPiece[] {
  const auto = crop?.auto === true;
  const s = pages[start - 1];
  const manualTop = clampCrop(crop?.top);
  const manualBottom = clampCrop(crop?.bottom);
  if (!s) return [{ page: start, top: manualTop, bottom: manualBottom }];
  const pad = (p: PageText) => p.height * 0.008;
  const startItem = s.items.find((i) => START_RE.test(i.str));
  const top = auto && startItem ? Math.max(0, (startItem.y - pad(s)) / s.height) : manualTop;
  let endPage = 0;
  let endFrac = 0;
  for (let p = start; p <= Math.min(pages.length, start + MAX_EXTRA_PAGES); p++) {
    const pg = pages[p - 1];
    const it = pg.items.find((i) => END_RE.test(i.str) && (p > start || !startItem || i.y > startItem.y));
    if (it) {
      endPage = p;
      endFrac = Math.max(0, 1 - (it.y + it.h + pad(pg) * 2) / pg.height);
      break;
    }
  }
  if (!endPage) return [{ page: start, top, bottom: manualBottom }];
  const bottom = auto ? endFrac : manualBottom;
  const out: AttachPiece[] = [];
  for (let p = start; p <= endPage; p++) out.push({ page: p, top: p === start ? top : 0, bottom: p === endPage ? bottom : 0 });
  // A first piece cut to nothing (bad manual numbers) falls back to the page alone.
  return out.every((x) => x.top + x.bottom < 0.95) ? out : [{ page: start, top: manualTop, bottom: manualBottom }];
}

/**
 * The non-white bounding box of an RGBA image (pixels darker than `threshold`
 * on any channel), or null for a blank image. Columns / rows are sampled
 * every `step` px for speed.
 */
export function contentBox(data: Uint8ClampedArray | Buffer, width: number, height: number, threshold = 235, step = 2): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y += step) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += step) {
      const i = row + x * 4;
      if (data[i + 3] > 0 && (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: Math.min(width - 1, x1 + step), y1: Math.min(height - 1, y1 + step) };
}

/** pdf.js is ESM-only: a native import() (tsc would turn `import()` into require). */
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const esmImport = new Function('s', 'return import(s)') as (s: string) => Promise<any>;

async function pdfTexts(bytes: Buffer, upto: number): Promise<PageText[]> {
  try {
    const pdfjs = await esmImport('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, isEvalSupported: false }).promise;
    const out: PageText[] = [];
    for (let p = 1; p <= Math.min(doc.numPages, upto); p++) {
      const pg = await doc.getPage(p);
      const vp = pg.getViewport({ scale: 1 });
      const tc = await pg.getTextContent();
      out.push({
        height: vp.height,
        items: (tc.items as Array<{ str?: string; transform: number[]; height?: number }>)
          .filter((i) => i.str?.trim())
          .map((i) => {
            const h = Math.abs(i.height || i.transform[3] || 8);
            return { str: i.str!, y: vp.height - i.transform[5] - h, h };
          }),
      });
    }
    await doc.destroy?.();
    return out;
  } catch {
    return []; // no text layer / unreadable: the typed crop on the attached page
  }
}

/** The attached body as one PNG per piece (the first fills the 計量検収票's frame, the rest continuation pages). */
export async function attachPiecesPng(s3Key: string, mimeType: string, page: number, crop: AttachCrop | null, download: (key: string) => Promise<Buffer>): Promise<Buffer[]> {
  const start = Math.max(1, Math.floor(page));
  const key = `${s3Key}#${start}#${crop?.auto ? 'auto' : `${clampCrop(crop?.top)}#${clampCrop(crop?.bottom)}`}`;
  const hit = CACHE.get(key);
  if (hit) return hit;
  const bytes = await download(s3Key);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadImage, createCanvas } = require('@napi-rs/canvas');
  let sources: Array<{ img: any; piece: AttachPiece }>;
  if (mimeType === 'application/pdf') {
    const pieces = planPieces(await pdfTexts(bytes, start + MAX_EXTRA_PAGES), start, crop);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { pdfToPng } = require('pdf-to-png-converter');
    const pngs = await pdfToPng(bytes, { pagesToProcess: pieces.map((p) => p.page), viewportScale: 2, returnPageContent: true, disableFontFace: true, useSystemFonts: false });
    if (!pngs?.[0]?.content) throw new Error(`The PDF has no page ${start}`);
    sources = [];
    for (const [i, piece] of pieces.entries()) if (pngs[i]?.content) sources.push({ img: await loadImage(pngs[i].content), piece });
  } else if (/^image\/(png|jpe?g|webp)$/.test(mimeType)) {
    sources = [{ img: await loadImage(bytes), piece: { page: 1, top: clampCrop(crop?.top), bottom: clampCrop(crop?.bottom) } }];
  } else {
    throw new Error('Attach a PDF page or an image');
  }
  // Cut each band, then trim the white around the content — one left / right edge for all pieces, so they print at one scale.
  const bands = sources.map(({ img, piece }) => {
    const y0 = Math.round(img.height * piece.top);
    const h = Math.max(1, Math.round(img.height * (1 - piece.top - piece.bottom)));
    const c = createCanvas(img.width, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, img.width, h);
    ctx.drawImage(img, 0, y0, img.width, h, 0, 0, img.width, h);
    return { c, w: img.width, h, box: contentBox(ctx.getImageData(0, 0, img.width, h).data, img.width, h) };
  });
  const boxes = bands.map((b) => b.box).filter(Boolean) as Array<NonNullable<(typeof bands)[number]['box']>>;
  const air = 12;
  const x0 = boxes.length ? Math.max(0, Math.min(...boxes.map((b) => b.x0)) - air) : 0;
  const x1 = boxes.length ? Math.max(...boxes.map((b) => b.x1)) + air : Infinity;
  const out: Buffer[] = bands.map(({ c, w, h, box }) => {
    const bx1 = Math.min(w, x1);
    const by0 = box ? Math.max(0, box.y0 - air) : 0;
    const by1 = box ? Math.min(h, box.y1 + air) : h;
    const cw = Math.max(1, bx1 - x0);
    const ch = Math.max(1, by1 - by0);
    const t = createCanvas(cw, ch);
    const tctx = t.getContext('2d');
    tctx.fillStyle = '#ffffff';
    tctx.fillRect(0, 0, cw, ch);
    tctx.drawImage(c, x0, by0, cw, ch, 0, 0, cw, ch);
    return t.toBuffer('image/png') as Buffer;
  });
  CACHE.set(key, out);
  if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value as string);
  return out;
}

/** The first piece only (thumbnails / callers that print one image). */
export async function attachPagePng(s3Key: string, mimeType: string, page: number, crop: AttachCrop | null, download: (key: string) => Promise<Buffer>): Promise<Buffer> {
  return (await attachPiecesPng(s3Key, mimeType, page, crop, download))[0];
}
