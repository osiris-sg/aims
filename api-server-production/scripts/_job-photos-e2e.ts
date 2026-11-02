/**
 * SiteClock job photos end-to-end (2026-11-02), DEV database + dev S3 prefix.
 *
 * Boots the real AppModule on a random local port (same bootstrap as main.ts)
 * and calls the SiteClock contract over HTTP with real multipart uploads:
 *   A auth: no key / wrong key / a /v1 key → 401; link off → 403; key → org
 *   B upload: 201 { photoId } bare; same siteclockPhotoId again (also two at
 *     once) → 200 same photoId, one row; Idempotency-Key header accepted, a
 *     mismatch → 400; bad tag / no file / not an image → 400; > 10 MB → 413
 *   C wrong org → 404; cancelled job → 409; deleted job (link row only) → 409
 *   D stored copy: JPEG ≤ 2560 px, 400 px thumb, no EXIF / GPS; presigned
 *     url (15 min) serves it; thumb vs full
 *   E Stamped DO on a REJECTED job → pending, photo in the verification
 *     evidence + the queue, DO attachment "Stamped DO (SiteClock)"; a Site
 *     photo changes nothing; delivery + order photo lists
 *   F SiteClock DELETE → soft (row kept, file kept, DO attachment removed,
 *     url 404, gone from lists); office Hide the same; delete again → 200
 *   G a scheduled job with photos can't be deleted (refused before anything changes)
 *   H revoke → the old key is 401; other orgs untouched
 * Everything it changed is put back at the end (rows it made are removed,
 * the job's verification and DO attachments restored, flags/connection restored).
 *
 *   AIMS_SECRETS_KEY=<64 hex> TENANCY_MODE=per-org npx ts-node --transpile-only scripts/_job-photos-e2e.ts
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as sharp from 'sharp';
import { AppModule } from '../src/app.module';
import { CustomExceptionFilter } from '../helpers/custom-exception.filter';
import { CustomResponseInterceptor } from '../helpers/custom-sucess.filter';
import { PrismaService } from '../src/common/prisma.service';
import { S3Service } from '../src/common/services/s3.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
import { SiteClockLinkService } from '../src/siteclock/siteclock-link.service';
import { JobPhotosService } from '../src/job-photos/job-photos.service';
import { DeliveriesService } from '../src/deliveries/deliveries.service';
import { newInboundKey } from '../src/job-photos/job-photos';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const RUN = `e2e-${Date.now()}`;
let pass = 0;
let fail = 0;
const ok = (cond: any, label: string, extra?: any) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && extra !== undefined ? `  → ${JSON.stringify(extra).slice(0, 300)}` : ''}`);
};

async function main() {
  if (process.env.PROD_DATABASE_URL && new URL(process.env.DATABASE_URL!).host === new URL(process.env.PROD_DATABASE_URL).host) throw new Error('Refusing: DATABASE_URL is prod');
  if (process.env.RENDER) throw new Error('Refusing: looks like Render');
  const app = await NestFactory.create(AppModule, { bodyParser: true, logger: ['error'] });
  const { json, urlencoded } = await import('express');
  app.use(json({ limit: '15mb' }));
  app.use(urlencoded({ extended: true, limit: '15mb' }));
  app.useGlobalPipes(new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } }));
  app.useGlobalFilters(new CustomExceptionFilter());
  app.useGlobalInterceptors(new CustomResponseInterceptor());
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as any).port}`;
  const prisma = app.get(PrismaService);
  const s3 = app.get(S3Service);
  const link = app.get(SiteClockLinkService);
  const photosSvc = app.get(JobPhotosService);
  const deliveries = app.get(DeliveriesService);
  const forget = () => (link as any).forgetOrgCache();

  // ── fixtures (dev WCT) + what to restore ───────────────────────────────────
  const restore: Array<() => Promise<any>> = [];
  const made = { photoIds: new Set<string>(), keys: new Set<string>(), linkRowId: null as string | null };
  const conn0 = await prisma.siteClockConnection.findUnique({ where: { organizationId: WCT } });
  if (!conn0) throw new Error('dev WCT has no SiteClockConnection');
  restore.push(() =>
    prisma.siteClockConnection.update({
      where: { organizationId: WCT },
      data: {
        enabled: conn0.enabled,
        inboundKeyHash: conn0.inboundKeyHash,
        inboundKeyLast4: conn0.inboundKeyLast4,
        inboundKeyCreatedAt: conn0.inboundKeyCreatedAt,
        inboundKeyLastUsedAt: conn0.inboundKeyLastUsedAt,
      },
    }),
  );
  const ui0 = await prisma.organizationUIConfig.findUnique({ where: { organizationId: WCT } });
  const f0 = (ui0?.features as any) || {};
  restore.push(async () => {
    const cur = await prisma.organizationUIConfig.findUnique({ where: { organizationId: WCT } });
    const f = { ...((cur?.features as any) || {}) };
    for (const k of ['enableSiteClockLink', 'enableWctFinishModes']) {
      if (k in f0) f[k] = f0[k];
      else delete f[k];
    }
    await prisma.organizationUIConfig.update({ where: { organizationId: WCT }, data: { features: f } });
  });
  await prisma.organizationUIConfig.update({ where: { organizationId: WCT }, data: { features: { ...f0, enableSiteClockLink: true, enableWctFinishModes: true } } });
  await prisma.siteClockConnection.update({ where: { organizationId: WCT }, data: { enabled: true } });
  forget();

  // Other orgs: their job photos and a sample of their deliveries, before.
  const otherPhotos0 = await prisma.jobPhoto.count({ where: { organizationId: { not: WCT } } });
  let otherRun: any = null;
  for (const o of await prisma.organization.findMany({ where: { id: { not: WCT } }, select: { id: true } })) {
    otherRun = await runAsOrg(o.id, () => prisma.delivery.findFirst({ where: { organizationId: o.id }, select: { id: true, organizationId: true, updatedAt: true } })).catch(() => null);
    if (otherRun) break;
  }

  const picked = await runAsOrg(WCT, async () => {
    const items = await prisma.deliveryItem.findMany({
      where: { documentId: { not: null }, delivery: { organizationId: WCT, status: 'completed', verificationState: 'verified' } } as any,
      select: { deliveryId: true, documentId: true },
      take: 400,
    });
    let rejected: any = null;
    for (const i of items) {
      const doc = await prisma.document.findFirst({ where: { id: i.documentId!, organizationId: WCT, type: { in: ['DELIVERY_ORDER', 'DO'] } }, select: { id: true, attachments: true } });
      if (doc) {
        rejected = { deliveryId: i.deliveryId, doc };
        break;
      }
    }
    const cancelled = await prisma.delivery.findFirst({ where: { organizationId: WCT, status: 'cancelled' }, select: { id: true } });
    const scheduled = await prisma.delivery.findFirst({ where: { organizationId: WCT, status: 'scheduled' }, select: { id: true, updatedAt: true } });
    return { rejected, cancelled, scheduled };
  });
  if (!picked.rejected || !picked.cancelled || !picked.scheduled) throw new Error(`dev WCT lacks fixtures ${JSON.stringify(picked)}`);
  const R = picked.rejected.deliveryId as string;
  const DOC = picked.rejected.doc.id as string;
  const attachments0 = picked.rejected.doc.attachments;
  const r0 = (await runAsOrg(WCT, () =>
    prisma.delivery.findFirst({
      where: { id: R },
      select: { verificationState: true, verifiedAt: true, verifiedByUserId: true, verifiedByName: true, verificationNote: true, completionMode: true, orderId: true },
    }),
  )) as any;
  restore.push(() =>
    runAsOrg(WCT, () =>
      prisma.delivery.update({
        where: { id: R },
        data: {
          verificationState: r0.verificationState,
          verifiedAt: r0.verifiedAt,
          verifiedByUserId: r0.verifiedByUserId,
          verifiedByName: r0.verifiedByName,
          verificationNote: r0.verificationNote,
          completionMode: r0.completionMode,
        },
      }),
    ),
  );
  restore.push(() => runAsOrg(WCT, () => prisma.document.update({ where: { id: DOC }, data: { attachments: attachments0 ?? undefined } as any })));
  await runAsOrg(WCT, () =>
    prisma.delivery.update({ where: { id: R }, data: { verificationState: 'rejected', verificationNote: 'e2e: please send the stamped DO', completionMode: r0.completionMode || 'stamped_do' } }),
  );
  const GONE = randomUUID();
  const lr = await prisma.deliverySiteClockJob.create({ data: { organizationId: WCT, deliveryId: GONE, externalRef: `aims-delivery:${GONE}`, syncState: 'SYNCED' } as any });
  made.linkRowId = lr.id;
  console.log(`fixtures: rejected job ${R} (DO ${DOC}), cancelled ${picked.cancelled.id}, scheduled ${picked.scheduled.id}, deleted ${GONE}; other-org sample ${otherRun?.organizationId}`);

  try {
    // ── A auth ────────────────────────────────────────────────────────────────
    const gen = await link.generateInboundKey(WCT);
    const KEY = gen.key;
    ok(KEY.startsWith('aims_sck_') && gen.inboundKey?.last4 === KEY.slice(-4), 'admin Generate returns the key once + last 4');
    const stored = await prisma.siteClockConnection.findUnique({ where: { organizationId: WCT } });
    ok(stored?.inboundKeyHash && stored.inboundKeyHash !== KEY && !JSON.stringify(stored).includes(KEY), 'only the hash is stored');
    const getConn: any = await link.getConnection(WCT);
    ok(!JSON.stringify(getConn).includes(KEY) && getConn.inboundKey?.last4, 'GET connection shows last 4, never the key');

    const jpegWithGps = await sharp({ create: { width: 3200, height: 2400, channels: 3, background: '#556677' } })
      .withExif({ IFD0: { Make: 'E2ECam' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '1/1 17/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '103/1 51/1 0/1' } } as any)
      .jpeg({ quality: 90 })
      .toBuffer();
    const form = (over: Record<string, any> = {}, file: Buffer | null = jpegWithGps, name = 'photo.jpg', type = 'image/jpeg') => {
      const f = new FormData();
      const fields: Record<string, any> = {
        externalRef: `aims-delivery:${R}`,
        siteclockPhotoId: `${RUN}-1`,
        tag: 'STAMPED_DO',
        note: 'Stamped by the guardhouse',
        takenAt: new Date().toISOString(),
        workerSiteclockUserId: 'sc-user-e2e',
        workerName: 'E2E Worker',
        ...over,
      };
      for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) f.append(k, String(v));
      if (file) f.append('file', new Blob([file], { type }), name);
      return f;
    };
    const post = async (body: FormData, headers: Record<string, string> = { Authorization: `Bearer ${KEY}` }) => {
      const r = await fetch(`${base}/integrations/siteclock/photos`, { method: 'POST', body, headers });
      const text = await r.text();
      let j: any = null;
      try {
        j = JSON.parse(text);
      } catch {}
      if (j?.photoId) made.photoIds.add(j.photoId);
      return { status: r.status, body: j, text };
    };

    ok((await post(form(), {})).status === 401, 'no key → 401');
    ok((await post(form(), { Authorization: `Bearer ${newInboundKey()}` })).status === 401, 'unknown key → 401');
    ok((await post(form(), { Authorization: 'Bearer aims_live_notASiteClockKey' })).status === 401, 'a /v1-style key → 401');
    await prisma.siteClockConnection.update({ where: { organizationId: WCT }, data: { enabled: false } });
    forget();
    ok((await post(form())).status === 403, 'link turned off → 403');
    await prisma.siteClockConnection.update({ where: { organizationId: WCT }, data: { enabled: true } });
    forget();

    // ── B upload + idempotency ────────────────────────────────────────────────
    const first = await post(form({}, jpegWithGps), { Authorization: `Bearer ${KEY}`, 'Idempotency-Key': `${RUN}-1` });
    ok(first.status === 201 && first.body && Object.keys(first.body).join() === 'photoId', '201 with bare { photoId } (Idempotency-Key header accepted)', first);
    const PHOTO = first.body?.photoId;
    const again = await post(form());
    ok(again.status === 200 && again.body?.photoId === PHOTO, 'same siteclockPhotoId again → 200, same photoId', again);
    const [c1, c2] = await Promise.all([post(form({ siteclockPhotoId: `${RUN}-2`, tag: 'SITE' })), post(form({ siteclockPhotoId: `${RUN}-2`, tag: 'SITE' }))]);
    ok(c1.body?.photoId && c1.body.photoId === c2.body?.photoId && [c1.status, c2.status].sort().join() === '200,201', 'two sends at once → one 201 + one 200, same photoId', [c1, c2]);
    const SITE = c1.body?.photoId;
    ok((await prisma.jobPhoto.count({ where: { organizationId: WCT, sourcePhotoId: { in: [`${RUN}-1`, `${RUN}-2`] } } })) === 2, 'exactly one row per siteclockPhotoId');
    ok(
      (await post(form({ siteclockPhotoId: `${RUN}-3` }), { Authorization: `Bearer ${KEY}`, 'Idempotency-Key': `${RUN}-other` })).status === 400,
      'Idempotency-Key not matching siteclockPhotoId → 400',
    );
    ok((await post(form({ siteclockPhotoId: `${RUN}-4`, tag: 'SELFIE' }))).status === 400, 'bad tag → 400');
    ok((await post(form({ siteclockPhotoId: `${RUN}-5` }, null))).status === 400, 'no file → 400');
    ok((await post(form({ siteclockPhotoId: `${RUN}-6` }, Buffer.from('%PDF-1.4 hello'), 'x.pdf', 'application/pdf'))).status === 400, 'not an image → 400');
    ok((await post(form({ siteclockPhotoId: `${RUN}-7`, note: 'x'.repeat(301) }))).status === 400, 'note over 300 → 400');
    const big = await post(form({ siteclockPhotoId: `${RUN}-8` }, Buffer.alloc(10 * 1024 * 1024 + 10, 1)));
    ok(big.status === 413, 'over 10 MB → 413', big.status);

    // ── C wrong org / cancelled / deleted ─────────────────────────────────────
    if (otherRun) ok((await post(form({ siteclockPhotoId: `${RUN}-9`, externalRef: `aims-delivery:${otherRun.id}` }))).status === 404, "another org's job → 404");
    // A second org with its own SiteClock key can't reach WCT's job or photo.
    const other = await prisma.organization.findFirst({ where: { id: { not: WCT } }, select: { id: true } });
    if (other && !(await prisma.siteClockConnection.findUnique({ where: { organizationId: other.id } }))) {
      const oui = await prisma.organizationUIConfig.findUnique({ where: { organizationId: other.id } });
      await prisma.siteClockConnection.create({
        data: { organizationId: other.id, baseUrl: 'https://example.invalid', siteclockCompanyId: 'e2e', apiKeyEnc: 'e2e', apiKeyLast4: 'e2e0', enabled: true },
      });
      if (oui) await prisma.organizationUIConfig.update({ where: { organizationId: other.id }, data: { features: { ...((oui.features as any) || {}), enableSiteClockLink: true } } });
      try {
        forget();
        const OKEY = (await link.generateInboundKey(other.id)).key;
        const oh = { Authorization: `Bearer ${OKEY}` };
        if (oui) {
          ok((await post(form({ siteclockPhotoId: `${RUN}-9b` }), oh)).status === 404, "another org's key on WCT's job → 404");
          ok((await fetch(`${base}/integrations/siteclock/photos/${PHOTO}/url`, { headers: oh })).status === 404, "another org's key: WCT photo url → 404");
          ok((await fetch(`${base}/integrations/siteclock/photos/${PHOTO}`, { method: 'DELETE', headers: oh })).status === 404, "another org's key: DELETE WCT photo → 404");
          ok(!(await prisma.jobPhoto.findFirst({ where: { id: PHOTO } }))?.deletedAt, 'WCT photo still live after the other org tried');
        } else console.log('info  other org has no UI config; cross-org checks skipped');
      } finally {
        await prisma.siteClockConnection.delete({ where: { organizationId: other.id } });
        if (oui) await prisma.organizationUIConfig.update({ where: { organizationId: other.id }, data: { features: oui.features as any } });
        forget();
      }
    } else console.log('info  no other org without a SiteClock connection; cross-org checks skipped');
    ok((await post(form({ siteclockPhotoId: `${RUN}-10`, externalRef: `aims-delivery:${randomUUID()}` }))).status === 404, 'unknown job → 404');
    ok((await post(form({ siteclockPhotoId: `${RUN}-11`, externalRef: `aims-delivery:${picked.cancelled.id}` }))).status === 409, 'cancelled job → 409');
    const del = await post(form({ siteclockPhotoId: `${RUN}-12`, externalRef: `aims-delivery:${GONE}` }));
    ok(del.status === 409 && /deleted/.test(del.text), 'deleted job (link row only) → 409', del);
    ok((await post(form({ siteclockPhotoId: `${RUN}-13`, externalRef: `aims-delivery:${R}:2`, tag: 'OTHER' }))).status === 201, 're-created job ref (aims-delivery:<id>:2) → 201');
    ok((await post(form({ siteclockPhotoId: `${RUN}-14`, externalRef: 'job-123' }))).status === 400, 'malformed externalRef → 400');

    // ── D stored copy + presigned url ─────────────────────────────────────────
    const row = await prisma.jobPhoto.findFirst({ where: { id: PHOTO, organizationId: WCT } });
    made.keys.add(row!.fileKey).add(row!.thumbKey);
    for (const p of await prisma.jobPhoto.findMany({ where: { organizationId: WCT, sourcePhotoId: { startsWith: RUN } } })) made.keys.add(p.fileKey).add(p.thumbKey);
    ok(row?.fileKey.startsWith(`dev/job-photos/${WCT}/${R}/`) && row.workerName === 'E2E Worker' && row.tag === 'STAMPED_DO' && row.source === 'siteclock', 'row: dev/ key, worker, tag, source', row);
    const urlRes = await fetch(`${base}/integrations/siteclock/photos/${PHOTO}/url?size=full`, { headers: { Authorization: `Bearer ${KEY}` } });
    const urlBody: any = await urlRes.json();
    ok(urlRes.status === 200 && Object.keys(urlBody).sort().join() === 'expiresAt,url' && /X-Amz-Expires=900/.test(urlBody.url), 'url → bare { url, expiresAt }, 15 min', urlBody);
    const img = Buffer.from(await (await fetch(urlBody.url)).arrayBuffer());
    const meta = await sharp(img).metadata();
    ok(meta.format === 'jpeg' && meta.width === 2560 && meta.height === 1920, 'stored full: JPEG 2560x1920', meta);
    ok(!meta.exif && !img.includes(Buffer.from('E2ECam')), 'stored full: no EXIF (GPS gone)');
    const th: any = await (await fetch(`${base}/integrations/siteclock/photos/${PHOTO}/url?size=thumb`, { headers: { Authorization: `Bearer ${KEY}` } })).json();
    ok((await sharp(Buffer.from(await (await fetch(th.url)).arrayBuffer())).metadata()).width === 400, 'thumb is 400 px wide');
    ok((await fetch(`${base}/integrations/siteclock/photos/${PHOTO}/url`, {})).status === 401, 'url without key → 401');
    const publicStatus = (await fetch(`https://aims-osiris.s3.ap-southeast-1.amazonaws.com/${row!.fileKey}`, { method: 'HEAD' })).status;
    console.log(`info  public bucket URL for the photo answers ${publicStatus} (the existing photo views use public URLs)`);

    // ── E verification + DO attachment + lists ────────────────────────────────
    const after = (await runAsOrg(WCT, () => prisma.delivery.findFirst({ where: { id: R }, select: { verificationState: true } }))) as any;
    ok(after?.verificationState === 'pending', 'Stamped DO on a rejected job → pending', after);
    const v: any = await runAsOrg(WCT, () => deliveries.verificationOf(R, WCT));
    ok(
      v?.photos?.includes(row!.fileKey) && v.siteclockPhotos?.some((p: any) => p.key === row!.fileKey && p.workerName === 'E2E Worker'),
      'verification evidence includes it, marked SiteClock',
      v?.siteclockPhotos,
    );
    const queue: any[] = await runAsOrg(WCT, () => deliveries.verificationQueue(WCT, 'pending'));
    ok(
      queue.some((q) => q.id === R && q.photos.includes(row!.fileKey)),
      'job is in Awaiting verification with the photo',
    );
    const doc1: any = await runAsOrg(WCT, () => prisma.document.findFirst({ where: { id: DOC }, select: { attachments: true } }));
    ok(
      (doc1.attachments || []).some((a: any) => a.fileKey === row!.fileKey && a.label === 'Stamped DO' && a.fileName === 'Stamped DO (SiteClock).jpg'),
      'DO attachment "Stamped DO (SiteClock)"',
    );
    ok(!(doc1.attachments || []).some((a: any) => a.fileKey?.includes(SITE)), 'a Site photo is not a DO attachment');
    const list: any = await runAsOrg(WCT, () => photosSvc.forDelivery(WCT, R));
    ok(
      list.enabled && list.photos.length === 3 && list.photos.every((p: any) => p.url && p.thumbUrl && p.downloadUrl.includes('response-content-disposition')),
      'delivery list: 3 photos with urls + download',
      list.photos?.length,
    );
    if (r0.orderId) {
      const ol: any = await runAsOrg(WCT, () => photosSvc.forOrder(WCT, r0.orderId));
      ok(ol.enabled && ol.jobs.find((j: any) => j.deliveryId === R)?.photos.length === 3, 'order list: grouped by job, this job has 3');
    } else console.log('info  the picked job has no order; order list not checked');

    // ── F delete (SiteClock) + hide (office) ──────────────────────────────────
    const d1 = await fetch(`${base}/integrations/siteclock/photos/${PHOTO}`, { method: 'DELETE', headers: { Authorization: `Bearer ${KEY}` } });
    ok(d1.status === 200 && JSON.stringify(await d1.json()) === '{"ok":true}', 'DELETE → 200 { ok: true }');
    const gone = await prisma.jobPhoto.findFirst({ where: { id: PHOTO } });
    ok(gone?.deletedAt && gone.deletedBy === 'siteclock', 'soft: row kept with deletedAt / deletedBy siteclock');
    ok((await fetch(urlBody.url)).status === 200, 'file kept in S3');
    const doc2: any = await runAsOrg(WCT, () => prisma.document.findFirst({ where: { id: DOC }, select: { attachments: true } }));
    ok(!(doc2.attachments || []).some((a: any) => a.fileKey === row!.fileKey), 'DO attachment removed');
    ok((await fetch(`${base}/integrations/siteclock/photos/${PHOTO}/url`, { headers: { Authorization: `Bearer ${KEY}` } })).status === 404, 'url of a deleted photo → 404');
    ok((await fetch(`${base}/integrations/siteclock/photos/${PHOTO}`, { method: 'DELETE', headers: { Authorization: `Bearer ${KEY}` } })).status === 200, 'DELETE again → 200');
    const v2: any = await runAsOrg(WCT, () => deliveries.verificationOf(R, WCT));
    ok(!v2.photos.includes(row!.fileKey), 'gone from the verification evidence');
    await runAsOrg(WCT, () => photosSvc.hide(WCT, SITE, { id: 'user_e2e_admin', name: 'E2E Admin' }));
    const hid = await prisma.jobPhoto.findFirst({ where: { id: SITE } });
    ok(hid?.deletedBy === 'user:user_e2e_admin' && hid.deletedByName === 'E2E Admin', 'office Hide: soft, records who');
    ok(((await runAsOrg(WCT, () => photosSvc.forDelivery(WCT, R))) as any).photos.length === 1, 'list shows only the live photo');

    // ── G delete guard ────────────────────────────────────────────────────────
    const s1 = await post(form({ siteclockPhotoId: `${RUN}-20`, externalRef: `aims-delivery:${picked.scheduled.id}`, tag: 'SITE' }));
    ok(s1.status === 201, 'photo on a scheduled job → 201');
    for (const p of await prisma.jobPhoto.findMany({ where: { organizationId: WCT, sourcePhotoId: { startsWith: RUN } } })) made.keys.add(p.fileKey).add(p.thumbKey);
    const before = await runAsOrg(WCT, () => prisma.maintenanceServiceReport.count({ where: { deliveryId: picked.scheduled.id } }));
    let refused = '';
    try {
      await runAsOrg(WCT, () => deliveries.remove(picked.scheduled.id, WCT));
    } catch (e: any) {
      refused = e?.message || String(e);
    }
    ok(/photos from SiteClock/.test(refused), 'deleting a job with photos is refused (its own reason)', refused);
    const stillThere = await runAsOrg(WCT, () => prisma.delivery.findFirst({ where: { id: picked.scheduled.id }, select: { id: true } }));
    const afterCount = await runAsOrg(WCT, () => prisma.maintenanceServiceReport.count({ where: { deliveryId: picked.scheduled.id } }));
    ok(!!stillThere && before === afterCount, 'job and its reports untouched by the refusal');

    // ── H revoke + other orgs ─────────────────────────────────────────────────
    await link.revokeInboundKey(WCT);
    ok((await post(form({ siteclockPhotoId: `${RUN}-30` }))).status === 401, 'revoked key → 401');
    ok((await prisma.jobPhoto.count({ where: { organizationId: { not: WCT } } })) === otherPhotos0, 'no job photos in other orgs');
    if (otherRun) {
      const o2: any = await runAsOrg(otherRun.organizationId, () => prisma.delivery.findFirst({ where: { id: otherRun.id, organizationId: otherRun.organizationId }, select: { updatedAt: true } }));
      ok(o2?.updatedAt?.getTime() === otherRun.updatedAt.getTime(), "other org's delivery unchanged");
    }
  } finally {
    // ── put everything back ───────────────────────────────────────────────────
    const rows = await prisma.jobPhoto.findMany({ where: { organizationId: WCT, sourcePhotoId: { startsWith: RUN } }, select: { id: true, fileKey: true, thumbKey: true } });
    for (const r of rows) made.keys.add(r.fileKey).add(r.thumbKey);
    await prisma.jobPhoto.deleteMany({ where: { organizationId: WCT, sourcePhotoId: { startsWith: RUN } } });
    let removedKeys = 0;
    for (const k of made.keys)
      if (k.startsWith('dev/job-photos/'))
        await s3
          .deleteFile(k)
          .then(() => removedKeys++)
          .catch(() => {});
    if (made.linkRowId) await prisma.deliverySiteClockJob.delete({ where: { id: made.linkRowId } }).catch(() => {});
    for (const r of restore.reverse()) await r().catch((e) => console.log('restore failed:', e?.message));
    forget();
    const left = await prisma.jobPhoto.count({ where: { organizationId: WCT, sourcePhotoId: { startsWith: RUN } } });
    const rAfter: any = await runAsOrg(WCT, () => prisma.delivery.findFirst({ where: { id: R }, select: { verificationState: true } }));
    const cAfter = await prisma.siteClockConnection.findUnique({ where: { organizationId: WCT } });
    console.log(
      `cleanup: ${rows.length} rows + ${removedKeys} dev S3 objects removed, ${left} left; job back to ${rAfter?.verificationState}; connection enabled=${cAfter?.enabled}, inbound key ${cAfter?.inboundKeyHash ? 'present' : 'none'}`,
    );
    await app.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
