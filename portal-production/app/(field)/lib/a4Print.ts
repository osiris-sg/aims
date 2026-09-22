"use client";

import html2canvas from "html2canvas";
import { openPrinter, type SavedPrinter } from "./btPrinter";

/**
 * A4 RASTER PRINTING over Classic-Bluetooth SPP.
 *
 * The 58mm path in btPrinter.ts builds a TEXT receipt: ESC/POS character
 * commands, 32 columns, with the signature as the one small raster block. That
 * cannot express an A4 delivery order — the DO is a laid-out document with a
 * table, a logo and a signature panel, and re-typesetting it as 32-column text
 * would produce a different document from the one the office prints.
 *
 * So this path prints a PICTURE of the real thing: the very same
 * CleanDocumentPreview DOM the portal's Print/PDF uses (react-to-print over
 * that node), rasterised at the printer's dot pitch and sent as ESC/POS raster
 * graphics. What the rider tears off is what the office sees.
 *
 * WHY THE DOT WIDTH IS A SETTING, NOT A CONSTANT
 * The printer is a 小象 (Xiaoxiang) portable A4 thermal unit whose model and
 * protocol are unknown, and the head's dot count is the one number that cannot
 * be guessed from the outside: it decides how many dots make up a page-width
 * line. Get it wrong and the symptom is unmistakable — too small and the page
 * prints narrow with a blank margin; too large and the right edge is clipped or
 * the image wraps and smears. Since it can only be found by trying, it is
 * editable in the printer picker rather than compiled in.
 *
 *   1728 dots = 8.0in @ 203dpi  (default — the common portable A4 head)
 *   2480 dots = 8.27in @ 300dpi (A4 at 300dpi)
 *
 * WHY BANDS
 * A full A4 page at 1728 dots is ~2440 rows ≈ 516 KB of raster. One GS v 0
 * carrying all of it would (a) exceed what the Capacitor bridge should be asked
 * to marshal as one base64 string and (b) sit in the printer's input buffer
 * with no progress and no recovery point. Instead the page is cut into
 * horizontal bands, each a COMPLETE, self-contained GS v 0 command.
 *
 * The distinction matters and is not cosmetic: BtPrinterPlugin.write()
 * deliberately puts NO delay between its 512-byte chunks, because a temporal
 * gap *inside* a raster command makes cheap firmware give up waiting for image
 * data and fall back to text mode — printing the raster bytes as ASCII. So the
 * throttle lives BETWEEN bands (between write() calls, at a command boundary),
 * never inside one.
 */

// ── dot width ────────────────────────────────────────────────────────────────

/** 8in head @ 203dpi. The usual portable A4 thermal head. */
export const DOT_WIDTH_203 = 1728;
/** A4 @ 300dpi. */
export const DOT_WIDTH_300 = 2480;

export const DOT_WIDTH_PRESETS: { label: string; value: number }[] = [
  { label: '1728 — 8" head @ 203dpi', value: DOT_WIDTH_203 },
  { label: "2480 — A4 @ 300dpi", value: DOT_WIDTH_300 },
];

const DOT_WIDTH_KEY = "aims.btprinter.dotWidth";

// A dot width must be a multiple of 8: the raster format packs 8 dots per byte,
// so anything else silently rounds up and shifts every row — which looks like a
// skewed page, not like a bad setting.
export const normaliseDotWidth = (n: number): number => {
  if (!Number.isFinite(n)) return DOT_WIDTH_203;
  const clamped = Math.min(4096, Math.max(384, Math.round(n)));
  return Math.floor(clamped / 8) * 8;
};

export const getDotWidth = (): number => {
  try {
    const raw = localStorage.getItem(DOT_WIDTH_KEY);
    return raw ? normaliseDotWidth(Number(raw)) : DOT_WIDTH_203;
  } catch {
    return DOT_WIDTH_203;
  }
};

export const saveDotWidth = (n: number) => {
  try {
    localStorage.setItem(DOT_WIDTH_KEY, String(normaliseDotWidth(n)));
  } catch {
    // non-fatal — falls back to the default next print
  }
};

// ── tuning ───────────────────────────────────────────────────────────────────

/**
 * Rows per band. 256 rows at 1728 dots = 216 B/row × 256 ≈ 55 KB of raster,
 * ~74 KB once base64'd — a comfortable single bridge call, and ~10 bands for a
 * full page, which is fine-grained enough for a progress bar that visibly moves.
 * Smaller bands would mean more per-write overhead for no benefit; larger ones
 * make a mid-page failure cost more and the progress bar stall.
 */
const BAND_ROWS = 256;

/**
 * Pause between bands, at a command boundary. SPP gives us RFCOMM credit-based
 * flow control, so this is not the primary backpressure — it is headroom for
 * the printer's own thermal pacing, which is slower than the link and is what
 * actually overflows a cheap input buffer on a long job.
 */
const BAND_DELAY_MS = 120;

