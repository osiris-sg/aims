/**
 * Round AV end-to-end on the DEV database, over HTTP, as an ADH Sales user: the Answer flow's "+ New shipment"
 * and edit drawer calls with the real controllers, validation, tenancy and Activity Log interceptor. The auth
 * guard is a stand-in that applies the ADH Sales role's permissions (the prod role's list, as ClerkAuthGuard
 * checks them) — header x-test-role: nocreate drops shipments:create / update.
 *
 *   TENANCY_MODE=per-org npx ts-node -r tsconfig-paths/register --transpile-only scripts/_av-sales-flow-e2e.ts
 *
 * Dev writes: one test email (left HIDDEN), one test shipment on the dev ADH org's newest order without a
 * shipment (left CANCELLED), their Activity Log rows. Refuses PROD_DATABASE_URL's host.
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
import { IngestionEmailModule } from '../src/ingestion-email/ingestion-email.module';
import { ClerkAuthGuard } from '../src/auth/clerk-auth.guard';
import { PERMISSIONS_KEY } from '../src/auth/decorators/permissions.decorator';
import { StaffWhatsAppService } from '../src/staff-whatsapp/staff-whatsapp.service';

const ORG = '222c6494-96ae-42d0-9283-1b5eabf47b42'; // dev Asia Deal Hub Japan
// The prod ADH Sales role's permissions (read 2026-10-31).
const ADH_SALES = 'customers:create,customers:create-by-name,customers:delete,customers:read,customers:read-one,customers:update,documentTemplates:read,documentTemplates:read-one,documents:create-basic,documents:create-revision,documents:create-with-timeline,documents:delete,documents:generate-pdf,documents:payment-summary,documents:read,documents:read-by-asset,documents:read-by-inventory,documents:read-one,documents:send-email,documents:tag-template-to-asset,documents:untag-template-from-asset,documents:update,payments:create,payments:delete,payments:read,payments:update,shipments:create,shipments:delete,shipments:read,shipments:update,suppliers:create,suppliers:delete,suppliers:read,suppliers:read-one,suppliers:update,uploads:upload-image,users:read,users:read-roles'.split(',');
const USER = { id: 'user_e2e_av_sales', firstName: 'Sayaka', lastName: '(e2e)', emailAddresses: [{ emailAddress: 'e2e-sales@example.test' }] };

@Injectable()
class SalesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    req.user = USER;
    req.userOrganization = { id: ORG, name: 'Asia Deal Hub Japan LLC' };
    const perms = req.headers['x-test-role'] === 'nocreate' ? ADH_SALES.filter((p) => p !== 'shipments:create' && p !== 'shipments:update') : ADH_SALES;
    const need: string[] = this.reflector.get(PERMISSIONS_KEY, ctx.getHandler()) ?? [];
    const ok = need.every((r) => perms.includes(r));
    if (!ok) throw new ForbiddenException('Insufficient permissions');
    return true;
  }
}

@Module({
  imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ClerkModule, PushModule, ActionLogModule, ShipmentsModule, IngestionEmailModule],
  providers: [PrismaService, { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor }, { provide: APP_INTERCEPTOR, useClass: ActionLogInterceptor }, { provide: APP_GUARD, useClass: SalesGuard }],
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
  const prisma = mod.get(PrismaService);
  const run = Date.now().toString().slice(-6);
  const BL = `E2EAV${run}`;

  const { emailId, order } = await runAsOrg(ORG, async () => {
    const orders: any[] = await prisma.tradeOrder.findMany({ where: { organizationId: ORG, status: 'OPEN' }, select: { id: true, orderNo: true, qtyMt: true, shipments: { select: { id: true } } }, orderBy: { orderNo: 'desc' } });
    const o = orders.find((x) => !x.shipments.length);
    if (!o) throw new Error('dev ADH has no open order without a shipment');
    const body = ['Dear team, the arrival notice is attached below.', 'VSL/VOY: WAN HAI 366/E051', `B/L No: ${BL}`, 'ETA : 2026-11-05', 'TOTAL NET WT (MT) : 20.416', 'TOTAL GROSS WT (MT) : 20.496', 'TOTAL BUNDLES : 8', 'INVOICE NO : XP2652199999'].join('\n');
    const log: any = await (prisma as any).emailIngestLog.create({
      data: { organizationId: ORG, messageId: `<e2e-av-${run}@example.test>`, fromAddress: 'notice@carrier.example.test', subject: `Fw: (WEB)ARRIVAL NOTICE ${BL} e2e round AV`, status: 'PARSED', inboxState: 'UNMATCHED', direction: 'INBOUND', rawMeta: { bodyText: body, attachments: [] } },
    });
    return { emailId: log.id as string, order: o };
  });
  console.log(`dev ADH · order #${order.orderNo} (no shipment yet) · test email ${emailId.slice(0, 8)} · B/L ${BL}`);

  // 1. the drawer's prefill
  const f = await request(http).post('/email-inbox/shipment-facts').send({ ids: [emailId] });
  const fx = f.body?.fields ?? {};
  check('facts: 201 as ADH Sales', f.status === 201, f.status);
  check('facts: B/L, vessel / voyage, ETA, net / gross, bundles, CI — exact', fx.blNumber?.value === BL && fx.vessel?.value === 'WAN HAI 366' && fx.voyageNo?.value === 'E051' && fx.eta?.value === '2026-11-05' && fx.netWeightMt?.value === '20.416' && fx.grossWeightMt?.value === '20.496' && fx.totalBundles?.value === '8' && fx.ciNumber?.value === 'XP2652199999', fx);
  check('facts: the subject comes back for the caption', String(f.body?.subject ?? '').includes(BL), f.body?.subject);

  // 2. "+ New shipment" → Save
  const denied = await request(http).post(`/trade-orders/${order.id}/shipments`).set('x-test-role', 'nocreate').send({ blNumber: `${BL}X` });
  check('a role without shipments:create gets 403', denied.status === 403, denied.status);
  const created = await request(http)
    .post(`/trade-orders/${order.id}/shipments`)
    .send({ blNumber: BL, vessel: 'WAN HAI 366', voyageNo: 'E051', eta: '2026-11-05', netWeightMt: 20.416, grossWeightMt: 20.496, totalBundles: 8, ciNumber: 'XP2652199999', fromEmailId: emailId });
  const s = created.body;
  check('create: 201, ref #n-1 under the order', created.status === 201 && s?.ref === `#${order.orderNo}-1` && s?.orderId === order.id, { status: created.status, ref: s?.ref, msg: s?.message });
  check('create: the fields as saved', s?.blNumber === BL && s?.vessel === 'WAN HAI 366' && Number(s?.netWeightMt) === 20.416 && s?.totalBundles === 8, s);
  const dup = await request(http).post(`/trade-orders/${order.id}/shipments`).send({ blNumber: BL });
  check('one shipment per B/L: the same B/L again is refused', dup.status === 400 && /already used/.test(JSON.stringify(dup.body)), dup.body);

  // 3. edit from the email
  const denied2 = await request(http).patch(`/shipments/${s.id}`).set('x-test-role', 'nocreate').send({ vessel: 'X' });
  check('a role without shipments:update gets 403 on the edit', denied2.status === 403, denied2.status);
  const edited = await request(http).patch(`/shipments/${s.id}`).send({ vessel: 'WAN HAI 365', voyageNo: 'N046', fromEmailId: emailId });
  check('edit: 200, vessel / voyage changed', edited.status === 200 && edited.body?.vessel === 'WAN HAI 365' && edited.body?.voyageNo === 'N046', { status: edited.status, v: edited.body?.vessel });
  const bad = await request(http).patch(`/shipments/${s.id}`).send({ netWeightMt: -1 });
  check('edit: the same validation as the shipment page (negative net refused)', bad.status === 400, bad.status);

  // 4. the Activity Log
  await settle(2500);
  const rows: any[] = await runAsOrg(ORG, () =>
    (prisma as any).actionLog.findMany({ where: { organizationId: ORG, actorId: USER.id, createdAt: { gte: new Date(Date.now() - 5 * 60_000) } }, orderBy: { createdAt: 'asc' } }),
  );
  const want = `from email "Fw: (WEB)ARRIVAL NOTICE ${BL} e2e round AV"`.slice(0, 72);
  const createRow = rows.find((r) => r.method === 'POST' && /\/trade-orders\/.+\/shipments$/.test(r.path) && r.status === 'SUCCESS' && r.details?.result?.emailId === emailId);
  const editRow = rows.find((r) => r.method === 'PATCH' && r.path === `/shipments/${s.id}` && r.status === 'SUCCESS' && r.details?.result?.emailId === emailId);
  check('Activity Log: the create, as the user, "from email <subject>"', !!createRow && createRow.actorType === 'USER' && createRow.actorName === 'Sayaka (e2e)' && createRow.details?.result?.source?.startsWith('from email "Fw: (WEB)ARRIVAL NOTICE') && createRow.details?.result?.ref === s.ref, createRow?.details);
  check('Activity Log: the edit, as the user, "from email <subject>"', !!editRow && editRow.actorType === 'USER' && editRow.details?.result?.source?.startsWith(want.slice(0, 30)), editRow?.details);
  // (A 403 from the auth guard never reaches the interceptor, so refused calls have no row — as everywhere today.)
  check('Activity Log: the facts read is a VIEW, not a create', rows.some((r) => r.path === '/email-inbox/shipment-facts' && r.action === 'VIEW'), rows.filter((r) => r.path === '/email-inbox/shipment-facts').map((r) => r.action));

  // tidy (dev): the test shipment cancelled, the test email hidden — nothing deleted
  await request(http).patch(`/shipments/${s.id}`).send({ status: 'CANCELLED' });
  await runAsOrg(ORG, () => (prisma as any).emailIngestLog.update({ where: { id: emailId }, data: { inboxState: 'HIDDEN' } }));
  await app.close();
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('E2E error:', e?.stack || e);
  process.exit(1);
});
