import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { CustomersService } from '../customers/customers.service';
import { BillsService } from '../bills/bills.service';
import { DocumentNumberingService } from '../document-numbering/document-numbering.service';
import { JournalAutoPostService } from '../journal/journal-auto-post.service';
import { PostingQueueService } from '../posting-queue/posting-queue.service';
import { PostingPreviewService } from '../posting-preview/posting-preview.service';
import { V1CreateDocumentDto, V1Party } from './dto/v1-document.dto';

// ---------------------------------------------------------------------------
// External /v1 document creation. Maps the stable public payload onto the
// internal Document.config shape, resolving/creating the counterparty and
// (unless the API key has autoPost) landing the document as glPosting=pending
// so it flows through the accountant Posting Queue. Idempotent per externalId.
// ---------------------------------------------------------------------------

const ROUND = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

const TYPE_ALIASES: Record<string, string> = {
  INVOICE: 'INVOICE',
  TI: 'INVOICE',
  TI2: 'INVOICE',
  BILL: 'BILL',
  CREDIT_NOTE: 'CREDIT_NOTE',
  CN: 'CREDIT_NOTE',
};

interface ApiKeyCtx {
  id: string;
  name: string;
  autoPost: boolean;
}

@Injectable()
export class V1DocumentsService {
  private readonly logger = new Logger(V1DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly bills: BillsService,
    private readonly numbering: DocumentNumberingService,
    private readonly autoPost: JournalAutoPostService,
    private readonly postingQueue: PostingQueueService,
    private readonly postingPreview: PostingPreviewService,
  ) {}

  // ---- create (or idempotently update) ------------------------------------
  async create(organizationId: string, apiKey: ApiKeyCtx, dto: V1CreateDocumentDto) {
    const type = TYPE_ALIASES[(dto.type || '').toUpperCase().trim()];
    if (!type) {
      throw new BadRequestException(
        `Unsupported type "${dto.type}" — v1 supports INVOICE, BILL, CREDIT_NOTE`,
      );
    }
    if (!Array.isArray(dto.lines) || dto.lines.length === 0) {
      throw new BadRequestException('At least one line is required');
    }

    return type === 'BILL'
      ? this.createBill(organizationId, apiKey, dto)
      : this.createSalesDoc(organizationId, apiKey, type as 'INVOICE' | 'CREDIT_NOTE', dto);
  }

