/**
 * Field phase 1: workers, teams, sites, invites, photos, links.
 * Cases ported from siteclock backend/test/e2e.ts @62b7d9d (line ranges in each describe), run against
 * the in-memory Prisma stand-in (src/field/testing/fake-prisma.ts).
 */
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { computeFieldAccess } from '../common/field-access';
import type { FieldCtx } from '../common/field-context.service';
import { FieldContextService } from '../common/field-context.service';
import { fakePrisma, type FakePrisma } from '../testing/fake-prisma';
import { coversDate, FieldPeopleService, overlaps } from './people.service';

const ORG = 'org-1';
const OTHER = 'org-2';

function ctx(over: Partial<FieldCtx> = {}): FieldCtx {
  return {
    organizationId: ORG,
    userId: 'u-admin',
    userName: 'Admin',
    features: {},
    timezone: 'Asia/Singapore',
    access: computeFieldAccess({ isOsirisAdmin: false, roleNames: ['Admin'], supervises: false }),
    workerId: null,
    supervisedSiteIds: [],
    supervisedWorkerIds: [],
    ...over,
  };
}

async function setup() {
  const db: FakePrisma = fakePrisma();
  await db.organization.create({ data: { id: ORG, name: 'E2E Co' } });
  await db.organization.create({ data: { id: OTHER, name: 'E2E Second Co' } });
  const svc = new FieldPeopleService(db as any);
  const mk = async (name: string, phone: string, tier = 'WORKER', org = ORG) => {
    const w = await db.worker.create({ data: { organizationId: org, name, phone } });
    await db.fieldWorkerProfile.create({ data: { organizationId: org, workerId: w.id, tier } });
    return w;
  };
  return { db, svc, mk };
}

describe('pure helpers (teams.router coversDate / overlaps)', () => {
  it('a stint covers its first and last day; an open stint runs on', () => {
    expect(coversDate({ startDate: '2026-01-01', endDate: '2026-01-31' }, '2026-01-31')).toBe(true);
    expect(coversDate({ startDate: '2026-01-01', endDate: '2026-01-31' }, '2026-02-01')).toBe(false);
    expect(coversDate({ startDate: '2026-01-01', endDate: null }, '2099-01-01')).toBe(true);
  });
  it('overlaps treats an open end as forever', () => {
    expect(overlaps({ startDate: '2026-01-01', endDate: '2026-01-31' }, { startDate: '2026-03-01', endDate: null })).toBe(false);
    expect(overlaps({ startDate: '2026-01-01', endDate: null }, { startDate: '2026-03-01', endDate: null })).toBe(true);
  });
});

