/**
 * Server-side renderer for ACCOUNTING REPORT PDFs — the report counterpart of
 * document-html/ (guru 2026-10-16).
 *
 * Why this exists: the reports already had a PDF, but only in the browser.
 * /portal/reports/statement-of-account builds it with jsPDF from the rendered
 * DOM, so a file only exists if a human has the page open and clicks Export.
 * The backend had no way to produce one, which is why the WhatsApp agent,
 * asked for an SOA, could read out the numbers but not attach the statement —
 * and then invented a reason ("PDFs can't be sent over WhatsApp") for a gap it
 * had no tool to describe.
 *
 * The data was never the problem: every report in the module is computed
 * server-side already (statements.service, xero-reports.service,
 * journal.service). Only the render was missing, so this ports it the same way
 * documents were ported — HTML here, Puppeteer to PDF, S3, signed URL.
 *
 * Paper rules (guru): a report is a paper document, so EVERY page carries the
 * full header and its own page number, and the grand total closes the last
 * page. That is why the header lives in <thead> with table-header-group —
 * document-html deliberately uses table-row-group because a document is one
 * page and must NOT repeat; a report runs to many and must.
 */
import { escapeHtml, formatDate, money } from '../document-html/shared';

export interface ReportColumn {
  key: string;
  label: string;
  /** Right-align and format as money. */
  money?: boolean;
  /** Right-align without money formatting (counts, days). */
  numeric?: boolean;
  width?: string;
}

export interface ReportSection {
  /** Rendered above the rows, e.g. an account name in a grouped report. */
  title?: string;
  rows: Array<Record<string, any>>;
  /** Closing line for the section, keyed like a row. */
  total?: Record<string, any>;
}

export interface ReportModel {
  /** Report name exactly as the portal titles it — the legacy wording wins. */
  title: string;
  /** "As at 31 Dec 2026" or "1 Jan 2026 to 31 Dec 2026". */
  period?: string | null;
  /** Who the report is about (customer/supplier), shown under the title. */
  subject?: string | null;
  /** Label/value pairs for the header block (balances, contact, terms). */
  facts?: Array<{ label: string; value: string }>;
  columns: ReportColumn[];
  sections: ReportSection[];
  /** Closes the whole report on the final page. */
  grandTotal?: Record<string, any> | null;
  /** Shown under the grand total, e.g. the currency note. */
  notes?: string[];
  organizationName?: string | null;
  logoUrl?: string | null;
  currency?: string | null;
}

const cellValue = (col: ReportColumn, row: Record<string, any>): string => {
  const raw = row?.[col.key];
  if (raw === null || raw === undefined || raw === '') return '';
  if (col.money) return money(raw);
  if (raw instanceof Date) return formatDate(raw);
  return escapeHtml(raw);
};

const align = (col: ReportColumn) => (col.money || col.numeric ? 'text-align:right;' : '');

function renderRow(cols: ReportColumn[], row: Record<string, any>, opts: { bold?: boolean; rule?: boolean } = {}) {
  const style = [opts.bold ? 'font-weight:600;' : '', opts.rule ? 'border-top:1px solid #000;' : ''].join('');
  return `<tr>${cols
    .map((c) => `<td style="${align(c)}${style}">${cellValue(c, row)}</td>`)
    .join('')}</tr>`;
}

/**
 * The A4 shell. The header block is repeated by the browser on every page
 * because it sits in <thead> — a fixed-position header would overlap the rows
 * instead, and a header printed once leaves page 2 onwards unidentifiable,
 * which is exactly what the paper rule forbids.
 */
export function reportShell(model: ReportModel): string {
  const cols = model.columns;
  const span = cols.length;

  const facts = (model.facts || []).length
    ? `<div class="facts">${(model.facts || [])
        .map(
          (f) =>
            `<div class="fact"><span class="fact-l">${escapeHtml(f.label)}</span><span class="fact-v">${escapeHtml(f.value)}</span></div>`,
        )
        .join('')}</div>`
    : '';

  const headerBlock = `
    <div class="rpt-head">
      <div class="rpt-org">${escapeHtml(model.organizationName || '')}</div>
      <div class="rpt-title">${escapeHtml(model.title)}</div>
      ${model.subject ? `<div class="rpt-subject">${escapeHtml(model.subject)}</div>` : ''}
      ${model.period ? `<div class="rpt-period">${escapeHtml(model.period)}</div>` : ''}
      ${facts}
    </div>`;

  const body = model.sections
    .map((s) => {
      const title = s.title
        ? `<tr><td colspan="${span}" style="padding-top:12px;font-weight:600;">${escapeHtml(s.title)}</td></tr>`
        : '';
      const rows = s.rows.length
        ? s.rows.map((r) => renderRow(cols, r)).join('')
        : `<tr><td colspan="${span}" style="color:#666;">No entries for this period.</td></tr>`;
      const total = s.total ? renderRow(cols, s.total, { bold: true, rule: true }) : '';
      return title + rows + total;
    })
    .join('');

  const grand = model.grandTotal
    ? `<tr class="grand">${cols
        .map((c) => `<td style="${align(c)}font-weight:700;border-top:2px solid #000;">${cellValue(c, model.grandTotal!)}</td>`)
        .join('')}</tr>`
    : '';

  const notes = (model.notes || []).length
    ? `<tr><td colspan="${span}" class="notes">${(model.notes || []).map((n) => escapeHtml(n)).join('<br/>')}</td></tr>`
    : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  /* Margins come from Puppeteer (REPORT_PDF_MARGIN) so they apply to EVERY
     page; the bottom margin is the band the page number sits in. */
  @page { size: A4; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 11px;
    line-height: 1.5;
    color: #000;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  table { width: 100%; border-collapse: collapse; }
  /* table-header-group is what makes the header repeat on every printed page.
     document-html uses table-row-group on purpose — a document is one page. */
  thead { display: table-header-group; }
  tbody { display: table-row-group; }
  tr { page-break-inside: avoid; }
  td, th { padding: 4px 6px; vertical-align: top; }
  thead .cols th {
    border-bottom: 1.5px solid #000;
    border-top: 1px solid #000;
    font-weight: 600;
    text-align: left;
    background: #f2f2f2;
  }
  thead .cols th.r { text-align: right; }
  .rpt-head { padding-bottom: 6px; }
  .rpt-org { font-size: 13px; font-weight: 700; }
  .rpt-title { font-size: 16px; font-weight: 700; margin-top: 2px; }
  .rpt-subject { font-size: 12px; font-weight: 600; margin-top: 2px; }
  .rpt-period { font-size: 11px; color: #333; }
  .facts { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 2px 18px; }
  .fact { font-size: 11px; }
  .fact-l { color: #555; margin-right: 5px; }
  .fact-v { font-weight: 600; }
  .notes { padding-top: 10px; font-size: 10px; color: #444; }
  tbody tr:nth-child(even) td { background: #fafafa; }
  tr.grand td { background: #fff; }
</style>
</head><body>
<table>
  <thead>
    <tr><th colspan="${span}" style="padding:0;">${headerBlock}</th></tr>
    <tr class="cols">${cols
      .map((c) => `<th class="${c.money || c.numeric ? 'r' : ''}"${c.width ? ` style="width:${c.width};"` : ''}>${escapeHtml(c.label)}</th>`)
      .join('')}</tr>
  </thead>
  <tbody>
    ${body}
    ${grand}
    ${notes}
  </tbody>
</table>
</body></html>`;
}

/** Same geometry as the ported documents, plus room for the page-number band. */
export const REPORT_PDF_MARGIN = { top: '12mm', right: '10mm', bottom: '16mm', left: '10mm' };
