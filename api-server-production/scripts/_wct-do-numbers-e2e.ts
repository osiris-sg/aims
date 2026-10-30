/**
 * WCT real DO numbers + SiteClock "View DO" end-to-end (2026-10-30), DEV
 * database + a LOCAL SiteClock (the siteclock-do-link backend).
 *
 * Drives the real DeliveriesService / DocumentsService for the dev WCT org with
 * enableRealDoOnSchedule + enableSiteClockLink on:
 *   A schedule → real DO number at once (no DO-PENDING), Pending tag, SiteClock
 *     job titled "#<run> <customer> · <DO>" with a working View DO link, the
 *     calendar popup's DO block;
 *   B complete in the field → SAME number, Completed tag, job COMPLETED;
 *   C cancel → DO kept with its number, Cancelled tag; delete / purge / confirm refused;
 *   D two schedules at the same moment, then five DOs at once → different numbers;
 *   E draft → no DO; promotion → real number;
 *   F a DO renumbered after the job started → the sweep re-titles the job;
 *   G flag off → the old DO-PENDING-NN placeholder, deleted on cancel (unchanged).
 *
 * Boots only the deliveries + SiteClock + public-document modules (no cron),
 * WhatsApp + push replaced by no-ops.
 *
 *   SC_URL=http://localhost:4100 SC_COMPANY=<id> SC_KEY_FILE=<file> SC_WORKERS=<id>,<id> \
 *   AIMS_SECRETS_KEY=<64 hex> TENANCY_MODE=per-org \
 *   npx ts-node -r tsconfig-paths/register --transpile-only scripts/_wct-do-numbers-e2e.ts
 *
 * Dev writes: the WCT SiteClockConnection (left disabled), the two flags +
 * enableJobsCalendar (restored at the end), one test customer, the test runs
 * and their DOs. Refuses PROD_DATABASE_URL's host and a non-local SiteClock.
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
import { DocumentNumberingService } from '../src/document-numbering/document-numbering.service';
import { PublicDocumentModule } from '../src/public-document/public-document.module';
import { PublicDocumentService } from '../src/public-document/public-document.service';
import { SiteClockLinkService } from '../src/siteclock/siteclock-link.service';
import { JobsCalendarService } from '../src/dashboard/jobs-calendar.service';
import { doStatusTag } from '../src/deliveries/do-number';
import { seal } from '../src/common/secret-box';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const SC_URL = process.env.SC_URL || 'http://localhost:4100';
const SC_COMPANY = process.env.SC_COMPANY || '';
const SC_KEY = (fs.readFileSync(process.env.SC_KEY_FILE || '', 'utf8').match(/sck_live_[A-Za-z0-9_-]+/) || [])[0] || '';
const [W1] = (process.env.SC_WORKERS || '').split(',');
const TECH = 'user_e2e_do_numbers';
const FLAGS = ['enableSiteClockLink', 'enableRealDoOnSchedule', 'enableJobsCalendar'] as const;

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ClerkModule, PushModule, ActionLogModule, DeliveriesModule, PublicDocumentModule] })
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
/** The SiteClock job once it exists / matches (the first sync geocodes the address, which can take a few seconds). */
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
const REAL = /^DO\d{6}-?\d{3,}$/; // WCT's format: prod DO{YYYY}{MM}{###}, dev DO{YYYY}{MM}-{####}

