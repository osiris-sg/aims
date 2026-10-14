/**
 * Build round 5–12 (2026-10): document IDs (format, counter, backfill),
 * shipment / deal auto-complete, Pending / Completed buckets, COA source
 * ranking, the US$0 / missing-price finalize block, the contract-line price
 * fallback, Invoice #2 against ADH's 2回目 sheets (every money cell), the
 * Customer PL's single grand TOTAL, and Arrival Notice extraction.
 *
 * Figures in the Invoice #2 tests are the cells of ADH's own workbooks
 * (請求書正式ビレット 2026年9月納入 6005_122.478T / 6063_305.804T 2回目); the
 * workbooks themselves are not in the repo. The live A/N test reads the real
 * notice only when it exists locally and AN_LIVE=1.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { backfillDocRefs } from '../../scripts/backfill-doc-refs';
import { ShipmentsService } from './shipments.service';
import { classifyCoaText } from './trade-coa';
import { TradeConfigService } from './trade-config.service';
import { DOC_REF_CODES, docRefBase, docRefCode, nextDocRef } from './trade-docref';
import { AN_SCHEMA, AN_SYSTEM_PROMPT, AN_USER_PROMPT, anFillable, arrivalNoticeDraft } from './trade-extract.rules';
import { renderGeneratedHtml } from './trade-generated.html';
import { pricePartsOf } from './trade-generated.service';
import { DocDefaults, finalizeMessage, invoice2FinalLines, invoiceFinalizeProblems, invoiceHeaderDefaults, InvoiceLine, invoiceTotals, renderInvoiceHtml } from './trade-invoice';
import { SgjpItem, sgjpFinalizeProblems } from './trade-logistics-docs';

const ORG = 'org-1';
const actor = { id: 'u1', name: 'Tester' };
const strip = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
const line = (over: Partial<InvoiceLine>): InvoiceLine => ({ description: '', quantity: null, unit: 'トン', unitPrice: null, amountOverride: null, remarks: '', dueDate: null, ...over });

// ── document IDs ────────────────────────────────────────────────────────────
describe('document IDs — format and counter', () => {
  it('"<contract>-<shipment>-<code>" on a shipment, "<contract>-<code>" on the contract', () => {
    expect(docRefBase({ contractNo: '454003255', seqNo: 1 }, 'CUSTOMER_PL')).toBe('454003255-1-CPL');
    expect(docRefBase({ contractNo: '454003255', seqNo: 2 }, 'SGJP_IV_PL')).toBe('454003255-2-SGJP');
    expect(docRefBase({ contractNo: '454003255' }, 'PI')).toBe('454003255-PI');
    expect(docRefBase({ contractNo: '454003255', seqNo: null }, 'DEPOSIT_PROOF')).toBe('454003255-DEP');
    expect(docRefBase({ contractNo: '454003255' }, 'INVOICE_1')).toBe('454003255-INV1');
  });
  it('every code from the spec', () => {
    const want: Record<string, string> = {
      INVOICE_1: 'INV1',
      CUSTOMER_PL: 'CPL',
      CUSTOMER_COA: 'CCOA',
      SGJP_IV_PL: 'SGJP',
      SHIPPING_INSTRUCTIONS: 'SI',
      INVOICE_2: 'INV2',
      BL: 'BL',
      CI: 'CI',
      PL: 'PL',
      COA: 'COA',
      COO: 'COO',
      INSURANCE: 'INS',
      ARRIVAL_NOTICE: 'AN',
      TAX_ESTIMATE: 'TAX',
      IMPORT_PERMIT: 'PERMIT',
      VENDOR_INVOICE: 'VINV',
      PAYMENT_PROOF: 'PAY',
      OTHER: 'OTHER',
      PI: 'PI',
      DEPOSIT_PROOF: 'DEP',
    };
    for (const [type, code] of Object.entries(want)) expect(docRefCode(type)).toBe(code);
    expect(DOC_REF_CODES.CUSTOMER_COA).toBe('CCOA');
    expect(docRefCode('NEW_THING')).toBe('NEWTHING'); // an org's own type
  });
  it('a repeat gets a counter: the base counts as the first, then -2, -3 …', () => {
    const base = '454003255-1-SGJP';
    expect(nextDocRef(base, [])).toBe(base);
    expect(nextDocRef(base, [base])).toBe(`${base}-2`);
    expect(nextDocRef(base, [base, `${base}-2`, null])).toBe(`${base}-3`);
    // Other types sharing a prefix don't count (…-1-PL vs …-1-PLX), nor other shipments.
    expect(nextDocRef('454003255-1-PL', ['454003255-1-PLX', '454003255-11-PL', '454003255-1-PL-2'])).toBe('454003255-1-PL-3');
  });
});

/**
 * A tiny in-memory Prisma for the doc-ID paths: shipments, contracts,
 * generated docs and files with their links. $transaction rolls back on a
 * throw, like the real one.
 */
