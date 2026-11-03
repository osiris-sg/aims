/**
 * WCT navigation + naming (2026-11-03), DEV database, real HTTP. Read-only apart from the test sign-in's
 * membership rows (removed at the end).
 *   A GET /deliveries/order-jobs (WCT): order jobs only, rows carry order / customer / site / worker / DO /
 *     state; search, status, date and worker filters narrow it; a bad status is a 400
 *   B another org (no enableWctOrders): 404, its deliveries list unchanged
 *   C a quotation that became an order: GET /documents/:id and the paginated list carry linkedOrder
 *
 *   AIMS_SECRETS_KEY=... TENANCY_MODE=per-org npx ts-node -r tsconfig-paths/register --transpile-only scripts/_wct-jobs-nav-e2e.ts
 */
import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { Injectable, ValidationPipe } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import { AppModule } from '../src/app.module';
import { ClerkStrategy } from '../src/auth/clerk.strategy';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
import { CustomExceptionFilter } from '../helpers/custom-exception.filter';
import { CustomResponseInterceptor } from '../helpers/custom-sucess.filter';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const WCT_ADMIN = '0cb82844-c14f-415e-b831-05470042b508';
const OSI = 'd068f159-e45a-4da8-beaf-62e903f44141';
const OSI_ADMIN = '7b18bdc6-bac2-42c6-88e7-92a73bc43512';
const USER = 'user_e2e_wct_jobs_nav';

