import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { amountExclGst, nameTokens, quotationStatus, reportScope, salespeopleOf, summarise, textNamesUser, type ReportRow, type Salesman } from './sales-report';
import { categoryLabel, cleanQuotationCategories, saveQuotationCategories, quotationCategories, QUOTATION_CATEGORY_ENTITY, QUOTATION_CATEGORY_FIELD } from './quotation-category';
import { SalesReportService } from './sales-report.service';
import { aliasMapOf, resolveSalespersonIds } from './salesperson-resolver';

describe('quotation status', () => {
  it('native: Draft until sent, Pending once a sign link or an email went out, Signed when signed / ordered / confirmed', () => {
    expect(quotationStatus({ status: 'unconfirmed' })).toBe('Draft');
    expect(quotationStatus({ status: 'draft' })).toBe('Draft');
    expect(quotationStatus({ status: 'unconfirmed', hasSignLink: true })).toBe('Pending');
    expect(quotationStatus({ status: 'unconfirmed', emailed: true })).toBe('Pending');
    expect(quotationStatus({ status: 'unconfirmed', signed: true })).toBe('Signed');
    expect(quotationStatus({ status: 'unconfirmed', orderStatus: 'DO_DRAFT' })).toBe('Signed');
    expect(quotationStatus({ status: 'confirmed', hasSignLink: true })).toBe('Signed');
  });
  it('Cancelled wins: a cancelled / voided quotation or a cancelled order', () => {
    expect(quotationStatus({ status: 'confirmed', signed: true, orderStatus: 'CANCELLED' })).toBe('Cancelled');
    expect(quotationStatus({ status: 'unconfirmed', cancelled: true, hasSignLink: true })).toBe('Cancelled');
  });
  it('imported (Q-0xxxxx): the ERP status', () => {
    expect(quotationStatus({ status: 'confirmed', imported: true, erpStatus: 'Accepted' })).toBe('Signed');
    expect(quotationStatus({ status: 'confirmed', imported: true, erpStatus: 'Declined' })).toBe('Cancelled');
    expect(quotationStatus({ status: 'confirmed', imported: true, erpStatus: 'Sent' })).toBe('Pending');
    expect(quotationStatus({ status: 'confirmed', imported: true, erpStatus: null })).toBe('Pending');
    expect(quotationStatus({ status: 'unconfirmed', imported: true, erpStatus: '' })).toBe('Draft');
  });
});

describe('status mapping confirmed by Elroy (2026-11-18)', () => {
  it('Confirmed with no order = Signed; emailed (not signed) = Pending', () => {
    expect(quotationStatus({ status: 'confirmed', orderStatus: null, signed: false })).toBe('Signed');
    expect(quotationStatus({ status: 'unconfirmed', emailed: true, signed: false })).toBe('Pending');
    expect(quotationStatus({ status: 'draft', emailed: true })).toBe('Pending');
  });
});

describe('amount excl. GST', () => {
  it('nett - GST, else sub-total - discount, else lines - discount', () => {
    expect(amountExclGst({ nettTotal: '3424', gstAmount: '224', subTotal: '3200' })).toBe(3200);
    expect(amountExclGst({ subTotal: '1000', discountAmount: '100' })).toBe(900);
    expect(amountExclGst({ itemsTotal: '450.5' })).toBe(450.5);
    expect(amountExclGst({})).toBe(0);
  });
});

const salesmen: Salesman[] = [
  { userId: 'u-henry', code: 'S001', name: 'Henry Hoo' },
  { userId: 'u-joyna', code: 'S002', name: 'Joyna Chua' },
  { userId: 'u-nee', code: '', name: 'Nee Meng Tan' },
  { userId: 'u-x', code: '', name: 'Unknown' },
];

