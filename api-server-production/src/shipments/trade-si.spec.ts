import { Workbook } from 'exceljs';
import { cleanSiFormat, fillSiTemplate, fitCell, productDocLines, siFieldValues, siProductFor, siRemarks, siTemplateMapping, siWeightLines, siXlsx, SiSheetHeader, SI_XLSX_FONT } from './trade-si';
import { renderSiV2Html, SiHeaderV2 } from './trade-logistics-docs';
import { siChanges } from './trade-generated.service';
import { cleanProduct } from './clients-products';

const bad = (m: string): never => {
  throw new Error(m);
};
const HSB = { id: 'p1', grade: '6063', form: 'BILLET' as const, diameterMm: 152, lengthMm: 5800, notes: 'HSB', docNameJa: 'ハイスピード\nビレット', docNameEn: 'High speed\nbillet', docSize: '152×5800' };

describe('Round BF — SI product document name', () => {
  it('JA + EN lines interleaved, then the size; JA only drops the English', () => {
    expect(productDocLines(HSB)).toEqual(['ハイスピード', '(High speed)', 'ビレット', '(billet)', '152×5800']);
    expect(productDocLines(HSB, 'JA')).toEqual(['ハイスピード', 'ビレット', '152×5800']);
    expect(productDocLines({ docNameJa: '', docNameEn: null, docSize: '152×5800' })).toBeNull();
    expect(productDocLines(null)).toBeNull();
  });

  it('finds the customer product by grade ("6063 HSB" → 6063) and size; only one with a document name', () => {
    const plain = { id: 'p0', grade: '6063', form: 'BILLET' as const, diameterMm: 203, lengthMm: 5800 };
    expect(siProductFor([plain, HSB], '6063 HSB', '152MM X 5800MM')?.id).toBe('p1');
    expect(siProductFor([plain, HSB], '6063', '203 MM X 5800 MM')).toBeNull();
    expect(siProductFor([{ ...HSB, hidden: true }], '6063', '152 X 5800')).toBeNull();
    expect(siProductFor([HSB], '6005', '152 X 5800')).toBeNull();
  });

  it('the Products tab keeps the fields; an older caller without them keeps the stored ones', () => {
    const p = cleanProduct({ grade: '6063', docNameJa: ' ハイスピード\nビレット ', docNameEn: 'High speed\nbillet', docSize: '152×5800' }, undefined, 'x', '2026-11-05', bad);
    expect(p).toMatchObject({ docNameJa: 'ハイスピード\nビレット', docNameEn: 'High speed\nbillet', docSize: '152×5800' });
    expect(cleanProduct({ grade: '6063' }, p, 'x', '2026-11-05', bad).docSize).toBe('152×5800');
    expect(cleanProduct({ grade: '6063', docSize: '' }, p, 'x', '2026-11-05', bad).docSize).toBeNull();
  });
});

describe('Round BF — the product cell never breaks a word', () => {
  it('prints the five lines of the example at the normal size', () => {
    const f = fitCell('ハイスピード\n(High speed)\nビレット\n(billet)\n152×5800', 27.5, 9.5, 6.5);
    expect(f.lines).toEqual(['ハイスピード', '(High speed)', 'ビレット', '(billet)', '152×5800']);
    expect(f.pt).toBe(9.5);
  });

  it("today's one-line text: the size goes on its own line, words split at spaces only, font shrinks only as needed", () => {
    const f = fitCell('6063 6インチ ハイスピードビレット152 X 5800', 27.5, 9.5, 6.5);
    expect(f.lines).toEqual(['6063 6インチ', 'ハイスピードビレット', '152 X 5800']);
    expect(f.pt).toBeLessThan(9.5);
    expect(f.pt).toBeGreaterThanOrEqual(6.5);
    for (const l of f.lines) expect('6063 6インチ ハイスピードビレット152 X 5800').toContain(l);
    expect(fitCell('ロングビレット203 X 5800', 27.5, 9.5, 6.5)).toEqual({ lines: ['ロングビレット', '203 X 5800'], pt: 9.5 });
  });

  it('the PDF cell has one nowrap line per part', () => {
    const h: SiHeaderV2 = { layout: 2, requestDate: '2026-11-04', toName: '三井倉庫 株式会社 御中', issuerName: 'ADH', title: '', vessel: 'V', voyageNo: '1', blNumber: '198GX06445', warehouseName: '', grossWeightMt: 41.015, netWeightMt: 40.855, shipper: 'ADH', carrier: '三井倉庫手配便', remarks: '' };
    const html = renderSiV2Html(h, [{ shipDate: '2026-11-05', deliveryDate: '2026-11-05', destination: '加藤軽金属工業株式会社', billet: 'ハイスピード\n(High speed)\nビレット\n(billet)\n152×5800', bundles: 17 }]);
    expect(html).toContain('<div>ハイスピード</div><div>(High speed)</div><div>ビレット</div><div>(billet)</div><div>152×5800</div>');
    expect(html).toContain('.grid .bl div { white-space: nowrap;');
    expect(html).toContain('正味重量');
    expect(renderSiV2Html({ ...h, weightMode: 'GROSS' }, [])).not.toContain('正味重量');
  });
});