function memoryDb() {
  let state = {
    contract: [{ id: 'c1', contractNo: '454003255' }],
    shipment: [
      { id: 's1', contractId: 'c1', seqNo: null as number | null, createdAt: new Date('2026-07-01') },
      { id: 's2', contractId: 'c1', seqNo: null as number | null, createdAt: new Date('2026-08-01') },
    ],
    gen: [
      { id: 'g-inv1', docType: 'INVOICE_1', contractId: 'c1', shipmentId: null, finalFileId: 'f-inv1', docRef: null as string | null, createdAt: new Date('2026-07-02') },
      { id: 'g-cpl', docType: 'CUSTOMER_PL', contractId: null, shipmentId: 's1', finalFileId: null, docRef: null as string | null, createdAt: new Date('2026-07-10') },
    ],
    file: [
      { id: 'f-pi', docType: 'PI', docRef: null as string | null, createdAt: new Date('2026-07-01'), links: [{ contractId: 'c1', shipmentId: null }] },
      { id: 'f-inv1', docType: 'INVOICE_1', docRef: null as string | null, createdAt: new Date('2026-07-03'), links: [{ contractId: 'c1', shipmentId: null }] },
      { id: 'f-pl1', docType: 'PL', docRef: null as string | null, createdAt: new Date('2026-07-05'), links: [{ contractId: null, shipmentId: 's1' }] },
      { id: 'f-pl2', docType: 'PL', docRef: null as string | null, createdAt: new Date('2026-07-06'), links: [{ contractId: null, shipmentId: 's1' }] },
      { id: 'f-coa2', docType: 'COA', docRef: null as string | null, createdAt: new Date('2026-08-05'), links: [{ contractId: null, shipmentId: 's2' }] },
      { id: 'f-loose', docType: 'OTHER', docRef: null as string | null, createdAt: new Date('2026-08-06'), links: [] as Array<{ contractId: string | null; shipmentId: string | null }> },
    ],
  };
  const byRef = (rows: Array<{ docRef: string | null }>, where: any) => rows.filter((r) => (where.docRef === null ? r.docRef === null : where.docRef?.startsWith ? (r.docRef ?? '').startsWith(where.docRef.startsWith) : true));
  const asc = <T extends { createdAt: Date }>(rows: T[]) => [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const db: any = {
    contract: { findFirst: async ({ where }: any) => state.contract.find((c) => c.id === where.id) ?? null },
    shipment: {
      findFirst: async ({ where }: any) => {
        const s = state.shipment.find((x) => x.id === where.id);
        return s ? { ...s, contract: state.contract.find((c) => c.id === s.contractId) } : null;
      },
      findMany: async ({ where }: any) => asc(state.shipment.filter((s) => (where.contractId ? s.contractId === where.contractId : true) && (where.seqNo === null ? s.seqNo === null : true))),
      update: async ({ where, data }: any) => Object.assign(state.shipment.find((s) => s.id === where.id)!, data),
    },
    tradeGeneratedDoc: {
      findMany: async ({ where }: any) => asc(byRef(state.gen, where) as typeof state.gen),
      update: async ({ where, data }: any) => Object.assign(state.gen.find((g) => g.id === where.id)!, data),
    },
    tradeFile: {
      findMany: async ({ where }: any) => asc(byRef(state.file, where) as typeof state.file),
      findFirst: async ({ where }: any) => state.file.find((f) => f.id === where.id) ?? null,
      update: async ({ where, data }: any) => Object.assign(state.file.find((f) => f.id === where.id)!, data),
      updateMany: async ({ where, data }: any) => {
        const f = state.file.find((x) => x.id === where.id && (where.docRef === null ? x.docRef === null : true));
        if (f) Object.assign(f, data);
        return { count: f ? 1 : 0 };
      },
    },
  };
  db.$transaction = async (fn: any) => {
    const before = JSON.stringify(state);
    try {
      return await fn(db);
    } catch (e) {
      state = JSON.parse(before, (k, v) => (k === 'createdAt' ? new Date(v) : v));
      throw e;
    }
  };
  return { db, get: () => state };
}

describe('document IDs — assignment', () => {
  it('a shipment document takes its shipment number (numbered by creation), a contract document none', async () => {
    const { db, get } = memoryDb();
    const config = new TradeConfigService(db);
    expect(await config.docRefFor(db, ORG, { shipmentId: 's2' }, 'BL')).toBe('454003255-2-BL');
    expect(get().shipment.map((s) => s.seqNo)).toEqual([1, 2]); // both numbered, oldest first
    expect(await config.docRefFor(db, ORG, { contractId: 'c1' }, 'PI')).toBe('454003255-PI');
  });
  it('the next free counter is taken from files AND in-app documents', async () => {
    const { db, get } = memoryDb();
    get().shipment[0].seqNo = 1;
    get().file[2].docRef = '454003255-1-SGJP';
    get().gen[1].docRef = '454003255-1-SGJP-2';
    expect(await new TradeConfigService(db).docRefFor(db, ORG, { shipmentId: 's1' }, 'SGJP_IV_PL')).toBe('454003255-1-SGJP-3');
  });
  it('a file stored before it was linked gets its ID on linking; one that has an ID keeps it', async () => {
    const { db, get } = memoryDb();
    const config = new TradeConfigService(db);
    await config.ensureFileDocRef(db, ORG, 'f-loose', { shipmentId: 's1' });
    expect(get().file[5].docRef).toBe('454003255-1-OTHER');
    await config.ensureFileDocRef(db, ORG, 'f-loose', { shipmentId: 's2' });
    expect(get().file[5].docRef).toBe('454003255-1-OTHER'); // stable
  });
});

describe('document IDs — backfill', () => {
  it('dry run changes nothing and reports what it would assign', async () => {
    const { db, get } = memoryDb();
    const r = await backfillDocRefs(db, new TradeConfigService(db), ORG, false);
    expect(r).toMatchObject({ shipmentsNumbered: 2, generated: 2, files: 4, skippedUnlinked: 1 });
    expect(get().shipment.every((s) => s.seqNo === null)).toBe(true);
    expect(get().file.every((f) => f.docRef === null)).toBe(true);
  });
  it('apply: shipments numbered, in-app docs first (their PDF takes the same ID), then files oldest first with counters', async () => {
    const { db, get } = memoryDb();
    const r = await backfillDocRefs(db, new TradeConfigService(db), ORG, true);
    expect(r.refs).toEqual([
      '454003255-INV1 (in-app INVOICE_1)',
      '454003255-1-CPL (in-app CUSTOMER_PL)',
      '454003255-PI (PI)',
      '454003255-1-PL (PL)',
      '454003255-1-PL-2 (PL)',
      '454003255-2-COA (COA)',
    ]);
    const refs = Object.fromEntries(get().file.map((f) => [f.id, f.docRef]));
    expect(refs).toEqual({ 'f-pi': '454003255-PI', 'f-inv1': '454003255-INV1', 'f-pl1': '454003255-1-PL', 'f-pl2': '454003255-1-PL-2', 'f-coa2': '454003255-2-COA', 'f-loose': null });
    // Running again is a no-op.
    expect(await backfillDocRefs(db, new TradeConfigService(db), ORG, true)).toMatchObject({ shipmentsNumbered: 0, generated: 0, files: 0 });
  });
});

// ── auto-complete: shipment → deal ──────────────────────────────────────────
const step = (id: string, sortOrder: number, over: Record<string, unknown> = {}) => ({
  id,
  title: id,
  displayNo: String(sortOrder),
  sortOrder,
  status: 'DONE',
  isOngoing: false,
  requiredDocTypes: [] as string[],
  requiredFields: [] as string[],
  holdOpen: false,
  ...over,
});

function dealDb(opts: { otherShipment: 'COMPLETED' | 'OPEN' | 'CANCELLED' | null; contractStepsDone?: boolean }) {
  const prisma: any = {
    shipment: {
      findFirst: jest.fn().mockResolvedValue({ id: 'sh1', contractId: 'c1', status: 'OPEN', blNumber: '198GX04822', contractLineId: 'L1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    contract: {
      findFirst: jest.fn().mockResolvedValue({
        status: 'OPEN',
        steps: [{ status: 'DONE', isOngoing: false }, { status: opts.contractStepsDone === false ? 'IN_PROGRESS' : 'DONE', isOngoing: false }],
        // sh1 is COMPLETED by the time the deal is checked.
        shipments: [{ status: 'COMPLETED' }, ...(opts.otherShipment ? [{ status: opts.otherShipment }] : [])],
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    tradeStep: {
      findMany: jest.fn().mockResolvedValue([
        step('a', 2),
        step('b', 3),
        step('last', 13, { status: 'IN_PROGRESS', requiredDocTypes: ['INVOICE_2'] }),
        step('ongoing', 14, { status: 'IN_PROGRESS', isOngoing: true }),
      ]),
      update: jest.fn().mockResolvedValue({}),
    },
    tradeFileLink: { findMany: jest.fn().mockResolvedValue([{ file: { docType: 'INVOICE_2' } }]) },
    tradeDocumentLink: { findMany: jest.fn().mockResolvedValue([]) },
    document: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return prisma;
}

describe('auto-complete: the last step completes the shipment, the last shipment the deal', () => {
  it('shipment → COMPLETED and the deal → COMPLETED when every other shipment is done', async () => {
    const prisma = dealDb({ otherShipment: 'COMPLETED' });
    const closed = { shipments: [] as string[], contracts: [] as string[] };
    const done = await new TradeConfigService(prisma).syncSteps(prisma, ORG, [{ shipmentId: 'sh1' }], actor, { docTypes: ['INVOICE_2'] }, { closed });
    expect(done).toEqual(['13. last']);
    expect(prisma.shipment.update).toHaveBeenCalledWith({ where: { id: 'sh1', organizationId: ORG }, data: { status: 'COMPLETED' } });
    expect(prisma.contract.update).toHaveBeenCalledWith({ where: { id: 'c1', organizationId: ORG }, data: { status: 'COMPLETED' } });
    expect(closed).toEqual({ shipments: ['sh1'], contracts: ['c1'] });
  });
  it('a cancelled shipment does not hold the deal open', async () => {
    const prisma = dealDb({ otherShipment: 'CANCELLED' });
    await new TradeConfigService(prisma).syncSteps(prisma, ORG, [{ shipmentId: 'sh1' }], actor, { docTypes: ['INVOICE_2'] });
    expect(prisma.contract.update).toHaveBeenCalled();
  });
  it('another open shipment (or an open contract step) keeps the deal open; the shipment still completes', async () => {
    for (const p of [dealDb({ otherShipment: 'OPEN' }), dealDb({ otherShipment: null, contractStepsDone: false })]) {
      await new TradeConfigService(p).syncSteps(p, ORG, [{ shipmentId: 'sh1' }], actor, { docTypes: ['INVOICE_2'] });
      expect(p.shipment.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'COMPLETED' } }));
      expect(p.contract.update).not.toHaveBeenCalled();
    }
  });
  it('nothing completed and no "Mark done": the shipment stays open', async () => {
    const prisma = dealDb({ otherShipment: null });
    prisma.tradeFileLink.findMany.mockResolvedValue([]);
    await new TradeConfigService(prisma).syncSteps(prisma, ORG, [{ shipmentId: 'sh1' }], actor);
    expect(prisma.shipment.update).not.toHaveBeenCalled();
  });
});

// ── Shipments list: Pending / Completed ─────────────────────────────────────
describe('Shipments list buckets', () => {
  const svc = () => {
    const prisma: any = { shipment: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(3) } };
    return { prisma, s: new ShipmentsService(prisma, new TradeConfigService(prisma)) };
  };
  it('Pending = open; Completed = completed + cancelled; counts follow the other filters but not the tab', async () => {
    const { prisma, s } = svc();
    const r = await s.list(ORG, { bucket: 'pending', contractId: '11111111-1111-1111-1111-111111111111' } as any);
    expect(prisma.shipment.findMany.mock.calls[0][0].where).toMatchObject({ status: 'OPEN', contractId: '11111111-1111-1111-1111-111111111111' });
    const countWheres = prisma.shipment.count.mock.calls.map((c: any) => c[0].where);
    expect(countWheres).toContainEqual(expect.objectContaining({ status: 'OPEN', contractId: '11111111-1111-1111-1111-111111111111' }));
    expect(countWheres).toContainEqual(expect.objectContaining({ status: { in: ['COMPLETED', 'CANCELLED'] }, contractId: '11111111-1111-1111-1111-111111111111' }));
    expect(r.counts).toEqual({ pending: 3, completed: 3 });

    const { prisma: p2, s: s2 } = svc();
    await s2.list(ORG, { bucket: 'completed' } as any);
    expect(p2.shipment.findMany.mock.calls[0][0].where.status).toEqual({ in: ['COMPLETED', 'CANCELLED'] });
  });
});

// ── COA source pick ─────────────────────────────────────────────────────────
describe('COA source ranking', () => {
  it('tells the COA summary (weights + chemistry) from the per-cast test report (chemistry only)', () => {
    expect(classifyCoaText('COA SUMMARY  Cast No  Net Wt (MT)  No of Bundle  Fe  Si  Mg')).toBe('summary');
    expect(classifyCoaText('VEDANTA LIMITED  TEST REPORT  Heat No  Fe Si Mg')).toBe('report');
    expect(classifyCoaText('TEST CERTIFICATE')).toBe('report');
    expect(classifyCoaText('')).toBe('unknown');
  });
  it('sources(): the summary / COA.XLS first and marked best, the test report last, each labelled', async () => {
    const files = [
      { id: 'rep', fileName: 'COA_9000565680.pdf', createdAt: new Date('2026-08-03'), uploadedByName: 'A', docRef: '454003255-1-COA-3' },
      { id: 'xls', fileName: 'COA.XLS', createdAt: new Date('2026-08-01'), uploadedByName: 'A', docRef: '454003255-1-COA' },
      { id: 'sum', fileName: 'COA_集計ファイル_Sep120t.pdf', createdAt: new Date('2026-08-02'), uploadedByName: 'A', docRef: '454003255-1-COA-2' },
    ];
    const prisma: any = {
      tradeFile: {
        findMany: jest.fn().mockResolvedValue(files),
        findFirst: jest.fn(({ where }: any) => Promise.resolve({ s3Key: `k/${where.id}` })),
      },
    };
    const texts: Record<string, string> = { 'k/rep': 'TEST REPORT Heat No Fe Si', 'k/sum': 'Cast No Net Wt Bundle Fe Si' };
    jest.resetModules();
    jest.doMock('./trade-coa', () => ({ ...jest.requireActual('./trade-coa'), pdfText: jest.fn(async (b: Buffer) => texts[b.toString()]) }));
    const { TradeGeneratedService: Svc } = await import('./trade-generated.service');
    const s3: any = { downloadFile: jest.fn(async (k: string) => Buffer.from(k)) };
    const svc = new (Svc as any)(prisma, {}, {}, s3, {}, {});
    // Constructor wiring differs between rounds — make sure s3 is the one we passed.
    (svc as any).s3 = s3;
    const out = await svc.sources(ORG, 'sh1', 'CUSTOMER_COA');
    expect(out.map((f: any) => [f.id, f.label, f.best])).toEqual([
      ['sum', 'COA summary: weights + chemistry', true],
      ['xls', 'COA summary: weights + chemistry', false],
      ['rep', 'Test report: chemistry only', false],
    ]);
    jest.dontMock('./trade-coa');
  });
});

// ── finalize block ──────────────────────────────────────────────────────────
describe('Finalize is refused on a missing price / LME or a US$0 total, naming what is missing', () => {
  it('invoices: helper without LME, a line without a unit price, and the zero total', () => {
    const rows = [line({ description: 'Aluminium Billet 6005', quantity: 120, qmjp: 395, premium: 190 }), line({ description: '通関', quantity: 1 })];
    const p = invoiceFinalizeProblems(rows, 10);
    expect(p).toEqual(['line 1 needs the LME', 'line 2 needs a unit price', 'the total is US$0.00']);
    expect(finalizeMessage(p)).toBe("Can't finalize: line 1 needs the LME; line 2 needs a unit price; the total is US$0.00.");
  });
  it('a priced invoice passes; blank lines are ignored; a typed amount counts', () => {
    expect(invoiceFinalizeProblems([line({ description: 'x', quantity: 2, unitPrice: 10 }), line({})], 10)).toEqual([]);
    expect(invoiceFinalizeProblems([line({ description: 'x', amountOverride: 5 })], 10)).toEqual([]);
    expect(invoiceFinalizeProblems([line({ description: 'x', quantity: 1, unitPrice: 0 })], 10)).toEqual(['the total is US$0.00']);
  });
  it('SG→JP: same rules per item', () => {
    const item: SgjpItem = { goods: 'Aluminium Billet Alloy 6005', hsCode: '7601.20', terms: 'CIF', lme: null, qmjp: 395, premium: 190, upcharge: 10, unitPrice: null, quantity: 122.478, bundles: 48, pieces: 240, netMt: 122.478, grossMt: 122.958 } as SgjpItem;
    expect(sgjpFinalizeProblems([item])).toEqual(['item 1 needs the LME', 'the total is US$0.00']);
    expect(sgjpFinalizeProblems([{ ...item, lme: 3155.98 }])).toEqual([]);
  });
});

// ── prefill fallback ────────────────────────────────────────────────────────
describe('price parts: Invoice #1 first, else the contract line', () => {
  it('falls back per part', () => {
    expect(pricePartsOf(null, { qmjp: '395', billetPremium: '190', upcharge: '10' })).toEqual({ qmjp: 395, premium: 190, upcharge: 10 });
    expect(pricePartsOf({ qmjp: 351.5, premium: null, upcharge: null }, { qmjp: '395', billetPremium: '190', upcharge: null })).toEqual({ qmjp: 351.5, premium: 190, upcharge: null });
    expect(pricePartsOf(null, null)).toEqual({ qmjp: null, premium: null, upcharge: null });
  });
});

// ── Invoice #2 vs ADH's 2回目 sheets ────────────────────────────────────────
const ADH2: DocDefaults = {
  invoice2RemarksTemplate: 'LME Cash月平均　{month}月USD{LME} + {QMJP}({q}QMJP) +{premium}(Billet Premium){upcharge}\nTotal Premium is {QMJP}(QMJP) + {totalPremium}',
  invoiceUpchargeTemplate: ' +{upcharge}(upcharge for {grade})',
  invoice2LineTemplate: 'Aluminium Billet - {grade} as per Specification of 8 Inch-\n{qty}MT +- {tol}% Tolerance\n製品仕様は貴社指定仕様',
  invoice2OtherPerMt: 40,
  invoice2OtherRemarks: '{rate}USD/ton\n（{qty}トン/月)',
  banks: [{ id: 'cfsb', label: 'Community Federal Savings Bank', block: 'Community Federal Savings Bank' }],
  defaultBankId: 'cfsb',
};

function invoice2(o: { grade: string; qty: string; net: string; lme: number; qmjp: number; premium: number; upcharge: number | null; customs: number; nonTaxable: number; fx: number; invoice1: number }) {
  const rows = invoice2FinalLines({
    netWeightMt: o.net,
    line: { id: 'l1', grade: o.grade, product: 'Aluminium Billet', sizeSpec: '203 MM X 5800 MM', quantityMt: o.qty, tolerancePct: '5' },
    contract: { id: 'c1', contractNo: '454003255' },
    invoice1Line: { qmjp: o.qmjp, premium: o.premium, upcharge: o.upcharge },
    defaults: ADH2,
    dueDate: '2026-10-12',
    lmeMonth: '2026-07',
  });
  rows[0].lme = o.lme;
  rows[1].unitPrice = o.customs;
  rows[2].unitPrice = o.nonTaxable;
  const h = {
    ...invoiceHeaderDefaults({ today: '2026-10-05', org: { name: 'ADH' }, customerName: 'SUS株式会社', grades: [o.grade], products: ['Aluminium Billet'], defaults: ADH2, docType: 'INVOICE_2' } as any),
    variant: 'final' as const,
    fxRate: o.fx,
    invoice1Amount: o.invoice1,
  };
  return { rows, h, text: strip(renderInvoiceHtml(h, rows)), html: renderInvoiceHtml(h, rows), totals: invoiceTotals(rows, 10, o.fx, 'final') };
}

describe('Invoice #2 = ADH 6005 122.478 t 2回目 (PDF用), every money cell', () => {
  const r = invoice2({ grade: '6005', qty: '120', net: '122.478', lme: 3155.98, qmjp: 395, premium: 190, upcharge: 10, customs: 6492.04, nonTaxable: 74.15, fx: 159.12, invoice1: 529338.48 });
  it('lines: E15 3,750.98 · F15 459,412.52 · F16 6,492.04 · F17 74.15 · F18 4,899.12 (1 式)', () => {
    for (const s of ['122.478 3,750.98 459,412.52', '1 6,492.04 6,492.04', '1 74.15 74.15', '1 4,899.12 4,899.12']) expect(r.text).toContain(s);
  });
  it('totals F19–F24: 470,803.68 · 47,080.36 · 74.15 · 517,958.19 · 529,338.48 · -11,380.29', () => {
    expect(r.totals).toMatchObject({ taxable: 470803.68, tax: 47080.36, nonTaxable: 74.15, total: 517958.19 });
    for (const s of ['課税対象金額 470,803.68', '消費税(10%) 47,080.36', '課税以外金額 74.15', '合計 517,958.19', '１回目の金額 529,338.48', '２回目の金額(差額) -11,380.29']) expect(r.text).toContain(s);
  });
  it('C12 合計(税込) prints negative as (US$11,380.29) in red', () => {
    expect(r.text).toContain('合計(税込) (US$11,380.29)');
    expect(r.html).toMatch(/class="[^"]*neg[^"]*"[^>]*>\s*\(US\$11,380\.29\)/);
  });
  it('税率別内訳 C28–E29: US$470,803.68 · US$47,080.36 · US$517,958.19 and ¥74,914,282 · ¥7,491,427 · ¥82,405,709 at 159.12', () => {
    expect(r.text).toContain('US$470,803.68 US$47,080.36 US$517,958.19');
    expect(r.text).toContain('¥74,914,282 ¥7,491,427 ¥82,405,709');
    expect(r.totals.jpy).toEqual({ subtotal: 74914282, tax: 7491427, total: 82405709 });
    expect(r.text).toContain('159.12');
  });
  it('諸条件: 納入条件 + "請求書発行 6営業日以内" once, no extra 条件 line; dates m/d/yy', () => {
    expect(r.text).toContain('諸条件 ・納入条件ートラック積替え貴社指定先に納入（車上渡し） ・請求書発行 6営業日以内 弊社指定口座振込');
    expect(r.text.match(/諸条件/g)).toHaveLength(1);
    expect(r.text).not.toMatch(/(^|\s)条件[：:]/);
    expect(r.text).toContain('発行日： 10/5/26');
    expect(r.text).toContain('10/12/26');
  });
});

describe('Invoice #2 = ADH 6063 305.804 t 2回目: the cells both sheets compute the same way', () => {
  const r = invoice2({ grade: '6063', qty: '300', net: '305.804', lme: 3155.98, qmjp: 395, premium: 230, upcharge: null, customs: 16754.03, nonTaxable: 74.21, fx: 159, invoice1: 1333246.2 });
  it('lines, totals, 差額, US$ 税抜 / 消費税 and ¥ 税抜 match', () => {
    for (const s of ['305.804 3,780.98 1,156,238.80', '1 16,754.03 16,754.03', '1 74.21 74.21', '1 12,232.16 12,232.16']) expect(r.text).toContain(s);
    expect(r.totals).toMatchObject({ taxable: 1185224.99, tax: 118522.49, nonTaxable: 74.21, total: 1303821.69 });
    expect(r.text).toContain('２回目の金額(差額) -29,424.51');
    expect(r.text).toContain('合計(税込) (US$29,424.51)');
    expect(r.totals.jpy?.subtotal).toBe(188450773);
  });
  it('known differences of the 6063 sheet (reported to ADH, not implemented): 税込 E29, ¥ tax D30, 他諸掛 as 305.804 × 40', () => {
    // 6063 sheet: E29 = C29 + D29 = 1,303,747.48 (leaves out the non-taxable 74.21); D30 = C30 × 0.1 = ¥18,845,077.3
    // unrounded; 他諸掛 printed as 305.804 × 40.00. The 6005 sheet (implemented): 税込 = 合計, ¥ tax = ROUND(US$ tax × FX),
    // 他諸掛 1 × ROUNDDOWN(net × 40, 2) — same amount.
    expect(r.totals.breakdownGross).toBe(1303821.69);
    expect(r.totals.jpy?.tax).toBe(18845076);
    expect(r.rows[3]).toMatchObject({ quantity: 1, unitPrice: 12232.16 });
  });
});

// ── Customer PL: one grand TOTAL ────────────────────────────────────────────
describe('Customer PL prints the grand TOTAL once, at the end (not as a repeating table footer)', () => {
  it('no <tfoot>; one TOTAL row, after the last sub-total', () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ no: i + 1, batch: `TA${100100 + i}`, container: `CONT${String(Math.floor(i / 10)).padStart(7, '0')}`, netMt: 2.5, grossMt: 2.51 }));
    const h: any = { layout: 'jp', refs: [], plDate: '2026-08-12', date: '2026-08-18', formLabel: '様式2', to: { name: 'SUS株式会社' }, from: { name: 'ADH' } };
    const html = renderGeneratedHtml('CUSTOMER_PL', h, [], rows);
    expect(html).not.toMatch(/<tfoot[\s>][\s\S]*<\/tfoot>/);
    const text = strip(html);
    expect(text.match(/TOTAL 150\.000 150\.600/g)).toHaveLength(1);
    expect(text.lastIndexOf('Sub Total')).toBeLessThan(text.indexOf('TOTAL 150.000'));
  });
});

