"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * Android's own print system — the dialog Chrome shows, reached from inside
 * the Capacitor shell.
 *
 * `window.print()` does NOTHING in an Android WebView: Chrome implements
 * printing in its browser chrome, not in the web engine, so a bare WebView has
 * no handler and the call silently returns. The native SystemPrintPlugin
 * bridges to PrintManager instead, which is what reaches a WiFi printer (the
 * 小篆 X1000 inkjet, and anything else with a Mopria/IPP service installed).
 *
 * This complements rather than replaces the Bluetooth paths: a4Print.ts still
 * drives an SPP thermal A4 unit, and btPrinter.ts's 58mm receipt still exists.
 * A WiFi inkjet cannot be reached over SPP, and a thermal SPP printer does not
 * appear in Android's print dialog, so the two are genuinely different roads.
 */

interface SystemPrintPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  printHtml(options: { html: string; jobName?: string; baseUrl?: string }): Promise<void>;
  savePdf(options: {
    html: string;
    fileName?: string;
    baseUrl?: string;
    /** Open the system share sheet on success. */
    share?: boolean;
  }): Promise<{ uri: string; fileName: string }>;
}

const SystemPrint = registerPlugin<SystemPrintPlugin>("SystemPrint");

export const isSystemPrintAvailable = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("SystemPrint");

/**
 * The canonical DO print geometry.
 *
 * Copied verbatim from the two paths that already print a DO — the office
 * editor (TabbedDocumentCreator's `handleBrowserPrint`) and the public guest
 * view — because all three must produce the SAME sheet. CleanDocumentPreview's
 * own `@media print` block sizes the DO Paper to 186×277mm with 8mm padding;
 * this supplies the 6mm page ring it is designed to sit inside, and the blank
 * margin boxes suppress the engine's URL/date header.
 *
 *   printable band  198 × 285mm  (A4 less the 6mm ring)
 *   the DO sheet    186 × 277mm  → real slack on every edge, so no engine
 *                                  ever has to scale or clip
 *
 * This is NOT a second layout. It is the same rule set the other two paths
 * apply to the same component.
 */
export const DO_PRINT_PAGE_STYLE = `
  @page {
    size: A4;
    margin: 6mm;
    @top-left { content: ""; }
    @top-center { content: ""; }
    @top-right { content: ""; }
    @bottom-left { content: ""; }
    @bottom-center { content: ""; }
    @bottom-right { content: ""; }
  }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; }
    [data-print-paper] { padding: 0 !important; }
    [data-print-paper][data-print-sheet="do"] {
      width: 186mm !important;
      min-height: 0 !important;
      margin: 0 auto !important;
      padding: 8mm !important;
    }
  }
`;

/**
 * Inline one image as a data: URI.
 *
 * WHY: the print WebView starts its job on `onPageFinished`, which does not
 * wait for images still in flight — so an S3-hosted logo or signature can miss
 * the snapshot and print as a blank box. Inlining removes the race entirely
 * rather than trying to time it.
 *
 * `fetch` first (cheap, exact bytes). If CORS refuses, fall back to drawing
 * through a canvas, which succeeds whenever the bucket allows anonymous reads.
 * If BOTH fail the original URL is kept: a possibly-missing image is a far
 * better outcome than refusing to print the delivery order.
 */
async function inlineImage(src: string): Promise<string> {
  if (!src || src.startsWith("data:")) return src;
  try {
    const res = await fetch(src, { mode: "cors", credentials: "omit" });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error("read failed"));
      fr.readAsDataURL(blob);
    });
  } catch {
    // Canvas fallback — works when the object is readable anonymously.
    try {
      return await new Promise<string>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          try {
            const c = document.createElement("canvas");
            c.width = img.naturalWidth || img.width;
            c.height = img.naturalHeight || img.height;
            const ctx = c.getContext("2d");
            if (!ctx) return reject(new Error("no ctx"));
            ctx.drawImage(img, 0, 0);
            resolve(c.toDataURL("image/png"));
          } catch (e) {
            reject(e as Error);
          }
        };
        img.onerror = () => reject(new Error("load failed"));
        img.src = src;
      });
    } catch {
      return src;
    }
  }
}

