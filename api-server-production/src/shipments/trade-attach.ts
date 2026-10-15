/**
 * 計量検収票 "attach" body (Kato's layout): the document's body is a page of
 * Vedanta's container packing list ("スクリーンショット貼付エリア — INVOICE NO.
 * 以降 VEDANTA印影まで"), not a typed table. The page is rendered to PNG
 * (pdf.js + @napi-rs/canvas, as for thumbnails) at print resolution and can be
 * cropped top / bottom (fractions of the page height). Screenshots (PNG /
 * JPEG) are used as they are. Rendered pages are cached in memory.
 */
const CACHE = new Map<string, Buffer>();
const CACHE_MAX = 24;

export interface AttachCrop {
  /** 0–0.9: fraction of the page height cut from the top / bottom. */
  top?: number;
  bottom?: number;
}

const clampCrop = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(0.9, Math.max(0, v)) : 0);

export async function attachPagePng(s3Key: string, mimeType: string, page: number, crop: AttachCrop | null, download: (key: string) => Promise<Buffer>): Promise<Buffer> {
  const top = clampCrop(crop?.top);
  const bottom = clampCrop(crop?.bottom);
  const key = `${s3Key}#${page}#${top}#${bottom}`;
  const hit = CACHE.get(key);
  if (hit) return hit;
  const bytes = await download(s3Key);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadImage, createCanvas } = require('@napi-rs/canvas');
  let source: Buffer = bytes;
  if (mimeType === 'application/pdf') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { pdfToPng } = require('pdf-to-png-converter');
    const pages = await pdfToPng(bytes, { pagesToProcess: [Math.max(1, Math.floor(page))], viewportScale: 2, returnPageContent: true, disableFontFace: true, useSystemFonts: false });
    if (!pages?.[0]?.content) throw new Error(`The PDF has no page ${page}`);
    source = pages[0].content;
  } else if (!/^image\/(png|jpe?g|webp)$/.test(mimeType)) {
    throw new Error('Attach a PDF page or an image');
  }
  const img = await loadImage(source);
  const y0 = Math.round(img.height * top);
  const h = Math.max(1, Math.round(img.height * (1 - top - bottom)));
  const canvas = createCanvas(img.width, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, img.width, h);
  ctx.drawImage(img, 0, y0, img.width, h, 0, 0, img.width, h);
  const png: Buffer = canvas.toBuffer('image/png');
  CACHE.set(key, png);
  if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value as string);
  return png;
}
