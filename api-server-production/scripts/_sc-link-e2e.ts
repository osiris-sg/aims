/**
 * SiteClock link end-to-end (2026-10-30), DEV database + a LOCAL SiteClock.
 *
 * Drives the real DeliveriesService (createScheduled / updateScheduled / field
 * start / end / finalize / cancel / remove) for the dev WCT org and checks the
 * SiteClock job through SiteClock's own /v1 API after every step. Then checks a
 * non-WCT org gets no link and no SiteClock call.
 *
 * Boots ONLY the deliveries + SiteClock modules (no ScheduleModule, so no cron
 * of any kind runs), and replaces StaffWhatsAppService + PushService with no-ops
 * so nothing reaches WhatsApp or FCM.
 *
 *   SC_URL=http://localhost:4100 SC_COMPANY=<id> SC_KEY_FILE=<file> SC_WORKERS=<id>,<id> \
 *   AIMS_SECRETS_KEY=<64 hex> TENANCY_MODE=per-org \
 *   npx ts-node -r tsconfig-paths/register --transpile-only scripts/_sc-link-e2e.ts
 *
 * Dev writes: the WCT SiteClockConnection (left disabled at the end), the
 * enableSiteClockLink flag (restored at the end), one test customer and the
 * test runs. Refuses PROD_DATABASE_URL's host and a non-local SiteClock.
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
import { SiteClockLinkService } from '../src/siteclock/siteclock-link.service';
import { seal } from '../src/common/secret-box';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const SC_URL = process.env.SC_URL || 'http://localhost:4100';
const SC_COMPANY = process.env.SC_COMPANY || '';
const SC_KEY = (fs.readFileSync(process.env.SC_KEY_FILE || '', 'utf8').match(/sck_live_[A-Za-z0-9_-]+/) || [])[0] || '';
const [W1, W2] = (process.env.SC_WORKERS || '').split(',');
const TECH = 'user_e2e_siteclock';

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ClerkModule, PushModule, ActionLogModule, DeliveriesModule] })
class E2EModule {}

/** Any method resolves to nothing; calls are counted so the run can show none went out. */
const silenced: string[] = [];
const noop = (name: string) =>
  new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === 'then'
          ? undefined
          : async () => {
              silenced.push(`${name}.${String(prop)}`);
              return 0;
            },
    },
  );

let failures = 0;
const check = (label: string, ok: boolean, got?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  → got ${JSON.stringify(got)}`}`);
};

async function sc(path: string) {
  const r = await fetch(`${SC_URL}${path}`, { headers: { Authorization: `Bearer ${SC_KEY}` } });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const job = async (deliveryId: string, gen = 1) => (await sc(`/v1/jobs/by-ref/${encodeURIComponent(`aims-delivery:${deliveryId}${gen > 1 ? `:${gen}` : ''}`)}`)).body?.job;
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));
const sgt = (dayOffset: number, hh: number, mm = 0) => {
  const d = new Date(Date.now() + 8 * 3600_000);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  d.setUTCHours(hh - 8, mm, 0, 0);
  return d.toISOString();
};