/**
 * Collect every CSS rule in the document, as text.
 *
 * THIS CANNOT READ `style.textContent`. Emotion — which is what MUI compiles
 * every `sx` prop and `styled()` component into — runs in "speedy" mode
 * whenever NODE_ENV is not development, and speedy mode inserts rules through
 * `CSSStyleSheet.insertRule()` instead of appending text:
 *
 *     // @emotion/sheet
 *     this.isSpeedy = options.speedy === undefined ? !isDevelopment : options.speedy;
 *     …
 *     if (this.isSpeedy) { sheet.insertRule(rule, sheet.cssRules.length); }
 *     else               { tag.appendChild(document.createTextNode(rule)); }
 *
 * So in a PRODUCTION build those <style> tags are EMPTY: the rules live only in
 * the CSSOM. Reading textContent returned almost nothing, the serialised
 * document carried no component CSS, and the PDF came out as unstyled stacked
 * text with no table borders and no 186mm sheet — while the app's own screen
 * looked perfect, because there the live CSSOM is still doing the work. In
 * development the same code took the `createTextNode` branch and looked fine,
 * which is exactly why this survived testing.
 *
 * Reading `sheet.cssRules` is therefore the primary source, with textContent
 * only as a fallback.
 *
 * CROSS-ORIGIN STYLESHEETS: accessing `.cssRules` on a sheet loaded from
 * another origin throws a SecurityError — the DOM forbids reading rules the
 * page did not author (it would leak, e.g., :visited state). Google Fonts is
 * exactly such a sheet. Each sheet is therefore read in its own try/catch and
 * an unreadable one is SKIPPED rather than allowed to abort the whole
 * collection; the corresponding <link> is re-emitted into the printed document
 * instead, so the print WebView fetches it directly and the font still applies.
 */
function collectCss(): string {
  const chunks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      // Cross-origin — unreadable by design. The <link> is carried instead.
      rules = null;
    }
    if (rules && rules.length > 0) {
      chunks.push(Array.from(rules).map((r) => r.cssText).join("\n"));
      continue;
    }
    // Same-origin but empty cssRules, or unreadable: fall back to the tag's own
    // text. Covers a plain <style> the CSSOM has not parsed, and dev-mode
    // emotion, which does write text.
    const node = sheet.ownerNode as HTMLElement | null;
    const text = node?.textContent ?? "";
    if (text.trim()) chunks.push(text);
  }
  // A <style> tag with no associated sheet (never parsed) has no entry in
  // document.styleSheets at all — sweep those up too so nothing is missed.
  for (const tag of Array.from(document.querySelectorAll("style"))) {
    if (!(tag as HTMLStyleElement).sheet) {
      const text = tag.textContent ?? "";
      if (text.trim()) chunks.push(text);
    }
  }
  return chunks.join("\n");
}

/**
 * Turn a live, rendered node into a self-contained HTML document.
 *
 * Everything the node needs must travel with it: the print WebView loads the
 * string with no access to this page's stylesheets or session. So every CSS
 * rule is collected from the CSSOM (see collectCss — NOT from textContent),
 * cross-origin font links are carried over as links, and every image is
 * inlined first.
 */
export async function serializeNodeToPrintHtml(
  node: HTMLElement,
  opts: { title: string; pageStyle: string },
): Promise<string> {
  const clone = node.cloneNode(true) as HTMLElement;

  // Inline images on the CLONE, reading each src from the live node so a
  // lazily-decoded image still resolves.
  const liveImgs = Array.from(node.querySelectorAll("img"));
  const cloneImgs = Array.from(clone.querySelectorAll("img"));
  await Promise.all(
    cloneImgs.map(async (img, i) => {
      const src = liveImgs[i]?.currentSrc || liveImgs[i]?.src || img.getAttribute("src") || "";
      if (!src) return;
      img.setAttribute("src", await inlineImage(src));
      // A responsive srcset would let the print engine pick a URL we did not
      // inline, undoing the work above.
      img.removeAttribute("srcset");
      img.removeAttribute("loading");
    }),
  );

  const styles = collectCss();

  // Webfonts live on cross-origin <link>s whose rules cannot be read out (see
  // collectCss); carry the link itself so the print WebView fetches it.
  const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
    .map((l) => `<link rel="stylesheet" href="${l.href}">`)
    .join("\n");

  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
${links}
<style>${styles}</style>
<style>
  html, body { margin: 0; padding: 0; background: #fff; }
  ${opts.pageStyle}
</style>
</head>
<body>${clone.outerHTML}</body>
</html>`;
}

/**
 * Save an already-serialised document to the tablet as a PDF.
 *
 * WHY DOWNLOAD EXISTS ALONGSIDE PRINT: the X1000 makes its own WiFi hotspot
 * with no internet. The tablet cannot be on that hotspot and on the network
 * that serves this app at the same time, so "print now" is impossible for that
 * printer — the rider has to take the document with them. Save first, join the
 * printer's WiFi, print from the printer's own app.
 *
 * It lands in the public Downloads collection (Files, Downloads, and every
 * app's file picker), and `share: true` additionally opens the share sheet so
 * the printer's app is one tap away instead of a hunt.
 */
export async function savePdfViaSystem(
  html: string,
  fileName: string,
  share = true,
): Promise<{ uri: string; fileName: string }> {
  return await SystemPrint.savePdf({ html, fileName, share, baseUrl: window.location.origin + "/" });
}

/** Open Android's print dialog for an already-serialised document. */
export async function printHtmlViaSystem(html: string, jobName: string): Promise<void> {
  await SystemPrint.printHtml({ html, jobName, baseUrl: window.location.origin + "/" });
}
