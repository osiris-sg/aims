"use client";

/**
 * Editor preview for SERVER-RENDERED layouts (a template whose Design picks a
 * named layout such as WCT). The portal's CleanDocumentPreview draws the stock
 * layouts itself; a named layout exists only in the API's document-html
 * renderer, so the editor shows the renderer's own HTML in an iframe — the
 * same HTML the PDF is made from, so what the office sees is what prints.
 * (CIEL's ID quotation previews the same way.)
 *
 * Re-renders a moment after the last edit (POST /documents/preview-html with
 * the unsaved form state). `print()` prints the iframe's document.
 */
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Box, CircularProgress, Typography } from "@mui/material";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { installPrintedBy } from "@/helpers/printedBy";

export interface ServerDocumentPreviewHandle {
  /** Prints the iframe; `printedBy` is the "Printed by … on …" foot line for this print (helpers/printedBy.ts). */
  print: (printedBy?: string) => void;
}

interface Props {
  documentType: string;
  documentId?: string;
  templateId?: string;
  /** The editor's form state (+ items). Any change re-renders. */
  data: any;
  /** Dark-mode-safe backdrop is the parent's; the paper itself is always white. */
  minHeight?: number | string;
  /** Fires once the rendered HTML has loaded in the iframe (the editor's hidden print stage prints then). */
  onLoaded?: () => void;
}

// The document is laid out at A4 width and scaled DOWN to fit the preview
// column, so it never clips when the editor pane is narrow (guru 2026-10-27:
// same clipping as the sign link). Fixed width, no auto margins.
const FRAME_W = 794; // A4 width in CSS px at 96dpi
const PREVIEW_CSS = `<style>
  @media screen {
    html { background: transparent; }
    body { background: #fff; box-shadow: 0 2px 14px rgba(0,0,0,.25); width: ${FRAME_W}px; min-height: 297mm; margin: 12px 0 24px; }
  }
</style>`;

// Browser print of the WCT layout (guru 2026-11-23): Chrome draws its own
// header (date, title) and footer (URL, page no.) in the page margin when
// "Headers and footers" is ticked. With @page margin 0 it has no room to, and
// the document carries its own margins instead: 14mm left/right on the .wct
// wrapper (horizontal padding holds on every page) and ~12mm top/bottom from
// the renderer's spacer rows (wct.ts sheetTable: a row in the repeating thead
// and one in the repeating tfoot, 0 high on screen and in the server PDF), so
// every printed page keeps its top and bottom margin. Added to the iframe only
// for the print and only when it holds the WCT sheet, so CIEL's ID quotation
// (the other server layout) and the Puppeteer PDF are unaffected.
export const WCT_PRINT_STYLE_ID = "aims-wct-browser-print";
export const WCT_BROWSER_PRINT_CSS = `@media print {
  @page { size: A4; margin: 0 }
  .wct { padding: 0 14mm; }
  table.wct-sheet > thead > tr.wct-pgtop > td { height: 12mm !important; }
  table.wct-sheet > tfoot > tr.wct-pgbot > td { height: 12mm !important; }
}`;

/** Prints the iframe; a WCT sheet gets the browser-print CSS just for the print, and every layout its "Printed by" foot line. */
export function printServerDocument(w: Window, printedBy?: string): void {
  const doc = w.document;
  let style: HTMLStyleElement | null = null;
  let removePrintedBy: (() => void) | null = doc && printedBy ? installPrintedBy(doc, printedBy) : null;
  if (doc?.querySelector("table.wct-sheet") && !doc.getElementById(WCT_PRINT_STYLE_ID)) {
    style = doc.createElement("style");
    style.id = WCT_PRINT_STYLE_ID;
    style.textContent = WCT_BROWSER_PRINT_CSS;
    // Last in the document: the renderer's own <style> blocks sit in the body,
    // and a later sheet wins a tie.
    (doc.body || doc.documentElement).appendChild(style);
  }
  const cleanup = () => {
    style?.remove();
    style = null;
    removePrintedBy?.();
    removePrintedBy = null;
  };
  // Chrome's print() returns once the dialog closes; Safari returns at once and
  // fires afterprint later, so remove the style on afterprint (it is print-only
  // CSS, harmless on screen if that event never comes).
  w.addEventListener("afterprint", cleanup, { once: true });
  w.focus();
  w.print();
}

