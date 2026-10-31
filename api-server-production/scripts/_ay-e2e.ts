/**
 * Round AY end-to-end on the DEV database, over HTTP, with the ADH Admin role's permissions: part 1 (Clients → a
 * customer → Process: preview, save, the step marked N/A, restore) and part 2 (the order's Overall process, a due date
 * set by hand and put back, My tasks, the Monthly list), with the real controllers, tenancy and Activity Log interceptor.
 * Header x-test-role: readonly drops shipments:update.
 *
 *   TENANCY_MODE=per-org npx ts-node -r tsconfig-paths/register --transpile-only scripts/_ay-e2e.ts
 *
 * Dev writes are undone at the end (the process restored, the due date back to the rule); the Activity Log rows stay,
 * and part 3's "E2E AY …" customer, supplier and shipping line stay as test rows (nothing is deleted).
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
const USER = { id: 'user_e2e_ay_admin', firstName: 'Take', lastName: '(e2e)', emailAddresses: [{ emailAddress: 'e2e-admin@example.test' }] };

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
const AFTER_9 = ['IMPORT_PERMIT', 'INVOICE_2', 'LOGISTICS_PAYMENT', 'XERO_HANDOFF', 'DELIVERY_CHANGES'];

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

  // A dev customer with an open order that has an open shipment.
  const pick = await runAsOrg(ORG, async () => {
    const orders: any[] = await prisma.tradeOrder.findMany({ where: { organizationId: ORG, status: 'OPEN', shipments: { some: { status: 'OPEN' } } }, select: { id: true, orderNo: true, customerId: true, customer: { select: { name: true } }, shipments: { where: { status: 'OPEN' }, select: { id: true, seqNo: true, eta: true } } }, orderBy: { orderNo: 'asc' } });
    return orders.find((o) => o.shipments.some((s: any) => s.eta)) ?? orders[0];
  });
  if (!pick) throw new Error('dev ADH has no open order with an open shipment');
  const custId = pick.customerId;
  const ship = pick.shipments[0];
  console.log(`dev ADH · customer ${pick.customer.name} · order #${pick.orderNo} · shipment #${pick.orderNo}-${ship.seqNo}`);

  // ── Part 1: the customer's process ──
  const c0 = await request(http).get(`/trade-clients/customers/${custId}`);
  const before = c0.body?.process?.skipSteps ?? [];
  check('customer: the Process catalogue (16 steps) and its current skip list', c0.status === 200 && c0.body?.process?.steps?.length === 16 && Array.isArray(before), { status: c0.status, n: c0.body?.process?.steps?.length });
  const stepRow = () => runAsOrg(ORG, () => prisma.tradeStep.findFirst({ where: { organizationId: ORG, shipmentId: ship.id, code: 'IMPORT_PERMIT' }, select: { id: true, status: true, notApplicable: true, skipReason: true } }));
  const s0: any = await stepRow();
  const pv = await request(http).post(`/trade-clients/customers/${custId}/process/preview`).send({ skipSteps: AFTER_9 });
  const s1: any = await stepRow();
  check('preview: 201, counts the open orders, writes nothing', pv.status === 201 && pv.body?.openOrders >= 1 && JSON.stringify(s0) === JSON.stringify(s1), { status: pv.status, body: pv.body, s0, s1 });
  check('preview: lists step 10 on the shipment as hidden (unless done)', s0?.status === 'DONE' || pv.body?.hidden?.some((h: any) => h.ref === `#${pick.orderNo}-${ship.seqNo}` && /^10 /.test(h.step)), pv.body?.hidden);
  const bad = await request(http).post(`/trade-clients/customers/${custId}/process/preview`).send({ skipSteps: ['CHECK_CONTRACT'] });
  check('step 0 cannot be left out (400)', bad.status === 400, bad.status);
  const ro = await request(http).patch(`/trade-clients/customers/${custId}/process`).set('x-test-role', 'readonly').send({ skipSteps: AFTER_9 });
  check('saving needs shipments:update (403 without)', ro.status === 403, ro.status);
  const save = await request(http).patch(`/trade-clients/customers/${custId}/process`).send({ skipSteps: AFTER_9 });
  const s2: any = await stepRow();
  check('save: 200, the profile keeps the list', save.status === 200 && JSON.stringify(save.body?.customer?.process?.skipSteps) === JSON.stringify(AFTER_9), { status: save.status, msg: save.body?.message });
  check("save: step 10 on the open shipment is N/A, marked \"not in this customer's process\" (not deleted)", s0?.status === 'DONE' ? s2?.status === 'DONE' : s2?.notApplicable === true && s2?.skipReason === "Not in this customer's process", s2);
  const op = await request(http).get(`/trade-orders/${pick.id}/process`);
  const has10 = op.body?.rows?.some((r: any) => r.code === 'IMPORT_PERMIT' && r.cells?.[ship.id]);
  check('Overall process: the left-out step is not on the shipment', op.status === 200 && (!has10 || s0?.status === 'DONE'), op.body?.rows?.map((r: any) => r.no));
  const back = await request(http).patch(`/trade-clients/customers/${custId}/process`).send({ skipSteps: before });
  const s3: any = await stepRow();
  check('restore: the step comes back as it was', back.status === 200 && s3?.notApplicable === s0?.notApplicable && (s3?.skipReason ?? null) === (s0?.skipReason ?? null), { s0, s3 });

  // ── Part 2: Overall process + due dates (the dev org's enableStepDueDates flag on for the run, restored after) ──
  const ui: any = await prisma.organizationUIConfig.findUnique({ where: { organizationId: ORG }, select: { features: true } });
  const flagBefore = (ui?.features as any)?.enableStepDueDates;
  const off = await request(http).get(`/trade-orders/${pick.id}/process`);
  const offCells = (off.body?.rows ?? []).flatMap((r: any) => Object.values(r.cells)) as any[];
  if (!flagBefore) check('flag off: the Overall process has steps and the schedule but no due dates', off.status === 200 && off.body?.dueDates === false && offCells.length > 0 && offCells.every((c) => c.due === null), { dueDates: off.body?.dueDates });
  await prisma.organizationUIConfig.update({ where: { organizationId: ORG }, data: { features: { ...((ui?.features as object) ?? {}), enableStepDueDates: true } } });
  const p = await request(http).get(`/trade-orders/${pick.id}/process`);
  const cols = p.body?.columns ?? [];
  check('Overall process: 200, the order + each live shipment as columns, the schedule on the shipment', p.status === 200 && cols[0]?.kind === 'order' && cols.some((c: any) => c.id === ship.id && c.schedule && 'eta' in c.schedule), cols);
  const cells = (p.body?.rows ?? []).flatMap((r: any) => Object.values(r.cells)) as any[];
  const open = cells.find((c) => c.recordId === ship.id && c.state !== 'done' && c.due);
  check('cells: state + due date from the rule (shipment with an ETA)', !!open && open.dueSource === 'rule' && /^\d{4}-\d{2}-\d{2}$/.test(open.due), open);
  if (open) {
    const set = await request(http).patch(`/trade-steps/${open.stepId}/due`).send({ dueAt: '2027-01-15' });
    const p2 = await request(http).get(`/trade-orders/${pick.id}/process`);
    const c2 = (p2.body?.rows ?? []).flatMap((r: any) => Object.values(r.cells)).find((c: any) => c.stepId === open.stepId) as any;
    check('set by hand: 200, the cell shows the date, "manual", and who set it', set.status === 200 && c2?.due === '2027-01-15' && c2?.dueSource === 'manual' && c2?.dueSetByName === 'Take (e2e)', { status: set.status, due: c2?.due, src: c2?.dueSource, by: c2?.dueSetByName, set: set.body });
    const badDate = await request(http).patch(`/trade-steps/${open.stepId}/due`).send({ dueAt: '15/01/2027' });
    check('a non-date is refused (400)', badDate.status === 400, badDate.status);
    const roDue = await request(http).patch(`/trade-steps/${open.stepId}/due`).set('x-test-role', 'readonly').send({ dueAt: '2027-01-16' });
    check('changing a due date needs shipments:update (403 without)', roDue.status === 403, roDue.status);
    const reset = await request(http).patch(`/trade-steps/${open.stepId}/due`).send({ dueAt: null });
    const p3 = await request(http).get(`/trade-orders/${pick.id}/process`);
    const c3 = (p3.body?.rows ?? []).flatMap((r: any) => Object.values(r.cells)).find((c: any) => c.stepId === open.stepId) as any;
    check('back to the rule: the rule date again', reset.status === 200 && c3?.dueSource === 'rule' && c3?.due === open.due, c3);
  }
  const tasks = await request(http).get('/trade-alerts/my-tasks');
  const stepTasks = (tasks.body ?? []).filter((t: any) => t.kind === 'STEP_DUE');
  const overdueCells = cells.filter((c) => c.state === 'overdue').length;
  check('My tasks: steps due / overdue appear (kind STEP_DUE, link to the order)', tasks.status === 200 && (overdueCells === 0 || stepTasks.length > 0) && stepTasks.every((t: any) => /^\/portal\/shipments\/orders\//.test(t.linkUrl)), { status: tasks.status, steps: stepTasks.length, overdueCells });
  const ml = await request(http).get('/trade-monthly-list').query({ status: 'Open' });
  const mrows = (ml.body?.blocks ?? []).flatMap((b: any) => b.rows);
  check('Monthly: rows carry the overdue badge data (null or { steps, days })', ml.status === 200 && mrows.every((r: any) => r.overdue === undefined || r.overdue === null || (r.overdue.steps > 0 && r.overdue.days >= 0)), { status: ml.status });
  const ol = await request(http).get('/trade-orders').query({ bucket: 'pending' });
  check('Orders list still answers (bars with step overdue merged)', ol.status === 200, ol.status);

  await prisma.organizationUIConfig.update({ where: { organizationId: ORG }, data: { features: { ...((ui?.features as object) ?? {}), enableStepDueDates: flagBefore ?? false } } });

  // ── Part 3: Clients — add / edit a customer and a supplier, shipping lines ──
  const run = Date.now().toString().slice(-6);
  const sl = await request(http).get('/trade-clients/shipping-lines');
  check('shipping lines: the lines AIMS knows, with their shipments', sl.status === 200 && sl.body?.lines?.some((l: any) => l.code === 'WANHAI') && sl.body.lines.every((l: any) => typeof l.shipments === 'number'), { status: sl.status, n: sl.body?.lines?.length });
  const addC = await request(http).post('/trade-clients/customers').send({
    name: `E2E AY Customer ${run}`, jpName: `E2Eテスト顧客${run}`, email: `ay${run}@example.test`, phone: '+81 3 0000 0000', gstRegNo: 'T1234567890123', currency: 'JPY',
    company: { country: 'Japan', website: 'https://example.test', paymentTerms: 'TT 30 days', bank: { bankName: 'MUFG', accountNo: '1234567890' }, notes: 'e2e' },
    contacts: [{ name: '佐藤 (e2e)', role: '購買', email: `sato${run}@example.test`, lang: 'ja', isPrimary: true }],
    logistics: { carriers: ['WANHAI'], portOfDischarge: 'Nagoya', incoterm: 'CIF', blPattern: '^198[A-Z]{2}\\d{5}$' },
  });
  const cid = addC.body?.customer?.id;
  check('add customer: 201 with company, masked bank, contact (+ language), logistics', addC.status === 201 && addC.body?.company?.bank?.accountNo === '••••7890' && addC.body?.contactList?.[0]?.lang === 'ja' && addC.body?.logistics?.carriers?.[0] === 'WANHAI', { status: addC.status, msg: addC.body?.message, company: addC.body?.company });
  const list = await request(http).get('/trade-clients/customers');
  const row = (list.body ?? []).find((c: any) => c.id === cid);
  check('the Customers table lists it: country, main contact, e-mail, phone', !!row && row.country === 'Japan' && row.mainContact?.name === '佐藤 (e2e)' && row.email === `ay${run}@example.test`, row);
  const ed = await request(http).patch(`/trade-clients/customers/${cid}/details`).send({ company: { country: 'Japan', paymentTerms: 'TT 45 days', bank: { bankName: 'MUFG', accountNo: '••••7890' } }, contacts: [{ id: addC.body?.contactList?.[0]?.id, name: '佐藤 (e2e)', role: '部長', lang: 'en', isPrimary: true }] });
  const raw: any = await runAsOrg(ORG, () => prisma.tradeSetting.findUnique({ where: { organizationId: ORG }, select: { customerProfiles: true } }));
  check('edit: saved; the masked account number kept the stored one; the contact edited in place', ed.status === 200 && raw?.customerProfiles?.[cid]?.company?.bank?.accountNo === '1234567890' && ed.body?.company?.paymentTerms === 'TT 45 days' && ed.body?.contactList?.length === 1 && ed.body?.contactList?.[0]?.role === '部長' && ed.body?.contactList?.[0]?.lang === 'en', { status: ed.status, stored: raw?.customerProfiles?.[cid]?.company?.bank });
  const st = await request(http).get('/trade-config/settings');
  check('Org Settings sends the bank account masked', st.status === 200 && st.body?.customerProfiles?.[cid]?.company?.bank?.accountNo === '••••7890', st.body?.customerProfiles?.[cid]?.company);
  const badC = await request(http).post('/trade-clients/customers').send({ name: 'X', logistics: { carriers: ['NOPE'] } });
  check('a bad shipping line code is refused (400)', badC.status === 400, badC.status);
  const addS = await request(http).post('/trade-clients/suppliers').send({ name: `E2E AY Supplier ${run}`, company: { country: 'Indonesia', legalNameJa: 'テスト仕入先' }, contacts: [{ name: 'Budi (e2e)', email: `budi${run}@example.test`, isPrimary: true }] });
  const sid = addS.body?.supplier?.id;
  check('add supplier: 201 with its contacts and Japanese name', addS.status === 201 && addS.body?.contactList?.[0]?.name === 'Budi (e2e)' && addS.body?.company?.legalNameJa === 'テスト仕入先', { status: addS.status, msg: addS.body?.message });
  const edS = await request(http).patch(`/trade-clients/suppliers/${sid}/details`).send({ contacts: [{ name: 'Sari (e2e)', role: 'Sales' }] });
  check('edit supplier: a new contact added, the old one kept (never deleted)', edS.status === 200 && edS.body?.contactList?.length === 2, edS.body?.contactList);
  const newLine = await request(http).post('/trade-clients/shipping-lines').send({ name: `E2E Line ${run}`, website: 'https://example.test', freeTime: { detDays: 4, demDays: 10 } });
  const code = newLine.body?.code;
  const edL = await request(http).patch(`/trade-clients/shipping-lines/${code}`).send({ name: `E2E Line ${run}`, agents: [{ company: 'Agent KK', name: 'Tanaka' }], notes: 'e2e' });
  const wh = await request(http).patch('/trade-clients/shipping-lines/WANHAI').set('x-test-role', 'readonly').send({ notes: 'x' });
  check('add + edit a shipping line (agents, free time); editing needs shipments:update', newLine.status === 201 && edL.status === 200 && edL.body?.lines?.find((l: any) => l.code === code)?.agents?.[0]?.company === 'Agent KK' && wh.status === 403, { add: newLine.status, edit: edL.status, ro: wh.status });
  const dupe = await request(http).post('/trade-clients/shipping-lines').send({ name: 'Wan Hai Lines' });
  check('a line already on the list is refused', dupe.status === 400, dupe.status);

  // ── Activity Log ──
  await settle(2500);
  const rows: any[] = await runAsOrg(ORG, () => prisma.actionLog.findMany({ where: { organizationId: ORG, actorId: USER.id, createdAt: { gte: started } }, orderBy: { createdAt: 'asc' } }));
  check('Activity Log: the process preview is a VIEW', rows.some((r) => /process\/preview$/.test(r.path) && r.action === 'VIEW'), rows.map((r) => `${r.method} ${r.path} ${r.action}`));
  check('Activity Log: the process save, as the user, with what it did', rows.some((r) => r.method === 'PATCH' && /\/process$/.test(r.path) && r.status === 'SUCCESS' && r.actorName === 'Take (e2e)' && Array.isArray(r.details?.result?.skipSteps)), rows.filter((r) => /\/process$/.test(r.path)).map((r) => r.details));
  check('Activity Log: the customer / supplier / shipping line writes', ['/trade-clients/customers', '/trade-clients/suppliers', '/trade-clients/shipping-lines'].every((p) => rows.some((r) => r.method === 'POST' && r.path === p && r.status === 'SUCCESS' && r.action === 'CREATE')), rows.filter((r) => /trade-clients\/(customers|suppliers|shipping-lines)$/.test(r.path)).map((r) => `${r.method} ${r.path} ${r.action} ${r.status}`));
  check('Activity Log: the due-date change, from → to', !open || rows.some((r) => r.method === 'PATCH' && /\/due$/.test(r.path) && r.details?.result?.dueAt?.to === '2027-01-15'), rows.filter((r) => /\/due$/.test(r.path)).map((r) => r.details));

  await app.close();
  console.log(`\n${failures ? `${failures} FAILED` : 'ALL PASS'} — dev data left as found (process restored, due date back to the rule, the flag as it was; the E2E AY customer / supplier / line stay as test rows)`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
