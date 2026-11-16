import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { buildVehicleLogHtml, paginate, ROWS_PER_PAGE } from './vehicle-log-html';
import { currentDriverOf, daysUntil, lastMileageOf, mileageWarnings, moneySummary, normalizeVehicleNo, parseAmount, parseYmd, planUsageConversion, reminderThreshold } from './vehicle-rules';

/**
 * WCT Vehicles (2026-11-12; log book 2026-11-16). The service runs on a small
 * in-memory Prisma; the flag, the Clerk names and the bell are stubbed.
 */
const ORG = 'org-wct';
const d = (s: string) => new Date(`${s}T00:00:00Z`);

function service(opts: { flag?: boolean; vehicles?: any[]; entries?: any[]; today?: string } = {}) {
  const vehicles: any[] = opts.vehicles ?? [];
  const entries: any[] = opts.entries ?? [];
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
  const withEntries = (r: any, include: any) => (include?.logEntries ? { ...r, logEntries: entries.filter((e) => e.vehicleId === r.id && !e.deletedAt) } : r);
  const table = (rows: any[]) => ({
    findFirst: jest.fn(async ({ where, include }: any) => {
      const r = rows.find((x) => match(x, where));
      return r ? withEntries(r, include) : null;
    }),
    findMany: jest.fn(async ({ where, include }: any = {}) => rows.filter((r) => match(r, where)).map((r) => withEntries(r, include))),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `id${++n}`, createdAt: new Date(Date.now() + n), updatedAt: new Date(), archivedAt: null, deletedAt: null, repairApprovedAt: null, repairApprovedBy: null, repairUnlocks: null, sourceUsageId: null, ...data };
      rows.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data)),
  });
  const prisma: any = {
    vehicle: table(vehicles),
    vehicleLogEntry: table(entries),
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
  return { svc, vehicles, entries, notify, actionLog };
}

