import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import AdmZip = require('adm-zip');
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

// Hard routing rule (EmailIngestConfig.rules): deterministic, evaluated
// top-down before any AI call; first match wins. A rule matches when ALL its
// conditions match (AND). Actions:
//   IGNORE / FORCE_BILL / FORCE_INVOICE — deterministic outcomes.
//   AI_GUIDANCE — run the AI classifier per attachment with this rule's
//     `guidance` text (works even when routingMode=FIXED; for emails that
//     carry a mix of bills and invoices the AI sorts each attachment).
// Legacy rows stored a flat {field, operator, value, action} — still accepted.
export interface EmailIngestRuleCondition {
  field: 'SUBJECT' | 'SENDER' | 'BODY';
  operator: 'CONTAINS' | 'EQUALS' | 'STARTS_WITH' | 'DOMAIN';
  value: string;
}
export interface EmailIngestRule {
  conditions: EmailIngestRuleCondition[];
  action: 'IGNORE' | 'FORCE_BILL' | 'FORCE_INVOICE' | 'AI_GUIDANCE';
  guidance?: string;
}

// How a matched rule steers attachment processing: FORCE_* pins the type,
// AI_GUIDANCE forces the classifier with extra per-rule instructions.
interface RuleRouting {
  forcedType?: 'BILL' | 'INVOICE';
  ruleGuidance?: string;
}

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB per attachment
const MAX_ZIP_BYTES = 25 * 1024 * 1024; // 25MB per zip archive
const MAX_ZIP_ENTRIES = 30; // usable files taken from one zip

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

    // 5. Hard rules — deterministic, evaluated once per email on the envelope,
    //    before any AI call. IGNORE drops the email; FORCE_* pins the doc type
    //    for every attachment (skipping the classifier); AI_GUIDANCE forces the
    //    AI path (even in FIXED mode) with the rule's own instructions.
    const matched = this.evaluateRules(config.rules, { subject: payload.subject, sender: fromEmail, body: payload.text });
    if (matched?.action === 'IGNORE') {
      await this.prisma.emailIngestLog.update({
        where: { id: log.id },
        data: { status: 'IGNORED', reason: `rule: ${this.describeRule(matched)}` },
      });
      return { ok: false, reason: 'rule-ignored', details: this.describeRule(matched) };
    }
    const routing: RuleRouting =
      matched?.action === 'FORCE_BILL'
        ? { forcedType: 'BILL' }
        : matched?.action === 'FORCE_INVOICE'
          ? { forcedType: 'INVOICE' }
          : matched?.action === 'AI_GUIDANCE'
            ? { ruleGuidance: matched.guidance?.trim() || undefined }
            : {};

    try {
      return await this.processAttachments(org, config, payload, fromEmail, log.id, routing);
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
    config: { routingMode: string; defaultDocType: string | null; aiGuidance: string | null },
    payload: InboundEmailPayload,
    fromEmail: string,
    logId: string,
    routing: RuleRouting = {},
  ): Promise<InboundResult> {
    const organizationId = org.id;

    // 5. Usable attachments: PDF/image only, 10MB cap. Zip archives are
    //    expanded first — each PDF/image inside becomes its own attachment
    //    (suppliers commonly send a month's bills as one zip).
    const notes: string[] = [];
    const expanded = this.expandZipAttachments(payload.attachments || [], notes);
    const usable = expanded.filter((a) => {
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
    // {id, type} pairs for the log so the admin UI can deep-link per doc type.
    const createdDocs: Array<{ id: string; type: string }> = [];
    // Mixed-email collation (JP-pass case): when ONE email carries both an
    // invoice and bills, the bills get collated into a single reference line
    // item appended to the invoice draft (see appendCollatedBillsLine).
    const createdInvoiceIds: string[] = [];
    const collatedBills: Array<{ billNumber: string; total: number | null }> = [];
    for (const att of usable) {
      const label = att.filename || 'attachment';
      try {
        const { buffer, mimetype, base64 } = this.decodeAttachment(att);

        // Route: a matched FORCE_* rule wins outright, then FIXED mode; both
        // skip the classifier. An AI_GUIDANCE rule forces the classifier even
        // in FIXED mode. The classifier sees the email envelope (untrusted
        // hint) + org aiGuidance + the matched rule's guidance (both trusted).
        let docType: 'INVOICE' | 'BILL' | 'CREDIT_NOTE_AR' | 'CREDIT_NOTE_AP' | 'OTHER';
        let issuerName: string | null = null;
        const useAi = Boolean(routing.ruleGuidance !== undefined || config.routingMode !== 'FIXED' || !config.defaultDocType);
        if (routing.forcedType) {
          docType = routing.forcedType;
        } else if (!useAi) {
          docType = config.defaultDocType === 'BILL' ? 'BILL' : 'INVOICE';
        } else {
          const guidance = [config.aiGuidance?.trim(), routing.ruleGuidance].filter(Boolean).join('\n');
          const cls = await this.extraction.classifyIssuer({ buffer, mimetype }, org, {
            email: { from: payload.from, subject: payload.subject, bodyText: payload.text },
            guidance: guidance || null,
          });
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

        let createdId: string | null;
        if (docType === 'BILL') {
          const bill = await this.createBill(organizationId, payload, fromEmail, issuerName, base64, mimetype, label);
          createdId = bill?.id ?? null;
          if (bill) collatedBills.push({ billNumber: bill.billNumber, total: bill.totalAmount });
        } else if (docType === 'CREDIT_NOTE_AR' || docType === 'CREDIT_NOTE_AP') {
          createdId = await this.createCreditNote(
            organizationId,
            docType === 'CREDIT_NOTE_AP' ? 'AP' : 'AR',
            buffer,
            mimetype,
            fileUrl,
            fromEmail,
            issuerName,
          );
        } else {
          createdId = await this.createInvoice(organizationId, buffer, mimetype, fileUrl);
          if (createdId) createdInvoiceIds.push(createdId);
        }

        if (!createdId) {
          notes.push(`${label}: extraction failed`);
          continue;
        }

        // Original PDF/image onto the created Document's attachments.
        // (BILL path reuses BillsService.addAttachments for the stamping; the
        // INVOICE/CREDIT_NOTE paths append directly — the row was just created,
        // same shape.)
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
        // The log stores the Document.type (route-able); AR/AP nuance stays in the note.
        createdDocs.push({
          id: createdId,
          type: docType === 'CREDIT_NOTE_AR' || docType === 'CREDIT_NOTE_AP' ? 'CREDIT_NOTE' : docType,
        });
        notes.push(`${label}: ${docType} draft ${createdId}`);
      } catch (e: any) {
        this.logger.warn(`[ingest-email] org=${organizationId} attachment "${label}" failed: ${e?.message}`);
        notes.push(`${label}: failed (${String(e?.message ?? e).slice(0, 200)})`);
      }
    }

    // 7. Mixed-email collation (JP-pass case): the email carried BOTH an
    //    invoice and bills → append ONE reference line item to each created
    //    invoice, listing every bill stacked inside the description. The line
    //    carries no amount so the invoice's own extracted totals stay intact.
    if (createdInvoiceIds.length > 0 && collatedBills.length > 0) {
      for (const invoiceId of createdInvoiceIds) {
        try {
          await this.appendCollatedBillsLine(invoiceId, collatedBills);
        } catch (e: any) {
          this.logger.warn(`[ingest-email] org=${organizationId} bill collation failed for invoice ${invoiceId}: ${e?.message}`);
          notes.push(`invoice ${invoiceId}: bill collation failed`);
        }
      }
      notes.push(`collated ${collatedBills.length} bill(s) into invoice line item`);
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
        createdDocumentIds: createdDocs as unknown as Prisma.InputJsonValue,
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
  ): Promise<{ id: string; billNumber: string; totalAmount: number | null } | null> {
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
    return {
      id: bill.id,
      billNumber: (bill as any).billNumber || extracted.billNumber || '',
      totalAmount: typeof (bill as any).totalAmount === 'number' ? (bill as any).totalAmount : null,
    };
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

  // ── Credit notes: Document type CREDIT_NOTE + config.subtype 'AR'|'AP' ────
  // (Xero-migration convention: AR = we credit a customer, AP = a supplier
  // credits us. GL posting branches on the subtype at confirm time.)

  private async createCreditNote(
    organizationId: string,
    subtype: 'AR' | 'AP',
    buffer: Buffer,
    mimetype: string,
    fileUrl: string,
    fromEmail: string,
    issuerName: string | null,
  ): Promise<string | null> {
    // The invoice extraction shape (number/date/party/items/totals) fits
    // credit notes; the classifier already established the document kind.
    const extracted = await this.extraction.processDocumentFile(
      { buffer, mimetype } as any,
      DocumentType.INVOICE,
    );
    const created = await this.documents.createFromExtraction(
      organizationId,
      'CREDIT_NOTE',
      extracted,
      undefined,
      fileUrl,
      'email',
    );
    if (!created?.id) return null;

    // Stamp the side. For AP credit notes the counterparty is a supplier —
    // attach one (upsert by sender email, mirroring the bills path) and drop
    // any customer createFromExtraction may have fuzzy-matched: on an AP note
    // the extracted "customer" (bill-to) is this org itself, so a match there
    // would always be wrong.
    const patch: Record<string, any> = { subtype };
    if (subtype === 'AP') {
      // NOT extracted.customer — on an AP note that's the bill-to party, i.e.
      // this org itself. The classifier's issuer IS the supplier.
      const placeholderName = issuerName || fromEmail || 'Unknown Supplier';
      const supplier = await this.prisma.supplier.upsert({
        where: { email_organizationId: { email: fromEmail || '', organizationId } },
        update: {},
        create: { organizationId, name: placeholderName, email: fromEmail || null },
      });
      patch.supplierId = supplier.id;
      patch.supplier = { id: supplier.id, name: supplier.name };
      patch.customerId = null;
      patch.customer = null;
    }

    const doc = await this.prisma.document.findUnique({ where: { id: created.id }, select: { config: true } });
    const config = (doc?.config && typeof doc.config === 'object' ? doc.config : {}) as Record<string, any>;
    await this.prisma.document.update({
      where: { id: created.id },
      data: { config: { ...config, ...patch } as unknown as Prisma.InputJsonValue },
    });
    return created.id;
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

  /** First matching hard rule, or null. A rule matches when ALL its conditions
   *  match (case-insensitive). Malformed conditions/actions are skipped.
   *  Accepts both the current {conditions:[...]} shape and the legacy flat
   *  {field, operator, value} shape. */
  private evaluateRules(
    rules: unknown,
    ctx: { subject?: string | null; sender?: string | null; body?: string | null },
  ): EmailIngestRule | null {
    const list = Array.isArray(rules) ? rules : [];
    const haystacks: Record<EmailIngestRuleCondition['field'], string> = {
      SUBJECT: (ctx.subject || '').toLowerCase(),
      SENDER: (ctx.sender || '').toLowerCase(),
      BODY: (ctx.body || '').toLowerCase(),
    };

    const conditionMatches = (cond: Partial<EmailIngestRuleCondition>): boolean => {
      const field = cond?.field as EmailIngestRuleCondition['field'];
      const value = typeof cond?.value === 'string' ? cond.value.trim().toLowerCase() : '';
      if (!value || !(field in haystacks)) return false;
      const subject = haystacks[field];
      switch (cond?.operator) {
        case 'CONTAINS':
          return subject.includes(value);
        case 'EQUALS':
          return subject === value;
        case 'STARTS_WITH':
          return subject.startsWith(value);
        case 'DOMAIN':
          // Sender-suffix match; tolerate a missing leading "@".
          return haystacks.SENDER.endsWith(value.startsWith('@') ? value : `@${value}`);
        default:
          return false;
      }
    };

    for (const raw of list) {
      const rule = raw as any;
      if (!['IGNORE', 'FORCE_BILL', 'FORCE_INVOICE', 'AI_GUIDANCE'].includes(rule?.action)) continue;
      const conditions: Partial<EmailIngestRuleCondition>[] = Array.isArray(rule?.conditions)
        ? rule.conditions
        : rule?.field
          ? [{ field: rule.field, operator: rule.operator, value: rule.value }] // legacy flat rule
          : [];
      if (conditions.length === 0) continue;
      if (conditions.every(conditionMatches)) {
        return { conditions: conditions as EmailIngestRuleCondition[], action: rule.action, guidance: rule.guidance };
      }
    }
    return null;
  }

  private describeRule(rule: EmailIngestRule): string {
    const when = rule.conditions.map((c) => `${c.field} ${c.operator} "${c.value}"`).join(' AND ');
    return `${when} → ${rule.action}`;
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

  /** Replace zip attachments with their PDF/image contents (one level deep —
   *  nested zips are skipped). Non-zip attachments pass through untouched.
   *  Problems (encrypted/corrupt zip, oversized, empty) become log notes, never
   *  throws — one bad archive must not sink the rest of the email. */
  private expandZipAttachments(
    attachments: Array<{ contentType: string; contentBase64: string; filename?: string }>,
    notes: string[],
  ): Array<{ contentType: string; contentBase64: string; filename?: string }> {
    const IMAGE_EXT: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      tif: 'image/tiff',
      tiff: 'image/tiff',
    };
    const out: Array<{ contentType: string; contentBase64: string; filename?: string }> = [];

    for (const att of attachments) {
      const isZip = /zip/i.test(att.contentType || '') || /\.zip$/i.test(att.filename || '');
      if (!isZip) {
        out.push(att);
        continue;
      }

      const label = att.filename || 'attachment.zip';
      if ((att.contentBase64?.length || 0) * 0.75 > MAX_ZIP_BYTES) {
        notes.push(`${label}: zip skipped (>25MB)`);
        continue;
      }

      try {
        const { buffer } = this.decodeAttachment(att);
        const zip = new AdmZip(buffer);
        const zipStem = label.replace(/\.zip$/i, '');
        let taken = 0;
        let skippedOther = 0;

        for (const entry of zip.getEntries()) {
          if (entry.isDirectory) continue;
          const entryName = entry.entryName;
          // macOS resource forks, hidden files, and paths trying to escape.
          const base = entryName.split('/').pop() || entryName;
          if (/__MACOSX/i.test(entryName) || base.startsWith('.') || entryName.includes('..')) continue;

          const ext = (base.split('.').pop() || '').toLowerCase();
          const mime = ext === 'pdf' ? 'application/pdf' : IMAGE_EXT[ext];
          if (!mime) {
            skippedOther++;
            continue;
          }
          if (taken >= MAX_ZIP_ENTRIES) {
            notes.push(`${label}: only the first ${MAX_ZIP_ENTRIES} files were taken`);
            break;
          }

          const data = entry.getData(); // throws on encrypted entries
          if (data.length > MAX_ATTACHMENT_BYTES) {
            notes.push(`${label}/${base}: skipped (>10MB)`);
            continue;
          }
          out.push({ contentType: mime, contentBase64: data.toString('base64'), filename: `${zipStem}__${base}` });
          taken++;
        }

        if (taken === 0) {
          notes.push(`${label}: zip had no usable PDF/image files${skippedOther ? ` (${skippedOther} other file(s) ignored)` : ''}`);
        } else {
          notes.push(`${label}: ${taken} file(s) extracted from zip${skippedOther ? `, ${skippedOther} other file(s) ignored` : ''}`);
        }
      } catch (e: any) {
        // Encrypted or corrupt archive.
        notes.push(`${label}: could not open zip (${String(e?.message ?? e).slice(0, 120)})`);
      }
    }
    return out;
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

  /** Append ONE line item to an invoice draft listing all bills from the same
   *  email — bill numbers stacked one per line in the description (guru's
   *  spec: "no1 then below it no2 and below it no3 in the same description
   *  field"). quantity 1 / unitPrice 0 / amount 0: a reference line that
   *  leaves the invoice's own extracted totals untouched. */
  private async appendCollatedBillsLine(
    documentId: string,
    bills: Array<{ billNumber: string; total: number | null }>,
  ) {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId }, select: { config: true } });
    const config = (doc?.config && typeof doc.config === 'object' ? doc.config : {}) as Record<string, any>;
    const items: any[] = Array.isArray(config.items) ? config.items : [];

    const description = bills
      .map((b, i) => `${i + 1}. ${b.billNumber || '(no bill number)'}${b.total != null ? ` — ${b.total.toFixed(2)}` : ''}`)
      .join('\n');

    items.push({
      id: items.length + 1,
      description,
      quantity: 1,
      unitPrice: 0,
      amount: 0,
    });

    await this.prisma.document.update({
      where: { id: documentId },
      data: { config: { ...config, items } as unknown as Prisma.InputJsonValue },
    });
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