// ── Arrival Notice ──────────────────────────────────────────────────────────
describe('Arrival Notice extraction → shipment fields', () => {
  const reply = {
    blNumber: '198GX04822',
    vessel: 'WAN HAI 366',
    voyageNo: 'E049',
    eta: '2026-09-04',
    cyTerminal: 'BC鈴江',
    portOfLoading: 'VISAKHAPATNAM',
    portOfDischarge: 'YOKOHAMA',
    grossWeightKg: 122958,
    netWeightKg: 122478,
    totalBundles: 48,
    totalPieces: 240,
    containers: [
      { containerNo: 'AAAU1000001', sealNo: 'S1', size: '20SD86' },
      { containerNo: 'AAAU1000002', sealNo: 'S2', size: '20SD86' },
    ],
    charges: [
      { code: 'THC', amount: 200000, currency: 'JPY', collect: true },
      { code: 'DOC', amount: 32800, currency: 'JPY', collect: true },
      { code: 'OF', amount: 900, currency: 'USD', collect: false },
    ],
  };
  it('kg → MT, container count, charges collect summed per currency', () => {
    const d = arrivalNoticeDraft(AN_SCHEMA.parse(reply));
    expect(d).toMatchObject({ vessel: 'WAN HAI 366', voyageNo: 'E049', eta: '2026-09-04', cyTerminal: 'BC鈴江', grossWeightMt: 122.958, netWeightMt: 122.478, totalBundles: 48, totalPieces: 240, containerCount: 2 });
    expect(d.chargesCollect).toEqual([{ currency: 'JPY', amount: 232800 }]);
  });
  it('missing values come back as null, not undefined', () => {
    const d = arrivalNoticeDraft(AN_SCHEMA.parse({ vessel: 'X', containers: null, charges: null }));
    expect(d).toMatchObject({ blNumber: null, eta: null, grossWeightMt: null, containerCount: null, containers: [], chargesCollect: [] });
  });
  it('offers only the shipment fields that are still blank', () => {
    const d = arrivalNoticeDraft(AN_SCHEMA.parse(reply));
    expect(anFillable(d, { vessel: 'WAN HAI 366', voyageNo: null, eta: '', netWeightMt: 122.478, grossWeightMt: null, totalBundles: null, totalPieces: 240, containerCount: null })).toEqual({
      voyageNo: 'E049',
      eta: '2026-09-04',
      grossWeightMt: 122.958,
      totalBundles: 48,
      containerCount: 2,
      portOfLoading: 'VISAKHAPATNAM',
      portOfDischarge: 'YOKOHAMA',
    });
  });

  // The real notice (ADH's file, never committed): AN_LIVE=1 with the PDF in ~/Desktop/ADH_Docs.
  const dir = path.join(os.homedir(), 'Desktop/ADH_Docs');
  const fixture = fs.existsSync(dir) ? fs.readdirSync(dir).find((n) => /198GX04822-MAIL\.pdf$/.test(n) && n.includes('_AN_')) : undefined;
  (process.env.AN_LIVE === '1' && fixture ? it : it.skip)(
    'reads the real arrival notice (198GX04822) with the AI',
    async () => {
      const { DocumentExtractionService } = await import('../document-extraction/document-extraction.service');
      const out = await new (DocumentExtractionService as any)().extractStructured({ buffer: fs.readFileSync(path.join(dir, fixture!)), mimetype: 'application/pdf' }, AN_SYSTEM_PROMPT, AN_USER_PROMPT, { maxTokens: 4000 });
      const d = arrivalNoticeDraft(AN_SCHEMA.parse(out.data));
      expect(d).toMatchObject({ blNumber: '198GX04822', vessel: 'WAN HAI 366', voyageNo: 'E049', eta: '2026-09-04', grossWeightMt: 122.958, netWeightMt: 122.478, totalBundles: 48, totalPieces: 240, containerCount: 6 });
      expect(d.cyTerminal).toContain('鈴江');
      expect(d.containers.every((c) => c.containerNo && c.sealNo)).toBe(true);
      expect(d.chargesCollect).toEqual([{ currency: 'JPY', amount: 232800 }]);
    },
    180_000,
  );
});
