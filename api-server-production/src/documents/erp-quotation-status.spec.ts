import { DocumentsService } from './documents.service';
import { erpDraftExpiryCut, erpQuotationDisplayStatus, erpQuotationTag, erpSgToday } from '../common/erp-import';
import { quotationStatus, summarise } from '../sales-report/sales-report';
import { wctStatusOf } from '../common/wct-statuses';

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
  it('owner-confirmed in AIMS while the ERP has it open: stored Confirmed, no tag; a later ERP cancel still reads Cancelled', () => {
    const oc = { ownerConfirmed: { at: '2026-11-19', by: 'Elroy' } };
    expect(erpQuotationDisplayStatus('QUOTATION', q('Draft', oc))).toBeNull();
    expect(erpQuotationTag('QUOTATION', q('Draft', oc))).toBeNull();
    expect(erpQuotationDisplayStatus('QUOTATION', q('Sent', oc))).toBeNull();
    expect(erpQuotationDisplayStatus('QUOTATION', q('Cancelled', { ...oc, statusAtFirstImport: 'Draft' }))).toBe('cancelled');
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
    expect(await svc.erpQuotationDisplayIds('org', ['INVOICE'])).toEqual({ unconfirmed: [], cancelled: [], expired: [] });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('the Unconfirmed card adds the ERP-open quotations; none = as before', async () => {
    const a = svcWith(ERP);
    expect(await a.svc.getDocumentStats('org', { documentTypes: ['QUOTATION'] })).toEqual({ total: 100, thisMonth: 100, drafts: 7 });
    const b = svcWith([]);
    expect(await b.svc.getDocumentStats('org', { documentTypes: ['QUOTATION'] })).toEqual({ total: 100, thisMonth: 100, drafts: 5 });
  });
});

