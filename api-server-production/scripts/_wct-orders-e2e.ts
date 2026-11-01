/**
 * WCT orders Phase 1 end-to-end (2026-11-01), DEV database + a LOCAL SiteClock
 * (the siteclock-do-link backend on :4100).
 *
 * Drives the real DocumentsService / PublicSignService / DeliveriesService /
 * OrdersService for the dev WCT org with enableQuotationToDelivery +
 * enableWctOrders + enableSiteClockLink + enableRealDoOnSchedule +
 * enableJobsCalendar on:
 *   A staff Confirm Quotation → ONE order ORD{YYYY}{MM}-{###} + its first draft
 *     job; the ORDER number format is created; a re-confirm adds nothing; two
 *     confirms of another quotation at the same moment → still one order / one job;
 *   B the first job promoted with a date + worker → real DO with "Order No",
 *     SiteClock job "ORD… · #N Customer · DO…", order Scheduled;
 *   C "Add job" (POST /deliveries/scheduled { orderId }) with the order page's
 *     prefill → second job on the order, its DO has Order No + Quotation No,
 *     its SiteClock title leads with the order;
 *   D both jobs on the jobs calendar with the order number + order link;
 *     order page + list shapes; DO HTML prints "Order No";
 *   E client e-sign of a quotation → order + first job too;
 *   F cancelling a job / deleting an order with jobs;
 *   G enableWctOrders off → the old one-run-per-quotation path, no order; other
 *     orgs' Order / Delivery rows unchanged by the whole run.
 *   P2 worker logins (enableWctMyJobs): a job scheduled on SiteClock worker W1
 *     is planned for W1's AIMS login; the field list marks it "mine" for that
 *     user only; re-picking W2 (no login) clears it; flag off → nothing stored.
 *   P3 finish modes (enableWctFinishModes): stamped-DO photo / paper finish
 *     without a signature (refused with the flag off), pending until an admin
 *     verifies; the photo lands on the DO's attachments + the proof report;
 *     a signature is verified at once; reject (reason) → resubmit → verify;
 *     the order waits in Awaiting verification, then Completed; the queue,
 *     the calendar and the order page show the check.
 *   P4 invoice per order (enableWctOrderInvoice): no per-DO invoice for an
 *     order's jobs; "Invoice now" bills the verified jobs so far, the jobs
 *     verified later go on a SECOND invoice automatically; nothing to bill →
 *     refused; two triggers at once → one invoice; a job already invoiced per
 *     DO (flag switched on later) is never billed again; GL posted; paid →
 *     order Paid.
 *
 * Boots only the deliveries + public-sign + orders modules (no cron), WhatsApp
 * + push + email replaced by no-ops.
 *
 *   SC_URL=http://localhost:4100 SC_COMPANY=<id> SC_KEY_FILE=<file> SC_WORKERS=<id>,<id> \
 *   AIMS_SECRETS_KEY=<64 hex> TENANCY_MODE=per-org \
 *   npx ts-node -r tsconfig-paths/register --transpile-only scripts/_wct-orders-e2e.ts
 *
 * Dev writes: the WCT SiteClockConnection (left disabled), the flags (restored
 * at the end), WCT's ORDER number format, one test customer, the test
 * quotations, orders, runs and their DOs. Refuses PROD_DATABASE_URL's host and
 * a non-local SiteClock.
 */
import 'dotenv/config';
import * as fs from 'fs';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from '../config/configuration';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { ClerkModule } from '../src/clerk/clerk.module';
import { PushModule } from '../src/push/push.module';
import { PushService } from '../src/push/push.service';
import { StaffWhatsAppService } from '../src/staff-whatsapp/staff-whatsapp.service';
import { DeliveriesModule } from '../src/deliveries/deliveries.module';
import { DeliveriesService } from '../src/deliveries/deliveries.service';
import { DocumentsService } from '../src/documents/documents.service';
import { PublicSignModule } from '../src/public-sign/public-sign.module';
import { PublicSignService } from '../src/public-sign/public-sign.service';
import { OrdersModule } from '../src/orders/orders.module';
import { OrdersService } from '../src/orders/orders.service';
import { SiteClockLinkService } from '../src/siteclock/siteclock-link.service';
import { JobsCalendarService } from '../src/dashboard/jobs-calendar.service';
import { autoDraftDeliveryFromQuotation } from '../src/deliveries/quotation-to-delivery';
import { renderWctBody } from '../src/common/services/document-html/wct';
import { resolveDesign } from '../src/common/services/document-html/design';
import { seal } from '../src/common/secret-box';
import { PaymentsService } from '../src/payments/payments.service';
import { refreshOrderStatus } from '../src/orders/wct-orders';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const SC_URL = process.env.SC_URL || 'http://localhost:4100';
const SC_COMPANY = process.env.SC_COMPANY || '';
const SC_KEY = (fs.readFileSync(process.env.SC_KEY_FILE || '', 'utf8').match(/sck_live_[A-Za-z0-9_-]+/) || [])[0] || '';
const [W1, W2] = (process.env.SC_WORKERS || '').split(',');
const FLAGS = ['enableQuotationToDelivery', 'enableWctOrders', 'enableSiteClockLink', 'enableRealDoOnSchedule', 'enableJobsCalendar', 'enableQuotationESign', 'enableConfirmQuotation', 'enableWctMyJobs', 'enableWctFinishModes', 'enableWctOrderInvoice'] as const;
const TECH = 'user_e2e_wct_tech';
const WORKER_USER = 'user_e2e_wct_worker_1'; // Phase 2: a WCT field-tech linked to SiteClock worker W1
const CUSTOMER = 'WCT Orders E2E Customer';
const SITE = '10 Anson Road, Singapore 079903';
const ORD = /^ORD\d{6}-\d{3,}$/;
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ClerkModule, PushModule, ActionLogModule, DeliveriesModule, PublicSignModule, OrdersModule] })
class E2EModule {}

