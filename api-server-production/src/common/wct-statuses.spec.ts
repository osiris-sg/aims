import { WCT_STATUS_OPTIONS, wctFamilyOfTypes, wctStatusOf } from './wct-statuses';
import { DocumentsService } from '../documents/documents.service';

// WCT group status set (Elroy 2026-11-19): display + filters only; stored statuses unchanged; other orgs untouched.
const T = '2026-11-19';
const st = (type: string, status: string, config: any = {}, creditFromNotes = 0) => wctStatusOf({ type, status, config, creditFromNotes, today: T });
const erp = (status: string, extra: any = {}) => ({ erpImport: { source: 'wct-erp', status, ...extra } });

describe('wctStatusOf', () => {
  it('DOs: Draft / Completed / Cancelled; every stored status maps (no data loss)', () => {
    expect(['draft', 'unconfirmed', 'confirmed', 'pending_delivery', 'pending_payment', 'pending_return'].map((s) => st('DELIVERY_ORDER', s))).toEqual(Array(6).fill('draft'));
    expect(['delivered_not_installed', 'delivered_installed', 'returned', 'paid'].map((s) => st('DELIVERY_ORDER', s))).toEqual(Array(4).fill('completed'));
    expect(st('DELIVERY_ORDER', 'delivered_installed', { erpImport: { source: 'wct-erp', kind: 'DELIVERY_ORDER', status: 'Issued', done: true } })).toBe('completed');
    expect(st('DO', 'unconfirmed', { cancelled: true })).toBe('cancelled');
    expect(st('DELIVERY_ORDER', 'delivered_installed', { voided: true })).toBe('cancelled');
  });
  it('quotations: Unconfirmed (incl. ERP draft / sent), Confirmed, Cancelled, Declined', () => {
    expect(st('QUOTATION', 'unconfirmed')).toBe('unconfirmed');
    expect(st('QUOTATION', 'draft')).toBe('unconfirmed');
    expect(st('QUOTATION', 'confirmed', erp('Draft'))).toBe('unconfirmed');
    expect(st('QUOTATION', 'confirmed', erp('Sent'))).toBe('unconfirmed');
    expect(st('QUOTATION', 'confirmed', erp('Accepted'))).toBe('confirmed');
    expect(st('QUOTATION', 'confirmed')).toBe('confirmed');
    expect(st('QUOTATION', 'confirmed', erp('Declined'))).toBe('declined');
    expect(st('QUOTATION', 'confirmed', erp('Cancelled', { statusAtFirstImport: 'Sent' }))).toBe('cancelled');
    expect(st('QUOTATION', 'confirmed', { cancelled: true })).toBe('cancelled');
    // Another importer's marker is not the WCT ERP.
    expect(st('QUOTATION', 'confirmed', { erpImport: { source: 'other', status: 'Declined' } })).toBe('confirmed');
  });
  it('invoices: Draft, Unpaid, Part paid, Paid, Overdue, Credited, Voided', () => {
    expect(st('INVOICE', 'unconfirmed')).toBe('draft');
    expect(st('INVOICE', 'pending_payment', { totalWithTax: 100, dueDate: '2026-12-01' })).toBe('unpaid');
    expect(st('INVOICE', 'confirmed', { totalWithTax: 100, dueDate: '2026-12-01' })).toBe('unpaid');
    expect(st('INVOICE', 'pending_payment', { totalWithTax: 100, paidToDate: 40, outstandingBalance: 60, dueDate: '2026-12-01' })).toBe('part_paid');
    expect(st('INVOICE', 'pending_payment', { totalWithTax: 100, outstandingBalance: 100, dueDate: '2026-11-01' })).toBe('overdue');
    // Still owed past its due date, part paid or not: Overdue.
    expect(st('INVOICE', 'pending_payment', { totalWithTax: 100, paidToDate: 40, outstandingBalance: 60, dueDate: '2026-11-01' })).toBe('overdue');
    expect(st('INVOICE', 'paid', { totalWithTax: 100 })).toBe('paid');
    expect(st('INVOICE', 'pending_payment', { totalWithTax: 100, outstandingBalance: 0, paidToDate: 100 })).toBe('paid');
    expect(st('INVOICE', 'paid', { totalWithTax: 100, ...erp('Paid', { creditNotes: [{ amount: 100 }] }) })).toBe('credited');
    expect(st('INVOICE', 'pending_payment', { totalWithTax: 100 }, 100)).toBe('credited');
    expect(st('INVOICE', 'pending_payment', { totalWithTax: 100, dueDate: '2026-12-01' }, 30)).toBe('unpaid');
    expect(st('INVOICE', 'pending_payment', { voided: true })).toBe('voided');
    expect(st('INVOICE', 'paid', { totalWithTax: 0, ...erp('Cancelled') })).toBe('voided');
    // Never stamped (outstanding null) = owed in full.
    expect(st('INVOICE', 'pending_payment', { totalWithTax: 100, dueDate: '2026-12-01' })).toBe('unpaid');
  });
  it('other types: none; a list mixing families: none', () => {
    expect(st('CREDIT_NOTE', 'confirmed')).toBeNull();
    expect(wctFamilyOfTypes(['INVOICE', 'TI'])).toBe('INVOICE');
    expect(wctFamilyOfTypes(['INVOICE', 'QUOTATION'])).toBeNull();
    expect(wctFamilyOfTypes([])).toBeNull();
    expect(WCT_STATUS_OPTIONS.INVOICE.map((o) => o.label)).toEqual(['Draft', 'Unpaid', 'Part paid', 'Paid', 'Overdue', 'Credited', 'Voided']);
    expect(WCT_STATUS_OPTIONS.DO.map((o) => o.label)).toEqual(['Draft', 'Completed', 'Cancelled']);
    expect(WCT_STATUS_OPTIONS.QUOTATION.map((o) => o.label)).toEqual(['Unconfirmed', 'Confirmed', 'Cancelled', 'Declined']);
  });
});