let pass = 0;
let fail = 0;
const ok = (cond: any, label: string, extra?: any) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && extra !== undefined ? `  -> ${JSON.stringify(extra).slice(0, 300)}` : ''}`);
};

@Injectable()
class FakeStrategy extends PassportStrategy(Strategy, 'clerk') {
  async validate(req: any) {
    return { id: String(req.headers['x-e2e-user']), firstName: 'E2E', lastName: 'Nav', emailAddresses: [] };
  }
}

async function main() {
  if (process.env.PROD_DATABASE_URL && new URL(process.env.DATABASE_URL!).host === new URL(process.env.PROD_DATABASE_URL).host) throw new Error('Refusing: prod DB');
  const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ClerkStrategy).useClass(FakeStrategy).compile();
  const app = mod.createNestApplication({ logger: ['error'] });
  app.useGlobalPipes(new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } }));
  app.useGlobalFilters(new CustomExceptionFilter());
  app.useGlobalInterceptors(new CustomResponseInterceptor());
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as any).port}`;
  const prisma = app.get(PrismaService);
  const call = async (org: string, method: string, path: string, body?: any) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'x-e2e-user': USER, 'x-active-org-id': org, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j: any = await r.json().catch(() => null);
    return { status: r.status, body: j, data: j?.data };
  };
  for (const [org, role] of [[WCT, WCT_ADMIN], [OSI, OSI_ADMIN]]) {
    await prisma.userOrganization.upsert({ where: { userId_organizationId: { userId: USER, organizationId: org } }, update: { isActive: true }, create: { userId: USER, organizationId: org, isActive: true } });
    await runAsOrg(org, () => prisma.userRole.upsert({ where: { userId_roleId_organizationId: { userId: USER, roleId: role, organizationId: org } }, update: { isActive: true }, create: { userId: USER, roleId: role, organizationId: org } }));
  }
  try {
    // A
    const all = await call(WCT, 'GET', '/deliveries/order-jobs?limit=100');
    const docs = all.data?.docs ?? [];
    const total = await runAsOrg(WCT, () => prisma.delivery.count({ where: { organizationId: WCT, orderId: { not: null } } }));
    ok(all.status === 200 && all.data?.total === total && docs.length === Math.min(100, total), `A: every order job (${total}), paged`, { status: all.status, total: all.data?.total });
    ok(docs.every((d: any) => d.order?.orderNumber && 'customer' in d && 'site' in d && 'worker' in d && Array.isArray(d.dos) && d.state), 'A: rows carry order, customer, site, worker, DOs, state', docs[0]);
    const one = docs.find((d: any) => d.order?.orderNumber);
    const byOrder = await call(WCT, 'GET', `/deliveries/order-jobs?q=${encodeURIComponent(one.order.orderNumber)}`);
    ok(byOrder.data?.docs?.length >= 1 && byOrder.data.docs.every((d: any) => d.order.orderNumber.includes(one.order.orderNumber)), `A: search by order no. (${one.order.orderNumber})`, byOrder.data?.docs?.length);
    const byNo = await call(WCT, 'GET', `/deliveries/order-jobs?q=${one.deliveryNumber}`);
    ok(byNo.data?.docs?.some((d: any) => d.id === one.id), `A: search by job no. (#${one.deliveryNumber})`);
    const st = one.state;
    const byState = await call(WCT, 'GET', `/deliveries/order-jobs?state=${st}&limit=100`);
    ok(byState.data?.docs?.length >= 1 && byState.data.docs.every((d: any) => d.state === st), `A: status filter (${st})`, byState.data?.docs?.map((d: any) => d.state).slice(0, 5));
    const dated = docs.find((d: any) => d.scheduledFor);
    if (dated) {
      const day = new Date(new Date(dated.scheduledFor).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
      const byDay = await call(WCT, 'GET', `/deliveries/order-jobs?from=${day}&to=${day}&limit=100`);
      ok(byDay.data?.docs?.some((d: any) => d.id === dated.id) && byDay.data.docs.every((d: any) => d.scheduledFor && new Date(new Date(d.scheduledFor).getTime() + 8 * 3600_000).toISOString().slice(0, 10) === day), `A: date filter (${day}, Singapore day)`);
    }
    const withWorker = docs.find((d: any) => d.worker);
    if (withWorker) {
      const byW = await call(WCT, 'GET', `/deliveries/order-jobs?worker=${encodeURIComponent(withWorker.worker)}&limit=100`);
      ok(byW.data?.docs?.some((d: any) => d.id === withWorker.id) && (all.data?.workers ?? []).includes(withWorker.worker), `A: worker filter + choices (${withWorker.worker})`);
    }
    const bad = await call(WCT, 'GET', '/deliveries/order-jobs?state=nope');
    ok(bad.status === 400, 'A: unknown status: 400', bad.status);
    // B
    const other = await call(OSI, 'GET', '/deliveries/order-jobs');
    ok(other.status === 404, 'B: an org without WCT orders: 404', other.status);
    const otherList = await call(OSI, 'GET', '/deliveries?limit=5');
    ok(otherList.status === 200, 'B: its deliveries list still answers as before', otherList.status);
    // C
    const o = await runAsOrg(WCT, () => prisma.order.findFirst({ where: { organizationId: WCT, sourceQuotationId: { not: null } }, orderBy: { createdAt: 'desc' }, select: { id: true, orderNumber: true, sourceQuotationId: true } }));
    const q = await call(WCT, 'GET', `/documents/${o!.sourceQuotationId}`);
    const first = await runAsOrg(WCT, () => prisma.order.findFirst({ where: { organizationId: WCT, sourceQuotationId: o!.sourceQuotationId }, orderBy: { createdAt: 'asc' }, select: { id: true, orderNumber: true } }));
    ok(q.status === 200 && q.data?.linkedOrder?.id === first!.id && q.data.linkedOrder.orderNumber === first!.orderNumber, `C: the quotation carries its order (${first!.orderNumber})`, q.data?.linkedOrder);
    const list = await call(WCT, 'POST', '/documents/paginated', { documentTypes: ['QUOTATION'], limit: 100 });
    const withOrder = (list.data?.docs ?? []).filter((d: any) => d.linkedOrder);
    ok(list.status < 300 && withOrder.length >= 1 && withOrder.every((d: any) => d.linkedOrder.orderNumber), `C: the quotations list carries order numbers (${withOrder.length} of ${(list.data?.docs ?? []).length})`, list.status);
    const oq = await call(OSI, 'POST', '/documents/paginated', { documentTypes: ['QUOTATION'], limit: 20 });
    ok(oq.status < 300 && (oq.data?.docs ?? []).every((d: any) => !('linkedOrder' in d)), 'C: other orgs: no linkedOrder on quotations', oq.status);
  } finally {
    for (const [org, role] of [[WCT, WCT_ADMIN], [OSI, OSI_ADMIN]]) await runAsOrg(org, () => prisma.userRole.deleteMany({ where: { userId: USER, roleId: role, organizationId: org } })).catch(() => {});
    await prisma.userOrganization.deleteMany({ where: { userId: USER } });
    await app.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