describe('vehicle rules', () => {
  it('normalises the vehicle number and parses strict dates', () => {
    expect(normalizeVehicleNo(' gbd 1126 u ')).toBe('GBD1126U');
    expect(() => normalizeVehicleNo('  ')).toThrow(BadRequestException);
    expect(parseYmd('2026-02-28', 'x')!.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(() => parseYmd('2026-02-30', 'x')).toThrow(/must be a date/);
    expect(parseYmd('', 'x', false)).toBeNull();
  });

  it('log book: current driver = latest Driver assigned; last mileage = newest reading; lower mileage warns', () => {
    const rows: any[] = [
      { id: 'a', type: 'DRIVER', date: d('2026-10-01'), mileage: 50_000, amount: null, driverName: 'Ali' },
      { id: 'b', type: 'FUEL', date: d('2026-10-05'), mileage: 50_400, amount: 80 },
      { id: 'c', type: 'DRIVER', date: d('2026-11-01'), mileage: null, amount: null, driverName: 'Muthu' },
      { id: 'x', type: 'DRIVER', date: d('2026-12-01'), mileage: 99_999, amount: null, driverName: 'Gone', deletedAt: new Date() },
    ];
    expect(currentDriverOf(rows)!.driverName).toBe('Muthu');
    expect(lastMileageOf(rows)).toBe(50_400);
    expect(mileageWarnings(50_100, rows)[0]).toMatch(/lower than the latest recorded 50,400 km/);
    expect(mileageWarnings(50_400, rows)).toEqual([]);
    expect(mileageWarnings(null, rows)).toEqual([]);
  });

  it('money: this month / this year / all time, split by type; deleted entries do not count', () => {
    const rows: any[] = [
      { type: 'FUEL', date: d('2026-11-03'), mileage: null, amount: 80.5 },
      { type: 'REPAIR', date: d('2026-06-10'), mileage: null, amount: 420 },
      { type: 'RENEWAL', date: d('2025-12-20'), mileage: null, amount: 900 },
      { type: 'PARKING', date: d('2026-11-04'), mileage: null, amount: 4.2, deletedAt: new Date() },
      { type: 'DRIVER', date: d('2026-11-01'), mileage: 1, amount: null },
    ];
    const m = moneySummary(rows, '2026-11-16');
    expect(m.month).toMatchObject({ total: 80.5, byType: expect.objectContaining({ FUEL: 80.5, PARKING: 0 }) });
    expect(m.year.total).toBe(500.5);
    expect(m.all).toMatchObject({ total: 1400.5, byType: expect.objectContaining({ RENEWAL: 900, REPAIR: 420 }) });
    expect(parseAmount('1,234.567')).toBe(1234.57);
    expect(parseAmount('')).toBeNull();
    expect(() => parseAmount('-5')).toThrow(/amount/);
  });

  it('conversion of a usage row: Driver assigned on the start, an Other entry on the end, a repair with its approval', () => {
    const plan = planUsageConversion({
      id: 'u1', driverUserId: 'u-ali', driverName: 'Ali Tan', startDate: d('2026-11-01'), startMileage: 50_400, endDate: d('2026-11-05'), endMileage: 50_900,
      repairDetails: 'Rear bumper replaced', repairLoggedAt: new Date('2026-11-03T05:00:00Z'), repairApprovedBy: 'Admin Tan', repairApprovedById: 'u-admin', repairApprovedAt: d('2026-11-07'), repairUnlocks: [{ reason: 'x' }],
    });
    expect(plan.map((p) => [p.type, p.date.toISOString().slice(0, 10), p.mileage])).toEqual([['DRIVER', '2026-11-01', 50_400], ['OTHER', '2026-11-05', 50_900], ['REPAIR', '2026-11-03', null]]);
    expect(plan[2]).toMatchObject({ description: 'Rear bumper replaced', repairApprovedBy: 'Admin Tan', repairApprovedAt: d('2026-11-07'), repairUnlocks: [{ reason: 'x' }], sourceUsageId: 'u1' });
    // An open usage with no repair: one entry.
    expect(planUsageConversion({ id: 'u2', driverUserId: null, driverName: 'Elroy Lee', startDate: d('2026-11-16'), startMileage: 2200, endDate: null, endMileage: null, repairDetails: null, repairLoggedAt: null, repairApprovedBy: null, repairApprovedById: null, repairApprovedAt: null, repairUnlocks: null })).toHaveLength(1);
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

  it('Assign new driver: a picked user gets their AIMS name, a typed name works, a stranger is refused; the list shows the latest', async () => {
    const { svc } = service();
    const v = await svc.create({ vehicleNo: 'GBD1126U' }, ORG, { id: 'u1' });
    const first = await svc.addEntry(v.id, { type: 'DRIVER', driverUserId: 'u-ali', date: '2026-11-01', mileage: '50,400' }, ORG, { id: 'u1' });
    expect(first.entry).toMatchObject({ type: 'DRIVER', driverName: 'Ali Tan', driverUserId: 'u-ali', mileage: 50_400, typeLabel: 'Driver assigned', createdByName: 'Admin Tan' });
    await expect(svc.addEntry(v.id, { type: 'DRIVER', driverUserId: 'u-stranger', date: '2026-11-06' }, ORG, {})).rejects.toThrow(/not a user of this organisation/);
    await expect(svc.addEntry(v.id, { type: 'DRIVER', date: '2026-11-06' }, ORG, {})).rejects.toThrow(/Pick a driver/);
    const second = await svc.addEntry(v.id, { type: 'DRIVER', driverName: 'Muthu', date: '2026-11-06', mileage: 50_300 }, ORG, {});
    expect(second.entry.driverUserId).toBeNull();
    expect(second.warnings[0]).toMatch(/lower than the latest recorded 50,400 km/);
    const [row] = await svc.list(ORG);
    expect(row).toMatchObject({ currentDriver: 'Muthu', driverSince: '2026-11-06', lastMileage: 50_300 });
  });

  it('fuel, parking and renewals: amounts add up per year; a renewal with a new expiry updates the vehicle', async () => {
    const { svc, vehicles } = service();
    const v = await svc.create({ vehicleNo: 'X1', coeExpiry: '2027-01-15' }, ORG, {});
    const year = new Date().toISOString().slice(0, 4);
    await svc.addEntry(v.id, { type: 'FUEL', date: `${year}-01-03`, amount: '82.40', mileage: 1000 }, ORG, {});
    await expect(svc.addEntry(v.id, { type: 'PARKING', date: `${year}-01-04` }, ORG, {})).rejects.toThrow(/Enter the amount/);
    await svc.addEntry(v.id, { type: 'PARKING', date: `${year}-01-04`, amount: 3.6, description: 'ERP' }, ORG, {});
    const r = await svc.addEntry(v.id, { type: 'RENEWAL', renewalKind: 'COE', renewalExpiry: '2037-01-15', date: `${year}-01-05`, amount: 95000 }, ORG, {});
    expect(r.renewed).toEqual({ field: 'coeExpiry', label: 'COE', expiry: '2037-01-15' });
    expect(vehicles[0].coeExpiry.toISOString().slice(0, 10)).toBe('2037-01-15');
    await svc.addEntry(v.id, { type: 'RENEWAL', renewalKind: 'ROAD_TAX', renewalExpiry: '2027-06-30', date: `${year}-01-06`, amount: 700 }, ORG, {});
    await expect(svc.addEntry(v.id, { type: 'RENEWAL', date: `${year}-01-06` }, ORG, {})).rejects.toThrow(/what was renewed/);
    const got = await svc.get(v.id, ORG);
    expect(got.roadTaxExpiry).toBe('2027-06-30');
    expect(got.summary.year.total).toBe(95786);
    expect(got.summary.year.byType).toMatchObject({ FUEL: 82.4, PARKING: 3.6, RENEWAL: 95700 });
    expect(got.entries.map((e: any) => e.date)).toEqual([`${year}-01-06`, `${year}-01-05`, `${year}-01-04`, `${year}-01-03`]); // newest first
    const [row] = await svc.list(ORG);
    expect(row.spentThisYear).toBe(95786);
  });

  it('attachments must be this org\'s vehicles files; edit keeps the type; delete hides the entry', async () => {
    const { svc, entries } = service();
    const v = await svc.create({ vehicleNo: 'X3' }, ORG, {});
    await expect(svc.addEntry(v.id, { type: 'FUEL', date: '2026-11-01', amount: 50, attachment: { key: 'other-org/x.pdf' } }, ORG, {})).rejects.toThrow(/not a file of this organisation/);
    const bare = await svc.addEntry(v.id, { type: 'FUEL', date: '2026-11-01', amount: 20 }, ORG, {});
    expect(bare.entry.attachment).toBeNull();
    expect('attachment' in entries[0]).toBe(false); // nothing written when there is no file
    entries[0].attachment = {}; // an empty JSON value (dev tenancy client) still reads as no attachment
    expect((await svc.get(v.id, ORG)).entries[0].attachment).toBeNull();
    await svc.deleteEntry(bare.entry.id, ORG, {});
    entries.shift();
    const { entry } = await svc.addEntry(v.id, { type: 'FUEL', date: '2026-11-01', amount: 50, attachment: { key: `vehicles/${ORG}/log/r.pdf`, fileName: 'r.pdf', mimeType: 'application/pdf' } }, ORG, {});
    expect(entry.attachment).toEqual({ key: `vehicles/${ORG}/log/r.pdf`, fileName: 'r.pdf', mimeType: 'application/pdf' });
    const edited = await svc.editEntry(entry.id, { amount: 55.5, type: 'REPAIR' }, ORG);
    expect(edited.entry).toMatchObject({ type: 'FUEL', amount: 55.5, attachment: expect.objectContaining({ fileName: 'r.pdf' }) });
    await svc.deleteEntry(entry.id, ORG, { id: 'u1' });
    expect(entries[0].deletedAt).toBeInstanceOf(Date); // kept, hidden
    expect((await svc.get(v.id, ORG)).entries).toEqual([]);
    await expect(svc.editEntry(entry.id, { amount: 1 }, ORG)).rejects.toThrow(/not found/);
  });

  it('an approved repair is locked (no edit, no delete) until unlocked with a reason, which is kept', async () => {
    const { svc } = service();
    const v = await svc.create({ vehicleNo: 'X2' }, ORG, {});
    const fuel = await svc.addEntry(v.id, { type: 'FUEL', date: '2026-11-05', amount: 10 }, ORG, {});
    await expect(svc.approveRepair(fuel.entry.id, {}, ORG, { id: 'u-admin' })).rejects.toThrow(/Only a repair/);
    await expect(svc.addEntry(v.id, { type: 'REPAIR', date: '2026-11-05' }, ORG, {})).rejects.toThrow(/what was repaired/);
    const { entry } = await svc.addEntry(v.id, { type: 'REPAIR', date: '2026-11-05', vendor: 'Ah Seng Motor', description: 'Rear bumper dented, replaced', amount: 380 }, ORG, {});
    const ok = await svc.approveRepair(entry.id, { approvedDate: '2026-11-07' }, ORG, { id: 'u-admin' });
    expect(ok.entry).toMatchObject({ repairApprovedBy: 'Admin Tan', repairApprovedAt: '2026-11-07', repairLocked: true, details: 'Vendor: Ah Seng Motor. Rear bumper dented, replaced' });
    await expect(svc.editEntry(entry.id, { description: 'changed' }, ORG)).rejects.toThrow(/approved and locked/);
    await expect(svc.deleteEntry(entry.id, ORG, {})).rejects.toThrow(/approved and locked/);
    await expect(svc.approveRepair(entry.id, {}, ORG, { id: 'u-admin' })).rejects.toThrow(/already approved/);
    await expect(svc.unlockRepair(entry.id, { reason: ' ' }, ORG, { id: 'u-admin' })).rejects.toThrow(/reason/);
    const un = await svc.unlockRepair(entry.id, { reason: 'Wrong workshop invoice' }, ORG, { id: 'u-admin' });
    expect(un.entry).toMatchObject({ repairLocked: false, repairApprovedBy: null });
    expect(un.entry.repairUnlocks).toEqual([expect.objectContaining({ reason: 'Wrong workshop invoice', byName: 'Admin Tan', approvedBy: 'Admin Tan', approvedAt: '2026-11-07' })]);
    await svc.editEntry(entry.id, { description: 'Rear bumper replaced (invoice 1182)' }, ORG);
  });

  it('expiry reminders: once per threshold and date, logged as a system action', async () => {
    const today = new Date();
    const plus = (days: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days));
    const { svc, notify, actionLog } = service({
      vehicles: [
        { id: 'v1', organizationId: ORG, vehicleNo: 'GBD1126U', model: 'NV350', coeExpiry: plus(60), lifespanExpiry: plus(400), archivedAt: null },
        { id: 'v2', organizationId: ORG, vehicleNo: 'GBE2', model: null, coeExpiry: plus(-3), lifespanExpiry: plus(10), archivedAt: null },
        // Road tax / insurance / inspection (log book, 2026-11-16): the same 90 / 30-day bells.
        { id: 'v3', organizationId: ORG, vehicleNo: 'GBE3', model: null, coeExpiry: null, lifespanExpiry: null, roadTaxExpiry: plus(20), insuranceExpiry: plus(70), inspectionExpiry: plus(200), archivedAt: null },
      ],
    });
    // Singapore "today" may be a day ahead of UTC; the thresholds absorb it.
    const sent = await svc.runExpiryReminders(today);
    expect(sent.map((s) => `${s.vehicleId}:${s.which}:${s.threshold}`).sort()).toEqual(['v1:COE:90', 'v2:LIFESPAN:30', 'v3:INSURANCE:90', 'v3:ROAD_TAX:30']);
    expect(notify.emit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'VEHICLE_EXPIRY', linkUrl: '/portal/vehicles/v1' }));
    expect(notify.emit).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringMatching(/^Road tax of GBE3 expires on/) }));
    expect(actionLog.system).toHaveBeenCalledTimes(4);
    expect(await svc.runExpiryReminders(today)).toEqual([]);
  });
});

