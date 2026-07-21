import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { JournalAutoPostService } from '../journal/journal-auto-post.service';
import { JournalService } from '../journal/journal.service';
import { PaymentsService } from '../payments/payments.service';
import { AuditService } from 'src/common/audit.service';

const ROUND = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Official Receipts (legacy-UX overhaul, 2026-07-15).
// A receipt is a Document row (type OFFICIAL_RECEIPT — the Document table is
// canonical) whose config carries the header + allocations. Each allocation
// creates a normal Payment row tagged receiptId (so invoice status/outstanding
// and every AR report keep working), but the GL side is ONE journal per
// receipt (Dr bank / Cr debtors per allocation + realised FX), reposted on
// every save. Balance must be zero: the receipt amount must be fully
// allocated (no customer-credit ledger yet — guru's call).
// ---------------------------------------------------------------------------

export type ReceiptAllocation = { documentId: string; amount: number };

export type SaveReceiptDto = {
  date: string;
  chequeNo?: string | null;
  remarks?: string | null;
  customerId: string;
  debitAccountCode: string; // deposit-to bank/cash
  currency?: string | null;
  rate?: number | null;
  receiptAmount: number;
  paymentMethod?: string | null;
  allocations: ReceiptAllocation[];
};

export type CreateOffsetDto = {
  customerId: string;
  date?: string;
  remarks?: string | null;
  updateFx?: boolean; // legacy "Update Exchange Gain/Loss Accounts" (default on)
  debits: ReceiptAllocation[]; // invoices settled
  credits: ReceiptAllocation[]; // credit notes consumed
};

type Actor = { id?: string; name?: string; email?: string };

