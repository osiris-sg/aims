import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { documentLinkState } from './shipments.rules';
import { renderGeneratedHtml } from './trade-generated.html';
import { buildDefaultHeader, TradeGeneratedService } from './trade-generated.service';
import { buildCustomerCoa, buildCustomerPl, parseDelimitedSheet, parseSheetFile, plTotals, SHEET_MAX_ROWS } from './trade-sheet.parser';

/**
 * Synthetic fixtures in Vedanta's exact ".XLS" export format (tab-delimited
 * text, CRLF, space-padded cells, trailing tab, blank columns, "Sub Total"
 * footer). No customer data — the real files are only used locally.
 */
const PL = [
  'Sl. No.\tBatch\tNet Wt.\tGross Wt.\tContainer ID',
  '   1 \tAAA1001\t         2.549 \t         2.559 \tCONT0000001',
  '   2 \tAAA1002\t         2.548 \t         2.558 \tCONT0000001',
  '   3 \tAAA1003\t         2.550 \t         2.560 \tCONT0000002',
  '     \t          \t         7.647 \t         7.677 \tSub Total',
  '',
].join('\r\n');

const COA = [
  'Batch\tCast No\tMaterial\tNet Wt\tGross WT\tLength\tSize\tFE\tSI\tSR\tULT\tCD\t',
  'AAA1001\tAAA10\tB60630108         \t2.549\t2.559     \t5800      \t8"        \t0.1500    \t0.4600    \t          \t     \t          \t',
  'AAA1002\tAAA10\tB60630108         \t2.548\t2.558     \t5800      \t8"        \t0.1400    \t0.4700    \t          \t     \t          \t',
  '',
].join('\r\n');

describe('parseDelimitedSheet', () => {
  it('reads tab-delimited CRLF text, trims padding, drops the trailing empty column', () => {
    const s = parseDelimitedSheet(Buffer.from(COA));
    expect(s.headers).toEqual(['Batch', 'Cast No', 'Material', 'Net Wt', 'Gross WT', 'Length', 'Size', 'FE', 'SI', 'SR', 'ULT', 'CD']);
    expect(s.rows).toHaveLength(2);
    expect(s.rows[0][2]).toBe('B60630108');
    expect(s.rows[0][6]).toBe('8"');
  });
  it('also reads CSV with quotes and LF endings', () => {
    const s = parseDelimitedSheet('Batch,"Net Wt.","Gross Wt."\n"A,1",2.5,2.6\n');
    expect(s.headers).toEqual(['Batch', 'Net Wt.', 'Gross Wt.']);
    expect(s.rows).toEqual([['A,1', '2.5', '2.6']]);
  });
});

/**
 * The same synthetic packing list / COA as real Excel workbooks, built here
 * with SheetJS (numbers as numbers, chemistry with a 0.0000 display format,
 * a title block above the header, an extra blank column and an oddly-cased
 * header) — no customer data, nothing committed but this code.
 */
const n = (v: number, z?: string) => ({ t: 'n', v, ...(z ? { z } : {}) });
const PL_AOA = [
  ['SUPPLIER PACKING LIST'],
  ['Invoice: TEST-1'],
  [],
  ['SL. NO.', ' batch ', '', 'NET WT', 'gross  wt.', 'Container ID'],
  [n(1), 'AAA1001', '', n(2.549, '0.000'), n(2.559, '0.000'), 'CONT0000001'],
  [n(2), 'AAA1002', '', n(2.548, '0.000'), n(2.558, '0.000'), 'CONT0000001'],
  [n(3), 'AAA1003', '', n(2.55, '0.000'), n(2.56, '0.000'), 'CONT0000002'],
  ['', '', '', n(7.647, '0.000'), n(7.677, '0.000'), 'Sub Total'],
];
const COA_AOA = [
  ['Batch', 'Cast No', 'Material', 'Net Wt', 'Gross WT', 'Length', 'Size', 'FE', 'SI', 'SR', 'ULT', 'CD'],
  ['AAA1001', 'AAA10', 'B60630108', n(2.549), n(2.559), n(5800), '8"', n(0.15, '0.0000'), n(0.46, '0.0000'), '', '', ''],
  ['AAA1002', 'AAA10', 'B60630108', n(2.548), n(2.558), n(5800), '8"', n(0.14, '0.0000'), n(0.47, '0.0000'), '', '', ''],
];
function workbook(aoa: unknown[][], bookType: 'xlsx' | 'biff8', extraSheet = false): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa as any), 'Sheet1');
  if (extraSheet) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['notes']]), 'Notes');
  return XLSX.write(wb, { type: 'buffer', bookType });
}