describe('the paper form', () => {
  const entry = (i: number) => ({ date: '2026-11-01', type: 'Fuel', details: i === 1 ? 'A & B <ok>' : null, driverName: `Driver ${i}`, mileage: 1000 + i, amount: 10.5, approvedBy: null, approvedAt: null });
  const html = (count: number) =>
    buildVehicleLogHtml({
      org: { name: 'WCT (S) Systems Pte Ltd', address: '1 Road' },
      vehicle: { vehicleNo: 'GBD1126U', model: 'Nissan NV350 Panel Van', coeExpiry: '2027-01-15', lifespanExpiry: '2035-03-01' },
      entries: Array.from({ length: count }, (_, i) => entry(i + 1)),
      printedOn: '2026-11-12',
    });

  it('every page repeats the header with its own page number; the last is padded and ends with the double-ruled total', () => {
    const out = html(ROWS_PER_PAGE + 3);
    expect(out.match(/VEHICLE \/ LORRY LOG BOOK/g)).toHaveLength(2);
    expect(out).toContain('Page No : 1 of 2');
    expect(out).toContain('Page No : 2 of 2');
    expect(out.match(/<tr>/g)!.length).toBe(2 * (ROWS_PER_PAGE + 1) - 1); // the total row has its own class
    expect(out.match(/class="tot"/g)).toHaveLength(1);
    expect(out).toContain(`>${(10.5 * (ROWS_PER_PAGE + 3)).toLocaleString('en-SG', { minimumFractionDigits: 2 })}<`);
    expect(out).toContain('15/01/2027');
    expect(out).toContain('A &amp; B &lt;ok&gt;');
  });

  it('a long text takes more lines, so fewer rows fit on that page', () => {
    const long = { driverName: 'Ali', details: 'x'.repeat(200) }; // 4 lines
    const short = { driverName: 'Ali', details: null };
    const pages = paginate([long, long, long, short, short]);
    expect(pages.map((p) => p.rows.length)).toEqual([3, 2]);
    expect(pages[1].spare).toBe(ROWS_PER_PAGE - 2 - 1); // one line kept for the total
  });

  it('an empty log still prints one blank form with a zero total', () => {
    const out = html(0);
    expect(out).toContain('Page No : 1 of 1');
    expect(out).toContain('>0.00<');
  });
});