  // ---- INVOICE / CREDIT_NOTE ----------------------------------------------
  private async createSalesDoc(
    organizationId: string,
    apiKey: ApiKeyCtx,
    type: 'INVOICE' | 'CREDIT_NOTE',
    dto: V1CreateDocumentDto,
  ) {
    if (!dto.customer?.name && !dto.customer?.uen) {
      throw new BadRequestException(`${type} requires customer.name or customer.uen`);
    }

    const { subTotal, taxAmount, totalAmount, lines } = this.computeAmounts(dto);
    const customer = await this.resolveCustomer(organizationId, dto.customer);
    const dateIso = this.toIso(dto.date) || new Date().toISOString();
    const number = await this.resolveNumber(organizationId, type, dto.number);
    const templateId = await this.resolveTemplateId(organizationId, type);
    const gstPercent = subTotal > 0 ? Math.round((taxAmount / subTotal) * 100) : 0;

    const config: Prisma.InputJsonValue = {
      date: dateIso,
      dueDate: this.toIso(dto.dueDate),
      documentNumber: number,
      reference: dto.reference ?? null,
      items: lines.map((l, i) => ({
        lineNumber: i + 1,
        description: l.description ?? '',
        quantity: l.quantity ?? 1,
        unitPrice: l.unitPrice ?? l.amount,
        amount: l.amount,
        taxAmount: l.taxAmount ?? 0,
        // GL accounts are an INTERNAL concern — never taken from external
        // callers. They're assigned by the AI/learned suggestion engine and
        // confirmed (or re-coded) by the accountant in the Posting Queue.
        accountCode: null,
        itemCode: null,
        taxType: null,
        discount: 0,
      })),
      customer: {
        id: customer.id,
        name: customer.name,
        address: dto.customer?.address ?? '',
        uen: dto.customer?.uen ?? '',
      },
      customerId: customer.id,
      billTo: dto.customer?.address ?? '',
      attention: {
        name: dto.customer?.attention ?? '',
        phone: dto.customer?.phone ?? '',
        email: dto.customer?.email ?? '',
      },
      subTotal,
      gstAmount: taxAmount,
      nettTotal: totalAmount,
      documentInfo: {
        documentNumber: number,
        date: dateIso,
        currency: dto.currency || 'SGD',
        gstPercent,
      },
      externalApi: {
        externalId: dto.externalId ?? null,
        apiKeyId: apiKey.id,
        apiKeyName: apiKey.name,
        source: 'public-api-v1',
        receivedAt: new Date().toISOString(),
        metadata: (dto.metadata as any) ?? null,
      },
      glPosting: {
        status: 'pending',
        journalEntryId: null,
        postedAt: null,
        postedBy: null,
        rejectedAt: null,
        rejectedBy: null,
        rejectReason: null,
        source: `api-key:${apiKey.name}`,
      },
      xeroImported: false,
    };

    // Idempotency: externalId first, then the document number.
    const existing = await this.findExisting(organizationId, type, dto.externalId, number);
    let documentId: string;
    let outcome: 'created' | 'updated';
    if (existing) {
      const prevGl = (existing.config as any)?.glPosting;
      const merged =
        prevGl && prevGl.status === 'posted' ? { ...(config as any), glPosting: prevGl } : config;
      await this.prisma.document.update({
        where: { id: existing.id },
        data: { name: number, documentTemplateId: templateId, status: 'confirmed', config: merged },
      });
      documentId = existing.id;
      outcome = 'updated';
    } else {
      const doc = await this.prisma.document.create({
        data: {
          organizationId,
          documentTemplateId: templateId,
          name: number,
          type,
          status: 'confirmed',
          config,
        },
        select: { id: true },
      });
      documentId = doc.id;
      outcome = 'created';
    }

    // Per-key auto-post; otherwise the doc waits in the Posting Queue.
    let posting: any = { status: 'pending' };
    if (apiKey.autoPost) {
      posting = await this.autoPostSalesDoc(organizationId, type, documentId, {
        number,
        customerName: customer.name,
        dateIso,
        subTotal,
        taxAmount,
        totalAmount,
        lines: lines.map((l) => ({ description: l.description, amount: l.amount })),
      });
    }

    return { id: documentId, type, number, outcome, customerId: customer.id, posting };
  }

  private async autoPostSalesDoc(
    organizationId: string,
    type: 'INVOICE' | 'CREDIT_NOTE',
    documentId: string,
    a: {
      number: string;
      customerName: string;
      dateIso: string;
      subTotal: number;
      taxAmount: number;
      totalAmount: number;
      lines?: Array<{ description?: string; amount: number }>;
    },
  ) {
    try {
      if (type === 'INVOICE') {
        // External callers never send GL accounts, so resolve each line via the
        // same AI/learned suggestion engine the accountant's review dialog uses,
        // stamp the suggestions onto the lines, then post per-line.
        const preview = await this.postingPreview.preview(organizationId, {
          type: 'INVOICE',
          documentNumber: a.number,
          taxAmount: a.taxAmount,
          totalAmount: a.totalAmount,
          lines: (a.lines || []).map((l) => ({ description: l.description, amount: l.amount })),
        });
        const picks = (preview?.lines || [])
          .filter((l: any) => l.role === 'line' && l.lineIndex != null && l.accountCode)
          .map((l: any) => ({ lineIndex: l.lineIndex, accountCode: l.accountCode }));
        if (picks.length) await this.postingQueue.applyAccounts(organizationId, documentId, picks);

        const res = await this.postingQueue.postBatch(organizationId, [documentId]);
        const r = res.results[0];
        return r?.ok
          ? { status: 'posted', journalEntryId: r.journalEntryId }
          : { status: 'pending', error: r?.error };
      }
      const entry = await this.autoPost.postFromCreditNote({
        organizationId,
        documentId,
        documentNumber: a.number,
        entryDate: new Date(a.dateIso),
        customerName: a.customerName,
        netAmount: a.subTotal,
        taxAmount: a.taxAmount,
        grossAmount: a.totalAmount,
      });
      if (!entry) return { status: 'pending', error: 'auto-post skipped (accounts not configured)' };
      await this.stampPosted(documentId, entry.id);
      return { status: 'posted', journalEntryId: entry.id };
    } catch (err: any) {
      this.logger.error(`auto-post failed for ${a.number}: ${err?.message}`);
      return { status: 'pending', error: err?.message };
    }
  }

