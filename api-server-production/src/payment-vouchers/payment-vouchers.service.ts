import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { JournalAutoPostService } from '../journal/journal-auto-post.service';
import { JournalService } from '../journal/journal.service';
import { BillsService } from '../bills/bills.service';
import { AuditService } from 'src/common/audit.service';
import { outstandingOf, grossStampOf } from '../common/document-money';

const ROUND = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Payment Vouchers (legacy AP, guru 2026-10-21) — the Official Receipt's twin.
// A voucher is a Document row (type PAYMENT_VOUCHER, PV-######) whose config
// carries the header + allocations. Each allocation creates a normal
// BillPayment row (so bill status/outstanding, the P/V Listing, the AP home
// and bank rec all keep working) and the GL side is ONE journal per voucher
// (Dr creditors per allocation / Cr bank + realised FX), reposted on every
// save. The voucher's BillPayment rows are linked through that journal
// (BillPayment.journalEntryId ∈ the voucher's journals) — no schema change.
// Balance must be zero: the voucher must be fully allocated to bills.
// ---------------------------------------------------------------------------

export type VoucherAllocation = { documentId: string; amount: number };

export type SaveVoucherDto = {
  date: string;
  chequeNo?: string | null;
  remarks?: string | null;
  supplierId: string;
  creditAccountCode: string; // paid-from bank/cash
  debitAccountCode?: string | null; // creditor control (default from settings)
  currency?: string | null;
  rate?: number | null;
  voucherAmount: number;
  paymentMethod?: string | null;
  allocations: VoucherAllocation[];
};

type Actor = { id?: string; name?: string; email?: string };

