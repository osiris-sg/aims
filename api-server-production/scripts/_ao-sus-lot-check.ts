/**
 * Round AO — dev-only check of the SUS lot layouts against ADH's real files (no DB): builds the multi-B/L COA summary
 * and the per-B/L-sheet PACKING LIST from Vedanta's COA.XLS / PL.XLS in the Drive folders, writes our PDF / .xlsx and
 * a cell diff against ADH's files. Usage: npx ts-node --transpile-only scripts/_ao-sus-lot-check.ts <outDir>
 */
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { parseSheetFile } from '../src/shipments/trade-sheet.parser';
import { buildSusCoaSummary, buildSusPackingList, mergeSusCoaParts, renderSusCoaHtml, susLotPackingRows, susPackingListXlsx, SUS_COA_COLUMNS, SUS_COA_FOOTER, SUS_COA_SIGN_BLOCK, VEDANTA_PRODUCER_BLOCK } from '../src/shipments/trade-sus-formats';

const OUT = process.argv[2];
const D = `${process.env.HOME}/Desktop/ADH_Docs/_drive/Docs/Docs/Docs 202611(Sep Shipment)`;
const L6005 = [
  { bl: '198GX06322', dir: `${D}/6005 8 inch 220 ton/6005_8inch_198GX06322_183.693_MT_Yokohama_454003255`, coa: 'COA.XLS', date: '2026-09-26', xp: 'XP2652102340' },
  { bl: '198GX06516', dir: `${D}/6005 8 inch 220 ton/6005 8 inch_198GX06516_20.416_MT_Yokohama_454003255`, coa: 'COA.XLS', date: '2026-10-06', xp: 'XP2652102549' },
  { bl: '198GX06524', dir: `${D}/6005 8 inch 220 ton/6005_8inch_198GX06524_17.861_MT_Yokohama_454003255`, coa: 'COA　17t.XLS', date: '2026-10-06', xp: 'XP2652102548' },
];
const L6063 = [
  { bl: '198GX06522', dir: `${D}/6063 8 inch 300ton/6063_8inch_198GX06522_281.919_MT_Yokohama_454003422` },
  { bl: '198GX06523', dir: `${D}/6063 8 inch 300ton/6063_8inch_198GX06523_15.296_MT_Yokohama_454003422` },
];
const sheet = (f: string) => parseSheetFile(fs.readFileSync(f));
const lines: string[] = [];
(async () => {
  // COA summary across the 6005 lot
  const merged = mergeSusCoaParts(L6005.map((p) => ({ blNumber: p.bl, date: p.date, invoiceNo: p.xp, rows: buildSusCoaSummary(sheet(path.join(p.dir, p.coa)), { piecesPerBundle: 5 }).rows })));
  const theirs = XLSX.utils.sheet_to_json<any[]>(XLSX.readFile(`${L6005[0].dir}/COA_集計ファイル_Sep Shipment 6005_221.970t.xlsx`).Sheets['提出用'], { header: 1, raw: true });
  const hi = theirs.findIndex((r) => (r ?? []).some((c) => String(c ?? '').trim() === 'Cast No'));
  const c0 = (theirs[hi] ?? []).findIndex((c) => String(c ?? '').trim() === 'Cast No');
  for (let i = 0; i < theirs.length; i++) theirs[i] = (theirs[i] ?? []).slice(c0);
  const keys = SUS_COA_COLUMNS.map((c) => c.key);
  lines.push(`COA lot 6005: ${merged.rows.length} casts; date line "${merged.dateLine}"; invoices "${merged.invoiceNo}"`, ...merged.notes.map((n) => `  note: ${n}`));
  let diffs = 0;
  merged.rows.forEach((r, i) => {
    const t = theirs[hi + 1 + i] ?? [];
    keys.forEach((k, j) => {
      const a = r[k]; const b = t[j];
      const same = a === null || a === undefined || a === '' ? b === undefined || b === null || b === '' : typeof b === 'number' || /^[\d.]+$/.test(String(b)) ? Math.abs(Number(a) - Number(b)) < 0.00051 : String(a).replace(/"/g, '').trim() === String(b).replace(/"/g, '').trim();
      if (!same) { diffs++; lines.push(`  COA diff row ${i + 1} ${r.batch} ${k}: ours ${a} | ADH ${b}`); }
    });
  });
  const tot = theirs[hi + 1 + merged.rows.length] ?? [];
  const ours = ['netwt', 'grosswt', 'bundles', 'pieces'].map((k) => Math.round(merged.rows.reduce((a, r) => a + (Number(r[k]) || 0), 0) * 1000) / 1000);
  lines.push(`  totals ours ${ours.join(' / ')} | ADH ${[tot[2], tot[3], tot[4], tot[5]].join(' / ')}; ${diffs} differing cells`);
  const { css, body } = renderSusCoaHtml({ title: 'CERTIFICATE OF ANALYSIS', producerBlock: VEDANTA_PRODUCER_BLOCK, date: merged.date, dateLine: merged.dateLine, invoiceNo: merged.invoiceNo, goodsDescription: 'ALUMINIUM BILLET ALLOY 6005 203 MM X 5800 MM', brand: 'VEDANTA', origin: 'INDIA', applicant: 'ASIA DEAL HUB PTE. LTD', footer: SUS_COA_FOOTER, signBlock: SUS_COA_SIGN_BLOCK }, SUS_COA_COLUMNS, merged.rows);
  fs.writeFileSync(path.join(OUT, 'ours-coa-6005-lot.html'), `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;margin:0} ${css}</style></head><body>${body}</body></html>`);

  // PACKING LIST workbooks
  for (const [name, lot, theirsFile] of [['6005', L6005, `${L6005[0].dir}/PACKING LIST 6005 8inch 計221.970MT.xlsx`], ['6063', L6063, `${L6063[0].dir}/PACKING LIST 6063.XLS.xlsx`]] as const) {
    const rows = susLotPackingRows(lot.map((p) => ({ blNumber: p.bl, rows: buildSusPackingList(sheet(path.join(p.dir, 'PL.XLS'))).rows })));
    const buf = await susPackingListXlsx(rows);
    fs.writeFileSync(path.join(OUT, `ours-pl-${name}-lot.xlsx`), buf);
    const a = XLSX.read(buf);
    const b = XLSX.readFile(theirsFile);
    lines.push(`PL lot ${name}: ours sheets ${a.SheetNames.join(', ')} | ADH sheets ${b.SheetNames.join(', ')}`);
    a.SheetNames.forEach((sn, si) => {
      const x = XLSX.utils.sheet_to_json<any[]>(a.Sheets[sn], { header: 1, raw: true });
      const y = XLSX.utils.sheet_to_json<any[]>(b.Sheets[b.SheetNames[si]], { header: 1, raw: true });
      let d = 0; const hd: string[] = [];
      for (let i = 0; i < Math.max(x.length, y.length); i++) for (let j = 0; j < 7; j++) {
        const u = x[i]?.[j]; const v = y[i]?.[j];
        const blank = (z: unknown) => z === undefined || z === null || String(z).trim() === '';
        const same = blank(u) && blank(v) ? true : typeof u === 'number' || typeof v === 'number' ? Math.abs(Number(u) - Number(v)) < 0.0005 : String(u ?? '').trim() === String(v ?? '').trim();
        if (!same) { if (i === 0) hd.push(`header col ${j + 1}: ours "${u ?? ''}" | ADH "${v ?? ''}"`); else { d++; if (d <= 5) lines.push(`  ${sn} r${i + 1}c${j + 1}: ours ${u} | ADH ${v}`); } }
      }
      lines.push(`  sheet ${sn} vs ADH ${b.SheetNames[si]}: ${x.length} / ${y.length} rows, ${d} differing data cells${hd.length ? `; ${hd.join('; ')}` : ''}`);
    });
  }
  fs.writeFileSync(path.join(OUT, 'cell-diff.txt'), lines.join('\n') + '\n');
  console.log(lines.join('\n'));
})();