describe('Round BF — SI format (Clients › Document formats)', () => {
  it('validates the settings and the mapping', () => {
    expect(cleanSiFormat({ productStyle: 'JA', weightMode: 'GROSS', defaultRemarks: ' 午前着 ', carrier: '', xlsxMapping: { vessel: 'c9', remarks: '' } }, bad)).toEqual({ productStyle: 'JA', weightMode: 'GROSS', defaultRemarks: '午前着', xlsxMapping: { vessel: 'C9' } });
    expect(() => cleanSiFormat({ productStyle: 'EN' }, bad)).toThrow('productStyle');
    expect(() => cleanSiFormat({ xlsxMapping: { nope: 'A1' } }, bad)).toThrow('Unknown field');
    expect(() => cleanSiFormat({ xlsxMapping: { vessel: 'here' } }, bad)).toThrow('is not a cell');
  });

  it('default remarks go under the delivery site lines, without repeating one', () => {
    expect(siRemarks('指定荷卸し場→ X\nA', 'A\n午前着')).toBe('指定荷卸し場→ X\nA\n午前着');
    expect(siRemarks('', '午前着')).toBe('午前着');
    expect(siRemarks('A', undefined)).toBe('A');
  });

  it('weights: net + gross, or gross only', () => {
    expect(siWeightLines({ grossWeightMt: 41.015, netWeightMt: 40.855 })).toEqual(['総重量\n41.015トン', '(正味重量\n40.855トン)']);
    expect(siWeightLines({ grossWeightMt: 41.015, netWeightMt: 40.855, weightMode: 'GROSS' })).toEqual(['総重量\n41.015トン']);
  });
});

const H: SiSheetHeader = {
  requestDate: '2026-11-04',
  toName: '三井倉庫 株式会社',
  issuerName: 'アジアディールハブジャパン合同会社',
  title: '出庫・納入依頼書',
  vessel: 'WAN HAI 366',
  voyageNo: 'E052',
  blNumber: '198GX06445',
  warehouseName: '三井倉庫/名古屋',
  grossWeightMt: 41.015,
  netWeightMt: 40.855,
  shipper: 'アジアディールハブジャパン合同会社',
  carrier: '三井倉庫手配便',
  remarks: '指定荷卸し場→ 加藤軽金属\n午前着',
};
const ROWS = [
  { shipDate: '2026-11-05', deliveryDate: '2026-11-06', destination: '加藤軽金属工業株式会社', billet: 'ハイスピード\n(High speed)\nビレット\n(billet)\n152×5800', bundles: 17 },
  { shipDate: '2026-11-07', deliveryDate: '2026-11-08', destination: '加藤軽金属工業株式会社', billet: 'ハイスピード\n(High speed)\nビレット\n(billet)\n152×5800', bundles: 3 },
];