(async () => {
  const url = process.env.DATABASE_URL || '';
  const prod = (process.env.PROD_DATABASE_URL || '').replace(/["\r]/g, '');
  if (prod && new URL(url).host === new URL(prod).host) throw new Error('Refusing: DATABASE_URL is the prod database');
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(SC_URL)) throw new Error('Refusing: SC_URL must be a local SiteClock');
  if (!SC_KEY || !SC_COMPANY || !W1) throw new Error('SC_KEY_FILE, SC_COMPANY and SC_WORKERS are required');

  const mod = await Test.createTestingModule({ imports: [E2EModule] })
    .overrideProvider(StaffWhatsAppService)
    .useValue(noop('StaffWhatsAppService'))
    .overrideProvider(PushService)
    .useValue(noop('PushService'))
    .compile();
  const prisma = mod.get(PrismaService);
  const deliveries = mod.get(DeliveriesService);
  const documents = mod.get(DocumentsService);
  const numbering = mod.get(DocumentNumberingService);
  const publicDocs = mod.get(PublicDocumentService);
  const link = mod.get(SiteClockLinkService);
  const calendar = new JobsCalendarService(prisma, link);

  await runAsOrg(WCT, async () => {
    const ui = await prisma.organizationUIConfig.findUnique({ where: { organizationId: WCT } });
    const before: Record<string, unknown> = {};
    for (const f of FLAGS) before[f] = ((ui?.features as any) || {})[f];
    const setFlags = async (vals: Partial<Record<(typeof FLAGS)[number], boolean>>) => {
      const cur = await prisma.organizationUIConfig.findUnique({ where: { organizationId: WCT } });
      await prisma.organizationUIConfig.update({ where: { organizationId: WCT }, data: { features: { ...((cur?.features as any) || {}), ...vals } } });
      (link as any).linkedOrgs = null; // drop the 1-minute flag cache
    };
    await setFlags({ enableSiteClockLink: true, enableRealDoOnSchedule: true, enableJobsCalendar: true });
    const conn = { baseUrl: SC_URL, siteclockCompanyId: SC_COMPANY, apiKeyEnc: seal(SC_KEY), apiKeyLast4: SC_KEY.slice(-4), enabled: true, defaultDurationMin: 60 };
    await prisma.siteClockConnection.upsert({ where: { organizationId: WCT }, create: { organizationId: WCT, ...conn }, update: conn });
    (link as any).linkedOrgs = null;
    let customer = await prisma.customer.findFirst({ where: { organizationId: WCT, name: 'DO Numbers E2E Customer' } });
    if (!customer) customer = await prisma.customer.create({ data: { organizationId: WCT, name: 'DO Numbers E2E Customer' } as any });
    console.log(`dev WCT ready (flags were ${JSON.stringify(before)})`);

    const base = (o: any = {}) => ({
      customerId: customer!.id,
      address: '10 Anson Road, Singapore 079903',
      items: [{ description: 'Kitchen exhaust degrease', quantity: 1, assetClass: 'SERVICE' }],
      scheduledFor: sgt(1, 10),
      siteclockWorkerId: W1,
      siteclockWorkerName: 'Worker 1',
      ...o,
    });
    const doOf = async (deliveryId: string) => {
      const it = await prisma.deliveryItem.findFirst({ where: { deliveryId, documentId: { not: null } }, select: { documentId: true } });
      return it ? prisma.document.findFirst({ where: { id: it.documentId!, organizationId: WCT } }) : null;
    };

    // ── A: schedule ──
    const a: any = await deliveries.createScheduled(base() as any, WCT);
    await settle();
    let aDo: any = await doOf(a.id);
    check('A: DO created at schedule time with a REAL number', !!aDo && REAL.test(aDo.name ?? ''), aDo?.name);
    check('A: the word PENDING is not in the number', !/PENDING/i.test(aDo?.name ?? ''), aDo?.name);
    check('A: DO stays unconfirmed, tag Pending, stamped issuedOnSchedule', aDo?.status === 'unconfirmed' && doStatusTag(aDo) === 'Pending' && (aDo?.config as any)?.issuedOnSchedule === true, [aDo?.status, (aDo?.config as any)?.issuedOnSchedule]);
    let j = await jobWhen(a.id, (x) => !!x.externalUrl);
    check('A: SiteClock title "#<run> <customer> · <DO>"', j?.title === `#${a.deliveryNumber} DO Numbers E2E Customer · ${aDo?.name}`, j?.title);
    check('A: SiteClock job has View DO (https, view-only guest page)', j?.externalUrlLabel === 'View DO' && /^https:\/\/[^/]+\/guest\/do\/vo_/.test(j?.externalUrl ?? ''), [j?.externalUrl, j?.externalUrlLabel]);
    const token = String(j?.externalUrl ?? '').split('/guest/do/')[1];
    const view: any = token ? await publicDocs.getPublicView(token) : null;
    check('A: the View DO token opens THIS DO on the guest page', view?.state === 'ok' && (view?.data?.name === aDo?.name || view?.document?.name === aDo?.name || JSON.stringify(view).includes(aDo?.name)), view?.state);
    const shares = await prisma.documentShareLink.findMany({ where: { documentId: aDo.id } });
    check('A: exactly one view-only link minted for the job', shares.length === 1 && shares[0].token.startsWith('vo_'), shares.map((s) => s.token.slice(0, 3)));
    const from = sgt(1, 10).slice(0, 10);
    const cal = await calendar.get(WCT, from, from);
    const ev = cal.events.find((e) => e.id === `aims:${a.id}`);
    check('A: calendar popup has DO number + Pending tag + View DO (office DO page)', ev?.doNumber === aDo?.name && ev?.doTag === 'Pending' && ev?.doHref === `/portal/documents/DELIVERY_ORDER/${aDo?.documentTemplateId}/${aDo?.id}`, ev && { doNumber: ev.doNumber, doTag: ev.doTag, doHref: ev.doHref });

    // ── B: complete in the field ──
    const aRun: any = await prisma.delivery.findFirst({ where: { id: a.id, organizationId: WCT }, include: { items: true } });
    await deliveries.startFreeTypedItem(a.id, aRun.items[0].id, { technicianName: 'E2E Tech' }, WCT, TECH);
    await settle();
    const bJob = await jobWhen(a.id, (x) => x.status === 'IN_PROGRESS');
    check('B: started → job IN_PROGRESS, title unchanged', bJob?.status === 'IN_PROGRESS' && bJob?.title?.endsWith(aDo.name), [bJob?.status, bJob?.title]);
    await deliveries.endFreeTypedItem(a.id, aRun.items[0].id, { technicianName: 'E2E Tech' }, WCT, TECH);
    await deliveries.finalizeRun(a.id, { signature: 'data:image/png;base64,iVBORw0KGgo=', recipientName: 'E2E Customer', technicianName: 'E2E Tech', installNeeded: false } as any, WCT, TECH);
    await settle(2500);
    const aDone: any = await doOf(a.id);
    const aRunDone: any = await prisma.delivery.findFirst({ where: { id: a.id, organizationId: WCT } });
    check('B: completed → SAME DO number', aDone?.id === aDo.id && aDone?.name === aDo.name, [aDo.name, aDone?.name]);
    check('B: DO tag Completed (delivered)', doStatusTag(aDone) === 'Completed', aDone?.status);
    j = await jobWhen(a.id, (x) => x.status === 'COMPLETED');
    check(`B: run ${aRunDone?.status} → job COMPLETED, title still ${aDo.name}`, j?.status === 'COMPLETED' && j?.title?.endsWith(aDo.name), [j?.status, j?.title]);

    // ── C: cancel ──
    const c: any = await deliveries.createScheduled(base({ scheduledFor: sgt(2, 9) }) as any, WCT);
    await settle();
    const cDo: any = await doOf(c.id);
    check('C: scheduled with a real number', REAL.test(cDo?.name ?? ''), cDo?.name);
    await expectRefusal('C: delete of a run with an issued DO is refused', () => deliveries.remove(c.id, WCT), /already has its number/);
    const cancelled: any = await deliveries.cancel(c.id, WCT);
    await settle();
    const cAfter: any = await prisma.document.findFirst({ where: { id: cDo.id, organizationId: WCT } });
    check('C: cancel keeps the DO, same number, tag Cancelled', !!cAfter && cAfter.name === cDo.name && doStatusTag(cAfter) === 'Cancelled' && /kept and marked Cancelled/.test(cancelled?.note ?? ''), [cAfter?.name, (cAfter?.config as any)?.cancelled, cancelled?.note]);
    check('C: SiteClock job cancelled', (await jobWhen(c.id, (x) => x.status === 'CANCELLED'))?.status === 'CANCELLED');
    await expectRefusal('C: permanent purge refuses a run with an issued DO', () => deliveries.purgeCancelled(c.id, WCT), /real document|Delivery Order/);
    await expectRefusal('C: a cancelled DO cannot be confirmed', () => documents.updateDocument({ id: cDo.id, status: 'confirmed' } as any, WCT), /cancelled with its delivery/);
    // an editor save (config rebuilt from the form) keeps the Cancelled mark
    const { cancelled: _x, cancelledAt: _y, cancelledReason: _z, issuedOnSchedule: _w, ...formCfg } = (cAfter.config as any) || {};
    const saveErr = await documents
      .updateDocument({ id: cDo.id, config: { ...formCfg, remarks: 'edited after cancel' } } as any, WCT)
      .then(() => null)
      .catch((e: any) => String(e?.message ?? e));
    const cSaved: any = await prisma.document.findFirst({ where: { id: cDo.id, organizationId: WCT } });
    if (saveErr) console.log(`SKIP  C: editor save refused by the editor's own validation (${saveErr}); carry-over is covered by do-number.spec.ts`);
    else check('C: an editor save keeps Cancelled + issuedOnSchedule', (cSaved?.config as any)?.remarks === 'edited after cancel' && doStatusTag(cSaved) === 'Cancelled' && (cSaved?.config as any)?.issuedOnSchedule === true, cSaved?.config);
    check('C: still Cancelled after the save attempt', doStatusTag(cSaved) === 'Cancelled');

    // ── D: concurrent schedules ──
    const pair: any[] = await Promise.all([0, 1].map((i) => deliveries.createScheduled(base({ scheduledFor: sgt(3, 9 + i), siteclockWorkerId: undefined, siteclockWorkerName: undefined }) as any, WCT)));
    const pairDos = await Promise.all(pair.map((r) => doOf(r.id)));
    const pairNames = pairDos.map((d: any) => d?.name);
    check('D: two schedules at the same moment → two different real numbers', pairNames.every((n) => REAL.test(n ?? '')) && new Set(pairNames).size === 2, pairNames);
    // Five DOs at once through the same issue + create path a schedule uses.
    const tpl = pairDos[0]!.documentTemplateId;
    const fiveDocs: any[] = await Promise.all([0, 1, 2, 3, 4].map(() => documents.createNumberedDeliveryOrder(tpl, WCT, { issuedOnSchedule: true, items: [] })));
    const fiveNames = fiveDocs.map((d) => d?.name);
    check('D: five DOs at once → five different real numbers', fiveNames.every((n) => REAL.test(n ?? '')) && new Set(fiveNames).size === 5, fiveNames);
    const issued = await Promise.all(Array.from({ length: 10 }, () => numbering.issueNumberLocked(WCT, 'DELIVERY_ORDER')));
    check('D: ten locked issues at once → ten different numbers', new Set(issued).size === 10, issued);
    const ours = [aDo.name, cDo.name, ...pairNames, ...fiveNames];
    const counts = await Promise.all(ours.map((name) => prisma.document.count({ where: { organizationId: WCT, type: 'DELIVERY_ORDER', name } })));
    check('D: every issued number is on exactly one DO in the org', counts.every((n) => n === 1), Object.fromEntries(ours.map((n, i) => [n, counts[i]])));

    // ── E: draft → promotion ──
    const e: any = await deliveries.createScheduled(base({ isDraft: true, scheduledFor: undefined }) as any, WCT);
    check('E: a draft has no DO', !(await doOf(e.id)));
    await deliveries.updateScheduled(e.id, base({ scheduledFor: sgt(5, 11) }) as any, WCT);
    await settle();
    const eDo: any = await doOf(e.id);
    check('E: promotion issues a real number', REAL.test(eDo?.name ?? '') && (eDo?.config as any)?.issuedOnSchedule === true, eDo?.name);
    const eJob = await jobWhen(e.id, (x) => !!x.title?.endsWith(` · ${eDo?.name}`));
    check('E: promoted job titled with it', !!eJob?.title?.endsWith(` · ${eDo?.name}`), eJob?.title);

    // ── F: renumbered after start → the sweep re-titles the job ──
    const eRun: any = await prisma.delivery.findFirst({ where: { id: e.id, organizationId: WCT }, include: { items: true } });
    await deliveries.startFreeTypedItem(e.id, eRun.items[0].id, { technicianName: 'E2E Tech' }, WCT, TECH);
    await settle();
    const renamed = `${eDo.name}-R`;
    await prisma.document.update({ where: { id: eDo.id }, data: { name: renamed } });
    await link.sweep();
    j = await job(e.id);
    check('F: DO renumbered while IN_PROGRESS → title follows, still IN_PROGRESS', j?.title?.endsWith(` · ${renamed}`) && j?.status === 'IN_PROGRESS', [j?.title, j?.status]);
    await prisma.document.update({ where: { id: eDo.id }, data: { name: eDo.name } });
    await link.sweep();

    // ── G: flag off → old behaviour ──
    await setFlags({ enableRealDoOnSchedule: false });
    const g: any = await deliveries.createScheduled(base({ scheduledFor: sgt(6, 9), siteclockWorkerId: undefined, siteclockWorkerName: undefined }) as any, WCT);
    const gDo: any = await doOf(g.id);
    check('G: flag off → DO-PENDING-NN placeholder as before', /^DO-PENDING-\d+$/.test(gDo?.name ?? '') && !(gDo?.config as any)?.issuedOnSchedule, gDo?.name);
    await deliveries.cancel(g.id, WCT);
    check('G: flag off → cancel deletes the placeholder DO as before', !(await prisma.document.findFirst({ where: { id: gDo.id } })));
    await setFlags({ enableRealDoOnSchedule: true });

    // ── tidy: cancel the still-scheduled test runs (DOs stay as Cancelled) ──
    for (const r of pair) await deliveries.cancel(r.id, WCT).catch(() => undefined);
    // the five bare test DOs: marked Cancelled like a cancelled run's DO (never deleted)
    for (const d of fiveDocs) await prisma.document.update({ where: { id: d.id }, data: { config: { ...(d.config as any), cancelled: true, cancelledReason: 'e2e test DO' } } });
    await settle();
    const views = await link.viewsFor(WCT, [a.id, c.id, e.id]);
    check('every SiteClock link SYNCED', [...views.values()].every((v) => v.syncState === 'SYNCED'), [...views.values()].map((v) => [v.syncState, v.lastError]));

    // ── restore flags; leave the connection disabled ──
    const cur = await prisma.organizationUIConfig.findUnique({ where: { organizationId: WCT } });
    const f2: any = { ...((cur?.features as any) || {}) };
    for (const f of FLAGS) {
      if (before[f] === undefined) delete f2[f];
      else f2[f] = before[f];
    }
    await prisma.organizationUIConfig.update({ where: { organizationId: WCT }, data: { features: f2 } });
    await prisma.siteClockConnection.update({ where: { organizationId: WCT }, data: { enabled: false } });
    console.log(`DO numbers issued in this run: ${[aDo.name, cDo.name, ...pairNames, ...fiveNames, eDo.name].join(', ')}`);
  });

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
