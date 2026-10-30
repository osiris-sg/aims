/**
 * Jobs calendar end-to-end (2026-10-30), DEV database + a LOCAL SiteClock.
 *
 * Schedules real runs through DeliveriesService for the dev WCT org (one put on
 * SiteClock, one not, a draft, a cancelled one), plans SiteClock-native jobs on
 * the local SiteClock company, then reads JobsCalendarService.get() and checks:
 * both sources merged, the AIMS-created SiteClock job shown once with its crew's
 * arrival, colours/kinds, durations, rider after a claim, drafts absent,
 * cancelled flagged, the 60 s cache, "SiteClock unavailable" when SiteClock is
 * down, and a non-WCT org refused (flag off).
 *
 * Boots ONLY the deliveries + dashboard modules (no ScheduleModule → no cron),
 * StaffWhatsAppService + PushService are no-ops.
 *
 *   SC_URL=http://localhost:4100 SC_COMPANY=<id> SC_KEY_FILE=<file> SC_WORKERS=<w1>,<w2> SC_DB=<local url> \
 *   SC_NATIVE=<timed job id>,<all-day job id> AIMS_SECRETS_KEY=<64 hex> TENANCY_MODE=per-org \
 *   npx ts-node -r tsconfig-paths/register --transpile-only scripts/_jobs-calendar-e2e.ts
 *
 * Dev writes: WCT flags enableSiteClockLink / enableJobsCalendar (restored), the
 * WCT SiteClockConnection (left disabled), test runs (cancelled + purged at the
 * end). Refuses PROD_DATABASE_URL's host and a non-local SiteClock.
 */
import 'dotenv/config';
import * as fs from 'fs';
import { Client } from 'pg';
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
import { DashboardModule } from '../src/dashboard/dashboard.module';
import { JobsCalendarService } from '../src/dashboard/jobs-calendar.service';
import { seal } from '../src/common/secret-box';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const SC_URL = process.env.SC_URL || 'http://localhost:4100';
const SC_COMPANY = process.env.SC_COMPANY || '';
const SC_KEY = (fs.readFileSync(process.env.SC_KEY_FILE || '', 'utf8').match(/sck_live_[A-Za-z0-9_-]+/) || [])[0] || '';
const [W1, W2] = (process.env.SC_WORKERS || '').split(',');
const [NATIVE_TIMED, NATIVE_ALLDAY] = (process.env.SC_NATIVE || '').split(',');
const SC_DB = process.env.SC_DB || '';

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ClerkModule, PushModule, ActionLogModule, DeliveriesModule, DashboardModule] })
class E2EModule {}

const silenced: string[] = [];
const noop = (name: string) =>
  new Proxy({}, { get: (_t, prop) => (prop === 'then' ? undefined : async () => void silenced.push(`${name}.${String(prop)}`)) });

let failures = 0;
const check = (label: string, ok: boolean, got?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  → got ${JSON.stringify(got)}`}`);
};
const settle = (ms = 2000) => new Promise((r) => setTimeout(r, ms));
const sgtDay = (offset: number) => new Date(Date.now() + 8 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10);
const sgt = (offset: number, hh: number, mm = 0) => new Date(Date.parse(`${sgtDay(offset)}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+08:00`)).toISOString();

