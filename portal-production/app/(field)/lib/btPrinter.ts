"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * Web bridge for the native BtPrinter Capacitor plugin (Classic-SPP 58mm
 * ESC/POS printing — Xprinter XP-58IIH class hardware, 384 dots/line).
 *
 * Only usable inside the AIMS Field Android shell: Web Bluetooth is BLE-only
 * by spec and cannot reach SPP printers, so plain-browser sessions gate on
 * isPrinterAvailable() and keep the Print button disabled.
 *
 * Pairing happens in Android Settings (normal for SPP); we only ever list
 * already-bonded devices and remember the chosen one in localStorage.
 */

interface BtPrinterPlugin {
  listBonded(): Promise<{ devices: Array<{ name: string; mac: string }> }>;
  connect(options: { mac: string }): Promise<void>;
  write(options: { base64: string }): Promise<void>;
  disconnect(): Promise<void>;
}

const BtPrinter = registerPlugin<BtPrinterPlugin>("BtPrinter");

export const isPrinterAvailable = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("BtPrinter");

// ── remembered device ────────────────────────────────────────────────────────
const STORAGE_KEY = "aims.btprinter.device";

export interface SavedPrinter {
  name: string;
  mac: string;
}

export const getSavedPrinter = (): SavedPrinter | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedPrinter) : null;
  } catch {
    return null;
  }
};

export const savePrinter = (p: SavedPrinter) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // non-fatal — the rider just re-picks next time
  }
};

export const listBondedDevices = async () => (await BtPrinter.listBonded()).devices;

// ── ESC/POS assembly ─────────────────────────────────────────────────────────
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

// The printer speaks CP437-ish; anything beyond printable ASCII becomes '?'
// rather than mojibake on paper.
const text = (s: string): number[] =>
  Array.from(s).map((ch) => {
    const c = ch.charCodeAt(0);
    return c >= 0x20 && c <= 0x7e ? c : 0x3f;
  });

const line = (s = ""): number[] => [...text(s), LF];
const init = (): number[] => [ESC, 0x40];
const align = (n: 0 | 1 | 2): number[] => [ESC, 0x61, n]; // 0 left, 1 centre, 2 right
const size = (double: boolean): number[] => [GS, 0x21, double ? 0x11 : 0x00];
const bold = (on: boolean): number[] => [ESC, 0x45, on ? 1 : 0];
const feed = (n: number): number[] => [ESC, 0x64, n];

const RULE = "-".repeat(32); // 32 chars/line at normal size on 58mm

// Cap the rasterised height (dots). A signature crop is normally wider than
// tall, so width fills to maxWidth; this only kicks in for an unusually tall
// crop so we never emit a runaway image block.
const RASTER_MAX_HEIGHT = 360;
const INK_THRESHOLD = 128; // luminance below this prints as a set (dark) bit
// Lenient threshold used ONLY to find the ink bounding box. Faint anti-aliased
// edge pixels of a stroke sit between INK_THRESHOLD and near-white; detecting
// the extent at 128 clips them (a stroke's tail gets cut, most visibly at the
// right edge after the fill-to-width scale), so the bbox uses a higher bar.
const BBOX_INK_THRESHOLD = 200;

/**
 * Rasterise an image data-URL to a 1-bit GS v 0 block, ≤maxWidth dots wide.
 * Generic — any future receipt imagery (logos, QR fallbacks) can reuse it.
 * Threshold only (no dithering): signatures are already bilevel.
 *
 * A signature-pad export is a large, mostly-empty canvas with the strokes in a
 * small region; scaling the WHOLE canvas to maxWidth shrinks the actual ink to
 * a few mm. So we first find the ink bounding box, crop to it (+ a little
 * padding), then scale THAT to fill the width — the strokes end up legible.
 */
