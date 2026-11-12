"use client";

// =============================================================================
// Report print/export standard (guru 2026-10-13) — ONE way out of every report:
//   Print           = the ACTUAL DOCUMENT (an A4 paper page or a generated PDF
//                     opened with the print dialog) — NEVER window.print() of
//                     the raw app screen.
//   Export ▾        = PDF (.pdf, jsPDF file download)
//                     Excel (.xlsx, real workbook via SheetJS — never HTML
//                     renamed .xls)
//                     CSV (.csv)
// Every report builds one ReportExportModel (title, meta lines, tables) and
// these helpers do the rest, so output looks identical everywhere: letterhead
// (org name, date, TITLE), filter meta lines, ruled table, bold TOTAL rows,
// page numbers. See CLAUDE.md "Report print & export standard".
// =============================================================================

import React, { useState } from "react";
import { Button, Divider, ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import GridOnOutlinedIcon from "@mui/icons-material/GridOnOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import EmailOutlinedIcon from "@mui/icons-material/EmailOutlined";
import { toast } from "react-toastify";
import SendReportEmailDialog from "./SendReportEmailDialog";

export type ReportExportTable = {
  /** optional heading printed above the table (e.g. an account or section) */
  heading?: string;
  headers: string[];
  rows: string[][];
  /** rows rendered bold with a top rule (TOTAL / SUB-TOTAL), by index */
  boldRows?: number[];
  /** legacy "Ageing Analysis:" box printed at the FOOT of this table's last
   *  page (guru 2026-11-11, Statement of Accounts): 12 month cells, 6 per row. */
  ageing?: { label: string; amount: number }[];
};

// Every report ends with the legacy statement line (guru 2026-11-11: "all
// reports need the 'this is a computer generated statement' line").
export const COMPUTER_GENERATED_NOTE = "This is a computer generated Statement. No signature is required.";

export type ReportExportModel = {
  title: string; // "TRIAL BALANCE"
  orgName: string;
  metaLines?: string[]; // ["Cut-Off-Date : 31/10/2026", "All outstanding items"]
  tables: ReportExportTable[];
  /** optional report note (e.g. "All figures in SGD"); the statement line prints under it on every report */
  note?: string;
  /** Email… prefill — e.g. the statement customer's address */
  emailTo?: string[];
};

const notesOf = (m: ReportExportModel) => [m.note, COMPUTER_GENERATED_NOTE].filter((n): n is string => !!n);
const fmtMoney = (n: number) => (Number(n) || 0).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const looksNumeric = (s: string) => /^-?\(?\s*[\d,]+(\.\d+)?\s*\)?$/.test((s || "").trim()) || s === "";

const fileBase = (title: string) => title.replace(/[^\w-]+/g, "-").replace(/-+/g, "-").toLowerCase();
// Local date for filenames — toISOString() is UTC and stamps yesterday's date
// for a Singapore morning.
const localDateISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ---------------------------------------------------------------------------
// Generic DOM capture: serialise every <table> inside a container into the
// model. Lets the ~25 ReportShell reports export without per-report code.
// ---------------------------------------------------------------------------
export function domToExportModel(
  container: HTMLElement | null,
  title: string,
  orgName: string,
  metaLines?: string[],
): ReportExportModel | null {
  if (!container) return null;
  const tables: ReportExportTable[] = [];
  container.querySelectorAll("table").forEach((t) => {
    const headers = Array.from(t.querySelectorAll("thead th")).map((c) => (c.textContent || "").trim());
    const rows: string[][] = [];
    const boldRows: number[] = [];
    t.querySelectorAll("tbody tr").forEach((tr) => {
      if ((tr as HTMLElement).offsetParent === null && !(tr as HTMLElement).closest("table")) return;
      const cells = Array.from(tr.querySelectorAll("td, th")).map((c) => (c.textContent || "").trim());
      if (cells.every((c) => c === "")) return;
      const weight = window.getComputedStyle(tr.querySelector("td, th") as Element).fontWeight;
      if (parseInt(weight, 10) >= 600 || /total/i.test(cells[0] + cells[1])) boldRows.push(rows.length);
      rows.push(cells);
    });
    if (rows.length || headers.some(Boolean)) tables.push({ headers, rows, boldRows });
  });
  if (!tables.length) return null;
  return { title, orgName, metaLines, tables };
}

// ---------------------------------------------------------------------------
// PDF — the debtor-statement look: centred letterhead, meta lines, ruled
// grid tables, page numbers. `print` opens the PDF with the print dialog
// instead of downloading (that IS the report's Print action).
// ---------------------------------------------------------------------------
async function buildReportPdf(model: ReportExportModel) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold").setFontSize(13);
  doc.text(model.orgName || "", pageW / 2, 16, { align: "center" });
  doc.setFont("helvetica", "normal").setFontSize(9);
  doc.text(new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }), pageW / 2, 21, { align: "center" });
  doc.setFont("helvetica", "bold").setFontSize(12);
  doc.text(model.title.toUpperCase(), pageW / 2, 29, { align: "center" });
  doc.setFont("helvetica", "normal").setFontSize(9);
  let y = 36;
  for (const m of model.metaLines || []) {
    doc.text(m, 12, y);
    y += 5;
  }
  y += 1;

  for (const t of model.tables) {
    if (t.heading) {
      doc.setFont("helvetica", "bold").setFontSize(9.5);
      doc.text(t.heading, 12, y + 4);
      y += 6;
    }
    const numericCols = t.headers.map((_, ci) => t.rows.length > 0 && t.rows.every((r) => looksNumeric(r[ci] ?? "")));
    autoTable(doc, {
      startY: y,
      head: [t.headers],
      body: t.rows,
      margin: { left: 12, right: 12 },
      styles: { font: "helvetica", fontSize: 8, cellPadding: 1.2, textColor: 20 },
      headStyles: { fillColor: false as any, textColor: 20, fontStyle: "bold", lineWidth: { bottom: 0.3 } as any },
      theme: "plain",
      columnStyles: Object.fromEntries(numericCols.map((isNum, ci) => [ci, isNum ? { halign: "right" } : {}])),
      didParseCell: (d: any) => {
        if (d.section === "body" && t.boldRows?.includes(d.row.index)) {
          d.cell.styles.fontStyle = "bold";
          d.cell.styles.lineWidth = { top: 0.2 };
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
    const pageH = doc.internal.pageSize.getHeight();

    if (t.ageing?.length) {
      // Legacy A's Premier layout: the box sits at the FOOT of the page, the
      // table above it — a fresh page when the table ran into that space.
      const rowsN = Math.ceil(t.ageing.length / 6);
      const boxH = rowsN * 12;
      const boxTop = pageH - 22 - boxH; // leaves room for the note line under it
      if (y + 5 > boxTop) {
        doc.addPage();
      }
      const boxW = (pageW - 24) / 6;
      doc.setFont("helvetica", "bold").setFontSize(8.5);
      doc.text("Ageing Analysis:", 12, boxTop - 2);
      doc.setLineWidth(0.3).roundedRect(12, boxTop, pageW - 24, boxH, 2, 2);
      t.ageing.forEach((b, i) => {
        const bx = 12 + (i % 6) * boxW;
        const by = boxTop + Math.floor(i / 6) * 12;
        doc.setFont("helvetica", "normal").setFontSize(7.5);
        doc.text(b.label, bx + boxW / 2, by + 5, { align: "center" });
        if (b.amount) {
          doc.setFont("helvetica", "normal").setFontSize(8);
          doc.text(fmtMoney(b.amount), bx + boxW / 2, by + 10, { align: "center" });
        }
      });
      y = boxTop + boxH + 6;
    }

    if (y > pageH - 30 && t !== model.tables[model.tables.length - 1]) {
      doc.addPage();
      y = 16;
    }
  }

  {
    const pageH = doc.internal.pageSize.getHeight();
    const notes = notesOf(model);
    // Last page foot, like the legacy statement — never squeezed under a table.
    let ny = Math.min(Math.max(y + 4, pageH - 8 - 4 * notes.length), pageH - 8 - 4 * (notes.length - 1));
    doc.setFont("helvetica", "normal").setFontSize(7.5);
    for (const n of notes) {
      doc.text(n, pageW - 12, ny, { align: "right" });
      ny += 4;
    }
  }

  // Page numbers on every page.
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal").setFontSize(8);
    doc.text(`Page ${p} of ${pages}`, pageW - 12, 10, { align: "right" });
  }

  return doc;
}

export const reportPdfFilename = (model: ReportExportModel) => `${fileBase(model.title)}-${localDateISO()}.pdf`;

export async function exportReportPdf(model: ReportExportModel, opts?: { print?: boolean }) {
  const doc = await buildReportPdf(model);
  if (opts?.print) {
    doc.autoPrint();
    const url = doc.output("bloburl");
    window.open(url, "_blank");
  } else {
    doc.save(reportPdfFilename(model));
  }
}

/** The same PDF as "Save as PDF", base64 for the Email… attachment. */
export async function reportPdfBase64(model: ReportExportModel): Promise<{ filename: string; base64: string }> {
  const doc = await buildReportPdf(model);
  const dataUri = doc.output("datauristring");
  return { filename: reportPdfFilename(model), base64: dataUri.slice(dataUri.indexOf(",") + 1) };
}

// ---------------------------------------------------------------------------
// Excel — a REAL .xlsx workbook (SheetJS). Numeric-looking cells become real
// numbers so Excel can sum them; parenthesised amounts become negatives.
// ---------------------------------------------------------------------------
export async function exportReportXlsx(model: ReportExportModel) {
  const XLSX = await import("xlsx");
  const aoa: (string | number)[][] = [[model.orgName], [model.title.toUpperCase()], ...(model.metaLines || []).map((m) => [m]), []];
  for (const t of model.tables) {
    if (t.heading) aoa.push([t.heading]);
    aoa.push(t.headers);
    for (const r of t.rows) {
      aoa.push(
        r.map((c) => {
          const s = (c || "").trim();
          if (s && looksNumeric(s) && /\d/.test(s)) {
            const n = parseFloat(s.replace(/[(),\s]/g, ""));
            if (!isNaN(n)) return /^\(.*\)$/.test(s) ? -n : n;
          }
          return s;
        }),
      );
    }
    if (t.ageing?.length) {
      aoa.push(["Ageing Analysis"]);
      aoa.push(t.ageing.map((b) => b.label));
      aoa.push(t.ageing.map((b) => Math.round((Number(b.amount) || 0) * 100) / 100));
    }
    aoa.push([]);
  }
  for (const n of notesOf(model)) aoa.push([n]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = (model.tables[0]?.headers || []).map((h, i) => ({ wch: i === 1 ? 42 : Math.max(14, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, model.title.slice(0, 31) || "Report");
  XLSX.writeFile(wb, `${fileBase(model.title)}-${localDateISO()}.xlsx`);
}

export function exportReportCsv(model: ReportExportModel) {
  const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines: string[] = [];
  for (const t of model.tables) {
    if (t.heading) lines.push(esc(t.heading));
    lines.push(t.headers.map(esc).join(","));
    for (const r of t.rows) lines.push(r.map(esc).join(","));
    if (t.ageing?.length) {
      lines.push(esc("Ageing Analysis"));
      lines.push(t.ageing.map((b) => esc(b.label)).join(","));
      lines.push(t.ageing.map((b) => esc((Number(b.amount) || 0).toFixed(2))).join(","));
    }
    lines.push("");
  }
  for (const n of notesOf(model)) lines.push(esc(n));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileBase(model.title)}-${localDateISO()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// The standard control: ONE "Print / Export" button opening ONE menu of output
// destinations — the legacy software's "Output Destinations" prompt, modern.
// An accountant never has to decide between "Print" and "Export → PDF":
//   Print            → the document on paper (print dialog)
//   Save as PDF      → the same document as a .pdf download
//   Export to Excel  → a real .xlsx
//   Export to CSV    → .csv
// `getModel` runs at click time so it captures the report's current state;
// paper-document pages pass `onPrint` (window.print of their A4 sheet).
// ---------------------------------------------------------------------------
export function ReportPrintExportButton({
  getModel,
  onPrint,
  onSavePdf,
  onExportCsv,
  size = "small",
  variant = "outlined",
  withEmail = false,
}: {
  getModel: () => ReportExportModel | null;
  /** also render the Send Email button right after this one (horizontal toolbars) */
  withEmail?: boolean;
  /** override for Print — e.g. a paper page's window.print(), or the GL home's filter dialog */
  onPrint?: () => void;
  /** override for Save as PDF: a paper document the server draws (e.g. the WCT vehicle usage form) */
  onSavePdf?: () => void;
  /** per-report CSV override (richer than the generic model, e.g. full-range CSVs) */
  onExportCsv?: () => void;
  size?: "small" | "medium";
  variant?: "outlined" | "contained";
}) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const run = async (fn: (m: ReportExportModel) => void | Promise<void>) => {
    setAnchor(null);
    const m = getModel();
    if (!m) {
      toast.info("Nothing to print or export yet — run the report first");
      return;
    }
    try {
      await fn(m);
    } catch (e: any) {
      toast.error(e?.message || "Could not produce the document");
    }
  };
  return (
    <>
      <Button
        size={size}
        variant={variant}
        startIcon={<PrintOutlinedIcon />}
        endIcon={<ArrowDropDownIcon />}
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        Print / Export
      </Button>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem
          onClick={() => {
            if (onPrint) {
              setAnchor(null);
              onPrint();
            } else {
              run((m) => exportReportPdf(m, { print: true }));
            }
          }}
        >
          <ListItemIcon><PrintOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Print</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (onSavePdf) {
              setAnchor(null);
              onSavePdf();
            } else {
              run((m) => exportReportPdf(m));
            }
          }}
        >
          <ListItemIcon><PictureAsPdfOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Save as PDF</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => run((m) => exportReportXlsx(m))}>
          <ListItemIcon><GridOnOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Export to Excel (.xlsx)</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (onExportCsv) {
              setAnchor(null);
              onExportCsv();
            } else {
              run((m) => exportReportCsv(m));
            }
          }}
        >
          <ListItemIcon><FileDownloadOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Export to CSV (.csv)</ListItemText>
        </MenuItem>
      </Menu>
      {withEmail && <ReportEmailButton getModel={getModel} size={size} variant={variant} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// SEND EMAIL — its own button under Print / Export (guru 2026-11-11: "add a
// send email button below the print button"): the sales documents' compose
// dialog with the report's PDF attached.
// ---------------------------------------------------------------------------
export function ReportEmailButton({
  getModel,
  size = "small",
  variant = "outlined",
}: {
  getModel: () => ReportExportModel | null;
  size?: "small" | "medium";
  variant?: "outlined" | "contained";
}) {
  const [emailModel, setEmailModel] = useState<ReportExportModel | null>(null);
  return (
    <>
      <Button
        size={size}
        variant={variant}
        startIcon={<EmailOutlinedIcon />}
        onClick={() => {
          const m = getModel();
          if (!m) {
            toast.info("Nothing to email yet — run the report first");
            return;
          }
          setEmailModel(m);
        }}
      >
        Send Email
      </Button>
      <SendReportEmailDialog open={!!emailModel} model={emailModel} onClose={() => setEmailModel(null)} />
    </>
  );
}

/** @deprecated use ReportPrintExportButton — kept so stray imports fail soft */
export const ReportExportMenu = ReportPrintExportButton;
