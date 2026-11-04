/**
 * WCT jobs calendar add (2026-11-04), DEV database, real HTTP through the app.
 *   A quick job: no order, no lines, NO DO (no document number taken); workers / PTW stored
 *   B calendar: Untagged + PTW on the event; notes add / show / edit / delete
 *   C Orders → "Untagged jobs" list + count; PTW change
 *   D link to a confirmed quotation with no order: order made WITHOUT an auto job, this job is its first job,
 *     takes the quotation's lines and gets its DO through the normal path; a later confirm adds no second job
 *   E link to an order, to a DO (same order); a different customer needs confirmCustomer; linking twice refused
 *   F another org: every new endpoint 404
 * Dev writes: WCT flags enableJobsCalendar (on) / enableSiteClockLink (off), both restored; TEST rows removed.
 *
 *   AIMS_SECRETS_KEY=... TENANCY_MODE=per-org npx ts-node -r tsconfig-paths/register --transpile-only scripts/_calendar-add-e2e.ts
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
import { autoDraftDeliveryFromQuotation } from '../src/deliveries/quotation-to-delivery';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const WCT_ADMIN = '0cb82844-c14f-415e-b831-05470042b508';
const OSI = 'd068f159-e45a-4da8-beaf-62e903f44141';
const OSI_ADMIN = '7b18bdc6-bac2-42c6-88e7-92a73bc43512';
const USER = 'user_e2e_calendar_add';
const RUN = Date.now().toString(36).toUpperCase();

let pass = 0;
let fail = 0;
const ok = (cond: any, label: string, extra?: any) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && extra !== undefined ? `  -> ${JSON.stringify(extra).slice(0, 400)}` : ''}`);
};

@Injectable()
class FakeStrategy extends PassportStrategy(Strategy, 'clerk') {
  async validate(req: any) {
    return { id: String(req.headers['x-e2e-user']), firstName: 'E2E', lastName: 'Calendar', emailAddresses: [] };
  }
}

const sgt = (day: string, hm: string) => new Date(`${day}T${hm}:00+08:00`).toISOString();

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
  const ui = await prisma.organizationUIConfig.findUnique({ where: { organizationId: WCT } });
  const before = { ...((ui?.features as any) || {}) };
  await prisma.organizationUIConfig.update({ where: { organizationId: WCT }, data: { features: { ...before, enableJobsCalendar: true, enableWctOrders: true, enableSiteClockLink: false } } });

  const jobs: string[] = [];
  const docs: string[] = [];
  const orders: string[] = [];
  const notes: string[] = [];
  const W = (fn: () => any) => runAsOrg(WCT, fn);
  try {
    const [c1, c2] = await W(() => prisma.customer.findMany({ where: { organizationId: WCT }, take: 2, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } }));
    const day = '2026-12-09';
    const doCount = () => W(() => prisma.document.count({ where: { organizationId: WCT, type: { in: ['DELIVERY_ORDER', 'DO'] } } }));

    // ── A quick job ──
    const dos0 = await doCount();
    const q1 = await call(WCT, 'POST', '/deliveries/quick-job', {
      customerId: c1.id,
      siteAddress: `TEST ${RUN} 1 Tuas Ave`,
      scheduledFor: sgt(day, '10:00'),
      durationMin: 90,
      workers: [{ id: 'w-test-1', name: 'TEST Ali' }, { id: 'w-test-2', name: 'TEST Bala' }],
      remarks: `TEST ${RUN} quick job`,
      ptwStatus: 'REQUIRED',
      ptwRemark: 'MCST form',
    });
    ok(q1.status === 201 && q1.data?.id, 'A quick job created', q1.body);
    jobs.push(q1.data.id);
    const j1 = await W(() => prisma.delivery.findFirst({ where: { id: q1.data.id }, include: { items: true } }));
    ok(j1!.orderId === null && j1!.items.length === 0 && !j1!.isDraft && j1!.status === 'scheduled', 'A no order, no lines, a real scheduled job', j1);
    ok(j1!.ptwStatus === 'REQUIRED' && j1!.ptwRemark === 'MCST form', 'A PTW stored');
    ok(JSON.stringify(j1!.crewWorkers) === JSON.stringify([{ id: 'w-test-2', name: 'TEST Bala' }]), 'A extra workers stored (first is the assignee)', j1!.crewWorkers);
    ok((await doCount()) === dos0, 'A no DO made, so no DO number taken');
    const noCust = await call(WCT, 'POST', '/deliveries/quick-job', { scheduledFor: sgt(day, '10:00') });
    ok(noCust.status === 400, 'A a quick job needs a customer');

    // ── B calendar + notes ──
    const n1 = await call(WCT, 'POST', '/dashboard/jobs-calendar/notes', { title: `TEST ${RUN} Ali on leave`, type: 'LEAVE', startDate: day, endDate: '2026-12-11', staffId: 'w-test-1', staffName: 'TEST Ali' });
    ok(n1.status === 201 && n1.data?.id, 'B note added', n1.body);
    notes.push(n1.data.id);
    const cal = await call(WCT, 'GET', `/dashboard/jobs-calendar?from=${day}&to=${day}`);
    const ev = (cal.data?.events ?? []).find((e: any) => e.id === `aims:${q1.data.id}`);
    ok(ev?.untagged === true && ev?.ptw?.label === 'Required', 'B calendar: the job is Untagged with a PTW badge', ev);
    ok((cal.data?.notes ?? []).some((n: any) => n.id === n1.data.id && n.endDate === '2026-12-11'), 'B calendar: the note is in range', cal.data?.notes);
    const n1e = await call(WCT, 'PATCH', `/dashboard/jobs-calendar/notes/${n1.data.id}`, { title: `TEST ${RUN} Ali on leave (AM)`, type: 'LEAVE', startDate: day, allDay: false, startTime: '08:00', endTime: '12:00' });
    ok(n1e.status === 200 && n1e.data?.allDay === false && n1e.data?.endDate === day, 'B note edited', n1e.body);
    const badNote = await call(WCT, 'POST', '/dashboard/jobs-calendar/notes', { title: 'x', type: 'HOLIDAY', startDate: day });
    ok(badNote.status === 400, 'B a bad note type is refused');
    const n1d = await call(WCT, 'DELETE', `/dashboard/jobs-calendar/notes/${n1.data.id}`);
    ok(n1d.status === 200 && !(await prisma.calendarNote.findUnique({ where: { id: n1.data.id } })), 'B note deleted');

    // ── C untagged list + PTW ──
    const ul = await call(WCT, 'GET', '/deliveries/order-jobs?untagged=1&limit=100');
    ok(ul.status === 200 && ul.data?.docs?.some((d: any) => d.id === q1.data.id) && ul.data?.counts?.untagged >= 1, 'C the job is in Untagged jobs, with a count', ul.data?.counts);
    const normal = await call(WCT, 'GET', '/deliveries/order-jobs?limit=100');
    ok(!normal.data?.docs?.some((d: any) => d.id === q1.data.id), 'C it is not in the order jobs list');
    const p = await call(WCT, 'PATCH', `/deliveries/${q1.data.id}/ptw`, { ptwStatus: 'APPROVED', ptwRemark: 'ok' });
    ok(p.status === 200 && p.data?.ptwStatus === 'APPROVED', 'C PTW set to Approved', p.body);
    const edit = await call(WCT, 'PATCH', `/deliveries/quick-job/${q1.data.id}`, { customerId: c1.id, scheduledFor: sgt(day, '11:00'), siteAddress: `TEST ${RUN} 2 Tuas Ave`, workers: [{ id: 'w-test-1', name: 'TEST Ali' }], ptwStatus: 'SUBMITTED' });
    const j1e = await W(() => prisma.delivery.findFirst({ where: { id: q1.data.id } }));
    ok(edit.status === 200 && j1e!.ptwStatus === 'SUBMITTED' && JSON.stringify(j1e!.crewWorkers) === '[]' && j1e!.siteAddress?.includes('2 Tuas'), 'C quick job edited', { ptw: j1e!.ptwStatus, crew: j1e!.crewWorkers, site: j1e!.siteAddress });

    // ── D link to a confirmed quotation with no order ──
    const tpl = await W(() => prisma.document.findFirst({ where: { organizationId: WCT, type: 'QUOTATION' }, select: { documentTemplateId: true } }));
    const quote = await W(() =>
      prisma.document.create({
        data: {
          organizationId: WCT,
          type: 'QUOTATION',
          name: `TEST-QO-${RUN}`,
          status: 'confirmed',
          documentTemplateId: tpl!.documentTemplateId,
          config: { customerId: c1.id, customer: { id: c1.id, name: c1.name }, items: [{ description: `TEST ${RUN} aircon servicing`, quantity: 2, unitPrice: 150 }] },
        } as any,
        select: { id: true },
      }),
    );
    docs.push(quote.id);
    const unconfirmed = await W(() => prisma.document.create({ data: { organizationId: WCT, type: 'QUOTATION', name: `TEST-QO-${RUN}-D`, status: 'draft', documentTemplateId: tpl!.documentTemplateId, config: {} } as any, select: { id: true } }));
    docs.push(unconfirmed.id);
    const refuseDraft = await call(WCT, 'POST', `/deliveries/${q1.data.id}/link-order`, { kind: 'quotation', id: unconfirmed.id });
    ok(refuseDraft.status === 400, 'D a draft quotation is refused', refuseDraft.body);
    const l1 = await call(WCT, 'POST', `/deliveries/${q1.data.id}/link-order`, { kind: 'quotation', id: quote.id });
    ok(l1.status === 201 && l1.data?.createdOrder === true && l1.data?.linesAdded === 1, 'D linked: order created, lines added', l1.body);
    if (l1.data?.orderId) orders.push(l1.data.orderId);
    const orderJobs = await W(() => prisma.delivery.findMany({ where: { organizationId: WCT, orderId: l1.data.orderId }, include: { items: true } }));
    ok(orderJobs.length === 1 && orderJobs[0].id === q1.data.id, 'D the job is the order\'s only (first) job', orderJobs.map((j) => j.id));
    const dId = orderJobs[0]?.items.find((i) => i.documentId)?.documentId ?? null;
    if (dId) docs.push(dId);
    const theDo = dId ? await W(() => prisma.document.findFirst({ where: { id: dId }, select: { name: true, config: true } })) : null;
    ok(!!theDo && (theDo.config as any)?.orderNo === l1.data.orderNumber && (theDo.config as any)?.quotationNo === `TEST-QO-${RUN}`, 'D the job got its DO now (order + quotation on it)', theDo?.name);
    ok(orderJobs[0]?.sourceQuotationId === quote.id && orderJobs[0]?.items.length === 1 && orderJobs[0]?.items[0].quantity === 2, 'D the job carries the quotation and its line (free-typed qty 2 = one row)', orderJobs[0]?.items);
    const again = await autoDraftDeliveryFromQuotation(prisma, WCT, quote.id);
    const after = await W(() => prisma.delivery.count({ where: { organizationId: WCT, orderId: l1.data.orderId } }));
    ok(again === null && after === 1, 'D a later confirm of the quotation adds no second job', { again, after });
    const twice = await call(WCT, 'POST', `/deliveries/${q1.data.id}/link-order`, { kind: 'order', id: l1.data.orderId });
    ok(twice.status === 400, 'D linking a linked job again is refused');

    // ── E link to an order, a DO; customer check ──
    const q2 = await call(WCT, 'POST', '/deliveries/quick-job', { customerId: c1.id, scheduledFor: sgt(day, '14:00'), remarks: `TEST ${RUN} second` });
    jobs.push(q2.data.id);
    const l2 = await call(WCT, 'POST', `/deliveries/${q2.data.id}/link-order`, { kind: 'order', id: l1.data.orderId });
    const j2 = await W(() => prisma.delivery.findFirst({ where: { id: q2.data.id }, include: { items: true } }));
    ok(l2.status === 201 && l2.data?.linesAdded === 0 && j2!.orderId === l1.data.orderId && j2!.items.length === 0, 'E linked to the order (a second job takes no lines, no DO yet)', l2.body);
    const q3 = await call(WCT, 'POST', '/deliveries/quick-job', { customerId: c2.id, scheduledFor: sgt(day, '16:00'), remarks: `TEST ${RUN} third` });
    jobs.push(q3.data.id);
    const mismatch = await call(WCT, 'POST', `/deliveries/${q3.data.id}/link-order`, { kind: 'do', id: dId });
    ok(mismatch.status === 409, 'E a different customer needs a confirmation', mismatch.body);
    const l3 = await call(WCT, 'POST', `/deliveries/${q3.data.id}/link-order`, { kind: 'do', id: dId, confirmCustomer: true });
    ok(l3.status === 201 && l3.data?.orderId === l1.data.orderId, 'E linked through the DO to the same order', l3.body);
    const ord = await W(() => prisma.order.findFirst({ where: { id: l1.data.orderId }, select: { status: true } }));
    ok(!!ord?.status, `E the order status is refreshed (${ord?.status})`);
    const ul2 = await call(WCT, 'GET', '/deliveries/order-jobs?untagged=1&limit=100');
    ok(!ul2.data?.docs?.some((d: any) => jobs.includes(d.id)), 'E linked jobs leave the Untagged list');

    // ── F other org ──
    const o1 = await call(OSI, 'POST', '/deliveries/quick-job', { customerId: c1.id, scheduledFor: sgt(day, '10:00') });
    const o2 = await call(OSI, 'POST', '/dashboard/jobs-calendar/notes', { title: 'x', type: 'OTHER', startDate: day });
    const o3 = await call(OSI, 'GET', '/deliveries/order-jobs?untagged=1');
    ok(o1.status === 404 && o2.status === 404 && o3.status === 404, 'F another org: quick job, notes and untagged list all 404', [o1.status, o2.status, o3.status]);
  } finally {
    for (const id of jobs) {
      await W(async () => {
        await prisma.deliverySiteClockJob.deleteMany({ where: { deliveryId: id } });
        await prisma.maintenanceServiceReport.deleteMany({ where: { deliveryId: id } });
        await prisma.deliveryItem.deleteMany({ where: { deliveryId: id } });
        await prisma.delivery.delete({ where: { id } });
      }).catch((e: any) => console.log('cleanup: job kept', id, e?.message?.slice(0, 160)));
    }
    for (const id of orders) await W(() => prisma.order.delete({ where: { id } })).catch((e: any) => console.log('cleanup: order kept', id, e?.message?.slice(0, 160)));
    for (const id of docs) await W(() => prisma.document.delete({ where: { id } })).catch((e: any) => console.log('cleanup: doc kept', id, e?.message?.slice(0, 160)));
    for (const id of notes) await prisma.calendarNote.deleteMany({ where: { id } });
    await prisma.organizationUIConfig.update({ where: { organizationId: WCT }, data: { features: before } });
    for (const [org, role] of [[WCT, WCT_ADMIN], [OSI, OSI_ADMIN]]) await runAsOrg(org, () => prisma.userRole.deleteMany({ where: { userId: USER, roleId: role, organizationId: org } })).catch(() => {});
    await prisma.userOrganization.deleteMany({ where: { userId: USER } });
    await app.close();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
