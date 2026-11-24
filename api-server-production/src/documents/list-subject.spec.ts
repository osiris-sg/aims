import { DocumentsService } from './documents.service';
import { linkedSubjectSql, listSubjectOf, ownSubjectOf, pageSubjectsQuery, shownSubjectSql, subjectListOn, subjectSearchQuery, subjectSortQuery } from './list-subject';

/**
 * Subject column on the WCT group's Quotations / DOs / Invoices lists (enableWctDocNav, 2026-11-24): own Subject, else
 * the quotation's (inherited, shown muted); sorted and searched in the database. Every other org / list: unchanged.
 */
describe('list subject rules', () => {
  it('on only with the flag and a quotation / DO / invoice list', () => {
    expect(subjectListOn(true, ['QUOTATION', 'QO1'])).toBe(true);
    expect(subjectListOn(true, ['DELIVERY_ORDER', 'DO'])).toBe(true);
    expect(subjectListOn(true, ['INVOICE', 'TI', 'TI2'])).toBe(true);
    expect(subjectListOn(false, ['INVOICE'])).toBe(false);
    expect(subjectListOn(true, ['CREDIT_NOTE', 'CN'])).toBe(false);
    expect(subjectListOn(true, ['INVOICE', 'CREDIT_NOTE'])).toBe(false);
    expect(subjectListOn(true, [])).toBe(false);
    expect(subjectListOn(true, undefined)).toBe(false);
  });

  it('own Subject: config.subject, else documentInfo.subject, trimmed', () => {
    expect(ownSubjectOf({ subject: ' Degrease ' })).toBe('Degrease');
    expect(ownSubjectOf({ subject: '  ', documentInfo: { subject: 'Hood' } })).toBe('Hood');
    expect(ownSubjectOf({})).toBeNull();
  });

  it('cell: own wins; a DO / invoice falls back to the quotation (inherited); a quotation never inherits', () => {
    expect(listSubjectOf('DELIVERY_ORDER', 'Own', 'Quote')).toEqual({ text: 'Own', inherited: false });
    expect(listSubjectOf('DELIVERY_ORDER', null, 'Quote')).toEqual({ text: 'Quote', inherited: true });
    expect(listSubjectOf('INVOICE', '', 'Quote')).toEqual({ text: 'Quote', inherited: true });
    expect(listSubjectOf('QUOTATION', null, 'Other')).toBeNull();
    expect(listSubjectOf('INVOICE', null, null)).toBeNull();
  });

  it('SQL: the quotation through sourceDocumentId, a DO in between, or the order; bad pointers never cast', () => {
    const sql = linkedSubjectSql('d');
    expect(sql).toContain(`d.config ->> 'sourceDocumentId'`);
    expect(sql).toContain(`ls2.config ->> 'sourceDocumentId'`);
    expect(sql).toContain(`d.config ->> 'orderId'`);
    expect(sql).toContain('"sourceQuotationId"');
    expect(sql).toMatch(/CASE WHEN \(d\.config ->> 'sourceDocumentId'\) ~\* '\^\[0-9a-f\]\{8\}/);
    expect(sql).toContain(`d.type::text IN ('QUOTATION', 'QO', 'QO1', 'QO2', 'QT') THEN NULL`);
    expect(shownSubjectSql('d')).toMatch(/^COALESCE\(COALESCE\(NULLIF\(btrim\(d\.config ->> 'subject'\)/);
  });

  it('queries carry the org, the ids / types, and the sort direction', () => {
    const page = pageSubjectsQuery('org1', ['a', 'b']);
    expect(page.values).toEqual(['org1', ['a', 'b']]);
    const sort = subjectSortQuery('org1', ['a'], 'asc', 50, 100);
    expect(sort.sql).toContain('ASC NULLS LAST');
    expect(sort.values).toEqual(['org1', ['a'], 50, 100]);
    expect(subjectSortQuery('org1', ['a'], 'desc', 50, 0).sql).toContain('DESC NULLS LAST');
    const search = subjectSearchQuery('org1', ['DELIVERY_ORDER'], '%hood%');
    expect(search.sql).toContain('ILIKE');
    expect(search.values).toEqual(['org1', ['DELIVERY_ORDER'], '%hood%']);
  });
});

function listSvc(flagOn: boolean) {
  const rows = [
    { id: 'd1', name: 'DO1', type: 'DELIVERY_ORDER', status: 'unconfirmed', createdAt: new Date('2026-11-01'), config: {} },
    { id: 'd2', name: 'DO2', type: 'DELIVERY_ORDER', status: 'unconfirmed', createdAt: new Date('2026-11-02'), config: { subject: 'Own' } },
  ];
  const findUnique = jest.fn(async () => ({ features: { enableWctDocNav: flagOn } }));
  const queryRaw = jest.fn(async (q: any) => {
    const text = String(q?.sql ?? (Array.isArray(q) ? q.join('?') : ''));
    if (text.includes('AS own')) return [
      { id: 'd1', type: 'DELIVERY_ORDER', own: null, linked: 'From the quotation' },
      { id: 'd2', type: 'DELIVERY_ORDER', own: 'Own', linked: 'From the quotation' },
    ];
    if (text.includes('NULLS LAST')) return [{ id: 'd2' }, { id: 'd1' }];
    if (text.includes(`btrim(d.config ->> 'subject')`) && text.includes('ILIKE')) return [{ id: 'd1' }];
    return [];
  });
  const findMany = jest.fn(async (args: any) => (args?.select ? rows.map((r) => ({ id: r.id })) : rows));
  const prisma: any = {
    organizationUIConfig: { findUnique },
    userRole: { findMany: jest.fn(async () => []) },
    $queryRaw: queryRaw,
    document: { findMany, count: jest.fn(async () => rows.length) },
    customer: { findMany: jest.fn(async () => []) },
    project: { findMany: jest.fn(async () => []) },
    order: { findMany: jest.fn(async () => []) },
  };
  const svc: any = Object.create(DocumentsService.prototype);
  Object.assign(svc, { prisma, listKeysReadyAt: new Map() });
  return { svc: svc as DocumentsService, findUnique, queryRaw, findMany };
}
const sqlTexts = (m: jest.Mock) => m.mock.calls.map((c: any[]) => String(c[0]?.sql ?? ''));

describe('document list: Subject column (WCT group)', () => {
  it('flag on: each row carries its Subject, a DO without one gets its quotation\'s (inherited)', async () => {
    const { svc } = listSvc(true);
    const out: any = await svc.getDocumentsPaginated('org', { documentTypes: ['DELIVERY_ORDER', 'DO'] });
    expect(out.docs.map((d: any) => d.listSubject)).toEqual([
      { text: 'From the quotation', inherited: true },
      { text: 'Own', inherited: false },
    ]);
  });

  it('flag on: sort by subject orders in the database and loads that page', async () => {
    const { svc, queryRaw } = listSvc(true);
    const out: any = await svc.getDocumentsPaginated('org', { documentTypes: ['DELIVERY_ORDER'], sortBy: 'subject', sortDir: 'asc' });
    expect(out.docs.map((d: any) => d.id)).toEqual(['d2', 'd1']);
    expect(out.total).toBe(2);
    expect(sqlTexts(queryRaw).some((t) => t.includes('ASC NULLS LAST'))).toBe(true);
  });

  it('flag on: the search also matches the shown Subject', async () => {
    const { svc, queryRaw, findMany } = listSvc(true);
    await svc.getDocumentsPaginated('org', { documentTypes: ['DELIVERY_ORDER'], search: 'hood' });
    expect(sqlTexts(queryRaw).some((t) => t.includes('ILIKE') && t.includes('sourceDocumentId'))).toBe(true);
    const where = (findMany.mock.calls[0] as any)[0].where;
    expect(JSON.stringify(where)).toContain('"d1"');
  });

  it('flag off: no Subject key, no Subject SQL, sort by subject falls back to the created date', async () => {
    const { svc, queryRaw, findMany } = listSvc(false);
    const out: any = await svc.getDocumentsPaginated('org', { documentTypes: ['DELIVERY_ORDER'], sortBy: 'subject' as any, search: 'hood' });
    expect(out.docs.every((d: any) => !('listSubject' in d))).toBe(true);
    expect(sqlTexts(queryRaw).some((t) => t.includes('sourceDocumentId') || t.includes('NULLS LAST'))).toBe(false);
    expect((findMany.mock.calls.at(-1) as any)[0].orderBy).toEqual({ createdAt: 'desc' });
  });

  it('other lists (credit notes): unchanged, no Subject key or SQL', async () => {
    const { svc, queryRaw } = listSvc(true);
    const out: any = await svc.getDocumentsPaginated('org', { documentTypes: ['CREDIT_NOTE'], search: 'hood' });
    expect(out.docs.every((d: any) => !('listSubject' in d))).toBe(true);
    expect(sqlTexts(queryRaw).some((t) => t.includes('sourceDocumentId') || t.includes('AS own'))).toBe(false);
  });
});

describe('Invoices list: PO Number search (WCT group, 2026-11-24)', () => {
  it('flag on, invoice list: the search reads config.poNumber', async () => {
    const { svc, queryRaw } = listSvc(true);
    await svc.getDocumentsPaginated('org', { documentTypes: ['INVOICE'], search: 'PO-123' });
    expect(sqlTexts(queryRaw).some((t) => t.includes("'poNumber'"))).toBe(true);
  });
  it('flag off, or a DO / quotation / credit note list: no PO SQL', async () => {
    for (const [flag, types] of [[false, ['INVOICE']], [true, ['DELIVERY_ORDER']], [true, ['QUOTATION']], [true, ['CREDIT_NOTE']]] as const) {
      const { svc, queryRaw } = listSvc(flag);
      await svc.getDocumentsPaginated('org', { documentTypes: [...types], search: 'PO-123' });
      expect(sqlTexts(queryRaw).some((t) => t.includes('poNumber'))).toBe(false);
    }
  });
});
