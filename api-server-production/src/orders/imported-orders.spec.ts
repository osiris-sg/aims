import { DocumentNumberingService, DEFAULT_ORDER_PATTERN, ORDER_DOC_CODE } from '../document-numbering/document-numbering.service';
import { OrdersService } from './orders.service';
import {
  IMPORTED_ORDER_SOURCE,
  assertNotImportedOrder,
  erpQuoteKey,
  importedOrderNumber,
  importedOrderStatus,
  importedTracker,
  importedInvoiceMoney,
  creditOfImportedInvoice,
  invoiceQuoteRef,
  isImportedOrderNumber,
  planImportedOrders,
  quotationRefsInText,
  type PlanDoc,
} from './imported-orders';

const WCT = 'org-wct';
const BCAIR = 'org-bcair';
const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === 'object') {
    Object.values(o as any).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
};
const quote = (id: string, name: string, org = WCT, over: any = {}): PlanDoc => ({
  id,
  organizationId: org,
  type: 'QUOTATION',
  name,
  status: 'confirmed',
  config: { customerId: 'c1', date: '2024-05-02', totalWithTax: 1000, subject: 'Degreasing', erpImport: { source: 'wct-erp', status: 'Accepted' }, ...over },
});
const invoice = (id: string, name: string, erp: any, over: any = {}, org = WCT): PlanDoc => ({
  id,
  organizationId: org,
  type: 'INVOICE',
  name,
  status: 'paid',
  config: { customerId: 'c1', date: '2024-06-01', totalWithTax: 500, outstandingBalance: 0, paidToDate: 500, erpImport: { status: 'Paid', ...erp }, ...over },
});

describe('imported orders: ERP link signals', () => {
  it('reads the ERP quotation number in its forms, nothing else', () => {
    expect(erpQuoteKey('Q-004533')).toBe(4533);
    expect(erpQuoteKey('-014162 - 09 Jul 2026 to 09 Jul 2026')).toBe(14162);
    expect(erpQuoteKey('-004533-R0')).toBe(4533);
    expect(erpQuoteKey('-7966')).toBe(7966);
    for (const other of ['SQBA-24-00057-R0', 'BCAQN-0070-R1', 'Q26-048-R0', 'Q000001', '', null]) expect(erpQuoteKey(other)).toBeNull();
  });

  it('finds "Refer to Quotation" line text only', () => {
    expect(quotationRefsInText('Refer to Quotation (-011825)')).toEqual([11825]);
    expect(quotationRefsInText('Valued of work certified (refer to Quotation (-012001)')).toEqual([12001]);
    expect(quotationRefsInText('Refer to the Quotation#Q12345')).toEqual([12345]);
    expect(quotationRefsInText('*Price is not included in this quotation 2026*')).toEqual([]);
  });

  it('explicit field first (contract_no / tracker quotation no.), then line text with one number', () => {
    expect(invoiceQuoteRef({ erpImport: { source: 'wct-erp', contractNo: '-013042 - 26 Jul 2025 to' }, items: [{ description: 'Refer to Quotation (-000001)' }] })).toEqual({ key: 13042, source: 'contract_no' });
    expect(invoiceQuoteRef({ erpImport: { source: 'wctc-tracker', quotationNo: '-7966' } })).toEqual({ key: 7966, source: 'tracker_quotation_no' });
    expect(invoiceQuoteRef({ erpImport: { source: 'wct-erp' }, items: [{ description: 'Refer to Quotation (-011825)' }] })).toEqual({ key: 11825, source: 'line_text' });
    expect(invoiceQuoteRef({ erpImport: { source: 'wct-erp' }, items: [{ description: 'Refer to Quotation -000010' }, { description: 'Refer to Quotation -000011' }] })).toBeNull();
    // The ERP's own Quotation No. link (pulled read-only) comes first.
    expect(invoiceQuoteRef({ erpImport: { source: 'wct-erp' } }, '-013690')).toEqual({ key: 13690, source: 'erp_quotation_link' });
    expect(invoiceQuoteRef({ erpImport: { source: 'wct-erp', contractNo: '-000001 - x' } }, '-013690')).toEqual({ key: 13690, source: 'erp_quotation_link' });
    // A native (not imported) invoice is never read.
    expect(invoiceQuoteRef({ items: [{ description: 'Refer to Quotation (-011825)' }] })).toBeNull();
  });
});