describe('salesperson', () => {
  it('code or user id resolves to the user', () => {
    expect(salespeopleOf('S001', salesmen)).toEqual([{ key: 'u:u-henry', label: 'Henry Hoo' }]);
    expect(salespeopleOf('s002', salesmen)).toEqual([{ key: 'u:u-joyna', label: 'Joyna Chua' }]);
    expect(salespeopleOf('u-nee', salesmen)).toEqual([{ key: 'u:u-nee', label: 'Nee Meng Tan' }]);
  });
  it('imported free text resolves to every user it names (first or full name), else stays its own entry', () => {
    expect(nameTokens('Henry & Joyna')).toEqual(['henry', 'joyna']);
    expect(nameTokens('Isadora (Follow Up)')).toEqual(['isadora']);
    expect(salespeopleOf('Henry & Joyna', salesmen).map((r) => r.key)).toEqual(['u:u-henry', 'u:u-joyna']);
    expect(salespeopleOf('henry', salesmen).map((r) => r.key)).toEqual(['u:u-henry']);
    expect(salespeopleOf('Nee Meng', salesmen).map((r) => r.key)).toEqual(['u:u-nee']);
    expect(salespeopleOf('Rave', salesmen)).toEqual([{ key: 't:rave', label: 'Rave' }]);
    expect(salespeopleOf('Hnery', salesmen)).toEqual([{ key: 't:hnery', label: 'Hnery' }]);
    expect(salespeopleOf('', salesmen)).toEqual([{ key: '', label: 'No salesperson' }]);
    expect(textNamesUser('Unknown', { name: 'Unknown' })).toBe(false);
  });
});

describe('access', () => {
  it('Admin / Accounting see all; Sales only sees own; anyone else none; multi-role: any admin-type role wins', () => {
    expect(reportScope(['Admin'])).toBe('all');
    expect(reportScope(['Accounting'])).toBe('all');
    expect(reportScope(['superadmin'])).toBe('all');
    expect(reportScope(['Sales'])).toBe('own');
    expect(reportScope(['Sales', 'Operations'])).toBe('own');
    expect(reportScope(['Sales', 'Accounting'])).toBe('all');
    expect(reportScope(['Operations', 'Viewer'])).toBe('none');
    expect(reportScope([])).toBe('none');
    expect(reportScope([], true)).toBe('all');
  });
});

describe('summary', () => {
  const row = (category: string, status: any, amount: number): ReportRow => ({ id: Math.random().toString(), number: 'Q', date: '2026-11-01', customer: '', subject: '', category, amount, status });
  it('totals by category, Signed vs Pending; Draft / Cancelled listed, not totalled; Uncategorised last', () => {
    const s = summarise([row('Uncategorised', 'Signed', 10), row('Kitchen exhaust', 'Signed', 100), row('Kitchen exhaust', 'Pending', 50.5), row('Ductwork', 'Pending', 20), row('Ductwork', 'Draft', 999), row('Ductwork', 'Cancelled', 999)]);
    expect(s.byCategory.map((c) => c.category)).toEqual(['Ductwork', 'Kitchen exhaust', 'Uncategorised']);
    expect(s.byCategory[1]).toEqual({ category: 'Kitchen exhaust', signedCount: 1, signedAmount: 100, pendingCount: 1, pendingAmount: 50.5 });
    expect(s.total).toEqual({ category: 'Total', signedCount: 2, signedAmount: 110, pendingCount: 2, pendingAmount: 70.5 });
  });
});

