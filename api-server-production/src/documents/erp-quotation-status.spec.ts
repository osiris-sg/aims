import { DocumentsService } from './documents.service';
import { erpQuotationDisplayStatus, erpQuotationTag } from '../common/erp-import';
import { quotationStatus } from '../sales-report/sales-report';

// WCT imported quotations (Elroy 2026-11-19): ERP Draft / Sent read as Unconfirmed in the list, the status
// filter and the Unconfirmed card; the stored status stays confirmed (locked). Other orgs: no wct-erp rows.
const q = (status: string, extra: any = {}) => ({ erpImport: { source: 'wct-erp', batch: 'b', erpId: '1', status, ...extra } });

describe('erpQuotationDisplayStatus', () => {
  it('Draft / Sent = unconfirmed with a tag; Accepted = stored; cancelled since import = cancelled', () => {
    expect(erpQuotationDisplayStatus('QUOTATION', q('Draft'))).toBe('unconfirmed');
    expect(erpQuotationTag('QUOTATION', q('Draft'))).toBe('ERP draft');
    expect(erpQuotationTag('QUOTATION', q('Sent'))).toBe('ERP sent');
    expect(erpQuotationDisplayStatus('QUOTATION', q('Accepted', { statusAtFirstImport: 'Draft' }))).toBeNull();
    expect(erpQuotationDisplayStatus('QUOTATION', q('Cancelled', { statusAtFirstImport: 'Sent' }))).toBe('cancelled');
  });
  it('unchanged: imported as Declined, other sources, other types, native', () => {
    expect(erpQuotationDisplayStatus('QUOTATION', q('Declined'))).toBeNull();
    expect(erpQuotationDisplayStatus('QUOTATION', { erpImport: { source: 'xero', status: 'Draft' } })).toBeNull();
    expect(erpQuotationDisplayStatus('INVOICE', q('Draft'))).toBeNull();
    expect(erpQuotationDisplayStatus('QUOTATION', {})).toBeNull();
    expect(erpQuotationTag('QUOTATION', {})).toBeNull();
  });
  it('Sales report: ERP Draft / Sent are Pending, Accepted Signed, Cancelled Cancelled (as before)', () => {
    expect(quotationStatus({ status: 'confirmed', imported: true, erpStatus: 'Draft' })).toBe('Pending');
    expect(quotationStatus({ status: 'confirmed', imported: true, erpStatus: 'Sent' })).toBe('Pending');
    expect(quotationStatus({ status: 'confirmed', imported: true, erpStatus: 'Accepted' })).toBe('Signed');
    expect(quotationStatus({ status: 'confirmed', imported: true, erpStatus: 'Cancelled' })).toBe('Cancelled');
  });
});

function svcWith(rows: Array<{ id: string; status: string | null; first: string | null }>) {
  const findMany = jest.fn(async () => []);
  const count = jest.fn(async ({ where }: any) => (where?.AND ? 2 : where?.status ? 5 : 100));
  const prisma: any = { $queryRaw: jest.fn(async (strings: TemplateStringsArray) => (strings.join('').includes('erpImport,source') ? rows : [])), document: { findMany, count }, customer: { findMany: jest.fn(async () => []) }, order: { findMany: jest.fn(async () => []) }, project: { findMany: jest.fn(async () => []) } };
  const svc: any = Object.create(DocumentsService.prototype);
  svc.prisma = prisma;
  return { svc, findMany, count, prisma };
}
const whereOf = (fm: jest.Mock) => (fm.mock.calls[0] as any)[0].where;

describe('quotation list filter and Unconfirmed card', () => {
  const ERP = [{ id: 'd1', status: 'draft', first: null }, { id: 's1', status: 'sent', first: null }, { id: 'c1', status: 'cancelled', first: 'sent' }];
  it('Unconfirmed: stored unconfirmed (not the ERP ones) OR the ERP-open ones', async () => {
    const { svc, findMany } = svcWith(ERP);
    await svc.getDocumentsPaginated('org', { documentTypes: ['QUOTATION'], status: 'unconfirmed' });
    expect(whereOf(findMany)).toEqual({ organizationId: 'org', type: { in: ['QUOTATION'] }, AND: [{ OR: [{ AND: [{ status: 'unconfirmed' }, { id: { notIn: ['d1', 's1', 'c1'] } }] }, { id: { in: ['d1', 's1'] } }] }] });
  });
  it('Confirmed: the ERP-open and ERP-cancelled ones are left out', async () => {
    const { svc, findMany } = svcWith(ERP);
    await svc.getDocumentsPaginated('org', { documentTypes: ['QUOTATION'], status: 'confirmed' });
    expect(whereOf(findMany)).toEqual({ organizationId: 'org', type: { in: ['QUOTATION'] }, AND: [{ OR: [{ AND: [{ status: 'confirmed' }, { id: { notIn: ['d1', 's1', 'c1'] } }] }] }] });
  });
  it('no ERP-open quotations (every other org): the filter is exactly as before', async () => {
    const { svc, findMany } = svcWith([]);
    await svc.getDocumentsPaginated('org', { documentTypes: ['QUOTATION'], status: 'unconfirmed' });
    expect(whereOf(findMany)).toEqual({ organizationId: 'org', type: { in: ['QUOTATION'] }, status: 'unconfirmed' });
  });
  it('invoice lists never ask', async () => {
    const { svc, prisma } = svcWith(ERP);
    expect(await svc.erpQuotationDisplayIds('org', ['INVOICE'])).toEqual({ unconfirmed: [], cancelled: [] });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('the Unconfirmed card adds the ERP-open quotations; none = as before', async () => {
    const a = svcWith(ERP);
    expect(await a.svc.getDocumentStats('org', { documentTypes: ['QUOTATION'] })).toEqual({ total: 100, thisMonth: 100, drafts: 7 });
    const b = svcWith([]);
    expect(await b.svc.getDocumentStats('org', { documentTypes: ['QUOTATION'] })).toEqual({ total: 100, thisMonth: 100, drafts: 5 });
  });
});
