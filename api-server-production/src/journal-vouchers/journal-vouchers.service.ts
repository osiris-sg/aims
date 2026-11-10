import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { JournalService } from '../journal/journal.service';
import { JournalAutoPostService } from '../journal/journal-auto-post.service';
import { BillsService } from '../bills/bills.service';
import { PaymentVouchersService } from '../payment-vouchers/payment-vouchers.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { PaymentsService } from '../payments/payments.service';
import { AuditService } from 'src/common/audit.service';
import { AP_CREDIT_OFFSET_FLAG, isOrgFeatureEnabled } from '../common/org-features';
import { orgToday } from '../common/org-today';

const ROUND = (n: number) => Math.round(n * 100) / 100;

/**
 * Where the realised-FX residual goes, given `diff = lineBase - apBaseTotal`.
 *
 * A SUPPLIER offset line declares a DEBIT on the creditor control and is
 * expanded into one debit per invoice, so a shortfall in the expansion is made
 * up with another debit. A CUSTOMER line declares a CREDIT on the debtor
 * control and expands into credits, so its residual is the MIRROR IMAGE. Both
 * cases took the supplier sides, which put the residual on the same side as
 * the imbalance and doubled it on every foreign customer offset.
 *
 * The column decides the wording: a debit to the exchange account is a loss,
 * a credit is a gain.
 */
export function fxResidualSides(diff: number, isCustomer: boolean): { debit: number; credit: number } {
  const owed = ROUND(Math.abs(diff));
  const needsDebit = isCustomer ? diff < 0 : diff > 0;
  return needsDebit ? { debit: owed, credit: 0 } : { debit: 0, credit: owed };
}

/**
 * The journal MUST balance before it is written. journalService.create runs
 * this check itself, but the unconfirmed re-save path below updates the entry
 * and its lines directly — so without this an arithmetic slip anywhere above
 * would land in the GL silently instead of being refused.
 */