(async () => {
  const url = process.env.DATABASE_URL || '';
  const prod = process.env.PROD_DATABASE_URL || '';
  if (prod && new URL(url).host === new URL(prod).host) throw new Error('Refusing: DATABASE_URL is the prod database');
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(SC_URL)) throw new Error('Refusing: SC_URL must be a local SiteClock');
  if (!SC_KEY || !SC_COMPANY || !W1 || !W2) throw new Error('SC_KEY_FILE, SC_COMPANY and SC_WORKERS (two ids) are required');

  const mod = await Test.createTestingModule({ imports: [E2EModule] })
    .overrideProvider(StaffWhatsAppService)
    .useValue(noop('StaffWhatsAppService'))
    .overrideProvider(PushService)
    .useValue(noop('PushService'))
    .compile();
  const prisma = mod.get(PrismaService);
  const deliveries = mod.get(DeliveriesService);
  const link = mod.get(SiteClockLinkService);

  await runAsOrg(WCT, async () => {
    // ── setup (dev) ──
    const ui = await prisma.organizationUIConfig.findUnique({ where: { organizationId: WCT } });
    const before = ((ui?.features as any) || {}).enableSiteClockLink;
    await prisma.organizationUIConfig.update({ where: { organizationId: WCT }, data: { features: { ...((ui?.features as any) || {}), enableSiteClockLink: true } } });
    const conn = { baseUrl: SC_URL, siteclockCompanyId: SC_COMPANY, apiKeyEnc: seal(SC_KEY), apiKeyLast4: SC_KEY.slice(-4), enabled: true, defaultDurationMin: 60 };
    await prisma.siteClockConnection.upsert({ where: { organizationId: WCT }, create: { organizationId: WCT, ...conn }, update: conn });
    let customer = await prisma.customer.findFirst({ where: { organizationId: WCT, name: 'SiteClock E2E Test Customer' } });
    if (!customer) customer = await prisma.customer.create({ data: { organizationId: WCT, name: 'SiteClock E2E Test Customer' } as any });
    console.log(`dev WCT ready (flag was ${before ?? 'unset'}), customer ${customer.id.slice(0, 8)}`);

    const cfg = await link.formConfig(WCT);
    check('form config: link on, default 60 min', cfg.enabled === true && (cfg as any).defaultDurationMin === 60, cfg);
    const workers = await link.workers(WCT, true);
    const names = [...workers.teams.flatMap((t: any) => t.workers), ...workers.others].map((w: any) => w.name);
    check('worker picker lists SiteClock workers (proxy, no key in portal)', names.length >= 2, names);
    const nameOf = (id: string) => [...workers.teams.flatMap((t: any) => t.workers), ...workers.others].find((w: any) => w.id === id)?.name ?? null;

    const base = (o: any = {}) => ({
      customerId: customer!.id,
      address: '10 Anson Road, Singapore 079903',
      items: [{ description: 'Kitchen exhaust degrease', quantity: 1, assetClass: 'SERVICE' }],
      scheduledFor: sgt(1, 10),
      ...o,
    });

    // ── A: schedule → reschedule → reassign → start → complete ──
    const a: any = await deliveries.createScheduled(base({ siteclockWorkerId: W1, siteclockWorkerName: nameOf(W1), siteclockDurationMin: 60 }) as any, WCT);
    await settle();
    let j = await job(a.id);
    check('A scheduled: job exists for worker 1', j?.worker?.id === W1 && j?.status === 'SCHEDULED', j);
    check('A window 10:00 to 11:00 +08:00', j?.startAtLocal?.startsWith(sgt(1, 10).slice(0, 10)) && /T10:00:00\+08:00$/.test(j?.startAtLocal) && /T11:00:00\+08:00$/.test(j?.endAtLocal), [
      j?.startAtLocal,
      j?.endAtLocal,
    ]);
    check('A site is the delivery address', /Anson/.test(j?.site?.address ?? ''), j?.site);

    await deliveries.updateScheduled(a.id, base({ scheduledFor: sgt(2, 14, 30), siteclockDurationMin: 90 }) as any, WCT);
    await settle();
    j = await job(a.id);
    check('A rescheduled: 14:30 to 16:00, same worker', /T14:30:00\+08:00$/.test(j?.startAtLocal) && /T16:00:00\+08:00$/.test(j?.endAtLocal) && j?.worker?.id === W1, [
      j?.startAtLocal,
      j?.endAtLocal,
      j?.worker,
    ]);

    await deliveries.updateScheduled(a.id, base({ scheduledFor: sgt(2, 14, 30), siteclockWorkerId: W2, siteclockWorkerName: nameOf(W2) }) as any, WCT);
    await settle();
    j = await job(a.id);
    check('A reassigned to worker 2 (duration kept)', j?.worker?.id === W2 && /T16:00:00\+08:00$/.test(j?.endAtLocal), [j?.worker, j?.endAtLocal]);

    const aRun: any = await prisma.delivery.findFirst({ where: { id: a.id, organizationId: WCT }, include: { items: true } });
    const item = aRun.items[0];
    await deliveries.startFreeTypedItem(a.id, item.id, { technicianName: 'E2E Tech' }, WCT, TECH);
    await settle();
    j = await job(a.id);
    check('A started in the field: job IN_PROGRESS', j?.status === 'IN_PROGRESS' && !!j?.startedAt, [j?.status, j?.startedAt]);

    await deliveries.endFreeTypedItem(a.id, item.id, { technicianName: 'E2E Tech' }, WCT, TECH);
    await deliveries.finalizeRun(a.id, { signature: 'data:image/png;base64,iVBORw0KGgo=', recipientName: 'E2E Customer', technicianName: 'E2E Tech', installNeeded: false } as any, WCT, TECH);
    await settle(2500);
    const aAfter: any = await prisma.delivery.findFirst({ where: { id: a.id, organizationId: WCT } });
    j = await job(a.id);
    check(`A finished (run ${aAfter?.status}): job COMPLETED`, j?.status === 'COMPLETED' && !!j?.completedAt, [aAfter?.status, j?.status]);

    // ── B: cancel ──
    const b: any = await deliveries.createScheduled(base({ siteclockWorkerId: W1, siteclockWorkerName: nameOf(W1) }) as any, WCT);
    await settle();
    check('B scheduled: job exists', (await job(b.id))?.status === 'SCHEDULED');
    await deliveries.cancel(b.id, WCT);
    await settle();
    j = await job(b.id);
    check('B cancelled in AIMS: job CANCELLED', j?.status === 'CANCELLED' && /cancelled in AIMS/.test(j?.cancelReason ?? ''), [j?.status, j?.cancelReason]);

    // ── C: delete ──
    const c: any = await deliveries.createScheduled(base({ siteclockWorkerId: W2, siteclockWorkerName: nameOf(W2) }) as any, WCT);
    await settle();
    check('C scheduled: job exists', (await job(c.id))?.status === 'SCHEDULED');
    await deliveries.remove(c.id, WCT);
    await settle();
    j = await job(c.id);
    check('C deleted in AIMS: job CANCELLED', j?.status === 'CANCELLED' && /deleted in AIMS/.test(j?.cancelReason ?? ''), [j?.status, j?.cancelReason]);

    // ── D: worker cleared, then set again → a new job ──
    const d: any = await deliveries.createScheduled(base({ siteclockWorkerId: W1, siteclockWorkerName: nameOf(W1) }) as any, WCT);
    await settle();
    await deliveries.updateScheduled(d.id, base({ siteclockWorkerId: null, siteclockWorkerName: null }) as any, WCT);
    await settle();
    j = await job(d.id);
    check('D worker cleared: job CANCELLED', j?.status === 'CANCELLED', j?.status);
    await deliveries.updateScheduled(d.id, base({ siteclockWorkerId: W2, siteclockWorkerName: nameOf(W2) }) as any, WCT);
    await settle();
    j = await job(d.id, 2);
    check('D worker set again: new job (ref :2) for worker 2', j?.status === 'SCHEDULED' && j?.worker?.id === W2, j);

    // ── E: draft gets no job until promoted ──
    const e: any = await deliveries.createScheduled(base({ isDraft: true, scheduledFor: undefined, siteclockWorkerId: W1, siteclockWorkerName: nameOf(W1) }) as any, WCT);
    await settle();
    check('E draft: no SiteClock job', !(await job(e.id)));
    await deliveries.updateScheduled(e.id, base({ siteclockWorkerId: W1, siteclockWorkerName: nameOf(W1) }) as any, WCT);
    await settle();
    check('E promoted: job SCHEDULED', (await job(e.id))?.status === 'SCHEDULED');

    // ── F: a request without SiteClock fields leaves the pick alone ──
    await deliveries.updateScheduled(e.id, base({ scheduledFor: sgt(3, 9) }) as any, WCT);
    await settle();
    j = await job(e.id);
    check('E edited without SiteClock fields: worker kept, time moved', j?.worker?.id === W1 && /T09:00:00\+08:00$/.test(j?.startAtLocal), [j?.worker, j?.startAtLocal]);

    // ── links + views ──
    const views = await link.viewsFor(WCT, [a.id, b.id, d.id, e.id]);
    check(
      'every link SYNCED',
      [...views.values()].every((v) => v.syncState === 'SYNCED'),
      [...views.values()].map((v) => [v.syncState, v.lastError]),
    );
    for (const id of [b.id, d.id, e.id]) {
      const r: any = await prisma.delivery.findFirst({ where: { id, organizationId: WCT } });
      if (r && r.status === 'scheduled') await deliveries.cancel(id, WCT).catch(() => undefined);
      if (r?.isDraft) await deliveries.remove(id, WCT).catch(() => undefined);
    }
    await settle();

    // ── restore dev flag; leave the connection disabled ──
    const ui2 = await prisma.organizationUIConfig.findUnique({ where: { organizationId: WCT } });
    const f2: any = { ...((ui2?.features as any) || {}) };
    if (before === undefined) delete f2.enableSiteClockLink;
    else f2.enableSiteClockLink = before;
    await prisma.organizationUIConfig.update({ where: { organizationId: WCT }, data: { features: f2 } });
    await prisma.siteClockConnection.update({ where: { organizationId: WCT }, data: { enabled: false } });
  });

  // ── a non-WCT org: nothing happens ──
  const others = await prisma.organization.findMany({ where: { id: { not: WCT } }, select: { id: true, name: true } });
  const other = others.find((o) => /biofuel/i.test(o.name)) ?? others[0];
  await runAsOrg(other.id, async () => {
    const run: any = await prisma.delivery.findFirst({ where: { organizationId: other.id }, orderBy: { createdAt: 'desc' } });
    const jobsBefore = (await sc('/v1/jobs?limit=500')).body?.jobs?.length ?? 0;
    if (run) {
      await link.onScheduleSaved(other.id, run.id, { workerId: W1, workerName: 'x' });
      await link.touch(other.id, run.id);
    }
    await settle();
    const rows = await prisma.deliverySiteClockJob.count({ where: { organizationId: other.id } });
    const jobsAfter = (await sc('/v1/jobs?limit=500')).body?.jobs?.length ?? 0;
    check(`non-WCT org (${other.name}): no link rows, no SiteClock job`, rows === 0 && jobsAfter === jobsBefore, { rows, jobsBefore, jobsAfter });
    check(`non-WCT org: form config off, list views empty`, (await link.formConfig(other.id)).enabled === false && (await link.viewsFor(other.id, run ? [run.id] : [])).size === 0);
  });

  console.log(`silenced (never sent): ${silenced.length ? [...new Set(silenced)].join(', ') : 'none'}`);
  await mod.close();
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('E2E error:', e?.stack || e);
  process.exit(1);
});
