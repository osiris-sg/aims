import { PrismaClient } from '@prisma/client';
import { MaintenanceReportsService } from './maintenance-reports.service';

// Pending Sign list (2026-11-02): status=draft must exclude ONLY WCT scheduled
// drafts (serviceData.scheduled === true). The old filter,
// NOT { serviceData: { path: ['scheduled'], equals: true } }, is NULL in
// Postgres when the key is missing and dropped every ordinary draft.
// Needs a real Postgres with the schema pushed: TEST_DATABASE_URL=... (skipped otherwise).
const url = process.env.TEST_DATABASE_URL;
const maybe = url ? describe : describe.skip;

maybe('findAllService status=draft against a real Postgres', () => {
  // Created in beforeAll: a skipped describe still runs its body, and a
  // PrismaClient without a URL throws.
  let prisma: PrismaClient;
  const svc = Object.create(MaintenanceReportsService.prototype) as MaintenanceReportsService;
  let orgId = '';
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    (svc as any).prisma = prisma;
    const org = await prisma.organization.create({ data: { name: `pending-sign-test-${Date.now()}` } });
    orgId = org.id;
    const mk = async (key: string, data: Record<string, unknown>) => {
      const r = await prisma.maintenanceServiceReport.create({
        data: { organizationId: orgId, technicianUserId: 'tech-1', description: key, kind: 'SERVICE', ...data } as any,
        select: { id: true },
      });
      ids[key] = r.id;
    };
    await mk('noServiceData', { status: 'draft' });
    await mk('noKey', { status: 'draft', serviceData: { customerName: 'Acme' } });
    await mk('scheduledFalse', { status: 'draft', serviceData: { scheduled: false } });
    await mk('scheduledNull', { status: 'draft', serviceData: { scheduled: null } });
    await mk('scheduledTrue', { status: 'draft', serviceData: { scheduled: true } });
    await mk('completed', { status: 'completed', serviceData: {} });
  });

  afterAll(async () => {
    if (orgId) {
      await prisma.maintenanceServiceReport.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    }
    await prisma?.$disconnect();
  });

  it('Pending Sign keeps drafts with no key / false / null, drops only scheduled: true', async () => {
    const res = await svc.findAllService(orgId, 1, 50, undefined, 'draft');
    const got = new Set(res.docs.map((d: any) => d.id));
    expect(got).toEqual(new Set([ids.noServiceData, ids.noKey, ids.scheduledFalse, ids.scheduledNull]));
    expect(res.total).toBe(4);
  });

  it('the office list (no status filter) still shows every report', async () => {
    const res = await svc.findAllService(orgId, 1, 50);
    expect(res.total).toBe(6);
  });

  it('the OLD filter really dropped every unscheduled draft (the bug)', async () => {
    const old = await prisma.maintenanceServiceReport.findMany({
      where: { organizationId: orgId, kind: 'SERVICE', status: 'draft', NOT: { serviceData: { path: ['scheduled'], equals: true } } },
      select: { id: true },
    });
    expect(old.map((r) => r.id)).not.toContain(ids.noServiceData);
    expect(old.map((r) => r.id)).not.toContain(ids.noKey);
  });
});
