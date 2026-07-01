import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { JournalService } from '../journal/journal.service';
import { ChartOfAccountsService } from '../accounting/chart-of-accounts.service';

// ---------------------------------------------------------------------------
// Bills (Accounts Payable) — supplier-side equivalent of invoices.
//
// REFACTORED 2026-06-23: all bill data lives in the unified Document table
// (type='BILL'). The legacy Bill table is no longer written to; the schema
// keeps it around but it's effectively dead. Field mapping inside Document:
//   Document.name              ← billNumber
//   Document.status            ← coarse status (draft/confirmed/cancelled)
//   Document.attachments       ← supplier-side PDFs / supporting docs
//   Document.config.{          (the rich AP fields the Bill model used to hold)
//     supplierId, supplier: { id, name },
//     billDate, dueDate, reference, description, currency,
//     subtotal, taxAmount, totalAmount, amountPaid,
//     lines: [{ description, quantity, unitPrice, amount, accountId?, taxAmount? }],
//     billStatus: 'DRAFT'|'PENDING_APPROVAL'|'POSTED'|'PAID'|'VOID',
//     sourcePoId, matchStatus, matchDetails,
//     inboundChannel, inboundMeta,
//     journalEntryId, approvedBy, approvedAt, postedAt, postedBy,
//     voidedAt, voidedBy,
//   }
//
// The list/findOne endpoints return a Bill-shaped object so the frontend type
// (defined in app/portal/inventory/bills/page.tsx) stays unchanged. `toBill()`
// is the canonical mapper.
//
// Lifecycle (unchanged): DRAFT → (PENDING_APPROVAL if total > threshold) → POSTED → PAID → VOID
// On POSTED a balanced JE is created (Dr expense lines + tax / Cr AP control).
// ---------------------------------------------------------------------------

const ROUND = (n: number) => Math.round(n * 100) / 100;
const DAY_MS = 24 * 60 * 60 * 1000;

type BillLine = {
  description?: string;
  quantity?: number;
  unitPrice?: number;
  amount: number;
  accountId?: string;
  taxAmount?: number;
};

type BillStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'POSTED' | 'PAID' | 'VOID';

// Map our fine-grained billStatus to the coarse DocumentStatus enum (draft/confirmed/cancelled).
function toDocStatus(billStatus: BillStatus): 'draft' | 'confirmed' | 'cancelled' {
  if (billStatus === 'VOID') return 'cancelled';
  if (billStatus === 'DRAFT' || billStatus === 'PENDING_APPROVAL') return 'draft';
  return 'confirmed';
}

@Injectable()
export class BillsService {
  private readonly logger = new Logger(BillsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: JournalService,
    private readonly coa: ChartOfAccountsService,
  ) {}

  // ---- Bill template resolver (cached per org) ----
  // Bills get attached to a DocumentTemplate row of type=BILL. We seed one
  // per org on first use; the template itself is a thin shell — Document.config
  // is where the real bill data lives.
  private templateCache = new Map<string, string>();
  private async getOrCreateBillTemplate(organizationId: string): Promise<string> {
    const cached = this.templateCache.get(organizationId);
    if (cached) return cached;
    let tmpl = await this.prisma.documentTemplate.findFirst({
      where: { organizationId, type: 'BILL' },
      orderBy: { createdAt: 'asc' },
    });
    if (!tmpl) {
      tmpl = await this.prisma.documentTemplate.create({
        data: {
          organizationId,
          name: 'Bill',
          type: 'BILL',
          isActive: true,
          templateVariant: 'Default',
          designName: 'Default',
          config: {
            tableColumnOrder: ['description', 'quantity', 'unitPrice', 'taxAmount', 'amount'],
            columnLabels: { description: 'Description', quantity: 'Qty', unitPrice: 'Unit Price', taxAmount: 'Tax', amount: 'Amount' },
            formFields: [],
          } as any,
        },
      });
    }
    this.templateCache.set(organizationId, tmpl.id);
    return tmpl.id;
  }

