import { DocumentNumberingService, DEFAULT_ORDER_PATTERN, ORDER_DOC_CODE } from '../document-numbering/document-numbering.service';
import { OrdersService } from './orders.service';
import {
  IMPORTED_ORDER_SOURCE,
  assertNotImportedOrder,
  erpQuoteKey,
  importedOrderNumber,
  importedOrderStatus,
  importedTracker,
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
    expect(plan.orders[0].status).toMatchObject({ status: 'PAID', total: 500, owed: 0 });
  });
});

describe('imported orders: status from document money', () => {
  const inv = (cfg: any, status = 'pending_payment') => ({ status, config: { totalWithTax: 100, ...cfg } });
  it('Paid when every invoice owes nothing (payments or credit notes), else Invoiced', () => {
    expect(importedOrderStatus([inv({ outstandingBalance: 0, paidToDate: 100 }, 'paid'), inv({ outstandingBalance: 0, paidToDate: 60 }, 'paid')]).status).toBe('PAID');
    expect(importedOrderStatus([inv({ outstandingBalance: 0, paidToDate: 100 }, 'paid'), inv({ outstandingBalance: 100, paidToDate: 0 })])).toMatchObject({ status: 'INVOICED', partPaid: false, total: 200, owed: 100 });
    expect(importedOrderStatus([inv({ outstandingBalance: 40, paidToDate: 60 })])).toMatchObject({ status: 'INVOICED', partPaid: true });
  });
  it('a balance never stamped is owed in full (never read as zero); a voided invoice is left out', () => {
    expect(importedOrderStatus([inv({})]).status).toBe('INVOICED');
    expect(importedOrderStatus([inv({ outstandingBalance: 0 }, 'paid'), inv({ voided: true, outstandingBalance: 100 })]).status).toBe('PAID');
  });
  it('reads legacy xero* twins through document-money', () => {
    expect(importedOrderStatus([{ status: 'paid', config: { xeroGross: 50, xeroBalance: 0 } }]).status).toBe('PAID');
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
    const t = importedTracker({ erpDoNumbers: ['DO010975'] }, { status: 'INVOICED', partPaid: true });
    expect(t.map((s) => [s.key, s.state, s.note])).toEqual([
      ['quotation', 'done', undefined],
      ['invoice', 'done', 'Invoiced, part paid'],
      ['do', 'na', 'ERP DO DO010975'],
      ['serviceReport', 'na', null],
    ]);
    expect(importedTracker({}, { status: 'PAID', partPaid: false })[2].note).toBeNull();
  });
});

// ── OrdersService with a mocked Prisma ──────────────────────────────────────
const marker = { source: IMPORTED_ORDER_SOURCE, batch: 'b', quotationNo: 'Q-000100', linkSources: { i1: 'contract_no' }, erpDoNumbers: ['DO1'], subject: 'Degreasing', site: 'Site', total: 500, at: 'x' };
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
      findMany: jest.fn(async () => [{ id: 'i1', name: 'I-1', type: 'INVOICE', status: 'pending_payment', documentTemplateId: 't', config: { totalWithTax: 500, outstandingBalance: 200, paidToDate: 300, erpImport: { ourDoNo: 'DO1' } } }]),
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
    expect(page.invoices[0]).toMatchObject({ name: 'I-1', linkSource: 'contract_no', erpDoNumber: 'DO1', owed: 200 });
    const off = svcWith({ enableWctOrders: true }, [importedRow]);
    await expect(off.svc.getById('imp1', 'org')).rejects.toThrow(/not found/i);
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