describe('document list with the WCT status set', () => {
  const DOCS = [
    { id: 'i1', type: 'INVOICE', status: 'pending_payment', config: { totalWithTax: 100, dueDate: '2020-01-01' } },
    { id: 'i2', type: 'INVOICE', status: 'paid', config: { totalWithTax: 100 } },
    { id: 'i3', type: 'INVOICE', status: 'paid', config: { totalWithTax: 50 } },
  ];
  function svcWith(flag: boolean) {
    const findMany = jest.fn(async () => []);
    const prisma: any = {
      organizationUIConfig: { findUnique: jest.fn(async () => ({ features: { enableWctStatuses: flag } })) },
      $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
        const q = strings.join('');
        if (q.includes('jsonb_build_object')) return DOCS;
        return [];
      }),
      document: { findMany, count: jest.fn(async () => 0) },
      customer: { findMany: jest.fn(async () => []) },
      project: { findMany: jest.fn(async () => []) },
      order: { findMany: jest.fn(async () => []) },
    };
    const svc: any = Object.create(DocumentsService.prototype);
    svc.prisma = prisma;
    return { svc, findMany };
  }
  const whereOf = (fm: jest.Mock) => (fm.mock.calls[0] as any)[0].where;
  it('flag on: Overdue / Paid filter by the WCT rule (the smaller id list)', async () => {
    const a = svcWith(true);
    await a.svc.getDocumentsPaginated('org', { documentTypes: ['INVOICE'], status: 'overdue' });
    expect(whereOf(a.findMany)).toEqual({ organizationId: 'org', type: { in: ['INVOICE'] }, AND: [{ id: { in: ['i1'] } }] });
    const b = svcWith(true);
    await b.svc.getDocumentsPaginated('org', { documentTypes: ['INVOICE'], status: 'paid' });
    expect(whereOf(b.findMany)).toEqual({ organizationId: 'org', type: { in: ['INVOICE'] }, AND: [{ id: { notIn: ['i1'] } }] });
  });
  it('flag off (every other org): the stored-status filter exactly as before', async () => {
    const { svc, findMany } = svcWith(false);
    await svc.getDocumentsPaginated('org', { documentTypes: ['INVOICE'], status: 'paid' });
    expect(whereOf(findMany)).toEqual({ organizationId: 'org', type: { in: ['INVOICE'] }, status: 'paid' });
  });
  it('flag on, an old status value (not a WCT one): falls back to the stored-status filter', async () => {
    const { svc, findMany } = svcWith(true);
    await svc.getDocumentsPaginated('org', { documentTypes: ['INVOICE'], status: 'pending_delivery' });
    expect(whereOf(findMany)).toEqual({ organizationId: 'org', type: { in: ['INVOICE'] }, status: 'pending_delivery' });
  });
});
