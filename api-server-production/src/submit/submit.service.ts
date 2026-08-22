import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import { DocumentExtractionService, DocumentType } from '../document-extraction/document-extraction.service';
import { DocumentsService } from '../documents/documents.service';
import { BillsService } from '../bills/bills.service';
import { ActionLogService } from '../action-log/action-log.service';

const MAX_ATTEMPTS = 3;
const STUCK_MS = 10 * 60 * 1000; // reclaim PROCESSING rows idle longer than this
const HISTORY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Async intake for the normal-user /submit flow.
 *
 * Leg A (intake, client-awaited, fast): persist each file to S3 + create a
 * QUEUED SubmitJob, return immediately. Leg B (this service's worker, server-
 * side): claim QUEUED rows → extract → create draft → DONE/FAILED. Decoupling
 * the two fixes the silent-data-loss bug: once intake returns, leaving mid-flow
 * can no longer orphan an S3 file with no draft and no error — the durable job
 * row carries it to completion or to a VISIBLE failure.
 */
@Injectable()
export class SubmitService {
  private readonly logger = new Logger(SubmitService.name);
  // Reentrancy guard so the immediate kick and the cron sweep don't drain
  // concurrently within THIS instance (see claimNext for the cross-instance note).
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly extraction: DocumentExtractionService,
    private readonly documents: DocumentsService,
    private readonly bills: BillsService,
    private readonly actionLog: ActionLogService,
  ) {}

  // ── Leg A: intake ─────────────────────────────────────────────────────────
  async intake(
    organizationId: string,
    userId: string,
    docType: string,
    files: Express.Multer.File[],
    // Optional client-supplied batch id so a submission uploaded file-by-file
    // (for real per-file progress) still groups under ONE batch. Omitted → one
    // batch per request.
    providedBatchId?: string,
  ): Promise<{ batchId: string; jobIds: string[]; count: number }> {
    if (!files?.length) throw new BadRequestException('No files uploaded');
    if (!docType) throw new BadRequestException('docType is required');

    const batchId = providedBatchId?.trim() || randomUUID();
    const jobIds: string[] = [];
    for (const file of files) {
      const safeName = (file.originalname || 'upload').replace(/[^\w.\-]+/g, '_').slice(0, 80);
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const key = `submit-uploads/${organizationId}/${batchId}/${ts}_${safeName}`;
      // The one leg the client must survive — the bytes reaching S3. After this
      // the job is durable and the rest is server-side.
      const fileUrl = await this.s3.uploadFile(key, file.buffer, file.mimetype);
      const job = await this.prisma.submitJob.create({
        data: {
          organizationId,
          createdByUserId: userId,
          batchId,
          docType,
          status: 'QUEUED',
          s3Key: key,
          fileUrl,
          mimeType: file.mimetype,
          fileName: file.originalname,
        },
        select: { id: true },
      });
      jobIds.push(job.id);
    }

    // Immediate in-process kick for fast UX; the @Cron sweep is the durable
    // backstop (survives a process restart, retries, reclaims stuck rows).
    void this.drainQueue().catch((e) => this.logger.error(`kick drain failed: ${e?.message}`));
    return { batchId, jobIds, count: jobIds.length };
  }

  // ── Leg B: worker ──────────────────────────────────────────────────────────
  @Cron('* * * * *')
  async sweep(): Promise<void> {
    await this.reclaimStuck();
    await this.drainQueue();
  }

  // A worker that died mid-job leaves a row PROCESSING forever — return long-idle
  // ones to the queue so they get retried (attemptCount still guards the cap).
  private async reclaimStuck(): Promise<void> {
    try {
      const res = await this.prisma.submitJob.updateMany({
        where: { status: 'PROCESSING', updatedAt: { lt: new Date(Date.now() - STUCK_MS) } },
        data: { status: 'QUEUED' },
      });
      if (res.count) this.logger.warn(`Reclaimed ${res.count} stuck SubmitJob(s) back to QUEUED`);
    } catch (e: any) {
      this.logger.error(`reclaimStuck failed: ${e?.message}`);
    }
  }

  private async drainQueue(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (;;) {
        const job = await this.claimNext();
        if (!job) break;
        await this.processOne(job);
      }
    } finally {
      this.draining = false;
    }
  }

  /**
   * Claim one QUEUED row via a WHERE-guarded status transition.
   *
   * ⚠️ SINGLE-INSTANCE ASSUMPTION: this read-then-guarded-update claim is safe
   * only while the API runs as ONE instance — the same assumption the existing
   * recurring-invoices @Cron already makes. If Render ever scales past one
   * instance, two workers could each read the same QUEUED row before either
   * flips it; replace this with a raw
   *   UPDATE "SubmitJob" SET status='PROCESSING' WHERE id = (
   *     SELECT id FROM "SubmitJob" WHERE status='QUEUED' ORDER BY "createdAt"
   *     FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *
   * claim, which is atomic across instances.
   */
  private async claimNext() {
    const candidate = await this.prisma.submitJob.findFirst({
      where: { status: 'QUEUED' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!candidate) return null;
    const claimed = await this.prisma.submitJob.updateMany({
      where: { id: candidate.id, status: 'QUEUED' },
      data: { status: 'PROCESSING', attemptCount: { increment: 1 } },
    });
    if (claimed.count === 0) return null; // lost the race — next loop picks another
    return this.prisma.submitJob.findUnique({ where: { id: candidate.id } });
  }

  private async processOne(job: {
    id: string;
    organizationId: string;
    createdByUserId: string;
    docType: string;
    s3Key: string;
    fileUrl: string | null;
    mimeType: string | null;
    fileName: string | null;
    attemptCount: number;
  }): Promise<void> {
    try {
      const buffer = await this.s3.downloadFile(job.s3Key);
      const base64 = buffer.toString('base64');
      const mediaType = job.mimeType || 'image/jpeg';

      let documentId: string | undefined;
      let sequenceWarning: any = undefined;

      if (job.docType === 'BILL') {
        // Supplier bills take their dedicated pipeline (postOnSave:false = draft,
        // no journal until reviewed). No sequence warning — see documents.service.
        const bill: any = await this.bills.createFromUpload(job.organizationId, job.createdByUserId, {
          base64,
          mediaType,
          filename: job.fileName ?? undefined,
          postOnSave: false,
        });
        documentId = bill?.id;
        if (!documentId) throw new Error('Bill creation returned no id');
      } else {
        const extracted = await this.extraction.extractDocumentData(
          base64,
          this.toExtractionType(job.docType),
          mediaType,
        );
        const result: any = await this.documents.createFromExtraction(
          job.organizationId,
          job.docType,
          extracted,
          undefined,
          job.fileUrl ?? undefined,
          'upload',
          { id: job.createdByUserId, name: 'Submitted upload' },
        );
        documentId = result?.id;
        sequenceWarning = result?.sequenceWarning; // moved off the sync response onto the row
        if (!documentId) throw new Error('Draft creation returned no id');
      }

      await this.prisma.submitJob.update({
        where: { id: job.id },
        data: { status: 'DONE', documentId, reason: null, sequenceWarning: sequenceWarning ?? undefined },
      });
      // System creation: the worker (not the submitter) created the draft.
      this.actionLog.system('submit-worker', 'CREATE', 'documents', {
        organizationId: job.organizationId,
        resourceId: documentId,
        details: { note: `Draft ${job.docType} created from field upload`, submitJobId: job.id, submittedBy: job.createdByUserId },
      });
    } catch (e: any) {
      const msg = String(e?.message ?? e).slice(0, 500);
      // attemptCount was incremented at claim, so it reflects THIS attempt.
      const exhausted = job.attemptCount >= MAX_ATTEMPTS;
      await this.prisma.submitJob.update({
        where: { id: job.id },
        data: { status: exhausted ? 'FAILED' : 'QUEUED', reason: msg },
      });
      this.logger.error(
        `SubmitJob ${job.id} attempt ${job.attemptCount}/${MAX_ATTEMPTS} failed${exhausted ? ' (FAILED-final)' : ' (will retry)'}: ${msg}`,
      );
    }
  }

  // AIMS docType → extraction enum (mirrors /submit's toExtractionType).
  private toExtractionType(docType: string): DocumentType {
    const t = (docType || '').toUpperCase();
    if (['DO', 'DELIVERY_ORDER', 'RDO'].includes(t)) return DocumentType.DELIVERY_ORDER;
    if (['QUOTATION', 'QO', 'QO1', 'QT'].includes(t)) return DocumentType.QUOTATION;
    if (['PO', 'PURCHASE_ORDER'].includes(t)) return DocumentType.PURCHASE_ORDER;
    return DocumentType.INVOICE;
  }

  // ── read surfaces ──────────────────────────────────────────────────────────
  // Submitter's own recent jobs (the /submit history + confirmation surface).
  async mine(organizationId: string, userId: string) {
    return this.prisma.submitJob.findMany({
      where: { organizationId, createdByUserId: userId, createdAt: { gte: new Date(Date.now() - HISTORY_MS) } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, batchId: true, docType: true, status: true, fileName: true, fileUrl: true,
        reason: true, sequenceWarning: true, documentId: true, createdAt: true,
      },
    });
  }

  // Org-scoped admin uploads log (all submitters). Optional status filter.
  async list(organizationId: string, status?: string) {
    return this.prisma.submitJob.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true, batchId: true, docType: true, status: true, fileName: true, fileUrl: true,
        reason: true, sequenceWarning: true, documentId: true, createdByUserId: true,
        attemptCount: true, createdAt: true, updatedAt: true,
      },
    });
  }

  // Manual retry (admin) — reset a FAILED (or requeue a stuck) job and kick.
  async retry(organizationId: string, jobId: string) {
    const job = await this.prisma.submitJob.findFirst({ where: { id: jobId, organizationId }, select: { id: true, status: true } });
    if (!job) throw new NotFoundException('Submission job not found');
    if (job.status === 'PROCESSING') throw new BadRequestException('Job is already processing');
    if (job.status === 'DONE') throw new BadRequestException('Job already completed');
    await this.prisma.submitJob.update({
      where: { id: jobId },
      data: { status: 'QUEUED', reason: null, attemptCount: 0 },
    });
    void this.drainQueue().catch((e) => this.logger.error(`retry drain failed: ${e?.message}`));
    return { ok: true };
  }
}
