/**
 * SiteClock deliveries — Stage 1 end-to-end (2026-11-06). DEV database, a LOCAL
 * SiteClock (siteclock worktree on :4100, local pg) and a LOCAL AIMS API built
 * from this branch (:4041). Every worker call goes the way the app will send
 * it: SiteClock app route (worker JWT) → SiteClock proxy → AIMS worker API.
 *
 *   T  toggle: enableSiteClockDeliveries + a mapped field worker → the SiteClock
 *      job carries deliveryEnabled; an unmapped worker's job doesn't; the flag
 *      off / on re-syncs; /jobs/mine shows it.
 *   G  guards: not crew → 404, Delivery off → 409 (SiteClock); another worker's
 *      ref → NOT_YOUR_JOB, unmapped worker → NOT_LINKED, flag off →
 *      DELIVERIES_OFF (AIMS, called directly with the inbound key).
 *   F  the outbound flow through the proxy: photo upload, equipment line start
 *      (4 photos; 3 refused with SiteJobs' sentence), service line, Who's doing
 *      this job, End (ack-all), sign-off; run completed, DO + WhatsApp post
 *      queued ONCE, SiteClock job COMPLETED, DO view + PDF, Activity Log rows
 *      name the worker.
 *   I  Idempotency-Key: the same start twice → replayed, one DO_START; the same
 *      key with another body → 422.
 *   C  simultaneous: two starts of one line → one; two sign-offs → one
 *      completion, one post, one DO commit.
 *   P  partial sign-off, skip / unskip, then the rest.
 *   R  a return: claim, start (photos), collect, return sign-off → RDO.
 *   S  pending sign: a service report left unsigned → listed → signed.
 *   U  the SiteJobs unit path (dev Biofuel, service calls exactly as SiteJobs'
 *      controllers make them, no Idempotency-Key): two claims of one scheduled
 *      slot at once → one, the loser's unit back in stock; two deliveries of
 *      the unit → one; two sign-offs → one DO.
 *
 *   SC_KEY_FILE=… INBOUND_KEY_FILE=… AIMS_SECRETS_KEY=<same as the API> TENANCY_MODE=per-org \
 *   npx ts-node -r tsconfig-paths/register --transpile-only scripts/_scd-e2e.ts
 *
 * Dev writes (test runs are marked "SCD-E2E" in their notes and left in place):
 * the WCT SiteClockConnection, WCT flags and one member profile (all restored
 * at the end), runs / DOs / reports / photos on dev WCT and dev Biofuel, four
 * 1×1 test photos in the dev bucket.
 */
import 'dotenv/config';
import * as fs from 'fs';
import { createHash, createHmac, randomUUID } from 'crypto';
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
import { MaintenanceReportsModule } from '../src/maintenance-reports/maintenance-reports.module';
import { MaintenanceReportsService } from '../src/maintenance-reports/maintenance-reports.service';
import { SiteClockLinkService } from '../src/siteclock/siteclock-link.service';
import { seal } from '../src/common/secret-box';
import { hashInboundKey } from '../src/job-photos/job-photos';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const BIOFUEL = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const SC_URL = 'http://localhost:4100';
const AIMS_URL = 'http://localhost:4041';
const SC_COMPANY = 'cmvugwzon0000wvcolvovrqqm';
const W1 = 'cmvugwzos0002wvco3s0oocjs'; // Cal Worker 1 → mapped to the dev WCT field tech
const W2 = 'cmvugwzot0004wvco2xclw8ps'; // Cal Worker 2 → no AIMS login
const TECH = 'user_3LF2lbGtnHKWtC12nfn9cdS8fYB'; // dev WCT member with the field-tech role
const JWT_SECRET = 'scd-e2e-secret'; // the local SiteClock's
const SC_KEY = (fs.readFileSync(process.env.SC_KEY_FILE || '', 'utf8').match(/sck_live_[A-Za-z0-9_-]+/) || [])[0] || '';
const INBOUND = fs.readFileSync(process.env.INBOUND_KEY_FILE || '', 'utf8').trim();
const FLAGS = ['enableSiteClockLink', 'enableSiteClockDeliveries', 'enableDeliveryGroupPosts', 'enableQuotationToDelivery', 'enableWctOrders', 'enableWctFinishModes', 'enableWctMyJobs'] as const;
const SITE = '10 Anson Road, Singapore 079903';
const CUSTOMER = 'SCD E2E Customer';
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
// A valid 1×1 JPEG.
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=',
  'base64',
);

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ClerkModule, PushModule, ActionLogModule, DeliveriesModule, MaintenanceReportsModule] })
class E2EModule {}
const noop = () => new Proxy({}, { get: (_t, prop) => (prop === 'then' ? undefined : async () => undefined) });