export function assertJournalBalances(lines: Array<{ debit: number; credit: number }>, voucherNumber: string): void {
  const debit = ROUND(lines.reduce((s, x) => s + (x.debit || 0), 0));
  const credit = ROUND(lines.reduce((s, x) => s + (x.credit || 0), 0));
  if (debit !== credit) {
    throw new BadRequestException(
      `Journal Voucher ${voucherNumber} does not balance: debit ${debit.toFixed(2)} vs credit ${credit.toFixed(2)}. Nothing was posted.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Journal Vouchers (guru 2026-11-09: "change the way we do journal voucher —
// do it like our template like OR and PV"). A J/V is a Document row (type
// JOURNAL_VOUCHER) edited in the real document editor the legacy way:
//
//   Voucher No. · Date · Prepare By · Remarks memo
//   Account code | Description | Remarks | Debit | Credit   (totals must match)
//
// Saving posts / updates ONE manual journal (type MANUAL) whose journalNumber
// IS the voucher number, so the J/V Listing (MANUAL only) and the Audit Trail
// show the same number the clerk keyed. While the journal is unconfirmed a
// re-save rewrites its lines in place (number kept); once the Posting Queue
// has confirmed it, a re-save voids it and posts a revision "<number>-R1".
//
// A line on the TRADE CREDITORS control opens the Payment Voucher's Offset
// Supplier Invoices dialog: the Debit is allocated across the supplier's
// invoices (cashless BillPayment rows, method 'journal') and posts per
// invoice at its historical rate ± realised FX, exactly like the P/V.
// ---------------------------------------------------------------------------

export type JvAllocation = { documentId: string; amount: number };
export type JvOffset = {
  /** 'supplier' (AP control: settle supplier invoices) or 'customer' (AR control: settle customer invoices / apply credit notes). */
  party?: 'supplier' | 'customer' | null;
  supplierId?: string | null;
  customerId?: string | null;
  rate?: number | null; // supplier currency per base
  allocations: JvAllocation[];
  updateFx?: boolean | null;
  fxAccountCode?: string | null;
};
export type JvLine = {
  id?: string | null;
  accountCode?: string | null;
  description?: string | null;
  remarks?: string | null;
  debit: number;
  credit: number;
  offset?: JvOffset | null;
};
export type SaveJournalVoucherDto = {
  date: string;
  voucherNumber?: string | null;
  preparedBy?: string | null;
  notes?: string | null;
  lines: JvLine[];
};

type Actor = { id?: string; name?: string; email?: string };

@Injectable()
export class JournalVouchersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journalService: JournalService,
    private readonly journalAutoPost: JournalAutoPostService,
    private readonly bills: BillsService,
    private readonly vouchers: PaymentVouchersService,
    private readonly receipts: ReceiptsService,
    private readonly payments: PaymentsService,
    private readonly auditService: AuditService,
  ) {}

  static readonly PENDING_NUMBER = 'JV-PENDING';
  private static pendingNumber(): string {
    const t = Date.now().toString(36).slice(-4);
    const r = Math.random().toString(36).slice(2, 4);
    return `${JournalVouchersService.PENDING_NUMBER}-${(t + r).toUpperCase()}`;
  }
  private static isPending(name: string | null | undefined): boolean {
    return String(name || '').startsWith(JournalVouchersService.PENDING_NUMBER);
  }

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
    const existing = await this.prisma.documentTemplate.findFirst({ where: { organizationId, type: 'JOURNAL_VOUCHER' }, select: { id: true } });
    if (existing) return existing.id;
    const created = await this.prisma.documentTemplate.create({
      data: { organizationId, type: 'JOURNAL_VOUCHER', name: 'Journal Voucher', config: {} } as any,
      select: { id: true },
    });
    return created.id;
  }

  private toVoucher(doc: any) {
    const c: any = doc.config || {};
    const lines: any[] = Array.isArray(c.lines) ? c.lines : [];
    return {
      id: doc.id,
      voucherNumber: doc.name,
      status: doc.status,
      date: c.date || null,
      preparedBy: c.preparedBy || '',
      notes: c.notes || '',
      creditorAccountCode: c.creditorAccountCode || null,
      debtorAccountCode: c.debtorAccountCode || null,
      lines,
      totalDebit: ROUND(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0)),
      totalCredit: ROUND(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)),
      journalNumber: c.journalNumber || null,
      journalEntryId: c.journalEntryId || null,
      documentTemplateId: doc.documentTemplateId || null,
      savedBy: c.savedBy || null,
      savedAt: c.savedAt || null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  async create(organizationId: string, actor?: Actor) {
    const [templateId, setting] = await Promise.all([
      this.getOrCreateTemplate(organizationId),
      this.prisma.accountingSetting.findUnique({ where: { organizationId }, select: { controlAccounts: true, timeZone: true } }),
    ]);
    const controls = (setting?.controlAccounts as any) || {};
    const doc = await this.prisma.document.create({
      data: {
        organizationId,
        documentTemplateId: templateId,
        type: 'JOURNAL_VOUCHER',
        name: JournalVouchersService.pendingNumber(),
        status: 'unconfirmed',
        config: {
          date: orgToday(setting?.timeZone),
          preparedBy: actor?.name || actor?.email || '',
          notes: '',
          creditorAccountCode: controls.creditorControl || 'CL001',
          debtorAccountCode: controls.debtorControl || 'CA001',
          lines: [],
        } as any,
      },
    });
    void this.logEvent({ documentId: doc.id, organizationId, action: 'CREATED', detail: 'Journal Voucher created', actor });
    return this.toVoucher(doc);
  }

  async list(organizationId: string) {
    const docs = await this.prisma.document.findMany({ where: { organizationId, type: 'JOURNAL_VOUCHER' }, orderBy: { createdAt: 'desc' }, take: 500 });
    return docs.map((d) => this.toVoucher(d));
  }

  async getById(organizationId: string, id: string) {
    const doc = await this.prisma.document.findFirst({ where: { id, organizationId, type: 'JOURNAL_VOUCHER' } });
    if (!doc) throw new NotFoundException('Journal voucher not found');
    return this.toVoucher(doc);
  }

  /** Every journal ever posted for this voucher (incl. voided) — the BillPayment link key. */
  private async voucherJournalIds(organizationId: string, id: string): Promise<string[]> {
    const jes = await this.prisma.journalEntry.findMany({ where: { organizationId, sourceDocumentId: id, type: 'MANUAL' }, select: { id: true } });
    return jes.map((j) => j.id);
  }

  async save(organizationId: string, id: string, dto: SaveJournalVoucherDto, actor?: Actor) {
    const doc = await this.prisma.document.findFirst({ where: { id, organizationId, type: 'JOURNAL_VOUCHER' } });
    if (!doc) throw new NotFoundException('Journal voucher not found');
    const cfg: any = doc.config || {};
    if (!dto.date) throw new BadRequestException('Date is required');

    const setting = await this.prisma.accountingSetting.findUnique({ where: { organizationId }, select: { controlAccounts: true, baseCurrency: true } });
    const controls = (setting?.controlAccounts as any) || {};
    const base = String(setting?.baseCurrency || 'SGD').toUpperCase();
    const creditorCode: string = cfg.creditorAccountCode || controls.creditorControl || 'CL001';
    const debtorCode: string = cfg.debtorAccountCode || controls.debtorControl || 'CA001';

    // Lines: drop blank rows; a row is one side only.
    type L = {
      id: string;
      accountCode: string;
      description: string;
      remarks: string;
      debit: number;
      credit: number;
      offset: null | (JvOffset & { party: 'supplier' | 'customer'; supplierCode: string | null; supplierName: string; customerCode: string | null; customerName: string; currency: string; supplierAmount: number; allocations: Array<JvAllocation & { reference?: string | null; date?: string | null; description?: string }> });
    };
    const lines: L[] = [];
    for (const [i, raw] of (dto.lines || []).entries()) {
      const debit = ROUND(Math.max(0, Number(raw?.debit) || 0));
      const credit = ROUND(Math.max(0, Number(raw?.credit) || 0));
      const offsetParty: 'supplier' | 'customer' | null = raw?.offset?.customerId ? 'customer' : raw?.offset?.supplierId ? 'supplier' : null;
      const hasOffset = !!offsetParty;
      const accountCode = String(raw?.accountCode || (offsetParty === 'customer' ? debtorCode : offsetParty === 'supplier' ? creditorCode : '')).trim();
      if (!accountCode && debit === 0 && credit === 0 && !hasOffset) continue;
      if (!accountCode) throw new BadRequestException(`Line ${i + 1}: pick an account code`);
      if (debit > 0 && credit > 0) throw new BadRequestException(`Line ${i + 1}: enter either a Debit or a Credit, not both`);
      if (debit === 0 && credit === 0 && !hasOffset) throw new BadRequestException(`Line ${i + 1}: enter a Debit or a Credit`);
      lines.push({
        id: String(raw?.id || `l${i + 1}`),
        accountCode,
        description: String(raw?.description || '').trim(),
        remarks: String(raw?.remarks || '').trim(),
        debit,
        credit,
        offset: hasOffset
          ? {
              party: offsetParty!,
              supplierId: raw!.offset!.supplierId ? String(raw!.offset!.supplierId) : null,
              customerId: raw!.offset!.customerId ? String(raw!.offset!.customerId) : null,
              customerCode: null,
              customerName: '',
              rate: Number(raw!.offset!.rate) || 1,
              allocations: (raw!.offset!.allocations || []).map((a) => ({ documentId: a.documentId, amount: ROUND(Number(a.amount) || 0) })).filter((a) => a.documentId && a.amount !== 0),
              updateFx: raw!.offset!.updateFx !== false,
              fxAccountCode: raw!.offset!.fxAccountCode ? String(raw!.offset!.fxAccountCode).trim() : null,
              supplierCode: null,
              supplierName: '',
              currency: base,
              // The offset side: a supplier line DEBITS (settles what we owe);
              // a customer line CREDITS (settles what they owe) — a customer
              // line with only credit notes applied is a DEBIT instead.
              supplierAmount: ROUND((offsetParty === 'customer' ? credit || debit : debit) * (Number(raw!.offset!.rate) || 1)),
            }
          : null,
      });
    }
    if (lines.length < 2) throw new BadRequestException('A journal voucher needs at least two lines — a debit and a credit');
    if (lines.filter((l) => l.offset?.party === 'supplier').length > 1) throw new BadRequestException('One supplier offset line per voucher');
    if (lines.filter((l) => l.offset?.party === 'customer').length > 1) throw new BadRequestException('One customer offset line per voucher');
    const totalDebit = ROUND(lines.reduce((s, l) => s + l.debit, 0));
    const totalCredit = ROUND(lines.reduce((s, l) => s + l.credit, 0));
    if (totalDebit <= 0) throw new BadRequestException('The voucher has no amount');
    if (Math.abs(totalDebit - totalCredit) > 0.005)
      throw new BadRequestException(`Debits ${totalDebit.toFixed(2)} and credits ${totalCredit.toFixed(2)} must match (out of balance ${(totalDebit - totalCredit).toFixed(2)})`);

    // Accounts.
    const codes = Array.from(new Set([...lines.map((l) => l.accountCode), ...(lines.map((l) => l.offset?.fxAccountCode).filter(Boolean) as string[])]));
    const accounts = await this.prisma.chartOfAccount.findMany({ where: { organizationId, code: { in: codes }, isActive: true }, select: { id: true, code: true, name: true } });
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    for (const l of lines) {
      if (!byCode.get(l.accountCode)) throw new BadRequestException(`Account ${l.accountCode} not found or inactive`);
      if (l.offset?.fxAccountCode && !byCode.get(l.offset.fxAccountCode)) throw new BadRequestException(`Exchange gain/loss account ${l.offset.fxAccountCode} not found`);
      if (!l.description) l.description = byCode.get(l.accountCode)!.name.toUpperCase();
    }

    // Previous journals / payment rows (before any repost).
    const previousJournalIds = await this.voucherJournalIds(organizationId, id);
    const previousPays = previousJournalIds.length
      ? await this.prisma.billPayment.findMany({ where: { organizationId, journalEntryId: { in: previousJournalIds } }, select: { id: true, billId: true, amount: true } })
      : [];
    const ownByBill = new Map<string, number>();
    for (const p of previousPays) ownByBill.set(p.billId, ROUND((ownByBill.get(p.billId) || 0) + (Number(p.amount) || 0)));

    // Supplier offset line: supplier, caps, balance in supplier currency.
    const creditWithFlag = await isOrgFeatureEnabled(this.prisma, organizationId, AP_CREDIT_OFFSET_FLAG);
    // Own prior customer rows (Payment.receiptId = this voucher) added back on re-save.
    const prevCustPays = await this.prisma.payment.findMany({ where: { organizationId, receiptId: id }, select: { id: true, documentId: true, amount: true } });
    const ownByInvoice = new Map<string, number>();
    for (const p of prevCustPays) ownByInvoice.set(p.documentId, ROUND((ownByInvoice.get(p.documentId) || 0) + (Number(p.amount) || 0)));
    for (const l of lines) {
      const o = l.offset;
      if (!o || o.party !== 'customer') continue;
      const customer: any = await this.prisma.customer.findFirst({ where: { id: String(o.customerId), organizationId }, select: { id: true, name: true, customerCode: true, currency: true } });
      if (!customer) throw new BadRequestException('Customer not found');
      o.customerCode = customer.customerCode || null;
      o.customerName = String(customer.name || '');
      o.currency = String(customer.currency || base).toUpperCase();
      if (!o.allocations.length) throw new BadRequestException(`Tick at least one invoice or credit note for ${o.customerName}`);
      const net = ROUND(o.allocations.reduce((s, a) => s + a.amount, 0));
      // Net positive (invoices settled) → the line CREDITS debtors; net negative
      // (credit notes applied) → it DEBITS debtors.
      const expectSide = net >= 0 ? l.credit : l.debit;
      if (Math.abs(Math.abs(net) - ROUND(expectSide * (Number(o.rate) || 1))) > 0.005)
        throw new BadRequestException(`${o.customerName}: offset must be fully allocated — line ${(net >= 0 ? l.credit : l.debit).toFixed(2)}, allocated ${Math.abs(net).toFixed(2)}`);
      o.supplierAmount = Math.abs(net);
      const { debits: openInv, credits: openCn } = await this.receipts.offsetItems(organizationId, String(o.customerId));
      const openById = new Map<string, any>();
      for (const b of openInv) openById.set(b.documentId, { ...b, kind: 'bill', outstanding: ROUND(b.outstanding + (ownByInvoice.get(b.documentId) || 0)) });
      for (const cn of openCn) openById.set(cn.documentId, { ...cn, kind: 'credit', outstanding: ROUND(cn.outstanding - (ownByInvoice.get(cn.documentId) || 0)) });
      for (const a of o.allocations) {
        const d = openById.get(a.documentId);
        if (!d) throw new BadRequestException('An allocated document is not open for this customer');
        if (d.kind === 'credit' && a.amount > 0) throw new BadRequestException(`${d.reference} is a credit note — its amount must be negative`);
        if (d.kind === 'bill' && a.amount < 0) throw new BadRequestException(`${d.reference} is an invoice — its amount cannot be negative`);
        if (Math.abs(a.amount) > d.outstanding + 0.005) throw new BadRequestException(`Allocation to ${d.reference} (${Math.abs(a.amount).toFixed(2)}) exceeds its outstanding ${d.outstanding.toFixed(2)}`);
      }
      o.allocations = o.allocations.map((a) => {
        const d = openById.get(a.documentId);
        return { ...a, reference: d?.reference ?? null, date: d?.date ?? null, description: d?.remarks ?? 'INVOICE' };
      });
      if (!l.remarks) l.remarks = `${o.customerCode ? `${o.customerCode} — ` : ''}${o.customerName}`.trim();
    }
    for (const l of lines) {
      const o = l.offset;
      if (!o || o.party !== 'supplier') continue;
      if (l.debit <= 0) throw new BadRequestException('A supplier offset line settles invoices — it must carry a Debit');
      const supplier: any = await this.prisma.supplier.findFirst({ where: { id: String(o.supplierId), organizationId }, select: { id: true, name: true, supplierCode: true, currency: true } });
      if (!supplier) throw new BadRequestException('Supplier not found');
      o.supplierCode = supplier.supplierCode || null;
      o.supplierName = String(supplier.name || '');
      o.currency = String(supplier.currency || base).toUpperCase();
      if (!o.allocations.length) throw new BadRequestException(`Tick at least one supplier invoice for ${o.supplierName}`);
      if (o.allocations.some((a) => a.amount < 0) && !creditWithFlag) throw new BadRequestException('Supplier credit notes are not enabled for this organisation');
      if (!o.allocations.some((a) => a.amount > 0)) throw new BadRequestException('Allocate at least one supplier invoice');
      const offsetSum = ROUND(o.allocations.reduce((s, a) => s + a.amount, 0));
      if (Math.abs(offsetSum - o.supplierAmount) > 0.005)
        throw new BadRequestException(`${o.supplierName}: offset must be fully allocated — amount ${o.supplierAmount.toFixed(2)}, allocated ${offsetSum.toFixed(2)}`);
      // Open invoices, with this voucher's own prior rows added back.
      const open = await this.vouchers.openBills(organizationId, String(o.supplierId));
      const openById = new Map(open.map((b) => [b.documentId, { ...b, outstanding: ROUND(b.outstanding + (b.kind === 'credit' ? -(ownByBill.get(b.documentId) || 0) : ownByBill.get(b.documentId) || 0)) }]));
      for (const a of o.allocations) {
        const bill = openById.get(a.documentId);
        if (!bill) throw new BadRequestException('An allocated supplier invoice is not open for this supplier');
        if (bill.kind === 'credit' && a.amount > 0) throw new BadRequestException(`${bill.reference} is a credit note — its amount must be negative`);
        if (bill.kind === 'bill' && a.amount < 0) throw new BadRequestException(`${bill.reference} is a supplier invoice — its amount cannot be negative`);
        if (Math.abs(a.amount) > bill.outstanding + 0.005)
          throw new BadRequestException(`Allocation to ${bill.reference} (${Math.abs(a.amount).toFixed(2)}) exceeds its outstanding ${bill.outstanding.toFixed(2)}`);
      }
      o.allocations = o.allocations.map((a) => {
        const b = openById.get(a.documentId);
        return { ...a, reference: b?.reference ?? null, date: b?.date ?? null, description: b?.remarks ?? 'SUPPLIER INVOICE' };
      });
      if (!l.remarks) l.remarks = `${o.supplierCode ? `${o.supplierCode} — ` : ''}${o.supplierName}`.trim();
    }

    // Voucher number = journal number. Typed wins; a pending shell takes the
    // next JV-###### from the journal series on its first save.
    let voucherNumber = doc.name || '';
    const typed = String(dto.voucherNumber || '').trim();
    if (typed && typed !== voucherNumber && !JournalVouchersService.isPending(typed)) {
      const clash = await this.prisma.journalEntry.findFirst({ where: { organizationId, journalNumber: typed }, select: { sourceDocumentId: true } });
      if (clash && clash.sourceDocumentId !== id) throw new BadRequestException(`Voucher number ${typed} is already used by another journal`);
      voucherNumber = typed;
    }
    if (JournalVouchersService.isPending(voucherNumber)) voucherNumber = await this.journalService.nextJournalNumber(organizationId);
    if (voucherNumber !== doc.name) await this.prisma.document.update({ where: { id }, data: { name: voucherNumber } });

    // Journal lines.
    type JL = { accountId: string; debit: number; credit: number; description: string; foreignAmount?: number; exchangeRate?: number };
    const jl: JL[] = [];
    for (const l of lines) {
      const acc = byCode.get(l.accountCode)!;
      if (!l.offset) {
        jl.push({ accountId: acc.id, debit: l.debit, credit: l.credit, description: [l.description, l.remarks].filter(Boolean).join(' — ') });
        continue;
      }
      const o = l.offset;
      const isCust = o.party === 'customer';
      const partyName = isCust ? o.customerName : o.supplierName;
      const supForeign = o.currency !== base;
      const supRate = Number(o.rate) || 1;
      let apBaseTotal = 0;
      for (const a of o.allocations) {
        const hist = supForeign
          ? o.updateFx !== false
            ? (await this.journalAutoPost.historicalRateForDocument(organizationId, a.documentId)) ?? 1 / supRate
            : 1 / supRate
          : 1;
        const apBase = ROUND(a.amount * hist);
        if (apBase === 0) continue;
        apBaseTotal = ROUND(apBaseTotal + apBase);
        const isCredit = apBase < 0;
        // Supplier: settling an invoice DEBITS creditors; customer: settling an
        // invoice CREDITS debtors (credit notes the other way round).
        const dr = isCust ? (isCredit ? -apBase : 0) : isCredit ? 0 : apBase;
        const cr = isCust ? (isCredit ? 0 : apBase) : isCredit ? -apBase : 0;
        jl.push({
          accountId: acc.id,
          debit: dr,
          credit: cr,
          description: isCust
            ? isCredit ? `Apply credit note — ${partyName}` : `Settle invoice — ${partyName}`
            : isCredit ? `Apply supplier credit note — ${partyName}` : `Settle supplier invoice — ${partyName}`,
          ...(supForeign ? { foreignAmount: ROUND(Math.abs(a.amount)), exchangeRate: hist } : {}),
        });
      }
      const lineBase = isCust ? (apBaseTotal >= 0 ? l.credit : -l.debit) : l.debit;
      const diff = ROUND(lineBase - apBaseTotal);
      if (Math.abs(diff) > 0.005) {
        const fxAcc = o.fxAccountCode ? byCode.get(o.fxAccountCode) : await this.journalAutoPost.resolveFxGainLossAccount(organizationId, controls);
        if (!fxAcc) throw new BadRequestException('Realised FX on the supplier offset but no exchange gain/loss account — set one in Accounting Setup');
        const { debit: fxDr, credit: fxCr } = fxResidualSides(diff, isCust);
        jl.push({ accountId: fxAcc.id, debit: fxDr, credit: fxCr, description: `Realised FX ${fxDr > 0 ? 'loss' : 'gain'} — ${voucherNumber}` });
      }
    }
    assertJournalBalances(jl, voucherNumber);
    const description = dto.notes ? String(dto.notes).split('\n')[0].slice(0, 200) : `Journal Voucher ${voucherNumber}`;

    // Post: rewrite in place while unconfirmed, else void + revision.
    const existing = await this.prisma.journalEntry.findFirst({
      where: { organizationId, sourceDocumentId: id, type: 'MANUAL', status: { not: 'VOID' } },
      select: { id: true, journalNumber: true, isUnconfirmed: true },
    });
    let entry: { id: string; journalNumber: string };
    if (existing && existing.isUnconfirmed) {
      await this.prisma.$transaction(async (tx) => {
        await tx.journalEntryLine.deleteMany({ where: { journalEntryId: existing.id } });
        await tx.journalEntry.update({
          where: { id: existing.id },
          data: {
            journalNumber: voucherNumber,
            entryDate: new Date(dto.date),
            description,
            totalDebit: ROUND(jl.reduce((s, x) => s + x.debit, 0)),
            totalCredit: ROUND(jl.reduce((s, x) => s + x.credit, 0)),
            currency: base,
            lines: { create: jl.map((x, i) => ({ lineNumber: i + 1, accountId: x.accountId, debit: x.debit, credit: x.credit, description: x.description, foreignAmount: x.foreignAmount ?? null, exchangeRate: x.exchangeRate ?? null })) },
          },
        });
      });
      entry = { id: existing.id, journalNumber: voucherNumber };
    } else {
      if (existing) await this.journalService.void(organizationId, existing.id, actor?.id);
      const revision = existing ? previousJournalIds.length : 0;
      const created = await this.journalService.create(
        organizationId,
        {
          entryDate: new Date(dto.date).toISOString(),
          type: 'MANUAL',
          journalNumber: revision ? `${voucherNumber}-R${revision}` : voucherNumber,
          description,
          sourceDocumentId: id,
          currency: base,
          lines: jl,
        } as any,
        actor?.id,
        { autoPost: true },
      );
      entry = { id: created.id, journalNumber: created.journalNumber };
    }

    // Cashless payment rows for the supplier offset.
    const creditorAcc = byCode.get(creditorCode) || (await this.prisma.chartOfAccount.findFirst({ where: { organizationId, code: creditorCode }, select: { id: true, code: true, name: true } }));
    const allAllocations = lines.flatMap((l) => (l.offset?.party === 'supplier' ? l.offset.allocations.map((a) => ({ ...a, supplierId: String(l.offset!.supplierId) })) : []));
    const custAllocations = lines.flatMap((l) => (l.offset?.party === 'customer' ? l.offset.allocations.map((a) => ({ ...a, customerId: String(l.offset!.customerId) })) : []));
    const touched = new Set<string>([...previousPays.map((p) => p.billId), ...allAllocations.map((a) => a.documentId)]);
    const touchedInvoices = new Set<string>([...prevCustPays.map((p) => p.documentId), ...custAllocations.map((a) => a.documentId)]);
    await this.prisma.$transaction(async (tx) => {
      if (previousPays.length) await tx.billPayment.deleteMany({ where: { organizationId, id: { in: previousPays.map((p) => p.id) } } });
      if (prevCustPays.length) await tx.payment.deleteMany({ where: { organizationId, id: { in: prevCustPays.map((p) => p.id) } } });
      for (const a of custAllocations) {
        await tx.payment.create({
          data: {
            organizationId,
            customerId: a.customerId,
            documentId: a.documentId,
            amount: a.amount,
            paymentDate: new Date(dto.date),
            paymentMethod: 'journal',
            reference: voucherNumber,
            notes: `Journal Voucher ${voucherNumber}`,
            receiptId: id,
            journalEntryId: entry.id,
            createdBy: actor?.id || 'system',
          },
        });
      }
      for (const a of allAllocations) {
        await tx.billPayment.create({
          data: {
            organizationId,
            billId: a.documentId,
            supplierId: a.supplierId,
            amount: a.amount,
            paymentDate: new Date(dto.date),
            paymentMethod: 'journal',
            reference: voucherNumber,
            notes: `Journal Voucher ${voucherNumber}`,
            bankAccountId: creditorAcc?.id || '',
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
            preparedBy: dto.preparedBy || cfg.preparedBy || '',
            notes: dto.notes || '',
            creditorAccountCode: creditorCode,
            debtorAccountCode: debtorCode,
            lines,
            totalDebit,
            totalCredit,
            journalNumber: entry.journalNumber,
            journalEntryId: entry.id,
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
        console.error('J/V save: bill refresh failed for', billId, e);
      }
    }
    for (const invId of touchedInvoices) {
      try {
        await this.payments.updateInvoiceStatusAfterPayment(invId, organizationId);
      } catch (e) {
        console.error('J/V save: invoice refresh failed for', invId, e);
      }
    }

    void this.logEvent({
      documentId: id,
      organizationId,
      action: 'EDITED',
      detail: `Journal voucher saved — Dr ${totalDebit.toFixed(2)} / Cr ${totalCredit.toFixed(2)} over ${lines.length} line(s); ${entry.journalNumber} ${existing?.isUnconfirmed ? 'updated' : 'posted'}`,
      documentName: voucherNumber,
      actor,
    });
    return this.getById(organizationId, id);
  }

  async remove(organizationId: string, id: string, actor?: Actor) {
    const doc = await this.prisma.document.findFirst({ where: { id, organizationId, type: 'JOURNAL_VOUCHER' } });
    if (!doc) return { ok: true };
    const journalIds = await this.voucherJournalIds(organizationId, id);
    const previous = journalIds.length
      ? await this.prisma.billPayment.findMany({ where: { organizationId, journalEntryId: { in: journalIds } }, select: { id: true, billId: true } })
      : [];
    const live = await this.prisma.journalEntry.findFirst({ where: { organizationId, sourceDocumentId: id, type: 'MANUAL', status: { not: 'VOID' } }, select: { id: true } });
    if (live) await this.journalService.void(organizationId, live.id, actor?.id);
    if (previous.length) await this.prisma.billPayment.deleteMany({ where: { organizationId, id: { in: previous.map((p) => p.id) } } });
    const custPays = await this.prisma.payment.findMany({ where: { organizationId, receiptId: id }, select: { id: true, documentId: true } });
    if (custPays.length) await this.prisma.payment.deleteMany({ where: { organizationId, id: { in: custPays.map((p) => p.id) } } });
    await this.prisma.document.deleteMany({ where: { id, organizationId } });
    for (const invId of new Set(custPays.map((p) => p.documentId))) {
      try {
        await this.payments.updateInvoiceStatusAfterPayment(invId, organizationId);
      } catch (e) {
        console.error('J/V delete: invoice refresh failed for', invId, e);
      }
    }
    for (const billId of new Set(previous.map((p) => p.billId))) {
      try {
        await this.bills.refreshBillAfterPayments(organizationId, billId);
      } catch (e) {
        console.error('J/V delete: bill refresh failed for', billId, e);
      }
    }
    return { ok: true };
  }
}
