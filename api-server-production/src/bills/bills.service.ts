import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../common/prisma.service';
import { JournalService } from '../journal/journal.service';

// ---------------------------------------------------------------------------
// Bills (Accounts Payable) — supplier-side equivalent of invoices.
//
// Lifecycle:
//   DRAFT → (PENDING_APPROVAL if total > threshold) → POSTED → PAID → VOID
//
// On POSTED, we create a balanced JE:
//   Dr <line.accountId or default Purchases/Inventory>  net per line
//   Dr <tax control>                                   total tax
//     Cr Trade Payables (creditor control)             gross
//
// Records the JE id back on the bill row for traceability.
// ---------------------------------------------------------------------------

const ROUND = (n: number) => Math.round(n * 100) / 100;
const DAY_MS = 24 * 60 * 60 * 1000;

type BillLine = {
  description?: string;
  quantity?: number;
  unitPrice?: number;
  amount: number;
  accountId?: string; // optional explicit GL account for this line
  taxAmount?: number;
};

@Injectable()
export class BillsService {
  private readonly logger = new Logger(BillsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: JournalService,
  ) {}

  // ---------- CRUD ----------

  list(
    organizationId: string,
    opts?: { status?: string; supplierId?: string; startDate?: Date; endDate?: Date; limit?: number },
  ) {
    return this.prisma.bill.findMany({
      where: {
        organizationId,
        ...(opts?.status && { status: opts.status }),
        ...(opts?.supplierId && { supplierId: opts.supplierId }),
        ...((opts?.startDate || opts?.endDate) && {
          billDate: {
            ...(opts.startDate && { gte: opts.startDate }),
            ...(opts.endDate && { lte: opts.endDate }),
          },
        }),
      },
      orderBy: { billDate: 'desc' },
      take: opts?.limit ?? 200,
      include: { supplier: { select: { id: true, name: true, gstRegNo: true } } },
    });
  }

