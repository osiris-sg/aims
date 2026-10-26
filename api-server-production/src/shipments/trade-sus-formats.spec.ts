/**
 * Round AM — SUS's own step-4 formats from Vedanta's per-bundle files. The fixture rows copy the shape of ADH's
 * samples (COA_集計ファイル / PACKING LIST.XLS.xlsx: cast order, sums, PIECES = bundles × 5, Sub Total); the full
 * check against ADH's real files is scripts/_am-sus-verify.ts (0 differences on the 305.804 t shipment).
 */
import * as ExcelJS from 'exceljs';
import { buildSusCoaSummary, buildSusPackingList, renderSusCoaHtml, splitBatch, SusFormatError, susPackingListXlsx } from './trade-sus-formats';
import { parseCoaPdfText } from './trade-coa';
import { CUSTOMER_DOC_TEMPLATES, mergeProfiles, templateKeyFor, profileFor } from './trade-profile';

const COA_HEAD = ['Batch', 'Cast No', 'Material', 'Net Wt', 'Gross WT', 'Length', 'Size', 'FE', 'SI', 'TI', 'MN', 'MG', 'ZN', 'PB', 'CU', 'CR', 'AL', 'OTTOT', 'SR', 'ULT', 'ZR'];
const chem6063 = ['0.1400', '0.4600', '0.0150', '0.0250', '0.4920', '0.0043', '0.0011', '0.0004', '0.0012', '98.830', '0.0300', '', '', '0.0080'];
const chemB = ['0.1600', '0.4500', '0.0130', '0.0240', '0.4850', '0.0053', '0.0010', '0.0004', '0.0011', '98.840', '0.0300', '', '', '0.0080'];
const coaRow = (batch: string, net: string, gross: string, chem: string[]) => [batch, batch.slice(0, 8), 'B60630108                ', net, `${gross}   `, '5800      ', '8"        ', ...chem];
const COA = {
  headers: COA_HEAD,
  rows: [coaRow('265C113403', '2.549', '2.559', chemB), coaRow('265C113204', '2.549', '2.559', chem6063), coaRow('265C113201', '2.549', '2.559', chem6063), coaRow('265C113404', '2.548', '2.558', chemB)],
};
const PL = {
  headers: ['Sl. No.', 'Batch', 'Net Wt.', 'Gross Wt.', 'Container ID'],
  rows: [
    ['1', '265C113204', '2.549', '2.559', 'CAAU2532640'],
    ['2', '265C113206', '2.549', '2.559', 'CAAU2532640'],
    ['3', '266C113516', '2.548', '2.558', 'FBIU0410528'],
    ['', '', '7.646', '7.676', 'Sub Total'],
  ],
};

describe('SUS COA_集計ファイル', () => {
  it('sums per cast in cast order, PIECES = bundles × 5, chemistry 4 dp, totals', () => {
    const r = buildSusCoaSummary(COA, { piecesPerBundle: 5 });
    expect(r.rows.map((x) => [x.batch, x.material, x.netwt, x.grosswt, x.bundles, x.pieces, x.length, x.size, x.al, x.zr])).toEqual([
      ['265C1132', 'B60630108', 5.098, 5.118, 2, 10, '5800', '8"', '98.8300', '0.0080'],
      ['265C1134', 'B60630108', 5.097, 5.117, 2, 10, '5800', '8"', '98.8400', '0.0080'],
    ]);
    expect(r.totals).toEqual({ netMt: 10.195, grossMt: 10.235, bundles: 4, pieces: 20 });
    expect(r.columns.map((c) => c.label).slice(0, 8)).toEqual(['Cast No', 'Material', 'Net WT', 'Gross WT', 'Bundle', 'PIECES', 'Length', 'Size']);
    expect(r.columns.map((c) => c.label).slice(-3)).toEqual(['AL', 'OTTOT', 'ZR']);
  });
  it('a COA without ZR (Vedanta COA PDF) leaves it blank and says so; a non-COA is refused', () => {
    const noZr = { headers: COA_HEAD.slice(0, -1), rows: COA.rows.map((r) => r.slice(0, -1)) };
    const r = buildSusCoaSummary(noZr, { piecesPerBundle: 5 });
    expect(r.rows[0].zr).toBeNull();
    expect(r.notes.join(' ')).toContain('ZR');
    expect(() => buildSusCoaSummary({ headers: ['a', 'b'], rows: [['1', '2']] })).toThrow(SusFormatError);
  });
  it('renders the producer block, key lines and the total row', () => {
    const r = buildSusCoaSummary(COA, { piecesPerBundle: 5 });
    const { body } = renderSusCoaHtml({ producerBlock: 'Producer : VEDANTA', date: '2026-07-22', invoiceNo: 'XP2652101334', goodsDescription: 'ALUMINIUM BILLET ALLOY 6063 203 MM X 5800 MM', brand: 'VEDANTA', origin: 'INDIA', applicant: 'ASIA DEAL HUB PTE. LTD' }, r.columns, r.rows);
    expect(body).toContain('22/07/2026');
    expect(body).toContain('XP2652101334');
    expect(body).toContain('10.195');
    expect(body).not.toContain('ELECTRONICALLY SIGNED');
  });
});