/** Feed after the last page so the sheet clears the head. No cut command. */
const TRAILING_FEED_LINES = 6;

/** Feed BETWEEN pages of a multi-page DO, so page 2 does not abut page 1. */
const PAGE_GAP_LINES = 4;

const GS = 0x1d;
const ESC = 0x1b;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── rasterisation ────────────────────────────────────────────────────────────

/**
 * Floyd–Steinberg error diffusion to 1 bit.
 *
 * The signature rasteriser in btPrinter.ts has NO dithering to reuse — it is a
 * flat luminance threshold, and says so ("signatures are already bilevel"),
 * which is right for a two-tone pen stroke. An A4 DO is not two-tone: it can
 * carry a logo, table shading and an anti-aliased signature image, and a flat
 * threshold turns all of that into either solid black or nothing. So the
 * threshold constant and the GS v 0 packing convention are shared with that
 * function; the error diffusion is new.
 *
 * Returns packed rows, MSB-first, 8 dots per byte — a set bit is a fired dot.
 */
function ditherToBits(data: Uint8ClampedArray, w: number, h: number): Uint8Array {
  // Greyscale working buffer at float precision: the diffused error must be
  // allowed to push a pixel past 0/255, otherwise it accumulates incorrectly.
  const grey = new Float32Array(w * h);
  for (let i = 0, p = 0; i < grey.length; i++, p += 4) {
    const a = data[p + 3] / 255;
    // Composite onto white — the DO renders on white paper, and a transparent
    // PNG signature would otherwise read as black.
    const r = data[p] * a + 255 * (1 - a);
    const g = data[p + 1] * a + 255 * (1 - a);
    const b = data[p + 2] * a + 255 * (1 - a);
    grey[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  const bytesPerRow = Math.ceil(w / 8);
  const out = new Uint8Array(bytesPerRow * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = grey[i];
      const isDark = old < 128;
      const next = isDark ? 0 : 255;
      const err = old - next;
      if (isDark) out[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);

      // Diffuse right / below-left / below / below-right (7,3,5,1 / 16).
      if (x + 1 < w) grey[i + 1] += (err * 7) / 16;
      if (y + 1 < h) {
        if (x > 0) grey[i + w - 1] += (err * 3) / 16;
        grey[i + w] += (err * 5) / 16;
        if (x + 1 < w) grey[i + w + 1] += (err * 1) / 16;
      }
    }
  }
  return out;
}

export interface RasterPage {
  widthDots: number;
  heightDots: number;
  bytesPerRow: number;
  bits: Uint8Array;
}

/**
 * Rasterise one already-rendered A4 node to 1-bit at `dotWidth`.
 *
 * `scale` is derived, not chosen: html2canvas is asked for exactly
 * dotWidth / nodeWidth so the capture lands on the dot grid with no resample
 * afterwards. Resampling a bilevel page is what makes thin table rules
 * disappear.
 */
export async function rasterizeNode(node: HTMLElement, dotWidth: number): Promise<RasterPage> {
  const width = normaliseDotWidth(dotWidth);
  const cssWidth = node.offsetWidth || 794; // A4 @96dpi — CleanDocumentPreview's fixed Paper width
  const scale = width / cssWidth;

  const canvas = await html2canvas(node, {
    scale,
    backgroundColor: "#ffffff",
    // The DO pulls its logo and signature images off S3. Without CORS they
    // taint the canvas and getImageData throws SecurityError — which would
    // surface as "print failed" on a page that looks fine on screen.
    useCORS: true,
    allowTaint: false,
    logging: false,
    // Capture the node as laid out, not as scrolled — the field view scales and
    // pans the document, and without this the print would inherit that pan.
    scrollX: 0,
    scrollY: 0,
    windowWidth: cssWidth,
  });

  // html2canvas rounds; force the exact dot width so bytesPerRow is stable.
  const exact = document.createElement("canvas");
  exact.width = width;
  exact.height = Math.max(1, Math.round((canvas.height * width) / canvas.width));
  const ctx = exact.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable for printing");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, exact.width, exact.height);
  ctx.drawImage(canvas, 0, 0, exact.width, exact.height);

  let image: ImageData;
  try {
    image = ctx.getImageData(0, 0, exact.width, exact.height);
  } catch {
    throw new Error(
      "The document could not be read for printing (an image on it blocked canvas access).",
    );
  }

  return {
    widthDots: exact.width,
    heightDots: exact.height,
    bytesPerRow: Math.ceil(exact.width / 8),
    bits: ditherToBits(image.data, exact.width, exact.height),
  };
}

/** One complete `GS v 0` command for `rows` rows starting at `startRow`. */
function bandCommand(page: RasterPage, startRow: number, rows: number): Uint8Array {
  const { bytesPerRow } = page;
  const payload = page.bits.subarray(startRow * bytesPerRow, (startRow + rows) * bytesPerRow);
  const cmd = new Uint8Array(8 + payload.length);
  cmd[0] = GS;
  cmd[1] = 0x76; // 'v'
  cmd[2] = 0x30; // '0'
  cmd[3] = 0x00; // m = 0, normal density
  cmd[4] = bytesPerRow & 0xff;
  cmd[5] = (bytesPerRow >> 8) & 0xff;
  cmd[6] = rows & 0xff;
  cmd[7] = (rows >> 8) & 0xff;
  cmd.set(payload, 8);
  return cmd;
}

/**
 * Split one tall raster into A4-page-height pages.
 *
 * CleanDocumentPreview does NOT emit per-page nodes: it renders a single
 * continuous Paper with `minHeight: 297mm` and leaves pagination to the
 * browser's own print engine (the `page-break-inside: avoid` hints all over it
 * are for exactly that). So there is no DOM boundary to capture page by page,
 * and the split has to be geometric — which is sound, because the capture is
 * pinned to a known width: the node is 210mm wide, so one A4 page is
 * dotWidth × 297/210 rows.
 *
 * A page shorter than the full sheet (the last one, always) is emitted at its
 * real height rather than padded, so the printer does not feed a blank tail.
 */
export function splitIntoPages(page: RasterPage): RasterPage[] {
  const pageRows = Math.round((page.widthDots * 297) / 210);
  if (page.heightDots <= pageRows) return [page];

  const pages: RasterPage[] = [];
  for (let top = 0; top < page.heightDots; top += pageRows) {
    const rows = Math.min(pageRows, page.heightDots - top);
    pages.push({
      widthDots: page.widthDots,
      heightDots: rows,
      bytesPerRow: page.bytesPerRow,
      bits: page.bits.subarray(top * page.bytesPerRow, (top + rows) * page.bytesPerRow),
    });
  }
  return pages;
}

export interface PrintProgress {
  /** 1-based page being sent. */
  page: number;
  pageCount: number;
  /** 0..1 across the WHOLE job, not just this page. */
  fraction: number;
  label: string;
}

/**
 * Send rasterised pages to the printer, band by band.
 *
 * The connection is opened once for the whole job and closed in a finally —
 * reconnecting per page would re-run the plugin's connect-time buffer clear and
 * risk dropping the tail of the previous page.
 *
 * A failure part-way rejects with a plain message naming the page and band, so
 * the rider is told "stopped on page 2 of 3" rather than watching a spinner
 * that never ends.
 */
export async function printRasterPages(
  pages: RasterPage[],
  printer: SavedPrinter,
  onProgress?: (p: PrintProgress) => void,
): Promise<void> {
  if (pages.length === 0) throw new Error("Nothing to print");

  const totalBands = pages.reduce((n, p) => n + Math.ceil(p.heightDots / BAND_ROWS), 0);
  let sentBands = 0;

  await openPrinter(printer, async (send) => {
    for (let pi = 0; pi < pages.length; pi++) {
      const page = pages[pi];
      const bandCount = Math.ceil(page.heightDots / BAND_ROWS);

      // Reset to a known state at the top of each page, and on every page but
      // the first, feed clear of the previous one so the two do not abut.
      await send(new Uint8Array([ESC, 0x40]), { drainMs: 0 });
      if (pi > 0) await send(new Uint8Array([ESC, 0x64, PAGE_GAP_LINES]), { drainMs: 0 });

      for (let b = 0; b < bandCount; b++) {
        const startRow = b * BAND_ROWS;
        const rows = Math.min(BAND_ROWS, page.heightDots - startRow);
        try {
          await send(bandCommand(page, startRow, rows), { drainMs: 0 });
        } catch (e: any) {
          throw new Error(
            `Printing stopped on page ${pi + 1} of ${pages.length}, ${Math.round(
              (b / bandCount) * 100,
            )}% through that page — ${e?.message ?? "the printer stopped responding"}. ` +
              "Check it is on, has paper and is in range, then try again.",
          );
        }
        sentBands++;
        onProgress?.({
          page: pi + 1,
          pageCount: pages.length,
          fraction: sentBands / totalBands,
          label:
            pages.length > 1
              ? `Sending page ${pi + 1} of ${pages.length}…`
              : "Sending to printer…",
        });
        if (b < bandCount - 1) await sleep(BAND_DELAY_MS);
      }
    }

    // Feed past the head after the LAST page, and deliberately no cut: the
    // cutter command is unsafe on an unknown model (a unit without one may
    // report an error and hold the job), and this printer tears by hand.
    await send(new Uint8Array([ESC, 0x64, TRAILING_FEED_LINES]), { drainMs: 900 });
  });
}

/** Tuning, surfaced so the UI and the report can state the real numbers. */
export const PRINT_TUNING = {
  bandRows: BAND_ROWS,
  bandDelayMs: BAND_DELAY_MS,
  pluginChunkBytes: 512,
  trailingFeedLines: TRAILING_FEED_LINES,
  pageGapLines: PAGE_GAP_LINES,
};