describe('parseSheetFile (format detection by signature)', () => {
  const xlsxPl = workbook(PL_AOA, 'xlsx');
  const xlsPl = workbook(PL_AOA, 'biff8');
  it('sniffs ZIP → xlsx, OLE2 → xls, tabs → tsv, else csv — regardless of extension', () => {
    expect(xlsxPl.subarray(0, 2).toString()).toBe('PK');
    expect(parseSheetFile(xlsxPl).format).toBe('xlsx');
    expect(parseSheetFile(xlsPl).format).toBe('xls');
    expect(parseSheetFile(Buffer.from(PL)).format).toBe('tsv');
    expect(parseSheetFile(Buffer.from('Batch,Net Wt.,Gross Wt.\nA,1,2\n')).format).toBe('csv');
  });

  it('PL: tab-delimited text, .xlsx and .xls give identical rows and totals', () => {
    const text = buildCustomerPl(parseSheetFile(Buffer.from(PL)));
    for (const buf of [xlsxPl, xlsPl]) {
      const pl = buildCustomerPl(parseSheetFile(buf));
      expect(pl.rows).toEqual(text.rows);
      expect(pl.sourceTotals).toEqual(text.sourceTotals);
      expect(plTotals(pl.rows)).toEqual({ bundles: 3, netMt: 7.647, grossMt: 7.677 });
      expect(pl.notes).toEqual([]);
    }
  });

  it('COA: tab-delimited text, .xlsx and .xls give identical rows, columns and hidden set', () => {
    const text = buildCustomerCoa(parseSheetFile(Buffer.from(COA)));
    for (const bookType of ['xlsx', 'biff8'] as const) {
      const coa = buildCustomerCoa(parseSheetFile(workbook(COA_AOA, bookType)));
      expect(coa.rows).toEqual(text.rows);
      expect(coa.columns).toEqual(text.columns);
    }
    expect(text.rows[0]).toMatchObject({ fe: '0.1500', length: '5800' }); // supplier precision kept
  });

  it('keeps full weight precision when the Excel display format rounds it', () => {
    const aoa = [
      ['Batch', 'Net Wt', 'Gross Wt'],
      ['A1', n(2.549, '0.00'), n(2.559, '0.00')],
    ];
    expect(buildCustomerPl(parseSheetFile(workbook(aoa, 'xlsx'))).rows[0]).toMatchObject({ netMt: 2.549, grossMt: 2.559 });
  });

  it('reads the first sheet and says so when the workbook has several', () => {
    const s = parseSheetFile(workbook(PL_AOA, 'xlsx', true));
    expect(s.sheetName).toBe('Sheet1');
    expect(s.notes[0]).toMatch(/Read sheet "Sheet1".*2 sheets: Sheet1, Notes/);
  });

  it('finds a header that is not on row 1, case/space-insensitively, and refuses when it is beyond the scan window', () => {
    const csv = 'My Supplier\nPacking list\n\nbatch,  NET wt , Gross Weight,Remarks\nA1,1.000,1.010,x\n';
    expect(buildCustomerPl(parseSheetFile(Buffer.from(csv))).rows).toEqual([{ no: 1, batch: 'A1', container: null, netMt: 1, grossMt: 1.01 }]);
    const deep = Array.from({ length: 12 }, (_, i) => `title ${i}`).join('\n') + '\nBatch,Net Wt,Gross Wt\nA1,1,1\n';
    expect(() => buildCustomerPl(parseSheetFile(Buffer.from(deep)))).toThrow(/no header row with Batch, Net Wt., Gross Wt. in the first 10 rows/);
  });

  it(`caps the sheet at ${SHEET_MAX_ROWS} data rows`, () => {
    const big = ['Batch\tNet Wt\tGross Wt', ...Array.from({ length: SHEET_MAX_ROWS + 20 }, (_, i) => `B${i}\t1\t1`)].join('\r\n');
    expect(() => parseSheetFile(Buffer.from(big))).toThrow(/more than 5,000 rows/);
    const aoa = [['Batch', 'Net Wt', 'Gross Wt'], ...Array.from({ length: SHEET_MAX_ROWS + 20 }, (_, i) => [`B${i}`, 1, 1])];
    expect(() => parseSheetFile(workbook(aoa, 'xlsx'))).toThrow(/more than 5,000 rows/);
  });

  it('gives clear errors for damaged, password-protected and non-spreadsheet files', () => {
    expect(() => parseSheetFile(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 7)]))).toThrow(/\.xlsx file could not be read/);
    expect(() => parseSheetFile(Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(600, 0)]))).toThrow(/\.xls file could not be read/);
    // A Word .doc is OLE2 too, but has no workbook.
    const CFB = (XLSX as any).CFB;
    const doc = CFB.utils.cfb_new();
    CFB.utils.cfb_add(doc, '/WordDocument', Buffer.alloc(1024, 3));
    expect(() => parseSheetFile(Buffer.from(CFB.write(doc, { type: 'buffer' })))).toThrow(/\.xls file could not be read/);
    // Excel "Encrypt with password" = OLE2 wrapper with EncryptionInfo + EncryptedPackage.
    const enc = CFB.utils.cfb_new();
    CFB.utils.cfb_add(enc, '/EncryptionInfo', Buffer.from([4, 0, 4, 0, 0x40, 0, 0, 0]));
    CFB.utils.cfb_add(enc, '/EncryptedPackage', Buffer.alloc(1024, 3));
    expect(() => parseSheetFile(Buffer.from(CFB.write(enc, { type: 'buffer' })))).toThrow(/password-protected — remove the password/);
    expect(() => parseSheetFile(Buffer.from([0x25, 0x50, 0x44, 0x46, 0, 0, 1, 2]))).toThrow(/could not be read as a spreadsheet/);
    expect(() => parseSheetFile(Buffer.alloc(25 * 1024 * 1024 + 1, 0x41))).toThrow(/larger than 25 MB/);
  });
});