  // Reshape a Document(type=BILL) row into the Bill-shaped response the
  // /bills frontend expects. Handles both AIMS-native bills (full config)
  // and Xero-imported bills (uses xeroGross / xeroBalance etc.).
  private toBill(doc: { id: string; name: string | null; createdAt: Date; updatedAt: Date; status: any; config: any; attachments: any }, supplierName?: string | null) {
    const c: any = doc.config || {};
    const subtotal = c.subtotal ?? c.xeroSubtotal ?? 0;
    const taxAmount = c.taxAmount ?? c.xeroTax ?? 0;
    const totalAmount = c.totalAmount ?? c.xeroGross ?? 0;
    const xeroBalance = c.xeroBalance;
    const amountPaid =
      c.amountPaid !== undefined
        ? c.amountPaid
        : xeroBalance !== undefined
          ? ROUND(totalAmount - xeroBalance)
          : c.xeroAmountPaid ?? 0;
    // Resolve status. Prefer config.billStatus (AIMS-native), else derive from
    // xeroStatus / DocumentStatus.
    let billStatus: BillStatus = c.billStatus as BillStatus;
    if (!billStatus) {
      const xs = c.xeroStatus;
      if (xs === 'Paid') billStatus = 'PAID';
      else if (xs === 'Voided' || xs === 'Deleted' || doc.status === 'cancelled') billStatus = 'VOID';
      else if (xs === 'Draft' || doc.status === 'draft') billStatus = 'DRAFT';
      else billStatus = 'POSTED';
    }
    return {
      id: doc.id,
      billNumber: doc.name || '',
      billDate: c.billDate || c.date || doc.createdAt.toISOString(),
      dueDate: c.dueDate || null,
      status: billStatus,
      reference: c.reference || c.xeroReference || null,
      description: c.description || null,
      subtotal,
      taxAmount,
      totalAmount,
      amountPaid,
      currency: c.currency || c.documentInfo?.currency || 'SGD',
      lines: c.lines || c.items || [],
      sourcePoId: c.sourcePoId || null,
      matchStatus: c.matchStatus || null,
      matchDetails: c.matchDetails || null,
      inboundChannel: c.inboundChannel || (c.xeroImported ? 'XERO' : 'MANUAL'),
      inboundMeta: c.inboundMeta || null,
      journalEntryId: c.journalEntryId || null,
      approvedBy: c.approvedBy || null,
      approvedAt: c.approvedAt || null,
      postedAt: c.postedAt || null,
      postedBy: c.postedBy || null,
      voidedAt: c.voidedAt || null,
      voidedBy: c.voidedBy || null,
      attachments: doc.attachments || c.attachments || null,
      supplierId: c.supplierId || c.supplier?.id || null,
      supplier: c.supplier ? { id: c.supplier.id, name: supplierName ?? c.supplier.name, gstRegNo: null } : null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  private async hydrateSupplierNames(docs: any[]) {
    const ids = Array.from(new Set(docs.map((d) => (d.config as any)?.supplierId || (d.config as any)?.supplier?.id).filter(Boolean)));
    if (!ids.length) return new Map<string, string>();
    const rows = await this.prisma.supplier.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    return new Map(rows.map((s) => [s.id, s.name]));
  }

  // ---------- CRUD ----------

  async list(
    organizationId: string,
    opts?: { status?: string; supplierId?: string; startDate?: Date; endDate?: Date; limit?: number },
  ) {
    const where: Prisma.DocumentWhereInput = {
      organizationId,
      type: 'BILL',
      ...(opts?.supplierId && {
        OR: [
          { config: { path: ['supplierId'], equals: opts.supplierId } },
          { config: { path: ['supplier', 'id'], equals: opts.supplierId } },
        ],
      }),
    };
    const docs = await this.prisma.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      // No hard cap by default — frontend (PageTable) paginates client-side.
      // Caller can still pass an explicit `limit` to bound.
      take: opts?.limit ?? undefined,
      select: { id: true, name: true, createdAt: true, updatedAt: true, status: true, config: true, attachments: true },
    });
    const supplierNames = await this.hydrateSupplierNames(docs);
    let bills = docs.map((d) =>
      this.toBill(d, supplierNames.get(((d.config as any)?.supplierId || (d.config as any)?.supplier?.id) as string)),
    );

    // Status / date filtering done in-memory (config-based fields aren't directly indexable here)
    if (opts?.status) bills = bills.filter((b) => b.status === opts.status);
    if (opts?.startDate || opts?.endDate) {
      bills = bills.filter((b) => {
        const d = new Date(b.billDate);
        if (opts.startDate && d < opts.startDate) return false;
        if (opts.endDate && d > opts.endDate) return false;
        return true;
      });
    }
    return bills;
  }

