import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { buildVehicleLogHtml, paginate, ROWS_PER_PAGE } from './vehicle-log-html';
import { daysUntil, normalizeVehicleNo, parseYmd, reminderThreshold, startWarnings, endChecks, currentMileage } from './vehicle-rules';

/**
 * WCT Vehicles (2026-11-12). The service runs on a small in-memory Prisma; the
 * flag, the Clerk names and the bell are stubbed.
 */
const ORG = 'org-wct';
const d = (s: string) => new Date(`${s}T00:00:00Z`);

function service(opts: { flag?: boolean; vehicles?: any[]; usages?: any[]; today?: string } = {}) {
  const vehicles: any[] = opts.vehicles ?? [];
  const usages: any[] = opts.usages ?? [];
  const notifications: any[] = [];
  let n = 0;
  const match = (row: any, where: any = {}) =>
    Object.entries(where).every(([k, v]: [string, any]) => {
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('not' in v) return row[k] !== v.not;
        if ('in' in v) return v.in.includes(row[k]);
        return true;
      }
      return (row[k] ?? null) === v;
    });
  const table = (rows: any[]) => ({
    findFirst: jest.fn(async ({ where }: any) => rows.find((r) => match(r, where)) ?? null),
    findMany: jest.fn(async ({ where, include }: any = {}) =>
      rows.filter((r) => match(r, where)).map((r) => (include?.usages ? { ...r, usages: usages.filter((u) => u.vehicleId === r.id) } : r)),
    ),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `id${++n}`, createdAt: new Date(), updatedAt: new Date(), archivedAt: null, endDate: null, endMileage: null, repairDetails: null, repairApprovedAt: null, repairApprovedBy: null, repairUnlocks: null, ...data };
      rows.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data)),
  });
  const prisma: any = {
    vehicle: table(vehicles),
    vehicleUsage: table(usages),
    organizationUIConfig: {
      findUnique: async () => ({ features: { enableWctVehicles: opts.flag !== false } }),
      findMany: async () => (opts.flag !== false ? [{ organizationId: ORG }] : []),
    },
    accountingSetting: { findUnique: async () => ({ timeZone: 'Asia/Singapore' }) },
    userRole: { findFirst: async ({ where }: any) => (where.userId === 'u-ali' ? { userId: 'u-ali' } : null), findMany: async () => [] },
    notification: { findFirst: async ({ where }: any) => notifications.find((x) => x.entityId === where.entityId) ?? null },
  };
  const notify = { emit: jest.fn(async (p: any) => void notifications.push(p)) };
  const actionLog = { system: jest.fn() };
  const identity = { toClerkUsers: async (ids: string[]) => new Map(ids.map((id) => [id, { firstName: id === 'u-ali' ? 'Ali' : 'Admin', lastName: 'Tan', emailAddresses: [] }])) };
  const svc = new VehiclesService(prisma, { generatePdfFromHtml: jest.fn() } as any, notify as any, actionLog as any, identity as any);
  return { svc, vehicles, usages, notify, actionLog };
}