describe('quotation categories', () => {
  it('clean: trimmed, no blanks, no repeats; empty allowed; "Uncategorised" refused', () => {
    expect(cleanQuotationCategories([' Kitchen  exhaust ', '', 'kitchen exhaust', 'Ductwork'])).toEqual(['Kitchen exhaust', 'Ductwork']);
    expect(cleanQuotationCategories([])).toEqual([]);
    expect(() => cleanQuotationCategories(['uncategorised'])).toThrow(BadRequestException);
    expect(() => cleanQuotationCategories('x' as any)).toThrow(BadRequestException);
  });
  it('blank = Uncategorised', () => {
    expect(categoryLabel('')).toBe('Uncategorised');
    expect(categoryLabel(undefined)).toBe('Uncategorised');
    expect(categoryLabel(' Ductwork ')).toBe('Ductwork');
  });
  it('save upserts the org CustomField (created on the first save) and reads it back', async () => {
    let stored: any = null;
    const prisma: any = {
      customField: {
        upsert: jest.fn(async (args: any) => {
          stored = { ...(stored || args.create), ...(stored ? args.update : {}) };
          return stored;
        }),
        findFirst: jest.fn(async () => stored),
      },
    };
    expect(await quotationCategories(prisma, 'org-1')).toEqual([]);
    expect(await saveQuotationCategories(prisma, 'org-1', ['A', 'B'])).toEqual(['A', 'B']);
    const call = prisma.customField.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ organizationId_entityType_fieldName: { organizationId: 'org-1', entityType: QUOTATION_CATEGORY_ENTITY, fieldName: QUOTATION_CATEGORY_FIELD } });
    expect(call.create).toMatchObject({ organizationId: 'org-1', fieldType: 'select', options: [{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }] });
    expect(await saveQuotationCategories(prisma, 'org-1', ['B'])).toEqual(['B']);
  });
});

// ── the service, with a fake prisma ─────────────────────────────────────────

const q = (over: any) => ({
  id: 'd' + Math.random().toString(36).slice(2, 8),
  name: 'QO',
  status: 'unconfirmed',
  templateId: 'tpl',
  date: '2026-11-10',
  salesPerson: null,
  customer: 'TEST Client',
  subject: 'Degreasing',
  category: null,
  nettTotal: '109',
  gstAmount: '9',
  subTotal: '100',
  discountAmount: '0',
  itemsTotal: '100',
  cancelled: false,
  signed: false,
  imported: false,
  erpStatus: null,
  ...over,
});

function fakeService(opts: { features?: any; roles?: Record<string, string[]>; rows?: any[]; links?: string[]; sent?: string[]; orders?: Array<{ sourceQuotationId: string; status: string }>; categoryRow?: any; aliases?: any[] } = {}) {
  const features = opts.features ?? { enableSalesReport: true, enableQuotationCategory: true };
  const roles = opts.roles ?? {};
  const rawCalls: any[] = [];
  const prisma: any = {
    organizationUIConfig: { findUnique: jest.fn(async () => ({ features })) },
    userRole: { findMany: jest.fn(async ({ where }: any) => (roles[where.userId] || []).map((name) => ({ role: { name } }))) },
    userOrganization: {
      findMany: jest.fn(async () => [
        { userId: 'u-henry', salesmanCode: 'S001' },
        { userId: 'u-joyna', salesmanCode: 'S002' },
        { userId: 'u-admin', salesmanCode: null },
      ]),
    },
    $queryRawUnsafe: jest.fn(async (sql: string, ...params: any[]) => {
      rawCalls.push({ sql, params });
      const [, , from, to] = params;
      return (opts.rows || []).filter((r) => (!from || r.date >= from) && (!to || r.date <= to));
    }),
    documentSignLink: { findMany: jest.fn(async () => (opts.links || []).map((documentId) => ({ documentId }))) },
    auditLog: { findMany: jest.fn(async () => (opts.sent || []).map((resourceId) => ({ resourceId }))) },
    order: { findMany: jest.fn(async () => opts.orders || []) },
    customField: { findFirst: jest.fn(async ({ where }: any) => (where.fieldName === 'salesperson_aliases' ? (opts.aliases ? { options: opts.aliases } : null) : opts.categoryRow ?? null)), upsert: jest.fn() },
  };
  const names: Record<string, any> = { 'u-henry': { firstName: 'Henry', lastName: 'Hoo' }, 'u-joyna': { firstName: 'Joyna', lastName: 'Chua' }, 'u-admin': { firstName: 'Finance', lastName: '' } };
  const clerk: any = { toClerkUsers: jest.fn(async (ids: string[]) => new Map(ids.filter((i) => names[i]).map((i) => [i, names[i]]))) };
  return { svc: new SalesReportService(prisma, clerk), prisma, rawCalls };
}