describe('teams with dated membership (e2e.ts 2442-2520)', () => {
  it('create, remove with a last day, add from a date, no double stints, members on a date, history, corrections, archive', async () => {
    const { db, svc, mk } = await setup();
    const c0 = ctx();
    const [a, b, c] = [await mk('Team Ann', '+6586000001'), await mk('Team Ben', '+6586000002'), await mk('Team Cal', '+6586000003')];
    const t = await svc.createTeam(c0, { name: 'Crew 1', memberIds: [a.id, b.id], startDate: '2026-01-01' });
    const tid = t.team.id;
    await expect(svc.createTeam(c0, { name: 'crew 1' })).rejects.toBeInstanceOf(ConflictException); // duplicate name refused (case-insensitive)

    const rm = await svc.removeTeamMember(c0, tid, a.id, { lastDay: '2026-01-31' });
    expect(rm.lastDay).toBe('2026-01-31');
    expect(rm.discarded).toBe(false);
    expect((await svc.addTeamMembers(c0, tid, { workerIds: [c.id], startDate: '2026-02-01' })).startDate).toBe('2026-02-01');
    await expect(svc.addTeamMembers(c0, tid, { workerIds: [b.id], startDate: '2026-03-01' })).rejects.toThrow(/Team Ben/);

    const names = async (date: string) => (await svc.listTeams(c0, { date })).teams.find((x) => x.id === tid)!.members.map((m: any) => m.name).join(',');
    expect(await names('2026-01-15')).toBe('Team Ann,Team Ben');
    expect(await names('2026-02-15')).toBe('Team Ben,Team Cal');
    expect(await names('2025-12-31')).toBe('');

    const hist = await svc.teamHistory(c0, tid);
    expect(hist.stints).toHaveLength(3);
    const annStint = hist.stints.find((s: any) => s.workerId === a.id)!;
    expect(annStint.endDate).toBe('2026-01-31');

    await expect(svc.editStint(c0, annStint.id, { endDate: '2025-12-01' })).rejects.toBeInstanceOf(BadRequestException); // end before start
    await svc.addTeamMembers(c0, tid, { workerIds: [a.id], startDate: '2026-03-01' });
    await expect(svc.editStint(c0, annStint.id, { endDate: null })).rejects.toBeInstanceOf(ConflictException); // overlaps
    const mistake = await svc.removeTeamMember(c0, tid, a.id, { lastDay: '2026-02-15' });
    expect(mistake.discarded).toBe(true); // before the stint started: removed

    // archive keeps history; hidden by default
    await svc.updateTeam(c0, tid, { active: false });
    expect((await svc.listTeams(c0, {})).teams.some((x) => x.id === tid)).toBe(false);
    expect((await svc.listTeams(c0, { all: '1', date: '2026-01-15' })).teams.find((x) => x.id === tid)!.members).toHaveLength(2);
    void db;
  });

  it('WorkerTeamMember keeps the members of today (the job crew picker reads it)', async () => {
    const { db, svc, mk } = await setup();
    const c0 = ctx();
    const [a, b] = [await mk('A', '+6586100001'), await mk('B', '+6586100002')];
    const t = await svc.createTeam(c0, { name: 'Now', memberIds: [a.id, b.id], startDate: '2020-01-01' });
    expect((await db.workerTeamMember.findMany({ where: { teamId: t.team.id } })).map((m: any) => m.workerId).sort()).toEqual([a.id, b.id].sort());
    await svc.removeTeamMember(c0, t.team.id, a.id, { lastDay: '2021-01-01' });
    expect((await db.workerTeamMember.findMany({ where: { teamId: t.team.id } })).map((m: any) => m.workerId)).toEqual([b.id]);
    await svc.addTeamMembers(c0, t.team.id, { workerIds: [a.id], startDate: '2099-01-01' }); // future stint: not a member today
    expect(await db.workerTeamMember.count({ where: { teamId: t.team.id } })).toBe(1);
  });

  it('only supervisors can supervise a team; the list shows them (e2e.ts 2486-2493)', async () => {
    const { svc, mk } = await setup();
    const c0 = ctx();
    const a = await mk('Team Ann', '+6586200001');
    const lead = await mk('Team Lead', '+6586200004', 'SUPERVISOR');
    const t = await svc.createTeam(c0, { name: 'Crew 2', memberIds: [a.id] });
    await expect(svc.setSupervisors(c0, t.team.id, { workerIds: [a.id] })).rejects.toBeInstanceOf(BadRequestException);
    await svc.setSupervisors(c0, t.team.id, { workerIds: [lead.id] });
    expect((await svc.listTeams(c0, {})).teams.find((x) => x.id === t.team.id)!.supervisors[0].name).toBe('Team Lead');
    await svc.setSupervisors(c0, t.team.id, { workerIds: [] });
    expect((await svc.listTeams(c0, {})).teams.find((x) => x.id === t.team.id)!.supervisors).toHaveLength(0);
  });

  it("a team supervisor's worker list is their team (e2e.ts 2503-2504)", async () => {
    const { db, svc, mk } = await setup();
    const c0 = ctx();
    const b = await mk('Team Ben', '+6586300002');
    const outsider = await mk('Team Dan', '+6586300005');
    const lead = await mk('Team Lead', '+6586300004', 'SUPERVISOR');
    const t = await svc.createTeam(c0, { name: 'Crew 3', memberIds: [b.id], startDate: '2020-01-01', supervisorIds: [lead.id] });
    void t;
    const scoped = ctx({
      userId: 'u-lead',
      workerId: lead.id,
      access: computeFieldAccess({ isOsirisAdmin: false, roleNames: ['field-tech'], supervises: true }),
      supervisedSiteIds: [],
      supervisedWorkerIds: await new FieldContextService(db as any).supervisedWorkerIds(ORG, lead.id, 'Asia/Singapore'),
    });
    expect(scoped.access.scoped.people).toBe(true);
    const ids = (await svc.listWorkers(scoped)).workers.map((w) => w.id);
    expect(ids).toContain(b.id);
    expect(ids).not.toContain(outsider.id);
  });
});

