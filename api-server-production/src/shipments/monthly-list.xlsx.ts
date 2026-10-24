/**
 * Round AG — the Monthly order list as an .xlsx in ADH's OWN layout (so they can keep using the sheet): a title row,
 * the three header groups (Order / Supplier / Shipment information, merged across their columns), the header row,
 * then one block per client (a block title row, its rows; an order's order / supplier cells merged down over its
 * shipment rows). The two Status columns are filled yellow like theirs. ExcelJS (SheetJS CE cannot write fills).
 */
import { Workbook } from 'exceljs';
import { GROUPS, HEADERS, MonthlyBlock, monthLabel, rowCells, YELLOW_COLS } from './monthly-list';

const YELLOW = 'FFFFFF00';
const GROUP_FILL = ['FFDDEBF7', 'FFE2EFDA', 'FFFCE4D6'];
const BORDER = { style: 'thin' as const, color: { argb: 'FF999999' } };
const WIDTHS = [12, 10, 12, 22, 11, 9, 13, 13, 12, 18, 12, 10, 12, 26, 12, 16, 12, 12];
/** Order + supplier columns (0-based) whose cells merge down over an order's shipment rows. */
const ORDER_COLS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export async function monthlyXlsx(blocks: MonthlyBlock[], meta: { orgName: string; from: string; to: string; basis: 'delivery' | 'ship'; generatedAt: Date }): Promise<Buffer> {
  const wb = new Workbook();
  wb.creator = 'AIMS';
  wb.created = meta.generatedAt;
  const ws = wb.addWorksheet('Monthly order list', { views: [{ state: 'frozen', ySplit: 3 }] });
  ws.columns = WIDTHS.map((width) => ({ width }));
  const range = meta.from === meta.to ? monthLabel(meta.from) : `${monthLabel(meta.from)} – ${monthLabel(meta.to)}`;
  const title = ws.addRow([`${meta.orgName} · Monthly order list · ${range} (${meta.basis === 'ship' ? 'shipment month' : 'delivery month'}) · ${meta.generatedAt.toISOString().slice(0, 10)}`]);
  title.font = { bold: true, size: 12 };
  ws.mergeCells(1, 1, 1, HEADERS.length);

  // Row 2: the three groups, merged across their columns.
  const groupRow = ws.addRow([]);
  let c = 1;
  GROUPS.forEach((g, i) => {
    const cell = groupRow.getCell(c);
    cell.value = g.title;
    ws.mergeCells(2, c, 2, c + g.cols - 1);
    for (let k = c; k < c + g.cols; k++) {
      const x = groupRow.getCell(k);
      x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GROUP_FILL[i] } };
      x.border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
    }
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center' };
    c += g.cols;
  });
  // Row 3: the headers.
  const head = ws.addRow([...HEADERS]);
  head.eachCell((cell, n) => {
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW_COLS.includes(n - 1) ? YELLOW : 'FFF2F2F2' } };
  });

  for (const b of blocks) {
    const br = ws.addRow([`${b.client} — ${b.orders} order${b.orders === 1 ? '' : 's'} · ${b.tons.toLocaleString('en-US', { maximumFractionDigits: 3 })} t`]);
    br.font = { bold: true };
    ws.mergeCells(br.number, 1, br.number, HEADERS.length);
    br.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
    let i = 0;
    while (i < b.rows.length) {
      const r0 = b.rows[i];
      const span = r0.first ? r0.span : 1;
      const firstRow = ws.lastRow!.number + 1;
      for (let k = 0; k < span && i < b.rows.length; k++, i++) {
        const row = ws.addRow(rowCells(b.rows[i]));
        row.eachCell({ includeEmpty: true }, (cell, n) => {
          if (n > HEADERS.length) return;
          cell.border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
          cell.alignment = { vertical: 'middle', wrapText: n === 4 || n === 14 };
          if (YELLOW_COLS.includes(n - 1)) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW } };
          if (n === 6 || n === 12) cell.numFmt = '#,##0.000';
        });
      }
      const lastRow = ws.lastRow!.number;
      if (lastRow > firstRow) for (const col of ORDER_COLS) ws.mergeCells(firstRow, col + 1, lastRow, col + 1);
    }
  }
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