describe('Round BF — SI .xlsx', () => {
  it("AIMS's sheet: A4, fit to one page, print area, Japanese font, the PDF's fields", async () => {
    const wb = new Workbook();
    await wb.xlsx.load((await siXlsx(H, ROWS)) as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.pageSetup.paperSize).toBe(9);
    expect(ws.pageSetup.fitToPage).toBe(true);
    expect(ws.pageSetup.printArea).toMatch(/^A1:F\d+$/);
    expect(ws.getCell('A3').value).toBe('三井倉庫 株式会社 御中');
    expect(ws.getCell('A3').font?.name).toBe(SI_XLSX_FONT);
    expect(ws.getCell('B9').value).toBe('WAN HAI 366');
    expect(ws.getCell('E10').value).toBe('三井倉庫/名古屋');
    expect(ws.getCell('D12').value).toBe('ビレット');
    expect(ws.getCell('A13').value).toBe('11/5');
    expect(ws.getCell('D13').value).toBe('ハイスピード\n(High speed)\nビレット\n(billet)\n152×5800');
    expect(ws.getCell('E14').value).toBe(3);
    expect(String(ws.getCell('F13').value)).toContain('41.015');
    expect(ws.getCell('F14').isMerged).toBe(true);
  });

  it("ADH's template: placeholders win, then the printed labels; typed cells override; rows fill down", async () => {
    const t = new Workbook();
    const ws = t.addWorksheet('SI');
    ws.getCell('A1').value = '三井倉庫 御中';
    ws.getCell('E2').value = '手配依頼日';
    ws.getCell('A4').value = '本　船';
    ws.mergeCells('B4:C4');
    ws.getCell('D4').value = '海事№';
    ws.getCell('A5').value = 'B/L №';
    ws.getCell('D5').value = '{{warehouseName}}';
    ws.getCell('A7').value = '出荷日';
    ws.getCell('B7').value = '納入日';
    ws.getCell('C7').value = '納入先';
    ws.getCell('D7').value = 'ビレット';
    ws.getCell('E7').value = '束数';
    ws.getCell('A12').value = '運送会社';
    const buf = Buffer.from(await t.xlsx.writeBuffer());
    const { buffer, mapping } = await fillSiTemplate(buf, H, ROWS, { carrier: 'C12' });
    const at = (f: string) => mapping.find((m) => m.field === f);
    expect(at('vessel')).toEqual({ field: 'vessel', cell: 'B4', how: 'label' });
    expect(at('voyageNo')?.cell).toBe('E4');
    expect(at('warehouseName')).toEqual({ field: 'warehouseName', cell: 'D5', how: 'placeholder' });
    expect(at('toName')?.cell).toBe('A1');
    expect(at('carrier')).toEqual({ field: 'carrier', cell: 'C12', how: 'manual' });
    expect(at('rows.billet')?.cell).toBe('D8');
    expect(at('shipper')?.how).toBe('none');
    const out = new Workbook();
    await out.xlsx.load(buffer as unknown as ArrayBuffer);
    const o = out.worksheets[0];
    expect(o.getCell('B4').value).toBe('WAN HAI 366');
    expect(o.getCell('D5').value).toBe('三井倉庫/名古屋');
    expect(o.getCell('A1').value).toBe('三井倉庫 株式会社 御中');
    expect(o.getCell('F2').value).toBe('2026/11/4');
    expect(o.getCell('A8').value).toBe('11/5');
    expect(o.getCell('E9').value).toBe(3);
    expect(o.getCell('C12').value).toBe('三井倉庫手配便');
    expect(siTemplateMapping(o).length).toBeGreaterThan(10);
  });

  it('remarks print with "・" on the first line, as the PDF', () => {
    expect(siFieldValues(H).remarks).toBe('・　指定荷卸し場→ 加藤軽金属\n午前着');
  });
});

describe('Round BF — what an SI edit changed (Activity Log)', () => {
  it('lists the changed header fields and rows, ignoring the edit stamp', () => {
    expect(siChanges({ vessel: 'A', carrier: 'X', editedAt: '1' }, { vessel: 'B', carrier: 'X', editedAt: '2' }, [{ a: 1 }], [{ a: 2 }])).toEqual(['rows', 'vessel']);
    expect(siChanges({ vessel: 'A' }, { vessel: 'A' }, [], undefined)).toEqual([]);
  });
});