describe('SalesReportService.report', () => {
  const rows = [
    q({ id: 'a', name: 'QO-A', salesPerson: 'S001', category: 'Kitchen exhaust', signed: true }),
    q({ id: 'b', name: 'QO-B', salesPerson: 'S001', category: 'Kitchen exhaust' }),
    q({ id: 'c', name: 'QO-C', salesPerson: 'S002', category: 'Ductwork', date: '2026-11-12' }),
    q({ id: 'd', name: 'Q-000001', salesPerson: 'Henry & Joyna', imported: true, status: 'confirmed', erpStatus: 'Accepted', nettTotal: '1070', gstAmount: '70', date: '2026-10-01' }),
    q({ id: 'e', name: 'Q-000002', salesPerson: 'Rave', imported: true, status: 'confirmed', erpStatus: 'Declined', date: '2026-10-02' }),
    q({ id: 'f', name: 'QO-F', salesPerson: null, date: '2026-11-15' }),
  ];

  it('admin: everyone, every status, summary split Signed vs Pending', async () => {
    const { svc } = fakeService({ roles: { 'u-admin': ['Admin'] }, rows, links: ['b'] });
    const r = await svc.report('org', { userId: 'u-admin' }, {});
    expect(r.scope).toBe('all');
    expect(r.rows.map((x) => [x.number, x.status, x.category, x.amount])).toEqual([
      ['QO-A', 'Signed', 'Kitchen exhaust', 100],
      ['QO-B', 'Pending', 'Kitchen exhaust', 100],
      ['QO-C', 'Draft', 'Ductwork', 100],
      ['Q-000001', 'Signed', 'Uncategorised', 1000],
      ['Q-000002', 'Cancelled', 'Uncategorised', 100],
      ['QO-F', 'Draft', 'Uncategorised', 100],
    ]);
    expect(r.summary.byCategory).toEqual([
      { category: 'Kitchen exhaust', signedCount: 1, signedAmount: 100, pendingCount: 1, pendingAmount: 100 },
      { category: 'Uncategorised', signedCount: 1, signedAmount: 1000, pendingCount: 0, pendingAmount: 0 },
    ]);
    expect(r.salespeople.map((p) => p.label)).toEqual(['Henry Hoo', 'Joyna Chua', 'Rave']);
  });

  it('admin picks a salesperson: their native quotations plus imported ones naming them', async () => {
    const { svc } = fakeService({ roles: { 'u-admin': ['Admin'] }, rows });
    const r = await svc.report('org', { userId: 'u-admin' }, { salesperson: 'u:u-joyna' });
    expect(r.rows.map((x) => x.number)).toEqual(['QO-C', 'Q-000001']);
    const t = await svc.report('org', { userId: 'u-admin' }, { salesperson: 't:rave' });
    expect(t.rows.map((x) => x.number)).toEqual(['Q-000002']);
  });

  it('date filter: passed to the query on the quotation date', async () => {
    const { svc, rawCalls } = fakeService({ roles: { 'u-admin': ['Accounting'] }, rows });
    const r = await svc.report('org', { userId: 'u-admin' }, { from: '2026-11-01', to: '2026-11-12' });
    expect(rawCalls[0].params.slice(2)).toEqual(['2026-11-01', '2026-11-12']);
    expect(r.rows.map((x) => x.number)).toEqual(['QO-A', 'QO-B', 'QO-C']);
    await expect(svc.report('org', { userId: 'u-admin' }, { from: '2026-11-12', to: '2026-11-01' })).rejects.toBeInstanceOf(BadRequestException);
    // Junk dates are ignored, never put into SQL.
    await svc.report('org', { userId: 'u-admin' }, { from: "2026-11-01' OR 1=1", to: 'x' });
    expect(rawCalls[rawCalls.length - 1].params.slice(2)).toEqual([null, null]);
  });

  it('sales only: their own quotations whatever they ask for, and only themselves in the picker', async () => {
    const { svc } = fakeService({ roles: { 'u-henry': ['Sales'] }, rows });
    const r = await svc.report('org', { userId: 'u-henry' }, { salesperson: 'u:u-joyna' });
    expect(r.scope).toBe('own');
    expect(r.salesperson).toBe('u:u-henry');
    expect(r.rows.map((x) => x.number)).toEqual(['QO-A', 'QO-B', 'Q-000001']);
    expect(r.salespeople).toEqual([{ key: 'u:u-henry', label: 'Henry Hoo' }]);
    const all = await svc.report('org', { userId: 'u-henry' }, {});
    expect(all.rows.map((x) => x.number)).toEqual(['QO-A', 'QO-B', 'Q-000001']);
  });

  it('multi-role Sales + Accounting sees everyone; Operations is refused; the osiris admin sees everyone', async () => {
    const { svc } = fakeService({ roles: { 'u-joyna': ['Sales', 'Accounting'], 'u-ops': ['Operations'] }, rows });
    expect((await svc.report('org', { userId: 'u-joyna' }, {})).rows).toHaveLength(6);
    await expect(svc.report('org', { userId: 'u-ops' }, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect((await svc.report('org', { userId: 'nobody', isOsirisAdmin: true }, {})).rows).toHaveLength(6);
  });

  it('order cancelled = Cancelled; an order = Signed; emailed = Pending', async () => {
    const { svc } = fakeService({ roles: { a: ['Admin'] }, rows: [q({ id: 'x1', name: 'X1' }), q({ id: 'x2', name: 'X2' }), q({ id: 'x3', name: 'X3' })], orders: [{ sourceQuotationId: 'x1', status: 'CANCELLED' }, { sourceQuotationId: 'x2', status: 'DO_DRAFT' }], sent: ['x3'] });
    expect((await svc.report('org', { userId: 'a' }, {})).rows.map((x) => x.status)).toEqual(['Cancelled', 'Signed', 'Pending']);
  });

  it('orgs without the setting: refused, nothing read', async () => {
    const { svc, prisma } = fakeService({ features: {}, roles: { a: ['Admin'] }, rows });
    await expect(svc.report('org', { userId: 'a' }, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});

describe('SalesReportService categories', () => {
  it('enabled org: its list; other orgs: disabled, empty, and saving is refused', async () => {
    const on = fakeService({ categoryRow: { options: [{ value: 'A', label: 'A' }], isActive: true } });
    expect(await on.svc.categories('org')).toEqual({ enabled: true, options: ['A'], uncategorised: 'Uncategorised' });
    const off = fakeService({ features: { enableSalesReport: true } });
    expect(await off.svc.categories('org')).toEqual({ enabled: false, options: [], uncategorised: 'Uncategorised' });
    expect(off.prisma.customField.findFirst).not.toHaveBeenCalled();
    await expect(off.svc.saveCategories('org', { options: ['A'] })).rejects.toBeInstanceOf(BadRequestException);
    expect(off.prisma.customField.upsert).not.toHaveBeenCalled();
  });
});

describe('shared salesperson resolver (code / id, then the alias map, then the name rules)', () => {
  const aliases = aliasMapOf([{ text: 'Henry & Joyna', userIds: ['u-henry', 'u-joyna'] }, { text: 'HH', userIds: ['u-hh'] }, { text: 'Hnery', userIds: ['u-henry'] }, { text: 'junk', userIds: [] }]);
  const codes = new Map([['S001', 'u-henry']]);
  it('code first, then the map (exact text, spaces and case ignored), then the name rule, else nothing', () => {
    expect(resolveSalespersonIds('s001', { codes, aliases })).toEqual(['u-henry']);
    expect(resolveSalespersonIds('u-joyna', { codes, aliases, userIds: new Set(['u-joyna']) })).toEqual(['u-joyna']);
    expect(resolveSalespersonIds('  henry &  JOYNA ', { codes, aliases })).toEqual(['u-henry', 'u-joyna']);
    expect(resolveSalespersonIds('hh', { codes, aliases })).toEqual(['u-hh']);
    expect(resolveSalespersonIds('Hnery', { codes, aliases })).toEqual(['u-henry']);
    expect(resolveSalespersonIds('Henry', { codes, aliases, nameRule: () => ['u-rule'] })).toEqual(['u-rule']);
    expect(resolveSalespersonIds('Isadora', { codes, aliases })).toEqual([]);
    expect(resolveSalespersonIds('junk', { codes, aliases })).toEqual([]);
    expect(resolveSalespersonIds('', { codes, aliases })).toEqual([]);
  });
  it('an org without a map: exactly the old resolution', () => {
    expect(aliasMapOf(null).size).toBe(0);
    expect(salespeopleOf('Henry & Joyna', salesmen).map((r) => r.key)).toEqual(['u:u-henry', 'u:u-joyna']);
    expect(salespeopleOf('HH', salesmen)).toEqual([{ key: 't:hh', label: 'HH' }]);
  });
});

describe('Sales report with the alias map', () => {
  const aliases = [
    { text: 'Henry & Joyna', userIds: ['u-henry', 'u-joyna'] },
    { text: 'HH', userIds: ['u-joyna'] },
  ];
  const rows = [
    q({ id: 'm1', name: 'Q-1', salesPerson: 'Henry & Joyna', imported: true, status: 'confirmed', erpStatus: 'Accepted', nettTotal: '1090', gstAmount: '90' }),
    q({ id: 'm2', name: 'Q-2', salesPerson: 'HH', imported: true, status: 'confirmed', erpStatus: 'Accepted', nettTotal: '545', gstAmount: '45' }),
    q({ id: 'm3', name: 'Q-3', salesPerson: 'Isadora (Follow Up)', imported: true, status: 'confirmed', erpStatus: 'Accepted', nettTotal: '218', gstAmount: '18' }),
    q({ id: 'm4', name: 'Q-4', salesPerson: 'Clive Tang', imported: true, status: 'confirmed', erpStatus: 'Sent', nettTotal: '109', gstAmount: '9' }),
  ];

  it('several names: each person gets the full amount; All counts the quotation once', async () => {
    const { svc } = fakeService({ roles: { a: ['Admin'] }, rows, aliases });
    const henry = await svc.report('org', { userId: 'a' }, { salesperson: 'u:u-henry' });
    const joyna = await svc.report('org', { userId: 'a' }, { salesperson: 'u:u-joyna' });
    const all = await svc.report('org', { userId: 'a' }, {});
    expect(henry.rows.map((r) => [r.number, r.amount])).toEqual([['Q-1', 1000]]);
    expect(henry.summary.total.signedAmount).toBe(1000);
    expect(joyna.rows.map((r) => [r.number, r.amount])).toEqual([['Q-1', 1000], ['Q-2', 500]]);
    expect(joyna.summary.total.signedAmount).toBe(1500);
    expect(all.rows.map((r) => r.number)).toEqual(['Q-1', 'Q-2', 'Q-3', 'Q-4']);
    expect(all.summary.total).toMatchObject({ signedCount: 3, signedAmount: 1700, pendingCount: 1, pendingAmount: 100 });
  });

  it('unmapped names stay raw-name entries in the filter (Admin / Accounting) and reach their quotations', async () => {
    const { svc } = fakeService({ roles: { a: ['Accounting'] }, rows, aliases });
    const all = await svc.report('org', { userId: 'a' }, {});
    expect(all.salespeople).toEqual(
      expect.arrayContaining([
        { key: 't:isadora (follow up)', label: 'Isadora (Follow Up)' },
        { key: 't:clive tang', label: 'Clive Tang' },
      ]),
    );
    expect(all.salespeople.some((p) => p.key === 't:hh')).toBe(false);
    expect((await svc.report('org', { userId: 'a' }, { salesperson: 't:clive tang' })).rows.map((r) => r.number)).toEqual(['Q-4']);
  });

  it('Sales-only: their own quotations via the map, no raw-name entries', async () => {
    const { svc } = fakeService({ roles: { 'u-joyna': ['Sales'] }, rows, aliases });
    const r = await svc.report('org', { userId: 'u-joyna' }, { salesperson: 't:clive tang' });
    expect(r.rows.map((x) => x.number)).toEqual(['Q-1', 'Q-2']);
    expect(r.salespeople).toEqual([{ key: 'u:u-joyna', label: 'Joyna Chua' }]);
  });
});