describe('imported orders: plan', () => {
  it('one order per quotation with ERP-linked invoices, all of them on it; no order without invoices; documents untouched', () => {
    const docs = deepFreeze([
      quote('q1', 'Q-000100'),
      quote('q2', 'Q-000200'),
      quote('q3', 'Q-000300', WCT, { customerId: 'c9' }),
      invoice('i1', 'I-1', { source: 'wct-erp', contractNo: '-000100 - 1 Jan' }),
      invoice('i2', 'I-2', { source: 'wct-erp', ourDoNo: 'DO000777' }, { items: [{ description: 'Refer to Quotation (-000100)' }] }),
      invoice('i3', 'I-3', { source: 'wct-erp', contractNo: '-000300 - 1 Jan' }),
      invoice('i4', 'I-4', { source: 'wct-erp' }), // no ERP link: stays unlinked
    ]);
    const before = JSON.stringify(docs);
    const plan = planImportedOrders(docs);
    expect(plan.orders.map((o) => [o.orderNumber, o.invoices.map((i) => [i.doc.id, i.source])])).toEqual([
      ['ORD-Q-000100', [['i1', 'contract_no'], ['i2', 'line_text']]],
      ['ORD-Q-000300', [['i3', 'contract_no']]],
    ]);
    expect(plan.orders[0]).toMatchObject({ date: '2024-05-02', customerId: 'c1', erpDoNumbers: ['DO000777'], status: { status: 'PAID' } });
    // Customer from the quotation; the invoice's different customer is flagged.
    expect(plan.orders[1]).toMatchObject({ customerId: 'c9', customerMismatch: ['I-3'] });
    expect(plan.quotesWithoutInvoice).toBe(1);
    expect(JSON.stringify(docs)).toBe(before);
  });

  it('never links across orgs, to a quotation not in AIMS, to a shared number, or a cancelled invoice', () => {
    const plan = planImportedOrders([
      quote('qb', 'Q-000500', BCAIR),
      quote('qd1', 'Q-000600'),
      quote('qd2', 'Q-000600-2'),
      invoice('x1', 'I-10', { source: 'wct-erp', contractNo: '-000500 - x' }),
      invoice('x2', 'I-11', { source: 'wct-erp', contractNo: '-000999 - x' }),
      invoice('x3', 'I-12', { source: 'wct-erp', contractNo: '-000600 - x' }),
      invoice('x4', 'I13', { source: 'wctc-tracker', quotationNo: '-500', status: 'Cancelled' }, {}, BCAIR),
    ]);
    expect(plan.orders).toEqual([]);
    expect(plan.skipped.map((s) => [s.invoice, s.why, s.otherOrg ?? null])).toEqual([
      ['I-10', 'quotation is in another org', BCAIR],
      ['I-11', 'quotation not in AIMS', null],
      ['I-12', 'several quotations with that number', null],
      ['I13', 'invoice cancelled in the ERP', null],
    ]);
  });

  it('is idempotent: a quotation that already has an order gets none; --exclude leaves an org out', () => {
    const docs = [quote('q1', 'Q-000100'), invoice('i1', 'I-1', { source: 'wct-erp', contractNo: '-000100 - x' }), quote('qb', 'Q-000700', BCAIR), invoice('ib', 'I000001', { source: 'wctc-tracker', quotationNo: '-700' }, {}, BCAIR)];
    expect(planImportedOrders(docs).orders).toHaveLength(2);
    const again = planImportedOrders(docs, { quotationIdsWithOrder: new Set(['q1', 'qb']) });
    expect(again.orders).toHaveLength(0);
    expect(again.alreadyOrdered).toBe(2);
    expect(planImportedOrders(docs, { exclude: new Set([BCAIR]) }).orders.map((o) => o.organizationId)).toEqual([WCT]);
  });

  it('uses ERP-pulled links (org + invoice no.) for invoices the export did not link', () => {
    const plan = planImportedOrders([quote('q1', 'Q-013690'), invoice('i1', 'I-014032', { source: 'wct-erp' })], { erpLinks: new Map([[`${WCT}|I-014032`, '-013690']]) });
    expect(plan.orders.map((o) => [o.orderNumber, o.invoices.map((i) => i.source)])).toEqual([['ORD-Q-013690', ['erp_quotation_link']]]);
  });

  it('puts a credit note on the order of the invoice it credits (no money of its own)', () => {
    const cn: PlanDoc = { id: 'cn1', organizationId: BCAIR, type: 'CREDIT_NOTE', name: 'CN0009', status: 'confirmed', config: { sourceDocumentId: 'ib', totalWithTax: 200, erpImport: { source: 'bcair-cn-tracker' } } };
    const plan = planImportedOrders([quote('qb', 'Q-000700', BCAIR), invoice('ib', 'I000315', { source: 'wctc-tracker', quotationNo: '-700' }, { totalWithTax: 500, outstandingBalance: 0, paidToDate: 300 }, BCAIR), cn]);
    expect(plan.orders[0].creditNotes.map((d) => d.name)).toEqual(['CN0009']);
    // Credit 200 lowers what the invoice bills (300) against the quotation's 1,000: part billed, paid.
    expect(plan.orders[0].credits).toEqual({ ib: 200 });
    expect(plan.orders[0].status).toMatchObject({ status: 'PART_BILLED', label: 'Part billed, paid', total: 500, billed: 300, owed: 0, credited: 200, quoteTotal: 1000 });
  });

  it('lists invoices whose ERP links disagree and keeps the ERP quotation link', () => {
    const plan = planImportedOrders(
      [quote('q1', 'Q-000100'), quote('q2', 'Q-000200'), invoice('i1', 'I-1', { source: 'wct-erp', contractNo: '-000200 - x' }, { items: [{ description: 'Refer to Quotation (-000200)' }] })],
      { erpLinks: new Map([[`${WCT}|I-1`, '-000100']]) },
    );
    expect(plan.orders.map((o) => o.orderNumber)).toEqual(['ORD-Q-000100']);
    expect(plan.disagreements).toEqual([
      { invoice: 'I-1', organizationId: WCT, used: { key: 100, source: 'erp_quotation_link' }, others: [{ key: 200, source: 'contract_no' }, { key: 200, source: 'line_text' }] },
    ]);
  });

  it('reads the WCT ERP credit-note export amount by org + invoice no. (WCT invoices carry no amount)', () => {
    const plan = planImportedOrders([quote('q1', 'Q-000100', WCT, { totalWithTax: 500 }), invoice('i1', 'I-1', { source: 'wct-erp', contractNo: '-000100 - x' })], {
      creditsByInvoiceNo: new Map([[`${WCT}|I-1`, 500]]),
    });
    expect(plan.orders[0].status).toMatchObject({ status: 'PART_BILLED', label: 'Part billed', billed: 0, credited: 500 });
  });
});

