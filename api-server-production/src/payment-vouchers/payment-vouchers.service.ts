import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { JournalAutoPostService } from '../journal/journal-auto-post.service';
import { JournalService } from '../journal/journal.service';
import { BillsService } from '../bills/bills.service';
import { AuditService } from 'src/common/audit.service';
import { outstandingOf, grossStampOf } from '../common/document-money';
import { AP_CREDIT_OFFSET_FLAG, isOrgFeatureEnabled } from '../common/org-features';
import { documentReferenceOf } from '../common/doc-ref';
import { DocumentNumberingService, bankCodeOf, patternNeedsBank } from '../document-numbering/document-numbering.service';
import { orgToday } from '../common/org-today';

const ROUND = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Payment Vouchers (legacy AP, guru 2026-10-21; legacy-screen rebuild
// 2026-11-09). A voucher is a Document row (type PAYMENT_VOUCHER) whose config
// carries the header + LINES, the way A's Premier's P/V screen works:
//
//   Bank Account (credit side) · Voucher No. · Date · Payee · Remarks ·
//   Bank / cheque · Prepare By · Rate, then a grid of GL lines —
//   Account code | Description | Remarks | Amount.
//
// A line is either a DIRECT line (any GL account: bank charges, accounting
// fee, a refund as a negative) or a CREDITOR line produced by the "Offset
// Supplier Invoices" dialog: Trade Creditors control + the supplier + the
// invoices ticked (allocations, in the supplier's currency). One payee per
// voucher, so at most one creditor line. Spend Money retired into this screen.
//
// Each allocation creates a normal BillPayment row (so bill status /
// outstanding, the P/V Listing, the AP home and bank rec keep working) and the
// GL side is ONE journal per voucher (Dr each line / Cr bank + realised FX),
// reposted on every save. BillPayment rows link through that journal.
// The total of the lines is the cash leaving the bank and must be > 0 (0 only
// when a supplier credit note settles the invoices outright).
//
// Legacy vouchers (header supplier + allocations, no lines) are read back as
// one creditor line; the legacy keys (supplierId, creditAccountCode,
// debitAccountCode, voucherAmount, allocations) are still written on save so
// the listings and bank rec that read them keep working.
// ---------------------------------------------------------------------------

export type VoucherAllocation = { documentId: string; amount: number };

export type VoucherOffset = {
  supplierId: string;
  /** Supplier currency per voucher currency (1 when the same). */
  rate?: number | null;
  allocations: VoucherAllocation[];
  /** Post the realised difference to the FX gain/loss account (legacy "Update Exchange Gain / Loss Accounts"). Default true. */
  updateFx?: boolean | null;
  /** Override for the FX gain/loss account; blank = Accounting Setup default. */
  fxAccountCode?: string | null;
};

export type VoucherLine = {
  id?: string | null;
  /** GL account. Blank on a creditor line = the creditor control. */
  accountCode?: string | null;
  description?: string | null;
  remarks?: string | null;
  /** Voucher currency, signed: positive = paid out (debit), negative = credit. */
  amount: number;
  offset?: VoucherOffset | null;
};

export type SaveVoucherDto = {
  date: string;
  voucherNumber?: string | null;
  bankAccountCode: string; // paid-from bank/cash (credit side)
  currency?: string | null;
  rate?: number | null;
  payee?: string | null;
  remarks?: string | null;
  notes?: string | null;
  chequeNo?: string | null;
  preparedBy?: string | null;
  paymentMethod?: string | null;
  lines: VoucherLine[];
  // Legacy shape (pre 2026-11-09 clients): converted into one creditor line.
  supplierId?: string | null;
  creditAccountCode?: string | null;
  debitAccountCode?: string | null;
  voucherAmount?: number | null;
  allocations?: VoucherAllocation[] | null;
};

/** AP Manual Offset (guru 2026-11-09 "add manual offset just like OR"): settle a
 *  supplier's credit notes against their invoices with no cash. */
export type CreateApOffsetDto = {
  supplierId: string;
  date?: string;
  remarks?: string | null;
  updateFx?: boolean;
  debits: VoucherAllocation[]; // supplier invoices settled
  credits: VoucherAllocation[]; // supplier credit notes consumed
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
    private readonly numbering: DocumentNumberingService,
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

  // Per-org custom numbering (Heimen 2026-11-05: "SCBPV2610-001"). An active
  // PAYMENT_VOUCHER format replaces the legacy PV-###### series; a {BANK}
  // pattern waits for the paid-from bank, so the voucher opens as PV-PENDING
  // and is numbered on its first save (mirror of ReceiptsService).
  static readonly PENDING_NUMBER = 'PV-PENDING';

  /** Unique placeholder — see ReceiptsService.pendingNumber: every voucher in an
   *  org shares one template and Document's (name, org, template) index would
   *  reject a second unnumbered voucher. */
  private static pendingNumber(): string {
    const t = Date.now().toString(36).slice(-4);
    const r = Math.random().toString(36).slice(2, 4);
    return `${PaymentVouchersService.PENDING_NUMBER}-${(t + r).toUpperCase()}`;
  }

  private static isPending(name: string | null | undefined): boolean {
    return String(name || '').startsWith(PaymentVouchersService.PENDING_NUMBER);
  }

  private async nextVoucherNumber(organizationId: string): Promise<string> {
    const format = await this.numbering.activeFormat(organizationId, 'PAYMENT_VOUCHER');
    if (format) {
      if (patternNeedsBank(format.pattern)) return PaymentVouchersService.pendingNumber();
      const issued = await this.numbering.generateNumber(organizationId, 'PAYMENT_VOUCHER', format.id);
      if (issued) return issued;
    }
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
    // Legacy voucher (no lines): one creditor line carrying the allocations.
    const lines: any[] = Array.isArray(c.lines)
      ? c.lines
      : c.supplierId || (Array.isArray(c.allocations) && c.allocations.length)
      ? [
          {
            id: 'legacy-creditor',
            accountCode: c.debitAccountCode || c.creditorAccountCode || null,
            description: 'TRADE CREDITORS',
            remarks: c.supplierCode ? `${c.supplierCode} — ${c.supplierName || ''}`.trim() : c.supplierName || '',
            amount: Number(c.voucherAmount) || 0,
            offset: {
              supplierId: c.supplierId || null,
              supplierCode: c.supplierCode || null,
              supplierName: c.supplierName || null,
              currency: c.currency || 'SGD',
              rate: 1,
              voucherAmount: Number(c.voucherAmount) || 0,
              supplierAmount: Number(c.voucherAmount) || 0,
              allocations: Array.isArray(c.allocations) ? c.allocations : [],
              updateFx: true,
              fxAccountCode: null,
            },
          },
        ]
      : [];
    const creditorLine = lines.find((l) => l?.offset?.supplierId);
    const total = Array.isArray(c.lines) ? ROUND(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0)) : Number(c.voucherAmount) || 0;
    return {
      id: doc.id,
      voucherNumber: doc.name,
      status: doc.status,
      date: c.date || null,
      bankAccountCode: c.bankAccountCode || c.creditAccountCode || null,
      currency: c.currency || 'SGD',
      rate: Number(c.rate) || 1,
      payee: c.payee || creditorLine?.offset?.supplierName || c.supplierName || '',
      remarks: c.remarks || null,
      notes: c.notes || '',
      chequeNo: c.chequeNo || null,
      preparedBy: c.preparedBy || '',
      paymentMethod: c.paymentMethod || 'transfer',
      creditorAccountCode: c.creditorAccountCode || c.debitAccountCode || null,
      lines,
      voucherAmount: total,
      // Legacy readers (P/V listing, bank rec, AP home).
      supplierId: creditorLine?.offset?.supplierId || c.supplierId || null,
      supplierName: creditorLine?.offset?.supplierName || c.supplierName || null,
      supplierCode: creditorLine?.offset?.supplierCode || c.supplierCode || null,
      debitAccountCode: creditorLine?.accountCode || c.debitAccountCode || null,
      creditAccountCode: c.bankAccountCode || c.creditAccountCode || null,
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
      this.prisma.accountingSetting.findUnique({ where: { organizationId }, select: { controlAccounts: true, baseCurrency: true, timeZone: true } }),
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
          date: orgToday(setting?.timeZone),
          bankAccountCode: null,
          currency: setting?.baseCurrency || 'SGD',
          rate: 1,
          payee: '',
          remarks: '',
          notes: '',
          chequeNo: null,
          preparedBy: actor?.name || actor?.email || '',
          paymentMethod: 'transfer',
          creditorAccountCode: controls.creditorControl || 'CL001', // the creditor line's account
          lines: [],
          // legacy mirrors
          supplierId: null,
          debitAccountCode: controls.creditorControl || 'CL001',
          creditAccountCode: null,
          voucherAmount: 0,
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
  //
  // Supplier CREDIT NOTES ride in the same grid (guru 2026-11-06: "supplier
  // credit notes are not here"). A credit note is money the supplier owes
  // back, so it reduces the cash paid: its row carries kind 'credit' and a
  // POSITIVE `outstanding` meaning "credit left to use", and the voucher
  // stores its allocation NEGATIVE. Bills + credits still sum to the cash.
  async openBills(organizationId: string, supplierId: string, opts?: { excludeVoucherId?: string; includeCredits?: boolean }) {
    const withCredits = opts?.includeCredits || (await isOrgFeatureEnabled(this.prisma, organizationId, AP_CREDIT_OFFSET_FLAG));
    const docs = await this.prisma.document.findMany({
      where: {
        organizationId,
        type: { in: withCredits ? ['BILL', 'CREDIT_NOTE'] : ['BILL'] },
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

    const rows: Array<{ documentId: string; reference: string; type: string; kind: 'bill' | 'credit'; templateId: string | null; date: string | null; remarks: string; gross: number; outstanding: number; currency: string | null }> = [];
    for (const d of docs) {
      const c: any = d.config || {};
      if (c.voided) continue;
      const isCredit = d.type === 'CREDIT_NOTE';
      const billStatus = isCredit ? '' : String(c.billStatus || '').toUpperCase();
      const xs = String(c.xeroStatus || '');
      const docStatus = String(d.status || '').toLowerCase();
      if (billStatus === 'VOID' || billStatus === 'DRAFT' || billStatus === 'PENDING_APPROVAL') continue;
      if (xs === 'Voided' || xs === 'Deleted' || xs === 'Draft' || docStatus === 'cancelled') continue;
      if (!billStatus && !xs && (docStatus === 'draft' || docStatus === 'unconfirmed')) continue;
      const gross = ROUND(Number(c.totalAmount ?? grossStampOf(c) ?? c.nettTotal ?? 0) || 0);
      if (gross <= 0) continue;
      // A credit note's allocations are stored NEGATIVE, so the credit it has
      // already given away is −Σ(rows). Same shape as a bill's `recorded`,
      // opposite sign.
      const recorded = isCredit ? -(paidByBill.get(d.id) || 0) : paidByBill.get(d.id) || 0;
      const own = isCredit ? -(ownByBill.get(d.id) || 0) : ownByBill.get(d.id) || 0;
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
        kind: isCredit ? 'credit' : 'bill',
        templateId: d.documentTemplateId ?? null,
        date: (c.billDate || c.date) ? String(c.billDate || c.date).slice(0, 10) : null,
        // Remarks = the bill's own reference text; the legacy word only when
        // the document carries none (guru 2026-11-02).
        remarks: documentReferenceOf(c) || (isCredit ? 'SUPPLIER CREDIT NOTE' : 'SUPPLIER INVOICE'),
        gross,
        outstanding,
        currency: c.currency || c.documentInfo?.currency || null,
      });
    }
    rows.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || a.reference.localeCompare(b.reference));
    return rows;
  }

  // Save = validate the lines, repost the single journal, replace the
  // BillPayment rows (linked to the new journal), refresh each touched bill.
  async save(organizationId: string, id: string, dtoIn: SaveVoucherDto, actor?: Actor) {
    const doc = await this.prisma.document.findFirst({ where: { id, organizationId, type: 'PAYMENT_VOUCHER' } });
    if (!doc) throw new NotFoundException('Payment voucher not found');
    const cfg: any = doc.config || {};

    // Legacy client shape → one creditor line.
    const dto: SaveVoucherDto = { ...dtoIn };
    if (!Array.isArray(dto.lines) && Array.isArray(dto.allocations)) {
      dto.lines = [
        {
          accountCode: dto.debitAccountCode || null,
          amount: Number(dto.voucherAmount) || 0,
          offset: { supplierId: String(dto.supplierId || ''), rate: 1, allocations: dto.allocations },
        },
      ];
      dto.bankAccountCode = dto.bankAccountCode || String(dto.creditAccountCode || '');
    }

    if (!dto.bankAccountCode) throw new BadRequestException('Select the Bank Account the payment comes from');
    const setting = await this.prisma.accountingSetting.findUnique({ where: { organizationId }, select: { controlAccounts: true, baseCurrency: true } });
    const controls = (setting?.controlAccounts as any) || {};
    const base = String(setting?.baseCurrency || 'SGD').toUpperCase();
    const currency = String(dto.currency || base).toUpperCase();
    const rate = currency === base ? 1 : Number(dto.rate) || 1;
    const creditorCode: string = cfg.creditorAccountCode || cfg.debitAccountCode || controls.creditorControl || 'CL001';

    // Lines: drop blank rows, round, default the creditor line's account.
    type L = { id: string; accountCode: string; description: string; remarks: string; amount: number; offset: null | (VoucherOffset & { supplierCode: string | null; supplierName: string; currency: string; voucherAmount: number; supplierAmount: number; allocations: Array<VoucherAllocation & { reference?: string | null; date?: string | null; description?: string }> }) };
    const lines: L[] = [];
    for (const [i, raw] of (dto.lines || []).entries()) {
      const amount = ROUND(Number(raw?.amount) || 0);
      const hasOffset = !!raw?.offset?.supplierId;
      const accountCode = String(raw?.accountCode || (hasOffset ? creditorCode : '')).trim();
      if (!accountCode && amount === 0 && !hasOffset) continue; // empty row
      if (!accountCode) throw new BadRequestException(`Line ${i + 1}: pick an account code`);
      if (amount === 0 && !hasOffset) throw new BadRequestException(`Line ${i + 1}: enter an amount`);
      lines.push({
        id: String(raw?.id || `l${i + 1}`),
        accountCode,
        description: String(raw?.description || '').trim(),
        remarks: String(raw?.remarks || '').trim(),
        amount,
        offset: hasOffset
          ? {
              supplierId: String(raw!.offset!.supplierId),
              rate: Number(raw!.offset!.rate) || 1,
              allocations: (raw!.offset!.allocations || [])
                .map((a) => ({ documentId: a.documentId, amount: ROUND(Number(a.amount) || 0) }))
                .filter((a) => a.documentId && a.amount !== 0),
              updateFx: raw!.offset!.updateFx !== false,
              fxAccountCode: raw!.offset!.fxAccountCode ? String(raw!.offset!.fxAccountCode).trim() : null,
              supplierCode: null,
              supplierName: '',
              currency,
              voucherAmount: amount,
              supplierAmount: ROUND(amount * (Number(raw!.offset!.rate) || 1)),
            }
          : null,
      });
    }
    if (!lines.length) throw new BadRequestException('Add at least one line — an account and an amount, or offset supplier invoices');
    if (lines.filter((l) => l.offset).length > 1) throw new BadRequestException('One payee per voucher — a voucher can carry one supplier offset line');

    const total = ROUND(lines.reduce((s, l) => s + l.amount, 0));
    const hasCreditNote = lines.some((l) => l.offset?.allocations.some((a) => a.amount < 0));
    if (total < 0) throw new BadRequestException('The voucher total cannot be negative — the lines must add up to money leaving the bank');
    if (total === 0 && !hasCreditNote) throw new BadRequestException('The voucher total must be greater than zero');

    // Accounts: bank + every line account must exist and be active.
    const codes = Array.from(new Set([dto.bankAccountCode, ...lines.map((l) => l.accountCode), ...lines.map((l) => l.offset?.fxAccountCode).filter(Boolean) as string[]]));
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { organizationId, code: { in: codes }, isActive: true },
      select: { id: true, code: true, name: true, accountType: true },
    });
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const bank = byCode.get(dto.bankAccountCode);
    if (!bank) throw new BadRequestException(`Bank Account ${dto.bankAccountCode} not found`);
    for (const l of lines) {
      if (!byCode.get(l.accountCode)) throw new BadRequestException(`Account ${l.accountCode} not found or inactive`);
      if (l.accountCode === dto.bankAccountCode) throw new BadRequestException(`Line ${l.accountCode}: a line cannot be the paying bank itself`);
      if (l.offset?.fxAccountCode && !byCode.get(l.offset.fxAccountCode)) throw new BadRequestException(`Exchange gain/loss account ${l.offset.fxAccountCode} not found`);
      if (!l.description) l.description = byCode.get(l.accountCode)!.name.toUpperCase();
    }

    // Placeholder → real number once the paid-from bank is known ({BANK}
    // pattern). Issued once; a later bank change keeps the number.
    let voucherNumber = doc.name || '';
    const typed = String(dto.voucherNumber || '').trim();
    if (typed && typed !== voucherNumber && !PaymentVouchersService.isPending(typed)) {
      const clash = await this.prisma.document.findFirst({
        where: { organizationId, type: 'PAYMENT_VOUCHER', name: typed, NOT: { id } },
        select: { id: true },
      });
      if (clash && !PaymentVouchersService.isPending(voucherNumber)) throw new BadRequestException(`Voucher number ${typed} is already used`);
      if (!clash) {
        voucherNumber = typed;
        await this.prisma.document.update({ where: { id }, data: { name: voucherNumber } });
      }
    }
    if (PaymentVouchersService.isPending(voucherNumber)) {
      const issued = await this.numbering.issueNumberLocked(organizationId, 'PAYMENT_VOUCHER', null, new Date(dto.date), undefined, {
        bankCode: bankCodeOf(bank.name || bank.code),
      });
      if (!issued) throw new BadRequestException('No active Payment Voucher number format — set one in Accounting Setup → Document Numbers');
      voucherNumber = issued;
      await this.prisma.document.update({ where: { id }, data: { name: voucherNumber } });
    }

    // Creditor line: supplier, allocation caps, balance = 0 in supplier currency.
    const creditWithFlag = await isOrgFeatureEnabled(this.prisma, organizationId, AP_CREDIT_OFFSET_FLAG);
    for (const l of lines) {
      const o = l.offset;
      if (!o) continue;
      const supplier: any = await this.prisma.supplier.findFirst({ where: { id: o.supplierId, organizationId }, select: { id: true, name: true, supplierCode: true, currency: true } });
      if (!supplier) throw new BadRequestException('Supplier not found');
      o.supplierCode = supplier.supplierCode || null;
      o.supplierName = String(supplier.name || '');
      o.currency = String(supplier.currency || currency).toUpperCase();
      if (!o.allocations.length) throw new BadRequestException(`Tick at least one supplier invoice for ${supplier.name}`);
      if (o.allocations.some((a) => a.amount < 0) && !creditWithFlag) throw new BadRequestException('Supplier credit notes are not enabled for this organisation');
      if (!o.allocations.some((a) => a.amount > 0)) throw new BadRequestException('Allocate at least one supplier invoice — an offset cannot be credit notes alone');
      const offsetSum = ROUND(o.allocations.reduce((s, a) => s + a.amount, 0));
      if (Math.abs(offsetSum - o.supplierAmount) > 0.005)
        throw new BadRequestException(
          `${supplier.name}: offset must be fully allocated — amount ${o.supplierAmount.toFixed(2)}, allocated ${offsetSum.toFixed(2)} (balance ${(o.supplierAmount - offsetSum).toFixed(2)})`,
        );
      const open = await this.openBills(organizationId, o.supplierId, { excludeVoucherId: id });
      const openById = new Map(open.map((b) => [b.documentId, b]));
      for (const a of o.allocations) {
        const bill = openById.get(a.documentId);
        if (!bill) throw new BadRequestException('An allocated supplier invoice is not open for this supplier');
        if (bill.kind === 'credit' && a.amount > 0)
          throw new BadRequestException(`${bill.reference} is a credit note — it reduces the payment, so its amount must be negative`);
        if (bill.kind === 'bill' && a.amount < 0) throw new BadRequestException(`${bill.reference} is a supplier invoice — its amount cannot be negative`);
        if (Math.abs(a.amount) > bill.outstanding + 0.005) {
          const what = bill.kind === 'credit' ? 'credit left' : 'outstanding';
          throw new BadRequestException(`Allocation to ${bill.reference} (${Math.abs(a.amount).toFixed(2)}) exceeds its ${what} ${bill.outstanding.toFixed(2)}`);
        }
      }
      // Enrich for the config / print.
      o.allocations = o.allocations.map((a) => {
        const b = openById.get(a.documentId);
        return { ...a, reference: b?.reference ?? null, date: b?.date ?? null, description: b?.remarks ?? 'SUPPLIER INVOICE' };
      });
      if (!l.remarks) l.remarks = `${o.supplierCode ? `${o.supplierCode} — ` : ''}${o.supplierName}`.trim();
    }

    const creditorLine = lines.find((l) => l.offset);
    const payee = String(dto.payee || creditorLine?.offset?.supplierName || '').trim();

    // Previous rows are found through the voucher's earlier journals (BEFORE
    // the repost voids them — voided journals still carry the link).
    const previousJournalIds = await this.voucherJournalIds(organizationId, id);
    const previous = previousJournalIds.length
      ? await this.prisma.billPayment.findMany({ where: { organizationId, journalEntryId: { in: previousJournalIds } }, select: { id: true, billId: true } })
      : [];
    const allAllocations = lines.flatMap((l) => (l.offset ? l.offset.allocations.map((a) => ({ ...a, supplierId: l.offset!.supplierId })) : []));
    const touched = new Set<string>([...previous.map((p) => p.billId), ...allAllocations.map((a) => a.documentId)]);

    // ONE journal for the voucher (void + repost inside).
    const entry = await this.journalAutoPost.postFromPaymentVoucher({
      organizationId,
      voucherDocumentId: id,
      voucherNumber,
      entryDate: new Date(dto.date),
      payee,
      bankAccountCode: dto.bankAccountCode,
      currency,
      rate,
      total,
      lines: lines.map((l) => ({
        accountCode: l.accountCode,
        amount: l.amount,
        description: l.description,
        offset: l.offset
          ? {
              supplierName: l.offset.supplierName,
              currency: l.offset.currency,
              rate: l.offset.rate || 1,
              allocations: l.offset.allocations.map((a) => ({ documentId: a.documentId, amount: a.amount })),
              updateFx: l.offset.updateFx !== false,
              fxAccountCode: l.offset.fxAccountCode || null,
            }
          : null,
      })),
      userId: actor?.id,
    });
    if (!entry) {
      throw new BadRequestException('Could not post the voucher journal — check the creditor control, paid-from bank and FX gain/loss accounts in Accounting Setup');
    }

    await this.prisma.$transaction(async (tx) => {
      if (previous.length) await tx.billPayment.deleteMany({ where: { organizationId, id: { in: previous.map((p) => p.id) } } });
      for (const a of allAllocations) {
        await tx.billPayment.create({
          data: {
            organizationId,
            billId: a.documentId,
            supplierId: a.supplierId,
            amount: a.amount,
            paymentDate: new Date(dto.date),
            paymentMethod: dto.paymentMethod || (dto.chequeNo ? 'cheque' : 'transfer'),
            reference: voucherNumber || undefined,
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
            ...cfg,
            date: dto.date,
            bankAccountCode: dto.bankAccountCode,
            currency,
            rate,
            payee,
            remarks: dto.remarks || null,
            notes: dto.notes || '',
            chequeNo: dto.chequeNo || null,
            preparedBy: dto.preparedBy || cfg.preparedBy || '',
            paymentMethod: dto.paymentMethod || (dto.chequeNo ? 'cheque' : 'transfer'),
            creditorAccountCode: creditorCode,
            lines,
            voucherAmount: total,
            // Legacy mirrors for the listings / bank rec.
            supplierId: creditorLine?.offset?.supplierId || null,
            supplierName: creditorLine?.offset?.supplierName || null,
            supplierCode: creditorLine?.offset?.supplierCode || null,
            debitAccountCode: creditorLine?.accountCode || creditorCode,
            creditAccountCode: dto.bankAccountCode,
            allocations: allAllocations,
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
      detail: `Payment voucher saved — ${total.toFixed(2)} over ${lines.length} line(s)${allAllocations.length ? `, ${allAllocations.length} supplier invoice(s) offset` : ''}; ${entry.journalNumber} posted`,
      documentName: voucherNumber || undefined,
      actor,
    });

    return this.getById(organizationId, id);
  }

  // ---------------------------------------------------------------------------
  // Manual Offset (AP) — the receipt's Manual Offset mirrored for suppliers:
  // tick supplier credit notes (credits) against supplier invoices (debits),
  // Balance 0.00, no cash. Creates an MO-###### MANUAL_OFFSET document
  // (side 'AP') + cashless BillPayment rows (bills positive, credit notes
  // NEGATIVE — the sign openBills reads credit usage from). A journal posts
  // only for a realised FX difference (control account nets out otherwise).
  // ---------------------------------------------------------------------------
  async offsetItems(organizationId: string, supplierId: string) {
    const rows = await this.openBills(organizationId, supplierId, { includeCredits: true });
    return { debits: rows.filter((r) => r.kind === 'bill'), credits: rows.filter((r) => r.kind === 'credit') };
  }

  private async getOrCreateOffsetTemplate(organizationId: string): Promise<string> {
    const existing = await this.prisma.documentTemplate.findFirst({ where: { organizationId, type: 'MANUAL_OFFSET' }, select: { id: true } });
    if (existing) return existing.id;
    const created = await this.prisma.documentTemplate.create({
      data: { organizationId, type: 'MANUAL_OFFSET', name: 'Manual Offset', config: {} } as any,
      select: { id: true },
    });
    return created.id;
  }

  /** Same MO- series as the receipt side — one Manual Offset numbering per org. */
  private async nextOffsetNumber(organizationId: string): Promise<string> {
    const rows = await this.prisma.document.findMany({ where: { organizationId, type: 'MANUAL_OFFSET', name: { startsWith: 'MO-' } }, select: { name: true } });
    let max = 0;
    for (const r of rows) {
      const m = /^MO-(\d+)$/.exec(r.name || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `MO-${String(max + 1).padStart(6, '0')}`;
  }

  async createOffset(organizationId: string, dto: CreateApOffsetDto, actor?: Actor) {
    if (!dto.supplierId) throw new BadRequestException('Supplier is required');
    const debits = (dto.debits || []).map((a) => ({ documentId: a.documentId, amount: ROUND(Number(a.amount) || 0) })).filter((a) => a.documentId && a.amount > 0);
    const credits = (dto.credits || []).map((a) => ({ documentId: a.documentId, amount: ROUND(Number(a.amount) || 0) })).filter((a) => a.documentId && a.amount > 0);
    if (!debits.length || !credits.length) throw new BadRequestException('Tick at least one entry on each side');
    const drTotal = ROUND(debits.reduce((s, a) => s + a.amount, 0));
    const crTotal = ROUND(credits.reduce((s, a) => s + a.amount, 0));
    if (Math.abs(drTotal - crTotal) > 0.005)
      throw new BadRequestException(`Offset must balance — debits ${drTotal.toFixed(2)} vs credits ${crTotal.toFixed(2)} (balance ${(drTotal - crTotal).toFixed(2)})`);

    const supplier: any = await this.prisma.supplier.findFirst({ where: { id: dto.supplierId, organizationId }, select: { id: true, name: true } });
    if (!supplier) throw new BadRequestException('Supplier not found');

    const { debits: openDebits, credits: openCredits } = await this.offsetItems(organizationId, dto.supplierId);
    const debitById = new Map(openDebits.map((o) => [o.documentId, o]));
    const creditById = new Map(openCredits.map((o) => [o.documentId, o]));
    for (const a of debits) {
      const b = debitById.get(a.documentId);
      if (!b) throw new BadRequestException('A ticked supplier invoice is not open for this supplier');
      if (a.amount > b.outstanding + 0.005) throw new BadRequestException(`Offset of ${b.reference} (${a.amount.toFixed(2)}) exceeds its outstanding ${b.outstanding.toFixed(2)}`);
    }
    for (const a of credits) {
      const cn = creditById.get(a.documentId);
      if (!cn) throw new BadRequestException('A ticked credit note is not open for this supplier');
      if (a.amount > cn.outstanding + 0.005) throw new BadRequestException(`Offset of ${cn.reference} (${a.amount.toFixed(2)}) exceeds its remaining ${cn.outstanding.toFixed(2)}`);
    }

    const [templateId, number, setting] = await Promise.all([
      this.getOrCreateOffsetTemplate(organizationId),
      this.nextOffsetNumber(organizationId),
      this.prisma.accountingSetting.findUnique({ where: { organizationId }, select: { timeZone: true, controlAccounts: true } }),
    ]);
    const date = dto.date || orgToday(setting?.timeZone);
    // BillPayment needs an account: no bank moves in an offset, so the rows
    // carry the creditor control the settlement ran through.
    const creditorCode = ((setting?.controlAccounts as any) || {}).creditorControl || 'CL001';
    const creditorAcc = await this.prisma.chartOfAccount.findFirst({ where: { organizationId, code: creditorCode }, select: { id: true } });
    if (!creditorAcc) throw new BadRequestException(`Creditor control account ${creditorCode} not found — set it in Accounting Setup`);
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
            side: 'AP',
            date,
            supplierId: supplier.id,
            supplierName: supplier.name,
            remarks: dto.remarks || null,
            debits: debits.map((a) => enrich(a, debitById)),
            credits: credits.map((a) => enrich(a, creditById)),
            amount: drTotal,
            savedBy: actor?.name || actor?.email || actor?.id || 'system',
            savedAt: new Date().toISOString(),
          } as any,
        },
      });
      // Cashless rows: a bill is "paid" by the offset, a credit note is used up
      // (stored negative, the sign openBills reads).
      for (const a of debits) {
        await tx.billPayment.create({
          data: { organizationId, billId: a.documentId, supplierId: supplier.id, amount: a.amount, paymentDate: new Date(date), paymentMethod: 'offset', reference: number, notes: dto.remarks || `Manual Offset ${number}`, bankAccountId: creditorAcc.id, createdBy: actor?.id || 'system' },
        });
      }
      for (const a of credits) {
        await tx.billPayment.create({
          data: { organizationId, billId: a.documentId, supplierId: supplier.id, amount: -a.amount, paymentDate: new Date(date), paymentMethod: 'offset', reference: number, notes: dto.remarks || `Manual Offset ${number}`, bankAccountId: creditorAcc.id, createdBy: actor?.id || 'system' },
        });
      }
      return created;
    });

    let journalNumber: string | null = null;
    if (dto.updateFx !== false) {
      const entry = await this.journalAutoPost.postFromManualOffset({
        organizationId,
        offsetDocumentId: offsetDoc.id,
        offsetNumber: number,
        entryDate: new Date(date),
        customerName: supplier.name,
        party: 'supplier',
        debits: debits.map((a) => enrich(a, debitById)),
        credits: credits.map((a) => enrich(a, creditById)),
        userId: actor?.id,
      });
      if (entry) {
        journalNumber = (entry as any).journalNumber || null;
        await this.prisma.document.update({ where: { id: offsetDoc.id }, data: { config: { ...((offsetDoc.config as any) || {}), journalNumber } as any } });
      }
    }

    for (const a of [...debits, ...credits]) {
      try {
        await this.bills.refreshBillAfterPayments(organizationId, a.documentId);
      } catch (e) {
        console.error('AP offset: bill refresh failed for', a.documentId, e);
      }
    }

    void this.logEvent({
      documentId: offsetDoc.id,
      organizationId,
      action: 'CREATED',
      detail: `Manual Offset ${number} (AP) — ${drTotal.toFixed(2)} offset across ${debits.length} supplier invoice(s) and ${credits.length} credit note(s)${journalNumber ? `; FX ${journalNumber} posted` : ''}`,
      documentName: number,
      actor,
    });
    return { id: offsetDoc.id, number, amount: drTotal, journalNumber };
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