@Injectable()
export class PaymentVouchersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journalAutoPost: JournalAutoPostService,
    private readonly journalService: JournalService,
    private readonly bills: BillsService,
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

  private async getOrCreateTemplate(organizationId: string): Promise<string> {
    const existing = await this.prisma.documentTemplate.findFirst({
      where: { organizationId, type: 'PAYMENT_VOUCHER' },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await this.prisma.documentTemplate.create({
      data: { organizationId, type: 'PAYMENT_VOUCHER', name: 'Payment Voucher', config: {} } as any,
      select: { id: true },
    });
    return created.id;
  }

  private async nextVoucherNumber(organizationId: string): Promise<string> {
    const rows = await this.prisma.document.findMany({
      where: { organizationId, type: 'PAYMENT_VOUCHER', name: { startsWith: 'PV-' } },
      select: { name: true },
    });
    let max = 0;
    for (const r of rows) {
      const m = /^PV-(\d+)$/.exec(r.name || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `PV-${String(max + 1).padStart(6, '0')}`;
  }

  private toVoucher(doc: any) {
    const c: any = doc.config || {};
    return {
      id: doc.id,
      voucherNumber: doc.name,
      status: doc.status,
      date: c.date || null,
      chequeNo: c.chequeNo || null,
      remarks: c.remarks || null,
      supplierId: c.supplierId || null,
      supplierName: c.supplierName || null,
      supplierCode: c.supplierCode || null,
      debitAccountCode: c.debitAccountCode || null,
      creditAccountCode: c.creditAccountCode || null,
      currency: c.currency || 'SGD',
      rate: Number(c.rate) || 1,
      voucherAmount: Number(c.voucherAmount) || 0,
      paymentMethod: c.paymentMethod || 'transfer',
      allocations: Array.isArray(c.allocations) ? c.allocations : [],
      journalNumber: c.journalNumber || null,
      documentTemplateId: doc.documentTemplateId || null,
      savedBy: c.savedBy || null,
      savedAt: c.savedAt || null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  async create(organizationId: string, actor?: Actor) {
    const [templateId, number, setting] = await Promise.all([
      this.getOrCreateTemplate(organizationId),
      this.nextVoucherNumber(organizationId),
      this.prisma.accountingSetting.findUnique({ where: { organizationId }, select: { controlAccounts: true, baseCurrency: true } }),
    ]);
    const controls = (setting?.controlAccounts as any) || {};
    const doc = await this.prisma.document.create({
      data: {
        organizationId,
        documentTemplateId: templateId,
        type: 'PAYMENT_VOUCHER',
        name: number,
        status: 'unconfirmed',
        config: {
          date: new Date().toISOString().slice(0, 10),
          chequeNo: null,
          remarks: '',
          supplierId: null,
          debitAccountCode: controls.creditorControl || 'CL001', // default; selectable in UI
          creditAccountCode: null,
          currency: setting?.baseCurrency || 'SGD',
          rate: 1,
          voucherAmount: 0,
          paymentMethod: 'transfer',
          allocations: [],
        } as any,
      },
    });
    void this.logEvent({ documentId: doc.id, organizationId, action: 'CREATED', detail: `Payment Voucher ${number} created`, documentName: number, actor });
    return this.toVoucher(doc);
  }

  async list(organizationId: string) {
    const docs = await this.prisma.document.findMany({
      where: { organizationId, type: 'PAYMENT_VOUCHER' },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return docs.map((d) => this.toVoucher(d));
  }

  async getById(organizationId: string, id: string) {
    const doc = await this.prisma.document.findFirst({ where: { id, organizationId, type: 'PAYMENT_VOUCHER' } });
    if (!doc) throw new NotFoundException('Payment voucher not found');
    return this.toVoucher(doc);
  }

  /** Journal ids ever posted for this voucher (incl. voided) — the BillPayment link key. */
  private async voucherJournalIds(organizationId: string, voucherId: string): Promise<string[]> {
    const jes = await this.prisma.journalEntry.findMany({
      where: { organizationId, sourceDocumentId: voucherId, type: 'PAYMENT' },
      select: { id: true },
    });
    return jes.map((j) => j.id);
  }

  // Unpaid bills for the allocation grid: outstanding = total − payments,
  // stamped-balance aware (same rule as the AP reports). Only payable bills
  // (POSTED / AUTHORISED) — drafts and voids never appear.
  async openBills(organizationId: string, supplierId: string, opts?: { excludeVoucherId?: string }) {
    const docs = await this.prisma.document.findMany({
      where: {
        organizationId,
        type: 'BILL',
        OR: [
          { config: { path: ['supplierId'], equals: supplierId } },
          { config: { path: ['supplier', 'id'], equals: supplierId } },
        ],
      },
      select: { id: true, name: true, type: true, documentTemplateId: true, status: true, createdAt: true, config: true },
    });
    const ids = docs.map((d) => d.id);
    const ownJournalIds = opts?.excludeVoucherId ? await this.voucherJournalIds(organizationId, opts.excludeVoucherId) : [];
    const pays = ids.length
      ? await this.prisma.billPayment.findMany({
          where: { organizationId, billId: { in: ids } },
          select: { billId: true, amount: true, journalEntryId: true },
        })
      : [];
    const paidByBill = new Map<string, number>();
    // This voucher's own prior rows tracked separately: when editing, they are
    // ADDED BACK to a live stamped balance (which already nets them).
    const ownByBill = new Map<string, number>();
    for (const p of pays) {
      if (p.journalEntryId && ownJournalIds.includes(p.journalEntryId)) {
        ownByBill.set(p.billId, ROUND((ownByBill.get(p.billId) || 0) + (Number(p.amount) || 0)));
        continue;
      }
      paidByBill.set(p.billId, ROUND((paidByBill.get(p.billId) || 0) + (Number(p.amount) || 0)));
    }

    const rows: Array<{ documentId: string; reference: string; type: string; templateId: string | null; date: string | null; remarks: string; gross: number; outstanding: number; currency: string | null }> = [];
    for (const d of docs) {
      const c: any = d.config || {};
      if (c.voided) continue;
      const billStatus = String(c.billStatus || '').toUpperCase();
      const xs = String(c.xeroStatus || '');
      const docStatus = String(d.status || '').toLowerCase();
      if (billStatus === 'VOID' || billStatus === 'DRAFT' || billStatus === 'PENDING_APPROVAL') continue;
      if (xs === 'Voided' || xs === 'Deleted' || xs === 'Draft' || docStatus === 'cancelled') continue;
      if (!billStatus && !xs && (docStatus === 'draft' || docStatus === 'unconfirmed')) continue;
      const gross = ROUND(Number(c.totalAmount ?? grossStampOf(c) ?? c.nettTotal ?? 0) || 0);
      if (gross <= 0) continue;
      const recorded = paidByBill.get(d.id) || 0;
      const own = ownByBill.get(d.id) || 0;
      const stamped = outstandingOf(c);
      const outstanding =
        stamped !== null && stamped !== undefined
          ? ROUND(Math.max(0, Number(stamped) + own))
          : ROUND(Math.max(0, gross - recorded));
      if (outstanding <= 0.005) continue;
      rows.push({
        documentId: d.id,
        reference: d.name || '(no #)',
        type: d.type,
        templateId: d.documentTemplateId ?? null,
        date: (c.billDate || c.date) ? String(c.billDate || c.date).slice(0, 10) : null,
        remarks: 'SUPPLIER INVOICE',
        gross,
        outstanding,
        currency: c.currency || c.documentInfo?.currency || null,
      });
    }
    rows.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || a.reference.localeCompare(b.reference));
    return rows;
  }

  // Save = validate, repost the single journal, replace the BillPayment rows
  // (linked to the new journal), refresh each touched bill. Balance must be 0.
  async save(organizationId: string, id: string, dto: SaveVoucherDto, actor?: Actor) {
    const doc = await this.prisma.document.findFirst({ where: { id, organizationId, type: 'PAYMENT_VOUCHER' } });
    if (!doc) throw new NotFoundException('Payment voucher not found');

    if (!dto.supplierId) throw new BadRequestException('Supplier is required');
    if (!dto.creditAccountCode) throw new BadRequestException('Paid-from (credit) account is required');
    const voucherAmount = ROUND(Number(dto.voucherAmount) || 0);
    if (voucherAmount <= 0) throw new BadRequestException('Voucher amount must be greater than zero');
    const allocations = (dto.allocations || [])
      .map((a) => ({ documentId: a.documentId, amount: ROUND(Number(a.amount) || 0) }))
      .filter((a) => a.documentId && a.amount > 0);
    if (!allocations.length) throw new BadRequestException('Allocate the voucher to at least one supplier invoice');
    const offset = ROUND(allocations.reduce((s, a) => s + a.amount, 0));
    if (Math.abs(offset - voucherAmount) > 0.005) {
      throw new BadRequestException(
        `Voucher must be fully allocated — paid ${voucherAmount.toFixed(2)}, allocated ${offset.toFixed(2)} (balance ${(voucherAmount - offset).toFixed(2)})`,
      );
    }

    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, organizationId },
      select: { id: true, name: true, supplierCode: true },
    });
    if (!supplier) throw new BadRequestException('Supplier not found');

    const bank = await this.prisma.chartOfAccount.findFirst({
      where: { organizationId, code: dto.creditAccountCode, isActive: true },
      select: { id: true, code: true, name: true },
    });
    if (!bank) throw new BadRequestException(`Paid-from account ${dto.creditAccountCode} not found`);

    // Per-bill cap: allocation ≤ outstanding (this voucher's own prior rows excluded).
    const open = await this.openBills(organizationId, dto.supplierId, { excludeVoucherId: id });
    const openById = new Map(open.map((o) => [o.documentId, o]));
    for (const a of allocations) {
      const bill = openById.get(a.documentId);
      if (!bill) throw new BadRequestException('An allocated supplier invoice is not open for this supplier');
      if (a.amount > bill.outstanding + 0.005) {
        throw new BadRequestException(`Allocation to ${bill.reference} (${a.amount.toFixed(2)}) exceeds its outstanding ${bill.outstanding.toFixed(2)}`);
      }
    }

    // Previous rows are found through the voucher's earlier journals (BEFORE
    // the repost voids them — voided journals still carry the link).
    const previousJournalIds = await this.voucherJournalIds(organizationId, id);
    const previous = previousJournalIds.length
      ? await this.prisma.billPayment.findMany({ where: { organizationId, journalEntryId: { in: previousJournalIds } }, select: { id: true, billId: true } })
      : [];
    const touched = new Set<string>([...previous.map((p) => p.billId), ...allocations.map((a) => a.documentId)]);

    // ONE journal for the voucher (void + repost inside). Required: the rows
    // link through it.
    const entry = await this.journalAutoPost.postFromPaymentVoucher({
      organizationId,
      voucherDocumentId: id,
      voucherNumber: doc.name,
      entryDate: new Date(dto.date),
      supplierName: supplier.name,
      bankAccountCode: dto.creditAccountCode,
      debitAccountCode: dto.debitAccountCode || null,
      currency: dto.currency || 'SGD',
      rate: dto.rate || 1,
      amount: voucherAmount,
      allocations,
      userId: actor?.id,
    });
    if (!entry) {
      throw new BadRequestException(
        'Could not post the voucher journal — check the creditor control, paid-from bank and FX gain/loss accounts in Accounting Setup',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      if (previous.length) await tx.billPayment.deleteMany({ where: { organizationId, id: { in: previous.map((p) => p.id) } } });
      for (const a of allocations) {
        await tx.billPayment.create({
          data: {
            organizationId,
            billId: a.documentId,
            supplierId: supplier.id,
            amount: a.amount,
            paymentDate: new Date(dto.date),
            paymentMethod: dto.paymentMethod || 'transfer',
            reference: doc.name || undefined,
            notes: dto.remarks || undefined,
            bankAccountId: bank.id,
            journalEntryId: entry.id,
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
            supplierId: supplier.id,
            supplierName: supplier.name,
            supplierCode: supplier.supplierCode || null,
            debitAccountCode: dto.debitAccountCode || (doc.config as any)?.debitAccountCode || null,
            creditAccountCode: dto.creditAccountCode,
            currency: (dto.currency || 'SGD').toUpperCase(),
            rate: Number(dto.rate) || 1,
            voucherAmount,
            paymentMethod: dto.paymentMethod || 'transfer',
            allocations: allocations.map((a) => {
              const b = openById.get(a.documentId);
              return { ...a, reference: b?.reference ?? null, date: b?.date ?? null, description: b?.remarks ?? 'SUPPLIER INVOICE' };
            }),
            journalNumber: entry.journalNumber,
            savedBy: actor?.name || actor?.email || actor?.id || 'system',
            savedAt: new Date().toISOString(),
          } as any,
        },
      });
    });

    for (const billId of touched) {
      try {
        await this.bills.refreshBillAfterPayments(organizationId, billId);
      } catch (e) {
        console.error('Voucher save: bill refresh failed for', billId, e);
      }
    }

    void this.logEvent({
      documentId: id,
      organizationId,
      action: 'EDITED',
      detail: `Payment voucher saved — ${voucherAmount.toFixed(2)} allocated across ${allocations.length} supplier invoice(s); ${entry.journalNumber} posted`,
      documentName: doc.name || undefined,
      actor,
    });

    return this.getById(organizationId, id);
  }

  async remove(organizationId: string, id: string, actor?: Actor) {
    const doc = await this.prisma.document.findFirst({ where: { id, organizationId, type: 'PAYMENT_VOUCHER' } });
    if (!doc) return { ok: true }; // idempotent (editor close can double-DELETE)

    const journalIds = await this.voucherJournalIds(organizationId, id);
    const previous = journalIds.length
      ? await this.prisma.billPayment.findMany({ where: { organizationId, journalEntryId: { in: journalIds } }, select: { id: true, billId: true } })
      : [];
    const live = await this.prisma.journalEntry.findFirst({
      where: { organizationId, sourceDocumentId: id, type: 'PAYMENT', status: { not: 'VOID' } },
      select: { id: true },
    });
    if (live) await this.journalService.void(organizationId, live.id, actor?.id);
    if (previous.length) await this.prisma.billPayment.deleteMany({ where: { organizationId, id: { in: previous.map((p) => p.id) } } });
    await this.prisma.document.deleteMany({ where: { id, organizationId } });

    for (const billId of new Set(previous.map((p) => p.billId))) {
      try {
        await this.bills.refreshBillAfterPayments(organizationId, billId);
      } catch (e) {
        console.error('Voucher delete: bill refresh failed for', billId, e);
      }
    }
    return { ok: true };
  }
}
