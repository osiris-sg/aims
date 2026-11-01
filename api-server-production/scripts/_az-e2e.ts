/**
 * Round AZ end-to-end on the DEV database, over HTTP, with the ADH Admin role's permissions: Clients → Logistics (the
 * typed list, + Add company with several types, a known line keeps its type, Jinjiang / RCL prefixes) and due dates
 * with a switch-on day (dueSince on the Overall process; nothing older is overdue or a task), with the real
 * controllers, tenancy and Activity Log interceptor. Header x-test-role: readonly drops shipments:update.
 *
 *   TENANCY_MODE=per-org npx ts-node -r tsconfig-paths/register --transpile-only scripts/_az-e2e.ts
 *
 * The dev flag is put back as it was; the "E2E AZ …" logistics company stays as a test row (nothing is deleted).
 * Refuses PROD_DATABASE_URL's host.
 */
import 'dotenv/config';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Module, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import configuration from '../config/configuration';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
import { TenantContextInterceptor } from '../src/common/tenancy/tenant-context.interceptor';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { ActionLogInterceptor } from '../src/action-log/action-log.interceptor';
import { ClerkModule } from '../src/clerk/clerk.module';
import { PushModule } from '../src/push/push.module';
import { PushService } from '../src/push/push.service';
import { ShipmentsModule } from '../src/shipments/shipments.module';
import { ClerkAuthGuard } from '../src/auth/clerk-auth.guard';
import { PERMISSIONS_KEY } from '../src/auth/decorators/permissions.decorator';
import { StaffWhatsAppService } from '../src/staff-whatsapp/staff-whatsapp.service';

const ORG = '222c6494-96ae-42d0-9283-1b5eabf47b42'; // dev Asia Deal Hub Japan
// The prod ADH Admin role (round AW, read 2026-10-31): ADH Manager + organizations:update.
const ADH_ADMIN = 'audit:read,customers:create,customers:create-by-name,customers:delete,customers:read,customers:read-one,customers:update,documentTemplates:read,documentTemplates:read-one,documents:create-basic,documents:create-revision,documents:create-with-timeline,documents:delete,documents:generate-pdf,documents:payment-summary,documents:read,documents:read-by-asset,documents:read-by-inventory,documents:read-one,documents:send-email,documents:tag-template-to-asset,documents:untag-template-from-asset,documents:update,payments:create,payments:delete,payments:read,payments:update,roles:read,shipments:create,shipments:delete,shipments:money,shipments:read,shipments:update,suppliers:create,suppliers:delete,suppliers:read,suppliers:read-one,suppliers:update,uploads:upload-image,users:assign-role,users:create,users:delete,users:read,users:read-roles,users:remove-role,users:update,organizations:update'.split(',');
const USER = { id: 'user_e2e_az_admin', firstName: 'Take', lastName: '(e2e)', emailAddresses: [{ emailAddress: 'e2e-admin@example.test' }] };

@Injectable()
class AdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    req.user = USER;
    req.userOrganization = { id: ORG, name: 'Asia Deal Hub Japan LLC' };
    const perms = req.headers['x-test-role'] === 'readonly' ? ADH_ADMIN.filter((p) => p !== 'shipments:update') : ADH_ADMIN;
    const need: string[] = this.reflector.get(PERMISSIONS_KEY, ctx.getHandler()) ?? [];
    if (!need.every((r) => perms.includes(r))) throw new ForbiddenException('Insufficient permissions');
    return true;
  }
}

@Module({
  imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ClerkModule, PushModule, ActionLogModule, ShipmentsModule],
  providers: [PrismaService, { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor }, { provide: APP_INTERCEPTOR, useClass: ActionLogInterceptor }, { provide: APP_GUARD, useClass: AdminGuard }],
})
class E2E {}