describe('imported orders: status rules (tax inclusive on both sides)', () => {
  const inv = (gross: number, owed: number | null, paid = 0, extra: any = {}) => ({ status: owed === 0 ? 'paid' : 'pending_payment', config: { totalWithTax: gross, ...(owed == null ? {} : { outstandingBalance: owed }), paidToDate: paid, ...extra } });
  it('fully billed and all paid = Paid; exactly equal and over-billed count as fully billed', () => {
    expect(importedOrderStatus([inv(1090, 0, 1090)], 1090)).toMatchObject({ status: 'PAID', label: 'Paid', billed: 1090 });
    expect(importedOrderStatus([inv(600, 0, 600), inv(600, 0, 600)], 1090)).toMatchObject({ status: 'PAID', billed: 1200 });
    // one cent short is still billed in full (rounding)
    expect(importedOrderStatus([inv(1089.99, 0, 1089.99)], 1090).status).toBe('PAID');
  });
  it('fully billed, not all paid = Invoiced / Invoiced, part paid', () => {
    expect(importedOrderStatus([inv(500, 0, 500), inv(590, 590)], 1090)).toMatchObject({ status: 'INVOICED', label: 'Invoiced, part paid', owed: 590 });
    expect(importedOrderStatus([inv(1090, 1090)], 1090)).toMatchObject({ status: 'INVOICED', label: 'Invoiced', partPaid: false });
    expect(importedOrderStatus([inv(1090, 400, 690)], 1090)).toMatchObject({ status: 'INVOICED', label: 'Invoiced, part paid' });
  });
  it('billed less than the quotation = Part billed, with paid / part paid / unpaid', () => {
    expect(importedOrderStatus([inv(545, 0, 545)], 1090)).toMatchObject({ status: 'PART_BILLED', label: 'Part billed, paid' });
    expect(importedOrderStatus([inv(545, 545)], 1090)).toMatchObject({ status: 'PART_BILLED', label: 'Part billed, unpaid' });
    expect(importedOrderStatus([inv(545, 0, 545), inv(300, 300)], 1090)).toMatchObject({ status: 'PART_BILLED', label: 'Part billed, part paid' });
  });
  it('$0 invoices never count as billing; only $0 invoices = Part billed', () => {
    expect(importedOrderStatus([inv(0, 0), inv(0, 0)], 1090)).toMatchObject({ status: 'PART_BILLED', label: 'Part billed', billed: 0 });
    expect(importedOrderStatus([inv(0, 0), inv(1090, 0, 1090)], 1090).status).toBe('PAID');
  });
  it('a quotation with no total or 0: billed in full once anything is billed', () => {
    expect(importedOrderStatus([inv(200, 0, 200)], null).status).toBe('PAID');
    expect(importedOrderStatus([inv(200, 200)], 0).status).toBe('INVOICED');
    expect(importedOrderStatus([inv(0, 0)], null).status).toBe('PART_BILLED');
  });
  it('credited: a fully credited invoice bills nothing and is marked Credited; the rest decides', () => {
    // Paid 1,090 + a 300 invoice fully credited: still fully billed and paid.
    expect(importedOrderStatus([inv(1090, 0, 1090), { ...inv(300, 0, 300), credit: 300 }], 1090)).toMatchObject({ status: 'PAID', billed: 1090, credited: 300 });
    // Only a credited invoice: nothing billed.
    expect(importedOrderStatus([{ ...inv(1090, 0, 1090), credit: 1090 }], 1090)).toMatchObject({ status: 'PART_BILLED', label: 'Part billed' });
    // Partly credited (9,400 - 5,400 = 4,000 billed) against a 4,000 quotation: Paid.
    expect(importedOrderStatus([{ ...inv(9400, 0, 9400), credit: 5400 }], 4000)).toMatchObject({ status: 'PAID', billed: 4000 });
    expect(importedInvoiceMoney(inv(300, 0, 300), 300).state).toBe('CREDITED');
    expect(importedInvoiceMoney(inv(9400, 0, 9400), 5400)).toMatchObject({ state: 'PAID', net: 4000, credit: 5400 });
    expect(importedInvoiceMoney(inv(0, 0), 0).state).toBe('NO_CHARGE');
    expect(importedInvoiceMoney(inv(100, 40, 60), 0).state).toBe('PART_PAID');
    expect(importedInvoiceMoney(inv(100, null), 0)).toMatchObject({ state: 'UNPAID', owed: 100 });
  });
  it('credit sources: tracker credit notes first, then CN documents, then the ERP export amount', () => {
    expect(creditOfImportedInvoice({ erpImport: { source: 't', creditNotes: [{ amount: 650 }] } }, [{ config: { totalWithTax: 999 } }], 1)).toBe(650);
    expect(creditOfImportedInvoice({ erpImport: { source: 't' } }, [{ config: { totalWithTax: 200 } }], 1)).toBe(200);
    expect(creditOfImportedInvoice({ erpImport: { source: 't' } }, [], 75)).toBe(75);
    expect(creditOfImportedInvoice({ erpImport: { source: 't' } })).toBe(0);
  });
  it('voided invoices are left out; a balance never stamped is owed in full; legacy xero* twins read', () => {
    expect(importedOrderStatus([inv(100, 0, 100), inv(100, 100, 0, { voided: true })], 100).status).toBe('PAID');
    expect(importedOrderStatus([inv(100, null)], 100).status).toBe('INVOICED');
    expect(importedOrderStatus([{ status: 'paid', config: { xeroGross: 50, xeroBalance: 0 } }], 50).status).toBe('PAID');
  });
});