describe('SUS PACKING LIST', () => {
  it('adds the cast and the bundle no.; keeps Vedanta’s order; Sub Total checked', () => {
    const r = buildSusPackingList(PL);
    expect(r.rows.map((x) => [x.no, x.batch, x.cast, x.bundleNo, x.netMt, x.grossMt, x.container])).toEqual([
      [1, '265C113204', '265C1132', 4, 2.549, 2.559, 'CAAU2532640'],
      [2, '265C113206', '265C1132', 6, 2.549, 2.559, 'CAAU2532640'],
      [3, '266C113516', '266C1135', 16, 2.548, 2.558, 'FBIU0410528'],
    ]);
    expect(r.notes).toEqual(['3 bundles · net 7.646 t · gross 7.676 t']);
    expect(splitBatch('265C118609')).toEqual({ cast: '265C1186', bundleNo: 9 });
  });
  it('the .xlsx has their layout: header, rows, Sub Total', async () => {
    const buf = await susPackingListXlsx(buildSusPackingList(PL).rows);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.getWorksheet('PL')!;
    expect(ws.getRow(1).values).toEqual([undefined, 'Sl. No.', 'Batch', 'Batch', 'Bundle No', 'Net Wt.', 'Gross Wt.', 'Container ID']);
    expect(ws.getRow(2).values).toEqual([undefined, 1, '265C113204', '265C1132', 4, 2.549, 2.559, 'CAAU2532640']);
    expect([ws.getCell('E5').value, ws.getCell('F5').value, ws.getCell('G5').value]).toEqual([7.646, 7.676, 'Sub Total']);
  });
});

describe('profile: SUS formats and document formats', () => {
  const id = 'a094ff62-47f7-41dc-93da-a17ddf505283';
  const fail = (m: string): never => {
    throw new Error(m);
  };
  it('the SUS templates are selectable and picked by step 4', () => {
    expect(CUSTOMER_DOC_TEMPLATES.CUSTOMER_COA_SUS_SUMMARY.docType).toBe('CUSTOMER_COA');
    const out = mergeProfiles({}, { [id]: { billingMode: 'TWO_STAGE', truckCapacityT: 20, docVariants: { CUSTOMER_COA: 'CUSTOMER_COA_SUS_SUMMARY', CUSTOMER_PL: 'CUSTOMER_PL_SUS_XLS' } } }, fail);
    expect(templateKeyFor(profileFor(out, id), 'CUSTOMER_COA')).toBe('CUSTOMER_COA_SUS_SUMMARY');
    expect(templateKeyFor(profileFor(out, id), 'CUSTOMER_PL')).toBe('CUSTOMER_PL_SUS_XLS');
  });
  it('docFormats: language / 宛先 / notes saved, samples never taken from a patch, delivery-site extras kept', () => {
    const sample = { id: 's1', fileName: 'COA_集計ファイル_Sep120t.pdf', mimeType: 'application/pdf', sizeBytes: 10, s3Key: 'k', uploadedAt: '2026-10-26' };
    const cur = { [id]: { customerId: id, billingMode: 'TWO_STAGE', truckCapacityT: 20, docVariants: {}, sendImportPermit: true, docFormats: { CUSTOMER_COA: { samples: [sample] } } } };
    const out = mergeProfiles(cur, {
      [id]: {
        billingMode: 'TWO_STAGE',
        truckCapacityT: 20,
        docVariants: {},
        deliveryProfile: { siteName: '加藤軽金属工業株式会社', address: '愛知県', notes: '', label: 'Kato (Nagoya)', warehouseCheck: true },
        docFormats: { CUSTOMER_COA: { language: 'en', addressee: 'SUS株式会社 福島製造グループ', samples: [{ ...sample, s3Key: 'evil' }] }, CUSTOMER_PL: { notes: 'xls' } },
      },
    }, fail);
    expect(out[id].docFormats).toEqual({ CUSTOMER_COA: { language: 'en', addressee: 'SUS株式会社 福島製造グループ', samples: [sample] }, CUSTOMER_PL: { notes: 'xls' } });
    expect(out[id].deliveryProfile).toMatchObject({ label: 'Kato (Nagoya)', warehouseCheck: true });
    // A save without docFormats (Org Settings → Customers) keeps them.
    expect(mergeProfiles(out, { [id]: { billingMode: 'TWO_STAGE', truckCapacityT: 20, docVariants: {} } }, fail)[id].docFormats?.CUSTOMER_COA?.samples).toEqual([sample]);
    expect(() => mergeProfiles({}, { [id]: { billingMode: 'TWO_STAGE', truckCapacityT: 20, docVariants: {}, docFormats: { NOPE: {} } } }, fail)).toThrow(/Unknown document format/);
  });
});

describe('Vedanta COA PDF date', () => {
  it('reads the header date printed before its label (per-bundle COA PDF) as well as after it (summary)', () => {
    const head = 'Batch No Cast No. Material Net Wt. Gross Wt. Length Size Fe Si Mg\n265C113204 265C1132 B60630108 2.549 2.559 5800 8" 0.14 0.46 0.49';
    expect(parseCoaPdfText(`22/07/2026DATE :\n${head.replace('Batch No ', 'Batch No ')}`.replace('Cast No.', 'Cast No')).date).toBe('2026-07-22');
    expect(parseCoaPdfText(`Date ： 04/08/2026\nCast No Material Net WT FE SI MG\n265C1184 B60050108 33.169 0.18 0.66 0.48`).date).toBe('2026-08-04');
  });
});

