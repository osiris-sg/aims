import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { JournalService } from '../journal/journal.service';
import { JournalAutoPostService } from '../journal/journal-auto-post.service';
import { PostingPreviewService } from '../posting-preview/posting-preview.service';

// ---------------------------------------------------------------------------
// Posting-Review Queue (Feature B) + Batch Post (Feature C).
//
// Lists invoices that were created but NOT yet posted to the GL
// (config.glPosting.status='pending' — set by the weighbridge ingestion), lets
// an accountant review the AI/learned Dr-Cr preview, then posts them to the GL
// in bulk. Posting builds a PER-LINE journal entry crediting each line's own
// accountCode (JPSG lines carry 209), so it honours reviewed accounts instead
// of the single-sales-account shortcut in postFromInvoice.
// ---------------------------------------------------------------------------

const ROUND = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface PostResult {
  documentId: string;
  invoiceNumber: string;
  ok: boolean;
  journalEntryId?: string;
  skipped?: boolean;
  error?: string;
}

@Injectable()
export class PostingQueueService {
  private readonly logger = new Logger(PostingQueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: JournalService,
    private readonly autoPost: JournalAutoPostService,
    private readonly preview: PostingPreviewService,
  ) {}

  // ---- Feature B: list pending invoices -----------------------------------
  async list(
    organizationId: string,
    opts: { search?: string; page?: number; limit?: number } = {},
  ) {
    const page = Math.max(1, Number(opts.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(opts.limit) || 100));

    const where: Prisma.DocumentWhereInput = {
      organizationId,
      // Credit notes from the external /v1 API queue here too (reversed JE on post).
      type: { in: ['INVOICE', 'CREDIT_NOTE'] },
      config: { path: ['glPosting', 'status'], equals: 'pending' },
      ...(opts.search
        ? { name: { contains: opts.search, mode: 'insensitive' } }
        : {}),
    };

    const [total, docs] = await this.prisma.$transaction([
      this.prisma.document.count({ where }),
      this.prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: { id: true, name: true, type: true, status: true, config: true, createdAt: true },
      }),
    ]);

    const rows = docs.map((d) => this.shapeRow(d));
    return { total, page, limit, rows };
  }

  private shapeRow(d: { id: string; name: string | null; type?: string; status: string; config: any; createdAt: Date }) {
    const c = (d.config || {}) as any;
    const items = Array.isArray(c.items) ? c.items : [];
    return {
      id: d.id,
      name: d.name,
      type: d.type ?? 'INVOICE',
      date: c.date ?? null,
      customerName: c.customer?.name ?? '',
      subtotal: ROUND(c.subTotal),
      taxAmount: ROUND(c.gstAmount),
      totalAmount: ROUND(c.nettTotal),
      status: d.status,
      glPosting: c.glPosting ?? null,
      source: c.glPosting?.source ?? null,
      ingestBatch: c.ingestBatch ?? null,
      createdAt: d.createdAt,
      items: items.map((it: any, i: number) => ({
        lineIndex: i,
        description: it.description ?? '',
        amount: ROUND(it.amount),
        accountCode: it.accountCode ?? null,
      })),
    };
  }

  // ---- Per-row AI/learned Dr-Cr preview (reuses PostingPreviewService) -----
  async previewOne(organizationId: string, documentId: string) {
    const doc = await this.loadInvoice(organizationId, documentId);
    const c = (doc.config || {}) as any;
    const items = Array.isArray(c.items) ? c.items : [];
    return this.preview.preview(organizationId, {
      type: 'INVOICE',
      documentNumber: doc.name ?? c.documentNumber,
      taxAmount: ROUND(c.gstAmount),
      totalAmount: ROUND(c.nettTotal),
      lines: items.map((it: any) => ({
        description: it.description ?? undefined,
        amount: ROUND(it.amount),
        accountCode: it.accountCode ?? undefined,
      })),
    });
  }

  // ---- Persist accountant's reviewed accounts back onto the invoice lines --
  async applyAccounts(
    organizationId: string,
    documentId: string,
    picks: Array<{ lineIndex: number; accountCode: string | null }>,
  ) {
    const doc = await this.loadInvoice(organizationId, documentId);
    const c = (doc.config || {}) as any;
    const items = Array.isArray(c.items) ? [...c.items] : [];
    for (const p of picks || []) {
      if (p.lineIndex >= 0 && p.lineIndex < items.length && p.accountCode) {
        items[p.lineIndex] = { ...items[p.lineIndex], accountCode: p.accountCode };
      }
    }
    const config = { ...c, items } as Prisma.InputJsonValue;
    await this.prisma.document.update({ where: { id: documentId }, data: { config } });
    return { ok: true, documentId };
  }

  // ---- Feature C: batch post ----------------------------------------------
  async postBatch(organizationId: string, documentIds: string[], userId?: string) {
    if (!Array.isArray(documentIds) || documentIds.length === 0) {
      throw new BadRequestException('documentIds is required');
    }
    const results: PostResult[] = [];
    for (const id of documentIds) {
      results.push(await this.postOne(organizationId, id, userId));
    }
    return {
      total: results.length,
      posted: results.filter((r) => r.ok && !r.skipped).length,
      skipped: results.filter((r) => r.skipped).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  private async postOne(organizationId: string, documentId: string, userId?: string): Promise<PostResult> {
    let invoiceNumber = documentId;
    try {
      const doc = await this.loadInvoice(organizationId, documentId);
      const c = (doc.config || {}) as any;
      invoiceNumber = doc.name ?? c.documentNumber ?? documentId;

      if (c.glPosting?.status === 'posted') {
        return { documentId, invoiceNumber, ok: true, skipped: true, journalEntryId: c.glPosting.journalEntryId };
      }
      // Idempotency: don't double-post if a non-void JE already exists.
      const already = await this.autoPost.alreadyPostedForDocument(organizationId, documentId, doc.type);
      if (already) {
        await this.stampPosted(documentId, c, already.id, userId);
        return { documentId, invoiceNumber, ok: true, skipped: true, journalEntryId: already.id };
      }

      const entryDate = c.date ? new Date(c.date) : new Date();

      // Credit notes post the reversed entry (Cr AR / Dr revenue) via the
      // existing auto-post path; invoices post per-line below.
      if (doc.type === 'CREDIT_NOTE') {
        const entry = await this.autoPost.postFromCreditNote({
          organizationId,
          documentId,
          documentNumber: invoiceNumber,
          entryDate,
          customerName: c.customer?.name,
          netAmount: ROUND(c.subTotal),
          taxAmount: ROUND(c.gstAmount),
          grossAmount: ROUND(c.nettTotal),
          userId,
        });
        if (!entry) {
          return { documentId, invoiceNumber, ok: false, error: 'Credit-note post skipped (accounts not configured)' };
        }
        await this.stampPosted(documentId, c, entry.id, userId);
        return { documentId, invoiceNumber, ok: true, journalEntryId: entry.id };
      }

      const lines = await this.buildLines(organizationId, c, invoiceNumber);

      const created = await this.journal.create(
        organizationId,
        {
          entryDate: entryDate.toISOString(),
          type: 'INVOICE',
          reference: invoiceNumber,
          description: `Posted from invoice ${invoiceNumber} (posting queue)`,
          sourceDocumentId: documentId,
          lines,
        },
        userId,
        { autoPost: true },
      );

      await this.stampPosted(documentId, c, created.id, userId);
      return { documentId, invoiceNumber, ok: true, journalEntryId: created.id };
    } catch (err: any) {
      this.logger.error(`postOne failed for ${invoiceNumber}: ${err?.message}`);
      return { documentId, invoiceNumber, ok: false, error: err?.message ?? 'Unknown error' };
    }
  }

  // Build a balanced per-line JE: Dr AR (gross) / Cr each line's account (net)
  // / Cr GST (tax). Credits drive the debit so it always balances.
  private async buildLines(organizationId: string, c: any, invoiceNumber: string) {
    const controls = await this.getControlAccounts(organizationId);
    const debtor = await this.resolveCode(organizationId, controls.debtorControl);
    if (!debtor) throw new BadRequestException(`Debtor control account (${controls.debtorControl}) not found`);

    const items = Array.isArray(c.items) ? c.items : [];
    const tax = ROUND(c.gstAmount);

    const creditLines: { accountId: string; debit: number; credit: number; description: string }[] = [];
    let creditTotal = 0;
    for (const it of items) {
      const amount = ROUND(it.amount);
      if (amount <= 0) continue;
      const code = it.accountCode || controls.salesAccount;
      const acc = (code && (await this.resolveCode(organizationId, code))) || (await this.firstSalesAccount(organizationId));
      if (!acc) throw new BadRequestException(`No revenue account resolved for line "${it.description ?? ''}" (code ${code ?? 'none'})`);
      creditLines.push({ accountId: acc.id, debit: 0, credit: amount, description: (it.description || `Sales — ${invoiceNumber}`).slice(0, 250) });
      creditTotal += amount;
    }
    if (creditLines.length === 0) throw new BadRequestException('Invoice has no positive line amounts to post');

    if (tax > 0) {
      const taxAcc = await this.resolveCode(organizationId, controls.taxLiabilities);
      if (!taxAcc) throw new BadRequestException(`Tax liability account (${controls.taxLiabilities}) not found`);
      creditLines.push({ accountId: taxAcc.id, debit: 0, credit: tax, description: `GST — ${invoiceNumber}` });
      creditTotal += tax;
    }

    const gross = ROUND(creditTotal);
    return [
      { accountId: debtor.id, debit: gross, credit: 0, description: `Invoice ${invoiceNumber} — ${c.customer?.name ?? ''}`.trim().slice(0, 250) },
      ...creditLines,
    ];
  }

  // ---- Reject / hold ------------------------------------------------------
  async reject(organizationId: string, documentId: string, reason: string, userId?: string) {
    const doc = await this.loadInvoice(organizationId, documentId);
    const c = (doc.config || {}) as any;
    if (c.glPosting?.status === 'posted') {
      throw new BadRequestException('Cannot reject an already-posted invoice');
    }
    const config = {
      ...c,
      glPosting: {
        ...(c.glPosting || {}),
        status: 'rejected',
        rejectedAt: new Date().toISOString(),
        rejectedBy: userId ?? null,
        rejectReason: reason ?? null,
      },
    } as Prisma.InputJsonValue;
    await this.prisma.document.update({ where: { id: documentId }, data: { config } });
    return { ok: true, documentId };
  }

  // ---- helpers ------------------------------------------------------------
  private async loadInvoice(organizationId: string, documentId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId, type: { in: ['INVOICE', 'CREDIT_NOTE'] } },
      select: { id: true, name: true, type: true, config: true, status: true },
    });
    if (!doc) throw new NotFoundException('Invoice not found in this organization');
    return doc;
  }

  private async stampPosted(documentId: string, c: any, journalEntryId: string, userId?: string) {
    const config = {
      ...c,
      glPosting: {
        ...(c.glPosting || {}),
        status: 'posted',
        journalEntryId,
        postedAt: new Date().toISOString(),
        postedBy: userId ?? null,
      },
    } as Prisma.InputJsonValue;
    await this.prisma.document.update({ where: { id: documentId }, data: { config } });
  }

  private async getControlAccounts(organizationId: string): Promise<{ debtorControl?: string; taxLiabilities?: string; salesAccount?: string }> {
    const s = await this.prisma.accountingSetting.findFirst({
      where: { organizationId },
      select: { controlAccounts: true },
    });
    const ca = (s?.controlAccounts as any) || {};
    return { debtorControl: ca.debtorControl, taxLiabilities: ca.taxLiabilities, salesAccount: ca.salesAccount };
  }

  private async resolveCode(organizationId: string, code?: string | null) {
    if (!code) return null;
    return this.prisma.chartOfAccount.findFirst({
      where: { organizationId, code: String(code), isActive: true },
      select: { id: true, code: true },
    });
  }

  private async firstSalesAccount(organizationId: string) {
    return this.prisma.chartOfAccount.findFirst({
      where: { organizationId, accountType: 'SALES', isActive: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true },
    });
  }
}