describe('imported orders: numbering + tracker', () => {
  it('ORD-<quotation no.> can never be a native ORDER number', () => {
    expect(importedOrderNumber('Q-004533')).toBe('ORD-Q-004533');
    expect(isImportedOrderNumber('ORD-Q-004533')).toBe(true);
    const when = new Date('2026-11-18T00:00:00Z');
    for (const pattern of [DEFAULT_ORDER_PATTERN, '{DOC}{YYYY}{MM}-{###}', 'WR-{DOC}{YYYY}{MM}-{###}']) {
      for (const serial of [1, 17, 999, 123456]) {
        const native = DocumentNumberingService.format(pattern, serial, when, ORDER_DOC_CODE);
        expect(isImportedOrderNumber(native)).toBe(false);
        expect(native.startsWith('ORD-Q-')).toBe(false);
      }
    }
  });
  it('tracker: Quotation + Invoice done, DO and Service report not applicable, the ERP DO no. as text', () => {
    const t = importedTracker({ erpDoNumbers: ['DO010975'] }, { label: 'Invoiced, part paid' });
    expect(t.map((s) => [s.key, s.state, s.note])).toEqual([
      ['quotation', 'done', undefined],
      ['invoice', 'done', 'Invoiced, part paid'],
      ['do', 'na', 'ERP DO DO010975'],
      ['serviceReport', 'na', null],
    ]);
    expect(importedTracker({}, { label: 'Paid' })[2].note).toBeNull();
  });
});

