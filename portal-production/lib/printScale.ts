/**
 * FIT-TO-PAGE SCALING FOR PRINTED DOCUMENTS.
 *
 * A DO whose content runs past the printable band spills onto a second page —
 * DO202609-0064 renders 304.8mm against a 285mm band and breaks ~20mm from the
 * end. The remedy here is NOT to change the document: no smaller photos, no
 * moved sections, no re-flowed layout. The whole sheet is scaled down by
 * exactly the amount needed, and a sheet that already fits is left alone.
 *
 * ─── WHY A CSS TRANSFORM, NOT THE PRINT SYSTEM'S OWN SCALING ────────────────
 * The print system cannot do this for us on the path that matters most:
 *
 *   Android (field print)  PrintAttributes has NO scale field, and
 *                          WebView.createPrintDocumentAdapter() exposes no
 *                          scale hook. The print dialog's own "scale" control
 *                          is user-facing only — an app cannot set it. So
 *                          print-system scaling is simply unavailable here.
 *   Browser (portal print) the dialog's scale is the user's choice, not
 *                          programmable.
 *   Puppeteer (server PDF) page.pdf({ scale }) DOES exist — but using it here
 *                          and CSS elsewhere would mean two mechanisms that
 *                          round differently and drift.
 *
 * CSS is the only mechanism available to all three, so all three use it and
 * produce the same sheet.
 *
 * ─── WHY transform, NOT zoom ────────────────────────────────────────────────
 * `zoom` re-lays the document out at the new size, so a line can re-wrap and
 * the document subtly changes — exactly what "no layout change" forbids.
 * `transform: scale()` is a pure geometric transform: nothing re-wraps,
 * nothing moves relative to anything else, the page is simply smaller.
 *
 * Its one catch is that a transform does NOT shrink the element's layout box,
 * so on its own the page break stays exactly where it was — measured, not
 * assumed: the first attempt scaled the sheet and pulled it up with a negative
 * bottom margin, and still printed two pages with the second one empty.
 * `fitToPageCss` therefore puts the scaled height on a CONTAINER with
 * `overflow: hidden`; that container's box is what pagination sees. Verified
 * against produced PDFs: 2 pages -> 1.
 */

/**
 * The smallest scale that still prints legibly: a DO's ~9pt body text lands at
 * roughly 6.3pt — small, but readable — and only a DO that would otherwise be
 * two pages ever reaches it.
 *
 * It was 0.75, which a two-item DO hit exactly: 380.2mm x 0.75 = 285.15mm
 * against a 285mm band, fitting by 0.15mm. That is luck, not headroom —
 * anything marginally taller spilled. 0.70 gives a real margin on the sizes
 * that actually occur.
 *
 * Below this the shrinking STOPS and the document is allowed to run to a
 * second page: a legible two-page document beats an illegible one-page one,
 * and a visible overflow beats a silent one.
 */
export const PRINT_SCALE_FLOOR = 0.7;

/** A4 less a 6mm printer ring — the band the DO sheet is designed against. */
export const A4_BAND_MM_6MM_MARGIN = 285;

/**
 * Scale needed to bring `contentMm` inside `bandMm`.
 *
 * Never scales UP: a document that already fits is returned at exactly 1 and
 * is left untouched. Rounded DOWN to a thousandth so rounding can never
 * under-shrink and leave a 1mm spill.
 */
export function computeFitScale(contentMm: number, bandMm = A4_BAND_MM_6MM_MARGIN): number {
  if (!Number.isFinite(contentMm) || contentMm <= 0) return 1;
  if (!Number.isFinite(bandMm) || bandMm <= 0) return 1;
  if (contentMm <= bandMm) return 1;
  const needed = Math.floor((bandMm / contentMm) * 1000) / 1000;
  return Math.max(PRINT_SCALE_FLOOR, needed);
}

/** True when the content is SO tall that even the floor cannot contain it. */
export function willStillOverflow(contentMm: number, bandMm = A4_BAND_MM_6MM_MARGIN): boolean {
  return contentMm > 0 && contentMm * PRINT_SCALE_FLOOR > bandMm;
}

/** Class put on the sheet's CONTAINER to make pagination see the scaled height. */
export const PRINT_FIT_CLASS = "aims-print-fit";

/**
 * The print-media CSS that applies the scale.
 *
 * A transform alone is NOT enough, and this was measured rather than assumed:
 * scaling the sheet and pulling it up with a negative bottom margin still
 * printed two pages, because Chromium paginates on LAYOUT boxes and a
 * transformed element's box keeps its original height — so the break stayed
 * exactly where it was, with page two painted empty.
 *
 * What works is a CONTAINER fixed to the scaled height with `overflow: hidden`.
 * Its box is what pagination sees; the sheet inside is visually scaled to fit
 * it, so the clip never actually cuts anything. Verified: 2 pages -> 1.
 *
 * Emits NOTHING at scale 1, so a document that already fits carries no extra
 * rules and is byte-for-byte what it was.
 */