describe('buildCustomerPl', () => {
  const pl = buildCustomerPl(parseDelimitedSheet(Buffer.from(PL)));
  it('maps rows and skips the Sub Total footer', () => {
    expect(pl.rows).toEqual([
      { no: 1, batch: 'AAA1001', container: 'CONT0000001', netMt: 2.549, grossMt: 2.559 },
      { no: 2, batch: 'AAA1002', container: 'CONT0000001', netMt: 2.548, grossMt: 2.558 },
      { no: 3, batch: 'AAA1003', container: 'CONT0000002', netMt: 2.55, grossMt: 2.56 },
    ]);
    expect(pl.sourceTotals).toEqual({ netMt: 7.647, grossMt: 7.677 });
    expect(pl.notes).toEqual([]);
  });
  it('totals bundles and 3-decimal MT, and flags a subtotal mismatch', () => {
    expect(plTotals(pl.rows)).toEqual({ bundles: 3, netMt: 7.647, grossMt: 7.677 });
    const off = buildCustomerPl(parseDelimitedSheet(Buffer.from(PL.replace('7.647', '7.700'))));
    expect(off.notes[0]).toMatch(/Net total 7.647 differs from the file's subtotal 7.7/);
  });
  it('refuses a file without the packing-list columns', () => {
    expect(() => buildCustomerPl(parseDelimitedSheet('Foo\tBar\r\n1\t2\r\n'))).toThrow(/Not a packing list: no header row with Batch, Net Wt., Gross Wt./);
  });
});

describe('buildCustomerCoa', () => {
  const coa = buildCustomerCoa(parseDelimitedSheet(Buffer.from(COA)));
  it('keeps every column, weights as MT numbers, chemistry as text', () => {
    expect(coa.rows[0]).toMatchObject({ batch: 'AAA1001', castno: 'AAA10', netwt: 2.549, grosswt: 2.559, fe: '0.1500', size: '8"' });
  });
  it('hides columns that are empty in every row', () => {
    expect(coa.columns.filter((c) => !c.visible).map((c) => c.label)).toEqual(['SR', 'ULT', 'CD']);
    expect(coa.notes[0]).toMatch(/SR, ULT, CD/);
  });
});

describe('documentLinkState (confirmed-only invoice rule)', () => {
  it('counts only confirmed (or later) documents', () => {
    expect(documentLinkState(null)).toEqual({ state: 'deleted', satisfies: false });
    expect(documentLinkState({ status: 'draft', config: {} }).satisfies).toBe(false);
    expect(documentLinkState({ status: 'unconfirmed', config: {} })).toEqual({ state: 'draft', satisfies: false });
    expect(documentLinkState({ status: 'confirmed', config: { voided: true } })).toEqual({ state: 'voided', satisfies: false });
    expect(documentLinkState({ status: 'confirmed', config: {} })).toEqual({ state: 'confirmed', satisfies: true });
    expect(documentLinkState({ status: 'paid', config: {} }).satisfies).toBe(true);
  });
});

describe('buildDefaultHeader — pieces', () => {
  const ship = {
    blNumber: 'BL123',
    vessel: null,
    voyageNo: null,
    portOfLoading: null,
    portOfDischarge: null,
    commodity: null,
    sizeSpec: '8"',
    hsCode: null,
    countryOfOrigin: null,
    ciNumber: null,
    customer: { name: 'SUS Co., Ltd.', address: null },
    contract: { contractNo: 'C-1', piNumber: null },
    contractLine: { grade: '6063', product: 'Aluminium Billet', sizeSpec: '152MM' },
  };
  it("takes grade / size from the shipment's product line (shipment size wins when set)", () => {
    const coa = buildDefaultHeader(null, { ...ship, sizeSpec: null, totalPieces: null } as any, 'CERTIFICATE OF ANALYSIS', 'CUSTOMER_COA', '2026-10-14');
    expect(coa.spec).toBe('Grade 6063 · Size 152MM');
    expect(coa.refs.find((r) => r.key === 'commodity')?.value).toBe('Aluminium Billet 6063');
    expect(buildDefaultHeader(null, { ...ship, totalPieces: null } as any, 'CERTIFICATE OF ANALYSIS', 'CUSTOMER_COA', '2026-10-14').spec).toBe('Grade 6063 · Size 8"');
  });
  it("uses the shipment's Total pieces as entered — not bundles × size or a row count", () => {
    const h = buildDefaultHeader(null, { ...ship, totalPieces: 600 } as any, 'PACKING LIST', 'CUSTOMER_PL', '2026-10-14');
    expect(h.pieces).toBe(600);
  });
  it('leaves pieces blank when the shipment has none (nothing is computed)', () => {
    expect(buildDefaultHeader(null, { ...ship, totalPieces: null } as any, 'PACKING LIST', 'CUSTOMER_PL', '2026-10-14').pieces).toBeNull();
  });
  it('prints the edited pieces, independent of the 3 bundles in the rows', () => {
    const pl = buildCustomerPl(parseDelimitedSheet(Buffer.from(PL)));
    const header = { ...buildDefaultHeader(null, { ...ship, totalPieces: 600 } as any, 'PACKING LIST', 'CUSTOMER_PL', '2026-10-14'), pieces: 598 };
    const html = renderGeneratedHtml('CUSTOMER_PL', header, pl.columns, pl.rows);
    expect(html).toContain('Bundles: <b>3</b>');
    expect(html).toContain('Pieces: <b>598</b>');
  });
});

describe('renderGeneratedHtml', () => {
  it('prints visible columns, a totals row and the summary, with no supplier prices', () => {
    const pl = buildCustomerPl(parseDelimitedSheet(Buffer.from(PL)));
    const html = renderGeneratedHtml(
      'CUSTOMER_PL',
      {
        title: 'PACKING LIST',
        letterhead: { name: 'Asia Deal Hub Japan LLC' },
        to: { name: 'SUS Co., Ltd.' },
        date: '2026-10-13',
        refs: [
          { key: 'blNumber', label: 'B/L No.', value: 'BL123', visible: true },
          { key: 'ciNumber', label: 'CI No.', value: 'CI9', visible: false },
        ],
        pieces: 120,
      },
      pl.columns,
      pl.rows,
    );
    expect(html).toContain('13 Oct 2026');
    expect(html).toContain('BL123');
    // Visible body only: the embedded font's base64 can contain any letters.
    expect(html.slice(html.indexOf('</style>'))).not.toContain('CI9'); // CI No. off by default
    expect(html).toContain('7.647');
    expect(html).toContain('Bundles: <b>3</b>');
    expect(html).toContain('Pieces: <b>120</b>');
  });
});

describe('TradeGeneratedService finalize / edit-again rules', () => {
  const ORG = 'org-1';
  function setup(gen: any, removeImpl?: () => Promise<unknown>) {
    const prisma: any = {
      tradeGeneratedDoc: { findFirst: jest.fn().mockResolvedValue(gen), update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...gen, ...data })) },
      tradeFile: { findFirst: jest.fn().mockResolvedValue(gen.finalFileId ? { id: gen.finalFileId } : null) },
      tradeStep: { findFirst: jest.fn().mockResolvedValue({ id: 'step-cd' }), findMany: jest.fn().mockResolvedValue([]) },
    };
    const files: any = {
      upload: jest.fn().mockResolvedValue({ id: 'pdf-file-1' }),
      remove: jest.fn(removeImpl ?? (() => Promise.resolve({ deleted: true }))),
    };
    const pdf: any = { generatePdfFromHtml: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')) };
    const service = new TradeGeneratedService(prisma, {} as any, pdf, {} as any, files, {} as any, {} as any);
    return { prisma, files, pdf, service };
  }
  const draft = {
    id: 'g1',
    shipmentId: 'ship-1',
    docType: 'CUSTOMER_PL',
    status: 'DRAFT',
    number: null,
    finalFileId: null,
    header: { title: 'PACKING LIST', letterhead: { name: 'ADH' }, to: { name: 'SUS' }, date: '2026-10-13', refs: [] },
    columns: [{ key: 'batch', label: 'Batch', visible: true }],
    rows: [{ batch: 'A1', netMt: 2.5, grossMt: 2.6 }],
    shipment: { id: 'ship-1', blNumber: 'BL123', status: 'OPEN', contractId: 'c1' },
  };

  it('finalize renders a PDF and stores it as a CUSTOMER_PL file linked to the shipment + step', async () => {
    const { files, prisma, service } = setup(draft);
    const r = await service.finalize(ORG, 'g1', { id: 'u1', name: 'User' });
    expect(files.upload).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ originalname: 'CPL-BL123.pdf', mimetype: 'application/pdf' }),
      expect.objectContaining({ docType: 'CUSTOMER_PL', shipmentIds: ['ship-1'], stepId: 'step-cd' }),
      expect.anything(),
    );
    expect(prisma.tradeGeneratedDoc.update.mock.calls[0][0].data).toMatchObject({ status: 'FINAL', number: 'CPL-BL123', finalFileId: 'pdf-file-1' });
    expect(r.status).toBe('FINAL');
  });

  it('refuses to finalize on a closed shipment or with no rows', async () => {
    await expect(setup({ ...draft, shipment: { ...draft.shipment, status: 'COMPLETED' } }).service.finalize(ORG, 'g1', { id: 'u', name: 'U' })).rejects.toThrow(/Reopen the shipment/);
    await expect(setup({ ...draft, rows: [] }).service.finalize(ORG, 'g1', { id: 'u', name: 'U' })).rejects.toThrow(/at least one row/);
  });

  it('edit-again deletes the PDF and goes back to DRAFT', async () => {
    const { files, prisma, service } = setup({ ...draft, status: 'FINAL', finalFileId: 'pdf-file-1' });
    await service.revert(ORG, 'g1');
    expect(files.remove).toHaveBeenCalledWith(ORG, 'pdf-file-1');
    expect(prisma.tradeGeneratedDoc.update.mock.calls[0][0].data).toEqual({ status: 'DRAFT', finalFileId: null });
  });

  it('edit-again is refused (by the file rule) while a DONE step needs the PDF, and nothing changes', async () => {
    const { prisma, service } = setup({ ...draft, status: 'FINAL', finalFileId: 'pdf-file-1' }, () =>
      Promise.reject(
        new BadRequestException(
          'Can\'t delete this document: these done steps would lose a required document — reopen them first: "Create customer documents" on shipment BL123 (needs Customer packing list)',
        ),
      ),
    );
    await expect(service.revert(ORG, 'g1')).rejects.toThrow(/reopen them first: "Create customer documents"/);
    expect(prisma.tradeGeneratedDoc.update).not.toHaveBeenCalled();
  });

  it('edit-again names the DONE step (ADH number) that still needs the document', async () => {
    const { prisma, files, service } = setup({ ...draft, status: 'FINAL', finalFileId: 'pdf-file-1' });
    prisma.tradeStep.findMany.mockResolvedValue([{ title: 'Create customer documents', displayNo: '4' }]);
    await expect(service.revert(ORG, 'g1')).rejects.toThrow('Can\'t edit again: reopen "4. Create customer documents" first');
    expect(files.remove).not.toHaveBeenCalled();
  });

  it('a final document cannot be edited without edit-again', async () => {
    await expect(setup({ ...draft, status: 'FINAL' }).service.update(ORG, 'g1', { rows: [] })).rejects.toThrow(/Edit again/);
  });
});