let failures = 0;
const check = (label: string, ok: boolean, got?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  → got ${JSON.stringify(got)?.slice(0, 400)}`}`);
};
const noop = new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : async () => undefined) });
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const url = process.env.DATABASE_URL || '';
  const prod = (process.env.PROD_DATABASE_URL || '').replace(/["\r]/g, '');
  if (prod && new URL(url).host === new URL(prod).host) throw new Error('Refusing: DATABASE_URL is the prod database');
  const mod = await Test.createTestingModule({ imports: [E2E] })
    .overrideGuard(ClerkAuthGuard)
    .useValue({ canActivate: () => true })
    .overrideProvider(StaffWhatsAppService)
    .useValue(noop)
    .overrideProvider(PushService)
    .useValue(noop)
    .compile();
  const app = mod.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } }));
  await app.init();
  const http = app.getHttpServer();
  const prisma: any = mod.get(PrismaService);
  const started = new Date();

  // ── Logistics ──
  const l0 = await request(http).get('/trade-clients/logistics');
  const P = (b: any) => (b?.partners ?? []) as any[];
  check('logistics: 200, typed list incl. the known lines and Jinjiang', l0.status === 200 && P(l0.body).some((p) => p.code === 'JINJIANG' && p.types.includes('SHIPPING_LINE')) && P(l0.body).every((p) => Array.isArray(p.types) && p.types.length), { status: l0.status, codes: P(l0.body).map((p) => p.code) });
  check('logistics: the old /shipping-lines path answers the same list', (await request(http).get('/trade-clients/shipping-lines')).body?.partners?.length === P(l0.body).length);
  const name = `E2E AZ Warehouse ${Date.now().toString(36)}`;
  const ro = await request(http).post('/trade-clients/logistics').set('x-test-role', 'readonly').send({ name, types: ['WAREHOUSE'] });
  check('adding needs shipments:update (403 without)', ro.status === 403, ro.status);
  const add = await request(http).post('/trade-clients/logistics').send({ name, nameJa: 'テスト倉庫', types: ['TRUCKING', 'WAREHOUSE'], emailDomains: 'e2e-az.example', trackingUrl: 'https://x.example', freeTime: { detDays: 4 }, agents: [{ name: 'Tanaka', company: 'Yokohama office', email: 'tanaka@e2e-az.example' }] });
  const mine = P(add.body).find((p) => p.code === add.body?.code);
  check('+ Add company: several types in process order, no tracking / free time for a non-line, e-mail count', add.status === 201 && JSON.stringify(mine?.types) === JSON.stringify(['WAREHOUSE', 'TRUCKING']) && mine?.trackingUrl === null && mine?.freeTime === null && mine?.emails === 0 && mine?.agents?.length === 1, { status: add.status, mine, msg: add.body?.message });
  const bad = await request(http).patch('/trade-clients/logistics/WANHAI').send({ types: ['FORWARDER'] });
  check('a known shipping line keeps the Shipping line type (400)', bad.status === 400, bad.body);
  const none = await request(http).post('/trade-clients/logistics').send({ name: `${name} 2`, types: [] });
  check('no type → 400', none.status === 400, none.status);
  const upd = await request(http).patch(`/trade-clients/logistics/${add.body?.code}`).send({ types: ['WAREHOUSE', 'TRUCKING', 'CUSTOMS_BROKER'], notes: 'e2e' });
  const mine2 = P(upd.body).find((p) => p.code === add.body?.code);
  check('edit: a third type; fields not sent are kept', upd.status === 200 && mine2?.types?.length === 3 && mine2?.nameJa === 'テスト倉庫' && mine2?.agents?.length === 1, mine2);

  // ── Due dates with a switch-on day ──
  const ui: any = await prisma.organizationUIConfig.findUnique({ where: { organizationId: ORG }, select: { features: true } });
  const feat0 = ui?.features ?? {};
  const order: any = await runAsOrg(ORG, () => prisma.tradeOrder.findFirst({ where: { organizationId: ORG, status: 'OPEN', shipments: { some: { status: 'OPEN', eta: { not: null } } } }, select: { id: true, orderNo: true } }));
  try {
    await prisma.organizationUIConfig.update({ where: { organizationId: ORG }, data: { features: { ...feat0, enableStepDueDates: true, stepDueDatesSince: '2099-01-01' } } });
    const p1 = await request(http).get(`/trade-orders/${order.id}/process`);
    const cells = (p1.body?.rows ?? []).flatMap((r: any) => Object.values(r.cells ?? {})) as any[];
    check('switch-on day in the future: dates shown, nothing overdue, nothing flagged', p1.status === 200 && p1.body?.dueSince === '2099-01-01' && p1.body?.overdue === 0 && cells.some((c) => c.due) && cells.every((c) => c.state !== 'overdue' && c.flagged === false), { overdue: p1.body?.overdue, since: p1.body?.dueSince });
    const t1 = await request(http).get('/trade-alerts/my-tasks');
    const stepTasks = (Array.isArray(t1.body) ? t1.body : t1.body?.tasks ?? []).filter((x: any) => x.kind === 'STEP_DUE');
    check('… and no step tasks', t1.status === 200 && stepTasks.length === 0, { status: t1.status, n: stepTasks.length });
    await prisma.organizationUIConfig.update({ where: { organizationId: ORG }, data: { features: { ...feat0, enableStepDueDates: true, stepDueDatesSince: '2000-01-01' } } });
    const p2 = await request(http).get(`/trade-orders/${order.id}/process`);
    check('switch-on day long ago: the rule dates count as before (round AY behaviour)', p2.status === 200 && p2.body?.dueSince === '2000-01-01' && (p2.body?.rows ?? []).flatMap((r: any) => Object.values(r.cells ?? {})).some((c: any) => c.due && c.flagged), p2.body?.overdue);
  } finally {
    await prisma.organizationUIConfig.update({ where: { organizationId: ORG }, data: { features: feat0 } });
  }
  const back: any = await prisma.organizationUIConfig.findUnique({ where: { organizationId: ORG }, select: { features: true } });
  check('dev flag back as it was', JSON.stringify(back?.features) === JSON.stringify(feat0));

  // ── Activity Log ──
  await settle(2500);
  const rows: any[] = await runAsOrg(ORG, () => prisma.actionLog.findMany({ where: { organizationId: ORG, actorId: USER.id, createdAt: { gte: started } }, orderBy: { createdAt: 'asc' } }));
  check('Activity Log: + Add company is a CREATE, the edit an UPDATE', rows.some((r) => r.method === 'POST' && r.path === '/trade-clients/logistics' && r.action === 'CREATE' && r.status === 'SUCCESS') && rows.some((r) => r.method === 'PATCH' && /\/trade-clients\/logistics\/E2E_AZ/.test(r.path) && r.status === 'SUCCESS'), rows.map((r) => `${r.method} ${r.path} ${r.action} ${r.status}`));

  await app.close();
  console.log(`\n${failures ? `${failures} FAILED` : 'ALL PASS'} — dev flag as it was; the E2E AZ company stays as a test row`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
