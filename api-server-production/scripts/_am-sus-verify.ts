/** Round AM — read-only: Vedanta COA.XLS / PL.XLS → the SUS formats, compared with ADH's own SUS files. Args: --coa= --pl= --sample-pl= --sample-coa-pdf= */
import { readFileSync } from 'fs';
import { parseSheetFile } from '../src/shipments/trade-sheet.parser';
import { buildSusCoaSummary, buildSusPackingList } from '../src/shipments/trade-sus-formats';
import { parseCoaPdfText, pdfText } from '../src/shipments/trade-coa';
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
(async () => {
  const coaPath = arg('coa')!;
  const coa = buildSusCoaSummary(/\.pdf$/i.test(coaPath) ? parseCoaPdfText(await pdfText(readFileSync(coaPath))) : parseSheetFile(readFileSync(coaPath)), { piecesPerBundle: 5 });
  const pl = buildSusPackingList(parseSheetFile(readFileSync(arg('pl')!)));
  // Sample COA summary: its table rows as text.
  const text = await pdfText(readFileSync(arg('sample-coa-pdf')!));
  const sample = parseCoaPdfText(text);
  const els = ['FE', 'SI', 'TI', 'MN', 'MG', 'ZN', 'PB', 'CU', 'CR', 'AL', 'OTTOT', 'ZR'];
  let diffs = 0;
  const h = sample.headers;
  const idx = (n: string) => h.findIndex((x) => x.toLowerCase().replace(/[^a-z]/g, '') === n.toLowerCase().replace(/[^a-z]/g, ''));
  console.log(`COA: ours ${coa.rows.length} casts, sample ${sample.rows.length}`);
  sample.rows.forEach((sr, i) => {
    const r = coa.rows[i];
    const pairs: Array<[string, unknown, unknown]> = [
      ['cast', r?.batch, sr[idx('Cast No')]], ['material', r?.material, sr[idx('Material')]], ['net', Number(r?.netwt), Number(sr[idx('Net Wt')])], ['gross', Number(r?.grosswt), Number(sr[idx('Gross Wt')])],
      ['bundles', Number(r?.bundles), Number(sr[idx('Bundle')])], ['pieces', Number(r?.pieces), Number(sr[idx('PIECES')])], ['length', r?.length, sr[idx('Length')]], ['size', r?.size, sr[idx('Size')]],
      ...els.map((e): [string, unknown, unknown] => [e, Number(r?.[e.toLowerCase()]).toFixed(4), Number(sr[idx(e)]).toFixed(4)]),
    ];
    for (const [k, a, b] of pairs) if (String(a) !== String(b)) { diffs++; console.log(`  row ${i + 1} ${k}: ours ${a} sample ${b}`); }
  });
  console.log(`COA totals ours: ${JSON.stringify(coa.totals)}; differences: ${diffs}`);
  // Sample PL: compare every cell.
  const X = require('xlsx');
  const ws = X.readFile(arg('sample-pl')!).Sheets['PL'] ?? Object.values(X.readFile(arg('sample-pl')!).Sheets)[0];
  const srows: any[][] = X.utils.sheet_to_json(ws, { header: 1, raw: true }).slice(1);
  let pd = 0;
  const body = srows.filter((r) => typeof r[0] === 'number');
  console.log(`PL: ours ${pl.rows.length} bundles, sample ${body.length}; sample subtotal ${JSON.stringify(srows[srows.length - 1].slice(4, 7))}; ours ${JSON.stringify(pl.totals)}`);
  body.forEach((sr, i) => {
    const r = pl.rows[i];
    const ours = [r?.no, r?.batch, r?.cast, r?.bundleNo, r?.netMt, r?.grossMt, r?.container];
    ours.forEach((v, j) => { if (String(v) !== String(sr[j])) { pd++; if (pd < 10) console.log(`  PL row ${i + 1} col ${j + 1}: ours ${v} sample ${sr[j]}`); } });
  });
  console.log(`PL cell differences: ${pd}`);
  console.log('notes:', [...coa.notes, ...pl.notes].join(' | '));
})();
