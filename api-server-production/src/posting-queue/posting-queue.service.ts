import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { JournalService } from '../journal/journal.service';
import { BillsService } from '../bills/bills.service';
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
    private readonly bills: BillsService,
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
      // guru 2026-07-24: ONE screen for anything unconfirmed — sales docs,
      // supplier invoices and receipts all queue here (JVs appended below).
      type: { in: ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'BILL', 'OFFICIAL_RECEIPT'] },
      // guru 2026-07-24: the queue shows EVERY unconfirmed document, not just
      // machine intake — editor-created unconfirmed invoices (already
      // save-posted) appear too; posting them takes the idempotent path
      // (existing JE found → stamp + confirm).
      OR: [
        { config: { path: ['glPosting', 'status'], equals: 'pending' } },
        { status: { in: ['draft', 'unconfirmed'] as any } },
      ],
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

    const rows: any[] = docs.map((d) => this.shapeRow(d));

    // Standalone unconfirmed journal vouchers (manual JVs; doc-sourced JEs are
    // already represented by their documents above). Rendered RED in the UI.
    const jvs = await this.prisma.journalEntry.findMany({
      where: {
        organizationId,
        sourceDocumentId: null,
        status: { not: 'VOID' },
        OR: [{ isUnconfirmed: true }, { status: 'DRAFT' }],
        ...(opts.search ? { journalNumber: { contains: opts.search, mode: 'insensitive' } } : {}),
      },
      orderBy: { entryDate: 'desc' },
      take: 200,
      select: { id: true, journalNumber: true, entryDate: true, description: true, reference: true, totalDebit: true, totalCredit: true, status: true },
    });
    for (const j of jvs) {
      rows.push({
        rowType: 'JV',
        id: j.id,
        name: j.journalNumber,
        type: 'JOURNAL_VOUCHER',
        date: j.entryDate,
        customerName: j.description || j.reference || '',
        subtotal: ROUND(j.totalDebit),
        taxAmount: 0,
        totalAmount: ROUND(j.totalDebit),
        status: j.status === 'DRAFT' ? 'draft-jv' : 'unconfirmed',
        glPosting: null,
        source: 'manual-jv',
        ingestBatch: null,
        createdAt: j.entryDate,
        items: [],
      });
    }

    return { total: total + jvs.length, page, limit, rows };
  }

  private shapeRow(d: { id: string; name: string | null; type?: string; status: string; config: any; createdAt: Date }) {
    const c = (d.config || {}) as any;
    const items = Array.isArray(c.items) ? c.items : [];
    return {
      rowType: 'DOC',
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
        await this.confirmAfterPost(organizationId, documentId, doc.type);
        return { documentId, invoiceNumber, ok: true, skipped: true, journalEntryId: already.id };
      }

      // Bills confirm through their own service (flips status + tag when a
      // save-posted JE exists, else posts confirmed).
      if (doc.type === 'BILL') {
        const bill = await this.bills.post(organizationId, documentId, userId);
        return { documentId, invoiceNumber, ok: true, journalEntryId: (bill as any).journalEntryId ?? undefined };
      }
      // Receipts are save-posted at creation — if the journal is missing,
      // the receipt needs a re-save, not a queue post.
      if (doc.type === 'OFFICIAL_RECEIPT') {
        return { documentId, invoiceNumber, ok: false, error: 'Receipt has no journal — open it and Save, then post from the queue' };
      }

      const entryDate = c.date ? new Date(c.date) : new Date();

      // Debit notes post via the DN auto-post path.
      if (doc.type === 'DEBIT_NOTE') {
        const entry = await this.autoPost.postFromDebitNote({
          organizationId,
          documentId,
          documentNumber: invoiceNumber,
          entryDate,
          customerName: c.customer?.name,
          netAmount: ROUND(c.subTotal),
          taxAmount: ROUND(c.gstAmount),
          grossAmount: ROUND(c.nettTotal),
          userId,
        } as any);
        if (!entry) {
          return { documentId, invoiceNumber, ok: false, error: 'Debit-note post skipped (accounts not configured)' };
        }
        await this.stampPosted(documentId, c, (entry as any).id, userId);
        await this.confirmAfterPost(organizationId, documentId, doc.type);
        return { documentId, invoiceNumber, ok: true, journalEntryId: (entry as any).id };
      }

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
        await this.confirmAfterPost(organizationId, documentId, doc.type);
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
      await this.confirmAfterPost(organizationId, documentId, doc.type);
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
      where: { id: documentId, organizationId, type: { in: ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'BILL', 'OFFICIAL_RECEIPT'] } },
      select: { id: true, name: true, type: true, config: true, status: true },
    });
    if (!doc) throw new NotFoundException('Invoice not found in this organization');
    return doc;
  }

  // guru 2026-07-24: posting from the queue IS the confirmation — the invoice
  // moves to Awaiting Payment (pending_payment), credit notes to confirmed,
  // and the journal loses its unconfirmed tag in the same action.
  private async confirmAfterPost(organizationId: string, documentId: string, type: string) {
    // Invoices await payment; CN/DN/receipts end at confirmed. Bills are
    // handled by bills.post (POSTED) before reaching here.
    const status = type === 'INVOICE' ? 'pending_payment' : 'confirmed';
    await this.prisma.document.update({ where: { id: documentId }, data: { status: status as any } }).catch(() => undefined);
    await this.journal.markConfirmedForDocument(organizationId, documentId).catch(() => undefined);
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
