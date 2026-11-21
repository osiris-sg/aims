/** Field phase 5: leave (siteclock leave.router + lib/leave.ts @62b7d9d; e2e.ts 1215-1262, 2396-2420). */
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { computeFieldAccess } from '../common/field-access';
import type { FieldCtx } from '../common/field-context.service';
import { fakePrisma } from '../testing/fake-prisma';
import { FieldLeaveService, leaveDaysInYear } from './leave.service';

const ORG = 'org-1';
const ctx = (over: Partial<FieldCtx> = {}): FieldCtx => ({
  organizationId: ORG, userId: 'u-admin', userName: 'Admin', features: {}, timezone: 'Asia/Singapore',
  access: computeFieldAccess({ isOsirisAdmin: false, roleNames: ['Admin'], supervises: false }), workerId: null, supervisedSiteIds: [], supervisedWorkerIds: [], ...over,
});
const sup = (ids: string[]) => ctx({ access: computeFieldAccess({ isOsirisAdmin: false, roleNames: ['field-tech'], supervises: true }), supervisedWorkerIds: ids });

async function setup() {
  const db: any = fakePrisma();
  const svc = new FieldLeaveService(db);
  const w = await db.worker.create({ data: { organizationId: ORG, name: 'Leave Tester' } });
  const al = (await svc.createType(ctx(), { name: 'Annual', defaultDays: 14 })).type;
  const mc = (await svc.createType(ctx(), { name: 'Sick', defaultDays: 7, requiresDocument: true })).type;
  return { db, svc, w, al, mc };
}

describe('leave', () => {
  it('days in a year: calendar days, half day 0.5, clipped to the year', () => {
    expect(leaveDaysInYear({ startDate: '2026-03-02', endDate: '2026-03-04', halfDay: false }, 2026)).toBe(3);
    expect(leaveDaysInYear({ startDate: '2026-04-01', endDate: '2026-04-01', halfDay: true }, 2026)).toBe(0.5);
    expect(leaveDaysInYear({ startDate: '2025-12-30', endDate: '2026-01-02', halfDay: false }, 2026)).toBe(2);
    expect(leaveDaysInYear({ startDate: '2025-12-30', endDate: '2025-12-31', halfDay: false }, 2026)).toBe(0);
  });

  it('balance: 18 entitled, 3 taken, 15 left, 0.5 pending; editing; null falls back to the default (e2e.ts 2396-2410)', async () => {
    const { db, svc, w, al, mc } = await setup();
    await svc.setEntitlements(ctx(), w.id, { entitlements: { [al.id]: 18 } });
    await db.fieldLeaveRequest.create({ data: { organizationId: ORG, workerId: w.id, typeId: al.id, startDate: '2026-03-02', endDate: '2026-03-04', status: 'APPROVED' } });
    await db.fieldLeaveRequest.create({ data: { organizationId: ORG, workerId: w.id, typeId: al.id, startDate: '2026-04-01', endDate: '2026-04-01', halfDay: true, status: 'PENDING' } });
    const b = (await svc.balances(ctx(), { year: '2026', workerId: w.id })).workers[0].balances.find((x: any) => x.typeId === al.id);
    expect(b).toMatchObject({ entitled: 18, taken: 3, remaining: 15, pending: 0.5, custom: true });
    const put = await svc.setEntitlements(ctx(), w.id, { entitlements: { [al.id]: 21, [mc.id]: null } });
    expect(put.before).toEqual([{ typeId: al.id, days: 18 }]);
    const mcAfter = (await svc.balancesOf(ORG, w.id, 2026)).find((x: any) => x.typeId === mc.id);
    expect(mcAfter).toMatchObject({ entitled: 7, custom: false });
  });

  it('a type nobody used is deleted; a used one archived (kept on a balance only while days are taken); restore (e2e.ts 1215-1236)', async () => {
    const { db, svc, w, al, mc } = await setup();
    expect(await svc.deleteType(ctx(), al.id)).toMatchObject({ deleted: true, archived: false });
    await db.fieldLeaveRequest.create({ data: { organizationId: ORG, workerId: w.id, typeId: mc.id, startDate: '2026-02-02', endDate: '2026-02-02', status: 'REJECTED' } });
    expect(await svc.deleteType(ctx(), mc.id)).toMatchObject({ deleted: false, archived: true, requestCount: 1 });
    expect((await svc.types(ctx())).types).toHaveLength(0);
    expect((await svc.types(ctx(), '1')).types[0].archived).toBe(true);
    expect((await svc.balancesOf(ORG, w.id, 2026)).some((b: any) => b.typeId === mc.id)).toBe(false);
    await svc.restoreType(ctx(), mc.id);
    expect((await svc.types(ctx())).types).toHaveLength(1);
  });

  it('the office records leave: APPROVED and marked recorded, on the calendar, counted as taken; removed by cancel (e2e.ts 1239-1262)', async () => {
    const { svc, w, al } = await setup();
    const rec = await svc.record(ctx(), { workerId: w.id, typeId: al.id, startDate: '2026-01-05', endDate: '2026-01-06', reason: 'backfilled' });
    expect(rec.request).toMatchObject({ status: 'APPROVED', recorded: true, recordedByName: 'Admin' });
    expect((await svc.calendar(ctx(), { month: '2026-01' })).requests.map((r: any) => r.id)).toEqual([rec.request.id]);
    expect((await svc.balancesOf(ORG, w.id, 2026)).find((b: any) => b.typeId === al.id).taken).toBe(2);
    await expect(svc.record(sup([w.id]), { workerId: w.id, typeId: al.id, startDate: '2026-01-07', endDate: '2026-01-07' })).rejects.toBeInstanceOf(ForbiddenException);
    await svc.cancel(ctx(), rec.request.id);
    expect((await svc.calendar(ctx(), { month: '2026-01' })).requests).toHaveLength(0);
    await expect(svc.cancel(ctx(), rec.request.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('approve / reject only pending; a supervisor only for their people; no over-balance check, but the warning says by how much', async () => {
    const { db, svc, w, al } = await setup();
    const other = await db.worker.create({ data: { organizationId: ORG, name: 'Other' } });
    const big = await db.fieldLeaveRequest.create({ data: { organizationId: ORG, workerId: w.id, typeId: al.id, startDate: '2026-05-01', endDate: '2026-05-20', status: 'PENDING' } });
    const theirs = await db.fieldLeaveRequest.create({ data: { organizationId: ORG, workerId: other.id, typeId: al.id, startDate: '2026-05-01', endDate: '2026-05-01', status: 'PENDING' } });
    const listed = (await svc.requests(ctx(), { status: 'PENDING' })).requests.find((r: any) => r.id === big.id);
    expect(listed).toMatchObject({ days: 20, overBy: 6 });
    await expect(svc.decide(sup([w.id]), theirs.id, 'APPROVED')).rejects.toBeInstanceOf(NotFoundException);
    const ok = await svc.decide(sup([w.id]), big.id, 'APPROVED');
    expect(ok).toMatchObject({ request: { status: 'APPROVED', decidedByName: 'Admin' }, overBy: 6 });
    await expect(svc.decide(ctx(), big.id, 'REJECTED')).rejects.toBeInstanceOf(ConflictException);
    const acc = ctx({ access: computeFieldAccess({ isOsirisAdmin: false, roleNames: ['Accounting'], supervises: false }) });
    await expect(svc.decide(acc, theirs.id, 'APPROVED')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
