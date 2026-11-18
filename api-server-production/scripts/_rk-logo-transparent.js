/**
 * WCT Racking logo (2026-11-18): white background -> transparent PNG ("colour to alpha" against white, so
 * anti-aliased edges keep a soft alpha instead of a white fringe). Reads the source, never writes it.
 *   node scripts/_rk-logo-transparent.js <source.jpeg> <out.png>
 */
const sharp = require('sharp');
const [src, out] = process.argv.slice(2);
(async () => {
  const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = info.width * info.height;
  const outBuf = Buffer.alloc(px * 4);
  let clear = 0;
  for (let i = 0; i < px; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    // alpha = how far the pixel is from white (largest channel distance); JPEG noise near white -> 0.
    let a = Math.max(255 - r, 255 - g, 255 - b) / 255;
    if (a < 0.06) a = 0;
    const un = (c) => (a === 0 ? 0 : Math.max(0, Math.min(255, Math.round((c - 255 * (1 - a)) / a))));
    outBuf[i * 4] = un(r); outBuf[i * 4 + 1] = un(g); outBuf[i * 4 + 2] = un(b); outBuf[i * 4 + 3] = Math.round(a * 255);
    if (a === 0) clear++;
  }
  // Trim the empty margin so the letterhead sizes the mark itself, not the white around it.
  await sharp(outBuf, { raw: { width: info.width, height: info.height, channels: 4 } }).trim({ threshold: 1 }).png({ compressionLevel: 9 }).toFile(out);
  const m = await sharp(out).metadata();
  console.log(`${out}: ${m.width}x${m.height}, alpha ${m.hasAlpha}, ${Math.round((clear / px) * 100)}% of the source made fully transparent`);
})().catch((e) => { console.error(e); process.exit(1); });