  private async stampPosted(documentId: string, journalEntryId: string) {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId }, select: { config: true } });
    const c = (doc?.config as any) || {};
    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        config: {
          ...c,
          glPosting: {
            ...(c.glPosting || {}),
            status: 'posted',
            journalEntryId,
            postedAt: new Date().toISOString(),
          },
        } as Prisma.InputJsonValue,
      },
    });
  }

  // ---- BILL ---------------------------------------------------------------
  private async createBill(organizationId: string, apiKey: ApiKeyCtx, dto: V1CreateDocumentDto) {
    if (!dto.supplier?.name && !dto.supplier?.uen) {
      throw new BadRequestException('BILL requires supplier.name or supplier.uen');
    }

    const { subTotal, taxAmount, lines } = this.computeAmounts(dto);
    const supplier = await this.resolveSupplier(organizationId, dto.supplier);
    const number = await this.resolveNumber(organizationId, 'BILL', dto.number);
    const dateIso = this.toIso(dto.date) || new Date().toISOString();

    // GL accounts are internal — external callers never send them. Bill lines
    // go in uncoded; the AP review (AI/learned suggestions) assigns accounts.
    const billLines = lines.map((l) => ({
      description: l.description ?? '',
      quantity: l.quantity ?? 1,
      unitPrice: l.unitPrice ?? l.amount,
      amount: l.amount,
      taxAmount: l.taxAmount ?? 0,
    }));

    // Idempotency: update-in-place when the externalId/number already exists.
    const existing = await this.findExisting(organizationId, 'BILL', dto.externalId, number);
    let bill: any;
    let outcome: 'created' | 'updated';
    if (existing) {
      const billStatus = ((existing.config as any)?.billStatus || '').toUpperCase();
      if (billStatus && billStatus !== 'DRAFT' && billStatus !== 'PENDING_APPROVAL') {
        return {
          id: existing.id,
          type: 'BILL',
          number,
          outcome: 'skipped' as const,
          reason: `Bill is ${billStatus} — void and re-send to change it`,
        };
      }
      bill = await this.bills.update(organizationId, existing.id, {
        billNumber: number,
        billDate: dateIso,
        dueDate: this.toIso(dto.dueDate) ?? undefined,
        reference: dto.reference,
        lines: billLines,
        taxAmount,
      });
      outcome = 'updated';
    } else {
      bill = await this.bills.create(organizationId, undefined, {
        supplierId: supplier.id,
        billNumber: number,
        billDate: dateIso,
        dueDate: this.toIso(dto.dueDate) ?? undefined,
        reference: dto.reference,
        lines: billLines,
        taxAmount,
        inboundChannel: 'MANUAL',
        inboundMeta: {
          source: 'public-api-v1',
          apiKeyId: apiKey.id,
          apiKeyName: apiKey.name,
          externalId: dto.externalId ?? null,
          metadata: (dto.metadata as any) ?? null,
        },
      });
      outcome = 'created';
      // Stamp externalId where findExisting can see it on re-sends.
      if (dto.externalId) {
        const doc = await this.prisma.document.findUnique({ where: { id: bill.id }, select: { config: true } });
        await this.prisma.document.update({
          where: { id: bill.id },
          data: {
            config: {
              ...((doc?.config as any) || {}),
              externalApi: { externalId: dto.externalId, apiKeyId: apiKey.id, source: 'public-api-v1' },
            } as Prisma.InputJsonValue,
          },
        });
      }
    }

    let posting: any = { status: 'draft' };
    if (apiKey.autoPost) {
      try {
        const posted = await this.bills.post(organizationId, bill.id);
        posting = { status: 'posted', billStatus: posted.status };
      } catch (err: any) {
        posting = { status: 'draft', error: err?.message };
      }
    }

    return { id: bill.id, type: 'BILL', number, outcome, supplierId: supplier.id, posting };
  }

  // ---- reads --------------------------------------------------------------
  async get(organizationId: string, id: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, organizationId },
      select: { id: true, name: true, type: true, status: true, config: true, createdAt: true, updatedAt: true },
    });
    if (!doc) throw new NotFoundException('Document not found');
    return this.shape(doc);
  }

  async list(organizationId: string, q: { type?: string; page?: number; limit?: number; search?: string }) {
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
    const type = q.type ? TYPE_ALIASES[q.type.toUpperCase()] : undefined;
    const where: Prisma.DocumentWhereInput = {
      organizationId,
      ...(type ? { type } : { type: { in: ['INVOICE', 'BILL', 'CREDIT_NOTE'] } }),
      ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
    };
    const [total, docs] = await this.prisma.$transaction([
      this.prisma.document.count({ where }),
      this.prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: { id: true, name: true, type: true, status: true, config: true, createdAt: true, updatedAt: true },
      }),
    ]);
    return { total, page, limit, rows: docs.map((d) => this.shape(d)) };
  }

  private shape(d: { id: string; name: string | null; type: string; status: string; config: any; createdAt: Date; updatedAt: Date }) {
    const c = (d.config || {}) as any;
    return {
      id: d.id,
      number: d.name,
      type: d.type,
      status: d.status,
      date: c.date ?? c.billDate ?? null,
      customer: c.customer?.name ?? null,
      supplier: c.supplier?.name ?? null,
      subtotal: ROUND(c.subTotal ?? c.subtotal),
      taxAmount: ROUND(c.gstAmount ?? c.taxAmount),
      totalAmount: ROUND(c.nettTotal ?? c.totalAmount),
      glPosting: c.glPosting ?? (c.billStatus ? { billStatus: c.billStatus } : null),
      externalId: c.externalApi?.externalId ?? null,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  }

  // ---- helpers ------------------------------------------------------------
  private computeAmounts(dto: V1CreateDocumentDto) {
    const lines = (dto.lines || []).map((l) => ({
      ...l,
      amount: ROUND(l.amount ?? (l.quantity ?? 1) * (l.unitPrice ?? 0)),
    }));
    if (lines.some((l) => !(l.amount > 0))) {
      throw new BadRequestException('Every line needs a positive amount (or quantity × unitPrice)');
    }
    const subTotal = ROUND(lines.reduce((s, l) => s + l.amount, 0));
    const taxAmount = ROUND(
      dto.taxAmount !== undefined ? dto.taxAmount : lines.reduce((s, l) => s + (l.taxAmount ?? 0), 0),
    );
    const totalAmount = ROUND(dto.totalAmount !== undefined ? dto.totalAmount : subTotal + taxAmount);
    return { subTotal, taxAmount, totalAmount, lines };
  }

  private async resolveNumber(organizationId: string, type: string, given?: string): Promise<string> {
    const n = (given || '').trim();
    if (n) return n;
    const generated = await this.numbering.generateNumber(organizationId, type);
    if (!generated) {
      throw new BadRequestException(
        `No document number supplied and the organization has no ${type} number format — pass "number" or configure numbering`,
      );
    }
    return generated;
  }

  private async findExisting(
    organizationId: string,
    type: string,
    externalId?: string,
    number?: string,
  ) {
    if (externalId) {
      const byExternal = await this.prisma.document.findFirst({
        where: {
          organizationId,
          type,
          config: { path: ['externalApi', 'externalId'], equals: externalId },
        },
        select: { id: true, config: true },
      });
      if (byExternal) return byExternal;
    }
    if (number) {
      return this.prisma.document.findFirst({
        where: { organizationId, type, name: number },
        select: { id: true, config: true },
      });
    }
    return null;
  }

  private async resolveTemplateId(organizationId: string, type: string): Promise<string> {
    // Per-org activation first (primary, then any), then legacy isActive, then
    // any template of the type, else auto-create a minimal one (bills pattern).
    const selection = await this.prisma.organizationActiveTemplate.findFirst({
      where: { organizationId, type },
      orderBy: { isPrimary: 'desc' },
      select: { templateId: true },
    });
    if (selection) return selection.templateId;
    const active = await this.prisma.documentTemplate.findFirst({
      where: { organizationId, type, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (active) return active.id;
    const any = await this.prisma.documentTemplate.findFirst({
      where: { organizationId, type },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (any) return any.id;
    const created = await this.prisma.documentTemplate.create({
      data: {
        organizationId,
        name: type === 'CREDIT_NOTE' ? 'Credit Note' : 'Invoice',
        type,
        isActive: true,
        templateVariant: 'Default',
        designName: 'Default',
        config: {
          tableColumnOrder: ['description', 'quantity', 'unitPrice', 'taxAmount', 'amount'],
          columnLabels: {
            description: 'Description',
            quantity: 'Qty',
            unitPrice: 'Unit Price',
            taxAmount: 'Tax',
            amount: 'Amount',
          },
          formFields: [],
        } as any,
      },
      select: { id: true },
    });
    return created.id;
  }

  // Customer resolution: UEN (gstRegNo) → exact name → fuzzy name → create.
  private async resolveCustomer(organizationId: string, party: V1Party) {
    const name = (party.name || '').trim();
    const uen = (party.uen || '').trim();

    if (uen) {
      const byUen = await this.prisma.customer.findFirst({
        where: { organizationId, gstRegNo: { equals: uen, mode: 'insensitive' } },
        select: { id: true, name: true },
      });
      if (byUen) return byUen;
    }
    if (name) {
      const match = await this.fuzzyMatch(
        name,
        await this.prisma.customer.findMany({ where: { organizationId }, select: { id: true, name: true } }),
      );
      if (match) return match;
    }

    const contactName = (party.attention || '').trim();
    const contacts =
      contactName || party.phone || party.email
        ? [{ name: contactName || name || uen, phone: party.phone ?? null, email: party.email ?? null, isPrimary: true }]
        : [];
    try {
      const created = await this.customers.createCustomers(
        { name: name || uen, address: party.address ?? null, gstRegNo: uen || null, contacts } as any,
        organizationId,
      );
      return { id: created.id, name: created.name };
    } catch (err) {
      const fallback = name
        ? await this.prisma.customer.findFirst({
            where: { organizationId, name: { equals: name, mode: 'insensitive' } },
            select: { id: true, name: true },
          })
        : null;
      if (fallback) return fallback;
      throw err;
    }
  }

  // Supplier resolution mirrors customers but on the Supplier table.
  private async resolveSupplier(organizationId: string, party: V1Party) {
    const name = (party.name || '').trim();
    const uen = (party.uen || '').trim();

    if (uen) {
      const byUen = await this.prisma.supplier.findFirst({
        where: { organizationId, gstRegNo: { equals: uen, mode: 'insensitive' } },
        select: { id: true, name: true },
      });
      if (byUen) return byUen;
    }
    if (name) {
      const match = await this.fuzzyMatch(
        name,
        await this.prisma.supplier.findMany({ where: { organizationId }, select: { id: true, name: true } }),
      );
      if (match) return match;
    }
    try {
      return await this.prisma.supplier.create({
        data: {
          organizationId,
          name: name || uen,
          gstRegNo: uen || null,
          address: party.address ?? null,
          email: party.email ?? null,
          phone: party.phone ?? null,
        },
        select: { id: true, name: true },
      });
    } catch (err) {
      const fallback = name
        ? await this.prisma.supplier.findFirst({
            where: { organizationId, name: { equals: name, mode: 'insensitive' } },
            select: { id: true, name: true },
          })
        : null;
      if (fallback) return fallback;
      throw err;
    }
  }

  // Shared fuzzy matcher (same scoring as bills.matchSupplier): exact → substring
  // → core-name → token Jaccard, accept at ≥0.6.
  private fuzzyMatch(target: string, candidates: Array<{ id: string; name: string }>) {
    const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    const core = (s: string) =>
      norm(s)
        .replace(/\b(pte|ltd|llp|inc|co|company|limited|corporation|corp|sdn|bhd|pvt|private)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const t = norm(target);
    const tc = core(target);
    if (!t) return null;
    let best: { id: string; name: string } | null = null;
    let bestScore = 0;
    for (const c of candidates) {
      const n = norm(c.name);
      const cc = core(c.name);
      let score = 0;
      if (n && n === t) score = 1;
      else if (n && (n.includes(t) || t.includes(n))) score = 0.95;
      else if (cc && tc && (cc === tc || cc.includes(tc) || tc.includes(cc))) score = 0.9;
      else {
        const a = new Set(tc.split(' ').filter(Boolean));
        const b = new Set(cc.split(' ').filter(Boolean));
        if (a.size && b.size) {
          let inter = 0;
          for (const x of a) if (b.has(x)) inter++;
          score = inter / new Set([...a, ...b]).size;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return bestScore >= 0.6 ? best : null;
  }

  private toIso(dateStr?: string): string | null {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
}