describe('vehicle rules', () => {
  it('normalises the vehicle number and parses strict dates', () => {
    expect(normalizeVehicleNo(' gbd 1126 u ')).toBe('GBD1126U');
    expect(() => normalizeVehicleNo('  ')).toThrow(BadRequestException);
    expect(parseYmd('2026-02-28', 'x')!.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(() => parseYmd('2026-02-30', 'x')).toThrow(/must be a date/);
    expect(parseYmd('', 'x', false)).toBeNull();
  });

  it('mileage going backwards warns; an end before the start blocks', () => {
    const prev = [{ startDate: d('2026-10-01'), startMileage: 50_000, endDate: d('2026-10-05'), endMileage: 50_400 }];
    expect(startWarnings(50_100, prev)[0]).toMatch(/lower than the last recorded 50,400 km/);
    expect(startWarnings(50_400, prev)).toEqual([]);
    expect(endChecks({ startDate: d('2026-11-01'), startMileage: 50_400 }, d('2026-11-02'), 50_300)[0]).toMatch(/lower than at start/);
    expect(() => endChecks({ startDate: d('2026-11-02'), startMileage: 1 }, d('2026-11-01'), 2)).toThrow(/cannot be before/);
    expect(currentMileage([...prev, { startDate: d('2026-11-01'), startMileage: 50_400, endDate: null, endMileage: null }])).toBe(50_400);
  });

  it('reminds at 90 then 30 days, never after expiry', () => {
    expect(daysUntil(d('2027-02-10'), '2026-11-12')).toBe(90);
    expect([120, 91, 90, 31, 30, 1, 0, -1].map(reminderThreshold)).toEqual([null, null, 90, 90, 30, 30, 30, null]);
  });
});

describe('VehiclesService', () => {
  it('is off unless the org has enableWctVehicles', async () => {
    const { svc } = service({ flag: false });
    await expect(svc.list(ORG)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a second active vehicle with the same number', async () => {
    const { svc } = service();
    await svc.create({ vehicleNo: 'GBD1126U', model: 'Nissan NV350 Panel Van', coeExpiry: '2027-01-15' }, ORG, { id: 'u1' });
    await expect(svc.create({ vehicleNo: 'gbd 1126u' }, ORG, { id: 'u1' })).rejects.toThrow(/already in the list/);
  });

  it('one open usage per vehicle; a picked driver gets their AIMS name; a typed name works', async () => {
    const { svc } = service();
    const v = await svc.create({ vehicleNo: 'GBD1126U' }, ORG, { id: 'u1' });
    const first = await svc.startUsage(v.id, { driverUserId: 'u-ali', startDate: '2026-11-01', startMileage: '50,400' }, ORG, { id: 'u1' });
    expect(first.usage).toMatchObject({ driverName: 'Ali Tan', driverUserId: 'u-ali', startMileage: 50_400, open: true });
    await expect(svc.startUsage(v.id, { driverName: 'Muthu', startDate: '2026-11-02', startMileage: 50_500 }, ORG, {})).rejects.toThrow(/already in use by Ali Tan since 2026-11-01/);
    await svc.endUsage(first.usage.id, { endDate: '2026-11-05', endMileage: 50_900 }, ORG);
    await expect(svc.startUsage(v.id, { driverUserId: 'u-stranger', startDate: '2026-11-06', startMileage: 1 }, ORG, {})).rejects.toThrow(/not a user of this organisation/);
    const second = await svc.startUsage(v.id, { driverName: 'Muthu', startDate: '2026-11-06', startMileage: 50_800 }, ORG, {});
    expect(second.usage.driverUserId).toBeNull();
    expect(second.warnings[0]).toMatch(/lower than the last recorded 50,900 km/);
  });

  it('end: lower mileage saves with a warning; an end before the start does not save', async () => {
    const { svc, usages } = service();
    const v = await svc.create({ vehicleNo: 'X1' }, ORG, {});
    const { usage } = await svc.startUsage(v.id, { driverName: 'Ali', startDate: '2026-11-05', startMileage: 1000 }, ORG, {});
    await expect(svc.endUsage(usage.id, { endDate: '2026-11-04', endMileage: 1200 }, ORG)).rejects.toThrow(/cannot be before/);
    expect(usages[0].endDate).toBeNull();
    const ended = await svc.endUsage(usage.id, { endDate: '2026-11-06', endMileage: 900 }, ORG);
    expect(ended.usage).toMatchObject({ endMileage: 900, open: false });
    expect(ended.warnings).toHaveLength(1);
    await expect(svc.endUsage(usage.id, { endDate: '2026-11-07', endMileage: 1000 }, ORG)).rejects.toThrow(/already ended/);
  });

  it('an approved repair is locked until unlocked with a reason, which is kept', async () => {
    const { svc } = service();
    const v = await svc.create({ vehicleNo: 'X2' }, ORG, {});
    const { usage } = await svc.startUsage(v.id, { driverName: 'Ali', startDate: '2026-11-05', startMileage: 1000 }, ORG, {});
    await expect(svc.approveRepair(usage.id, {}, ORG, { id: 'u-admin' })).rejects.toThrow(/no damage or repair logged/);
    await svc.logRepair(usage.id, { repairDetails: 'Rear bumper dented, replaced' }, ORG);
    const ok = await svc.approveRepair(usage.id, { approvedDate: '2026-11-07' }, ORG, { id: 'u-admin' });
    expect(ok.usage).toMatchObject({ repairApprovedBy: 'Admin Tan', repairApprovedAt: '2026-11-07', repairLocked: true });
    await expect(svc.logRepair(usage.id, { repairDetails: 'changed' }, ORG)).rejects.toThrow(/approved and locked/);
    await expect(svc.approveRepair(usage.id, {}, ORG, { id: 'u-admin' })).rejects.toThrow(/already approved/);
    await expect(svc.unlockRepair(usage.id, { reason: ' ' }, ORG, { id: 'u-admin' })).rejects.toThrow(/reason/);
    const un = await svc.unlockRepair(usage.id, { reason: 'Wrong workshop invoice' }, ORG, { id: 'u-admin' });
    expect(un.usage).toMatchObject({ repairLocked: false, repairApprovedBy: null });
    expect(un.usage.repairUnlocks).toEqual([expect.objectContaining({ reason: 'Wrong workshop invoice', byName: 'Admin Tan', approvedBy: 'Admin Tan', approvedAt: '2026-11-07' })]);
    await svc.logRepair(usage.id, { repairDetails: 'Rear bumper replaced (invoice 1182)' }, ORG);
  });

  it('expiry reminders: once per threshold and date, logged as a system action', async () => {
    const today = new Date();
    const plus = (days: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days));
    const { svc, notify, actionLog } = service({
      vehicles: [
        { id: 'v1', organizationId: ORG, vehicleNo: 'GBD1126U', model: 'NV350', coeExpiry: plus(60), lifespanExpiry: plus(400), archivedAt: null },
        { id: 'v2', organizationId: ORG, vehicleNo: 'GBE2', model: null, coeExpiry: plus(-3), lifespanExpiry: plus(10), archivedAt: null },
      ],
    });
    // Singapore "today" may be a day ahead of UTC; the thresholds absorb it.
    const sent = await svc.runExpiryReminders(today);
    expect(sent.map((s) => `${s.vehicleId}:${s.which}:${s.threshold}`).sort()).toEqual(['v1:COE:90', 'v2:LIFESPAN:30']);
    expect(notify.emit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'VEHICLE_EXPIRY', linkUrl: '/portal/vehicles/v1' }));
    expect(actionLog.system).toHaveBeenCalledTimes(2);
    expect(await svc.runExpiryReminders(today)).toEqual([]);
  });
});

