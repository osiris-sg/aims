import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import { BillsService } from '../bills/bills.service';
import { DocumentsService } from '../documents/documents.service';
import { DocumentExtractionService, DocumentType } from '../document-extraction/document-extraction.service';

// Provider-agnostic inbound payload — same shape as bills-inbound.
export interface InboundEmailPayload {
  from: string;
  to: string;
  subject?: string;
  text?: string;
  messageId?: string;
  attachments?: Array<{ contentType: string; contentBase64: string; filename?: string }>;
}

type InboundResult =
  | { ok: true; created: string[]; logId: string; notes?: string }
  | { ok: false; reason: string; details?: string };

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB per attachment

@Injectable()
export class IngestionEmailService {
  private readonly logger = new Logger(IngestionEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly bills: BillsService,
    private readonly documents: DocumentsService,
    private readonly extraction: DocumentExtractionService,
  ) {}

  async handleInbound(payload: InboundEmailPayload): Promise<InboundResult> {
    // 1. Org from the plus-suffix: docs+{ORG_ID}@... (bills-inbound convention,
    //    different local part so both webhooks can share a domain).
    const match = (payload?.to || '').match(/docs\+([A-Za-z0-9-]+)@/i);
    const organizationId = match?.[1];
    if (!organizationId) return { ok: false, reason: 'bad-address', details: 'Address must be docs+{ORG_ID}@<domain>' };

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, registrationNumber: true },
    });
    if (!org) return { ok: false, reason: 'unknown-org' };

    // 2. Per-org config gate.
    const config = await this.prisma.emailIngestConfig.findUnique({ where: { organizationId } });
    if (!config || !config.enabled) return { ok: false, reason: 'ingestion-disabled' };

    const fromEmail = ((payload.from || '').match(/<?([^<>\s]+@[^<>\s]+)>?/)?.[1] || '').toLowerCase();
    const messageId = this.resolveMessageId(payload);
    const attachmentCount = payload.attachments?.length ?? 0;

    // 3. Sender allow-list — full address or @domain suffix; empty = accept all.
    if (!this.senderIsWatched(fromEmail, config.watchedSenders)) {
      await this.createLog(organizationId, messageId, payload, 'IGNORED', 'sender-not-watched', attachmentCount);
      return { ok: false, reason: 'sender-not-watched' };
    }

    // 4. Dedup — the log row IS the idempotency anchor. A retry of the same
    //    message hits the (org, messageId) unique and short-circuits here.
    const log = await this.createLog(organizationId, messageId, payload, 'RECEIVED', null, attachmentCount);
    if (!log) return { ok: false, reason: 'duplicate' };

    try {
      return await this.processAttachments(org, config, payload, fromEmail, log.id);
    } catch (e: any) {
      // Unexpected failure after the log row exists: mark FAILED and answer
      // 200 — the dedup row means a provider retry would no-op anyway.
      this.logger.error(`[ingest-email] org=${organizationId} unexpected failure: ${e?.message}`, e?.stack);
      await this.prisma.emailIngestLog.update({
        where: { id: log.id },
        data: { status: 'FAILED', reason: `unexpected-error: ${String(e?.message ?? e).slice(0, 500)}` },
      });
      return { ok: false, reason: 'error', details: String(e?.message ?? e) };
    }
  }

  // ── pipeline ─────────────────────────────────────────────────────────────

  private async processAttachments(
    org: { id: string; name: string; registrationNumber: string | null },
    config: { routingMode: string; defaultDocType: string | null },
    payload: InboundEmailPayload,
    fromEmail: string,
    logId: string,
  ): Promise<InboundResult> {
    const organizationId = org.id;

    // 5. Usable attachments: PDF/image only, 10MB cap.
    const notes: string[] = [];
    const usable = (payload.attachments || []).filter((a) => {
      if (!/pdf|image\//i.test(a.contentType || '')) return false;
      // ~3/4 of base64 length = decoded size; cheap pre-decode cap check.
      if ((a.contentBase64?.length || 0) * 0.75 > MAX_ATTACHMENT_BYTES) {
        notes.push(`${a.filename || 'attachment'}: skipped (>10MB)`);
        return false;
      }
      return Boolean(a.contentBase64);
    });

    if (usable.length === 0) {
      await this.prisma.emailIngestLog.update({
        where: { id: logId },
        data: { status: 'IGNORED', reason: notes.join('; ') || 'no-usable-attachments' },
      });
      return { ok: false, reason: 'no-usable-attachments' };
    }

    // 6. Per attachment: classify → extract → persist original → create draft.
    const createdIds: string[] = [];
    for (const att of usable) {
      const label = att.filename || 'attachment';
      try {
        const { buffer, mimetype, base64 } = this.decodeAttachment(att);

        // Route: FIXED skips the classifier; AI classifies by issuer.
        let docType: 'INVOICE' | 'BILL' | 'OTHER';
        let issuerName: string | null = null;
        if (config.routingMode === 'FIXED' && config.defaultDocType) {
          docType = config.defaultDocType === 'BILL' ? 'BILL' : 'INVOICE';
        } else {
          const cls = await this.extraction.classifyIssuer({ buffer, mimetype }, org);
          docType = cls.documentType;
          issuerName = cls.issuerName;
        }
        if (docType === 'OTHER') {
          notes.push(`${label}: not a billing document (issuer: ${issuerName || 'unknown'})`);
          continue;
        }

        // Persist the original before creating, so the draft can reference it.
        const fileName = this.safeFileName(att.filename, mimetype);
        const fileKey = `email-ingest/${organizationId}/${new Date().toISOString().replace(/[:.]/g, '-')}_${fileName}`;
        const fileUrl = await this.s3.uploadFile(fileKey, buffer, mimetype);

        const createdId =
          docType === 'BILL'
            ? await this.createBill(organizationId, payload, fromEmail, issuerName, base64, mimetype, label)
            : await this.createInvoice(organizationId, buffer, mimetype, fileUrl);

        if (!createdId) {
          notes.push(`${label}: extraction failed`);
          continue;
        }

        // Original PDF/image onto the created Document's attachments.
        // (BILL path reuses BillsService.addAttachments for the stamping; the
        // INVOICE path appends directly — the row was just created, same shape.)
        if (docType === 'BILL') {
          await this.bills.addAttachments(
            organizationId,
            createdId,
            [{ fileKey, fileName, mimeType: mimetype, label: 'Original email attachment' }],
            'EMAIL_INGEST',
          );
        } else {
          await this.appendDocumentAttachment(createdId, {
            fileKey,
            fileName,
            mimeType: mimetype,
            label: 'Original email attachment',
            uploadedAt: new Date().toISOString(),
            uploadedBy: 'EMAIL_INGEST',
          });
        }

        createdIds.push(createdId);
        notes.push(`${label}: ${docType} draft ${createdId}`);
      } catch (e: any) {
        this.logger.warn(`[ingest-email] org=${organizationId} attachment "${label}" failed: ${e?.message}`);
        notes.push(`${label}: failed (${String(e?.message ?? e).slice(0, 200)})`);
      }
    }

    const reason = notes.join('; ').slice(0, 2000) || null;
    if (createdIds.length === 0) {
      await this.prisma.emailIngestLog.update({
        where: { id: logId },
        data: { status: 'FAILED', reason: reason || 'no-documents-created' },
      });
      return { ok: false, reason: 'no-documents-created', details: reason || undefined };
    }

    await this.prisma.emailIngestLog.update({
      where: { id: logId },
      data: {
        status: 'PARSED',
        reason,
        createdDocumentIds: createdIds as unknown as Prisma.InputJsonValue,
      },
    });
    return { ok: true, created: createdIds, logId, notes: reason || undefined };
  }

  // ── AP: bill draft (mirrors bills-inbound) ───────────────────────────────

  private async createBill(
    organizationId: string,
    payload: InboundEmailPayload,
    fromEmail: string,
    issuerName: string | null,
    base64: string,
    mimetype: string,
    filename: string,
  ): Promise<string | null> {
    const extracted = await this.bills.extractFromFile(organizationId, base64, mimetype as any);
    if (!extracted) return null;

    // Placeholder-supplier fallback, verbatim from bills-inbound: prefer the
    // extracted vendor name, then the classifier's issuer, then the sender.
    let supplierId = extracted.supplierIdGuess?.id;
    if (!supplierId) {
      const placeholderName = extracted.supplierName || issuerName || fromEmail || 'Unknown Supplier';
      const supplier = await this.prisma.supplier.upsert({
        where: { email_organizationId: { email: fromEmail || '', organizationId } },
        update: {},
        create: { organizationId, name: placeholderName, email: fromEmail || null },
      });
      supplierId = supplier.id;
    }

    const bill = await this.bills.create(organizationId, undefined, {
      supplierId,
      billNumber: extracted.billNumber || `EMAIL-${Date.now()}`,
      billDate: extracted.billDate || new Date().toISOString(),
      dueDate: extracted.dueDate || undefined,
      lines: extracted.lines || [{ description: 'Imported from email', amount: extracted.totalAmount || 0 }],
      taxAmount: extracted.taxAmount,
      inboundChannel: 'EMAIL',
      inboundMeta: {
        ...extracted.meta,
        fromAddress: payload.from,
        subject: payload.subject,
        filename,
      },
    });
    return bill.id;
  }

  // ── AR: invoice draft via the existing extraction → createFromExtraction ─

  private async createInvoice(
    organizationId: string,
    buffer: Buffer,
    mimetype: string,
    fileUrl: string,
  ): Promise<string | null> {
    const extracted = await this.extraction.processDocumentFile(
      // processDocumentFile only reads buffer + mimetype off the Multer file.
      { buffer, mimetype } as any,
      DocumentType.INVOICE,
    );
    const created = await this.documents.createFromExtraction(
      organizationId,
      'INVOICE',
      extracted,
      undefined,
      fileUrl,
      'email',
    );
    return created?.id ?? null;
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /** Provider Message-ID when present; else a deterministic payload hash so
   *  retries of the same message dedupe onto the same log row. */
  private resolveMessageId(payload: InboundEmailPayload): string {
    if (payload.messageId?.trim()) return payload.messageId.trim().slice(0, 500);
    const fingerprint = JSON.stringify({
      from: payload.from,
      to: payload.to,
      subject: payload.subject || '',
      text: payload.text || '',
      attachments: (payload.attachments || []).map((a) => `${a.filename || ''}:${a.contentBase64?.length || 0}`),
    });
    return `sha256:${createHash('sha256').update(fingerprint).digest('hex')}`;
  }

  private senderIsWatched(fromEmail: string, watchedSenders: unknown): boolean {
    const list = (Array.isArray(watchedSenders) ? watchedSenders : [])
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (list.length === 0) return true; // empty allow-list = accept all
    if (!fromEmail) return false;
    return list.some((entry) => (entry.startsWith('@') ? fromEmail.endsWith(entry) : fromEmail === entry));
  }

  /** RECEIVED/IGNORED log row; null when (org, messageId) already exists. */
  private async createLog(
    organizationId: string,
    messageId: string,
    payload: InboundEmailPayload,
    status: 'RECEIVED' | 'IGNORED',
    reason: string | null,
    attachmentCount: number,
  ) {
    try {
      return await this.prisma.emailIngestLog.create({
        data: {
          organizationId,
          messageId,
          fromAddress: payload.from || '',
          subject: payload.subject || null,
          status,
          reason,
          attachmentCount,
          rawMeta: {
            to: payload.to,
            hasText: Boolean(payload.text),
            attachmentNames: (payload.attachments || []).map((a) => a.filename || null),
          },
        },
      });
    } catch (e: any) {
      if (e.code === 'P2002') return null; // duplicate delivery
      throw e;
    }
  }

  private decodeAttachment(att: { contentType: string; contentBase64: string }) {
    // Strip a data-URI header if the provider sends one (bills-inbound parity).
    const headerMatch = att.contentBase64.match(/^data:([a-zA-Z/+.-]+);base64,/);
    const base64 = headerMatch ? att.contentBase64.slice(att.contentBase64.indexOf(',') + 1) : att.contentBase64;
    const declaredType = headerMatch?.[1] || att.contentType;
    const mimetype = /pdf/i.test(declaredType) ? 'application/pdf' : declaredType;
    return { buffer: Buffer.from(base64, 'base64'), mimetype, base64 };
  }

  private safeFileName(filename: string | undefined, mimetype: string): string {
    const fallback = mimetype === 'application/pdf' ? 'attachment.pdf' : 'attachment.' + (mimetype.split('/')[1] || 'bin');
    const cleaned = (filename || fallback).replace(/[^A-Za-z0-9._-]/g, '_');
    return cleaned.slice(0, 120) || fallback;
  }

  private async appendDocumentAttachment(documentId: string, entry: Record<string, string>) {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId }, select: { attachments: true } });
    const existing = Array.isArray(doc?.attachments) ? (doc!.attachments as any[]) : [];
    await this.prisma.document.update({
      where: { id: documentId },
      data: { attachments: [...existing, entry] as unknown as Prisma.InputJsonValue },
    });
  }
}
