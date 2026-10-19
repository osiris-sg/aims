"use client";

/**
 * Shared primitives for the "paper document" financial reports (P&L, Balance
 * Sheet, Trial Balance): a white A4 sheet that is the ONLY thing that prints,
 * the centred org/date/title header, and the legacy number formatting.
 * Extracted from profit-loss/page.tsx so every statement renders identically.
 */

import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Paper, Typography } from "@mui/material";

// Paper typography — shared by the visible sheets AND the off-screen
// measuring pass, so measured heights match what prints.
export const PAPER_TYPOGRAPHY = {
  fontFamily: "var(--font-carlito), 'Calibri', 'Arial', sans-serif",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
} as const;
// A4 content box: 297mm − 2 × 20mm padding (height), 210mm − 40mm (width).
export const PAPER_CONTENT_HEIGHT = "257mm";
export const PAPER_CONTENT_WIDTH = "170mm";

export const fmt = (n: number) => {
  if (n === 0) return "0.00";
  if (n < 0)
    return `( ${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} )`;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const formatHumanDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export const formatShortDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });

// White A4-sized paper that frames the printable report content. Deliberately
// white-on-black in BOTH themes — it is a document on paper, not app chrome.
// `breakAfter` marks a non-final sheet of a multi-page report: printing then
// starts the next sheet on a fresh page (single-sheet reports pass nothing).
export function PaperSheet({ children, breakAfter }: { children: React.ReactNode; breakAfter?: boolean }) {
  return (
    // Phone: the A4 sheet scrolls inside this container, page body doesn't
    <Box sx={{ display: "flex", justifyContent: { xs: "flex-start", md: "center" }, py: 1, overflowX: "auto" }}>
      <Paper
        data-print-paper
        {...(breakAfter ? { "data-print-break": "1" } : {})}
        elevation={2}
        sx={{
          width: "210mm",
          flexShrink: 0,
          minHeight: "297mm",
          p: "20mm",
          backgroundColor: "white",
          color: "#000",
          ...PAPER_TYPOGRAPHY,
        }}
      >
        {children}
      </Paper>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Measured A4 pagination (guru 2026-10-16: "it cuts off weirdly" — counting
// rows per page can never be right because rows wrap and headers vary).
// The rows are rendered ONCE off-screen at the paper's content width and
// typography, their real pixel heights are measured, and pages are cut by a
// pixel budget against a true 257mm box. Each page repeats `header(pageNo,
// pageCount)`; `footer` (grand TOTAL etc.) is kept whole on the last page;
// rows flagged `keepWithNext` (section/account headers) never end a page.
// useLayoutEffect runs before paint, so the first frame is already paginated.
// ---------------------------------------------------------------------------
export function PaginatedPaper({
  header,
  rows,
  footer,
  keepWithNext,
  measureKey,
}: {
  header: (pageNo: number, pageCount: number) => React.ReactNode;
  rows: React.ReactNode[];
  footer?: React.ReactNode;
  /** rows[i] must not be the last row on a page (section headers) */
  keepWithNext?: boolean[];
  /** changes when the DATA changes — triggers a re-measure */
  measureKey: string;
}) {
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [pages, setPages] = useState<number[][] | null>(null);

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const pageBox = el.querySelector<HTMLElement>("[data-measure-page]");
    const headerEl = el.querySelector<HTMLElement>("[data-measure-header]");
    const footerEl = el.querySelector<HTMLElement>("[data-measure-footer]");
    const rowEls = Array.from(el.querySelectorAll<HTMLElement>("[data-measure-row]"));
    if (!pageBox || !headerEl) return;
    const pageH = pageBox.offsetHeight;
    const headerH = headerEl.offsetHeight;
    const footerH = footerEl?.offsetHeight ?? 0;
    const heights = rowEls.map((r) => r.offsetHeight);
    // Safety margin for sub-pixel rounding between screen and print.
    const budget = pageH - headerH - 12;

    const out: number[][] = [];
    let cur: number[] = [];
    let used = 0;
    for (let i = 0; i < heights.length; i++) {
      const h = heights[i];
      const glue = keepWithNext?.[i] && i + 1 < heights.length ? heights[i + 1] : 0;
      if (cur.length && used + h + glue > budget) {
        out.push(cur);
        cur = [];
        used = 0;
      }
      cur.push(i);
      used += h;
    }
    if (footer && cur.length && used + footerH > budget) {
      out.push(cur);
      cur = [];
    }
    out.push(cur);
    setPages(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureKey, rows.length]);

  const pageCount = pages?.length ?? 1;

  return (
    <>
      {/* Off-screen measuring pass — same width + typography as the paper. */}
      <Box
        ref={measureRef}
        aria-hidden
        className="no-print"
        sx={{
          position: "absolute",
          left: -20000,
          top: 0,
          width: PAPER_CONTENT_WIDTH,
          visibility: "hidden",
          pointerEvents: "none",
          color: "#000",
          ...PAPER_TYPOGRAPHY,
        }}
      >
        <div data-measure-page style={{ height: PAPER_CONTENT_HEIGHT }} />
        <div data-measure-header>{header(1, 1)}</div>
        {rows.map((r, i) => (
          <div key={i} data-measure-row>
            {r}
          </div>
        ))}
        {footer && <div data-measure-footer>{footer}</div>}
      </Box>

      {(pages ?? [rows.map((_, i) => i)]).map((idxs, p) => {
        const last = p === pageCount - 1;
        return (
          <PaperSheet key={p} breakAfter={!last}>
            {header(p + 1, pageCount)}
            {idxs.map((i) => (
              <React.Fragment key={i}>{rows[i]}</React.Fragment>
            ))}
            {last && footer}
          </PaperSheet>
        );
      })}
    </>
  );
}

export function ReportHeader({
  organization,
  date,
  title,
}: {
  organization: any;
  date: string;
  title: string;
}) {
  return (
    <Box sx={{ textAlign: "center", mb: 3 }}>
      <Typography sx={{ fontSize: "1rem", fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>
        {organization?.name || "Company Name"}
      </Typography>
      <Typography sx={{ fontSize: "0.8125rem", mt: 0.25 }}>{formatHumanDate(date)}</Typography>
      <Typography sx={{ fontSize: "0.9375rem", fontWeight: 700, mt: 1.5, letterSpacing: 1 }}>{title}</Typography>
    </Box>
  );
}

// Print CSS — ONLY the paper prints. Everything that is not a paper sheet,
// inside one, or an ancestor of one is removed (kills the nav bar, sidebar,
// Guide-assistant bubble, toasts — anything, marked .no-print or not), and the
// ancestor chain collapses to zero-chrome wrappers so no stray padding spills
// the sheet onto a phantom extra page. Render once per report page.
export function ReportPrintCss() {
  return (
    <style jsx global>{`
      @media print {
        @page {
          size: A4;
          margin: 0;
        }
        body {
          background: white !important;
        }
        .no-print {
          display: none !important;
        }
        body *:not([data-print-paper]):not([data-print-paper] *):not(:has([data-print-paper])) {
          display: none !important;
        }
        body *:has([data-print-paper]) {
          display: block !important;
          margin: 0 !important;
          padding: 0 !important;
          width: auto !important;
          max-width: none !important;
          border: 0 !important;
          box-shadow: none !important;
          background: white !important;
          overflow: visible !important;
        }
        [data-print-paper] {
          box-shadow: none !important;
          margin: 0 !important;
          padding: 20mm !important;
          width: 210mm !important;
          /* content defines the height — a fixed 297mm min-height rounds past
             one physical page and prints a blank trailing sheet */
          min-height: auto !important;
        }
        [data-print-break="1"] {
          break-after: page;
        }
      }
    `}</style>
  );
}
