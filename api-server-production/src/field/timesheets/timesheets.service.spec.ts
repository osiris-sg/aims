/** Field phase 4: timesheets (siteclock timesheets.router @62b7d9d; e2e.ts refs per test). */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { computeFieldAccess } from '../common/field-access';
import type { FieldCtx } from '../common/field-context.service';
import { fakePrisma } from '../testing/fake-prisma';
import { EXPORT_HEADERS, FieldTimesheetsService } from './timesheets.service';

const ORG = 'org-1';
const TZ = 'Asia/Singapore';
const at = (d: string, hm: string) => DateTime.fromFormat(`${d} ${hm}`, 'yyyy-MM-dd HH:mm', { zone: TZ }).toJSDate();
const ctx = (over: Partial<FieldCtx> = {}): FieldCtx => ({
  organizationId: ORG, userId: 'u-admin', userName: 'Admin', features: {}, timezone: TZ,
  access: computeFieldAccess({ isOsirisAdmin: false, roleNames: ['Admin'], supervises: false }), workerId: null, supervisedSiteIds: [], supervisedWorkerIds: [], ...over,
});

async function setup() {
  const db: any = fakePrisma();
  const site = await db.fieldSite.create({ data: { organizationId: ORG, name: 'Block', lat: 1.3, lng: 103.8, timezone: TZ } });
  await db.fieldSettings.create({ data: { organizationId: ORG } });
  await db.fieldOvertimeRule.create({ data: { organizationId: ORG } });
  await db.fieldBreakRule.create({ data: { organizationId: ORG } });
  const mk = (name: string) => db.worker.create({ data: { organizationId: ORG, name } });
  const entry = (w: any, d: string, data: Record<string, unknown> = {}) =>
    db.fieldTimeEntry.create({ data: { organizationId: ORG, workerId: w.id, siteId: site.id, workDate: d, clockInAt: at(d, '09:00'), clockOutAt: at(d, '17:00'), status: 'PENDING', regularMinutes: 480, otMinutes: 0, ...data } });
  return { db, site, mk, entry, svc: new FieldTimesheetsService(db) };
}