  async findOne(organizationId: string, id: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, organizationId, type: 'BILL' },
      select: { id: true, name: true, createdAt: true, updatedAt: true, status: true, config: true, attachments: true },
    });
    if (!doc) throw new NotFoundException('Bill not found');
    const supplierMap = await this.hydrateSupplierNames([doc]);
    return this.toBill(doc, supplierMap.get(((doc.config as any)?.supplierId || (doc.config as any)?.supplier?.id) as string));
  }

  async create(
    organizationId: string,
    userId: string | undefined,
    dto: {
      supplierId: string;
      billNumber: string;
      billDate: string;
      dueDate?: string;
      reference?: string;
      description?: string;
      lines: BillLine[];
      taxAmount?: number;
      sourcePoId?: string;
      inboundChannel?: 'MANUAL' | 'UPLOAD' | 'EMAIL' | 'FROM_PO';
      inboundMeta?: any;
    },
  ) {
    if (!dto.supplierId) throw new BadRequestException('supplierId required');
    if (!dto.billNumber?.trim()) throw new BadRequestException('billNumber required');
    if (!dto.lines || dto.lines.length === 0) throw new BadRequestException('At least one line required');

    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, organizationId },
      select: { id: true, name: true },
    });
    if (!supplier) throw new BadRequestException('Supplier not found');

    const subtotal = ROUND(dto.lines.reduce((s, l) => s + (l.amount || 0), 0));
    const taxAmount = ROUND(
      dto.taxAmount !== undefined ? dto.taxAmount : dto.lines.reduce((s, l) => s + (l.taxAmount || 0), 0),
    );
    const totalAmount = ROUND(subtotal + taxAmount);

    const templateId = await this.getOrCreateBillTemplate(organizationId);
    const billStatus: BillStatus = 'DRAFT';

    const config = {
      supplierId: supplier.id,
      supplier: { id: supplier.id, name: supplier.name },
      billDate: dto.billDate,
      date: dto.billDate, // mirror under "date" so generic Document views work
      dueDate: dto.dueDate || null,
      reference: dto.reference || null,
      description: dto.description || null,
      currency: 'SGD',
      subtotal,
      taxAmount,
      totalAmount,
      amountPaid: 0,
      lines: dto.lines,
      items: dto.lines, // mirror — readers vary
      billStatus,
      sourcePoId: dto.sourcePoId || null,
      inboundChannel: dto.inboundChannel || 'MANUAL',
      inboundMeta: dto.inboundMeta || null,
      createdBy: userId,
    };

    try {
      const doc = await this.prisma.document.create({
        data: {
          organizationId,
          documentTemplateId: templateId,
          type: 'BILL',
          name: dto.billNumber.trim(),
          status: toDocStatus(billStatus) as any,
          config: config as unknown as Prisma.InputJsonValue,
        },
      });
      return this.toBill({ ...doc, attachments: null } as any, supplier.name);
    } catch (e: any) {
      if (e.code === 'P2002') {
        throw new ConflictException(`Bill ${dto.billNumber} already exists for this supplier`);
      }
      throw e;
    }
  }

  async update(organizationId: string, id: string, dto: Partial<any>) {
    const existing = await this.findOne(organizationId, id);
    if (existing.status !== 'DRAFT' && existing.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(`Can't edit a ${existing.status} bill — void and re-create`);
    }
    const cfg: any = { ...existing };
    // Pull the latest config from DB so we don't lose unknown fields.
    const dbDoc = await this.prisma.document.findUniqueOrThrow({ where: { id }, select: { config: true } });
    const config: any = { ...(dbDoc.config as any) };

    if (dto.billNumber !== undefined) {
      await this.prisma.document.update({ where: { id }, data: { name: String(dto.billNumber).trim() } });
    }
    if (dto.billDate !== undefined) { config.billDate = dto.billDate; config.date = dto.billDate; }
    if (dto.dueDate !== undefined) config.dueDate = dto.dueDate || null;
    if (dto.reference !== undefined) config.reference = dto.reference;
    if (dto.description !== undefined) config.description = dto.description;
    if (dto.lines !== undefined) {
      const subtotal = ROUND(dto.lines.reduce((s: number, l: BillLine) => s + (l.amount || 0), 0));
      const taxAmount = ROUND(
        dto.taxAmount !== undefined ? dto.taxAmount : dto.lines.reduce((s: number, l: BillLine) => s + (l.taxAmount || 0), 0),
      );
      config.lines = dto.lines;
      config.items = dto.lines;
      config.subtotal = subtotal;
      config.taxAmount = taxAmount;
      config.totalAmount = ROUND(subtotal + taxAmount);
    }
    await this.prisma.document.update({ where: { id }, data: { config: config as Prisma.InputJsonValue } });
    return this.findOne(organizationId, id);
  }

  // ---------- Workflow ----------

  async submit(organizationId: string, id: string, userId?: string) {
    const bill = await this.findOne(organizationId, id);
    if (bill.status !== 'DRAFT') throw new BadRequestException(`Bill is ${bill.status}, can only submit DRAFT`);

    const settings = await this.prisma.accountingSetting.findUnique({ where: { organizationId } });
    const threshold = (settings as any)?.billApprovalThreshold ?? 0;
    if (threshold > 0 && bill.totalAmount > threshold) {
      await this.patchStatus(id, 'PENDING_APPROVAL');
      return this.findOne(organizationId, id);
    }
    return this.post(organizationId, id, userId);
  }

  async approve(organizationId: string, id: string, userId?: string) {
    const bill = await this.findOne(organizationId, id);
    if (bill.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(`Bill is ${bill.status} — only PENDING_APPROVAL bills can be approved`);
    }
    await this.patchConfig(id, { approvedBy: userId, approvedAt: new Date().toISOString() });
    return this.post(organizationId, id, userId);
  }

  async reject(organizationId: string, id: string, _userId?: string) {
    const bill = await this.findOne(organizationId, id);
    if (bill.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Only PENDING_APPROVAL bills can be rejected');
    }
    await this.patchStatus(id, 'DRAFT');
    return this.findOne(organizationId, id);
  }

  async post(organizationId: string, id: string, userId?: string) {
    const bill = await this.findOne(organizationId, id);
    if (bill.status === 'POSTED' || bill.status === 'PAID') return bill;

    const settings = await this.prisma.accountingSetting.findUnique({ where: { organizationId } });
    const controls = (settings?.controlAccounts as any) || {};
    const creditorCode = controls.creditorControl || 'CL001';
    const taxCode = controls.taxLiabilities || 'CL900';

    const creditor = await this.prisma.chartOfAccount.findFirst({
      where: { organizationId, code: creditorCode, isActive: true },
    });
    if (!creditor) throw new BadRequestException(`Trade Payables account (${creditorCode}) not found`);

    const taxAccount =
      bill.taxAmount > 0
        ? await this.prisma.chartOfAccount.findFirst({
            where: { organizationId, code: taxCode, isActive: true },
          })
        : null;

    const fallbackPurchase = await this.prisma.chartOfAccount.findFirst({
      where: { organizationId, accountType: 'PURCHASE', isActive: true },
      orderBy: { code: 'asc' },
    });

    const lines: Array<{ accountId: string; debit: number; credit: number; description: string }> = [];
    for (const [i, l] of (bill.lines as any[]).entries()) {
      const accountId = l.accountId || fallbackPurchase?.id;
      if (!accountId) throw new BadRequestException(`Bill line ${i + 1}: no accountId and no fallback PURCHASE account in chart`);
      lines.push({ accountId, debit: ROUND(l.amount || 0), credit: 0, description: l.description || `Bill ${bill.billNumber}` });
    }
    if (bill.taxAmount > 0 && taxAccount) {
      lines.push({ accountId: taxAccount.id, debit: bill.taxAmount, credit: 0, description: `Input tax — ${bill.billNumber}` });
    }
    lines.push({ accountId: creditor.id, debit: 0, credit: bill.totalAmount, description: `Bill ${bill.billNumber}` });

    const entry = await this.journal.create(
      organizationId,
      {
        entryDate: new Date(bill.billDate).toISOString(),
        type: 'BILL' as any,
        reference: bill.billNumber,
        description: `Bill from supplier (id=${bill.supplierId})`,
        lines,
      },
      userId,
    );
    const posted = await this.journal.post(organizationId, entry.id, userId);

    await this.patchStatus(id, 'POSTED');
    await this.patchConfig(id, { journalEntryId: posted.id, postedAt: new Date().toISOString(), postedBy: userId });
    return this.findOne(organizationId, id);
  }

  // ---- AI posting preview (dry-run — does NOT write anything) ----
  // Mirrors post()'s journal construction but, for any line lacking an
  // accountId, asks the categorization AI to suggest the best expense/purchase
  // account. Returns the full proposed double-entry (Dr expense lines + Dr input
  // tax / Cr Trade Payables) with per-line provenance so the UI can show an
  // editable preview before the user confirms. Best-effort: AI failure falls
  // back to the default purchase account, never throws.
  async previewPosting(
    organizationId: string,
    dto: {
      lines?: Array<{ description?: string; amount?: number; accountId?: string | null }>;
      taxAmount?: number;
      totalAmount?: number;
      billNumber?: string;
    },
  ): Promise<{
    lines: Array<{
      role: 'line' | 'tax' | 'payable';
      lineIndex?: number;
      accountId: string | null;
      accountCode: string | null;
      accountName: string | null;
      debit: number;
      credit: number;
      description: string;
      source: 'existing' | 'ai' | 'fallback' | 'control';
      confidence?: number;
      reason?: string;
    }>;
    totalDebit: number;
    totalCredit: number;
    balanced: boolean;
    warnings: string[];
  }> {
    const warnings: string[] = [];
    const billLines = Array.isArray(dto.lines) ? dto.lines : [];
    const taxAmount = ROUND(dto.taxAmount || 0);
    const billNumber = dto.billNumber || '';

    const settings = await this.prisma.accountingSetting.findUnique({ where: { organizationId } });
    const controls = (settings?.controlAccounts as any) || {};
    const creditorCode = controls.creditorControl || 'CL001';
    const taxCode = controls.taxLiabilities || 'CL900';

    const [creditor, taxAccount, fallbackPurchase] = await Promise.all([
      this.prisma.chartOfAccount.findFirst({
        where: { organizationId, code: creditorCode, isActive: true },
        select: { id: true, code: true, name: true },
      }),
      taxAmount > 0
        ? this.prisma.chartOfAccount.findFirst({
            where: { organizationId, code: taxCode, isActive: true },
            select: { id: true, code: true, name: true },
          })
        : Promise.resolve(null),
      this.prisma.chartOfAccount
        .findFirst({
          where: { organizationId, accountType: 'PURCHASE', isActive: true },
          orderBy: { code: 'asc' },
          select: { id: true, code: true, name: true },
        })
        .then((p) =>
          p ||
          this.prisma.chartOfAccount.findFirst({
            where: { organizationId, accountType: 'EXPENSE', isActive: true },
            orderBy: { code: 'asc' },
            select: { id: true, code: true, name: true },
          }),
        ),
    ]);

    if (!creditor) warnings.push(`Trade Payables account (${creditorCode}) not found — set it in Accounting Setup.`);
    if (taxAmount > 0 && !taxAccount) warnings.push(`Tax account (${taxCode}) not found — input-tax line is unassigned.`);

    // AI-suggest accounts only for lines that don't already have one.
    const needIdx = billLines.map((l, i) => ({ l, i })).filter(({ l }) => !l.accountId);
    const suggestions: Array<{ accountId: string; code: string; name: string; confidence: number; reason: string } | null> =
      billLines.map(() => null);
    if (needIdx.length > 0) {
      const batch = await this.coa.suggestAccountsBatch(
        organizationId,
        needIdx.map(({ l }) => l.description || ''),
        ['PURCHASE', 'EXPENSE', 'EXCHANGE_GAIN_LOSS'],
      );
      needIdx.forEach(({ i }, k) => {
        suggestions[i] = batch[k];
      });
    }

    const outLines: Array<{
      role: 'line' | 'tax' | 'payable';
      lineIndex?: number;
      accountId: string | null;
      accountCode: string | null;
      accountName: string | null;
      debit: number;
      credit: number;
      description: string;
      source: 'existing' | 'ai' | 'fallback' | 'control';
      confidence?: number;
      reason?: string;
    }> = [];

    let sumDebit = 0;
    for (const [i, l] of billLines.entries()) {
      const amt = ROUND(l.amount || 0);
      sumDebit += amt;
      const desc = l.description || `Bill ${billNumber}`.trim();

      if (l.accountId) {
        const a = await this.prisma.chartOfAccount.findFirst({
          where: { id: l.accountId, organizationId },
          select: { id: true, code: true, name: true },
        });
        outLines.push({ role: 'line', lineIndex: i, accountId: a?.id ?? null, accountCode: a?.code ?? null, accountName: a?.name ?? null, debit: amt, credit: 0, description: desc, source: 'existing' });
      } else if (suggestions[i]) {
        const s = suggestions[i]!;
        outLines.push({ role: 'line', lineIndex: i, accountId: s.accountId, accountCode: s.code, accountName: s.name, debit: amt, credit: 0, description: desc, source: 'ai', confidence: s.confidence, reason: s.reason });
      } else if (fallbackPurchase) {
        outLines.push({ role: 'line', lineIndex: i, accountId: fallbackPurchase.id, accountCode: fallbackPurchase.code, accountName: fallbackPurchase.name, debit: amt, credit: 0, description: desc, source: 'fallback', reason: 'Default purchase account (no AI suggestion)' });
      } else {
        warnings.push(`Line ${i + 1}: no account could be resolved (no AI suggestion and no default purchase account).`);
        outLines.push({ role: 'line', lineIndex: i, accountId: null, accountCode: null, accountName: null, debit: amt, credit: 0, description: desc, source: 'fallback' });
      }
    }

    if (taxAmount > 0) {
      sumDebit += taxAmount;
      outLines.push({ role: 'tax', accountId: taxAccount?.id ?? null, accountCode: taxAccount?.code ?? null, accountName: taxAccount?.name ?? null, debit: taxAmount, credit: 0, description: `Input tax — ${billNumber}`.trim(), source: 'control' });
    }

    // Credit side: prefer the bill's explicit gross; otherwise force balance to
    // the computed debit total.
    const gross = ROUND(dto.totalAmount != null ? dto.totalAmount : sumDebit);
    outLines.push({ role: 'payable', accountId: creditor?.id ?? null, accountCode: creditor?.code ?? null, accountName: creditor?.name ?? null, debit: 0, credit: gross, description: `Bill ${billNumber} — Trade Payables`.trim(), source: 'control' });

    const totalDebit = ROUND(sumDebit);
    const totalCredit = gross;
    const balanced = totalDebit === totalCredit;
    if (!balanced) {
      warnings.push(`Entry is out of balance: Dr ${totalDebit.toFixed(2)} vs Cr ${totalCredit.toFixed(2)}. Check that line amounts + tax equal the bill total.`);
    }

    return { lines: outLines, totalDebit, totalCredit, balanced, warnings };
  }

  async voidBill(organizationId: string, id: string, userId?: string) {
    const bill = await this.findOne(organizationId, id);
    if (bill.status === 'VOID') return bill;
    if (bill.status === 'POSTED' && bill.journalEntryId) {
      await this.journal.void(organizationId, bill.journalEntryId, userId);
    }
    await this.patchStatus(id, 'VOID');
    await this.patchConfig(id, { voidedAt: new Date().toISOString(), voidedBy: userId });
    return this.findOne(organizationId, id);
  }

  // ---- internal status / config patchers ----
  private async patchStatus(id: string, billStatus: BillStatus) {
    const doc = await this.prisma.document.findUniqueOrThrow({ where: { id }, select: { config: true } });
    const config = { ...((doc.config as any) || {}), billStatus };
    await this.prisma.document.update({
      where: { id },
      data: { status: toDocStatus(billStatus) as any, config: config as Prisma.InputJsonValue },
    });
  }
  private async patchConfig(id: string, patch: Record<string, any>) {
    const doc = await this.prisma.document.findUniqueOrThrow({ where: { id }, select: { config: true } });
    const config = { ...((doc.config as any) || {}), ...patch };
    await this.prisma.document.update({ where: { id }, data: { config: config as Prisma.InputJsonValue } });
  }

  // ---------- 3-way match from PO ----------
  async createFromPo(organizationId: string, poId: string, userId?: string) {
    const po = await this.prisma.document.findFirst({
      where: { id: poId, organizationId, type: { in: ['PURCHASE_ORDER', 'PO'] } },
    });
    if (!po) throw new NotFoundException('Purchase order not found');

    const cfg: any = po.config || {};
    const items: any[] = cfg.items || [];
    if (items.length === 0) throw new BadRequestException('PO has no line items to convert');

    const supplierName = cfg?.supplier?.name || cfg?.supplierName;
    let supplier = supplierName
      ? await this.prisma.supplier.findFirst({ where: { organizationId, name: supplierName } })
      : null;
    if (!supplier) {
      if (!supplierName) throw new BadRequestException('PO has no supplier — set supplier before billing');
      supplier = await this.prisma.supplier.create({ data: { organizationId, name: supplierName } });
    }

    const lines: BillLine[] = items.map((it) => ({
      description: it.description || it.itemName,
      quantity: parseFloat(it.quantity) || 0,
      unitPrice: parseFloat(it.unitPrice) || 0,
      amount: parseFloat(it.amount) || parseFloat(it.quantity) * parseFloat(it.unitPrice) || 0,
    }));

    const subtotal = ROUND(lines.reduce((s, l) => s + l.amount, 0));
    const orgRate = (await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { taxRate: true },
    }))?.taxRate ?? 0;
    const taxAmount = ROUND(subtotal * (orgRate / 100));

    const explicitGross = parseFloat(cfg?.nettTotal ?? cfg?.summary?.grandTotal ?? 'NaN');
    let matchStatus = 'MATCHED';
    const matchDetails: any = { poTotal: explicitGross, billTotal: subtotal + taxAmount };
    if (!Number.isNaN(explicitGross) && Math.abs(explicitGross - (subtotal + taxAmount)) > 0.01) {
      matchStatus = 'AMOUNT_DIFF';
      matchDetails.diff = ROUND(subtotal + taxAmount - explicitGross);
    }

    const bill = await this.create(organizationId, userId, {
      supplierId: supplier.id,
      billNumber: `BILL-from-${po.name || po.id.slice(0, 8)}`,
      billDate: new Date().toISOString(),
      lines,
      taxAmount,
      sourcePoId: poId,
      inboundChannel: 'FROM_PO',
      inboundMeta: { poName: po.name, poDate: cfg.date },
    });
    await this.patchConfig(bill.id, { matchStatus, matchDetails });
    return this.findOne(organizationId, bill.id);
  }

  // ---------- PDF / LLM extraction (unchanged) ----------
  // Normalize a company name for fuzzy comparison: lowercase, strip all
  // punctuation to single spaces. "OSIRIS TECHNOLOGY PTE. LTD." and
  // "Osiris Technology Pte Ltd" both become "osiris technology pte ltd".
  private normalizeName(s: string): string {
    return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // The "core" name with common company suffixes dropped, so "Acme Pte Ltd"
  // and "Acme Pte. Ltd. (SG)" still match on the distinctive part ("acme").
  private coreName(s: string): string {
    return this.normalizeName(s)
      .replace(/\b(pte|ltd|llp|inc|co|company|limited|corporation|corp|sdn|bhd|pvt|private)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Best-effort fuzzy supplier match used by bill extraction. Tolerant of
  // punctuation/format differences and partial names; returns null below a
  // confidence floor so a wrong supplier is never silently auto-selected.
  private async matchSupplier(organizationId: string, supplierName: string) {
    const target = this.normalizeName(supplierName);
    const targetCore = this.coreName(supplierName);
    if (!target) return null;

    const suppliers = await this.prisma.supplier.findMany({
      where: { organizationId },
      select: { id: true, name: true },
    });

    let best: { id: string; name: string } | null = null;
    let bestScore = 0;
    for (const s of suppliers) {
      const n = this.normalizeName(s.name);
      const core = this.coreName(s.name);
      let score = 0;
      if (n && n === target) score = 1;
      else if (n && (n.includes(target) || target.includes(n))) score = 0.95;
      else if (core && targetCore && (core === targetCore || core.includes(targetCore) || targetCore.includes(core))) score = 0.9;
      else {
        // Token (Jaccard) overlap on the core tokens.
        const a = new Set(targetCore.split(' ').filter(Boolean));
        const b = new Set(core.split(' ').filter(Boolean));
        if (a.size && b.size) {
          let inter = 0;
          for (const t of a) if (b.has(t)) inter++;
          score = inter / new Set([...a, ...b]).size;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = { id: s.id, name: s.name };
      }
    }
    return bestScore >= 0.6 ? best : null;
  }

  async extractFromFile(
    organizationId: string,
    base64Data: string,
    mediaType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' = 'application/pdf',
  ) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new BadRequestException('Bill extraction not configured (missing ANTHROPIC_API_KEY)');

    const commaIdx = base64Data.indexOf(',');
    const headerMatch = base64Data.match(/^data:([a-zA-Z/+]+);base64,/);
    const data = commaIdx >= 0 && headerMatch ? base64Data.slice(commaIdx + 1) : base64Data;
    const detectedMedia = (headerMatch?.[1] as any) ?? mediaType;

    const client = new Anthropic({ apiKey });
    const system = `You are extracting structured data from a supplier bill / invoice. Output ONLY a JSON object with:
  - "supplierName": string (vendor name from header)
  - "billNumber": string (their invoice number)
  - "billDate": YYYY-MM-DD
  - "dueDate": YYYY-MM-DD or null
  - "currency": ISO code, default "SGD"
  - "lines": [{ "description": string, "quantity": number, "unitPrice": number, "amount": number }]
  - "subtotal": number (excl tax)
  - "taxAmount": number
  - "totalAmount": number (subtotal + tax)
Use null when you can't read a field. Do not include any prose outside the JSON.`;

    const content: any[] = [];
    if (detectedMedia === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } });
    } else {
      content.push({ type: 'image', source: { type: 'base64', media_type: detectedMedia, data } });
    }
    content.push({ type: 'text', text: 'Extract supplier bill data per the system schema.' });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system,
      messages: [{ role: 'user', content }],
    });

    const text = response.content.find((b) => b.type === 'text');
    const raw = text && 'text' in text ? (text as any).text.trim() : '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return {
        ...parsed,
        supplierIdGuess: parsed.supplierName
          ? await this.matchSupplier(organizationId, parsed.supplierName)
          : null,
        meta: { extractedBy: 'claude-sonnet-4-6', detectedMedia },
      };
    } catch {
      return null;
    }
  }

  // ---------- AP Aging ----------
  async apAging(organizationId: string, asOfDate: Date = new Date()) {
    const bills = await this.list(organizationId, { limit: 100_000 });
    // Only consider posted (or Xero-imported approved/paid) bills with outstanding > 0
    const considered = bills.filter((b) => b.status === 'POSTED' || b.status === 'PAID');

    const supplierMap = new Map<string, string>(
      (await this.prisma.supplier.findMany({
        where: { organizationId, id: { in: Array.from(new Set(considered.map((b) => b.supplierId).filter(Boolean) as string[])) } },
        select: { id: true, name: true },
      })).map((s) => [s.id, s.name]),
    );

    type Bucket = { current: number; days30: number; days60: number; days90: number; days120Plus: number };
    type SupplierRow = { supplierId: string; supplierName: string; outstanding: number; aging: Bucket };
    const blankBucket = (): Bucket => ({ current: 0, days30: 0, days60: 0, days90: 0, days120Plus: 0 });
    const bySupplier = new Map<string, SupplierRow>();
    const today = asOfDate;

    for (const b of considered) {
      const outstanding = ROUND(b.totalAmount - (b.amountPaid || 0));
      if (outstanding <= 0) continue;
      const dueDate = b.dueDate ? new Date(b.dueDate) : new Date(b.billDate);
      const ageDays = Math.floor((today.getTime() - dueDate.getTime()) / DAY_MS);
      const supplierId = b.supplierId || 'unknown';
      const row =
        bySupplier.get(supplierId) ?? {
          supplierId,
          supplierName: supplierMap.get(supplierId) || b.supplier?.name || 'Unknown',
          outstanding: 0,
          aging: blankBucket(),
        };
      row.outstanding = ROUND(row.outstanding + outstanding);
      if (ageDays <= 30) row.aging.current += outstanding;
      else if (ageDays <= 60) row.aging.days30 += outstanding;
      else if (ageDays <= 90) row.aging.days60 += outstanding;
      else if (ageDays <= 120) row.aging.days90 += outstanding;
      else row.aging.days120Plus += outstanding;
      bySupplier.set(supplierId, row);
    }

    const suppliers = Array.from(bySupplier.values()).sort((a, b) => b.outstanding - a.outstanding);
    const totals = suppliers.reduce(
      (s, r) => ({
        current: s.current + r.aging.current,
        days30: s.days30 + r.aging.days30,
        days60: s.days60 + r.aging.days60,
        days90: s.days90 + r.aging.days90,
        days120Plus: s.days120Plus + r.aging.days120Plus,
      }),
      blankBucket(),
    );
    const totalOutstanding = suppliers.reduce((s, r) => s + r.outstanding, 0);
    for (const r of suppliers) {
      r.aging = {
        current: ROUND(r.aging.current),
        days30: ROUND(r.aging.days30),
        days60: ROUND(r.aging.days60),
        days90: ROUND(r.aging.days90),
        days120Plus: ROUND(r.aging.days120Plus),
      };
    }
    return {
      asOfDate: asOfDate.toISOString(),
      suppliers,
      totals: {
        current: ROUND(totals.current),
        days30: ROUND(totals.days30),
        days60: ROUND(totals.days60),
        days90: ROUND(totals.days90),
        days120Plus: ROUND(totals.days120Plus),
      },
      totalOutstanding: ROUND(totalOutstanding),
    };
  }

  // ---------- Payment Voucher (AP) ----------
  async recordPayment(
    organizationId: string,
    billId: string,
    dto: {
      amount: number;
      paymentDate: string;
      paymentMethod: string;
      bankAccountId: string;
      reference?: string;
      notes?: string;
      attachments?: Array<{ fileKey: string; fileName: string; mimeType?: string; label?: string }>;
    },
    userId: string,
  ) {
    if (!dto.amount || dto.amount <= 0) throw new BadRequestException('amount must be > 0');
    const bill = await this.findOne(organizationId, billId);
    if (bill.status !== 'POSTED' && bill.status !== 'PAID') {
      throw new BadRequestException(`Can only pay a POSTED bill, got ${bill.status}`);
    }
    if (bill.status === 'PAID') throw new BadRequestException('Bill already fully paid');
    const outstanding = ROUND(bill.totalAmount - (bill.amountPaid || 0));
    if (dto.amount > outstanding + 0.01) {
      throw new BadRequestException(`Amount ${dto.amount.toFixed(2)} exceeds outstanding ${outstanding.toFixed(2)}`);
    }

    const bankAccount = await this.prisma.chartOfAccount.findFirst({
      where: { id: dto.bankAccountId, organizationId, isActive: true },
    });
    if (!bankAccount) throw new BadRequestException('Bank account not found');
    if (!this.journal.isCashOrBankAccount(bankAccount)) {
      throw new BadRequestException(`${bankAccount.code} (${bankAccount.name}) is not a recognized cash/bank account`);
    }

    const settings = await this.prisma.accountingSetting.findUnique({ where: { organizationId } });
    const controls = (settings?.controlAccounts as any) || {};
    const creditorCode = controls.creditorControl || 'CL001';
    const creditor = await this.prisma.chartOfAccount.findFirst({
      where: { organizationId, code: creditorCode, isActive: true },
    });
    if (!creditor) throw new BadRequestException(`Trade Payables account (${creditorCode}) not found`);

    const entry = await this.journal.create(
      organizationId,
      {
        entryDate: dto.paymentDate,
        type: 'PAYMENT' as any,
        reference: dto.reference || bill.billNumber,
        description: `Payment voucher — bill ${bill.billNumber}`,
        lines: [
          { accountId: creditor.id, debit: dto.amount, credit: 0, description: `Settle AP — ${bill.billNumber}` },
          { accountId: bankAccount.id, debit: 0, credit: dto.amount, description: `${dto.paymentMethod}${dto.reference ? ` ref ${dto.reference}` : ''}` },
        ],
      },
      userId,
    );
    const posted = await this.journal.post(organizationId, entry.id, userId);

    const newPaid = ROUND((bill.amountPaid || 0) + dto.amount);
    const fullyPaid = Math.abs(bill.totalAmount - newPaid) < 0.01;

    const stampedAttachments = (dto.attachments || []).map((a) => ({
      ...a,
      uploadedAt: new Date().toISOString(),
      uploadedBy: userId,
    }));

    if (!bill.supplierId) throw new BadRequestException('Bill is not linked to a supplier');
    const [payment] = await this.prisma.$transaction([
      this.prisma.billPayment.create({
        data: {
          organizationId,
          billId,
          supplierId: bill.supplierId,
          amount: dto.amount,
          paymentDate: new Date(dto.paymentDate),
          paymentMethod: dto.paymentMethod,
          reference: dto.reference,
          notes: dto.notes,
          bankAccountId: bankAccount.id,
          journalEntryId: posted.id,
          attachments: stampedAttachments as any,
          createdBy: userId,
        },
      }),
    ]);

    // Update the Bill (Document) record's config with new amountPaid + status
    await this.patchConfig(billId, { amountPaid: newPaid });
    if (fullyPaid) await this.patchStatus(billId, 'PAID');
    return payment;
  }

  async listPayments(organizationId: string, billId: string) {
    return this.prisma.billPayment.findMany({
      where: { organizationId, billId },
      orderBy: { paymentDate: 'desc' },
    });
  }

  // ---------- Attachments on the bill itself ----------
  async addAttachments(
    organizationId: string,
    billId: string,
    files: Array<{ fileKey: string; fileName: string; mimeType?: string; label?: string }>,
    userId: string,
  ) {
    const doc = await this.prisma.document.findFirst({
      where: { id: billId, organizationId, type: 'BILL' },
      select: { id: true, attachments: true },
    });
    if (!doc) throw new NotFoundException('Bill not found');
    const existing = (doc.attachments as any[]) || [];
    const existingKeys = new Set(existing.map((a) => a.fileKey));
    const stamped = files
      .filter((f) => !existingKeys.has(f.fileKey))
      .map((f) => ({ ...f, uploadedAt: new Date().toISOString(), uploadedBy: userId }));
    await this.prisma.document.update({
      where: { id: billId },
      data: { attachments: [...existing, ...stamped] as any },
    });
    return this.findOne(organizationId, billId);
  }
}