describe('TradeGeneratedService — ADH 請求書 finalize (Sales Document)', () => {
  const ORG = 'org-1';
  const inv1 = {
    id: 'g-inv',
    shipmentId: null,
    contractId: 'c1',
    docType: 'INVOICE_1',
    status: 'DRAFT',
    number: null,
    finalFileId: null,
    documentId: null,
    header: {
      title: '請　求　書',
      invoiceNo: null,
      issueDate: '2026-07-01',
      registrationNo: 'T7010403028176',
      toName: 'SUS',
      toSuffix: '御中',
      subject: '',
      fromBlock: 'ADH',
      dueDate: '2026-07-10',
      dueLine: '',
      taxRate: 10,
      fxRate: 161.67,
      fxNote: '',
      lmeMonth: '2026-06',
      conditions: '',
      paymentTerms: '',
      bankBlock: '',
      currency: 'USD',
    },
    columns: [],
    // Lines from two contracts of the same customer (the real Invoice #1 covered 454003255 + 454003422).
    rows: [
      { description: '6005', quantity: 120, lme: 3458.64, qmjp: 351.5, premium: 190, upcharge: 10, contractId: 'c1', contractNo: '454003255', grade: '6005' },
      { description: '6063', quantity: 300, lme: 3458.64, qmjp: 351.5, premium: 230, contractId: 'c2', contractNo: '454003422', grade: '6063' },
    ],
    shipment: null,
    contract: { id: 'c1', contractNo: '454003255', status: 'OPEN' },
  };
  function setup() {
    const prisma: any = {
      tradeGeneratedDoc: { findFirst: jest.fn().mockResolvedValue(inv1), update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...inv1, ...data })) },
      contract: { findMany: jest.fn().mockResolvedValue([{ id: 'c2' }]), findFirst: jest.fn().mockResolvedValue({ customer: { id: 'cus', name: 'SUS', customerCode: 'CS001', address: null } }) },
      tradeStep: { findFirst: jest.fn().mockImplementation(({ where }: any) => Promise.resolve({ id: `step-${where.contractId}` })) },
      tradeDocumentLink: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      document: { findFirst: jest.fn().mockResolvedValue({ id: 'doc-1', name: 'ADH-INV-2026-0001' }) },
    };
    const files: any = { upload: jest.fn().mockResolvedValue({ id: 'pdf-1' }), addLinks: jest.fn().mockResolvedValue({}) };
    const pdf: any = { generatePdfFromHtml: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')) };
    const documents: any = {
      createBasicDocument: jest.fn().mockResolvedValue({ id: 'doc-1', name: 'ADH-INV-2026-0001', status: 'unconfirmed' }),
      confirmInvoice: jest.fn().mockResolvedValue({}),
    };
    const templates: any = { getDocumentTemplateByType: jest.fn().mockResolvedValue({ id: 'tpl-inv' }) };
    return {
      prisma,
      files,
      pdf,
      documents,
      templates,
      service: new TradeGeneratedService(prisma, {} as any, pdf, { getSettings: async () => ({ docDefaults: {} }) } as any, files, documents, templates),
    };
  }

  it('creates + confirms the Sales invoice (org numbering), links it to BOTH contracts, stores the PDF', async () => {
    const { prisma, files, documents, pdf, service } = setup();
    const r = await service.finalize(ORG, 'g-inv', { id: 'u1', name: 'User' });
    const [tplId, type, org, config] = documents.createBasicDocument.mock.calls[0];
    expect([tplId, type, org]).toEqual(['tpl-inv', 'INVOICE', ORG]);
    expect(config).toMatchObject({ customerId: 'cus', currency: 'USD', subtotal: 1693258.8, gstAmount: 169325.88, totalWithTax: 1862584.68, referenceNo: 'Contract 454003255, 454003422' });
    expect(config.items.map((i: any) => [i.unitPrice, i.amount])).toEqual([
      [4010.14, 481216.8],
      [4040.14, 1212042],
    ]);
    expect(documents.confirmInvoice).toHaveBeenCalledWith('doc-1', { fromInvoiceNo: '', toInvoiceNo: '' }, ORG, expect.anything());
    expect(prisma.tradeDocumentLink.create.mock.calls.map((c: any) => [c[0].data.contractId, c[0].data.stepId, c[0].data.docType])).toEqual([
      ['c1', 'step-c1', 'INVOICE_1'],
      ['c2', 'step-c2', 'INVOICE_1'],
    ]);
    expect(pdf.generatePdfFromHtml.mock.calls[0][0]).toContain('ADH-INV-2026-0001');
    expect(pdf.generatePdfFromHtml.mock.calls[0][0]).not.toContain('class="wm"'); // final PDF: no DRAFT watermark
    expect(files.upload.mock.calls[0][2]).toMatchObject({ docType: 'INVOICE_1', contractIds: ['c1'], stepId: 'step-c1' });
    // Every other contract billed is linked too, tagged with its own step (its Files tab + step chip).
    expect(files.addLinks).toHaveBeenCalledWith(ORG, 'pdf-1', { contractIds: ['c2'], stepId: 'step-c2' });
    expect(prisma.tradeGeneratedDoc.update.mock.calls[0][0].data).toMatchObject({ status: 'FINAL', number: 'ADH-INV-2026-0001', documentId: 'doc-1', finalFileId: 'pdf-1' });
    expect(r.number).toBe('ADH-INV-2026-0001');
  });
});