let failures = 0;
/** E2E_ONLY=T,G,F,C2,P,S,R,U runs only those sections (debugging); default all. */
const ONLY = (process.env.E2E_ONLY || '').split(',').filter(Boolean);
const want = (k: string) => !ONLY.length || ONLY.includes(k);
const check = (label: string, ok: boolean, got?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  → got ${JSON.stringify(got)?.slice(0, 600)}`}`);
};
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));
const sgt = (dayOffset: number, hh: number) => {
  const d = new Date(Date.now() + 8 * 3600_000);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  d.setUTCHours(hh - 8, 0, 0, 0);
  return d.toISOString();
};

/** A SiteClock app session for a worker (HS256, the local SiteClock's legacy token). */
function workerToken(userId: string) {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub: userId, role: 'WORKER', companyId: SC_COMPANY, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${head}.${body}.${createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`;
}
const T1 = workerToken(W1);
const T2 = workerToken(W2);

type Res = { status: number; body: any; headers: Headers; raw?: Buffer };
async function http(url: string, init: RequestInit & { json?: unknown } = {}): Promise<Res> {
  const headers: Record<string, string> = { ...((init.headers as any) || {}) };
  let body = init.body;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  const r = await fetch(url, { ...init, headers, body });
  const raw = Buffer.from(await r.arrayBuffer());
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    /* binary */
  }
  return { status: r.status, body: parsed, headers: r.headers, raw };
}
/** The app: /jobs/:id/delivery/<step> as a worker. */
const app = (token: string, jobId: string, step = '', opts: { method?: string; json?: unknown; key?: string; form?: FormData } = {}) =>
  http(`${SC_URL}/jobs/${jobId}/delivery${step ? `/${step}` : ''}`, {
    method: opts.method ?? (opts.json !== undefined || opts.form ? 'POST' : 'GET'),
    headers: { Authorization: `Bearer ${token}`, ...(opts.key ? { 'Idempotency-Key': opts.key } : {}) },
    ...(opts.form ? { body: opts.form } : {}),
    ...(opts.json !== undefined ? { json: opts.json } : {}),
  });
const appWorker = (token: string, step: string, opts: { method?: string; json?: unknown } = {}) =>
  http(`${SC_URL}/jobs/delivery/${step}`, { method: opts.method ?? (opts.json !== undefined ? 'POST' : 'GET'), headers: { Authorization: `Bearer ${token}` }, ...(opts.json !== undefined ? { json: opts.json } : {}) });
/** AIMS directly, as SiteClock's backend would call it. */
const aims = (worker: string, path: string, opts: { method?: string; json?: unknown } = {}) =>
  http(`${AIMS_URL}/integrations/siteclock/delivery/${path}`, {
    method: opts.method ?? (opts.json !== undefined ? 'POST' : 'GET'),
    headers: { Authorization: `Bearer ${INBOUND}`, 'X-SiteClock-Worker-Id': worker },
    ...(opts.json !== undefined ? { json: opts.json } : {}),
  });
const v1 = (path: string) => http(`${SC_URL}/v1${path}`, { headers: { Authorization: `Bearer ${SC_KEY}` } });
const data = (r: Res) => r.body?.data ?? r.body;
const msg = (r: Res) => r.body?.message ?? r.body?.error ?? r.body;

(async () => {
  const url = process.env.DATABASE_URL || '';
  const prod = (process.env.PROD_DATABASE_URL || '').replace(/["\r]/g, '');
  if (prod && new URL(url).host === new URL(prod).host) throw new Error('Refusing: DATABASE_URL is the prod database');
  if (!SC_KEY || !INBOUND.startsWith('aims_sck_')) throw new Error('SC_KEY_FILE and INBOUND_KEY_FILE are required');
  if (!(await http(`${AIMS_URL}/health`)).body?.data?.ok) throw new Error(`no local AIMS API on ${AIMS_URL}`);

  const mod = await Test.createTestingModule({ imports: [E2EModule] })
    .overrideProvider(StaffWhatsAppService)
    .useValue(noop())
    .overrideProvider(PushService)
    .useValue(noop())
    .compile();
  const prisma = mod.get(PrismaService);
  const deliveries = mod.get(DeliveriesService);
  const reports = mod.get(MaintenanceReportsService);
  const link = mod.get(SiteClockLinkService);

  // ── setup (restored in `finally`) ──
  const uiBefore: any = await prisma.organizationUIConfig.findUnique({ where: { organizationId: WCT } });
  const flagsBefore: Record<string, unknown> = {};
  for (const f of FLAGS) flagsBefore[f] = (uiBefore?.features || {})[f];
  const connBefore = await prisma.siteClockConnection.findUnique({ where: { organizationId: WCT } });
  const profileBefore = await prisma.organizationMemberProfile.findFirst({ where: { organizationId: WCT, userId: TECH } });
  const setFlags = async (vals: Partial<Record<(typeof FLAGS)[number], boolean | undefined>>) => {
    const cur: any = await prisma.organizationUIConfig.findUnique({ where: { organizationId: WCT } });
    const next = { ...(cur?.features || {}) };
    for (const [k, v] of Object.entries(vals)) v === undefined ? delete next[k] : (next[k] = v);
    await prisma.organizationUIConfig.update({ where: { organizationId: WCT }, data: { features: next } });
    (link as any).linkedOrgs = null;
  };
  const created: string[] = [];
  try {
    await setFlags({ enableSiteClockLink: true, enableSiteClockDeliveries: true, enableDeliveryGroupPosts: true, enableQuotationToDelivery: true, enableWctOrders: true, enableWctFinishModes: false, enableWctMyJobs: true });
    const conn = { baseUrl: SC_URL, siteclockCompanyId: SC_COMPANY, apiKeyEnc: seal(SC_KEY), apiKeyLast4: SC_KEY.slice(-4), enabled: true, defaultDurationMin: 60, inboundKeyHash: hashInboundKey(INBOUND), inboundKeyLast4: INBOUND.slice(-4), inboundKeyCreatedAt: new Date() };
    await prisma.siteClockConnection.upsert({ where: { organizationId: WCT }, create: { organizationId: WCT, ...conn }, update: conn });
    if (profileBefore) await prisma.organizationMemberProfile.update({ where: { id: profileBefore.id }, data: { siteclockUserId: W1 } });
    else await prisma.organizationMemberProfile.create({ data: { organizationId: WCT, userId: TECH, siteclockUserId: W1 } });
    (link as any).linkedOrgs = null;
    console.log(`dev WCT ready (flags were ${JSON.stringify(flagsBefore)}); waiting 62 s for the API's link cache…`);
    await settle(62_000);

    await runAsOrg(WCT, async () => {
      let customer = await prisma.customer.findFirst({ where: { organizationId: WCT, name: CUSTOMER } });
      if (!customer) customer = await prisma.customer.create({ data: { organizationId: WCT, name: CUSTOMER, address: SITE } as any });
      const schedule = async (worker: string, lines: Array<{ description: string; assetClass: 'SERVICE' | 'EQUIPMENT' | 'ACCESSORY' }>, day = 1) => {
        const r: any = await deliveries.createScheduled(
          { scheduledFor: sgt(day, 10), items: lines.map((l) => ({ description: l.description, quantity: 1, assetClass: l.assetClass })), customerId: customer!.id, address: SITE, notes: 'SCD-E2E', siteclockWorkerId: worker, siteclockWorkerName: worker === W1 ? 'Cal Worker 1' : 'Cal Worker 2', siteclockDurationMin: 60 } as any,
          WCT,
        );
        const id = r?.id ?? r?.delivery?.id ?? r?.deliveryId;
        created.push(id);
        return id as string;
      };
      const linkOf = (deliveryId: string) => prisma.deliverySiteClockJob.findUnique({ where: { deliveryId } });
      const syncNow = async (deliveryId: string) => {
        // The link is made in the background after the schedule is saved.
        let l = await linkOf(deliveryId);
        for (let i = 0; !l && i < 20; i++) {
          await settle(500);
          l = await linkOf(deliveryId);
        }
        // Sync now; if a background sync of this link is already running, wait until it lands.
        for (let i = 0; l && i < 40; i++) {
          await link.syncLink(l.id);
          l = await linkOf(deliveryId);
          if (l?.syncState === 'SYNCED') break;
          await settle(500);
        }
        return l;
      };
      const scJob = async (deliveryId: string) => {
        const l = await linkOf(deliveryId);
        return l ? data(await v1(`/jobs/by-ref/${encodeURIComponent(l.externalRef)}`))?.job : null;
      };
      const uploadPhotos = async (scJobId: string, tag: string) => {
        const out: string[] = [];
        for (let i = 0; i < 4; i++) {
          const form = new FormData();
          form.set('folder', 'do-start');
          form.set('file', new Blob([new Uint8Array(JPEG)], { type: 'image/jpeg' }), `angle-${i}.jpg`);
          out.push(data(await app(T1, scJobId, 'uploads/image', { form, key: `up-${tag}-${i}` }))?.Key);
        }
        return out;
      };
      const runOf = (id: string) => prisma.delivery.findFirst({ where: { id, organizationId: WCT }, include: { items: { orderBy: { sortOrder: 'asc' } } } });

      // ── T: toggle + sync ─────────────────────────────────────────────
      if (want('T') || want('G') || want('F')) {
      const J1 = await schedule(W1, [{ description: 'Exhaust hood degrease', assetClass: 'SERVICE' }, { description: 'Spare filter unit', assetClass: 'EQUIPMENT' }]);
      const J2 = await schedule(W2, [{ description: 'Duct inspection', assetClass: 'SERVICE' }]);
      await syncNow(J1);
      await syncNow(J2);
      let j1 = await scJob(J1);
      const j2 = await scJob(J2);
      check('T: the mapped field worker\'s job carries deliveryEnabled', j1?.deliveryEnabled === true, j1);
      check('T: the unmapped worker\'s job does not', j2?.deliveryEnabled === false, j2?.deliveryEnabled);
      const mine1 = data(await http(`${SC_URL}/jobs/mine?from=${sgt(1, 10).slice(0, 10)}&to=${sgt(1, 10).slice(0, 10)}`, { headers: { Authorization: `Bearer ${T1}` } }));
      check('T: /jobs/mine shows the Delivery section on the job', mine1?.jobs?.find((j: any) => j.id === j1?.id)?.deliveryEnabled === true, mine1?.jobs?.map((j: any) => [j.id, j.deliveryEnabled]));
      await setFlags({ enableSiteClockDeliveries: false });
      await link.resyncOrg(WCT);
      await syncNow(J1);
      j1 = await scJob(J1);
      check('T: flag off → the job is re-synced with deliveryEnabled false', j1?.deliveryEnabled === false, j1?.deliveryEnabled);
      const offAims = await aims(W1, `jobs/${encodeURIComponent((await linkOf(J1))!.externalRef)}`);
      check('T: flag off → AIMS refuses the worker API (DELIVERIES_OFF)', offAims.status === 403 && offAims.body?.data?.code === 'DELIVERIES_OFF', [offAims.status, offAims.body]);
      const offApp = await app(T1, j1.id);
      check('T: flag off → SiteClock refuses the Delivery section (DELIVERY_OFF)', offApp.status === 409 && offApp.body?.code === 'DELIVERY_OFF', [offApp.status, offApp.body]);
      await setFlags({ enableSiteClockDeliveries: true });
      await link.resyncOrg(WCT);
      await syncNow(J1);
      j1 = await scJob(J1);
      check('T: flag on again → deliveryEnabled true again', j1?.deliveryEnabled === true, j1?.deliveryEnabled);
      const unchanged = await link.syncLink((await linkOf(J2))!.id);
      check('T: re-syncing a job whose section did not change sends nothing', unchanged.ok === true);
      await settle(61_000); // the API's own deliveries-flag reads are live, its link cache is 60 s

      // ── G: guards ────────────────────────────────────────────────────
      const ref1 = (await linkOf(J1))!.externalRef;
      const ref2 = (await linkOf(J2))!.externalRef;
      const j2sc = await scJob(J2);
      const notCrew = await app(T2, j1.id);
      check('G: SiteClock: a worker not on the job gets 404', notCrew.status === 404, [notCrew.status, notCrew.body]);
      const off2 = await app(T2, j2sc.id);
      check('G: SiteClock: a job without the Delivery section gets 409 DELIVERY_OFF', off2.status === 409 && off2.body?.code === 'DELIVERY_OFF', [off2.status, off2.body]);
      const otherRef = await aims(W1, `jobs/${encodeURIComponent(ref2)}`);
      check("G: AIMS: another worker's job → 404 NOT_YOUR_JOB", otherRef.status === 404 && otherRef.body?.data?.code === 'NOT_YOUR_JOB', [otherRef.status, otherRef.body]);
      const unlinked = await aims(W2, `jobs/${encodeURIComponent(ref2)}`);
      check('G: AIMS: a worker with no AIMS login → 403 NOT_LINKED', unlinked.status === 403 && unlinked.body?.data?.code === 'NOT_LINKED', [unlinked.status, unlinked.body]);
      const badKey = await http(`${AIMS_URL}/integrations/siteclock/delivery/jobs/${encodeURIComponent(ref1)}`, { headers: { Authorization: 'Bearer aims_sck_wrong', 'X-SiteClock-Worker-Id': W1 } });
      check('G: AIMS: a wrong inbound key → 401', badKey.status === 401, badKey.status);
      const noStep = await app(T1, j1.id, 'cancel', { json: {} });
      check('G: SiteClock: a step that is not a delivery step is not forwarded (404)', noStep.status === 404, noStep.status);

      // ── F: the flow through the proxy ────────────────────────────────
      const got = await app(T1, j1.id);
      const run0 = data(got)?.run;
      check('F: GET the run through SiteClock (the run, the flags, the worker)', got.status === 200 && run0?.id === J1 && data(got)?.features?.enableWctOrders === true && data(got)?.worker?.name === 'Cal Worker 1', [got.status, data(got)?.worker, data(got)?.features]);
      const [svcLine, eqLine] = (await runOf(J1))!.items;
      const keys = await uploadPhotos(j1.id, J1);
      check('F: 4 photos uploaded through SiteClock → AIMS keys do-start/<hex>.jpg', keys.every((k) => /^do-start\/[0-9a-f]{8}\.jpg$/.test(k ?? '')), keys);
      const few = await app(T1, j1.id, `items/${eqLine.id}/start`, { json: { photos: keys.slice(0, 3) } });
      check("F: equipment line with 3 photos → refused with SiteJobs' sentence", few.status === 400 && /needs at least 4 condition photos/.test(String(msg(few))), [few.status, msg(few)]);
      const k1 = `start-${eqLine.id}`;
      const st = await app(T1, j1.id, `items/${eqLine.id}/start`, { json: { photos: keys, angles: ['Front', 'Back', 'Left', 'Right'] }, key: k1 });
      check('F: equipment line started with 4 photos (claims the run for the worker\'s AIMS login)', st.status === 201 || st.status === 200, [st.status, msg(st)]);
      const replay = await app(T1, j1.id, `items/${eqLine.id}/start`, { json: { photos: keys, angles: ['Front', 'Back', 'Left', 'Right'] }, key: k1 });
      check('I: the same start with the same Idempotency-Key → the first answer again (Idempotent-Replayed)', (replay.status === 201 || replay.status === 200) && replay.headers.get('idempotent-replayed') === 'true' && data(replay)?.id === data(st)?.id, [replay.status, replay.headers.get('idempotent-replayed'), msg(replay)]);
      const mismatch = await app(T1, j1.id, `items/${eqLine.id}/start`, { json: { photos: keys.slice(0, 1) }, key: k1 });
      check('I: the same key with a different body → 422', mismatch.status === 422, [mismatch.status, msg(mismatch)]);
      const starts = await prisma.maintenanceServiceReport.count({ where: { deliveryId: J1, deliveryItemId: eqLine.id, kind: 'DO_START' } });
      check('I: exactly one DO_START for the line', starts === 1, starts);
      let r1: any = await runOf(J1);
      check('F: run in progress, rider = the worker\'s AIMS user', r1.status === 'in_progress' && r1.riderUserId === TECH, [r1.status, r1.riderUserId]);
      const svc = await app(T1, j1.id, `items/${svcLine.id}/start`, { json: { photos: [] } });
      check('F: service line selected (no photo)', svc.status === 201 || svc.status === 200, [svc.status, msg(svc)]);
      const who = await app(T1, j1.id, 'handoff', { json: { mode: 'SELF', itemIds: [svcLine.id, eqLine.id] } });
      check("F: Who's doing this job → Myself", (who.status === 201 || who.status === 200) && data(who)?.mode === 'SELF', [who.status, msg(who)]);
      const end = await app(T1, j1.id, 'ack-all', { json: {} });
      r1 = await runOf(J1);
      check('F: End → every line delivered, run awaiting the signature', (end.status === 201 || end.status === 200) && r1.status === 'delivered', [end.status, msg(end), r1.status]);
      // C: two sign-offs at once (different keys, as two devices would)
      const postsBefore = await prisma.deliveryGroupPost.count({ where: { deliveryId: J1 } });
      const signs = await Promise.all([
        app(T1, j1.id, 'finalize', { json: { signature: SIG, recipientName: 'Site Manager' }, key: `fin-a-${J1}` }),
        app(T1, j1.id, 'finalize', { json: { signature: SIG, recipientName: 'Site Manager' }, key: `fin-b-${J1}` }),
      ]);
      const okSigns = signs.filter((s) => s.status === 201 || s.status === 200);
      check('C: two sign-offs at once → exactly one goes through', okSigns.length === 1, signs.map((s) => [s.status, msg(s)]));
      check('C: …the other is refused (busy / already finalized)', signs.some((s) => s.status === 409 || (s.status === 400 && /already finalized/.test(String(msg(s))))), signs.map((s) => [s.status, msg(s)]));
      r1 = await runOf(J1);
      check('F: run completed', r1.status === 'completed', r1.status);
      const postsAfter = await prisma.deliveryGroupPost.count({ where: { deliveryId: J1 } });
      check('C: exactly one WhatsApp group post queued', postsAfter - postsBefore === 1, [postsBefore, postsAfter]);
      const signedAcks = await prisma.maintenanceServiceReport.count({ where: { deliveryId: J1, kind: 'DO_ACK', status: 'completed', signature: { not: null } } });
      check('C: the DO_ACK proofs signed once (one per line)', signedAcks === 2, signedAcks);
      const doId = r1.items.find((i: any) => i.documentId)?.documentId;
      const doc: any = doId ? await prisma.document.findFirst({ where: { id: doId, organizationId: WCT } }) : null;
      check('F: the DO is committed (delivered / installed)', !!doc && /delivered/.test(doc.status ?? ''), doc?.status);
      const invoices = doId ? await prisma.document.count({ where: { organizationId: WCT, type: 'INVOICE', config: { path: ['sourceDocumentId'], equals: doId } } }) : -1;
      check('C: at most one invoice from the DO', invoices <= 1, invoices);
      await settle(3000);
      await syncNow(J1);
      j1 = await scJob(J1);
      check('F: the SiteClock job is COMPLETED (AIMS pushed it)', j1?.status === 'COMPLETED', j1?.status);
      const view = await app(T1, j1.id, `do/${doId}/view`);
      check('F: DO view through SiteClock', view.status === 200 && !!data(view), [view.status, msg(view)]);
      const pdf = await app(T1, j1.id, `do/${doId}/pdf`);
      check('F: DO PDF through SiteClock (application/pdf, %PDF)', pdf.status === 200 && /pdf/.test(pdf.headers.get('content-type') ?? '') && pdf.raw!.subarray(0, 4).toString() === '%PDF', [pdf.status, pdf.headers.get('content-type'), pdf.body]);
      const otherDo = await app(T1, j1.id, `do/${randomUUID()}/pdf`);
      check('F: a DO that is not on the job → 404', otherDo.status === 404, otherDo.status);
      const logs = await prisma.actionLog.findMany({ where: { organizationId: WCT, channel: 'siteclock', actorId: TECH, createdAt: { gte: new Date(Date.now() - 15 * 60_000) } }, select: { action: true, path: true } });
      check('F: Activity Log names the worker (USER, siteclock channel) on the steps', logs.some((l) => l.action === 'SIGN') && logs.some((l) => l.action === 'START'), logs.map((l) => `${l.action} ${l.path}`).slice(0, 12));

      }
      // ── C2: two starts of one line at once ───────────────────────────
      if (want('C2')) {
      const J3 = await schedule(W1, [{ description: 'Grease trap check', assetClass: 'SERVICE' }]);
      await syncNow(J3);
      const j3 = await scJob(J3);
      const r3: any = await runOf(J3);
      console.log(`  J3 ${J3}: run ${r3?.status} items ${r3?.items?.length} · SiteClock job ${j3?.id} delivery ${j3?.deliveryEnabled}`);
      const l3 = r3.items[0];
      const two = await Promise.all([app(T1, j3.id, `items/${l3.id}/start`, { json: { photos: [] }, key: 'c2-a' }), app(T1, j3.id, `items/${l3.id}/start`, { json: { photos: [] }, key: 'c2-b' })]);
      const n3 = await prisma.maintenanceServiceReport.count({ where: { deliveryId: J3, deliveryItemId: l3.id, kind: 'DO_START' } });
      check('C: two starts of one line at once → one DO_START, the other refused', n3 === 1 && two.filter((x) => x.status < 300).length === 1, [n3, two.map((x) => [x.status, msg(x)])]);

      }
      // ── P: partial sign-off, skip / unskip ───────────────────────────
      if (want('P') || want('S')) {
      const J4 = await schedule(W1, [{ description: 'Hood A', assetClass: 'SERVICE' }, { description: 'Hood B', assetClass: 'SERVICE' }]);
      await syncNow(J4);
      const j4 = await scJob(J4);
      const [a4, b4] = (await runOf(J4))!.items;
      const sk = await app(T1, j4.id, `items/${b4.id}/skip`, { json: {} });
      check('P: skip a line', sk.status < 300 && !!data(sk)?.skippedAt, [sk.status, msg(sk)]);
      await app(T1, j4.id, `items/${a4.id}/start`, { json: { photos: [] } });
      await app(T1, j4.id, 'handoff', { json: { mode: 'SELF', itemIds: [a4.id] } });
      await app(T1, j4.id, 'ack-all', { json: {} });
      const part = await app(T1, j4.id, 'finalize', { json: { signature: SIG, recipientName: 'Supervisor' } });
      check('P: partial sign-off for the delivered line (run stays open)', part.status < 300 && data(part)?.partial === true && data(part)?.signedItemCount === 1, [part.status, msg(part)]);
      const un = await app(T1, j4.id, `items/${b4.id}/unskip`, { json: {} });
      check('P: unskip the line', un.status < 300 && data(un)?.skippedAt === null, [un.status, msg(un)]);
      await app(T1, j4.id, `items/${b4.id}/start`, { json: { photos: [] } });
      await app(T1, j4.id, 'handoff', { json: { mode: 'SELF', itemIds: [b4.id] } });
      await app(T1, j4.id, 'ack-all', { json: {} });
      const rest = await app(T1, j4.id, 'finalize', { json: { signature: SIG, recipientName: 'Supervisor' } });
      const r4: any = await runOf(J4);
      check('P: the rest signed → run completed, two posts (one per sign-off)', rest.status < 300 && r4.status === 'completed' && (await prisma.deliveryGroupPost.count({ where: { deliveryId: J4 } })) === 2, [rest.status, msg(rest), r4.status]);

      // ── S: pending sign (a service report left unsigned) ─────────────
      const rep = await app(T1, j4.id, 'reports', { json: { description: 'SCD-E2E service report', serviceData: { customerName: CUSTOMER } } });
      const repId = data(rep)?.id;
      check('S: a service report on the job, left unsigned (draft)', rep.status < 300 && data(rep)?.status === 'draft', [rep.status, msg(rep)]);
      const pend = await appWorker(T1, 'pending-sign');
      check('S: it is on the worker\'s Pending sign list', pend.status === 200 && (data(pend)?.docs ?? []).some((d: any) => d.id === repId), [pend.status, (data(pend)?.docs ?? []).map((d: any) => d.id)]);
      const pend2 = await appWorker(T2, 'pending-sign');
      check('S: …not on an unmapped worker\'s (refused)', pend2.status === 403, pend2.status);
      const sgn = await appWorker(T1, `reports/${repId}/sign`, { json: { signature: SIG, signedByName: 'Customer' } });
      const repRow = await prisma.maintenanceServiceReport.findFirst({ where: { id: repId } });
      check('S: signed later → completed', sgn.status < 300 && repRow?.status === 'completed', [sgn.status, msg(sgn), repRow?.status]);

      }
      // ── R: a return ──────────────────────────────────────────────────
      if (want('R')) {
      const R1 = randomUUID();
      const num = ((await prisma.delivery.aggregate({ where: { organizationId: WCT }, _max: { deliveryNumber: true } }))._max.deliveryNumber ?? 0) + 1;
      await prisma.delivery.create({ data: { id: R1, organizationId: WCT, deliveryNumber: num, direction: 'RETURN', status: 'scheduled', scheduledFor: new Date(sgt(2, 9)), customerId: customer.id, siteAddress: SITE, notes: 'SCD-E2E return' } as any });
      await prisma.deliveryItem.create({ data: { deliveryId: R1, description: 'Rented fan unit', quantity: 1, assetClass: 'EQUIPMENT', sortOrder: 1 } as any });
      created.push(R1);
      await link.onScheduleSaved(WCT, R1, { workerId: W1, workerName: 'Cal Worker 1', durationMin: 60 });
      await syncNow(R1);
      const rj = await scJob(R1);
      check('R: the return is a SiteClock job with the Delivery section', rj?.deliveryEnabled === true, rj);
      const cr = await app(T1, rj.id, 'claim-return', { json: {} });
      check('R: start the return (claim)', cr.status < 300 && data(cr)?.status === 'in_progress', [cr.status, msg(cr)]);
      const rl = (await runOf(R1))!.items[0];
      const rs = await app(T1, rj.id, `items/${rl.id}/start`, { json: { photos: await uploadPhotos(rj.id, R1) } });
      const re = await app(T1, rj.id, `items/${rl.id}/end`, { json: {} });
      let rr: any = await runOf(R1);
      check('R: line started with photos and collected → run awaiting the return signature', rs.status < 300 && re.status < 300 && rr.status === 'delivered', [rs.status, msg(rs), re.status, msg(re), rr.status]);
      const rf = await app(T1, rj.id, 'finalize-return', { json: { signature: SIG, recipientName: 'Store keeper' } });
      rr = await runOf(R1);
      check('R: return signed → completed', rf.status < 300 && rr.status === 'completed', [rf.status, msg(rf), rr.status]);
      }
    });

    // ── U: the SiteJobs unit path, two at once (dev Biofuel) ───────────
    if (want('U')) await runAsOrg(BIOFUEL, async () => {
      const units = await prisma.inventory.findMany({ where: { organizationId: BIOFUEL, status: 'instock' }, select: { id: true, assetId: true }, take: 50 });
      const byAsset = new Map<string, string[]>();
      for (const u of units) byAsset.set(u.assetId, [...(byAsset.get(u.assetId) ?? []), u.id]);
      const pair = [...byAsset.entries()].find(([, ids]) => ids.length >= 2);
      const asset = pair?.[0] ?? units[0]?.assetId;
      const [u1, u2] = pair ? pair[1] : [units[0]?.id, units[0]?.id];
      const project = await prisma.project.findFirst({ where: { organizationId: BIOFUEL }, select: { id: true, customerId: true } });
      if (!asset || !u1 || !project) {
        check('U: dev Biofuel has an in-stock unit and a project', false, { asset, u1, project: !!project });
        return;
      }
      const U1 = randomUUID();
      const num = ((await prisma.delivery.aggregate({ where: { organizationId: BIOFUEL }, _max: { deliveryNumber: true } }))._max.deliveryNumber ?? 0) + 1;
      await prisma.delivery.create({ data: { id: U1, organizationId: BIOFUEL, deliveryNumber: num, status: 'scheduled', scheduledFor: new Date(sgt(1, 9)), projectId: project.id, customerId: project.customerId, siteAddress: SITE, notes: 'SCD-E2E unit path' } as any });
      await prisma.deliveryItem.create({ data: { deliveryId: U1, assetId: asset, quantity: 1, sortOrder: 1 } as any });
      const claims = await Promise.allSettled([
        deliveries.claimScheduled(U1, { assetId: asset, inventoryId: u1 } as any, BIOFUEL, 'user_scd_rider_a'),
        deliveries.claimScheduled(U1, { assetId: asset, inventoryId: u2 } as any, BIOFUEL, 'user_scd_rider_b'),
      ]);
      const won = claims.filter((c) => c.status === 'fulfilled').length;
      const run: any = await prisma.delivery.findFirst({ where: { id: U1 }, include: { items: true } });
      const bound = run.items.filter((i: any) => i.inventoryId);
      check('U: two claims of one scheduled slot at once → one claim, one rider, one unit bound', won === 1 && bound.length === 1 && !!run.riderUserId, [claims.map((c) => (c.status === 'fulfilled' ? 'ok' : (c as any).reason?.message)), bound.length]);
      const loser = bound[0]?.inventoryId === u1 ? u2 : u1;
      if (loser !== bound[0]?.inventoryId) {
        const lu = await prisma.inventory.findFirst({ where: { id: loser }, select: { status: true } });
        check("U: the losing claim's unit is back in stock", lu?.status === 'instock', lu?.status);
      }
      const unit = bound[0].inventoryId;
      const doStart = (n: number) => reports.create({ assetId: asset, inventoryId: unit, kind: 'DO_START', deliveryId: U1, description: `SCD-E2E start ${n}`, photos: ['do-start/e2e1.jpg', 'do-start/e2e2.jpg', 'do-start/e2e3.jpg', 'do-start/e2e4.jpg'] } as any, BIOFUEL, run.riderUserId);
      await Promise.allSettled([doStart(1), doStart(2)]);
      const item1: any = await prisma.deliveryItem.findFirst({ where: { deliveryId: U1, inventoryId: unit } });
      check('U: two starts of the unit at once → it moved once (delivering)', item1?.deliveryStatus === 'delivering', item1?.deliveryStatus);
      await Promise.allSettled([deliveries.markUnitDelivered(U1, unit, {} as any, BIOFUEL, run.riderUserId), deliveries.markUnitDelivered(U1, unit, {} as any, BIOFUEL, run.riderUserId)]);
      const acks = await prisma.maintenanceServiceReport.count({ where: { deliveryId: U1, inventoryId: unit, kind: 'DO_ACK' } });
      const item2: any = await prisma.deliveryItem.findFirst({ where: { deliveryId: U1, inventoryId: unit } });
      check('U: two deliveries of the unit at once → delivered once', item2?.deliveryStatus === 'not_installed', [item2?.deliveryStatus, acks]);
      const fins = await Promise.allSettled([
        deliveries.finalizeRun(U1, { signature: SIG, recipientName: 'A', installNeeded: false } as any, BIOFUEL, run.riderUserId, { allowPartial: true }),
        deliveries.finalizeRun(U1, { signature: SIG, recipientName: 'B', installNeeded: false } as any, BIOFUEL, run.riderUserId, { allowPartial: true }),
      ]);
      const after: any = await prisma.delivery.findFirst({ where: { id: U1 }, include: { items: true } });
      const dos = new Set(after.items.map((i: any) => i.documentId).filter(Boolean));
      check('U: two sign-offs at once → one completion, one DO', fins.filter((f) => f.status === 'fulfilled').length === 1 && after.status === 'completed' && dos.size === 1, [fins.map((f) => (f.status === 'fulfilled' ? 'ok' : (f as any).reason?.message)), after.status, dos.size]);
      console.log(`  (dev Biofuel test run #${num}, unit ${unit} — left completed, as a SiteJobs run would be)`);
    });
  } catch (e) {
    failures++;
    console.error('ERROR (scenario stopped):', e);
  } finally {
    // restore
    await runAsOrg(WCT, async () => {
      await setFlags(Object.fromEntries(FLAGS.map((f) => [f, flagsBefore[f] as boolean | undefined])) as any);
      if (connBefore) {
        const { id, organizationId, createdAt, updatedAt, ...rest } = connBefore as any;
        await prisma.siteClockConnection.update({ where: { organizationId: WCT }, data: rest });
      }
      if (profileBefore) await prisma.organizationMemberProfile.update({ where: { id: profileBefore.id }, data: { siteclockUserId: profileBefore.siteclockUserId } });
      else await prisma.organizationMemberProfile.deleteMany({ where: { organizationId: WCT, userId: TECH, siteclockUserId: W1 } });
    });
    console.log(`restored: WCT flags ${JSON.stringify(flagsBefore)}, SiteClock connection, member profile · test runs: ${created.length}`);
    console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
    await mod.close();
    process.exit(failures ? 1 : 0);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