export function fitToPageCss(selector: string, scale: number, naturalMm: number): string {
  if (!(scale < 1) || !(naturalMm > 0)) return "";
  const scaledMm = +(naturalMm * scale).toFixed(2);
  return `
  @media print {
    .${PRINT_FIT_CLASS} {
      height: ${scaledMm}mm !important;
      overflow: hidden !important;
    }
    .${PRINT_FIT_CLASS} ${selector} {
      transform: scale(${scale}) !important;
      transform-origin: top left !important;
    }
  }`;
}

/**
 * Measure how tall a document will be WHEN PRINTED, in mm.
 *
 * THIS CANNOT MEASURE THE LIVE NODE. The sheet's print geometry — 186mm wide,
 * 8mm padding, `display: block`, `min-height` released — lives inside
 * `@media print` and simply is not in effect on screen, where the same sheet is
 * 210mm wide, flex, and 297mm tall. Measuring the on-screen node would compute
 * a scale for a layout that never prints.
 *
 * So the probe renders the REAL document — the same serialised HTML, the same
 * CSS — in an offscreen iframe with every `@media print` block rewritten to
 * `@media all`, which forces exactly the print rules into effect. What comes
 * back is the height the printer will see.
 *
 * WHY THIS WORKS FOR THE FIELD PRINT PATH, WHERE THE BROWSER LAYS OUT
 * OFFSCREEN: the measurement happens HERE, in the app's own WebView, and the
 * resulting scale is baked into the emitted HTML as a constant. The print
 * WebView never measures anything, so its JavaScript stays disabled and the
 * native side needs no change.
 *
 * Returns 0 when the probe cannot run (no DOM, blocked iframe), which
 * `computeFitScale` treats as "leave it alone".
 */
export async function measurePrintHeightMm(html: string, sheetSelector: string): Promise<number> {
  if (typeof document === "undefined") return 0;
  const frame = document.createElement("iframe");
  // Offscreen but LAID OUT — display:none would give a zero-height document.
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText =
    "position:fixed;left:-100000px;top:0;width:250mm;height:2000mm;border:0;visibility:hidden;";
  document.body.appendChild(frame);
  try {
    const forced = html.replace(/@media\s+print\s*\{/g, "@media all {");
    await new Promise<void>((resolve) => {
      frame.onload = () => resolve();
      frame.srcdoc = forced;
      // srcdoc load is normally immediate; do not hang the print on a stall.
      setTimeout(resolve, 2500);
    });
    const doc = frame.contentDocument;
    if (!doc) return 0;
    // Give layout one frame to settle after load.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const sheet = doc.querySelector(sheetSelector) as HTMLElement | null;
    const el = sheet ?? doc.body;
    if (!el) return 0;
    const px = el.getBoundingClientRect().height;
    return (px / 96) * 25.4;
  } catch {
    return 0;
  } finally {
    frame.remove();
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
export function collectCss(): string {
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



const FIT_STYLE_ID = "aims-print-fit";

/**
 * Measure a LIVE sheet and install the fit-to-page rule for the next print.
 *
 * For the browser print paths (the office editor and the guest view), the
 * printed content is the live DOM and react-to-print's `pageStyle` is fixed at
 * hook creation — so the scale cannot be baked into it. Instead this probes the
 * sheet, then injects a single <style> into <head> that the print iframe picks
 * up along with every other stylesheet.
 *
 * It is `@media print` only, so the ON-SCREEN document is never touched — which
 * is what keeps the guest link scrollable and unchanged.
 *
 * Returns a cleanup that removes the rule again; call it after printing so the
 * scale is never left behind for a different document.
 */
export async function installPrintFit(
  node: HTMLElement,
  selector: string,
  bandMm = A4_BAND_MM_6MM_MARGIN,
  pageStyle = "",
): Promise<() => void> {
  const remove = () => document.getElementById(FIT_STYLE_ID)?.remove();
  remove();
  if (typeof document === "undefined") return remove;
  try {
    const sheet = (node.matches(selector) ? node : node.querySelector(selector)) as HTMLElement | null;
    if (!sheet) return remove;

    // Probe the same content with the same CSS, print rules forced on.
    const probeHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>${collectCss()}</style>
<style>html,body{margin:0;padding:0;background:#fff}${pageStyle}</style>
</head><body>${sheet.outerHTML}</body></html>`;

    const naturalMm = await measurePrintHeightMm(probeHtml, selector);
    const scale = computeFitScale(naturalMm, bandMm);
    if (scale >= 1) return remove;

    if (willStillOverflow(naturalMm, bandMm)) {
      console.warn(
        `[print] ${naturalMm.toFixed(1)}mm of content cannot fit one page at the ` +
          `${PRINT_SCALE_FLOOR} floor — printing across pages instead.`,
      );
    }
    // The container is what must carry the height — see fitToPageCss. A class
    // toggle is the lightest possible mutation; no element is inserted, and it
    // is @media print only so nothing changes on screen.
    const container = sheet.parentElement;
    container?.classList.add(PRINT_FIT_CLASS);

    const tag = document.createElement("style");
    tag.id = FIT_STYLE_ID;
    tag.textContent = fitToPageCss(selector, scale, naturalMm);
    document.head.appendChild(tag);
    return () => {
      container?.classList.remove(PRINT_FIT_CLASS);
      remove();
    };
  } catch {
    return remove;
  }
}