// ── OrdersService with a mocked Prisma ──────────────────────────────────────
const marker = { source: IMPORTED_ORDER_SOURCE, batch: 'b', quotationNo: 'Q-000100', linkSources: { i1: 'contract_no' }, erpDoNumbers: ['DO1'], subject: 'Degreasing', site: 'Site', total: 500, quoteTotal: 500, credits: {}, at: 'x' };
const importedRow = {
  id: 'imp1',
  orderNumber: 'ORD-Q-000100',
  status: 'INVOICED',
  createdAt: new Date('2024-05-02T01:00:00Z'),
  customer: { id: 'c1', name: 'Cust', customerCode: 'C1' },
  sourceQuotation: { id: 'q1', name: 'Q-000100', status: 'confirmed', type: 'QUOTATION', documentTemplateId: 't', config: { date: '2024-05-02', totalWithTax: 1000 } },
  linkedDocuments: { po: [], do: [], salesOrder: [], invoice: [{ id: 'i1', name: 'I-1', templateId: 't', total: 500 }], creditNote: [], imported: marker },
};
const nativeRow = { id: 'n1', orderNumber: 'ORD202611-003', status: 'DO_DRAFT', createdAt: new Date(), linkedDocuments: { po: [], do: [], invoice: [] }, customer: null, sourceQuotation: null, deliveries: [] };