const silenced: string[] = [];
const noop = (name: string) =>
  new Proxy({}, { get: (_t, prop) => (prop === 'then' ? undefined : async () => void silenced.push(`${name}.${String(prop)}`)) });

let failures = 0;
const check = (label: string, ok: boolean, got?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  → got ${JSON.stringify(got)}`}`);
};
async function sc(path: string) {
  const r = await fetch(`${SC_URL}${path}`, { headers: { Authorization: `Bearer ${SC_KEY}` } });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const job = async (deliveryId: string) => (await sc(`/v1/jobs/by-ref/${encodeURIComponent(`aims-delivery:${deliveryId}`)}`)).body?.job;
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));
async function jobWhen(deliveryId: string, ok: (j: any) => boolean = (j) => !!j, ms = 20000) {
  const until = Date.now() + ms;
  let j: any;
  while (Date.now() < until) {
    j = await job(deliveryId);
    if (j && ok(j)) return j;
    await settle(500);
  }
  return j;
}
const sgt = (dayOffset: number, hh: number, mm = 0) => {
  const d = new Date(Date.now() + 8 * 3600_000);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  d.setUTCHours(hh - 8, mm, 0, 0);
  return d.toISOString();
};

(async () => {
  const url = process.env.DATABASE_URL || '';
  const prod = (process.env.PROD_DATABASE_URL || '').replace(/["\r]/g, '');
  if (prod && new URL(url).host === new URL(prod).host) throw new Error('Refusing: DATABASE_URL is the prod database');
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(SC_URL)) throw new Error('Refusing: SC_URL must be a local SiteClock');
  if (!SC_KEY || !SC_COMPANY || !W1 || !W2) throw new Error('SC_KEY_FILE, SC_COMPANY and two SC_WORKERS are required');

  const mod = await Test.createTestingModule({ imports: [E2EModule] })
    .overrideProvider(StaffWhatsAppService)
    .useValue(noop('StaffWhatsAppService'))
    .overrideProvider(PushService)
    .useValue(noop('PushService'))
    .compile();
  const prisma = mod.get(PrismaService);
  const deliveries = mod.get(DeliveriesService);
  const documents = mod.get(DocumentsService);
  const publicSign = mod.get(PublicSignService);
  const orders = mod.get(OrdersService);
  const link = mod.get(SiteClockLinkService);
  const calendar = new JobsCalendarService(prisma, link);

  // Other orgs: Order rows and Delivery.orderId use, before (compared at the end).
  const otherOrgsSnapshot = async () => {
    const o = (await prisma.order.findMany({ where: { organizationId: { not: WCT } }, select: { id: true, status: true, updatedAt: true } })) as any[];
    const d = (await prisma.delivery.findMany({ where: { organizationId: { not: WCT }, orderId: { not: null } }, select: { id: true } })) as any[];
    return JSON.stringify({ orders: o.map((x) => [x.id, x.status, new Date(x.updatedAt).toISOString()]).sort(), deliveriesWithOrder: d.length });
  };
  const othersBefore = await otherOrgsSnapshot();

  await runAsOrg(WCT, async () => {
    const ui = await prisma.organizationUIConfig.findUnique({ where: { organizationId: WCT } });
    const before: Record<string, unknown> = {};
    for (const f of FLAGS) before[f] = ((ui?.features as any) || {})[f];
    const setFlags = async (vals: Partial<Record<(typeof FLAGS)[number], boolean>>) => {
      const cur = await prisma.organizationUIConfig.findUnique({ where: { organizationId: WCT } });
      await prisma.organizationUIConfig.update({ where: { organizationId: WCT }, data: { features: { ...((cur?.features as any) || {}), ...vals } } });
      (link as any).linkedOrgs = null; // drop the 1-minute flag cache
    };
    await setFlags({ enableQuotationToDelivery: true, enableWctOrders: true, enableSiteClockLink: true, enableRealDoOnSchedule: true, enableJobsCalendar: true, enableQuotationESign: true, enableConfirmQuotation: true });
    const conn = { baseUrl: SC_URL, siteclockCompanyId: SC_COMPANY, apiKeyEnc: seal(SC_KEY), apiKeyLast4: SC_KEY.slice(-4), enabled: true, defaultDurationMin: 60 };
    await prisma.siteClockConnection.upsert({ where: { organizationId: WCT }, create: { organizationId: WCT, ...conn }, update: conn });
    (link as any).linkedOrgs = null;
    let customer = await prisma.customer.findFirst({ where: { organizationId: WCT, name: CUSTOMER } });
    if (!customer) customer = await prisma.customer.create({ data: { organizationId: WCT, name: CUSTOMER, address: '1 Billing Street, Singapore 000001' } as any });
    const tpl = await prisma.documentTemplate.findFirst({ where: { type: 'QUOTATION' }, select: { id: true } });
    if (!tpl) throw new Error('no QUOTATION template on dev');
    const hadOrderFormat = !!(await prisma.documentNumberFormat.findFirst({ where: { organizationId: WCT, documentType: 'ORDER' } }));
    console.log(`dev WCT ready (flags were ${JSON.stringify(before)}; ORDER format ${hadOrderFormat ? 'existed' : 'absent'})`);

    let qn = 0;
    const quotation = async () =>
      prisma.document.create({
        data: {
          organizationId: WCT,
          type: 'QUOTATION',
          documentTemplateId: tpl.id,
          name: `QO-E2E-ORD-${Date.now()}-${++qn}`,
          status: 'unconfirmed',
          config: {
            customerId: customer!.id,
            customer: { id: customer!.id, name: CUSTOMER },
            customerName: CUSTOMER,
            documentInfo: { location: SITE },
            items: [
              { id: 1, description: '<b>Kitchen exhaust degrease</b>', quantity: 1, unitPrice: 450, amount: 450 },
              { id: 2, description: 'Duct inspection', quantity: 2, unitPrice: 120, amount: 240 },
            ],
          },
        },
      });
    const confirm = (q: any) => documents.updateDocument({ id: q.id, type: 'QUOTATION', status: 'confirmed' } as any, WCT);
    const ordersOf = (qid: string) => prisma.order.findMany({ where: { organizationId: WCT, sourceQuotationId: qid } });
    const jobsOf = (orderId: string) => prisma.delivery.findMany({ where: { organizationId: WCT, orderId }, orderBy: { deliveryNumber: 'asc' }, include: { items: true } });
    const doOf = async (deliveryId: string) => {
      const it = await prisma.deliveryItem.findFirst({ where: { deliveryId, documentId: { not: null } }, select: { documentId: true } });
      return it ? prisma.document.findFirst({ where: { id: it.documentId!, organizationId: WCT } }) : null;
    };
    const lines = (run: any) => run.items.map((i: any) => ({ description: i.description, quantity: i.quantity, assetClass: i.assetClass ?? 'SERVICE' }));

    // ── A: staff confirm → one order + its first draft job ──
    const q1 = await quotation();
    await confirm(q1);
    let o1s = await ordersOf(q1.id);
    check('A: confirm makes exactly one order', o1s.length === 1, o1s.length);
    const o1: any = o1s[0];
    check('A: order number ORD{YYYY}{MM}-{###}', ORD.test(o1?.orderNumber ?? ''), o1?.orderNumber);
    const now = new Date();
    check('A: …for this month', o1?.orderNumber?.startsWith(`ORD${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`), o1?.orderNumber);
    const fmt = await prisma.documentNumberFormat.findFirst({ where: { organizationId: WCT, documentType: 'ORDER' } });
    check('A: the ORDER number format exists (default pattern)', !!fmt && fmt.pattern === '{DOC}{YYYY}{MM}-{###}', fmt?.pattern);
    let j1s = await jobsOf(o1.id);
    check('A: one first job, a DRAFT, linked to the order and the quotation', j1s.length === 1 && j1s[0].isDraft && j1s[0].sourceQuotationId === q1.id, j1s.map((j: any) => [j.isDraft, j.sourceQuotationId]));
    check('A: the first job has the quotation lines + site', j1s[0]?.items.length === 2 && j1s[0]?.siteAddress === SITE, [j1s[0]?.items.length, j1s[0]?.siteAddress]);
    check('A: order status Open, customer + items snapshot', o1.status === 'OPEN' && o1.customerId === customer.id && Array.isArray(o1.items) && o1.items.length === 2, [o1.status, o1.customerId, (o1.items as any[])?.length]);
    check('A: no generic (non-WCT) order made next to it', (await ordersOf(q1.id)).length === 1);
    // re-confirm: revert → confirm again
    await prisma.document.update({ where: { id: q1.id }, data: { status: 'unconfirmed' } });
    await confirm(q1);
    const again = await autoDraftDeliveryFromQuotation(prisma, WCT, q1.id);
    o1s = await ordersOf(q1.id);
    j1s = await jobsOf(o1.id);
    check('A: re-confirm / re-run adds no order and no job', again === null && o1s.length === 1 && j1s.length === 1, [again, o1s.length, j1s.length]);
    // two confirms of another quotation at the same moment
    const q2 = await quotation();
    await prisma.document.update({ where: { id: q2.id }, data: { status: 'confirmed' } });
    const pair = await Promise.all([autoDraftDeliveryFromQuotation(prisma, WCT, q2.id), autoDraftDeliveryFromQuotation(prisma, WCT, q2.id)]);
    const o2s = await ordersOf(q2.id);
    const j2s = o2s[0] ? await jobsOf(o2s[0].id) : [];
    check('A: two at the same moment → one order, one job', o2s.length === 1 && j2s.length === 1 && pair.filter(Boolean).length === 1, [o2s.length, j2s.length, pair.map((p) => !!p)]);
    check('A: the two orders got different numbers', o2s[0]?.orderNumber !== o1.orderNumber && ORD.test(o2s[0]?.orderNumber ?? ''), [o1.orderNumber, o2s[0]?.orderNumber]);

    // ── B: promote the first job with a date + worker ──
    const first: any = j1s[0];
    await deliveries.updateScheduled(first.id, { scheduledFor: sgt(1, 10), items: lines(first), customerId: customer.id, address: SITE, siteclockWorkerId: W1, siteclockWorkerName: 'Cal Worker 1' } as any, WCT);
    await settle();
    const bDo: any = await doOf(first.id);
    check('B: promotion mints the real DO, stamped with the order', !!bDo && !/PENDING/.test(bDo.name ?? '') && bDo.config?.orderNo === o1.orderNumber && bDo.config?.orderId === o1.id, [bDo?.name, bDo?.config?.orderNo]);
    check('B: the DO keeps its own number and the quotation number', bDo?.name !== o1.orderNumber && bDo?.config?.quotationNo === q1.name, [bDo?.name, bDo?.config?.quotationNo]);
    let o1Now: any = await prisma.order.findFirst({ where: { id: o1.id } });
    check('B: order status Scheduled', o1Now.status === 'SCHEDULED', o1Now.status);
    const bJob = await jobWhen(first.id, (x) => !!x.title?.includes(bDo?.name));
    check('B: SiteClock title "ORD… · #N Customer · DO…"', bJob?.title === `${o1.orderNumber} · #${first.deliveryNumber} ${CUSTOMER} · ${bDo?.name}`, bJob?.title);

    // ── C: Add job, the way the order page sends it ──
    const page: any = await orders.getById(o1.id, WCT);
    check('C: order page prefill = quotation lines + the site', page.prefill?.lines?.length === 2 && page.prefill.lines[0].description === 'Kitchen exhaust degrease' && page.prefill.siteAddress === SITE, page.prefill);
    const second: any = await deliveries.createScheduled(
      {
        orderId: o1.id,
        customerId: page.customer.id,
        address: page.prefill.siteAddress,
        scheduledFor: sgt(2, 14),
        items: page.prefill.lines.map((l: any) => ({ description: l.description, quantity: l.quantity, assetClass: l.assetClass })),
        siteclockWorkerId: W2,
        siteclockWorkerName: 'Cal Worker 2',
        siteclockDurationMin: 90,
      } as any,
      WCT,
    );
    await settle();
    const secondRow: any = await prisma.delivery.findFirst({ where: { id: second.id } });
    check('C: the new job is on the order and carries the quotation', secondRow.orderId === o1.id && secondRow.sourceQuotationId === q1.id && !secondRow.isDraft, [secondRow.orderId, secondRow.sourceQuotationId]);
    const cDo: any = await doOf(second.id);
    check('C: its DO: own real number, Order No + Quotation No', !!cDo && cDo.name !== bDo.name && cDo.config?.orderNo === o1.orderNumber && cDo.config?.quotationNo === q1.name, [cDo?.name, cDo?.config?.orderNo, cDo?.config?.quotationNo]);
    check('C: quoted price carried onto the DO line', (cDo?.config?.items || []).some((i: any) => Number(i.unitPrice) === 450), (cDo?.config?.items || []).map((i: any) => i.unitPrice));
    const cJob = await jobWhen(second.id, (x) => !!x.title?.includes(cDo?.name));
    check('C: SiteClock title of job 2 leads with the order', cJob?.title === `${o1.orderNumber} · #${second.deliveryNumber} ${CUSTOMER} · ${cDo?.name}`, cJob?.title);
    check('C: worker + 90 min on the SiteClock job', !!cJob && Math.round((Date.parse(cJob.endAt) - Date.parse(cJob.startAt)) / 60000) === 90, cJob && [cJob.startAt, cJob.endAt]);
    await expectRefusal('C: an order id from nowhere is refused', () => deliveries.createScheduled({ orderId: '00000000-0000-4000-8000-000000000000', customerId: customer!.id, scheduledFor: sgt(3, 9), items: [{ description: 'x', quantity: 1, assetClass: 'SERVICE' }] } as any, WCT), /Order not found/);

    // ── D: calendar, order page, list, DO HTML ──
    const from = sgt(1, 10).slice(0, 10);
    const to = sgt(2, 14).slice(0, 10);
    const cal = await calendar.get(WCT, from, to);
    const e1 = cal.events.find((e) => e.id === `aims:${first.id}`);
    const e2 = cal.events.find((e) => e.id === `aims:${second.id}`);
    check('D: both jobs on the calendar with the order number + order link', [e1, e2].every((e) => e?.orderNumber === o1.orderNumber && e?.orderHref === `/portal/orders/${o1.id}` && e?.title.startsWith(`${o1.orderNumber} · #`)), [e1?.title, e2?.title, e1?.orderHref]);
    check('D: calendar keeps the DO block', e1?.doNumber === bDo.name && e2?.doNumber === cDo.name, [e1?.doNumber, e2?.doNumber]);
    const page2: any = await orders.getById(o1.id, WCT);
    check('D: order page lists both jobs with worker + DO + tag', page2.jobs.length === 2 && page2.jobs[0].worker?.name === 'Cal Worker 1' && page2.jobs[1].worker?.name === 'Cal Worker 2' && page2.jobs.every((j: any) => j.deliveryOrder?.tag === 'Pending'), page2.jobs.map((j: any) => [j.deliveryNumber, j.worker?.name, j.deliveryOrder?.name, j.deliveryOrder?.tag]));
    check('D: order page header (status, quotation link, customer)', page2.status === 'SCHEDULED' && page2.statusLabel === 'Scheduled' && page2.sourceQuotation?.id === q1.id && page2.customer?.name === CUSTOMER, [page2.status, page2.sourceQuotation?.id]);
    const list: any[] = await orders.list(WCT);
    const row = list.find((o) => o.id === o1.id);
    check('D: orders list row: 2 jobs, next job date', row?.jobCounts?.total === 2 && row?.jobCounts?.drafts === 0 && !!row?.nextJobAt, row && { jobCounts: row.jobCounts, nextJobAt: row.nextJobAt });
    const runView: any = await deliveries.findById(second.id, WCT);
    check('D: delivery page payload carries the order', runView.order?.orderNumber === o1.orderNumber && runView.order?.id === o1.id, runView.order);
    const fieldList: any = await deliveries.list(WCT, { status: 'scheduled', limit: 100 });
    const fieldRow = (fieldList.docs || fieldList.data || fieldList).find?.((r: any) => r.id === second.id);
    check('D: field app list rows carry the order number', fieldRow?.order?.orderNumber === o1.orderNumber, fieldRow?.order);
    const html = renderWctBody('do', { ...(cDo.config as any), name: cDo.name }, { name: 'WCT' }, resolveDesign({ layout: 'wct' }));
    check('D: WCT DO layout prints "Order No" with the number', html.includes('<span>Order No</span>') && html.includes(o1.orderNumber), html.includes('Order No'));
    const plainHtml = renderWctBody('do', { ...(cDo.config as any), orderNo: undefined, orderId: undefined, name: cDo.name }, { name: 'WCT' }, resolveDesign({ layout: 'wct' }));
    check('D: a DO without an order prints no Order No line', !plainHtml.includes('<span>Order No</span>') && plainHtml.includes('Delivery Order No'));

    // ── E: client e-sign → order + first job ──
    const q3 = await quotation();
    const signLink: any = await publicSign.createForDocument(q3.id, WCT);
    await publicSign.sign(signLink.token, { signerName: 'E2E Client', signatureDataUrl: SIG, agreed: true }, { ip: '127.0.0.1', userAgent: 'e2e' });
    const o3s = await ordersOf(q3.id);
    const j3s = o3s[0] ? await jobsOf(o3s[0].id) : [];
    check('E: e-sign makes one order + one draft job', o3s.length === 1 && ORD.test(o3s[0].orderNumber) && j3s.length === 1 && j3s[0].isDraft, [o3s.length, o3s[0]?.orderNumber, j3s.length]);

    // ── F: cancel a job; delete guard ──
    await deliveries.cancel(second.id, WCT);
    await settle();
    o1Now = await prisma.order.findFirst({ where: { id: o1.id } });
    check('F: cancelling job 2 leaves the order Scheduled (job 1 still to do)', o1Now.status === 'SCHEDULED', o1Now.status);
    check('F: the cancelled job’s SiteClock job is cancelled', (await jobWhen(second.id, (x) => x.status === 'CANCELLED'))?.status === 'CANCELLED');
    await expectRefusal('F: an order with jobs cannot be deleted', () => orders.delete(o1.id, WCT), /has jobs/);

    // ── P2: worker logins / My jobs ──
    await setFlags({ enableWctMyJobs: true });
    await prisma.userOrganization.upsert({
      where: { userId_organizationId: { userId: WORKER_USER, organizationId: WCT } },
      update: { isActive: true },
      create: { userId: WORKER_USER, organizationId: WCT, isActive: true },
    });
    await prisma.organizationMemberProfile.upsert({
      where: { organizationId_userId: { organizationId: WCT, userId: WORKER_USER } },
      update: { siteclockUserId: W1 },
      create: { organizationId: WCT, userId: WORKER_USER, siteclockUserId: W1 },
    });
    const p2: any = await deliveries.createScheduled(
      { orderId: o1.id, customerId: customer.id, address: SITE, scheduledFor: sgt(4, 9), items: [{ description: 'Filter change', quantity: 1, assetClass: 'SERVICE' }], siteclockWorkerId: W1, siteclockWorkerName: 'Cal Worker 1' } as any,
      WCT,
    );
    let p2Row: any = await prisma.delivery.findFirst({ where: { id: p2.id } });
    check('P2: a job on SiteClock worker W1 is planned for W1’s AIMS login', p2Row.plannedRiderUserId === WORKER_USER && p2Row.plannedRiderName === 'Cal Worker 1', [p2Row.plannedRiderUserId, p2Row.plannedRiderName]);
    const listAs = async (viewerUserId: string) => ((await deliveries.list(WCT, { status: 'scheduled', limit: 100, viewerUserId })) as any).docs.find((r: any) => r.id === p2.id);
    const asWorker = await listAs(WORKER_USER);
    const asOther = await listAs('user_someone_else');
    check('P2: field list: "mine" for the planned worker, someone else’s job for anyone else', asWorker?.plannedRider?.isMe === true && asOther?.plannedRider?.isMe === false && asOther?.plannedRider?.name === 'Cal Worker 1', [asWorker?.plannedRider, asOther?.plannedRider]);
    await deliveries.updateScheduled(p2.id, { scheduledFor: sgt(4, 9), items: [{ description: 'Filter change', quantity: 1, assetClass: 'SERVICE' }], customerId: customer.id, address: SITE, siteclockWorkerId: W2, siteclockWorkerName: 'Cal Worker 2' } as any, WCT);
    p2Row = await prisma.delivery.findFirst({ where: { id: p2.id } });
    check('P2: re-picked on W2 (no AIMS login) → no planned login, name kept for the card', p2Row.plannedRiderUserId === null && p2Row.plannedRiderName === 'Cal Worker 2', [p2Row.plannedRiderUserId, p2Row.plannedRiderName]);
    await deliveries.updateScheduled(p2.id, { scheduledFor: sgt(4, 9), items: [{ description: 'Filter change', quantity: 1, assetClass: 'SERVICE' }], customerId: customer.id, address: SITE } as any, WCT);
    p2Row = await prisma.delivery.findFirst({ where: { id: p2.id } });
    check('P2: an edit without a worker pick leaves the planned rider alone', p2Row.plannedRiderName === 'Cal Worker 2', p2Row.plannedRiderName);
    await setFlags({ enableWctMyJobs: false });
    const p2off: any = await deliveries.createScheduled(
      { orderId: o1.id, customerId: customer.id, address: SITE, scheduledFor: sgt(4, 11), items: [{ description: 'Filter change', quantity: 1, assetClass: 'SERVICE' }], siteclockWorkerId: W1, siteclockWorkerName: 'Cal Worker 1' } as any,
      WCT,
    );
    const p2offRow: any = await prisma.delivery.findFirst({ where: { id: p2off.id } });
    check('P2: flag off → nothing planned is stored', p2offRow.plannedRiderUserId === null && p2offRow.plannedRiderName === null, [p2offRow.plannedRiderUserId, p2offRow.plannedRiderName]);
    const offList = await listAs(WORKER_USER);
    check('P2: flag off → list rows of other runs keep plannedRider null unless stored', ((await deliveries.list(WCT, { status: 'scheduled', limit: 100, viewerUserId: WORKER_USER })) as any).docs.find((r: any) => r.id === p2off.id)?.plannedRider === null && !!offList);
    for (const r of [p2, p2off]) await deliveries.cancel(r.id, WCT).catch(() => undefined);
    await prisma.organizationMemberProfile.deleteMany({ where: { organizationId: WCT, userId: WORKER_USER } });
    await prisma.userOrganization.deleteMany({ where: { organizationId: WCT, userId: WORKER_USER } });

    // ── P3: finish modes + verification ──
    const finishJob = async (runId: string, finish: any) => {
      const row: any = await prisma.delivery.findFirst({ where: { id: runId }, include: { items: true } });
      for (const it of row.items) {
        await deliveries.startFreeTypedItem(runId, it.id, { technicianName: 'E2E Tech' }, WCT, TECH);
        await deliveries.endFreeTypedItem(runId, it.id, { technicianName: 'E2E Tech' }, WCT, TECH);
      }
      return deliveries.finalizeRun(runId, { technicianName: 'E2E Tech', installNeeded: false, ...finish }, WCT, TECH, { allowPartial: true });
    };
    const q5 = await quotation();
    await confirm(q5);
    const o5: any = (await ordersOf(q5.id))[0];
    const [j5a] = await jobsOf(o5.id);
    await deliveries.updateScheduled(j5a.id, { scheduledFor: sgt(1, 15), items: lines(j5a), customerId: customer.id, address: SITE, siteclockWorkerId: W1, siteclockWorkerName: 'Cal Worker 1' } as any, WCT);
    const j5b: any = await deliveries.createScheduled({ orderId: o5.id, customerId: customer.id, address: SITE, scheduledFor: sgt(1, 17), items: [{ description: 'Duct inspection', quantity: 1, assetClass: 'SERVICE' }] } as any, WCT);
    await expectRefusal('P3: flag off → a paper finish is refused (signature rule unchanged)', () => finishJob(j5a.id, { completionMode: 'paper' }), /not enabled/);
    await setFlags({ enableWctFinishModes: true });
    await expectRefusal('P3: a stamped-DO finish needs its photo', () => deliveries.finalizeRun(j5a.id, { completionMode: 'stamped_do', stampedDoPhotos: [] } as any, WCT, TECH, { allowPartial: true }), /photo of the stamped DO/);
    await deliveries.finalizeRun(j5a.id, { completionMode: 'stamped_do', stampedDoPhotos: ['do-stamped/e2e-1.jpg'], completionNote: 'Stamped by the site manager', technicianName: 'E2E Tech', installNeeded: false } as any, WCT, TECH, { allowPartial: true });
    let j5aRow: any = await prisma.delivery.findFirst({ where: { id: j5a.id } });
    check('P3: stamped-DO finish without a signature → completed, Awaiting verification', j5aRow.status === 'completed' && j5aRow.completionMode === 'stamped_do' && j5aRow.verificationState === 'pending', [j5aRow.status, j5aRow.completionMode, j5aRow.verificationState]);
    const j5aDo: any = await doOf(j5a.id);
    check('P3: the photo is on the DO as a "Stamped DO" attachment', ((j5aDo?.attachments as any[]) || []).some((a) => a.fileKey === 'do-stamped/e2e-1.jpg' && a.label === 'Stamped DO'), j5aDo?.attachments);
    const proof = await prisma.maintenanceServiceReport.findMany({ where: { deliveryId: j5a.id, kind: 'DO_ACK', description: { startsWith: 'Stamped DO' } } });
    check('P3: …and on the run’s proof report, linked to the DO', proof.length === 1 && proof[0].photos.includes('do-stamped/e2e-1.jpg') && proof[0].documentId === j5aDo?.id, proof.map((p) => [p.photos, p.documentId]));
    await finishJob(j5b.id, { signature: SIG, recipientName: 'Site Manager' });
    const j5bRow: any = await prisma.delivery.findFirst({ where: { id: j5b.id } });
    check('P3: a signature finish is verified at once', j5bRow.completionMode === 'signature' && j5bRow.verificationState === 'verified' && j5bRow.verifiedByName === 'Customer signature', [j5bRow.completionMode, j5bRow.verificationState]);
    let o5Now: any = await prisma.order.findFirst({ where: { id: o5.id } });
    check('P3: order waits: Awaiting verification', o5Now.status === 'AWAITING_VERIFICATION', o5Now.status);
    let queue: any[] = await deliveries.verificationQueue(WCT, 'pending');
    const qRow = queue.find((r) => r.id === j5a.id);
    check('P3: the queue has the job with its photo, note, order and DO', !!qRow && qRow.photos.includes('do-stamped/e2e-1.jpg') && qRow.completionNote === 'Stamped by the site manager' && qRow.order?.orderNumber === o5.orderNumber && qRow.deliveryOrder?.id === j5aDo?.id, qRow);
    check('P3: a signed job is not in the queue', !queue.some((r) => r.id === j5b.id));
    const calP3 = await calendar.get(WCT, sgt(1, 15).slice(0, 10), sgt(1, 15).slice(0, 10));
    check('P3: calendar popup shows the check', calP3.events.find((e) => e.id === `aims:${j5a.id}`)?.verificationLabel === 'Awaiting verification' && calP3.events.find((e) => e.id === `aims:${j5b.id}`)?.verificationLabel === 'Verified');
    const page5: any = await orders.getById(o5.id, WCT);
    check('P3: order page jobs carry the check', page5.jobs.find((j: any) => j.id === j5a.id)?.verificationState === 'pending' && page5.statusLabel === 'Awaiting verification', page5.jobs.map((j: any) => j.verificationState));
    await expectRefusal('P3: reject needs a reason', () => deliveries.rejectJob(j5a.id, WCT, { id: 'u-admin', name: 'E2E Admin' }, '  '), /Say why/);
    await deliveries.rejectJob(j5a.id, WCT, { id: 'u-admin', name: 'E2E Admin' }, 'Stamp not readable');
    j5aRow = await prisma.delivery.findFirst({ where: { id: j5a.id } });
    check('P3: rejected with the reason; run stays completed', j5aRow.verificationState === 'rejected' && j5aRow.verificationNote === 'Stamp not readable' && j5aRow.status === 'completed', [j5aRow.verificationState, j5aRow.verificationNote]);
    check('P3: rejected list has it', (await deliveries.verificationQueue(WCT, 'rejected')).some((r: any) => r.id === j5a.id));
    await expectRefusal('P3: resubmit needs a photo or a note', () => deliveries.resubmitEvidence(j5a.id, WCT, { id: TECH, name: 'E2E Tech' }, {}), /photo of the stamped DO or a note/);
    await deliveries.resubmitEvidence(j5a.id, WCT, { id: TECH, name: 'E2E Tech' }, { photos: ['do-stamped/e2e-2.jpg'], note: 'Clearer photo' });
    j5aRow = await prisma.delivery.findFirst({ where: { id: j5a.id } });
    const j5aDo2: any = await doOf(j5a.id);
    check('P3: resubmitted → Awaiting verification again, both photos kept, new one on the DO', j5aRow.verificationState === 'pending' && (j5aRow.completionPhotos as string[]).length === 2 && ((j5aDo2?.attachments as any[]) || []).some((a) => a.fileKey === 'do-stamped/e2e-2.jpg'), [j5aRow.verificationState, j5aRow.completionPhotos]);
    const view: any = await deliveries.verifyJob(j5a.id, WCT, { id: 'u-admin', name: 'E2E Admin' });
    check('P3: verified by the admin', view?.verificationState === 'verified' && view?.verifiedByName === 'E2E Admin', view);
    o5Now = await prisma.order.findFirst({ where: { id: o5.id } });
    check('P3: every job checked → order Completed', o5Now.status === 'COMPLETED', o5Now.status);
    await expectRefusal('P3: an already verified job cannot be rejected', () => deliveries.rejectJob(j5a.id, WCT, { id: 'u-admin' }, 'late'), /already verified/);
    await setFlags({ enableWctFinishModes: false });
    await expectRefusal('P3: flag off → the queue is closed', () => deliveries.verificationQueue(WCT), /not enabled/);
    await setFlags({ enableWctFinishModes: true });

    // ── P4: invoice per order ──
    await setFlags({ enableWctOrderInvoice: true });
    const perDoInvoice = async (runId: string) => {
      const d: any = await doOf(runId);
      return d ? prisma.document.findFirst({ where: { organizationId: WCT, type: 'INVOICE', config: { path: ['sourceDocumentId'], equals: d.id } } }) : null;
    };
    const mkOrder = async () => {
      const q = await quotation();
      await confirm(q);
      const o: any = (await ordersOf(q.id))[0];
      const [first] = await jobsOf(o.id);
      await deliveries.updateScheduled(first.id, { scheduledFor: sgt(2, 9), items: lines(first), customerId: customer.id, address: SITE } as any, WCT);
      return { q, o, first };
    };
    const { o: o6, first: j6a } = await mkOrder();
    const j6b: any = await deliveries.createScheduled({ orderId: o6.id, customerId: customer.id, address: SITE, scheduledFor: sgt(2, 11), items: [{ description: 'Duct inspection', quantity: 2, assetClass: 'SERVICE' }] } as any, WCT);
    const j6c: any = await deliveries.createScheduled({ orderId: o6.id, customerId: customer.id, address: SITE, scheduledFor: sgt(2, 13), items: [{ description: 'Kitchen exhaust degrease', quantity: 1, assetClass: 'SERVICE' }] } as any, WCT);
    await finishJob(j6a.id, { signature: SIG });
    await finishJob(j6b.id, { completionMode: 'stamped_do', stampedDoPhotos: ['do-stamped/e2e-p4.jpg'] });
    check('P4: no per-DO invoice for an order job', !(await perDoInvoice(j6a.id)) && !(await perDoInvoice(j6b.id)));
    check('P4: …and no order invoice yet (a job still to do, one to verify)', !(await prisma.delivery.findFirst({ where: { id: j6a.id } }))!.orderInvoiceId);
    const invA: any = await documents.invoiceOrder(o6.id, WCT, { trigger: 'now' });
    const invADoc: any = await prisma.document.findFirst({ where: { id: invA.id } });
    const cfgA: any = invADoc.config;
    check('P4: Invoice now bills only the verified job so far', JSON.stringify(cfgA.orderJobIds) === JSON.stringify([j6a.id]) && cfgA.orderNo === o6.orderNumber && cfgA.orderId === o6.id, [cfgA.orderJobIds, cfgA.orderNo]);
    check('P4: priced from the quotation (450 + 2 × 120 lines on the first job)', (cfgA.items || []).some((i: any) => Number(i.unitPrice) === 450) && (cfgA.items || []).some((i: any) => Number(i.unitPrice) === 120), (cfgA.items || []).map((i: any) => i.unitPrice));
    check('P4: invoice names the DO and the quotation', (cfgA.deliveryOrderNos || []).length === 1 && cfgA.sourceDocumentType === 'QUOTATION', [cfgA.deliveryOrderNos, cfgA.sourceDocumentType]);
    const jeA = await prisma.journalEntry.count({ where: { organizationId: WCT, sourceDocumentId: invA.id } });
    check('P4: the order invoice posted to the GL', jeA >= 1, jeA);
    const o6Row: any = await prisma.order.findFirst({ where: { id: o6.id } });
    check('P4: the order stores its invoice', o6Row.invoiceDocumentId === invA.id && (o6Row.linkedDocuments?.invoice || []).some((x: any) => x.id === invA.id), [o6Row.invoiceDocumentId]);
    await expectRefusal('P4: Invoice now with nothing verified left → refused', () => documents.invoiceOrder(o6.id, WCT, { trigger: 'now' }), /Nothing to invoice/);
    await deliveries.verifyJob(j6b.id, WCT, { id: 'u-admin', name: 'E2E Admin' });
    check('P4: job 2 verified but job 3 still to do → no second invoice yet', !(await prisma.delivery.findFirst({ where: { id: j6b.id } }))!.orderInvoiceId);
    await finishJob(j6c.id, { signature: SIG });
    const j6bRow: any = await prisma.delivery.findFirst({ where: { id: j6b.id } });
    const j6cRow: any = await prisma.delivery.findFirst({ where: { id: j6c.id } });
    check('P4: the last job done → a SECOND invoice for jobs 2 + 3, automatically', !!j6bRow.orderInvoiceId && j6bRow.orderInvoiceId === j6cRow.orderInvoiceId && j6bRow.orderInvoiceId !== invA.id && !j6bRow.orderInvoiceId.startsWith('claim:'), [j6bRow.orderInvoiceId, j6cRow.orderInvoiceId]);
    const invADoc2: any = await prisma.document.findFirst({ where: { id: invA.id } });
    check('P4: the first invoice is untouched', JSON.stringify(invADoc2.config.items) === JSON.stringify(cfgA.items) && JSON.stringify(invADoc2.config.orderJobIds) === JSON.stringify([j6a.id]));
    let o6Now: any = await prisma.order.findFirst({ where: { id: o6.id } });
    check('P4: every job invoiced → order Invoiced', o6Now.status === 'INVOICED', o6Now.status);
    const page6: any = await orders.getById(o6.id, WCT);
    check('P4: order page lists both invoices with their jobs; nothing left to invoice', page6.invoicing === true && page6.invoices.length === 2 && JSON.stringify(page6.invoices[0].jobNumbers) === JSON.stringify([j6a.deliveryNumber]) && page6.toInvoice.length === 0, page6.invoices?.map((i: any) => i.jobNumbers));
    // paid → order Paid (the real payment status update)
    const payments = new PaymentsService(prisma as any, null as any);
    for (const inv of page6.invoices) {
      const d: any = await prisma.document.findFirst({ where: { id: inv.id } });
      const gross = Number(d.config?.totalWithTax ?? d.config?.grandTotal ?? d.config?.nettTotal ?? 0);
      await prisma.payment.create({ data: { organizationId: WCT, customerId: customer.id, documentId: inv.id, amount: gross, paymentDate: new Date(), paymentMethod: 'transfer', reference: 'e2e', createdBy: 'e2e' } as any });
      await payments.updateInvoiceStatusAfterPayment(inv.id, WCT);
    }
    o6Now = await prisma.order.findFirst({ where: { id: o6.id } });
    check('P4: both invoices paid → order Paid', o6Now.status === 'PAID', o6Now.status);
    // a job invoiced per DO before the flag was on is not billed again
    await setFlags({ enableWctOrderInvoice: false });
    const { o: o7, first: j7 } = await mkOrder();
    await finishJob(j7.id, { signature: SIG });
    const own7: any = await perDoInvoice(j7.id);
    check('P4: flag off → the per-DO invoice as before', !!own7, own7?.id);
    await setFlags({ enableWctOrderInvoice: true });
    const again7 = await documents.maybeInvoiceOrder(o7.id, WCT);
    const j7Row: any = await prisma.delivery.findFirst({ where: { id: j7.id } });
    check('P4: flag on later → no second invoice; the job keeps its per-DO invoice', again7 === null && j7Row.orderInvoiceId === own7.id && (await prisma.document.count({ where: { organizationId: WCT, type: 'INVOICE', id: { not: own7.id }, config: { path: ['orderId'], equals: o7.id } } })) === 0, [again7, j7Row.orderInvoiceId]);
    // two triggers at once → one invoice
    const { o: o8, first: j8 } = await mkOrder();
    await finishJob(j8.id, { completionMode: 'paper', completionNote: 'copy with the site office' });
    await prisma.delivery.update({ where: { id: j8.id }, data: { verificationState: 'verified', verifiedByName: 'E2E Admin', verifiedAt: new Date() } });
    const racing = await Promise.all([documents.maybeInvoiceOrder(o8.id, WCT), documents.maybeInvoiceOrder(o8.id, WCT), documents.maybeInvoiceOrder(o8.id, WCT)]);
    const o8Invoices = await prisma.document.count({ where: { organizationId: WCT, type: 'INVOICE', config: { path: ['orderId'], equals: o8.id } } });
    check('P4: three triggers at once → exactly one invoice', o8Invoices === 1 && racing.filter(Boolean).length === 1, [o8Invoices, racing.map((r: any) => !!r)]);

    // ── G: flag off → the old path ──
    await setFlags({ enableWctOrders: false });
    const q4 = await quotation();
    await confirm(q4);
    const q4Runs = await prisma.delivery.findMany({ where: { organizationId: WCT, sourceQuotationId: q4.id } });
    check('G: flag off → one draft run, no order (as before)', q4Runs.length === 1 && !q4Runs[0].orderId && (await ordersOf(q4.id)).length === 0, [q4Runs.length, q4Runs[0]?.orderId]);
    const planned: any = await link.loadRunForDryRun(WCT, q4Runs[0].id);
    check('G: a run without an order keeps the old SiteClock title', planned && !('orderNumber' in planned && planned.orderNumber), planned?.orderNumber);
    await setFlags({ enableWctOrders: true });

    // ── tidy: drafts deleted, scheduled test runs cancelled (issued DOs stay as Cancelled) ──
    for (const r of [...j2s, ...j3s, ...q4Runs]) await deliveries.remove(r.id, WCT).catch(() => undefined);
    await deliveries.cancel(first.id, WCT).catch(() => undefined);
    await settle();
    const views = await link.viewsFor(WCT, [first.id, second.id]);
    check('every SiteClock link SYNCED', [...views.values()].every((v) => v.syncState === 'SYNCED'), [...views.values()].map((v) => [v.syncState, v.lastError]));
    o1Now = await prisma.order.findFirst({ where: { id: o1.id } });
    check('tidy: all jobs cancelled → order back to Open', o1Now.status === 'OPEN', o1Now.status);

    // ── restore flags; leave the connection disabled ──
    const cur = await prisma.organizationUIConfig.findUnique({ where: { organizationId: WCT } });
    const f2: any = { ...((cur?.features as any) || {}) };
    for (const f of FLAGS) {
      if (before[f] === undefined) delete f2[f];
      else f2[f] = before[f];
    }
    await prisma.organizationUIConfig.update({ where: { organizationId: WCT }, data: { features: f2 } });
    await prisma.siteClockConnection.update({ where: { organizationId: WCT }, data: { enabled: false } });
    console.log(`orders made in this run: ${[o1.orderNumber, o2s[0]?.orderNumber, o3s[0]?.orderNumber].join(', ')}; DOs: ${bDo.name}, ${cDo.name}`);
  });

  check('other orgs: Order rows and Delivery.orderId untouched', (await otherOrgsSnapshot()) === othersBefore);
  console.log(`silenced (never sent): ${silenced.length ? [...new Set(silenced)].join(', ') : 'none'}`);
  await mod.close();
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('E2E error:', e?.stack || e);
  process.exit(1);
});

async function expectRefusal(label: string, fn: () => Promise<unknown>, re: RegExp) {
  try {
    await fn();
    check(label, false, 'not refused');
  } catch (e: any) {
    const msg = String(e?.response?.message ?? e?.message ?? e);
    check(label, re.test(msg), msg);
  }
}