// Round 35 (Elroy 2026-11-19): an ERP Draft / Sent quotation dated MORE than 6 months before today reads "Expired"
// (tag "ERP draft"): never Unconfirmed / Pending. Within 6 months: Unconfirmed as before.
describe('round 35: expired ERP drafts', () => {
  const TODAY = '2026-11-19';
  const dated = (status: string, date: string | null, extra: any = {}, top: any = {}) => ({ ...(date ? { date } : {}), ...top, erpImport: { source: 'wct-erp', batch: 'b', erpId: '1', status, ...extra } });
  const st = (cfg: any, opts: any = {}) => erpQuotationDisplayStatus('QUOTATION', cfg, { today: TODAY, ...opts });

  it('the cut: today minus 6 calendar months, day clamped like Postgres; "more than" = strictly before the cut', () => {
    expect(erpDraftExpiryCut('2026-11-19')).toBe('2026-05-19');
    expect(erpDraftExpiryCut('2026-08-31')).toBe('2026-02-28');
    expect(erpDraftExpiryCut('2026-03-31')).toBe('2025-09-30');
    expect(erpDraftExpiryCut('2028-08-31')).toBe('2028-02-29');
    expect(st(dated('Draft', '2026-05-19'))).toBe('unconfirmed');
    expect(st(dated('Draft', '2026-05-18'))).toBe('expired');
    expect(st(dated('Draft', '2017-10-03'))).toBe('expired');
    expect(st(dated('Draft', '2026-11-03'))).toBe('unconfirmed');
    expect(erpSgToday(new Date('2026-11-18T16:30:00Z'))).toBe('2026-11-19');
  });

  it('the date: config.date, else documentInfo.date, else the list date / created date; no date at all = not expired', () => {
    expect(st(dated('Draft', null, {}, { documentInfo: { date: '2025-01-02' } }))).toBe('expired');
    expect(st(dated('Draft', '2026-11-01', {}, { documentInfo: { date: '2025-01-02' } }))).toBe('unconfirmed');
    expect(st(dated('Draft', null), { listIssueDate: '2024-06-01' })).toBe('expired');
    expect(st(dated('Draft', null), { createdAt: new Date('2026-10-01T00:00:00Z') })).toBe('unconfirmed');
    expect(st(dated('Draft', null))).toBe('unconfirmed');
    expect(st(dated('Draft', '03/01/2025'))).toBe('expired');
  });

  it('Sent too; the tag stays "ERP draft" / "ERP sent"; ownerConfirmed wins (Confirmed); an ERP cancel since import reads Cancelled', () => {
    expect(st(dated('Sent', '2024-01-01'))).toBe('expired');
    expect(erpQuotationTag('QUOTATION', dated('Draft', '2024-01-01'), { today: TODAY })).toBe('ERP draft');
    expect(erpQuotationTag('QUOTATION', dated('Sent', '2024-01-01'), { today: TODAY })).toBe('ERP sent');
    expect(st(dated('Draft', '2024-01-01', { ownerConfirmed: { at: '2026-11-19' } }))).toBeNull();
    expect(erpQuotationTag('QUOTATION', dated('Draft', '2024-01-01', { ownerConfirmed: { at: '2026-11-19' } }), { today: TODAY })).toBeNull();
    expect(st(dated('Cancelled', '2024-01-01', { statusAtFirstImport: 'Draft' }))).toBe('cancelled');
    expect(st(dated('Accepted', '2017-01-01'))).toBeNull();
  });

  it('native quotations and other sources / types are unchanged', () => {
    expect(st({ date: '2017-01-01' })).toBeNull();
    expect(st({ date: '2017-01-01', erpImport: { source: 'xero', status: 'Draft' } })).toBeNull();
    expect(erpQuotationDisplayStatus('INVOICE', dated('Draft', '2017-01-01'), { today: TODAY })).toBeNull();
  });

  it('WCT status set: Expired / Unconfirmed / Confirmed (owner) for imported drafts; a native draft stays Unconfirmed', () => {
    const w = (cfg: any, status = 'confirmed') => wctStatusOf({ type: 'QUOTATION', status, config: cfg, today: TODAY });
    expect(w(dated('Draft', '2024-01-01'))).toBe('expired');
    expect(w(dated('Sent', '2026-10-01'))).toBe('unconfirmed');
    expect(w(dated('Draft', '2024-01-01', { ownerConfirmed: { at: 'x' } }))).toBe('confirmed');
    expect(w(dated('Declined', '2024-01-01'))).toBe('declined');
    expect(w({ date: '2017-01-01' }, 'draft')).toBe('unconfirmed');
    expect(w({ date: '2017-01-01' }, 'confirmed')).toBe('confirmed');
  });

  it('list filter: Unconfirmed never lists an expired draft, "expired" lists only them, Confirmed lists neither', async () => {
    const today = erpSgToday();
    const OLD = [
      { id: 'old', status: 'draft', first: null, cdate: '2017-03-01', idate: null, ldate: null, created: null },
      { id: 'new', status: 'draft', first: null, cdate: today, idate: null, ldate: null, created: null },
    ];
    const a = svcWith(OLD as any);
    expect(await a.svc.erpQuotationDisplayIds('org', ['QUOTATION'])).toEqual({ unconfirmed: ['new'], cancelled: [], expired: ['old'] });
    await a.svc.getDocumentsPaginated('org', { documentTypes: ['QUOTATION'], status: 'unconfirmed' });
    expect(whereOf(a.findMany)).toEqual({ organizationId: 'org', type: { in: ['QUOTATION'] }, AND: [{ OR: [{ AND: [{ status: 'unconfirmed' }, { id: { notIn: ['new', 'old'] } }] }, { id: { in: ['new'] } }] }] });
    const b = svcWith(OLD as any);
    await b.svc.getDocumentsPaginated('org', { documentTypes: ['QUOTATION'], status: 'expired' });
    expect(whereOf(b.findMany)).toEqual({ organizationId: 'org', type: { in: ['QUOTATION'] }, AND: [{ OR: [{ AND: [{ status: 'expired' }, { id: { notIn: ['new', 'old'] } }] }, { id: { in: ['old'] } }] }] });
    const c = svcWith(OLD as any);
    await c.svc.getDocumentsPaginated('org', { documentTypes: ['QUOTATION'], status: 'confirmed' });
    expect(whereOf(c.findMany)).toEqual({ organizationId: 'org', type: { in: ['QUOTATION'] }, AND: [{ OR: [{ AND: [{ status: 'confirmed' }, { id: { notIn: ['new', 'old'] } }] }] }] });
  });

  it('the Unconfirmed card never counts an expired draft', async () => {
    const onlyOld = svcWith([{ id: 'old', status: 'draft', first: null, cdate: '2017-03-01', idate: null, ldate: null, created: null }] as any);
    expect(await onlyOld.svc.getDocumentStats('org', { documentTypes: ['QUOTATION'] })).toEqual({ total: 100, thisMonth: 100, drafts: 5 });
  });

  it('Sales report: Expired is its own status, never in the Pending counts or totals', () => {
    expect(quotationStatus({ status: 'confirmed', imported: true, erpStatus: 'Draft', expired: true })).toBe('Expired');
    expect(quotationStatus({ status: 'confirmed', imported: true, erpStatus: 'Draft', expired: false })).toBe('Pending');
    expect(quotationStatus({ status: 'confirmed', imported: true, erpStatus: 'Accepted', expired: true })).toBe('Signed');
    expect(quotationStatus({ status: 'confirmed', imported: true, erpStatus: 'Cancelled', expired: true })).toBe('Cancelled');
    const rows: any[] = [
      { category: 'A', amount: 100, status: 'Pending' },
      { category: 'A', amount: 500, status: 'Expired' },
      { category: 'A', amount: 50, status: 'Signed' },
    ];
    expect(summarise(rows).total).toEqual({ category: 'Total', signedCount: 1, signedAmount: 50, pendingCount: 1, pendingAmount: 100 });
  });
});

