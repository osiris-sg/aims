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

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const SC_URL = process.env.SC_URL || 'http://localhost:4100';
const SC_COMPANY = process.env.SC_COMPANY || '';
const SC_KEY = (fs.readFileSync(process.env.SC_KEY_FILE || '', 'utf8').match(/sck_live_[A-Za-z0-9_-]+/) || [])[0] || '';
const [W1, W2] = (process.env.SC_WORKERS || '').split(',');
const FLAGS = ['enableQuotationToDelivery', 'enableWctOrders', 'enableSiteClockLink', 'enableRealDoOnSchedule', 'enableJobsCalendar', 'enableQuotationESign', 'enableConfirmQuotation', 'enableWctMyJobs'] as const;
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
