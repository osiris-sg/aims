"use client";

/**
 * Off-main-thread photo compression for every field capture path.
 *
 * Phone / Sunmi camera JPEGs run 3–8 MB at full sensor resolution (8 MP). The
 * native `Camera.takePhoto({ targetWidth, targetHeight })` resize is NOT honored
 * on the Sunmi — raw full-res frames reach us — so EVERY capture path must
 * compress here before upload (down to ~150–300 KB), rather than trusting the
 * plugin. Resizing to 1280px wide at JPEG q0.7.
 *
 * The heavy work — decoding the 8 MP JPEG and re-encoding — is pushed OFF the
 * main thread: `createImageBitmap` decodes off-thread and `OffscreenCanvas`
 * (`convertToBlob`) encodes off-thread, so the WebView UI no longer stalls for
 * several hundred ms per shot on a mid-range device. Only the cheap downscale
 * `drawImage` touches the main thread.
 *
 * Fallback: when `createImageBitmap` / `OffscreenCanvas` are unavailable (an old
 * WebView) or throw, we drop to the original main-thread `<img>` + `<canvas>`
 * path. The fallback is logged once so it's observable in the field. Either path
 * always emits an `image/jpeg`-typed Blob — the Capacitor Android WebView's
 * `fetch(dataUrl).blob()` yields an empty `.type` that the backend maps to a
 * ".unknown" extension and drops, so we never rely on that.
 */

const DEFAULT_MAX_WIDTH = 1280;
const DEFAULT_QUALITY = 0.7;

// `createImageBitmap` + `OffscreenCanvas.convertToBlob` do the decode/encode
// off-thread. `typeof` guards keep this safe under SSR (both are undefined).
const supportsOffscreen =
  typeof createImageBitmap === "function" && typeof OffscreenCanvas === "function";

let warnedFallback = false;
const noteFallback = (reason: string) => {
  if (warnedFallback) return;
  warnedFallback = true;
  // eslint-disable-next-line no-console
  console.warn(
    `[imageCompress] off-main-thread path unavailable (${reason}); using main-thread canvas fallback.`,
  );
};

const toBlob = async (source: Blob | string): Promise<Blob> =>
  typeof source === "string" ? await (await fetch(source)).blob() : source;

// Off-main-thread path: decode + encode happen off the WebView main thread.
const compressOffscreen = async (
  blob: Blob,
  maxWidth: number,
  quality: number,
): Promise<Blob> => {
  // `imageOrientation: "from-image"` honors EXIF orientation, matching both the
  // native `correctOrientation` intent and the <img> fallback's auto-rotation.
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  try {
    let w = bitmap.width;
    let h = bitmap.height;
    if (w > maxWidth) {
      h = Math.round((h * maxWidth) / w);
      w = maxWidth;
    }
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(bitmap, 0, 0, w, h);
    return await canvas.convertToBlob({ type: "image/jpeg", quality });
  } finally {
    bitmap.close();
  }
};

// Main-thread fallback (the original approach) — a decoded <img> drawn into a
// <canvas>. `toBlob(..., "image/jpeg", ...)` guarantees the JPEG type.
const compressMainThread = (
  source: Blob | string,
  maxWidth: number,
  quality: number,
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const url = typeof source === "string" ? source : URL.createObjectURL(source);
    const cleanup = () => {
      if (typeof source !== "string") URL.revokeObjectURL(url);
    };
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (w > maxWidth) {
        h = (h * maxWidth) / w;
        w = maxWidth;
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
      cleanup();
      canvas.toBlob(
        (blob) => resolve(blob ?? new Blob([], { type: "image/jpeg" })),
        "image/jpeg",
        quality,
      );
    };
    img.onerror = () => {
      cleanup();
      reject(new Error("image decode failed"));
    };
    img.src = url;
  });

/** Compress a captured photo (File/Blob or dataURL) to a small JPEG `Blob`. */
export const compressImageBlob = async (
  source: Blob | string,
  maxWidth = DEFAULT_MAX_WIDTH,
  quality = DEFAULT_QUALITY,
): Promise<Blob> => {
  if (supportsOffscreen) {
    try {
      return await compressOffscreen(await toBlob(source), maxWidth, quality);
    } catch (e) {
      noteFallback((e as Error)?.message ?? "offscreen error");
    }
  } else {
    noteFallback("createImageBitmap/OffscreenCanvas missing");
  }
  return compressMainThread(source, maxWidth, quality);
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** Same as {@link compressImageBlob} but resolves a dataURL (preview / AI paths). */
export const compressImageDataUrl = async (
  source: Blob | string,
  maxWidth = DEFAULT_MAX_WIDTH,
  quality = DEFAULT_QUALITY,
): Promise<string> => blobToDataUrl(await compressImageBlob(source, maxWidth, quality));
