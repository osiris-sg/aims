/** Field phase 3: clock-in review (siteclock punches.router @62b7d9d; e2e.ts 2494-2510) and the gated auto-close cron. */
import { NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { computeFieldAccess } from '../common/field-access';
import type { FieldCtx } from '../common/field-context.service';
import { FieldAutoCloseCron } from '../engine/autoclose.cron';
import { fakePrisma } from '../testing/fake-prisma';
import { FieldPunchesService } from './punches.service';

const ORG = 'org-1';
const TZ = 'Asia/Singapore';
const at = (d: string, hm: string) => DateTime.fromFormat(`${d} ${hm}`, 'yyyy-MM-dd HH:mm', { zone: TZ }).toJSDate();
const ctx = (over: Partial<FieldCtx> = {}): FieldCtx => ({
  organizationId: ORG, userId: 'u', userName: 'Admin', features: {}, timezone: TZ,
  access: computeFieldAccess({ isOsirisAdmin: false, roleNames: ['Admin'], supervises: false }), workerId: null, supervisedSiteIds: [], supervisedWorkerIds: [], ...over,
});

async function setup() {
  const db: any = fakePrisma();
  const site = await db.fieldSite.create({ data: { organizationId: ORG, name: 'Block', lat: 1.3, lng: 103.8, timezone: TZ } });
  const [member, outsider] = [await db.worker.create({ data: { organizationId: ORG, name: 'Ben' } }), await db.worker.create({ data: { organizationId: ORG, name: 'Dan' } })];
  const tpl = await db.fieldShiftTemplate.create({ data: { organizationId: ORG, name: 'Day', startTime: '08:00', endTime: '17:00', daysOfWeek: [1, 2, 3, 4, 5] } });
  await db.fieldShiftAssignment.create({ data: { organizationId: ORG, templateId: tpl.id, workerId: member.id, startDate: '2026-01-01' } });
  const flag = (w: any, type: string, when: Date, flagReason = 'OUTSIDE_FENCE', status = 'FLAGGED') =>
    db.fieldPunch.create({ data: { organizationId: ORG, workerId: w.id, siteId: site.id, type, lat: 1.3, lng: 103.8, accuracyM: 10, distanceM: 900, insideFence: false, serverTime: when, status, flagReason } });
  return { db, site, member, outsider, flag, svc: new FieldPunchesService(db) };
}

describe('clock-in review', () => {
  it('a missed clock-in says the start is needed and suggests the shift start', async () => {
    const { flag, member, svc } = await setup();
    await flag(member, 'OUT', at('2026-02-02', '17:30'), 'OUT_WITHOUT_IN');
    const [p] = (await svc.flagged(ctx())).punches;
    expect(p.needsClockIn).toBe(true);
    expect(new Date(p.suggestedClockInAt).getTime()).toBe(at('2026-02-02', '08:00').getTime());
    expect(p.worker.name).toBe('Ben');
    expect(p).not.toHaveProperty('deviceId');
  });
  it("a team supervisor sees and approves their member's flagged punch, not an outsider's", async () => {
    const { flag, member, outsider, svc } = await setup();
    const pb = await flag(member, 'IN', at('2026-02-02', '08:00'));
    const pd = await flag(outsider, 'IN', at('2026-02-02', '08:00'));
    const lead = ctx({ access: computeFieldAccess({ isOsirisAdmin: false, roleNames: ['field-tech'], supervises: true }), supervisedWorkerIds: [member.id] });
    const seen = (await svc.flagged(lead)).punches.map((p: any) => p.id);
    expect(seen).toEqual([pb.id]);
    await expect(svc.approve(lead, pd.id, {})).rejects.toBeInstanceOf(NotFoundException);
    expect((await svc.approve(lead, pb.id, {})).punch.status).toBe('APPROVED');
    await expect(svc.approve(lead, pb.id, {})).rejects.toThrow('Punch not pending review');
  });
  it('marked = OK punches with a location flag; a missed clock-in without a start is refused with CLOCK_IN_REQUIRED', async () => {
    const { flag, member, svc } = await setup();
    await flag(member, 'IN', new Date(), 'OUTSIDE_FENCE', 'OK');
    await flag(member, 'IN', new Date(), 'MOCKED', 'OK');
    expect((await svc.marked(ctx())).punches).toHaveLength(1);
    const out = await flag(member, 'OUT', at('2026-02-03', '17:30'), 'OUT_WITHOUT_IN');
    await expect(svc.approve(ctx(), out.id, {})).rejects.toMatchObject({ response: { code: 'CLOCK_IN_REQUIRED' } });
  });
  it('a selfie still in SiteClock is not served', async () => {
    const { db, member, site, svc } = await setup();
    const p = await db.fieldPunch.create({ data: { organizationId: ORG, workerId: member.id, siteId: site.id, type: 'IN', lat: 1, lng: 1, accuracyM: 1, distanceM: 1, insideFence: true, photoKey: 'siteclock:punches/x.jpg' } });
    await expect(svc.photo(ctx(), p.id)).rejects.toThrow('still in SiteClock');
  });
});

describe('auto-close cron gating (FIELD_PLAN.md §2)', () => {
  it('only orgs with enableFieldModule AND fieldEngineLive', async () => {
    const db: any = fakePrisma();
    await db.organizationUIConfig.create({ data: { organizationId: 'a', features: { enableFieldModule: true, fieldEngineLive: true } } });
    await db.organizationUIConfig.create({ data: { organizationId: 'b', features: { enableFieldModule: true, enableFieldPunches: true } } });
    await db.organizationUIConfig.create({ data: { organizationId: 'c', features: { fieldEngineLive: true } } });
    await db.organizationUIConfig.create({ data: { organizationId: 'd', features: {} } });
    const cron = new FieldAutoCloseCron(db, { system: jest.fn() } as any);
    expect(await cron.liveOrgs()).toEqual(['a']);
  });
});