function svcWith(features: Record<string, unknown>, orders: any[]) {
  const writes: any[] = [];
  const matches = (o: any, where: any): boolean => {
    if (!where) return true;
    if (where.id && o.id !== where.id) return false;
    if (where.orderNumber?.startsWith && !String(o.orderNumber).startsWith(where.orderNumber.startsWith)) return false;
    if (where.NOT?.orderNumber?.startsWith && String(o.orderNumber).startsWith(where.NOT.orderNumber.startsWith)) return false;
    return true;
  };
  const prisma: any = {
    organizationUIConfig: { findUnique: jest.fn(async () => ({ features })) },
    order: {
      findMany: jest.fn(async ({ where }: any) => orders.filter((o) => matches(o, where))),
      findFirst: jest.fn(async ({ where }: any) => orders.find((o) => matches(o, where)) ?? null),
      update: jest.fn(async (a: any) => writes.push(['order.update', a])),
      delete: jest.fn(async (a: any) => writes.push(['order.delete', a])),
    },
    delivery: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    document: {
      findMany: jest.fn(async ({ where }: any) => [
        { id: 'i1', name: 'I-1', type: 'INVOICE', status: 'pending_payment', documentTemplateId: 't', config: { totalWithTax: 500, outstandingBalance: 200, paidToDate: 300, erpImport: { ourDoNo: 'DO1' } } },
        { id: 'q1', name: 'Q-000100', type: 'QUOTATION', status: 'confirmed', documentTemplateId: 't', config: { totalWithTax: 1000 } },
      ].filter((d) => !where?.id?.in || where.id.in.includes(d.id))),
      update: jest.fn(async (a: any) => writes.push(['document.update', a])),
    },
    maintenanceServiceReport: { findMany: jest.fn(async () => []) },
    deliverySiteClockJob: { findMany: jest.fn(async () => []) },
    documentNumberFormat: { findFirst: jest.fn(async () => null) },
  };
  return { svc: new OrdersService(prisma, {} as any, {} as any), prisma, writes };
}