describe('the paper form', () => {
  const usage = (i: number) => ({ driverName: `Driver ${i}`, startDate: '2026-11-01', startMileage: 1000 + i, endDate: null, endMileage: null, repairDetails: i === 1 ? 'A & B <ok>' : null, repairApprovedBy: null, repairApprovedAt: null });
  const html = (count: number) =>
    buildVehicleLogHtml({
      org: { name: 'WCT (S) Systems Pte Ltd', address: '1 Road' },
      vehicle: { vehicleNo: 'GBD1126U', model: 'Nissan NV350 Panel Van', coeExpiry: '2027-01-15', lifespanExpiry: '2035-03-01' },
      usages: Array.from({ length: count }, (_, i) => usage(i + 1)),
      printedOn: '2026-11-12',
    });

  it('every page repeats the header with its own page number; the last is padded with blank rows', () => {
    const out = html(ROWS_PER_PAGE + 3);
    expect(out.match(/VEHICLE \/ LORRY USAGE &amp; REPAIR FORM/g)).toHaveLength(2);
    expect(out).toContain('Page No : 1 of 2');
    expect(out).toContain('Page No : 2 of 2');
    expect(out.match(/<tr>/g)!.length).toBe(2 * (ROWS_PER_PAGE + 1));
    expect(out).toContain('15/01/2027');
    expect(out).toContain('A &amp; B &lt;ok&gt;');
  });

  it('a long repair text takes more lines, so fewer rows fit on that page', () => {
    const long = { driverName: 'Ali', repairDetails: 'x'.repeat(200) }; // 4 lines
    const short = { driverName: 'Ali', repairDetails: null };
    const pages = paginate([long, long, long, short, short]);
    expect(pages.map((p) => p.rows.length)).toEqual([3, 2]);
    expect(pages[1].spare).toBe(ROWS_PER_PAGE - 2);
  });

  it('an empty log still prints one blank form', () => {
    expect(html(0)).toContain('Page No : 1 of 1');
  });
});
