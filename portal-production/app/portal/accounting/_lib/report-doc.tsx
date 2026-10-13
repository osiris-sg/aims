"use client";

/**
 * Shared primitives for the "paper document" financial reports (P&L, Balance
 * Sheet, Trial Balance): a white A4 sheet that is the ONLY thing that prints,
 * the centred org/date/title header, and the legacy number formatting.
 * Extracted from profit-loss/page.tsx so every statement renders identically.
 */

import { Box, Paper, Typography } from "@mui/material";

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
          fontFamily: "var(--font-carlito), 'Calibri', 'Arial', sans-serif",
          fontSize: "0.8125rem",
          lineHeight: 1.5,
        }}
      >
        {children}
      </Paper>
    </Box>
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