describe('workers (e2e.ts 655-680, 1401, 3617-3625)', () => {
  it('the same phone twice in one org is refused; another org gets a second account and is named', async () => {
    const { svc } = await setup();
    await svc.createWorker(ctx({ organizationId: OTHER }), { phone: '+6591000001', name: 'Worker (other co)' });
    const w = await svc.createWorker(ctx(), { phone: '+6591000001', name: 'E2E Worker' });
    expect(w.otherCompanies).toEqual(['E2E Second Co']);
    await expect(svc.createWorker(ctx(), { phone: '+6591000001', name: 'Dup' })).rejects.toThrow('Phone already registered');
  });

  it('change phone: invalid, held by someone, same number, then ok with the device reset', async () => {
    const { db, svc, mk } = await setup();
    const c0 = ctx();
    const holder = await mk('Holder', '+6594000009');
    const w = (await svc.createWorker(c0, { phone: '+6594000001', name: 'Phone Change' })).worker;
    await db.fieldWorkerProfile.update({ where: { workerId: w.id }, data: { deviceId: 'dev-1' } });
    await expect(svc.changePhone(c0, w.id, { phone: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.changePhone(c0, w.id, { phone: holder.phone })).rejects.toThrow(/already belongs to Holder/);
    await expect(svc.changePhone(c0, w.id, { phone: '+6594000001' })).rejects.toBeInstanceOf(BadRequestException);
    const ok = await svc.changePhone(c0, w.id, { phone: '+6594000002', resetDevice: true });
    expect(ok.worker.phone).toBe('+6594000002');
    expect(ok.before).toEqual({ phone: '+6594000001' });
    expect((await db.fieldWorkerProfile.findUnique({ where: { workerId: w.id } })).deviceId).toBeNull();
  });

  it('oddity kept: a phone change refuses a number held in ANY org (create only checks this org)', async () => {
    const { svc, mk } = await setup();
    await mk('Elsewhere', '+6595000001', 'WORKER', OTHER);
    const w = (await svc.createWorker(ctx(), { phone: '+6595000002', name: 'Here' })).worker;
    await expect(svc.changePhone(ctx(), w.id, { phone: '+6595000001' })).rejects.toThrow('That number is already registered to another account');
  });

  it("the only admin can't step down or be deactivated (LAST_ADMIN)", async () => {
    const { svc } = await setup();
    const adm = (await svc.createWorker(ctx(), { phone: '+6596000001', name: 'Only Admin', tier: 'COMPANY_ADMIN' })).worker;
    await expect(svc.updateWorker(ctx(), adm.id, { tier: 'WORKER' })).rejects.toMatchObject({ response: { code: 'LAST_ADMIN' } });
    await expect(svc.updateWorker(ctx(), adm.id, { active: false })).rejects.toMatchObject({ response: { code: 'LAST_ADMIN' } });
    await svc.createWorker(ctx(), { phone: '+6596000002', name: 'Second Admin', tier: 'COMPANY_ADMIN' });
    await expect(svc.updateWorker(ctx(), adm.id, { tier: 'WORKER' })).resolves.toBeTruthy();
  });

  it('a SUPERVISOR-tier worker supervises every site they are assigned to; per-worker rules; "" = company rule', async () => {
    const { db, svc } = await setup();
    const s1 = (await svc.createSite(ctx(), { name: 'Yard', lat: 1.3, lng: 103.8 })).site;
    const s2 = (await svc.createSite(ctx(), { name: 'Depot', lat: 1.31, lng: 103.81 })).site;
    const sup = (await svc.createWorker(ctx(), { phone: '+6597000001', name: 'Sup', tier: 'SUPERVISOR', siteIds: [s1.id] })).worker;
    const wk = (await svc.createWorker(ctx(), { phone: '+6597000002', name: 'Wk', siteIds: [s1.id], supervisorSiteIds: [s2.id], selfiePolicy: 'ALWAYS' })).worker;
    const asg = await db.fieldSiteAssignment.findMany({});
    expect(asg.find((a: any) => a.workerId === sup.id && a.siteId === s1.id).isSupervisor).toBe(true);
    expect(asg.find((a: any) => a.workerId === wk.id && a.siteId === s1.id).isSupervisor).toBe(false);
    expect(asg.find((a: any) => a.workerId === wk.id && a.siteId === s2.id).isSupervisor).toBe(true);
    expect((await db.fieldWorkerProfile.findUnique({ where: { workerId: wk.id } })).selfiePolicy).toBe('ALWAYS');
    await svc.updateWorker(ctx(), wk.id, { selfiePolicy: '' });
    expect((await db.fieldWorkerProfile.findUnique({ where: { workerId: wk.id } })).selfiePolicy).toBeNull();
    await expect(svc.createWorker(ctx(), { phone: '+6597000003', name: 'Bad', siteIds: ['nope'] })).rejects.toThrow('Invalid siteIds');
  });

  it('a new worker gets each tracked leave type\'s default days, overridden per type (grantLeave)', async () => {
    const { db, svc } = await setup();
    const al = await db.fieldLeaveType.create({ data: { organizationId: ORG, name: 'Annual', defaultDays: 14 } });
    const mc = await db.fieldLeaveType.create({ data: { organizationId: ORG, name: 'Medical', defaultDays: 14 } });
    await db.fieldLeaveType.create({ data: { organizationId: ORG, name: 'Unpaid', paid: false } }); // no default: not tracked
    const w = (await svc.createWorker(ctx(), { phone: '+6598000001', name: 'New', leaveDays: { [mc.id]: 7 } })).worker;
    const ents = await db.fieldLeaveEntitlement.findMany({ where: { workerId: w.id } });
    expect(ents.map((e: any) => [e.typeId, e.days]).sort()).toEqual([[al.id, 14], [mc.id, 7]].sort());
  });

  it('request verification: a supervisor only for a worker on their site or in their team', async () => {
    const { db, svc, mk } = await setup();
    const site = (await svc.createSite(ctx(), { name: 'Yard', lat: 1.3, lng: 103.8 })).site;
    const lead = await mk('Lead', '+6599000001', 'SUPERVISOR');
    const mine = (await svc.createWorker(ctx(), { phone: '+6599000002', name: 'Mine', siteIds: [site.id] })).worker;
    const other = await mk('Other', '+6599000003');
    const scoped = ctx({ workerId: lead.id, access: computeFieldAccess({ isOsirisAdmin: false, roleNames: ['field-tech'], supervises: true }), supervisedSiteIds: [site.id] });
    await svc.requestVerification(scoped, mine.id);
    expect((await db.fieldWorkerProfile.findUnique({ where: { workerId: mine.id } })).verifyRequested).toBe(true);
    await expect(svc.requestVerification(scoped, other.id)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('sites (sites.router)', () => {
  it('validation, kinds, supervisor scope, assignments', async () => {
    const { svc, mk } = await setup();
    await expect(svc.createSite(ctx(), { name: 'Bad', lat: 200, lng: 0 })).rejects.toBeInstanceOf(BadRequestException);
    const perm = (await svc.createSite(ctx(), { name: 'Yard', lat: 1.3, lng: 103.8 })).site;
    expect(perm).toMatchObject({ radiusM: 150, maxAccuracyM: 50, autoCloseAfterH: 14, timezone: 'Asia/Singapore', kind: 'PERMANENT' });
    const base = (await svc.createSite(ctx(), { name: 'Dorm', lat: 1.31, lng: 103.81, kind: 'BASE', allWorkers: true })).site;
    expect((await svc.listSites(ctx(), {})).sites.map((s: any) => s.name)).toEqual(['Dorm', 'Yard']);
    const w = await mk('W', '+6590000001');
    await svc.setSiteAssignments(ctx(), perm.id, { assignments: [{ workerId: w.id, isSupervisor: true }] });
    expect((await svc.listSites(ctx(), {})).sites.find((s: any) => s.id === perm.id).assignments[0]).toMatchObject({ workerId: w.id, isSupervisor: true });
    const scoped = ctx({ access: computeFieldAccess({ isOsirisAdmin: false, roleNames: ['x'], supervises: true }), supervisedSiteIds: [base.id] });
    expect((await svc.listSites(scoped, {})).sites.map((s: any) => s.name)).toEqual(['Dorm']);
    await expect(svc.updateSite(scoped, base.id, { name: 'X' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('invites + join requests (invites.router)', () => {
  it('approve creates the worker, site + shift assignments and leave; a phone taken meanwhile rejects the request', async () => {
    const { db, svc, mk } = await setup();
    const site = (await svc.createSite(ctx(), { name: 'Yard', lat: 1.3, lng: 103.8 })).site;
    const tpl = await db.fieldShiftTemplate.create({ data: { organizationId: ORG, name: 'Day', startTime: '08:00', endTime: '17:00', daysOfWeek: [1, 2, 3, 4, 5] } });
    const inv = (await svc.createInvite(ctx(), { label: 'Yard crew', role: 'SUPERVISOR', siteId: site.id, templateIds: [tpl.id] })).invite;
    expect(inv.token).toHaveLength(16);
    const reg = await db.fieldRegistration.create({ data: { organizationId: ORG, inviteId: inv.id, phone: '+6581000001', name: 'Joiner', employeeNo: 'E1' } });
    expect((await svc.listInvites(ctx())).invites[0].pendingCount).toBe(1);
    const out = await svc.approveRegistration(ctx(), reg.id);
    expect((await db.fieldWorkerProfile.findUnique({ where: { workerId: out.worker.id } })).tier).toBe('SUPERVISOR');
    expect((await db.fieldSiteAssignment.findFirst({ where: { workerId: out.worker.id } })).isSupervisor).toBe(true);
    expect(await db.fieldShiftAssignment.count({ where: { workerId: out.worker.id, templateId: tpl.id } })).toBe(1);

    await mk('Taken', '+6581000002');
    const reg2 = await db.fieldRegistration.create({ data: { organizationId: ORG, inviteId: inv.id, phone: '+6581000002', name: 'Late' } });
    await expect(svc.approveRegistration(ctx(), reg2.id)).rejects.toBeInstanceOf(ConflictException);
    expect((await db.fieldRegistration.findUnique({ where: { id: reg2.id } })).status).toBe('REJECTED');
  });

  it('a supervisor must pick a site they supervise and cannot hand out supervisor invites', async () => {
    const { svc } = await setup();
    const site = (await svc.createSite(ctx(), { name: 'Yard', lat: 1.3, lng: 103.8 })).site;
    const scoped = ctx({ access: computeFieldAccess({ isOsirisAdmin: false, roleNames: ['x'], supervises: true }), supervisedSiteIds: [] });
    await expect(svc.createInvite(scoped, { role: 'SUPERVISOR', siteId: site.id })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.createInvite(scoped, { siteId: site.id })).rejects.toThrow('Supervisors must pick a site they supervise');
  });
});

describe('photos on record (photos.router, office side)', () => {
  it('request -> (worker sends) -> approve makes it the photo on record and resets face data; reject re-requests', async () => {
    const { db, svc, mk } = await setup();
    const w = await mk('Pic', '+6582000001');
    await svc.requestPhoto(ctx(), w.id, { note: 'Clearer please' });
    expect((await db.fieldWorkerProfile.findUnique({ where: { workerId: w.id } })).verifyRequested).toBe(true);
    const req = await db.fieldPhotoUpdate.findFirst({ where: { workerId: w.id, status: 'REQUESTED' } });
    await db.fieldPhotoUpdate.update({ where: { id: req.id }, data: { status: 'PENDING', photoKey: 'k1' } }); // the app's submit (not ported)
    await svc.rejectPhoto(ctx(), req.id, { note: 'Blurry' });
    const again = await db.fieldPhotoUpdate.findFirst({ where: { workerId: w.id, status: 'REQUESTED' } });
    expect(again).toBeTruthy();
    await db.fieldPhotoUpdate.update({ where: { id: again.id }, data: { status: 'PENDING', photoKey: 'k2' } });
    await svc.approvePhoto(ctx(), again.id);
    const p = await db.fieldWorkerProfile.findUnique({ where: { workerId: w.id } });
    expect(p).toMatchObject({ photoKey: 'k2', faceDescriptor: [], verifyRequested: false });
    await expect(svc.requestPhoto(ctx({ workerId: w.id }), w.id, {})).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('linked orgs (lib/links.ts)', () => {
  it('links are symmetric and platform-admin only; shared workers follow NONE / ALL / SELECTED; own phones left out', async () => {
    const { db, svc, mk } = await setup();
    await expect(svc.link(ctx(), OTHER, false)).rejects.toBeInstanceOf(ForbiddenException);
    await svc.link(ctx(), OTHER, true);
    await svc.link(ctx({ organizationId: OTHER }), ORG, true); // repeat from the other side: no-op
    expect(await db.fieldOrgLink.count({})).toBe(1);
    const x = await mk('Shared X', '+6583000001', 'WORKER', OTHER);
    const y = await mk('Shared Y', '+6583000002', 'WORKER', OTHER);
    await mk('Also mine', '+6583000003', 'WORKER', OTHER);
    await mk('Also mine', '+6583000003'); // same phone here: left out
    expect((await svc.sharedWorkers(ctx())).workers).toHaveLength(0); // NONE
    await db.fieldSettings.create({ data: { organizationId: OTHER, shareWorkers: 'ALL' } });
    expect((await svc.sharedWorkers(ctx())).workers.map((w: any) => w.name)).toEqual(['Shared X', 'Shared Y']);
    await db.fieldSettings.update({ where: { organizationId: OTHER }, data: { shareWorkers: 'SELECTED' } });
    await db.fieldWorkerProfile.update({ where: { workerId: y.id }, data: { sharedWithLinked: true } });
    expect((await svc.sharedWorkers(ctx())).workers.map((w: any) => w.id)).toEqual([y.id]);
    void x;
    await svc.unlink(ctx(), OTHER, true);
    await expect(svc.unlink(ctx(), OTHER, true)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('field access presets (FIELD_PLAN.md §3.4)', () => {
  it('Admin all, Operations / Accounting presets, supervisor scoped, nothing for others', () => {
    const adm = computeFieldAccess({ isOsirisAdmin: false, roleNames: ['Admin'], supervises: false });
    expect(Object.values(adm.levels).every((l) => l === 'approve')).toBe(true);
    const ops = computeFieldAccess({ isOsirisAdmin: false, roleNames: ['Operations'], supervises: false });
    expect(ops.levels).toMatchObject({ punches: 'approve', timesheets: 'approve', leave: 'approve', payroll: 'none', people: 'view' });
    const acc = computeFieldAccess({ isOsirisAdmin: false, roleNames: ['Accounting'], supervises: false });
    expect(acc.levels).toMatchObject({ timesheets: 'view', payroll: 'edit', punches: 'none', leave: 'none' });
    const sales = computeFieldAccess({ isOsirisAdmin: false, roleNames: ['Sales'], supervises: false });
    expect(Object.values(sales.levels).every((l) => l === 'none')).toBe(true);
    const sup = computeFieldAccess({ isOsirisAdmin: false, roleNames: ['Sales'], supervises: true });
    expect(sup.scoped.punches && sup.scoped.timesheets).toBe(true);
    const opsSup = computeFieldAccess({ isOsirisAdmin: false, roleNames: ['Operations'], supervises: true });
    expect(opsSup.scoped.punches).toBe(false); // a company-wide grant wins
    expect(opsSup.scoped.payroll).toBe(false);
  });
});
