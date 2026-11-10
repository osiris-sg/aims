/**
 * All-day jobs end-to-end (2026-11-10), DEV database + a LOCAL SiteClock running the all-day branch.
 *
 * Through the real services: WCT (SiteClock link + calendar on) gets a TIMED delivery (the baseline),
 * an ALL-DAY delivery and an ALL-DAY quick (service) job; Biofuel gets an ALL-DAY return. Checks what
 * is stored, the calendar events, the SiteClock jobs (all-day = the date, no start / end; timed exactly
 * as before), the order of the run picker, the calendar drag (move), switching all-day <-> timed, and
 * that a timed job cannot be dragged.
 *
 * The test jobs are LEFT in place for screenshots (ids in OUT_FILE); `--cleanup` cancels + purges them
 * and restores the WCT flags / connection.
 *
 *   SC_URL=http://localhost:4101 SC_COMPANY=<id> SC_KEY_FILE=<file> SC_WORKERS=<w1>,<w2> SC_DB=<local url> \
 *   AIMS_SECRETS_KEY=<64 hex> TENANCY_MODE=per-org OUT_FILE=<json> \
 *   npx ts-node -r tsconfig-paths/register --transpile-only scripts/_allday-e2e.ts [--cleanup]
 *
 * Refuses PROD_DATABASE_URL's host and a non-local SiteClock.
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
const BIOFUEL = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const BIOFUEL_CUSTOMER = 'f1c9f5ea-a6fa-409e-8e20-23cb6f679e33';
const BIOFUEL_PROJECT = '4f6a13c9-5213-4482-a865-2f4958e05652';
const SC_URL = process.env.SC_URL || 'http://localhost:4101';
const SC_COMPANY = process.env.SC_COMPANY || '';
const SC_KEY = (fs.readFileSync(process.env.SC_KEY_FILE || '', 'utf8').match(/sck_live_[A-Za-z0-9_-]+/) || [])[0] || '';
const [W1, W2] = (process.env.SC_WORKERS || '').split(',');
const SC_DB = process.env.SC_DB || '';
const OUT_FILE = process.env.OUT_FILE || '';
const CLEANUP = process.argv.includes('--cleanup');

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ClerkModule, PushModule, ActionLogModule, DeliveriesModule, DashboardModule] })
class E2EModule {}

const noop = (name: string) => new Proxy({}, { get: (_t, prop) => (prop === 'then' ? undefined : async () => void name) });
let failures = 0;
const check = (label: string, ok: boolean, got?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  → got ${JSON.stringify(got)}`}`);
};
const settle = (ms = 2500) => new Promise((r) => setTimeout(r, ms));
const sgtDay = (offset: number) => new Date(Date.now() + 8 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10);
const sgt = (offset: number, hh: number, mm = 0) => new Date(Date.parse(`${sgtDay(offset)}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+08:00`)).toISOString();
const midnight = (offset: number) => new Date(Date.parse(`${sgtDay(offset)}T00:00:00+08:00`)).toISOString();

(async () => {
  const url = process.env.DATABASE_URL || '';
  const prod = process.env.PROD_DATABASE_URL || '';
  if (prod && new URL(url).host === new URL(prod).host) throw new Error('Refusing: DATABASE_URL is the prod database');
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(SC_URL)) throw new Error('Refusing: SC_URL must be a local SiteClock');
  if (!/localhost|127\.0\.0\.1/.test(SC_DB)) throw new Error('Refusing: SC_DB must be local');
  if (!SC_KEY || !SC_COMPANY || !W1 || !W2 || !OUT_FILE) throw new Error('SC_KEY_FILE, SC_COMPANY, SC_WORKERS and OUT_FILE are required');

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
  const scJob = async (deliveryId: string) => {
    const link = await prisma.deliverySiteClockJob.findUnique({ where: { deliveryId } });
    if (!link?.siteclockJobId) return { link, job: null as any };
    const r = await scdb.query('select date, "startTime", "allDay", "startAt", "endAt", "expectedMinutes", status from "Job" where id = $1', [link.siteclockJobId]);
    return { link, job: r.rows[0] };
  };

  if (CLEANUP) {
    const saved = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
    for (const [org, ids] of [[WCT, saved.wct], [BIOFUEL, saved.biofuel]] as const) {
      await runAsOrg(org, async () => {
        for (const id of ids as string[]) {
          const r: any = await prisma.delivery.findFirst({ where: { id, organizationId: org } });
          if (!r) continue;
          if (r.status !== 'cancelled') await deliveries.cancel(id, org).catch((e) => console.log(`cancel ${id.slice(0, 8)}: ${e?.message}`));
          await settle(1500);
          await deliveries.purgeCancelled(id, org).catch((e) => console.log(`purge ${id.slice(0, 8)}: ${e?.message}`));
        }
      });
    }
    await runAsOrg(WCT, async () => {
      const ui = await prisma.organizationUIConfig.findUnique({ where: { organizationId: WCT } });
      const f: any = { ...((ui?.features as any) || {}) };
      for (const [k, v] of Object.entries(saved.flags as Record<string, unknown>)) {
        if (v === undefined || v === null) delete f[k];
        else f[k] = v;
      }
      await prisma.organizationUIConfig.update({ where: { organizationId: WCT }, data: { features: f } });
      if (saved.connection) await prisma.siteClockConnection.update({ where: { organizationId: WCT }, data: saved.connection });
      else await prisma.siteClockConnection.delete({ where: { organizationId: WCT } }).catch(() => null);
    });
    console.log('cleanup done: test jobs cancelled + purged, WCT flags and SiteClock connection restored');
    await scdb.end();
    await mod.close();
    process.exit(0);
  }

  const wctIds: string[] = [];
  const bioIds: string[] = [];
  const FLAGS = ['enableSiteClockLink', 'enableJobsCalendar', 'enableWctOrders'];
  let flagsBefore: Record<string, unknown> = {};
  let connBefore: any = null;
  await runAsOrg(WCT, async () => {
    const ui = await prisma.organizationUIConfig.findUnique({ where: { organizationId: WCT } });
    const f: any = (ui?.features as any) || {};
    flagsBefore = Object.fromEntries(FLAGS.map((k) => [k, f[k] ?? null]));
    const c = await prisma.siteClockConnection.findUnique({ where: { organizationId: WCT } });
    connBefore = c ? { baseUrl: c.baseUrl, siteclockCompanyId: c.siteclockCompanyId, apiKeyEnc: c.apiKeyEnc, apiKeyLast4: c.apiKeyLast4, enabled: c.enabled, defaultDurationMin: c.defaultDurationMin } : null;
    await prisma.organizationUIConfig.update({ where: { organizationId: WCT }, data: { features: { ...f, enableSiteClockLink: true, enableJobsCalendar: true, enableWctOrders: true } } });
    const conn = { baseUrl: SC_URL, siteclockCompanyId: SC_COMPANY, apiKeyEnc: seal(SC_KEY), apiKeyLast4: SC_KEY.slice(-4), enabled: true, defaultDurationMin: 60 };
    await prisma.siteClockConnection.upsert({ where: { organizationId: WCT }, create: { organizationId: WCT, ...conn }, update: conn });
  });
  const save = () => fs.writeFileSync(OUT_FILE, JSON.stringify({ wct: wctIds, biofuel: bioIds, flags: flagsBefore, connection: connBefore }, null, 1));
  save();

  try {
    await runAsOrg(WCT, async () => {
      let customer = await prisma.customer.findFirst({ where: { organizationId: WCT, name: 'All-day E2E Customer' } });
      if (!customer) customer = await prisma.customer.create({ data: { organizationId: WCT, name: 'All-day E2E Customer' } as any });
      const base = (o: any = {}) => ({
        customerId: customer!.id,
        address: '10 Anson Road, Singapore 079903',
        items: [{ description: 'Scaffold set', quantity: 1, assetClass: 'EQUIPMENT' }],
        ...o,
      });

      // T: timed delivery, tomorrow 10:00, 90 min on SiteClock (the baseline). L: timed, tomorrow 22:00.
      const t: any = await deliveries.createScheduled(base({ scheduledFor: sgt(1, 10), siteclockWorkerId: W1, siteclockWorkerName: 'Wei Worker', siteclockDurationMin: 90 }) as any, WCT);
      wctIds.push(t.id);
      const l: any = await deliveries.createScheduled(base({ scheduledFor: sgt(1, 22) }) as any, WCT);
      wctIds.push(l.id);
      // A: all-day delivery tomorrow, on SiteClock (the form sends the date only).
      const a: any = await deliveries.createScheduled(base({ scheduledFor: sgtDay(1), scheduledAllDay: true, siteclockWorkerId: W1, siteclockWorkerName: 'Wei Worker' }) as any, WCT);
      wctIds.push(a.id);
      // Q: all-day WCT quick (service) job the day after, on SiteClock (Raj).
      const q: any = await deliveries.createQuickJob(WCT, { customerId: customer!.id, siteAddress: '1 Raffles Place, Singapore 048616', scheduledFor: sgtDay(2), allDay: true, workers: [{ id: W2, name: 'Raj Worker' }], remarks: 'All-day e2e quick job' });
      wctIds.push(q.id);
      save();
      await settle(4000);

      const rows = await prisma.delivery.findMany({ where: { id: { in: [t.id, a.id, q.id] } }, select: { id: true, scheduledFor: true, scheduledAllDay: true } });
      const row = (id: string) => rows.find((r) => r.id === id)!;
      check('timed delivery stored exactly as given (10:00 SGT, not all-day)', row(t.id).scheduledFor?.toISOString() === sgt(1, 10) && row(t.id).scheduledAllDay === false, row(t.id));
      check('all-day delivery stored as 00:00 SGT of its day + flag', row(a.id).scheduledFor?.toISOString() === midnight(1) && row(a.id).scheduledAllDay === true, row(a.id));
      check('all-day quick job stored as 00:00 SGT of its day + flag', row(q.id).scheduledFor?.toISOString() === midnight(2) && row(q.id).scheduledAllDay === true, row(q.id));

      const st = await scJob(t.id);
      check('SiteClock: timed job exactly as before (10:00, 90 min, not all-day)', st.link?.syncState === 'SYNCED' && st.job?.startTime === '10:00' && st.job?.expectedMinutes === 90 && st.job?.allDay === false && st.job?.date === sgtDay(1), { link: st.link?.syncState, err: st.link?.lastError, job: st.job });
      const sa = await scJob(a.id);
      check('SiteClock: all-day delivery = its date, no time / window / length', sa.link?.syncState === 'SYNCED' && sa.job?.allDay === true && sa.job?.date === sgtDay(1) && sa.job?.startTime === null && sa.job?.startAt === null && sa.job?.expectedMinutes === null, { link: sa.link?.syncState, err: sa.link?.lastError, job: sa.job });
      const sq = await scJob(q.id);
      check('SiteClock: all-day quick job = its date, no time', sq.link?.syncState === 'SYNCED' && sq.job?.allDay === true && sq.job?.date === sgtDay(2) && sq.job?.startTime === null, { link: sq.link?.syncState, err: sq.link?.lastError, job: sq.job });

      const cal = await calendar.get(WCT, sgtDay(0), sgtDay(5));
      const ev = (id: string) => cal.events.find((e) => e.id === `aims:${id}`);
      check('calendar: timed delivery unchanged (10:00 to 11:30 SGT)', ev(t.id)?.allDay === false && ev(t.id)?.start === sgt(1, 10) && ev(t.id)?.end === sgt(1, 11, 30), ev(t.id));
      check('calendar: all-day delivery = all-day event on its day', ev(a.id)?.allDay === true && ev(a.id)?.start === sgtDay(1) && ev(a.id)?.end === null, ev(a.id));
      check('calendar: all-day quick job = all-day event on its day', ev(q.id)?.allDay === true && ev(q.id)?.start === sgtDay(2), ev(q.id));
      check('calendar: the SiteClock copy of an AIMS all-day job is not shown twice', !cal.events.some((e) => e.source === 'siteclock' && e.title.includes(`#${a.deliveryNumber} `)), cal.events.filter((e) => e.source === 'siteclock').map((e) => e.title));

      const picker = await deliveries.listOpenScheduledForPicker(WCT);
      const pos = (id: string) => picker.findIndex((p: any) => p.id === id);
      check('run picker: timed 10:00, timed 22:00, then the all-day job of the same day', pos(t.id) < pos(l.id) && pos(l.id) < pos(a.id) && pos(a.id) >= 0, picker.filter((p: any) => [t.id, l.id, a.id].includes(p.id)).map((p: any) => p.deliveryNumber));

      // Drag: all-day A → +3 days; timed T refused.
      const moved: any = await deliveries.moveAllDayJob(a.id, WCT, { date: sgtDay(3) });
      check('drag: all-day job moved to another day (00:00 SGT, still all-day)', new Date(moved.scheduledFor).toISOString() === midnight(3) && moved.scheduledAllDay === true, moved);
      const refused = await deliveries.moveAllDayJob(t.id, WCT, { date: sgtDay(3) }).then(() => 'moved', (e) => e?.message);
      check('drag: a timed job cannot be dragged', /no specific time/.test(String(refused)), refused);
      await settle(4000);
      const sa2 = await scJob(a.id);
      check('SiteClock follows the drag (date changed, still all-day)', sa2.job?.date === sgtDay(3) && sa2.job?.allDay === true, sa2.job);

      // Untick "No specific time" on the quick job: back to a timed job at 14:00 for 60 min.
      await deliveries.updateQuickJob(q.id, WCT, { customerId: customer!.id, siteAddress: '1 Raffles Place, Singapore 048616', scheduledFor: sgt(2, 14), durationMin: 60, workers: [{ id: W2, name: 'Raj Worker' }], remarks: 'All-day e2e quick job' });
      await settle(4000);
      const sq2 = await scJob(q.id);
      const q2 = await prisma.delivery.findUnique({ where: { id: q.id }, select: { scheduledFor: true, scheduledAllDay: true } });
      check('untick: quick job is timed again in AIMS (14:00) and SiteClock (14:00, 60 min)', q2?.scheduledAllDay === false && q2?.scheduledFor?.toISOString() === sgt(2, 14) && sq2.job?.allDay === false && sq2.job?.startTime === '14:00' && sq2.job?.expectedMinutes === 60, { q2, job: sq2.job });
      // …and ticked again for the screenshots.
      await deliveries.updateQuickJob(q.id, WCT, { customerId: customer!.id, siteAddress: '1 Raffles Place, Singapore 048616', scheduledFor: sgtDay(2), allDay: true, workers: [{ id: W2, name: 'Raj Worker' }], remarks: 'All-day e2e quick job' });
      await settle(3000);
      const sq3 = await scJob(q.id);
      check('tick again: all-day in SiteClock again (window cleared)', sq3.job?.allDay === true && sq3.job?.startTime === null && sq3.job?.startAt === null, sq3.job);
    });

    // Biofuel: an all-day RETURN (typed line under the customer's project).
    await runAsOrg(BIOFUEL, async () => {
      const r: any = await deliveries.createScheduledReturn(
        { scheduledFor: sgtDay(1), scheduledAllDay: true, customerId: BIOFUEL_CUSTOMER, typedLines: [{ description: 'All-day e2e return unit' }], projectId: BIOFUEL_PROJECT } as any,
        BIOFUEL,
      );
      bioIds.push(r.id);
      save();
      const row = await prisma.delivery.findUnique({ where: { id: r.id }, select: { direction: true, scheduledFor: true, scheduledAllDay: true } });
      check('Biofuel: all-day return stored as 00:00 SGT + flag', row?.direction === 'RETURN' && row?.scheduledFor?.toISOString() === midnight(1) && row?.scheduledAllDay === true, row);
      const timedR: any = await deliveries.createScheduledReturn(
        { scheduledFor: sgt(1, 9, 30), customerId: BIOFUEL_CUSTOMER, typedLines: [{ description: 'Timed e2e return unit' }], projectId: BIOFUEL_PROJECT } as any,
        BIOFUEL,
      );
      bioIds.push(timedR.id);
      save();
      const trow = await prisma.delivery.findUnique({ where: { id: timedR.id }, select: { scheduledFor: true, scheduledAllDay: true } });
      check('Biofuel: a timed return without the flag is exactly as before (09:30, not all-day)', trow?.scheduledFor?.toISOString() === sgt(1, 9, 30) && trow?.scheduledAllDay === false, trow);
    });
  } finally {
    save();
    await scdb.end();
    await mod.close();
  }
  console.log(`\n${failures ? `${failures} FAILED` : 'ALL PASSED'} · test jobs left for screenshots: ${OUT_FILE} (run with --cleanup to remove)`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