describe('timesheets', () => {
  it('team filter uses membership on each work date, not today (e2e.ts 2470-2476); the export names the team of that date', async () => {
    const { db, mk, entry, svc } = await setup();
    const [a, c] = [await mk('Team Ann'), await mk('Team Cal')];
    const team = await db.workerTeam.create({ data: { organizationId: ORG, name: 'Crew' } });
    await db.fieldTeamStint.create({ data: { organizationId: ORG, teamId: team.id, workerId: a.id, startDate: '2026-01-01', endDate: '2026-01-31' } });
    await db.fieldTeamStint.create({ data: { organizationId: ORG, teamId: team.id, workerId: c.id, startDate: '2026-02-01' } });
    const e1 = await entry(a, '2026-01-10');
    await entry(a, '2026-02-10');
    await entry(c, '2026-01-10');
    const e4 = await entry(c, '2026-02-10');
    const ids = (await svc.list(ctx(), { teamId: team.id, from: '2026-01-01', to: '2026-02-28' })).entries.map((e: any) => e.id).sort();
    expect(ids).toEqual([e1.id, e4.id].sort());
    const ex = await svc.exportRows(ctx(), { teamId: team.id, from: '2026-01-01', to: '2026-02-28' });
    expect(ex.headers).toEqual(EXPORT_HEADERS);
    expect(ex.headers[ex.headers.length - 1]).toBe('team');
    expect(ex.rows).toHaveLength(2);
    expect(ex.rows.every((r: any[]) => r[17] === 'Crew')).toBe(true);
  });

  it('edit recomputes, keeps the original times once, clears the approval; NLB approve / dismiss (e2e.ts 896-933)', async () => {
    const { db, mk, svc, site } = await setup();
    const w = await mk('Worker');
    const m = await svc.manual(ctx(), { workerId: w.id, siteId: site.id, clockInAt: at('2026-02-02', '08:25').toISOString(), clockOutAt: at('2026-02-02', '18:25').toISOString() });
    expect(m.entry).toMatchObject({ status: 'PENDING', grossMinutes: 600, editNote: 'manual entry', editedByName: 'Admin' });
    await svc.decide(ctx(), m.entry.id, 'APPROVED');
    const ed = await svc.edit(ctx(), m.entry.id, { clockOutAt: at('2026-02-02', '19:00').toISOString(), note: 'stayed late' });
    expect(ed.entry).toMatchObject({ grossMinutes: 635, status: 'PENDING', approvedById: null, editNote: 'stayed late' });
    expect(ed.entry.origClockOutAt.getTime()).toBe(at('2026-02-02', '18:25').getTime());
    const again = await svc.edit(ctx(), m.entry.id, { clockOutAt: at('2026-02-02', '18:00').toISOString() });
    expect(again.entry.origClockOutAt.getTime()).toBe(at('2026-02-02', '18:25').getTime()); // kept from the first edit
    await db.fieldTimeEntry.update({ where: { id: m.entry.id }, data: { nlbClaimed: true } });
    expect((await svc.edit(ctx(), m.entry.id, { nlb: true })).entry).toMatchObject({ nlb: true, nlbClaimed: false });
  });

  it('approve / reject only PENDING or AUTO_CLOSED; Accounting views but cannot approve', async () => {
    const { mk, entry, svc } = await setup();
    const w = await mk('W');
    const auto = await entry(w, '2026-02-03', { status: 'AUTO_CLOSED' });
    expect((await svc.decide(ctx(), auto.id, 'APPROVED')).entry).toMatchObject({ status: 'APPROVED', approvedByName: 'Admin' });
    await expect(svc.decide(ctx(), auto.id, 'REJECTED')).rejects.toBeInstanceOf(ConflictException);
    const acc = ctx({ access: computeFieldAccess({ isOsirisAdmin: false, roleNames: ['Accounting'], supervises: false }) });
    await expect(svc.decide(acc, (await entry(w, '2026-02-04')).id, 'APPROVED')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('bulk approve skips entries held for review and says so (the SiteClock oddity, counted)', async () => {
    const { mk, entry, svc } = await setup();
    const w = await mk('W');
    const ok = await entry(w, '2026-02-05');
    const held = await entry(w, '2026-02-06', { needsReview: true });
    const done = await entry(w, '2026-02-07', { status: 'APPROVED' });
    const out = await svc.approveBulk(ctx(), { entryIds: [ok.id, held.id, done.id, 'nope'] });
    expect(out.results).toEqual({ [ok.id]: 'APPROVED', [held.id]: 'NEEDS_REVIEW', [done.id]: 'NOT_PENDING', nope: 'NOT_FOUND' });
    expect(out.counts).toMatchObject({ approved: 1, needsReview: 1 });
  });

  it('reopen removes the clock-out punches and makes the day OPEN; delete is Admin only and takes the punches', async () => {
    const { db, mk, entry, svc, site } = await setup();
    const w = await mk('W');
    const e = await entry(w, '2026-02-09', { grossMinutes: 480 });
    for (const type of ['IN', 'OUT']) await db.fieldPunch.create({ data: { organizationId: ORG, workerId: w.id, siteId: site.id, type, lat: 1, lng: 1, accuracyM: 1, distanceM: 1, insideFence: true, timeEntryId: e.id } });
    const r = await svc.reopen(ctx(), e.id);
    expect(r.entry).toMatchObject({ status: 'OPEN', clockOutAt: null, grossMinutes: null });
    expect(await db.fieldPunch.count({ where: { timeEntryId: e.id } })).toBe(1);
    await expect(svc.reopen(ctx(), e.id)).rejects.toThrow('Entry has no clock-out');
    const ops = ctx({ access: computeFieldAccess({ isOsirisAdmin: false, roleNames: ['Operations'], supervises: false }) });
    await expect(svc.remove(ops, e.id)).rejects.toBeInstanceOf(ForbiddenException);
    await svc.remove(ctx(), e.id);
    expect(await db.fieldPunch.count({ where: { timeEntryId: e.id } })).toBe(0);
  });

  it("a supervisor's timesheets are their team's; a manual entry for someone else is refused (e2e.ts 2505-2506)", async () => {
    const { mk, entry, svc, site } = await setup();
    const [b, d] = [await mk('Ben'), await mk('Dan')];
    await entry(b, '2026-02-10');
    await entry(d, '2026-02-10');
    const lead = ctx({ access: computeFieldAccess({ isOsirisAdmin: false, roleNames: ['field-tech'], supervises: true }), supervisedWorkerIds: [b.id] });
    expect((await svc.list(lead, {})).entries.map((e: any) => e.worker.name)).toEqual(['Ben']);
    await expect(svc.manual(lead, { workerId: d.id, siteId: site.id, clockInAt: at('2026-02-11', '09:00').toISOString(), clockOutAt: at('2026-02-11', '10:00').toISOString() })).rejects.toThrow('Not your site or team');
  });

  it("shared hours: our workers on a linked org's jobs and theirs on ours (links.router hours / lent; e2e.ts 3729-3735)", async () => {
    const { db, mk, entry, svc } = await setup();
    const w = await mk('Lent');
    await db.organization.create({ data: { id: 'org-2', name: 'Partner' } });
    await entry(w, '2026-02-12', { workedFor: { 'org-2': 90 }, grossMinutes: 180 });
    const lent = await svc.linkedHours(ctx(), { from: '2026-02-01', to: '2026-02-28', direction: 'lent' });
    expect(lent.rows).toEqual([expect.objectContaining({ name: 'Lent', organizationName: 'Partner', minutes: 90, grossMinutes: 180 })]);
    const partner = ctx({ organizationId: 'org-2' });
    const borrowed = await svc.linkedHours(partner, { from: '2026-02-01', to: '2026-02-28' });
    expect(borrowed.rows).toEqual([expect.objectContaining({ minutes: 90, organizationId: ORG })]);
    await expect(svc.linkedHours(ctx(), { from: '2026-01-01', to: '2026-06-01' })).rejects.toThrow('At most 92 days');
  });
});
