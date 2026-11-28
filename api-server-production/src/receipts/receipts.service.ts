import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { assertPeriodOpen, documentDay } from '../common/period-lock';
import { assertRecordUnlocked } from '../common/record-lock';
import { JournalAutoPostService } from '../journal/journal-auto-post.service';
import { JournalService } from '../journal/journal.service';
import { PaymentsService } from '../payments/payments.service';
import { AuditService } from 'src/common/audit.service';
import { outstandingOf, grossStampOf, amountPaidOf } from '../common/document-money';
import { documentReferenceOf } from '../common/doc-ref';
import { assertLedgerNotElsewhere } from '../common/imported-ledger';
import { DocumentNumberingService, bankCodeOf, patternNeedsBank } from '../document-numbering/document-numbering.service';
import { listVouchersPaged, VoucherListQuery } from '../common/voucher-list';
import { orgToday } from '../common/org-today';

const ROUND = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Official Receipts (legacy-UX overhaul, 2026-07-15; the voucher's shape
// 2026-11-28). A receipt is a Document row (type OFFICIAL_RECEIPT — the
// Document table is canonical) whose config carries the header + LINES, the
// way the Payment Voucher does since its 2026-11-09 rebuild:
//
//   Deposit-to bank (debit side) · Receipt No. · Date · Received from ·
//   Bank advice · Rate, then a grid of GL lines — Account code | Description |
//   Remarks | Amount.
//
// A line is either a DIRECT line (any GL account: a government grant to its
// income account, bank interest, a refund received, a bank charge deducted as
// a negative) or the ONE DEBTOR line the "Offset Transactions" dialog writes:
// Trade Debtors control + the customer + the invoices ticked (allocations).
// guru 2026-11-28: "the receipt must be able to take in double entries even if
// never tick invoices... example grant from government".
//
// Each allocation creates a normal Payment row tagged receiptId (so invoice
// status/outstanding and every AR report keep working), and the GL side is
// ONE journal per receipt (Dr bank the total / Cr each line — the debtor
// control per allocation ± realised FX), reposted on every save. The total of
// the lines is the money entering the bank and must be > 0.
//
// Legacy receipts (header customer + allocations, no lines) are read back as
// one debtor line; the legacy keys (customerId, customerName,
// creditAccountCode, receiptAmount, allocations) are still written on save so
// the listings, reports, bank rec and AIMEE that read them keep working.
// ---------------------------------------------------------------------------

export type ReceiptAllocation = { documentId: string; amount: number };

export type ReceiptOffset = {
  customerId?: string | null;
  /** Customer currency per receipt currency (1 when the same). */
  rate?: number | null;
  allocations: ReceiptAllocation[];
  /** Post the realised difference to the FX gain/loss account. Default true. */
  updateFx?: boolean | null;
  /** Override for the FX gain/loss account; blank = Accounting Setup default. */
  fxAccountCode?: string | null;
};

export type ReceiptLine = {
  id?: string | null;
  /** GL account. Blank on the debtor line = the debtor control. */
  accountCode?: string | null;
  description?: string | null;
  remarks?: string | null;
  /** Receipt currency, signed: positive = received (credit to this account), negative = a debit (a charge deducted). */
  amount: number;
  offset?: ReceiptOffset | null;
};

export type SaveReceiptDto = {
  date: string;
  chequeNo?: string | null;
  remarks?: string | null;
  /** The payer. Optional since 2026-11-28 — a grant has no customer; the debtor line carries its own customer. */
  customerId?: string | null;
  debitAccountCode: string; // deposit-to bank/cash
  currency?: string | null;
  rate?: number | null;
  /** Legacy clients: the receipt total. With lines the total IS the sum of the lines. */
  receiptAmount?: number | null;
  paymentMethod?: string | null;
  lines?: ReceiptLine[] | null;
  // Legacy shape (pre 2026-11-28 clients, the AIMEE tool, held-receipt release): converted into one debtor line.
  allocations?: ReceiptAllocation[] | null;
  creditAccountCode?: string | null;
  // Typed-over receipt number (guru 2026-11-05: accountants may edit the
  // running number). Must be unique among the org's receipts; the next
  // auto-issued number continues from the highest in that series.
  receiptNumber?: string | null;
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

  // Per-org custom numbering (Heimen 2026-11-05: "SCBOR2610-001 … UOB when
  // it's the UOB bank"). An active OFFICIAL_RECEIPT format in Accounting
  // Setup → Document Numbers replaces the legacy OR-###### series. A pattern
  // with the {BANK} token needs the deposit-to bank first, so such a receipt
  // opens as OR-PENDING and takes its real number on the first save; any
  // other pattern is issued at creation like before.
  static readonly PENDING_NUMBER = 'OR-PENDING';

  /**
   * A placeholder still has to be UNIQUE. Document is
   * `@@unique([name, organizationId, documentTemplateId])` and every receipt in
   * an org shares ONE Official Receipt template, so a flat 'OR-PENDING' would
   * fail the index the moment a second receipt is started while the first is
   * still unnumbered — including the ordinary case of an abandoned draft, which
   * would then block every new receipt in the org. The suffix keeps the name
   * obviously provisional; `isPending` matches on the prefix.
   */
  private static pendingNumber(): string {
    const t = Date.now().toString(36).slice(-4);
    const r = Math.random().toString(36).slice(2, 4);
    return `${ReceiptsService.PENDING_NUMBER}-${(t + r).toUpperCase()}`;
  }

  private static isPending(name: string | null | undefined): boolean {
    return String(name || '').startsWith(ReceiptsService.PENDING_NUMBER);
  }

  /**
   * The receipt's GL lines. A receipt saved before the grid existed (2026-11-28) carries only
   * allocations: it is read back as ONE debtor line — the credit account it was posted to, the
   * customer and its allocations — so nothing has to be migrated.
   */
  static linesOf(c: any): any[] {
    if (Array.isArray(c?.lines) && c.lines.length) return c.lines;
    const allocations = Array.isArray(c?.allocations) ? c.allocations : [];
    const amount = Number(c?.receiptAmount) || allocations.reduce((s: number, a: any) => s + (Number(a?.amount) || 0), 0);
    if (!allocations.length && !amount) return [];
    return [
      {
        id: 'debtor-legacy',
        accountCode: c?.creditAccountCode || c?.debtorAccountCode || null,
        description: '',
        remarks: c?.customerName || '',
        amount,
        offset: {
          customerId: c?.customerId || null,
          customerCode: null,
          customerName: c?.customerName || '',
          currency: c?.currency || 'SGD',
          rate: 1,
          receiptAmount: amount,
          customerAmount: amount,
          allocations,
          updateFx: true,
          fxAccountCode: null,
        },
      },
    ];
  }

  private async nextReceiptNumber(organizationId: string): Promise<string> {
    const format = await this.numbering.activeFormat(organizationId, 'OFFICIAL_RECEIPT');
    if (format) {
      if (patternNeedsBank(format.pattern)) return ReceiptsService.pendingNumber();
      const issued = await this.numbering.generateNumber(organizationId, 'OFFICIAL_RECEIPT', format.id);
      if (issued) return issued;
    }
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
      // The GL lines grid (2026-11-28). A receipt saved before the grid existed is read back as
      // one debtor line built from its allocations, so the editor and the print show the same thing.
      lines: ReceiptsService.linesOf(c),
      debtorAccountCode: c.debtorAccountCode || c.creditAccountCode || null,
      journalNumber: c.journalNumber || null,
      // Saved but not in the books yet — what the complete save still needs.
      incompleteReason: c.incompleteReason || null,
      // The document-editor page needs the template id (Locate filters by it)
      // and the save-tracking stamps for the Unconfirmed User / Last Used strip.
      documentTemplateId: doc.documentTemplateId || null,
      savedBy: c.savedBy || null,
      recordLocked: c.recordLocked === true,
      recordLockedAt: c.recordLockedAt || null,
      recordLockedBy: c.recordLockedBy || null,
      savedAt: c.savedAt || null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  async create(organizationId: string, actor?: Actor) {
    const [templateId, number, setting] = await Promise.all([
      this.getOrCreateReceiptTemplate(organizationId),
      this.nextReceiptNumber(organizationId),
      this.prisma.accountingSetting.findUnique({ where: { organizationId }, select: { controlAccounts: true, baseCurrency: true, timeZone: true } }),
    ]);
    const controls = (setting?.controlAccounts as any) || {};
    const doc = await this.prisma.document.create({
      data: {
        organizationId,
        documentTemplateId: templateId,
        type: 'OFFICIAL_RECEIPT',
        name: number,
        status: 'unconfirmed',
        config: {
          date: orgToday(setting?.timeZone),
          chequeNo: null,
          remarks: '',
          customerId: null,
          creditAccountCode: controls.debtorControl || null, // default; selectable in UI
          debtorAccountCode: controls.debtorControl || null,
          debitAccountCode: null,
          currency: setting?.baseCurrency || 'SGD',
          rate: 1,
          receiptAmount: 0,
          paymentMethod: 'transfer',
          allocations: [],
          lines: [],
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

  /**
   * DUPLICATE an Official Receipt (guru 2026-11-19) — the same treatment as
   * the J/V and the P/V: a NEW unconfirmed receipt dated TODAY with its own
   * number, keeping the customer, the deposit bank, the currency, the method
   * and the narration. The INVOICE ALLOCATIONS and the amount do not copy —
   * the source receipt already settled those invoices and the same money is
   * not received twice — nor does the cheque number.
   */
  async duplicate(organizationId: string, id: string, actor?: Actor) {
    const src = await this.prisma.document.findFirst({ where: { id, organizationId, type: 'OFFICIAL_RECEIPT' } });
    if (!src) throw new NotFoundException('Receipt not found');
    const c: any = src.config || {};
    const [number, setting] = await Promise.all([
      this.nextReceiptNumber(organizationId),
      this.prisma.accountingSetting.findUnique({ where: { organizationId }, select: { timeZone: true } }),
    ]);
    const doc = await this.prisma.document.create({
      data: {
        organizationId,
        documentTemplateId: src.documentTemplateId,
        type: 'OFFICIAL_RECEIPT',
        name: number,
        status: 'unconfirmed',
        config: {
          date: orgToday(setting?.timeZone),
          chequeNo: null,
          remarks: c.remarks || '',
          customerId: c.customerId || null,
          customerName: c.customerName || null,
          creditAccountCode: c.creditAccountCode || null,
          debitAccountCode: c.debitAccountCode || null,
          currency: c.currency || 'SGD',
          rate: Number(c.rate) || 1,
          receiptAmount: 0,
          paymentMethod: c.paymentMethod || 'transfer',
          allocations: [],
          // Direct lines copy with their amounts (a monthly grant repeats); the debtor line does not —
          // its invoices are already settled.
          lines: ReceiptsService.linesOf(c).filter((l) => !l.offset),
          debtorAccountCode: c.debtorAccountCode || c.creditAccountCode || null,
        } as any,
      },
    });
    void this.logEvent({
      documentId: doc.id,
      organizationId,
      action: 'CREATED',
      detail: `Official Receipt ${number} copied from ${src.name || 'another receipt'}`,
      documentName: number,
      actor,
    });
    return this.toReceipt(doc);
  }

  /**
   * List receipts, optionally one period at a time.
   *
   * The 500-row cap was safe while a receipt was something a person typed by
   * hand. Once Xero's payment history is backfilled an org has thousands, and
   * a report that fetches "the newest 500" and filters by date in the browser
   * shows an empty May when May is real — so the date range is applied HERE,
   * in the query, and the cap only guards a request that names no range.
   *
   * config.date is a 'YYYY-MM-DD' string, so string comparison is date
   * comparison; Prisma cannot order or filter inside Json, hence the raw ids.
   */
  async list(organizationId: string, opts?: { from?: string; to?: string; bank?: string }) {
    const from = opts?.from?.trim() || null;
    const to = opts?.to?.trim() || null;
    const bank = opts?.bank?.trim() && opts.bank !== 'all' ? opts.bank.trim() : null;

    if (!from && !to && !bank) {
      const docs = await this.prisma.document.findMany({
        where: { organizationId, type: 'OFFICIAL_RECEIPT' },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      return docs.map((d) => this.toReceipt(d));
    }

    const ids = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "Document"
        WHERE "organizationId" = $1 AND type = 'OFFICIAL_RECEIPT'
          AND ($2::text IS NULL OR config->>'date' >= $2)
          AND ($3::text IS NULL OR config->>'date' <= $3)
          AND ($4::text IS NULL OR config->>'debitAccountCode' = $4)
        ORDER BY config->>'date' DESC NULLS LAST
        LIMIT 5000`,
      organizationId, from, to, bank,
    );
    if (!ids.length) return [];
    // Re-assert the org on the fetch: the ids come from an org-scoped query
    // above, and this keeps that true if the two are ever separated.
    const docs = await this.prisma.document.findMany({ where: { organizationId, id: { in: ids.map((r) => r.id) } } });
    const order = new Map(ids.map((r, i) => [r.id, i]));
    docs.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    return docs.map((d) => this.toReceipt(d));
  }

  /** The Official Receipts LIST page: filtered, ordered, counted and paged in SQL. */
  async listPaged(organizationId: string, q: VoucherListQuery) {
    return listVouchersPaged(this.prisma as any, organizationId, 'OFFICIAL_RECEIPT', q, (d) => this.toReceipt(d));
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
        // type + documentTemplateId: the offset grid links each reference to
        // its document, and the editor route needs both (guru 2026-10-21).
        select: { id: true, name: true, type: true, documentTemplateId: true, status: true, createdAt: true, config: true },
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

    const rows: Array<{ documentId: string; reference: string; type: string; templateId: string | null; date: string | null; remarks: string; gross: number; outstanding: number; currency: string | null }> = [];
    for (const d of docs) {
      const c: any = d.config || {};
      if (c.voided) continue;
      const status = (d.status || '').toLowerCase();
      if (status === 'cancelled') continue;
      if ((status === 'draft' || status === 'unconfirmed') && !posted.has(d.id) && !c.xeroImported) continue;
      const di: any = c.documentInfo || {};
      const tax = Number(di.gstAmount ?? c.taxAmount ?? c.xeroTax ?? 0) || 0;
      let gross = Number(grossStampOf(c) ?? di.nettTotal ?? c.nettTotal ?? c.totalAmount ?? NaN);
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
      // The stamp is authoritative for what AIMS cannot see (a Xero credit
      // note folded into the balance), but it can NEVER claim more is owing
      // than gross minus the payments actually recorded here — a stale stamp
      // on a settled invoice is what kept paid invoices in this grid, the AR
      // twin of the Payment Voucher bug (guru 2026-11-18, "our accounting
      // features are confused with the amounts like stamped"). Take whichever
      // is smaller, then add this receipt's own rows back so editing it can
      // re-allocate them.
      const stamped = outstandingOf(c);
      const computed = ROUND(gross - recorded);
      const base = stamped !== undefined && stamped !== null ? Math.min(Number(stamped), computed) : computed;
      const outstanding = ROUND(Math.max(0, base + own));
      if (outstanding <= 0.005) continue;
      rows.push({
        documentId: d.id,
        reference: d.name || '(no #)',
        type: d.type,
        templateId: d.documentTemplateId ?? null,
        date: c.date ? String(c.date).slice(0, 10) : null,
        // Remarks = the invoice's own reference text; the legacy word only
        // when the document carries none (guru 2026-11-02).
        remarks: documentReferenceOf(c) || 'INVOICE',
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
  // A receipt that is NOT complete yet (no customer, no deposit account, no
  // amount, Balance ≠ 0.00…) still SAVES — as typed, OUT of the books — the
  // way an invoice autosaves half-filled (guru 2026-11-18: "still allow them
  // to save, same as an invoice"). Any journal it had is voided and its
  // Payment rows dropped; `incompleteReason` carries what is missing and the
  // editor shows it next to Saved. The next complete save posts.
  async save(organizationId: string, id: string, dto: SaveReceiptDto, actor?: Actor) {
    const doc = await this.prisma.document.findFirst({ where: { id, organizationId, type: 'OFFICIAL_RECEIPT' } });
    if (!doc) throw new NotFoundException('Receipt not found');
    assertLedgerNotElsewhere(doc.config, 'receipt');
    try {
      return await this.saveComplete(organizationId, id, doc, dto, actor);
    } catch (e) {
      if (!(e instanceof BadRequestException)) throw e;
      // A receipt that is ALREADY in the books is never pulled out by a re-save that fails a
      // check (guru 2026-11-25, UOBOR2610-004: a later autosave without the deposit-to bank
      // silently voided the posting and dropped the payment rows, and the invoice went back
      // to Awaiting Payment while the receipt still read "Saved"). The save is refused with
      // the reason and the posted state stands; delete the receipt to take it out.
      const live = await this.prisma.journalEntry.findFirst({
        where: { organizationId, sourceDocumentId: id, type: 'PAYMENT', status: { not: 'VOID' } },
        select: { id: true },
      });
      if (live) throw new BadRequestException(`${doc.name || 'This receipt'} is posted; the change was not saved: ${e.message}`);
      return this.saveIncomplete(organizationId, id, dto, e.message, actor);
    }
  }

  private async saveComplete(organizationId: string, id: string, doc: { name: string | null; config: any }, dtoIn: SaveReceiptDto, actor?: Actor) {
    const cfg: any = doc.config || {};
    // Legacy client shape (allocations, no lines) → one debtor line.
    const dto: SaveReceiptDto = { ...dtoIn };
    if (!Array.isArray(dto.lines) && Array.isArray(dto.allocations)) {
      dto.lines = [
        {
          accountCode: dto.creditAccountCode || null,
          amount: Number(dto.receiptAmount) || 0,
          offset: { customerId: String(dto.customerId || ''), rate: 1, allocations: dto.allocations },
        },
      ];
    }
    if (!dto.debitAccountCode) throw new BadRequestException('Deposit-to (debit) account is required');
    const setting = await this.prisma.accountingSetting.findUnique({ where: { organizationId }, select: { controlAccounts: true, baseCurrency: true } });
    const controls = (setting?.controlAccounts as any) || {};
    const base = String(setting?.baseCurrency || 'SGD').toUpperCase();
    const currency = String(dto.currency || base).toUpperCase();
    const rate = currency === base ? 1 : Number(dto.rate) || 1;
    const debtorCode: string = cfg.debtorAccountCode || controls.debtorControl || cfg.creditAccountCode || 'CA001';

    // Lines: drop blank rows, round, default the debtor line's account.
    type L = { id: string; accountCode: string; description: string; remarks: string; amount: number; offset: null | (ReceiptOffset & { customerId: string; customerCode: string | null; customerName: string; currency: string; receiptAmount: number; customerAmount: number; allocations: Array<ReceiptAllocation & { reference?: string | null; date?: string | null; description?: string }> }) };
    const lines: L[] = [];
    for (const [i, raw] of (dto.lines || []).entries()) {
      const amount = ROUND(Number(raw?.amount) || 0);
      const hasOffset = !!raw?.offset?.customerId || (!!raw?.offset && (raw.offset.allocations || []).length > 0);
      const accountCode = String(raw?.accountCode || (hasOffset ? debtorCode : '')).trim();
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
              customerId: String(raw!.offset!.customerId || dto.customerId || ''),
              customerCode: null,
              customerName: '',
              rate: Number(raw!.offset!.rate) || 1,
              allocations: (raw!.offset!.allocations || [])
                .map((a) => ({ documentId: a.documentId, amount: ROUND(Number(a.amount) || 0) }))
                .filter((a) => a.documentId && a.amount > 0),
              updateFx: raw!.offset!.updateFx !== false,
              fxAccountCode: raw!.offset!.fxAccountCode ? String(raw!.offset!.fxAccountCode).trim() : null,
              currency,
              receiptAmount: amount,
              customerAmount: ROUND(amount * (Number(raw!.offset!.rate) || 1)),
            }
          : null,
      });
    }
    if (!lines.length) throw new BadRequestException('Add at least one line — an account and an amount, or offset the customer\'s invoices');
    if (lines.filter((l) => l.offset).length > 1) throw new BadRequestException('One payer per receipt — a receipt can carry one customer offset line');
    const receiptAmount = ROUND(lines.reduce((s, l) => s + l.amount, 0));
    if (receiptAmount < 0) throw new BadRequestException('The receipt total cannot be negative — the lines must add up to money entering the bank');
    if (receiptAmount === 0) throw new BadRequestException('Receipt amount must be greater than zero');

    // Accounts: bank + every line account must exist and be active.
    const codes = Array.from(new Set([dto.debitAccountCode, ...lines.map((l) => l.accountCode), ...lines.map((l) => l.offset?.fxAccountCode).filter(Boolean) as string[]]));
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { organizationId, code: { in: codes }, isActive: true },
      select: { id: true, code: true, name: true, accountType: true },
    });
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    if (!byCode.get(dto.debitAccountCode)) throw new BadRequestException(`Deposit-to account ${dto.debitAccountCode} not found`);
    for (const l of lines) {
      if (!byCode.get(l.accountCode)) throw new BadRequestException(`Account ${l.accountCode} not found or inactive`);
      if (l.accountCode === dto.debitAccountCode) throw new BadRequestException(`Line ${l.accountCode}: a line cannot be the deposit-to bank itself`);
      if (l.offset?.fxAccountCode && !byCode.get(l.offset.fxAccountCode)) throw new BadRequestException(`Exchange gain/loss account ${l.offset.fxAccountCode} not found`);
      if (!l.description) l.description = byCode.get(l.accountCode)!.name.toUpperCase();
    }

    // The debtor line: its customer, the allocation caps, balance = 0.
    const debtorLine = lines.find((l) => l.offset) || null;
    const allocations = debtorLine ? debtorLine.offset!.allocations : [];
    if (debtorLine && !debtorLine.offset!.customerId) throw new BadRequestException('Pick the customer whose invoices this receipt settles');
    if (debtorLine && !allocations.length) throw new BadRequestException('Allocate the receipt to at least one invoice');
    if (debtorLine) {
      const offset = ROUND(allocations.reduce((s, a) => s + a.amount, 0));
      if (Math.abs(offset - debtorLine.offset!.customerAmount) > 0.005) {
        throw new BadRequestException(
          `Receipt must be fully allocated — received ${debtorLine.offset!.customerAmount.toFixed(2)}, allocated ${offset.toFixed(2)} (balance ${(debtorLine.offset!.customerAmount - offset).toFixed(2)})`,
        );
      }
    }

    // The payer: the debtor line's customer, else the header customer (a label only — a grant names
    // the agency as the payer without any invoice behind it), else none.
    const payerId = debtorLine?.offset?.customerId || dto.customerId || null;
    const customer = payerId
      ? await this.prisma.customer.findFirst({ where: { id: payerId, organizationId }, select: { id: true, name: true, customerCode: true } })
      : null;
    if (payerId && !customer) throw new BadRequestException('Customer not found');
    if (debtorLine) {
      debtorLine.offset!.customerCode = customer?.customerCode || null;
      debtorLine.offset!.customerName = String(customer?.name || '');
      if (!debtorLine.remarks) debtorLine.remarks = `${customer?.customerCode ? `${customer.customerCode} — ` : ''}${customer?.name || ''}`.trim();
    }

    // A receipt still on its placeholder number takes the real one now that
    // the deposit-to bank is known ({BANK} pattern). Issued once; a later
    // change of bank keeps the number — it is already on the journal and the
    // customer's statement.
    let receiptNumber = doc.name || '';
    const typed = String(dto.receiptNumber || '').trim();
    if (typed && typed !== receiptNumber && !ReceiptsService.isPending(typed)) {
      const clash = await this.prisma.document.findFirst({
        where: { organizationId, type: 'OFFICIAL_RECEIPT', name: typed, NOT: { id } },
        select: { id: true },
      });
      // A clash on a still-pending receipt means the previewed number was
      // taken meanwhile — fall through and issue the next one; on a saved
      // receipt it is a real conflict.
      if (clash && !ReceiptsService.isPending(receiptNumber)) throw new BadRequestException(`Receipt number ${typed} is already used`);
      if (!clash) {
        receiptNumber = typed;
        await this.prisma.document.update({ where: { id }, data: { name: receiptNumber } });
      }
    }
    if (ReceiptsService.isPending(receiptNumber)) {
      const bank = await this.prisma.chartOfAccount.findFirst({
        where: { organizationId, code: dto.debitAccountCode },
        select: { name: true },
      });
      const issued = await this.numbering.issueNumberLocked(organizationId, 'OFFICIAL_RECEIPT', null, new Date(dto.date), undefined, {
        bankCode: bankCodeOf(bank?.name || dto.debitAccountCode),
      });
      if (!issued) throw new BadRequestException('No active Official Receipt number format — set one in Accounting Setup → Document Numbers');
      receiptNumber = issued;
      await this.prisma.document.update({ where: { id }, data: { name: receiptNumber } });
    }

    // Per-invoice cap: allocation ≤ outstanding (this receipt's own prior rows excluded).
    const open = debtorLine ? await this.openInvoices(organizationId, debtorLine.offset!.customerId, { excludeReceiptId: id }) : [];
    const openById = new Map(open.map((o) => [o.documentId, o]));
    for (const a of allocations) {
      const inv = openById.get(a.documentId);
      if (!inv) throw new BadRequestException('An allocated invoice is not open for this customer');
      if (a.amount > inv.outstanding + 0.005) {
        throw new BadRequestException(`Allocation to ${inv.reference} (${a.amount.toFixed(2)}) exceeds its outstanding ${inv.outstanding.toFixed(2)}`);
      }
    }
    if (debtorLine) {
      debtorLine.offset!.allocations = allocations.map((a) => {
        const inv = openById.get(a.documentId);
        return { ...a, reference: inv?.reference ?? null, date: inv?.date ?? null, description: inv?.remarks ?? 'INVOICE' };
      });
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
            customerId: debtorLine!.offset!.customerId,
            documentId: a.documentId,
            amount: a.amount,
            paymentDate: new Date(dto.date),
            paymentMethod: dto.paymentMethod || 'transfer',
            reference: receiptNumber || undefined,
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
            ...cfg,
            date: dto.date,
            chequeNo: dto.chequeNo || null,
            remarks: dto.remarks || null,
            customerId: customer?.id || null,
            customerName: customer?.name || null,
            debitAccountCode: dto.debitAccountCode,
            // Legacy mirror: the credit side the old readers expect — the debtor line's account, else the
            // first direct line's (a grant receipt credits its income account).
            creditAccountCode: debtorLine?.accountCode || lines[0]?.accountCode || cfg.creditAccountCode || null,
            debtorAccountCode: debtorCode,
            currency,
            rate,
            receiptAmount,
            paymentMethod: dto.paymentMethod || 'transfer',
            lines,
            // Legacy mirror: the debtor line's allocations, enriched (reference/date/description) so a saved
            // receipt re-renders (view / preview / print) without refetching.
            allocations: debtorLine ? debtorLine.offset!.allocations : [],
            incompleteReason: null,
            savedBy: actor?.name || actor?.email || actor?.id || 'system',
            savedAt: new Date().toISOString(),
          } as any,
        },
      });
    });

    // A receipt paying ERP-imported invoices waits for the opening AR when the org holds those
    // journals (holdErpImportPaymentGl): any journal it had is voided and it is marked held.
    const holdGl = await this.journalAutoPost.holdsErpPaymentGl(organizationId, allocations.map((a) => a.documentId));
    if (holdGl) await this.journalAutoPost.holdReceipt(organizationId, id, actor?.id);
    // ONE journal for the receipt (void + repost inside).
    const entry = holdGl ? null : await this.journalAutoPost.postFromReceipt({
      organizationId,
      receiptDocumentId: id,
      receiptNumber,
      entryDate: new Date(dto.date),
      customerName: customer?.name || null,
      bankAccountCode: dto.debitAccountCode,
      creditAccountCode: debtorLine?.accountCode || null,
      currency,
      rate,
      amount: receiptAmount,
      allocations,
      lines: lines.map((l) => ({
        accountCode: l.accountCode,
        amount: l.amount,
        description: l.description,
        offset: l.offset
          ? {
              customerName: l.offset.customerName,
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
    if (entry) {
      // Posted = CONFIRMED (guru 2026-11-18: "when I allocate this it should
      // already be in the GL, so no need to Confirm"): the complete autosave is
      // the confirmation; the journal stops being "unconfirmed".
      await this.prisma.document.update({
        where: { id },
        data: { status: 'confirmed' as any, config: { ...((await this.prisma.document.findUnique({ where: { id }, select: { config: true } }))?.config as any), journalNumber: entry.journalNumber, glHeld: null } as any },
      });
      await this.journalService.markConfirmedForDocument(organizationId, id);
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
      detail: `Receipt saved — ${receiptAmount.toFixed(2)} over ${lines.length} line(s)${allocations.length ? `, ${allocations.length} invoice(s) allocated` : ''}${entry ? `; ${entry.journalNumber} posted` : ''}`,
      documentName: receiptNumber || undefined,
      actor,
    });

    return this.getById(organizationId, id);
  }

  /** The incomplete-save path (see save()): keep what was typed, take the receipt out of the books. */
  private async saveIncomplete(organizationId: string, id: string, dto: SaveReceiptDto, reason: string, actor?: Actor) {
    const touched = await this.unpost(organizationId, id, actor);
    const cfg: any = (await this.prisma.document.findUnique({ where: { id }, select: { config: true } }))?.config || {};
    // The grid as typed (blank rows dropped); a legacy client's allocations become the debtor line.
    const rawLines: ReceiptLine[] = Array.isArray(dto.lines)
      ? dto.lines
      : Array.isArray(dto.allocations) && dto.allocations.length
      ? [{ accountCode: dto.creditAccountCode || null, amount: Number(dto.receiptAmount) || 0, offset: { customerId: dto.customerId || null, rate: 1, allocations: dto.allocations } }]
      : [];
    const typedLines = rawLines
      .filter((l) => l && (String(l.accountCode || '').trim() || Number(l.amount) || l.offset))
      .map((l, i) => ({
        id: String(l.id || `l${i + 1}`),
        accountCode: String(l.accountCode || '').trim() || null,
        description: String(l.description || '').trim(),
        remarks: String(l.remarks || '').trim(),
        amount: ROUND(Number(l.amount) || 0),
        offset: l.offset
          ? {
              customerId: l.offset.customerId || dto.customerId || null,
              rate: Number(l.offset.rate) || 1,
              allocations: (l.offset.allocations || []).map((a: any) => ({ ...a, documentId: a.documentId, amount: ROUND(Number(a.amount) || 0) })).filter((a) => a.documentId && a.amount > 0),
              updateFx: l.offset.updateFx !== false,
              fxAccountCode: l.offset.fxAccountCode || null,
            }
          : null,
      }));
    const debtorLine = typedLines.find((l) => l.offset) || null;
    const payerId = debtorLine?.offset?.customerId || dto.customerId || null;
    const customer = payerId
      ? await this.prisma.customer.findFirst({ where: { id: payerId, organizationId }, select: { id: true, name: true, customerCode: true } })
      : null;
    const allocations = debtorLine ? debtorLine.offset!.allocations : [];
    // Reference / date on each ticked invoice, so the grid re-renders as left.
    const open = customer ? await this.openInvoices(organizationId, customer.id, { excludeReceiptId: id }) : [];
    const openById = new Map(open.map((o) => [o.documentId, o]));
    const typed = String(dto.receiptNumber || '').trim();
    if (typed && !ReceiptsService.isPending(typed)) {
      const clash = await this.prisma.document.findFirst({ where: { organizationId, type: 'OFFICIAL_RECEIPT', name: typed, NOT: { id } }, select: { id: true } });
      if (!clash) await this.prisma.document.update({ where: { id }, data: { name: typed } });
    }
    const { journalNumber: _drop, ...rest } = cfg;
    await this.prisma.document.update({
      where: { id },
      data: {
        status: 'unconfirmed' as any, // out of the books again
        config: {
          ...rest,
          date: dto.date || cfg.date,
          chequeNo: dto.chequeNo || null,
          remarks: dto.remarks || null,
          customerId: customer?.id || null,
          customerName: customer?.name || null,
          debitAccountCode: dto.debitAccountCode || null,
          creditAccountCode: debtorLine?.accountCode || typedLines[0]?.accountCode || cfg.creditAccountCode || null,
          currency: (dto.currency || 'SGD').toUpperCase(),
          rate: Number(dto.rate) || 1,
          receiptAmount: ROUND(typedLines.reduce((s, l) => s + l.amount, 0)),
          paymentMethod: dto.paymentMethod || 'transfer',
          lines: typedLines.map((l) =>
            l.offset
              ? {
                  ...l,
                  offset: {
                    ...l.offset,
                    customerCode: customer?.customerCode || null,
                    customerName: customer?.name || '',
                    allocations: l.offset.allocations.map((a) => {
                      const inv = openById.get(a.documentId);
                      return { ...a, reference: inv?.reference ?? (a as any).reference ?? null, date: inv?.date ?? (a as any).date ?? null, description: inv?.remarks ?? (a as any).description ?? 'INVOICE' };
                    }),
                  },
                }
              : l,
          ),
          allocations: allocations.map((a) => {
            const inv = openById.get(a.documentId);
            return { ...a, reference: inv?.reference ?? null, date: inv?.date ?? null, description: inv?.remarks ?? 'INVOICE' };
          }),
          glHeld: null,
          incompleteReason: reason,
          savedBy: actor?.name || actor?.email || actor?.id || 'system',
          savedAt: new Date().toISOString(),
        } as any,
      },
    });
    await this.refreshTouched(organizationId, touched.invoices, 'Receipt save');
    void this.logEvent({
      documentId: id,
      organizationId,
      action: 'EDITED',
      detail: `Receipt saved, not posted — ${reason}${touched.hadJournal ? ' (its journal voided)' : ''}`,
      documentName: dto.receiptNumber || undefined,
      actor,
    });
    return this.getById(organizationId, id);
  }

  /** Take the receipt OUT of the books: void its live journal, drop its Payment rows. The document row stays. */
  private async unpost(organizationId: string, id: string, actor?: Actor) {
    const existingJe = await this.prisma.journalEntry.findFirst({
      where: { organizationId, sourceDocumentId: id, type: 'PAYMENT', status: { not: 'VOID' } },
      select: { id: true },
    });
    if (existingJe) await this.journalService.void(organizationId, existingJe.id, actor?.id);
    const previous = await this.prisma.payment.findMany({ where: { organizationId, receiptId: id }, select: { documentId: true } });
    await this.prisma.payment.deleteMany({ where: { organizationId, receiptId: id } });
    return { invoices: new Set(previous.map((p) => p.documentId)), hadJournal: !!existingJe };
  }

  private async refreshTouched(organizationId: string, invoices: Set<string>, what: string) {
    for (const documentId of invoices) {
      try {
        await this.paymentsService.updateInvoiceStatusAfterPayment(documentId, organizationId);
      } catch (e) {
        console.error(`${what}: status refresh failed for`, documentId, e);
      }
    }
  }

  async remove(organizationId: string, id: string, actor?: Actor) {
    const doc = await this.prisma.document.findFirst({ where: { id, organizationId, type: 'OFFICIAL_RECEIPT' } });
    // Idempotent: closing the editor can race a backdrop-close double-DELETE —
    // an already-deleted receipt is a success, not an error.
    if (!doc) return { ok: true };
    assertRecordUnlocked(doc, 'deleted');
    await assertPeriodOpen(this.prisma, { organizationId, date: documentDay(doc.config, doc.createdAt), actorId: actor?.id, what: doc.name || 'This receipt', verb: 'deleted' });

    const touched = await this.unpost(organizationId, id, actor);
    // deleteMany: no P2025 when a concurrent close already removed the row.
    await this.prisma.document.deleteMany({ where: { id, organizationId } });
    await this.refreshTouched(organizationId, touched.invoices, 'Receipt delete');
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
      select: { id: true, name: true, type: true, documentTemplateId: true, status: true, config: true },
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
    const rows: Array<{ documentId: string; reference: string; type: string; templateId: string | null; date: string | null; remarks: string; gross: number; outstanding: number; currency: string | null }> = [];
    for (const d of docs) {
      const c: any = d.config || {};
      if (c.voided) continue;
      const status = (d.status || '').toLowerCase();
      if (status === 'cancelled') continue;
      if ((status === 'draft' || status === 'unconfirmed') && !posted.has(d.id) && !c.xeroImported) continue;
      const di: any = c.documentInfo || {};
      const tax = Number(di.gstAmount ?? c.taxAmount ?? c.xeroTax ?? 0) || 0;
      let gross = Number(grossStampOf(c) ?? di.nettTotal ?? c.nettTotal ?? c.totalAmount ?? NaN);
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
      // Same cap as openInvoices(): a stamp never claims more than gross minus
      // what AIMS has recorded against the document (guru 2026-11-18).
      const stamped = outstandingOf(c);
      const computed = ROUND(gross - applied);
      const base = stamped !== undefined && stamped !== null ? Math.min(Math.abs(Number(stamped)), computed) : computed;
      const outstanding = ROUND(Math.max(0, base));
      if (outstanding <= 0.005) continue;
      rows.push({
        documentId: d.id,
        reference: d.name || '(no #)',
        type: d.type,
        templateId: d.documentTemplateId ?? null,
        date: c.date ? String(c.date).slice(0, 10) : null,
        remarks: documentReferenceOf(c) || 'CREDIT NOTE',
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

    const [templateId, number, tzSetting] = await Promise.all([
      this.getOrCreateOffsetTemplate(organizationId),
      this.nextOffsetNumber(organizationId),
      this.prisma.accountingSetting.findUnique({ where: { organizationId }, select: { timeZone: true } }),
    ]);
    const date = dto.date || orgToday(tzSetting?.timeZone);
    await assertPeriodOpen(this.prisma, { organizationId, date, actorId: actor?.id, what: 'This offset', verb: 'recorded' });
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
    await assertPeriodOpen(this.prisma, { organizationId, date: documentDay(doc.config, doc.createdAt), actorId: actor?.id, what: doc.name || 'This offset', verb: 'deleted' });
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
