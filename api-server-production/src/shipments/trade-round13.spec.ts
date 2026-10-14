/**
 * Round 13 (2026-10): blank in-app documents can't be finalized, QMJP by
 * quarter, Replace keeps the document ID, no DRAFT watermark, and bulk upload
 * with AI sorting (file-name / spreadsheet rules + the combined verdict; the
 * live AI run over ADH's real 198GX04630 set is behind CLASSIFY_LIVE=1 and
 * reads ~/Desktop/ADH_Docs, never committed).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mergeDocDefaults, TradeConfigService } from './trade-config.service';
import { classifyByName, classifySheetText, combineClassification, LOW_CONFIDENCE } from './trade-classify';
import { docShell } from './trade-doc-shell';
import { sheetText } from './trade-extract.service';
import { blankDocProblems, pricePartsOf } from './trade-generated.service';
import { DocDefaults, invoice1Line, qmjpForMonth, quarterKey } from './trade-invoice';
import { TradeFilesService } from './trade-files.service';

const ORG = 'org-1';

// ── blank documents ─────────────────────────────────────────────────────────
describe('Finalize is refused on blank in-app documents', () => {
  it('Customer COA with no rows / 0 bundles (the prod run finalized one like that)', () => {
    expect(blankDocProblems('CUSTOMER_COA', { bundles: 0 }, [{ batch: '', netwt: null, bundles: null }])).toEqual([
      'add the analysis rows (cast / batch and its chemistry)',
      'the bundle count (バンドル数) is 0',
    ]);
    // Blank header bundles = the rows' total.
    expect(blankDocProblems('CUSTOMER_COA', { bundles: null }, [{ batch: '265C1132', fe: '0.14', bundles: 15, netwt: 38.2 }])).toEqual([]);
    expect(blankDocProblems('CUSTOMER_COA', { bundles: 120 }, [{ batch: '265C1132', fe: '0.14' }])).toEqual([]);
  });
  it('Customer PL with no packing rows or a 0 total', () => {
    expect(blankDocProblems('CUSTOMER_PL', {}, [{ no: 1, batch: '', container: '', netMt: null, grossMt: null }])).toEqual(['add the packing rows (batch, container, net weight)']);
    expect(blankDocProblems('CUSTOMER_PL', {}, [{ no: 1, batch: 'B1', container: 'C1', netMt: 0 }])).toEqual(['the total net weight is 0']);
    expect(blankDocProblems('CUSTOMER_PL', {}, [{ no: 1, batch: 'B1', container: 'C1', netMt: 2.549, grossMt: 2.559 }])).toEqual([]);
  });
  it('Shipping instructions with no delivery rows', () => {
    expect(blankDocProblems('SHIPPING_INSTRUCTIONS', {}, [{ destination: 'SUS福島工場', billet: 'ロングビレット' }])).toEqual(['add at least one delivery row (出荷日 · 納入日 · 束数)']);
    expect(blankDocProblems('SHIPPING_INSTRUCTIONS', {}, [{ shipDate: '2026-09-07', deliveryDate: '2026-09-08', bundles: 16 }])).toEqual([]);
  });
  it('other documents are not checked here (invoices have their own US$0 block)', () => {
    expect(blankDocProblems('INVOICE_2', {}, [])).toEqual([]);
    expect(blankDocProblems('SGJP_IV_PL', {}, [])).toEqual([]);
  });
});

// ── QMJP by quarter ─────────────────────────────────────────────────────────
describe('QMJP by quarter', () => {
  const defaults: DocDefaults = { qmjpByQuarter: { '2026-2Q': 351.5, '2026-3Q': 395 } };
  it('month → quarter key → QMJP; a quarter not in the table is null', () => {
    expect(quarterKey('2026-06')).toBe('2026-2Q');
    expect(quarterKey('2026-07')).toBe('2026-3Q');
    expect(quarterKey('')).toBe('');
    expect(qmjpForMonth(defaults, '2026-06')).toBe(351.5);
    expect(qmjpForMonth(defaults, '2026-09')).toBe(395);
    expect(qmjpForMonth(defaults, '2026-10')).toBeNull();
    expect(qmjpForMonth({}, '2026-07')).toBeNull();
  });
  it("Invoice #1 takes its LME month's quarter (June → 2Q 351.5), else the contract line", () => {
    const line = { id: 'l1', grade: '6063', product: 'Aluminium Billet', sizeSpec: '203 MM X 5800 MM', quantityMt: '300', tolerancePct: '5', qmjp: '999', billetPremium: '230', upcharge: '0' };
    expect(invoice1Line({ id: 'c1', contractNo: '454003422' }, line as any, defaults, '2026-07-22', '2026-06').qmjp).toBe(351.5);
    expect(invoice1Line({ id: 'c1', contractNo: '454003422' }, line as any, defaults, '2026-07-22', '2027-01').qmjp).toBe(999);
  });
  it("SG→JP / Invoice #2: the shipment month's quarter wins over Invoice #1's (3Q 395, not 2Q 351.5)", () => {
    const inv1 = { qmjp: 351.5, premium: 230, upcharge: 0 };
    expect(pricePartsOf(inv1, null, qmjpForMonth(defaults, '2026-07'))).toEqual({ qmjp: 395, premium: 230, upcharge: 0 });
    expect(pricePartsOf(inv1, null, qmjpForMonth(defaults, '2027-01'))).toEqual({ qmjp: 351.5, premium: 230, upcharge: 0 }); // not in the table
  });
  it('the settings key is validated: quarters like 2026-3Q, numbers only', () => {
    expect(mergeDocDefaults({}, { qmjpByQuarter: { '2026-2Q': 351.5, '2026-3Q': 395 } })).toEqual({ qmjpByQuarter: { '2026-2Q': 351.5, '2026-3Q': 395 } });
    expect(() => mergeDocDefaults({}, { qmjpByQuarter: { 'Q3 2026': 395 } })).toThrow(/2026-3Q/);
    expect(() => mergeDocDefaults({}, { qmjpByQuarter: { '2026-3Q': '395' } })).toThrow(/number/);
    expect(() => mergeDocDefaults({}, { qmjpByQuarter: [395] })).toThrow(/quarters/);
  });
});

// ── Replace keeps the document ID ───────────────────────────────────────────
describe('Replace keeps the document ID', () => {
  const setup = () => {
    const created: any[] = [];
    const prisma: any = {
      tradeFile: {
        findFirst: jest.fn(async ({ where }: any) => (where.id === 'old-bl' && where.docType === 'BL' ? { docRef: '454003422-1-BL' } : null)),
        create: jest.fn(async ({ data }: any) => created.push(data)),
      },
      tradeFileLink: { createMany: jest.fn() },
    };
    prisma.$transaction = (fn: any) => fn(prisma);
    const config: any = {
      assertActiveDocType: jest.fn(),
      docRefFor: jest.fn(async () => '454003422-1-BL-2'),
      syncSteps: jest.fn(async () => []),
      docTypeLabels: jest.fn(async () => ({})),
    };
    const s3: any = { uploadFile: jest.fn(), deleteFile: jest.fn() };
    const svc = new TradeFilesService(prisma, s3, config, { make: jest.fn() } as any);
    jest.spyOn(svc as any, 'resolveTargets').mockResolvedValue({ contracts: [], shipments: [{ id: 'sh1' }], step: { id: 'st3', shipmentId: 'sh1', contractId: null } });
    jest.spyOn(svc as any, 'linkRows').mockReturnValue([]);
    jest.spyOn(svc, 'getById').mockResolvedValue({ id: 'new' } as any);
    const file = { originalname: '198GX04630 SCAN.pdf', mimetype: 'application/pdf', size: 10, buffer: Buffer.from('%PDF') } as Express.Multer.File;
    return { svc, created, config, file };
  };
  it('a replacement takes the replaced file\'s ID (…-BL stays …-BL)', async () => {
    const { svc, created, config, file } = setup();
    await svc.upload(ORG, file, { docType: 'BL', stepId: 'st3', replacesFileId: 'old-bl' } as any, { id: 'u1', name: 'U' });
    expect(created[0].docRef).toBe('454003422-1-BL');
    expect(config.docRefFor).not.toHaveBeenCalled();
  });
  it('a genuinely additional file gets the next counter; a "replaced" file of another type does not lend its ID', async () => {
    const { svc, created, file } = setup();
    await svc.upload(ORG, file, { docType: 'BL', stepId: 'st3' } as any, { id: 'u1', name: 'U' });
    expect(created[0].docRef).toBe('454003422-1-BL-2');
    const s2 = setup();
    await s2.svc.upload(ORG, s2.file, { docType: 'CI', stepId: 'st3', replacesFileId: 'old-bl' } as any, { id: 'u1', name: 'U' });
    expect(s2.created[0].docRef).toBe('454003422-1-BL-2');
  });
});

// ── no watermark ────────────────────────────────────────────────────────────
describe('No DRAFT watermark on any generated document', () => {
  it('drafts and finals render the same page', () => {
    const draft = docShell({ title: 'T', css: '', body: '<p>x</p>', draft: true });
    expect(draft).not.toContain('class="wm"');
    expect(draft).not.toMatch(/>DRAFT</);
    expect(draft).toBe(docShell({ title: 'T', css: '', body: '<p>x</p>', draft: false }));
  });
});

// ── bulk upload with AI sorting ─────────────────────────────────────────────
const STEP3 = ['BL', 'CI', 'PL', 'COA', 'COO', 'INSURANCE', 'OTHER'];
const SET_198GX04630: Array<[string, string, string | null, boolean]> = [
  ['198GX04630 SCAN.pdf', 'BL', null, true],
  ['COMMERCIAL_INVOICE_9000565680.pdf', 'CI', null, true],
  ['PACKING_LIST_9000565680.pdf', 'PL', null, true],
  ['PACKING_LIST_CONTAINER_9000565680.pdf', 'PL', 'container PL', false],
  ['COA_9000565680.pdf', 'COA', null, true],
  ['COO_9000565680.pdf', 'COO', null, true],
  ['INSURANCE.pdf', 'INSURANCE', null, true],
  ['PL.XLS', 'PL', 'PL spreadsheet', false],
  ['COA.XLS', 'COA', 'COA summary', false],
];

describe('Bulk upload — file-name and spreadsheet rules', () => {
  it.each(SET_198GX04630)('%s → %s', (name, docType, variant, primary) => {
    expect(classifyByName(name)).toEqual({ docType, variant, primary });
  });
  it('more names: B/L draft, arrival notice, COA summary PDF, unknown', () => {
    expect(classifyByName('198GX04630.pdf')?.docType).toBe('BL');
    expect(classifyByName('BL draft 198GX04630.pdf')?.docType).toBe('BL_DRAFT');
    expect(classifyByName('[Merged] 202607-09 6005 120t WDMFT505_AN_JPYOK01_YSA9.pdf')?.docType).toBe('ARRIVAL_NOTICE');
    expect(classifyByName('COA_集計ファイル_Sep120t.pdf')).toEqual({ docType: 'COA', variant: 'COA summary', primary: false });
    expect(classifyByName('scan0001.pdf')).toBeNull();
  });
  it("spreadsheet headers: Vedanta's COA.XLS (cast + chemistry) and PL.XLS (container + weights)", () => {
    expect(classifySheetText('Batch\tCast No\tMaterial\tNet Wt\tGross WT\tLength\tSize\tFE\tSI\tTI\tMN\tMG')).toEqual({ docType: 'COA', variant: 'COA summary', primary: false });
    expect(classifySheetText('Sl. No.\tBatch\tNet Wt.\tGross Wt.\tContainer ID')).toEqual({ docType: 'PL', variant: 'PL spreadsheet', primary: false });
    expect(classifySheetText('Name\tAmount')).toBeNull();
    expect(sheetText(Buffer.from('Sl. No.\tBatch\tNet Wt.\r\n1\tB1\t2.5'))).toContain('Net Wt.');
  });
});

describe('Bulk upload — combining name, sheet and AI', () => {
  it('AI and file name agree → high confidence, the name keeps the variant', () => {
    const r = combineClassification(STEP3, classifyByName('PACKING_LIST_CONTAINER_9000565680.pdf'), null, { docType: 'PL', variant: 'container PL', confidence: 0.8, reason: 'Per-container packing list' });
    expect(r).toMatchObject({ docType: 'PL', variant: 'container PL', primary: false, source: 'name+ai' });
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });
  it('a scan with an unhelpful name is decided by the AI', () => {
    expect(combineClassification(STEP3, null, null, { docType: 'BL', confidence: 0.92, reason: 'Bill of lading' })).toMatchObject({ docType: 'BL', primary: true, confidence: 0.92, source: 'ai' });
  });
  it('AI disagreeing with the name is flagged (low confidence)', () => {
    const r = combineClassification(STEP3, classifyByName('COO_9000565680.pdf'), null, { docType: 'CI', confidence: 0.9 });
    expect(r.docType).toBe('CI');
    expect(r.confidence).toBeLessThan(LOW_CONFIDENCE);
  });
  it('a spreadsheet is decided by its columns; no AI needed', () => {
    expect(combineClassification(STEP3, classifyByName('PL.XLS'), classifySheetText('Sl. No.\tBatch\tNet Wt.\tGross Wt.\tContainer ID'), null)).toMatchObject({ docType: 'PL', variant: 'PL spreadsheet', confidence: 0.95, source: 'sheet' });
  });
  it('AI down → the file name at 75 %; nothing → Other, flagged; a type the step does not take → Other', () => {
    expect(combineClassification(STEP3, classifyByName('INSURANCE.pdf'), null, null)).toMatchObject({ docType: 'INSURANCE', confidence: 0.75, source: 'name' });
    const none = combineClassification(STEP3, null, null, null);
    expect(none).toMatchObject({ docType: 'OTHER', source: 'none' });
    expect(none.confidence).toBeLessThan(LOW_CONFIDENCE);
    expect(combineClassification(STEP3, classifyByName('import permit.pdf'), null, null)).toMatchObject({ docType: 'OTHER' });
    expect(combineClassification(STEP3, null, null, { docType: 'IMPORT_PERMIT', confidence: 0.9 }).docType).toBe('OTHER'); // not one of the step's types
  });

  // ADH's real 198GX04630 set, read by Claude (CLASSIFY_LIVE=1; files stay on this machine).
  const dir = path.join(os.homedir(), 'Desktop/ADH_Docs');
  const have = fs.existsSync(dir) && SET_198GX04630.every(([n]) => fs.readdirSync(dir).some((f) => f.normalize('NFC') === n));
  (process.env.CLASSIFY_LIVE === '1' && have ? it : it.skip)(
    'sorts all 9 documents of the real 198GX04630 set correctly (live AI)',
    async () => {
      const { TradeExtractService } = await import('./trade-extract.service');
      const { DocumentExtractionService } = await import('../document-extraction/document-extraction.service');
      const svc = new TradeExtractService({} as any, {} as any, {} as any, new (DocumentExtractionService as any)());
      const results = await Promise.all(
        SET_198GX04630.map(async ([name]) => {
          const real = fs.readdirSync(dir).find((f) => f.normalize('NFC') === name)!;
          const buffer = fs.readFileSync(path.join(dir, real));
          const mimetype = /\.pdf$/i.test(name) ? 'application/pdf' : 'application/vnd.ms-excel';
          return svc.classify(ORG, { originalname: name, mimetype, size: buffer.length, buffer } as Express.Multer.File, STEP3);
        }),
      );
      for (const [i, [name, docType, variant]] of SET_198GX04630.entries()) {
        expect({ name, docType: results[i].docType, variant: results[i].variant }).toEqual({ name, docType, variant });
        expect(results[i].confidence).toBeGreaterThanOrEqual(LOW_CONFIDENCE);
      }
    },
    240_000,
  );
});

// Keep TradeConfigService imported for the type-level check of the settings validator.
void TradeConfigService;