(async () => {
  const url = process.env.DATABASE_URL || '';
  const prod = process.env.PROD_DATABASE_URL || '';
  if (prod && new URL(url).host === new URL(prod).host) throw new Error('Refusing: DATABASE_URL is the prod database');
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(SC_URL)) throw new Error('Refusing: SC_URL must be a local SiteClock');
  if (!/localhost|127\.0\.0\.1/.test(SC_DB)) throw new Error('Refusing: SC_DB must be local');
  if (!SC_KEY || !SC_COMPANY || !W1 || !W2 || !NATIVE_TIMED || !NATIVE_ALLDAY) throw new Error('SC_KEY_FILE, SC_COMPANY, SC_WORKERS and SC_NATIVE are required');

  const mod = await Test.createTestingModule({ imports: [E2EModule] })
    .overrideProvider(StaffWhatsAppService)
    .useValue(noop('StaffWhatsAppService'))
    .overrideProvider(PushService)
    .useValue(noop('PushService'))
    .compile();
  const prisma = mod.get(PrismaService);
  const deliveries = mod.get(DeliveriesService);
  const calendar = mod.get(JobsCalendarService);
  const scdb = new Client({ connectionString: SC_DB });
  await scdb.connect();

  const created: string[] = [];
  const ui = await prisma.organizationUIConfig.findUnique({ where: { organizationId: WCT } });
  const before = { link: ((ui?.features as any) || {}).enableSiteClockLink, cal: ((ui?.features as any) || {}).enableJobsCalendar };
  try {
    await runAsOrg(WCT, async () => {
      // ── setup (dev) ──
      await prisma.organizationUIConfig.update({
        where: { organizationId: WCT },
        data: { features: { ...((ui?.features as any) || {}), enableSiteClockLink: true, enableJobsCalendar: true } },
      });
      const conn = { baseUrl: SC_URL, siteclockCompanyId: SC_COMPANY, apiKeyEnc: seal(SC_KEY), apiKeyLast4: SC_KEY.slice(-4), enabled: true, defaultDurationMin: 60 };
      await prisma.siteClockConnection.upsert({ where: { organizationId: WCT }, create: { organizationId: WCT, ...conn }, update: conn });
      let customer = await prisma.customer.findFirst({ where: { organizationId: WCT, name: 'SiteClock E2E Test Customer' } });
      if (!customer) customer = await prisma.customer.create({ data: { organizationId: WCT, name: 'SiteClock E2E Test Customer' } as any });
      console.log(`dev WCT ready (flags were link=${before.link ?? 'unset'} calendar=${before.cal ?? 'unset'})`);

      const base = (o: any = {}) => ({
        customerId: customer!.id,
        address: '10 Anson Road, Singapore 079903',
        items: [{ description: 'Kitchen exhaust degrease', quantity: 1, assetClass: 'SERVICE' }],
        scheduledFor: sgt(1, 10),
        ...o,
      });

      // A: service run on SiteClock (Cal Worker 1, 90 min). B: delivery not on SiteClock. C: draft. D: cancelled.
      const a: any = await deliveries.createScheduled(base({ siteclockWorkerId: W1, siteclockWorkerName: 'Cal Worker 1', siteclockDurationMin: 90 }) as any, WCT);
      created.push(a.id);
      const b: any = await deliveries.createScheduled(base({ scheduledFor: sgt(1, 14), items: [{ description: 'Scaffold set', quantity: 2, assetClass: 'EQUIPMENT' }] }) as any, WCT);
      created.push(b.id);
      const c: any = await deliveries.createScheduled(base({ isDraft: true, scheduledFor: sgt(1, 16) }) as any, WCT);
      created.push(c.id);
      const d: any = await deliveries.createScheduled(base({ scheduledFor: sgt(1, 17) }) as any, WCT);
      created.push(d.id);
      await deliveries.cancel(d.id, WCT);
      await settle(3000);

      const link = await prisma.deliverySiteClockJob.findUnique({ where: { deliveryId: a.id } });
      check('A linked and SYNCED on SiteClock', link?.syncState === 'SYNCED' && !!link?.siteclockJobId, link);

      // ── calendar: today .. +2 ──
      const from = sgtDay(0);
      const to = sgtDay(2);
      const r1 = await calendar.get(WCT, from, to);
      const ev = (id: string) => r1.events.find((e) => e.id === id);
      check('siteclock state ok', r1.siteclock.state === 'ok', r1.siteclock);
      const ea = ev(`aims:${a.id}`);
      check('A: service run (orange kind), 10:00–11:30 SGT from the link duration', ea?.kind === 'service' && ea.start === sgt(1, 10) && ea.end === sgt(1, 11, 30), ea);
      check('A: worker = SiteClock planned worker, no rider yet, delivery page link', ea?.worker === 'Cal Worker 1' && ea.rider === null && ea.href === `/portal/deliveries/${a.id}`, ea);
      check("A's SiteClock job is not shown on its own (no duplicate)", !r1.events.some((e) => e.id === `sc:${link?.siteclockJobId}`), r1.events.map((e) => e.id));
      const eb = ev(`aims:${b.id}`);
      check('B: delivery (blue kind), no SiteClock link → 60 min, no worker', eb?.kind === 'delivery' && eb.start === sgt(1, 14) && eb.end === sgt(1, 15) && eb.worker === null, eb);
      check('C: draft never shows', !ev(`aims:${c.id}`));
      const ed = ev(`aims:${d.id}`);
      check('D: cancelled run comes back flagged cancelled (portal hides it unless Show cancelled)', ed?.cancelled === true && ed.statusLabel === 'Cancelled', ed);
      const nt = ev(`sc:${NATIVE_TIMED}`);
      check('SiteClock-native timed job: green kind, 09:00–09:45, team label, Open in SiteClock', nt?.kind === 'siteclock' && nt.start === sgt(1, 9) && nt.end === sgt(1, 9, 45) && nt.worker === 'Team Cal' && !!nt.siteclockUrl && nt.href === null, nt);
      const na = ev(`sc:${NATIVE_ALLDAY}`);
      check('SiteClock-native job without a time: all day', na?.allDay === true && na.start === sgtDay(1) && na.crew[0]?.name === 'Cal Worker 1', na);

      // ── crew arrival from SiteClock merges onto A; rider shows once claimed ──
      const sj = await scdb.query('select "siteId" from "Job" where id = $1', [link!.siteclockJobId]);
      await scdb.query(
        `insert into "Punch" (id, "companyId", "userId", "siteId", type, "serverTime", lat, lng, "accuracyM", "distanceM", "insideFence", status, "jobId")
         values ($1, $2, $3, $4, 'IN', ($5::timestamptz AT TIME ZONE 'UTC'), 1.2765, 103.8458, 10, 5, true, 'OK', $6)`,
        [`e2e-cal-${Date.now()}`, SC_COMPANY, W1, sj.rows[0].siteId, sgt(1, 10, 5), link!.siteclockJobId],
      );
      await prisma.delivery.update({ where: { id: a.id }, data: { riderUserId: 'user_e2e_calendar', riderName: 'E2E Rider' } });
      const cached = await calendar.get(WCT, from, to);
      check('60 s cache: same range again does not re-read SiteClock (no arrival yet)', (cached.events.find((e) => e.id === `aims:${a.id}`)?.crew[0]?.arrivedAt ?? null) === null, cached.events.find((e) => e.id === `aims:${a.id}`));
      const r2 = await calendar.get(WCT, sgtDay(1), sgtDay(1));
      const ea2 = r2.events.find((e) => e.id === `aims:${a.id}`);
      check("A: SiteClock crew arrival merged onto the AIMS event", ea2?.crew[0]?.name === 'Cal Worker 1' && ea2.crew[0].arrivedAt === sgt(1, 10, 5), ea2);
      check('A: AIMS rider shown once claimed', ea2?.rider === 'E2E Rider', ea2);

      // ── SiteClock down → AIMS events + unavailable ──
      await prisma.siteClockConnection.update({ where: { organizationId: WCT }, data: { baseUrl: 'http://localhost:4999' } });
      const r3 = await calendar.get(WCT, sgtDay(0), sgtDay(3));
      check('SiteClock down: state unavailable, AIMS events still there, no SiteClock events', r3.siteclock.state === 'unavailable' && r3.events.some((e) => e.id === `aims:${a.id}`) && !r3.events.some((e) => e.source === 'siteclock'), r3.siteclock);
      await prisma.siteClockConnection.update({ where: { organizationId: WCT }, data: { baseUrl: SC_URL } });

      // ── range guard ──
      const tooLong = await calendar.get(WCT, sgtDay(0), sgtDay(70)).then(() => 'ok', (e) => e?.status);
      check('more than 62 days → 400', tooLong === 400, tooLong);
    });

    // ── a non-WCT org: flag off → 404, nothing read ──
    const others = await prisma.organization.findMany({ where: { id: { not: WCT } }, select: { id: true, name: true } });
    const other = others.find((o) => /biofuel/i.test(o.name)) ?? others[0];
    const res = await calendar.get(other.id, sgtDay(0), sgtDay(1)).then(() => 'ok', (e) => e?.status);
    check(`non-WCT org (${other.name}): jobs calendar refused (404, flag off)`, res === 404, res);
  } finally {
    // ── cleanup: cancel + purge the test runs, restore flags, leave the connection disabled ──
    await runAsOrg(WCT, async () => {
      for (const id of created) {
        const r: any = await prisma.delivery.findFirst({ where: { id, organizationId: WCT } });
        if (!r) continue;
        if (r.riderUserId) await prisma.delivery.update({ where: { id }, data: { riderUserId: null, riderName: null } });
        if (r.isDraft) await deliveries.remove(id, WCT).catch((e) => console.log(`remove ${id.slice(0, 8)}: ${e?.message}`));
        else {
          if (r.status !== 'cancelled') await deliveries.cancel(id, WCT).catch((e) => console.log(`cancel ${id.slice(0, 8)}: ${e?.message}`));
          await settle(1500);
          await deliveries.purgeCancelled(id, WCT).catch((e) => console.log(`purge ${id.slice(0, 8)}: ${e?.message}`));
        }
      }
      const ui2 = await prisma.organizationUIConfig.findUnique({ where: { organizationId: WCT } });
      const f2: any = { ...((ui2?.features as any) || {}) };
      for (const [k, v] of [['enableSiteClockLink', before.link], ['enableJobsCalendar', before.cal]] as const) {
        if (v === undefined) delete f2[k];
        else f2[k] = v;
      }
      await prisma.organizationUIConfig.update({ where: { organizationId: WCT }, data: { features: f2 } });
      await prisma.siteClockConnection.update({ where: { organizationId: WCT }, data: { enabled: false } });
      const left = await prisma.delivery.count({ where: { id: { in: created } } });
      console.log(`cleanup: ${created.length - left}/${created.length} test runs removed, flags restored, connection disabled`);
    });
    await scdb.end();
  }

  console.log(`silenced (never sent): ${silenced.length ? [...new Set(silenced)].join(', ') : 'none'}`);
  await mod.close();
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('E2E error:', e?.stack || e);
  process.exit(1);
});
