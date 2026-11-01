import { ForbiddenException } from '@nestjs/common';
import { fieldScopeUserId, ownReportWhere } from './field-scope';
import { MaintenanceReportsService } from '../maintenance-reports/maintenance-reports.service';
import { MaintenanceReportsController } from '../maintenance-reports/maintenance-reports.controller';

// Field-tech rule (2026-11-02): read every report, change only your own.
describe('fieldScopeUserId', () => {
  it('limits a user whose only role in the org is field-tech', () => {
    expect(fieldScopeUserId({ user: { id: 'u1' }, orgRoleNames: ['field-tech'] })).toBe('u1');
  });
  it('never limits office roles, mixed roles, admins or an unknown role set', () => {
    expect(fieldScopeUserId({ user: { id: 'u1' }, orgRoleNames: ['Admin'] })).toBeNull();
    expect(fieldScopeUserId({ user: { id: 'u1' }, orgRoleNames: ['field-tech', 'Sales'] })).toBeNull();
    expect(fieldScopeUserId({ user: { id: 'u1' }, orgRoleNames: ['field-tech'], isOsirisAdmin: true })).toBeNull();
    expect(fieldScopeUserId({ user: { id: 'u1' }, orgRoleNames: [] })).toBeNull();
    expect(fieldScopeUserId(undefined)).toBeNull();
  });
  it('own reports = written by them, or on a job claimed by / planned for them', () => {
    expect(ownReportWhere('u1')).toEqual({
      OR: [{ technicianUserId: 'u1' }, { delivery: { OR: [{ riderUserId: 'u1' }, { plannedRiderUserId: 'u1' }] } }],
    });
  });
});

describe('MaintenanceReportsService write rule', () => {
  const svc = (ownIds: string[]) => {
    const calls: any[] = [];
    const prisma = {
      maintenanceServiceReport: {
        findFirst: async (a: any) => (calls.push(a), ownIds.includes(a.where.id) ? { id: a.where.id } : null),
        findMany: async (a: any) => (calls.push(a), a.where.id.in.filter((id: string) => ownIds.includes(id)).map((id: string) => ({ id }))),
      },
    };
    const s = Object.create(MaintenanceReportsService.prototype) as MaintenanceReportsService;
    (s as any).prisma = prisma;
    return { s, calls };
  };
  it('a field tech may change their own report, not another technician’s (403 with a clear message)', async () => {
    const { s, calls } = svc(['mine']);
    await expect(s.assertCanWriteReport('mine', 'org', 'u1')).resolves.toBeUndefined();
    await expect(s.assertCanWriteReport('theirs', 'org', 'u1')).rejects.toThrow(new ForbiddenException('Only the technician on this job can change this report'));
    expect(calls[0].where).toEqual({ id: 'mine', organizationId: 'org', ...ownReportWhere('u1') });
  });
  it('office users are never checked', async () => {
    const { s, calls } = svc([]);
    await expect(s.assertCanWriteReport('any', 'org', null)).resolves.toBeUndefined();
    expect(await s.canWriteReport('any', 'org', null)).toBe(true);
    expect(calls).toHaveLength(0);
  });
  it('canEdit on a list: own true, others false; everything true for the office', async () => {
    const { s } = svc(['a']);
    expect(await s.markCanEdit([{ id: 'a' }, { id: 'b' }], 'org', 'u1')).toEqual([
      { id: 'a', canEdit: true },
      { id: 'b', canEdit: false },
    ]);
    expect(await s.markCanEdit([{ id: 'b' }], 'org', null)).toEqual([{ id: 'b', canEdit: true }]);
  });
});

describe('MaintenanceReportsController: read all, write own', () => {
  const tech = { user: { id: 'u1' }, orgRoleNames: ['field-tech'] } as any;
  const office = { user: { id: 'o1' }, orgRoleNames: ['Admin'] } as any;
  const ctrl = () => {
    const seen: any = { writes: [] as string[] };
    const service = {
      findAllService: async () => ({ docs: [{ id: 'a' }, { id: 'b' }], total: 2 }),
      markCanEdit: async (docs: any[], _o: string, scope: string | null) => docs.map((d) => ({ ...d, canEdit: !scope || d.id === 'a' })),
      findById: async (id: string) => ({ id }),
      canWriteReport: async (id: string, _o: string, scope: string | null) => !scope || id === 'a',
      assertCanWriteReport: async (id: string, _o: string, scope: string | null) => {
        if (scope && id !== 'a') throw new ForbiddenException('Only the technician on this job can change this report');
      },
      saveDraft: async (id: string) => (seen.writes.push(`draft:${id}`), { ok: true }),
      updatePhotos: async (id: string) => (seen.writes.push(`photos:${id}`), { ok: true }),
      sign: async (id: string) => (seen.writes.push(`sign:${id}`), { ok: true }),
      completeScheduled: async (id: string) => (seen.writes.push(`complete:${id}`), { ok: true }),
      recordLocationPings: async (id: string) => (seen.writes.push(`ping:${id}`), { ok: true }),
      createInvoiceFromMsr: async () => ({ documentId: 'd1' }),
    };
    return { seen, c: new MaintenanceReportsController(service as any) };
  };
  it('a field tech READS every report (list + by id), with canEdit', async () => {
    const { c } = ctrl();
    const list: any = await c.findAll({ id: 'org' }, undefined, undefined, undefined, undefined, tech);
    expect(list.docs.map((d: any) => [d.id, d.canEdit])).toEqual([
      ['a', true],
      ['b', false],
    ]);
    await expect(c.findById('b', { id: 'org' }, tech)).resolves.toEqual({ id: 'b', canEdit: false });
  });
  it('a field tech CHANGES only their own: draft / photos / sign / complete / location', async () => {
    const { c, seen } = ctrl();
    const org = { id: 'org' };
    await c.saveDraft('a', {}, org, tech);
    await expect(c.saveDraft('b', {}, org, tech)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.updatePhotos('b', {}, org, tech)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.sign('b', {} as any, org, tech)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.completeScheduled('b', {}, org, tech)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.recordLocationPings('b', {} as any, org, tech)).rejects.toBeInstanceOf(ForbiddenException);
    expect(seen.writes).toEqual(['draft:a']);
  });
  it('create-invoice is office only; the office can change any report', async () => {
    const { c, seen } = ctrl();
    expect(() => c.createInvoice('a', { id: 'org' }, tech)).toThrow(ForbiddenException);
    await expect(c.createInvoice('a', { id: 'org' }, office)).resolves.toEqual({ documentId: 'd1' });
    await c.sign('b', {} as any, { id: 'org' }, office);
    expect(seen.writes).toEqual(['sign:b']);
  });
});