describe('imported orders: OrdersService', () => {
  it('setting off: the list leaves imported orders out (other orgs and native orders unchanged)', async () => {
    const { svc, prisma } = svcWith({}, [nativeRow, importedRow]);
    const out: any[] = (await svc.list('org')) as any[];
    expect(out.map((o) => o.id)).toEqual(['n1']);
    expect(prisma.order.findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org', NOT: { orderNumber: { startsWith: 'ORD-Q-' } } });
    expect(prisma.document.update).not.toHaveBeenCalled();
  });

  it('setting on (WCT orders): imported rows after the native ones, read-only, status from the invoices', async () => {
    const { svc, prisma, writes } = svcWith({ enableWctOrders: true, enableImportedOrders: true }, [importedRow]);
    const out: any[] = (await svc.list('org')) as any[];
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'imp1', imported: true, status: 'INVOICED', statusLabel: 'Invoiced, part paid', deliveryOrders: [], erpDoNumbers: ['DO1'], amount: 500, subject: 'Degreasing' });
    expect(out[0].invoices.map((i: any) => i.name)).toEqual(['I-1']);
    expect(prisma.document.update).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('order page: tracker without DO / service report, nothing to act on; setting off = not found', async () => {
    const on = svcWith({ enableWctOrders: true, enableImportedOrders: true }, [importedRow]);
    const page: any = await on.svc.getById('imp1', 'org');
    expect(page).toMatchObject({ imported: true, readOnly: true, status: 'INVOICED', jobs: [], deliveryOrders: [], erpDoNumbers: ['DO1'], owed: 200 });
    expect(page.tracker.map((s: any) => s.state)).toEqual(['done', 'done', 'na', 'na']);
    expect(page.invoices[0]).toMatchObject({ name: 'I-1', linkSource: 'contract_no', erpDoNumber: 'DO1', owed: 200, state: 'PART_PAID', stateLabel: 'Part paid' });
    expect(page).toMatchObject({ billed: 500, quoteTotal: 500, statusLabel: 'Invoiced, part paid' });
    const off = svcWith({ enableWctOrders: true }, [importedRow]);
    await expect(off.svc.getById('imp1', 'org')).rejects.toThrow(/not found/i);
  });

  it('part billed: invoiced less than the quotation (marker without quoteTotal falls back to the quotation); credited invoice row', async () => {
    const row = { ...importedRow, linkedDocuments: { ...importedRow.linkedDocuments, imported: { ...marker, quoteTotal: undefined, credits: { i1: 100 } } } };
    const { svc } = svcWith({ enableWctOrders: true, enableImportedOrders: true }, [row]);
    const page: any = await svc.getById('imp1', 'org');
    expect(page).toMatchObject({ status: 'PART_BILLED', statusLabel: 'Part billed, part paid', quoteTotal: 1000, billed: 400, credited: 100 });
    expect(page.invoices[0]).toMatchObject({ state: 'PART_PAID', credit: 100 });
    const list: any[] = (await svc.list('org')) as any[];
    expect(list[0]).toMatchObject({ status: 'PART_BILLED', statusLabel: 'Part billed, part paid' });
  });

  it('a paid order flips to Paid on read when the money says so (order row only, documents never written)', async () => {
    const { svc, prisma, writes } = svcWith({ enableWctOrders: true, enableImportedOrders: true }, [importedRow]);
    prisma.document.findMany.mockResolvedValue([{ id: 'i1', name: 'I-1', type: 'INVOICE', status: 'paid', documentTemplateId: 't', config: { totalWithTax: 500, outstandingBalance: 0, paidToDate: 500 } }]);
    const page: any = await svc.getById('imp1', 'org');
    expect(page.status).toBe('PAID');
    expect(writes).toEqual([['order.update', { where: { id: 'imp1' }, data: { status: 'PAID' } }]]);
    expect(prisma.document.update).not.toHaveBeenCalled();
  });

  it('server refuses cancel, edit, link, attach, status and delete on an imported order (setting on or off)', async () => {
    for (const features of [{ enableWctOrders: true, enableImportedOrders: true }, { enableWctOrders: true }]) {
      const { svc, writes } = svcWith(features, [importedRow]);
      await expect(svc.cancelWctOrder('imp1', 'org')).rejects.toThrow(/imported from the old ERP/);
      await expect(svc.updateStatus('imp1', 'org', 'PAID')).rejects.toThrow(/read-only/);
      await expect(svc.updateItems('imp1', 'org', [])).rejects.toThrow(/read-only/);
      await expect(svc.linkDocument('imp1', 'org', 'do', { id: 'd', name: 'DO' })).rejects.toThrow(/read-only/);
      await expect(svc.addOrderAttachment('imp1', 'org', { kind: 'file', fileKey: 'k' }, {})).rejects.toThrow(/read-only/);
      await expect(svc.delete('imp1', 'org')).rejects.toThrow(/read-only/);
      expect(writes).toEqual([]);
    }
  });

  it('assertNotImportedOrder lets a native order through', async () => {
    const prisma: any = { order: { findFirst: jest.fn(async () => nativeRow) } };
    await expect(assertNotImportedOrder(prisma, 'org', 'n1')).resolves.toBeUndefined();
    await expect(assertNotImportedOrder(prisma, 'org', null)).resolves.toBeUndefined();
    prisma.order.findFirst.mockResolvedValue(importedRow);
    await expect(assertNotImportedOrder(prisma, 'org', 'imp1')).rejects.toThrow(/read-only/);
  });
});
