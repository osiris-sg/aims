import { BadRequestException, ConflictException, forwardRef, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import { DocumentsService } from '../documents/documents.service';
import { ActionLogService } from '../action-log/action-log.service';
import { SiteClockLinkService } from '../siteclock/siteclock-link.service';
import { refreshOrderStatusForRun } from '../orders/wct-orders';
import { BadImageError, processJobPhoto } from './job-photos.image';
import { downloadName, isDoEvidenceTag, JOB_PHOTO_TAG_LABEL, JobPhotoTag, MAX_PHOTO_BYTES, PhotoFields, photoKeys, URL_TTL_SEC, verificationAfterDoPhoto } from './job-photos';

type PhotoRow = {
  id: string;
  organizationId: string;
  deliveryId: string;
  tag: string;
  note: string | null;
  takenAt: Date | null;
  workerName: string | null;
  workerSourceId: string | null;
  fileKey: string;
  thumbKey: string;
  createdAt: Date;
  deletedAt: Date | null;
};

/** One photo as the office sees it (URLs presigned for URL_TTL_SEC). */
export interface JobPhotoView {
  id: string;
  deliveryId: string;
  tag: string;
  tagLabel: string;
  note: string | null;
  takenAt: Date | null;
  uploadedAt: Date;
  workerName: string | null;
  source: 'siteclock';
  url: string;
  thumbUrl: string;
  downloadUrl: string;
  urlExpiresAt: string;
}

/**
 * Job photos from SiteClock (WCT 2026-11-02): see job-photos.ts. SiteClock
 * pushes each photo of an AIMS job here; AIMS stores it in S3 and shows it on
 * the job and its order. A Signed DO / Stamped DO photo also goes on the job's
 * DO(s) as an attachment and is evidence for the DO verification (a rejected
 * job goes back to Awaiting verification). Photos are never hard-deleted:
 * SiteClock's DELETE and the office's Hide set deletedAt and keep the files.
 */
@Injectable()
export class JobPhotosService {
  private readonly logger = new Logger(JobPhotosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    @Inject(forwardRef(() => DocumentsService)) private readonly documents: DocumentsService,
    private readonly link: SiteClockLinkService,
    @Optional() private readonly actionLog?: ActionLogService,
  ) {}

  // ── SiteClock (inbound key) ───────────────────────────────────────────────

  /** POST /integrations/siteclock/photos. created=false: this siteclockPhotoId was already received (same photoId back). */
  async receive(organizationId: string, f: PhotoFields, file: { buffer: Buffer; size: number } | undefined): Promise<{ photoId: string; created: boolean }> {
    const known = await this.bySourceId(organizationId, f.siteclockPhotoId);
    if (known) return { photoId: known.id, created: false };

    const run = await this.prisma.delivery.findFirst({
      where: { id: f.deliveryId, organizationId },
      select: { id: true, status: true, verificationState: true },
    });
    if (!run) {
      // The link row outlives a deleted run: AIMS's job, but gone.
      const linked = await this.prisma.deliverySiteClockJob.findFirst({ where: { deliveryId: f.deliveryId, organizationId }, select: { id: true } });
      if (linked) throw new ConflictException('This job was deleted in AIMS');
      throw new NotFoundException('No such job in this organisation');
    }
    if (run.status === 'cancelled') throw new ConflictException('This job was cancelled in AIMS');
    if (!file?.buffer?.length) throw new BadRequestException('file is required');
    if (file.size > MAX_PHOTO_BYTES) throw new BadRequestException('The photo is larger than 10 MB');

    let img: Awaited<ReturnType<typeof processJobPhoto>>;
    try {
      img = await processJobPhoto(file.buffer);
    } catch (e: any) {
      if (e instanceof BadImageError) throw new BadRequestException(e.message);
      throw e;
    }
    const id = randomUUID();
    const keys = photoKeys(organizationId, f.deliveryId, id);
    await this.s3.uploadFile(keys.fileKey, img.full, 'image/jpeg');
    await this.s3.uploadFile(keys.thumbKey, img.thumb, 'image/jpeg');

    let row: PhotoRow;
    try {
      row = (await this.prisma.jobPhoto.create({
        data: {
          id,
          organizationId,
          deliveryId: f.deliveryId,
          externalRef: f.externalRef,
          source: 'siteclock',
          sourcePhotoId: f.siteclockPhotoId,
          tag: f.tag,
          note: f.note,
          takenAt: f.takenAt,
          workerSourceId: f.workerSiteclockUserId,
          workerName: f.workerName,
          fileKey: keys.fileKey,
          thumbKey: keys.thumbKey,
          mimeType: 'image/jpeg',
          bytes: img.full.length,
          width: img.width,
          height: img.height,
        },
      })) as PhotoRow;
    } catch (e: any) {
      // Two sends of the same photo at once: the other one won, answer with its id.
      if (e?.code === 'P2002') {
        const other = await this.bySourceId(organizationId, f.siteclockPhotoId);
        if (other) {
          void this.s3.deleteFile(keys.fileKey).catch(() => {});
          void this.s3.deleteFile(keys.thumbKey).catch(() => {});
          return { photoId: other.id, created: false };
        }
      }
      throw e;
    }

    if (isDoEvidenceTag(row.tag)) await this.doEvidenceArrived(row, run);
    return { photoId: row.id, created: true };
  }

  /** GET /integrations/siteclock/photos/:id/url. Hidden photos are 404. */
  async urlFor(organizationId: string, photoId: string, size: 'thumb' | 'full') {
    const p = await this.live(organizationId, photoId);
    const expiresAt = new Date(Date.now() + URL_TTL_SEC * 1000).toISOString();
    return { url: await this.s3.getSignedUrl(size === 'thumb' ? p.thumbKey : p.fileKey, URL_TTL_SEC), expiresAt };
  }

  /** DELETE /integrations/siteclock/photos/:id: soft delete. Deleting again is fine. */
  async deleteFromSiteClock(organizationId: string, photoId: string) {
    const p = await this.inOrg(organizationId, photoId);
    await this.softDelete(p, { by: 'siteclock', name: p.workerName ? `SiteClock (${p.workerName})` : 'SiteClock' });
    return { ok: true };
  }

  // ── office ─────────────────────────────────────────────────────────────────

  /** The job's photos, newest last. enabled=false for orgs without the SiteClock link (the page shows nothing). */
  async forDelivery(organizationId: string, deliveryId: string): Promise<{ enabled: boolean; photos: JobPhotoView[] }> {
    if (!(await this.link.isLinked(organizationId))) return { enabled: false, photos: [] };
    const run = await this.prisma.delivery.findFirst({ where: { id: deliveryId, organizationId }, select: { id: true } });
    if (!run) throw new NotFoundException('Delivery not found');
    const doNumbers = await this.doNumbers(organizationId, [deliveryId]);
    return { enabled: true, photos: await this.views(await this.rows(organizationId, [deliveryId]), doNumbers) };
  }

  /** The order's photos, one group per job (jobs without photos included). */
  async forOrder(organizationId: string, orderId: string) {
    if (!(await this.link.isLinked(organizationId))) return { enabled: false, jobs: [] };
    const runs = await this.prisma.delivery.findMany({
      where: { organizationId, orderId },
      select: { id: true, deliveryNumber: true, scheduledFor: true, status: true },
      orderBy: [{ scheduledFor: 'asc' }, { deliveryNumber: 'asc' }],
    });
    const ids = runs.map((r) => r.id);
    const [doNumbers, rows] = await Promise.all([this.doNumbers(organizationId, ids), this.rows(organizationId, ids)]);
    const views = await this.views(rows, doNumbers);
    return {
      enabled: true,
      jobs: runs.map((r) => ({
        deliveryId: r.id,
        deliveryNumber: r.deliveryNumber,
        scheduledFor: r.scheduledFor,
        status: r.status,
        doNumber: doNumbers.get(r.id) ?? null,
        photos: views.filter((v) => v.deliveryId === r.id),
      })),
    };
  }

  /** Office "Hide" (admins): hidden in AIMS, file kept, logged. */
  async hide(organizationId: string, photoId: string, actor: { id?: string; name?: string }) {
    if (!(await this.link.isLinked(organizationId))) throw new NotFoundException('Photo not found');
    const p = await this.inOrg(organizationId, photoId);
    await this.softDelete(p, { by: `user:${actor.id ?? 'unknown'}`, name: actor.name || 'Office', userId: actor.id });
    return { ok: true };
  }

  /** Live DO-evidence photos per job (Signed DO / Stamped DO), for the verification views. */
  async doEvidence(organizationId: string, deliveryIds: string[]): Promise<Map<string, Array<{ key: string; tag: string; workerName: string | null; takenAt: Date | null }>>> {
    const out = new Map<string, Array<{ key: string; tag: string; workerName: string | null; takenAt: Date | null }>>();
    if (!deliveryIds.length) return out;
    const rows = await this.prisma.jobPhoto.findMany({
      where: { organizationId, deliveryId: { in: deliveryIds }, deletedAt: null, tag: { in: ['SIGNED_DO', 'STAMPED_DO'] } },
      select: { deliveryId: true, fileKey: true, tag: true, workerName: true, takenAt: true },
      orderBy: { createdAt: 'asc' },
    });
    for (const r of rows) {
      const list = out.get(r.deliveryId) ?? [];
      list.push({ key: r.fileKey, tag: r.tag, workerName: r.workerName, takenAt: r.takenAt });
      out.set(r.deliveryId, list);
    }
    return out;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private bySourceId(organizationId: string, sourcePhotoId: string) {
    return this.prisma.jobPhoto.findUnique({
      where: { organizationId_source_sourcePhotoId: { organizationId, source: 'siteclock', sourcePhotoId } },
      select: { id: true },
    });
  }

  private async inOrg(organizationId: string, photoId: string): Promise<PhotoRow> {
    const p = (await this.prisma.jobPhoto.findFirst({ where: { id: photoId, organizationId } })) as PhotoRow | null;
    if (!p) throw new NotFoundException('Photo not found');
    return p;
  }

  private async live(organizationId: string, photoId: string): Promise<PhotoRow> {
    const p = await this.inOrg(organizationId, photoId);
    if (p.deletedAt) throw new NotFoundException('Photo not found');
    return p;
  }

  private async rows(organizationId: string, deliveryIds: string[]): Promise<PhotoRow[]> {
    if (!deliveryIds.length) return [];
    return (await this.prisma.jobPhoto.findMany({
      where: { organizationId, deliveryId: { in: deliveryIds }, deletedAt: null },
      orderBy: [{ takenAt: 'asc' }, { createdAt: 'asc' }],
    })) as PhotoRow[];
  }

  private async views(rows: PhotoRow[], doNumbers: Map<string, string>): Promise<JobPhotoView[]> {
    const expiresAt = new Date(Date.now() + URL_TTL_SEC * 1000).toISOString();
    const seen = new Map<string, number>();
    return Promise.all(
      rows.map(async (r) => {
        const n = (seen.get(`${r.deliveryId}:${r.tag}`) ?? 0) + 1;
        seen.set(`${r.deliveryId}:${r.tag}`, n);
        const [url, thumbUrl, downloadUrl] = await Promise.all([
          this.s3.getSignedUrl(r.fileKey, URL_TTL_SEC),
          this.s3.getSignedUrl(r.thumbKey, URL_TTL_SEC),
          this.s3.getSignedUrl(r.fileKey, URL_TTL_SEC, downloadName(r.tag, doNumbers.get(r.deliveryId), n)),
        ]);
        return {
          id: r.id,
          deliveryId: r.deliveryId,
          tag: r.tag,
          tagLabel: JOB_PHOTO_TAG_LABEL[r.tag as JobPhotoTag] ?? r.tag,
          note: r.note,
          takenAt: r.takenAt,
          uploadedAt: r.createdAt,
          workerName: r.workerName,
          source: 'siteclock' as const,
          url,
          thumbUrl,
          downloadUrl,
          urlExpiresAt: expiresAt,
        };
      }),
    );
  }

  /** Each job's DO(s): document ids, and the first DO's number. */
  private async runDocs(organizationId: string, deliveryIds: string[]) {
    const items = deliveryIds.length
      ? await this.prisma.deliveryItem.findMany({ where: { deliveryId: { in: deliveryIds }, documentId: { not: null } }, select: { deliveryId: true, documentId: true } })
      : [];
    const docIds = [...new Set(items.map((i) => i.documentId as string))];
    const docs = docIds.length
      ? await this.prisma.document.findMany({ where: { id: { in: docIds }, organizationId, type: { in: ['DELIVERY_ORDER', 'DO'] } }, select: { id: true, name: true }, orderBy: { createdAt: 'asc' } })
      : [];
    const byDoc = new Map(docs.map((d) => [d.id, d.name]));
    const out = new Map<string, { ids: string[]; number: string | null }>();
    for (const i of items) {
      if (!byDoc.has(i.documentId as string)) continue;
      const e = out.get(i.deliveryId) ?? { ids: [], number: null };
      if (!e.ids.includes(i.documentId as string)) e.ids.push(i.documentId as string);
      e.number = e.number ?? byDoc.get(i.documentId as string) ?? null;
      out.set(i.deliveryId, e);
    }
    return out;
  }

  private async doNumbers(organizationId: string, deliveryIds: string[]) {
    const m = new Map<string, string>();
    for (const [k, v] of await this.runDocs(organizationId, deliveryIds)) if (v.number) m.set(k, v.number);
    return m;
  }

  /** A Signed DO / Stamped DO photo: onto the job's DO(s) as an attachment, and a rejected job back to Awaiting verification. Best-effort past the save. */
  private async doEvidenceArrived(p: PhotoRow, run: { id: string; status: string; verificationState: string | null }) {
    const label = JOB_PHOTO_TAG_LABEL[p.tag as JobPhotoTag];
    const actor = { name: p.workerName ? `SiteClock (${p.workerName})` : 'SiteClock' };
    try {
      const docs = (await this.runDocs(p.organizationId, [p.deliveryId])).get(p.deliveryId);
      for (const docId of docs?.ids ?? []) {
        await this.documents.addAttachments(docId, p.organizationId, [{ fileKey: p.fileKey, fileName: `${label} (SiteClock).jpg`, mimeType: 'image/jpeg', label }], actor);
      }
    } catch (e: any) {
      this.logger.warn(`job photo ${p.id}: DO attachment failed: ${e?.message}`);
    }
    try {
      if (verificationAfterDoPhoto(run) === 'pending') {
        // Same as the worker's "Send new evidence": back to the office's queue.
        const moved = await this.prisma.delivery.updateMany({
          where: { id: run.id, organizationId: p.organizationId, status: 'completed', verificationState: 'rejected' },
          data: { verificationState: 'pending', verifiedAt: null, verifiedByUserId: null, verifiedByName: null },
        });
        if (moved.count) {
          await refreshOrderStatusForRun(this.prisma, p.organizationId, run.id);
          void this.actionLog?.system('siteclock-job-photos', 'UPDATE', 'delivery', {
            organizationId: p.organizationId,
            resourceId: run.id,
            details: { verificationState: 'pending', reason: `New ${label} photo from SiteClock`, photoId: p.id },
          });
        }
      }
    } catch (e: any) {
      this.logger.warn(`job photo ${p.id}: verification update failed: ${e?.message}`);
    }
  }

  private async softDelete(p: PhotoRow, who: { by: string; name: string; userId?: string }) {
    if (p.deletedAt) return;
    const done = await this.prisma.jobPhoto.updateMany({
      where: { id: p.id, organizationId: p.organizationId, deletedAt: null },
      data: { deletedAt: new Date(), deletedBy: who.by, deletedByName: who.name },
    });
    if (!done.count) return;
    if (isDoEvidenceTag(p.tag)) {
      try {
        const docs = (await this.runDocs(p.organizationId, [p.deliveryId])).get(p.deliveryId);
        for (const docId of docs?.ids ?? []) await this.documents.removeAttachment(docId, p.organizationId, p.fileKey, { id: who.userId, name: who.name });
      } catch (e: any) {
        this.logger.warn(`job photo ${p.id}: DO attachment removal failed: ${e?.message}`);
      }
    }
  }
}