const ServerDocumentPreview = forwardRef<ServerDocumentPreviewHandle, Props>(function ServerDocumentPreview(
  { documentType, documentId, templateId, data, minHeight = "calc(100vh - 220px)", onLoaded },
  ref,
) {
  const { getToken } = useAuth();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  // Fit the A4 document to the preview column width, and reserve the scaled
  // height so the layout does not jump.
  const [frameScale, setFrameScale] = useState(1);
  const [contentH, setContentH] = useState<number | null>(null);
  const seq = useRef(0);

  const measure = () => {
    const w = wrapRef.current?.clientWidth || 0;
    if (w > 0) setFrameScale(Math.min(1, w / FRAME_W));
    try {
      const doc = iframeRef.current?.contentDocument;
      const h = doc?.body?.scrollHeight || doc?.documentElement?.scrollHeight || 0;
      if (h > 0) setContentH(h + 24);
    } catch {
      /* unreadable → keep null; falls back to minHeight */
    }
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth || 0;
      if (w > 0) setFrameScale(Math.min(1, w / FRAME_W));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Serialised once per change so the effect compares content, not identity
  // (the editor rebuilds its data object on every render).
  const payload = JSON.stringify({ documentType, documentId, templateId, data });

  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setRendering(true);
      try {
        const token = await getToken();
        if (!token) throw new Error("Not authenticated");
        const body = JSON.parse(payload);
        const res: any = await request({ path: "/documents/preview-html", method: "POST", ownError: true }, body, token);
        if (mine !== seq.current) return;
        const out = res?.data ?? res;
        if (res?.success === false || !out?.html) throw new Error(res?.message || "Preview failed");
        setHtml(String(out.html).replace("</head>", `${PREVIEW_CSS}</head>`));
        setError(null);
      } catch (e: any) {
        if (mine === seq.current) setError(e?.message || "Could not render the preview");
      } finally {
        if (mine === seq.current) setRendering(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [payload, getToken]);

  useImperativeHandle(ref, () => ({
    print: (printedBy?: string) => {
      const w = iframeRef.current?.contentWindow;
      if (!w) return;
      printServerDocument(w, printedBy);
    },
  }));

  return (
    <Box ref={wrapRef} sx={{ position: "relative", width: "100%", minHeight, overflow: "auto" }}>
      {rendering && (
        <Box sx={{ position: "absolute", top: 8, right: 8, zIndex: 1 }}>
          <CircularProgress size={18} />
        </Box>
      )}
      {error && (
        <Typography sx={{ p: 2, color: "error.main", fontSize: "0.85rem" }} data-testid="server-preview-error">
          {error}
        </Typography>
      )}
      {html ? (
        /* The wrapper is exactly the SCALED paper size (the transform does
           not change the iframe's layout box), so centring the wrapper
           centres the visible page like every other org's preview. */
        <Box
          sx={{
            width: `${Math.round(FRAME_W * frameScale)}px`,
            maxWidth: "100%",
            height: contentH ? `${Math.round(contentH * frameScale)}px` : minHeight,
            overflow: "hidden",
            mx: "auto",
          }}
        >
          <Box
            component="iframe"
            ref={iframeRef}
            title="Document preview"
            srcDoc={html}
            onLoad={() => {
              measure();
              onLoaded?.();
            }}
            sx={{
              width: `${FRAME_W}px`,
              height: contentH ? `${contentH}px` : minHeight,
              border: 0,
              bgcolor: "transparent",
              display: "block",
              transform: `scale(${frameScale})`,
              transformOrigin: "top left",
            }}
          />
        </Box>
      ) : (
        !error && (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: 320 }}>
            <CircularProgress size={28} />
          </Box>
        )
      )}
    </Box>
  );
});

export default ServerDocumentPreview;