@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journalAutoPost: JournalAutoPostService,
    private readonly journalService: JournalService,
    private readonly paymentsService: PaymentsService,
    private readonly auditService: AuditService,
  ) {}

  private logEvent(opts: { documentId: string; organizationId: string; action: string; detail: string; documentName?: string; actor?: Actor }) {
    return this.auditService.logAction({
      userId: opts.actor?.id || 'system',
      userName: opts.actor?.name,
      userEmail: opts.actor?.email,
      action: opts.action,
      resource: 'document',
      resourceId: opts.documentId,
      resourceName: opts.documentName,
      organizationId: opts.organizationId,
      details: { detail: opts.detail },
    });
  }

  // Thin shell template so the Document row satisfies its template relation
  // (same pattern as bills).
  private async getOrCreateReceiptTemplate(organizationId: string): Promise<string> {
    const existing = await this.prisma.documentTemplate.findFirst({
      where: { organizationId, type: 'OFFICIAL_RECEIPT' },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await this.prisma.documentTemplate.create({
      data: {
        organizationId,
        type: 'OFFICIAL_RECEIPT',
        name: 'Official Receipt',
        config: {},
      } as any,
      select: { id: true },
    });
    return created.id;
  }

  private async nextReceiptNumber(organizationId: string): Promise<string> {
    const rows = await this.prisma.document.findMany({
      where: { organizationId, type: 'OFFICIAL_RECEIPT', name: { startsWith: 'OR-' } },
      select: { name: true },
    });
    let max = 0;
    for (const r of rows) {
      const m = /^OR-(\d+)$/.exec(r.name || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `OR-${String(max + 1).padStart(6, '0')}`;
  }

  private toReceipt(doc: any) {
    const c: any = doc.config || {};
    return {
      id: doc.id,
      receiptNumber: doc.name,
      status: doc.status,
      date: c.date || null,
      chequeNo: c.chequeNo || null,
      remarks: c.remarks || null,
      customerId: c.customerId || null,
      customerName: c.customerName || null,
      creditAccountCode: c.creditAccountCode || null,
      debitAccountCode: c.debitAccountCode || null,
      currency: c.currency || 'SGD',
      rate: Number(c.rate) || 1,
      receiptAmount: Number(c.receiptAmount) || 0,
      paymentMethod: c.paymentMethod || 'transfer',
      allocations: Array.isArray(c.allocations) ? c.allocations : [],
      journalNumber: c.journalNumber || null,
      // The document-editor page needs the template id (Locate filters by it)
      // and the save-tracking stamps for the Unconfirmed User / Last Used strip.
      documentTemplateId: doc.documentTemplateId || null,
      savedBy: c.savedBy || null,
      savedAt: c.savedAt || null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  async create(organizationId: string, actor?: Actor) {
    const [templateId, number, setting] = await Promise.all([
      this.getOrCreateReceiptTemplate(organizationId),
      this.nextReceiptNumber(organizationId),
      this.prisma.accountingSetting.findUnique({ where: { organizationId }, select: { controlAccounts: true, baseCurrency: true } }),
    ]);
    const controls = (setting?.controlAccounts as any) || {};
    const doc = await this.prisma.document.create({
      data: {
        organizationId,
        documentTemplateId: templateId,
        type: 'OFFICIAL_RECEIPT',
        name: number,
        status: 'draft',
        config: {
          date: new Date().toISOString().slice(0, 10),
          chequeNo: null,
          remarks: '',
          customerId: null,
          creditAccountCode: controls.debtorControl || null, // read-only in UI
          debitAccountCode: null,
          currency: setting?.baseCurrency || 'SGD',
          rate: 1,
          receiptAmount: 0,
          paymentMethod: 'transfer',
          allocations: [],
        } as any,
      },
    });
    void this.logEvent({
      documentId: doc.id,
      organizationId,
      action: 'CREATED',
      detail: `Official Receipt ${number} created`,
      documentName: number,
      actor,
    });
    return this.toReceipt(doc);
  }

  async list(organizationId: string) {
    const docs = await this.prisma.document.findMany({
      where: { organizationId, type: 'OFFICIAL_RECEIPT' },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return docs.map((d) => this.toReceipt(d));
  }

  async getById(organizationId: string, id: string) {
    const doc = await this.prisma.document.findFirst({ where: { id, organizationId, type: 'OFFICIAL_RECEIPT' } });
    if (!doc) throw new NotFoundException('Receipt not found');
    return this.toReceipt(doc);
  }

  // Unpaid invoices for the allocation grid: outstanding = gross − payments
  // (xeroBalance-aware, same rule as the AR reports). Excludes never-posted
  // legacy drafts; includes saved (posted) documents.
  async openInvoices(organizationId: string, customerId: string, opts?: { excludeReceiptId?: string }) {
    const [docs, postedJes] = await Promise.all([
      this.prisma.document.findMany({
        where: {
          organizationId,
          type: { in: ['INVOICE', 'TI', 'TI2'] },
          OR: [
            { config: { path: ['customerId'], equals: customerId } },
            { config: { path: ['customer', 'id'], equals: customerId } },
          ],
        },
        select: { id: true, name: true, status: true, createdAt: true, config: true },
      }),
      this.prisma.journalEntry.findMany({
        where: { organizationId, status: { not: 'VOID' }, type: 'INVOICE', sourceDocumentId: { not: null } },
        select: { sourceDocumentId: true },
      }),
    ]);
    const posted = new Set(postedJes.map((j) => j.sourceDocumentId as string));

    const ids = docs.map((d) => d.id);
    const pays = ids.length
      ? await this.prisma.payment.findMany({
          where: { organizationId, documentId: { in: ids } },
          select: { documentId: true, amount: true, receiptId: true },
        })
      : [];
    const paidByDoc = new Map<string, number>();
    // This receipt's own prior allocations tracked separately: when editing,
    // they must be ADDED BACK to a live xeroBalance (which already nets them).
    const ownByDoc = new Map<string, number>();
    for (const p of pays) {
      if (opts?.excludeReceiptId && p.receiptId === opts.excludeReceiptId) {
        ownByDoc.set(p.documentId, ROUND((ownByDoc.get(p.documentId) || 0) + (Number(p.amount) || 0)));
        continue;
      }
      paidByDoc.set(p.documentId, ROUND((paidByDoc.get(p.documentId) || 0) + (Number(p.amount) || 0)));
    }

    const rows: Array<{ documentId: string; reference: string; date: string | null; remarks: string; gross: number; outstanding: number; currency: string | null }> = [];
    for (const d of docs) {
      const c: any = d.config || {};
      if (c.voided) continue;
      const status = (d.status || '').toLowerCase();
      if (status === 'cancelled') continue;
      if (status === 'draft' && !posted.has(d.id) && !c.xeroImported) continue;
      const di: any = c.documentInfo || {};
      const tax = Number(di.gstAmount ?? c.taxAmount ?? c.xeroTax ?? 0) || 0;
      let gross = Number(c.xeroGross ?? di.nettTotal ?? c.nettTotal ?? c.totalAmount ?? NaN);
      if (!Number.isFinite(gross)) {
        const itemsSum = (c.items || []).reduce(
          (s: number, it: any) => s + (parseFloat(it.amount) || parseFloat(it.quantity) * parseFloat(it.unitPrice) || 0),
          0,
        );
        const inclusive = di.absorbTax === 'Y' || di.absorbTax === true;
        gross = inclusive ? itemsSum : ROUND(itemsSum + tax);
      }
      gross = ROUND(gross);
      const recorded = paidByDoc.get(d.id) || 0;
      const own = ownByDoc.get(d.id) || 0;
      let outstanding: number;
      if (c.xeroBalance !== undefined && c.xeroBalance !== null) {
        // xeroBalance is LIVE (net of all payments incl. this receipt's own
        // rows) — add this receipt's own allocations back so the edit grid
        // shows what's allocatable by THIS receipt.
        outstanding = ROUND(Math.max(0, Number(c.xeroBalance) + own));
      } else {
        outstanding = ROUND(Math.max(0, gross - recorded));
      }
      if (outstanding <= 0.005) continue;
      rows.push({
        documentId: d.id,
        reference: d.name || '(no #)',
        date: c.date ? String(c.date).slice(0, 10) : null,
        remarks: 'INVOICE',
        gross,
        outstanding,
        currency: di.currency || c.currency || null,
      });
    }
    rows.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || a.reference.localeCompare(b.reference));
    return rows;
  }

  // Save = validate, replace allocation Payment rows, repost the single
  // journal, refresh each touched invoice's status. Balance must be zero.
  async save(organizationId: string, id: string, dto: SaveReceiptDto, actor?: Actor) {
    const doc = await this.prisma.document.findFirst({ where: { id, organizationId, type: 'OFFICIAL_RECEIPT' } });
    if (!doc) throw new NotFoundException('Receipt not found');

    if (!dto.customerId) throw new BadRequestException('Customer is required');
    if (!dto.debitAccountCode) throw new BadRequestException('Deposit-to (debit) account is required');
    const receiptAmount = ROUND(Number(dto.receiptAmount) || 0);
    if (receiptAmount <= 0) throw new BadRequestException('Receipt amount must be greater than zero');
    const allocations = (dto.allocations || [])
      .map((a) => ({ documentId: a.documentId, amount: ROUND(Number(a.amount) || 0) }))
      .filter((a) => a.documentId && a.amount > 0);
    if (!allocations.length) throw new BadRequestException('Allocate the receipt to at least one invoice');
    const offset = ROUND(allocations.reduce((s, a) => s + a.amount, 0));
    if (Math.abs(offset - receiptAmount) > 0.005) {
      throw new BadRequestException(
        `Receipt must be fully allocated — received ${receiptAmount.toFixed(2)}, allocated ${offset.toFixed(2)} (balance ${(receiptAmount - offset).toFixed(2)})`,
      );
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, organizationId },
      select: { id: true, name: true },
    });
    if (!customer) throw new BadRequestException('Customer not found');

    // Per-invoice cap: allocation ≤ outstanding (this receipt's own prior rows excluded).
    const open = await this.openInvoices(organizationId, dto.customerId, { excludeReceiptId: id });
    const openById = new Map(open.map((o) => [o.documentId, o]));
    for (const a of allocations) {
      const inv = openById.get(a.documentId);
      if (!inv) throw new BadRequestException('An allocated invoice is not open for this customer');
      if (a.amount > inv.outstanding + 0.005) {
        throw new BadRequestException(`Allocation to ${inv.reference} (${a.amount.toFixed(2)}) exceeds its outstanding ${inv.outstanding.toFixed(2)}`);
      }
    }

    const previous = await this.prisma.payment.findMany({
      where: { organizationId, receiptId: id },
      select: { id: true, documentId: true },
    });
    const touched = new Set<string>([...previous.map((p) => p.documentId), ...allocations.map((a) => a.documentId)]);

    // Replace allocation rows atomically.
    await this.prisma.$transaction(async (tx) => {
      if (previous.length) await tx.payment.deleteMany({ where: { organizationId, receiptId: id } });
      for (const a of allocations) {
        await tx.payment.create({
          data: {
            organizationId,
            customerId: dto.customerId,
            documentId: a.documentId,
            amount: a.amount,
            paymentDate: new Date(dto.date),
            paymentMethod: dto.paymentMethod || 'transfer',
            reference: doc.name || undefined,
            notes: dto.remarks || undefined,
            receiptId: id,
            createdBy: actor?.id || 'system',
          },
        });
      }
      await tx.document.update({
        where: { id },
        data: {
          config: {
            ...((doc.config as any) || {}),
            date: dto.date,
            chequeNo: dto.chequeNo || null,
            remarks: dto.remarks || null,
            customerId: customer.id,
            customerName: customer.name,
            debitAccountCode: dto.debitAccountCode,
            currency: (dto.currency || 'SGD').toUpperCase(),
            rate: Number(dto.rate) || 1,
            receiptAmount,
            paymentMethod: dto.paymentMethod || 'transfer',
            // Store display fields alongside each allocation so a saved
            // receipt re-renders (view / preview / print) without refetching.
            allocations: allocations.map((a) => {
              const inv = openById.get(a.documentId);
              return { ...a, reference: inv?.reference ?? null, date: inv?.date ?? null, description: inv?.remarks ?? 'INVOICE' };
            }),
            savedBy: actor?.name || actor?.email || actor?.id || 'system',
            savedAt: new Date().toISOString(),
          } as any,
        },
      });
    });

    // ONE journal for the receipt (void + repost inside).
    const entry = await this.journalAutoPost.postFromReceipt({
      organizationId,
      receiptDocumentId: id,
      receiptNumber: doc.name,
      entryDate: new Date(dto.date),
      customerName: customer.name,
      bankAccountCode: dto.debitAccountCode,
      currency: dto.currency || 'SGD',
      rate: dto.rate || 1,
      amount: receiptAmount,
      allocations,
      userId: actor?.id,
    });
    if (entry) {
      await this.prisma.document.update({
        where: { id },
        data: { config: { ...((await this.prisma.document.findUnique({ where: { id }, select: { config: true } }))?.config as any), journalNumber: entry.journalNumber } as any },
      });
    }

    // Refresh invoice statuses / outstanding for every touched invoice.
    for (const documentId of touched) {
      try {
        await this.paymentsService.updateInvoiceStatusAfterPayment(documentId, organizationId);
      } catch (e) {
        console.error('Receipt save: status refresh failed for', documentId, e);
      }
    }

    void this.logEvent({
      documentId: id,
      organizationId,
      action: 'EDITED',
      detail: `Receipt saved — ${receiptAmount.toFixed(2)} allocated across ${allocations.length} invoice(s)${entry ? `; ${entry.journalNumber} posted` : ''}`,
      documentName: doc.name || undefined,
      actor,
    });

    return this.getById(organizationId, id);
  }

  async remove(organizationId: string, id: string, actor?: Actor) {
    const doc = await this.prisma.document.findFirst({ where: { id, organizationId, type: 'OFFICIAL_RECEIPT' } });
    // Idempotent: closing the editor can race a backdrop-close double-DELETE —
    // an already-deleted receipt is a success, not an error.
    if (!doc) return { ok: true };

    const existingJe = await this.prisma.journalEntry.findFirst({
      where: { organizationId, sourceDocumentId: id, type: 'PAYMENT', status: { not: 'VOID' } },
      select: { id: true },
    });
    if (existingJe) await this.journalService.void(organizationId, existingJe.id, actor?.id);

    const previous = await this.prisma.payment.findMany({
      where: { organizationId, receiptId: id },
      select: { documentId: true },
    });
    await this.prisma.payment.deleteMany({ where: { organizationId, receiptId: id } });
    // deleteMany: no P2025 when a concurrent close already removed the row.
    await this.prisma.document.deleteMany({ where: { id, organizationId } });

    for (const p of previous) {
      try {
        await this.paymentsService.updateInvoiceStatusAfterPayment(p.documentId, organizationId);
      } catch (e) {
        console.error('Receipt delete: status refresh failed for', p.documentId, e);
      }
    }
    return { ok: true };
  }

  // =========================================================================
  // Manual Offset (legacy AR, 2026-07-20): knock a customer's open CREDIT
  // NOTES off against their open INVOICES with no cash movement. The offset
  // is a Document row (type MANUAL_OFFSET, MO-######); each matched side
  // creates a Payment row (method 'offset', receiptId = the MO doc) so the
  // existing status/outstanding machinery consumes both. GL: nothing to post
  // unless historical base values differ — then one FX-difference journal.
  // =========================================================================

  private async getOrCreateOffsetTemplate(organizationId: string): Promise<string> {
    const existing = await this.prisma.documentTemplate.findFirst({
      where: { organizationId, type: 'MANUAL_OFFSET' },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await this.prisma.documentTemplate.create({
      data: { organizationId, type: 'MANUAL_OFFSET', name: 'Manual Offset', config: {} } as any,
      select: { id: true },
    });
    return created.id;
  }

  private async nextOffsetNumber(organizationId: string): Promise<string> {
    const rows = await this.prisma.document.findMany({
      where: { organizationId, type: 'MANUAL_OFFSET', name: { startsWith: 'MO-' } },
      select: { name: true },
    });
    let max = 0;
    for (const r of rows) {
      const m = /^MO-(\d+)$/.exec(r.name || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `MO-${String(max + 1).padStart(6, '0')}`;
  }

  /** Customer's open credit notes — same outstanding semantics as openInvoices. */
  async openCreditNotes(organizationId: string, customerId: string) {
    const docs = await this.prisma.document.findMany({
      where: {
        organizationId,
        type: { in: ['CN', 'CREDIT_NOTE'] },
        OR: [
          { config: { path: ['customerId'], equals: customerId } },
          { config: { path: ['customer', 'id'], equals: customerId } },
        ],
      },
      select: { id: true, name: true, status: true, config: true },
    });
    const ids = docs.map((d) => d.id);
    const [postedJes, pays] = await Promise.all([
      ids.length
        ? this.prisma.journalEntry.findMany({
            where: { organizationId, status: { not: 'VOID' }, sourceDocumentId: { in: ids } },
            select: { sourceDocumentId: true },
          })
        : Promise.resolve([] as Array<{ sourceDocumentId: string | null }>),
      ids.length
        ? this.prisma.payment.findMany({
            where: { organizationId, documentId: { in: ids } },
            select: { documentId: true, amount: true },
          })
        : Promise.resolve([] as Array<{ documentId: string; amount: any }>),
    ]);
    const posted = new Set(postedJes.map((j) => j.sourceDocumentId as string));
    const appliedByDoc = new Map<string, number>();
    for (const p of pays) {
      appliedByDoc.set(p.documentId, ROUND((appliedByDoc.get(p.documentId) || 0) + (Number(p.amount) || 0)));
    }
    const rows: Array<{ documentId: string; reference: string; date: string | null; remarks: string; gross: number; outstanding: number; currency: string | null }> = [];
    for (const d of docs) {
      const c: any = d.config || {};
      if (c.voided) continue;
      const status = (d.status || '').toLowerCase();
      if (status === 'cancelled') continue;
      if (status === 'draft' && !posted.has(d.id) && !c.xeroImported) continue;
      const di: any = c.documentInfo || {};
      const tax = Number(di.gstAmount ?? c.taxAmount ?? c.xeroTax ?? 0) || 0;
      let gross = Number(c.xeroGross ?? di.nettTotal ?? c.nettTotal ?? c.totalAmount ?? NaN);
      if (!Number.isFinite(gross)) {
        const itemsSum = (c.items || []).reduce(
          (s: number, it: any) => s + (parseFloat(it.amount) || parseFloat(it.quantity) * parseFloat(it.unitPrice) || 0),
          0,
        );
        const inclusive = di.absorbTax === 'Y' || di.absorbTax === true;
        gross = inclusive ? itemsSum : ROUND(itemsSum + tax);
      }
      gross = ROUND(Math.abs(gross));
      const applied = appliedByDoc.get(d.id) || 0;
      let outstanding: number;
      if (c.xeroBalance !== undefined && c.xeroBalance !== null) {
        outstanding = ROUND(Math.max(0, Math.abs(Number(c.xeroBalance))));
      } else {
        outstanding = ROUND(Math.max(0, gross - applied));
      }
      if (outstanding <= 0.005) continue;
      rows.push({
        documentId: d.id,
        reference: d.name || '(no #)',
        date: c.date ? String(c.date).slice(0, 10) : null,
        remarks: 'CREDIT NOTE',
        gross,
        outstanding,
        currency: di.currency || c.currency || null,
      });
    }
    rows.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || a.reference.localeCompare(b.reference));
    return rows;
  }

  /** Both grids for the Manual Offset screen. */
  async offsetItems(organizationId: string, customerId: string) {
    const [debits, credits] = await Promise.all([
      this.openInvoices(organizationId, customerId),
      this.openCreditNotes(organizationId, customerId),
    ]);
    return { debits, credits };
  }

  async createOffset(organizationId: string, dto: CreateOffsetDto, actor?: Actor) {
    if (!dto.customerId) throw new BadRequestException('Customer is required');
    const debits = (dto.debits || [])
      .map((a) => ({ documentId: a.documentId, amount: ROUND(Number(a.amount) || 0) }))
      .filter((a) => a.documentId && a.amount > 0);
    const credits = (dto.credits || [])
      .map((a) => ({ documentId: a.documentId, amount: ROUND(Number(a.amount) || 0) }))
      .filter((a) => a.documentId && a.amount > 0);
    if (!debits.length || !credits.length) throw new BadRequestException('Tick at least one entry on each side');
    const drTotal = ROUND(debits.reduce((s, a) => s + a.amount, 0));
    const crTotal = ROUND(credits.reduce((s, a) => s + a.amount, 0));
    if (Math.abs(drTotal - crTotal) > 0.005) {
      throw new BadRequestException(
        `Offset must balance — debits ${drTotal.toFixed(2)} vs credits ${crTotal.toFixed(2)} (balance ${(drTotal - crTotal).toFixed(2)})`,
      );
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, organizationId },
      select: { id: true, name: true },
    });
    if (!customer) throw new BadRequestException('Customer not found');

    const { debits: openDebits, credits: openCredits } = await this.offsetItems(organizationId, dto.customerId);
    const debitById = new Map(openDebits.map((o) => [o.documentId, o]));
    const creditById = new Map(openCredits.map((o) => [o.documentId, o]));
    for (const a of debits) {
      const inv = debitById.get(a.documentId);
      if (!inv) throw new BadRequestException('A ticked invoice is not open for this customer');
      if (a.amount > inv.outstanding + 0.005) {
        throw new BadRequestException(`Offset of ${inv.reference} (${a.amount.toFixed(2)}) exceeds its outstanding ${inv.outstanding.toFixed(2)}`);
      }
    }
    for (const a of credits) {
      const cn = creditById.get(a.documentId);
      if (!cn) throw new BadRequestException('A ticked credit note is not open for this customer');
      if (a.amount > cn.outstanding + 0.005) {
        throw new BadRequestException(`Offset of ${cn.reference} (${a.amount.toFixed(2)}) exceeds its remaining ${cn.outstanding.toFixed(2)}`);
      }
    }

    const [templateId, number] = await Promise.all([
      this.getOrCreateOffsetTemplate(organizationId),
      this.nextOffsetNumber(organizationId),
    ]);
    const date = dto.date || new Date().toISOString().slice(0, 10);
    const enrich = (a: { documentId: string; amount: number }, m: Map<string, any>) => {
      const o = m.get(a.documentId);
      return { ...a, reference: o?.reference ?? null, date: o?.date ?? null, currency: o?.currency ?? null };
    };

    const offsetDoc = await this.prisma.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: {
          organizationId,
          documentTemplateId: templateId,
          type: 'MANUAL_OFFSET',
          name: number,
          status: 'confirmed',
          config: {
            date,
            customerId: customer.id,
            customerName: customer.name,
            remarks: dto.remarks || null,
            debits: debits.map((a) => enrich(a, debitById)),
            credits: credits.map((a) => enrich(a, creditById)),
            amount: drTotal,
            savedBy: actor?.name || actor?.email || actor?.id || 'system',
            savedAt: new Date().toISOString(),
          } as any,
        },
      });
      for (const a of [...debits.map((x) => ({ ...x })), ...credits.map((x) => ({ ...x }))]) {
        await tx.payment.create({
          data: {
            organizationId,
            customerId: customer.id,
            documentId: a.documentId,
            amount: a.amount,
            paymentDate: new Date(date),
            paymentMethod: 'offset',
            reference: number,
            notes: dto.remarks || `Manual Offset ${number}`,
            receiptId: created.id,
            createdBy: actor?.id || 'system',
          },
        });
      }
      return created;
    });

    // FX-difference journal (posts only when historical base values differ).
    let journalNumber: string | null = null;
    if (dto.updateFx !== false) {
      const entry = await this.journalAutoPost.postFromManualOffset({
        organizationId,
        offsetDocumentId: offsetDoc.id,
        offsetNumber: number,
        entryDate: new Date(date),
        customerName: customer.name,
        debits: debits.map((a) => enrich(a, debitById)),
        credits: credits.map((a) => enrich(a, creditById)),
        userId: actor?.id,
      });
      if (entry) {
        journalNumber = (entry as any).journalNumber || null;
        await this.prisma.document.update({
          where: { id: offsetDoc.id },
          data: { config: { ...((offsetDoc.config as any) || {}), journalNumber } as any },
        });
      }
    }

    for (const a of [...debits, ...credits]) {
      try {
        await this.paymentsService.updateInvoiceStatusAfterPayment(a.documentId, organizationId);
      } catch (e) {
        console.error('Offset: status refresh failed for', a.documentId, e);
      }
    }

    void this.logEvent({
      documentId: offsetDoc.id,
      organizationId,
      action: 'CREATED',
      detail: `Manual Offset ${number} — ${drTotal.toFixed(2)} offset across ${debits.length} invoice(s) and ${credits.length} credit note(s)${journalNumber ? `; FX ${journalNumber} posted` : ''}`,
      documentName: number,
      actor,
    });
    for (const a of debits) {
      const o = debitById.get(a.documentId);
      void this.logEvent({
        documentId: a.documentId,
        organizationId,
        action: 'EDITED',
        detail: `Offset ${a.amount.toFixed(2)} by Manual Offset ${number}`,
        documentName: o?.reference || undefined,
        actor,
      });
    }
    for (const a of credits) {
      const o = creditById.get(a.documentId);
      void this.logEvent({
        documentId: a.documentId,
        organizationId,
        action: 'EDITED',
        detail: `Applied ${a.amount.toFixed(2)} via Manual Offset ${number}`,
        documentName: o?.reference || undefined,
        actor,
      });
    }

    return { id: offsetDoc.id, number, amount: drTotal, journalNumber };
  }

  async removeOffset(organizationId: string, id: string, actor?: Actor) {
    const doc = await this.prisma.document.findFirst({ where: { id, organizationId, type: 'MANUAL_OFFSET' } });
    if (!doc) return { ok: true };
    const existingJe = await this.prisma.journalEntry.findFirst({
      where: { organizationId, sourceDocumentId: id, status: { not: 'VOID' } },
      select: { id: true },
    });
    if (existingJe) await this.journalService.void(organizationId, existingJe.id, actor?.id);
    const previous = await this.prisma.payment.findMany({
      where: { organizationId, receiptId: id },
      select: { documentId: true },
    });
    await this.prisma.payment.deleteMany({ where: { organizationId, receiptId: id } });
    await this.prisma.document.deleteMany({ where: { id, organizationId } });
    for (const p of previous) {
      try {
        await this.paymentsService.updateInvoiceStatusAfterPayment(p.documentId, organizationId);
      } catch (e) {
        console.error('Offset delete: status refresh failed for', p.documentId, e);
      }
    }
    return { ok: true };
  }
}