export async function rasterizeDataUrl(dataUrl: string, maxWidth = 384): Promise<number[]> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Could not load image for printing"));
    i.src = dataUrl;
  });

  // 1) Draw at natural size (white bg — signature PNGs are transparent).
  const srcW = Math.max(1, img.width);
  const srcH = Math.max(1, img.height);
  const src = document.createElement("canvas");
  src.width = srcW;
  src.height = srcH;
  const sctx = src.getContext("2d");
  if (!sctx) throw new Error("Canvas unavailable");
  sctx.fillStyle = "#fff";
  sctx.fillRect(0, 0, srcW, srcH);
  sctx.drawImage(img, 0, 0, srcW, srcH);
  const srcData = sctx.getImageData(0, 0, srcW, srcH).data;

  // 2) Ink bounding box (dark pixels). If nothing is dark, keep the full frame.
  let minX = srcW, minY = srcH, maxX = -1, maxY = -1;
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const i = (y * srcW + x) * 4;
      const lum = 0.299 * srcData[i] + 0.587 * srcData[i + 1] + 0.114 * srcData[i + 2];
      if (lum < BBOX_INK_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) {
    minX = 0; minY = 0; maxX = srcW - 1; maxY = srcH - 1;
  }
  const pad = 16;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(srcW - 1, maxX + pad);
  maxY = Math.min(srcH - 1, maxY + pad);
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;

  // 3) Scale the crop to fill the width (upscaling allowed so small signatures
  //    grow), but never taller than RASTER_MAX_HEIGHT.
  const scale = Math.min(maxWidth / cropW, RASTER_MAX_HEIGHT / cropH);
  const w = Math.max(1, Math.round(cropW * scale));
  const h = Math.max(1, Math.round(cropH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  // 9-arg drawImage: crop (minX,minY,cropW,cropH) from src → fill (0,0,w,h).
  ctx.drawImage(src, minX, minY, cropW, cropH, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const bytesPerRow = Math.ceil(w / 8);
  const bitmap: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let bx = 0; bx < bytesPerRow; bx++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = bx * 8 + bit;
        if (x >= w) continue;
        const i = (y * w + x) * 4;
        // Luminance threshold — dark pixel ⇒ print (bit set).
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (lum < INK_THRESHOLD) byte |= 0x80 >> bit;
      }
      bitmap.push(byte);
    }
  }
  // GS v 0 m xL xH yL yH  — m=0 normal density.
  return [
    GS, 0x76, 0x30, 0x00,
    bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff,
    h & 0xff, (h >> 8) & 0xff,
    ...bitmap,
  ];
}

export interface DeliveryReceiptData {
  deliveryNumber: number | string;
  unitLabel: string; // model + serial ("SKU — Asset name")
  customer?: string | null;
  project?: string | null;
  siteAddress?: string | null;
  gps?: { latitude: number; longitude: number } | null;
  dateLabel: string;
  installNeeded: boolean;
  signatureDataUrl?: string | null;
  recipientName?: string | null;
}

/** Assemble the full receipt byte stream (no cutter — 58mm tear-bar). */
export async function buildDeliveryReceipt(d: DeliveryReceiptData): Promise<Uint8Array> {
  const parts: number[] = [];
  parts.push(...init());
  parts.push(...align(1), ...size(true), ...bold(true), ...line("DELIVERY ORDER"), ...bold(false), ...size(false));
  parts.push(...line(RULE));
  parts.push(...align(0));
  parts.push(...line("Sender: Biofuel Industries Pte. Ltd."));
  parts.push(...bold(true), ...line(`Delivery #${d.deliveryNumber}`), ...bold(false));
  parts.push(...line(`Unit: ${d.unitLabel}`));
  if (d.customer) parts.push(...line(`Customer: ${d.customer}`));
  if (d.project) parts.push(...line(`Project: ${d.project}`));
  if (d.siteAddress) parts.push(...line(`Site: ${d.siteAddress}`));
  parts.push(...line(`Date: ${d.dateLabel}`));
  parts.push(...line(`Installation: ${d.installNeeded ? "completed" : "not required"}`));
  parts.push(...line(RULE));
  parts.push(...align(1), ...line("Received in good order by:"));
  if (d.signatureDataUrl) {
    parts.push(...(await rasterizeDataUrl(d.signatureDataUrl, 320)));
  }
  parts.push(...line(d.recipientName?.trim() || "(unnamed)"));
  // Feed past the tear bar — the print head sits ~1cm above the tear edge, so
  // ~4 lines left content straddling the bar. 8 clears it for a clean tear.
  parts.push(...feed(8));
  return Uint8Array.from(parts);
}

// ── transport ────────────────────────────────────────────────────────────────
const toBase64 = (bytes: Uint8Array): string => {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
};

/** Connect to the saved (or given) printer, send, disconnect. Throws on failure. */
export async function printBytes(bytes: Uint8Array, printer?: SavedPrinter): Promise<void> {
  const target = printer ?? getSavedPrinter();
  if (!target) throw new Error("No printer selected");
  await BtPrinter.connect({ mac: target.mac });
  try {
    await BtPrinter.write({ base64: toBase64(bytes) });
  } finally {
    await BtPrinter.disconnect().catch(() => undefined);
  }
}