  async findOne(organizationId: string, id: string) {
    const row = await this.prisma.bill.findFirst({
      where: { id, organizationId },
      include: { supplier: true },
    });
    if (!row) throw new NotFoundException('Bill not found');
    return row;
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
      taxAmount?: number; // optional override; otherwise sum of line taxAmount
      sourcePoId?: string;
      inboundChannel?: 'MANUAL' | 'UPLOAD' | 'EMAIL' | 'FROM_PO';
      inboundMeta?: any;
    },
  ) {
    if (!dto.supplierId) throw new BadRequestException('supplierId required');
    if (!dto.billNumber?.trim()) throw new BadRequestException('billNumber required');
    if (!dto.lines || dto.lines.length === 0) throw new BadRequestException('At least one line required');

    // Compute totals.
    const subtotal = ROUND(dto.lines.reduce((s, l) => s + (l.amount || 0), 0));
    const taxAmount = ROUND(
      dto.taxAmount !== undefined ? dto.taxAmount : dto.lines.reduce((s, l) => s + (l.taxAmount || 0), 0),
    );
    const totalAmount = ROUND(subtotal + taxAmount);

    try {
      return await this.prisma.bill.create({
        data: {
          organizationId,
          supplierId: dto.supplierId,
          billNumber: dto.billNumber.trim(),
          billDate: new Date(dto.billDate),
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          reference: dto.reference,
          description: dto.description,
          subtotal,
          taxAmount,
          totalAmount,
          lines: dto.lines as any,
          sourcePoId: dto.sourcePoId ?? null,
          inboundChannel: dto.inboundChannel ?? 'MANUAL',
          inboundMeta: (dto.inboundMeta as any) ?? null,
          status: 'DRAFT',
          createdBy: userId,
        },
      });
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
    const data: any = {
      ...(dto.billNumber !== undefined && { billNumber: dto.billNumber }),
      ...(dto.billDate !== undefined && { billDate: new Date(dto.billDate) }),
      ...(dto.dueDate !== undefined && { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }),
      ...(dto.reference !== undefined && { reference: dto.reference }),
      ...(dto.description !== undefined && { description: dto.description }),
    };
    if (dto.lines !== undefined) {
      const subtotal = ROUND(dto.lines.reduce((s: number, l: BillLine) => s + (l.amount || 0), 0));
      const taxAmount = ROUND(
        dto.taxAmount !== undefined ? dto.taxAmount : dto.lines.reduce((s: number, l: BillLine) => s + (l.taxAmount || 0), 0),
      );
      data.lines = dto.lines;
      data.subtotal = subtotal;
      data.taxAmount = taxAmount;
      data.totalAmount = ROUND(subtotal + taxAmount);
    }
    return this.prisma.bill.update({ where: { id }, data });
  }

  // ---------- Workflow ----------

  // Submit a DRAFT bill. Routes to PENDING_APPROVAL if over threshold,
  // otherwise posts immediately.
  async submit(organizationId: string, id: string, userId?: string) {
    const bill = await this.findOne(organizationId, id);
    if (bill.status !== 'DRAFT') throw new BadRequestException(`Bill is ${bill.status}, can only submit DRAFT`);

    const settings = await this.prisma.accountingSetting.findUnique({ where: { organizationId } });
    const threshold = settings?.billApprovalThreshold ?? 0;
    if (threshold > 0 && bill.totalAmount > threshold) {
      return this.prisma.bill.update({
        where: { id },
        data: { status: 'PENDING_APPROVAL' },
      });
    }
    return this.post(organizationId, id, userId);
  }

  async approve(organizationId: string, id: string, userId?: string) {
    const bill = await this.findOne(organizationId, id);
    if (bill.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(`Bill is ${bill.status} — only PENDING_APPROVAL bills can be approved`);
    }
    await this.prisma.bill.update({
      where: { id },
      data: { approvedBy: userId, approvedAt: new Date() },
    });
    return this.post(organizationId, id, userId);
  }

  async reject(organizationId: string, id: string, _userId?: string) {
    const bill = await this.findOne(organizationId, id);
    if (bill.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Only PENDING_APPROVAL bills can be rejected');
    }
    return this.prisma.bill.update({ where: { id }, data: { status: 'DRAFT' } });
  }

  // Post → create JE, flip to POSTED. Internal.
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
    if (!creditor) {
      throw new BadRequestException(`Trade Payables account (${creditorCode}) not found`);
    }

    const taxAccount =
      bill.taxAmount > 0
        ? await this.prisma.chartOfAccount.findFirst({
            where: { organizationId, code: taxCode, isActive: true },
          })
        : null;

    // For lines without an explicit accountId, fall back to first PURCHASE
    // account (CS001 etc). Matches the existing PO auto-post default.
    const fallbackPurchase = await this.prisma.chartOfAccount.findFirst({
      where: { organizationId, accountType: 'PURCHASE', isActive: true },
      orderBy: { code: 'asc' },
    });

    const lines: Array<{ accountId: string; debit: number; credit: number; description: string }> = [];
    for (const [i, l] of (bill.lines as any[]).entries()) {
      const accountId = l.accountId || fallbackPurchase?.id;
      if (!accountId) {
        throw new BadRequestException(
          `Bill line ${i + 1}: no accountId and no fallback PURCHASE account in chart`,
        );
      }
      lines.push({
        accountId,
        debit: ROUND(l.amount || 0),
        credit: 0,
        description: l.description || `Bill ${bill.billNumber}`,
      });
    }
    if (bill.taxAmount > 0 && taxAccount) {
      lines.push({
        accountId: taxAccount.id,
        debit: bill.taxAmount,
        credit: 0,
        description: `Input tax — ${bill.billNumber}`,
      });
    }
    lines.push({
      accountId: creditor.id,
      debit: 0,
      credit: bill.totalAmount,
      description: `Bill ${bill.billNumber}`,
    });

    const entry = await this.journal.create(
      organizationId,
      {
        entryDate: bill.billDate.toISOString(),
        type: 'BILL' as any, // type lives in the JournalEntry.type field; just a tag
        reference: bill.billNumber,
        description: `Bill from supplier (id=${bill.supplierId})`,
        lines,
      },
      userId,
    );
    const posted = await this.journal.post(organizationId, entry.id, userId);

    return this.prisma.bill.update({
      where: { id },
      data: {
        status: 'POSTED',
        journalEntryId: posted.id,
        postedAt: new Date(),
        postedBy: userId,
      },
    });
  }

  async voidBill(organizationId: string, id: string, userId?: string) {
    const bill = await this.findOne(organizationId, id);
    if (bill.status === 'VOID') return bill;
    // Reverse the JE if posted.
    if (bill.status === 'POSTED' && bill.journalEntryId) {
      await this.journal.void(organizationId, bill.journalEntryId, userId);
    }
    return this.prisma.bill.update({
      where: { id },
      data: { status: 'VOID', voidedAt: new Date(), voidedBy: userId },
    });
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

    // Find supplier by name (best-effort) — PO captures supplier by free text.
    const supplierName = cfg?.supplier?.name || cfg?.supplierName;
    let supplier = supplierName
      ? await this.prisma.supplier.findFirst({ where: { organizationId, name: supplierName } })
      : null;
    if (!supplier) {
      // Auto-create a supplier record from the PO's supplier name so the bill links cleanly.
      if (!supplierName) throw new BadRequestException('PO has no supplier — set supplier before billing');
      supplier = await this.prisma.supplier.create({
        data: { organizationId, name: supplierName },
      });
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

    // Match check vs the original PO totals (best-effort)
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
    return this.prisma.bill.update({
      where: { id: bill.id },
      data: { matchStatus, matchDetails },
    });
  }

  // ---------- PDF / LLM extraction ----------

  // Accepts a base64-encoded PDF or image of a supplier bill. Calls Claude
  // vision, returns a structured guess for the user to review + save.
  async extractFromFile(
    organizationId: string,
    base64Data: string,
    mediaType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' = 'application/pdf',
  ) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new BadRequestException('Bill extraction not configured (missing ANTHROPIC_API_KEY)');

    // Strip data: URL prefix if present.
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
        // Try to link the supplier name to an existing supplier record.
        supplierIdGuess: parsed.supplierName
          ? (await this.prisma.supplier.findFirst({
              where: { organizationId, name: { contains: parsed.supplierName, mode: 'insensitive' } },
              select: { id: true, name: true },
            })) || null
          : null,
        meta: { extractedBy: 'claude-sonnet-4-6', detectedMedia },
      };
    } catch {
      return null;
    }
  }

  // ---------- AP Aging report ----------

  async apAging(organizationId: string, asOfDate: Date = new Date()) {
    const bills = await this.prisma.bill.findMany({
      where: {
        organizationId,
        status: { in: ['POSTED'] },
        // Not fully paid yet
      },
      include: { supplier: { select: { id: true, name: true } } },
    });

    const today = asOfDate;
    type Bucket = { current: number; days30: number; days60: number; days90: number; days120Plus: number };
    type SupplierRow = { supplierId: string; supplierName: string; outstanding: number; aging: Bucket };

    const bySupplier = new Map<string, SupplierRow>();
    const blankBucket = (): Bucket => ({ current: 0, days30: 0, days60: 0, days90: 0, days120Plus: 0 });

    for (const b of bills) {
      const outstanding = ROUND(b.totalAmount - (b.amountPaid || 0));
      if (outstanding <= 0) continue;
      const ageDays = b.dueDate
        ? Math.floor((today.getTime() - b.dueDate.getTime()) / DAY_MS)
        : Math.floor((today.getTime() - b.billDate.getTime()) / DAY_MS);

      const row =
        bySupplier.get(b.supplierId) ?? {
          supplierId: b.supplierId,
          supplierName: b.supplier?.name || 'Unknown',
          outstanding: 0,
          aging: blankBucket(),
        };
      row.outstanding = ROUND(row.outstanding + outstanding);

      if (ageDays <= 30) row.aging.current += outstanding;
      else if (ageDays <= 60) row.aging.days30 += outstanding;
      else if (ageDays <= 90) row.aging.days60 += outstanding;
      else if (ageDays <= 120) row.aging.days90 += outstanding;
      else row.aging.days120Plus += outstanding;

      bySupplier.set(b.supplierId, row);
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

    // Round bucket totals.
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
}
