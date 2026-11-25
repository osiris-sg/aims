import {
  IMPORTED_ORDER_SOURCE,
  importedStatusFrom,
  isNgPlaceholderMarked,
  loadImportedOrderInputs,
  ngPlaceholderMarker,
  planImportedOrders,
  type PlanDoc,
} from './imported-orders';

// Moved "(NG)" $1 placeholders (WCT group, owner 2026-11-25): on the order, never counted.
const BC = 'org-bcair';
const quote = (id: string, name: string, total = 1000): PlanDoc => ({ id, organizationId: BC, type: 'QUOTATION', name, status: 'confirmed', config: { customerId: 'c1', date: '2024-05-02', totalWithTax: total, erpImport: { source: 'wct-erp', status: 'Accepted' } } });
const inv = (id: string, name: string, total: number, over: any = {}): PlanDoc => ({
  id,
  organizationId: BC,
  type: 'INVOICE',
  name,
  status: 'paid',
  config: { customerId: 'c1', date: '2024-06-01', totalWithTax: total, outstandingBalance: 0, paidToDate: total, erpImport: { source: 'wct-erp', status: 'Paid' }, ...over },
});
const mark = { ngPlaceholder: ngPlaceholderMarker({ amount: 1.08, fromOrgId: 'org-wct', number: 'I-008260', at: '2026-11-25T00:00:00.000Z' }) };

describe('moved "(NG)" placeholder marker', () => {
  it('is read from config.ngPlaceholder only', () => {
    expect(isNgPlaceholderMarked({ config: mark })).toBe(true);
    expect(isNgPlaceholderMarked({ config: { ngPlaceholder: true } })).toBe(true);
    for (const c of [{}, { ngPlaceholder: false }, { ngPlaceholder: [] }, { ngPlaceholder: 'yes' }, null]) expect(isNgPlaceholderMarked({ config: c })).toBe(false);
    expect(isNgPlaceholderMarked(null)).toBe(false);
  });
});

describe('order maths skip moved placeholders', () => {
  const docs = new Map<string, any>([
    ['i1', inv('i1', 'I000500', 1000)],
    ['p1', inv('p1', 'I-008260', 1.08, mark)],
  ]);
  const prisma = { document: { findMany: async ({ where }: any) => (where.id.in as string[]).map((id) => docs.get(id)).filter(Boolean) } };
  const order = (ids: string[]) => ({
    id: 'o1',
    sourceQuotationId: 'q1',
    linkedDocuments: { invoice: ids.map((id) => ({ id, name: docs.get(id).name, total: docs.get(id).config.totalWithTax, ...(id === 'p1' ? { placeholder: true } : {}) })), imported: { source: IMPORTED_ORDER_SOURCE, quoteTotal: 1000, partBilledRule: true } },
  });

  it('a placeholder on the order is shown (placeholder list), not billed', async () => {
    const o = order(['i1', 'p1']);
    const inputs = (await loadImportedOrderInputs(prisma, BC, [o])).get('o1')!;
    expect(inputs.invoiceDocs.map((d) => d.id)).toEqual(['i1']);
    expect(inputs.crossPlaceholderDocs!.map((d) => d.id)).toEqual(['p1']);
    expect(importedStatusFrom(o, inputs)).toMatchObject({ status: 'PAID', billed: 1000, quoteTotal: 1000 });
  });

  it('an order holding only a placeholder keeps its DO / nothing-billed status (not Part billed)', async () => {
    const o: any = order(['p1']);
    o.linkedDocuments.do = [{ name: 'DO010004', imported: true, done: true }];
    const inputs = (await loadImportedOrderInputs(prisma, BC, [o], { orderDos: new Map() })).get('o1')!;
    expect(inputs.invoiceDocs).toEqual([]);
    expect(importedStatusFrom(o, inputs)).toMatchObject({ status: 'DO_COMPLETED', billed: 0 });
  });

  it('the same invoice unmarked would count (the marker is what keeps it out)', async () => {
    docs.set('p2', inv('p2', 'I-008261', 1.08));
    const o = { ...order(['i1']), linkedDocuments: { ...order(['i1']).linkedDocuments, invoice: [{ id: 'i1' }, { id: 'p2' }] } };
    const inputs = (await loadImportedOrderInputs(prisma, BC, [o])).get('o1')!;
    expect(inputs.invoiceDocs.map((d) => d.id)).toEqual(['i1', 'p2']);
  });
});

describe('the weekly import never links or counts a moved placeholder', () => {
  it('no new order for a quotation whose only invoice is a moved placeholder', () => {
    const plan = planImportedOrders([quote('q1', 'Q-000100'), inv('p1', 'I-1', 1, { ...mark, erpImport: { source: 'wct-erp', status: 'Paid', contractNo: '-000100 - x' } })]);
    expect(plan.orders).toEqual([]);
  });
  it('a placeholder already on an order is kept but not counted in the top-up', () => {
    const ex: any = {
      id: 'o1',
      orderNumber: 'ORD-Q-000100',
      organizationId: BC,
      status: 'PAID',
      sourceQuotationId: 'q1',
      linkedDocuments: { po: [], do: [], salesOrder: [], creditNote: [], invoice: [{ id: 'i1', name: 'I-2', total: 1000 }, { id: 'p1', name: 'I-1', total: 1, placeholder: true }], imported: { source: IMPORTED_ORDER_SOURCE, partBilledRule: true, billed: 1000, billedPct: 100, quoteTotal: 1000, credits: {}, linkSources: { i1: 'contract_no', p1: 'moved-from-wct' } } },
    };
    const docs = [quote('q1', 'Q-000100'), inv('i1', 'I-2', 1000, { erpImport: { source: 'wct-erp', status: 'Paid', contractNo: '-000100 - x' } }), inv('p1', 'I-1', 1, mark)];
    const plan = planImportedOrders(docs, { existingImported: new Map([['q1', ex]]), quotationIdsWithOrder: new Set(['q1']) });
    expect(plan.updates).toEqual([]);
    expect(plan.orders).toEqual([]);
  });
});
