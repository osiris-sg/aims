import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { CustomersService } from '../customers/customers.service';
import { IngestBatchDto, IngestClient, IngestInvoice } from './dto/ingest-batch.dto';

// ---------------------------------------------------------------------------
// Biofuel weighbridge JSON batch ingestion.
//
// Creates Document(type='INVOICE', status='confirmed') rows in a "pending GL
// posting" state (config.glPosting.status='pending'). It DELIBERATELY does NOT
// call journalAutoPost.postFromInvoice — these invoices wait in the Posting
// Queue (Feature B) for an accountant to review and post (Feature C).
//
// SCOPED TO BIOFUEL ONLY for now — the payload mapping (weighbridge metadata,
// disposal-revenue account 209) is specific to their business. Generalise later
// by resolving the org from platform.uen against Organization.registrationNumber.
// ---------------------------------------------------------------------------

// Biofuel Industries Pte Ltd — the only org this endpoint serves right now.
const BIOFUEL_ORG_ID = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const BIOFUEL_UEN = '200303416N';

// "Sales - Disposable of waste materials" in Biofuel's chart of accounts.
const DISPOSAL_REVENUE_ACCOUNT = '209';

export interface PerInvoiceResult {
  invoiceNumber: string;
  transactionId: string;
  outcome: 'created' | 'updated' | 'failed';
  documentId?: string;
  error?: string;
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly audit: AuditService,
  ) {}

  async ingestBatch(payload: IngestBatchDto) {
    // --- Validate the batch envelope -------------------------------------
    if (!payload || typeof payload !== 'object') {
      throw new BadRequestException('Missing or invalid JSON body');
    }
    const platformUen = (payload.platform?.uen || '').replace(/\s+/g, '');
    if (platformUen && platformUen !== BIOFUEL_UEN) {
      throw new BadRequestException(
        `This ingestion endpoint only accepts Biofuel batches (platform.uen must be ${BIOFUEL_UEN}); got "${payload.platform?.uen}"`,
      );
    }
    // Postpaid: ONE consolidated period invoice per request — own structure.
    if ((payload.type || '').toLowerCase() === 'postpaid_consolidated') {
      return this.ingestPostpaid(payload);
    }

    const invoices = Array.isArray(payload.invoices) ? payload.invoices : [];
    if (invoices.length === 0) {
      throw new BadRequestException('Payload has no invoices');
    }

    const organizationId = BIOFUEL_ORG_ID;
    const templateId = await this.resolveInvoiceTemplateId(organizationId);
    const batchDateIso = this.toIso(payload.date) || new Date().toISOString();

    // Cache customers resolved within this batch to avoid duplicate creates
    // when several invoices reference the same client.
    const customerCache = new Map<string, { id: string; name: string }>();

    const results: PerInvoiceResult[] = [];
    let customersCreated = 0;

    for (const inv of invoices) {
      try {
        const { result, createdCustomer } = await this.ingestOne(
          inv,
          organizationId,
          templateId,
          batchDateIso,
          payload,
          customerCache,
        );
        if (createdCustomer) customersCreated++;
        results.push(result);
      } catch (err: any) {
        this.logger.error(
          `Failed to ingest invoice ${inv?.invoiceNumber ?? '(unknown)'}: ${err?.message}`,
        );
        results.push({
          invoiceNumber: inv?.invoiceNumber ?? '(unknown)',
          transactionId: inv?.transactionId ?? '(unknown)',
          outcome: 'failed',
          error: err?.message ?? 'Unknown error',
        });
      }
    }

    const created = results.filter((r) => r.outcome === 'created').length;
    const updated = results.filter((r) => r.outcome === 'updated').length;
    const failed = results.filter((r) => r.outcome === 'failed').length;

    return {
      organizationId,
      org: 'Biofuel Industries Pte Ltd',
      batchType: payload.type ?? null,
      batchDate: payload.date ?? null,
      totalInvoices: invoices.length,
      created,
      updated,
      failed,
      customersCreated,
      results,
    };
  }

  // -------------------------------------------------------------------------
  // postpaid_consolidated: ONE consolidated invoice covering a billing period.
  // Idempotency key = invoice.invoiceNumber. Dates arrive as DD/MM/YYYY.
  // Postpaid = the client has NOT paid yet: the invoice queues for review and
  // posts revenue-only (Dr AR / Cr 209 / Cr GST); AR stays open until payment.
  // `paymentMethod` (bank_transfer | airwallex) is the EXPECTED rail — stored
  // for the accountant, no settlement JE at posting time.
  // -------------------------------------------------------------------------
  private async ingestPostpaid(payload: IngestBatchDto) {
    const header = payload.invoice;
    if (!header?.invoiceNumber?.trim()) {
      throw new BadRequestException('postpaid_consolidated requires invoice.invoiceNumber');
    }
    const summaries = Array.isArray(payload.materialSummaries) ? payload.materialSummaries : [];
    if (summaries.length === 0) {
      throw new BadRequestException('postpaid_consolidated requires materialSummaries');
    }
    const client = payload.client || {};
    if (!client.name && !client.uen) {
      throw new BadRequestException('postpaid_consolidated requires client.name or client.uen');
    }

    const organizationId = BIOFUEL_ORG_ID;
    const templateId = await this.resolveConsolidatedTemplateId(organizationId);
    const invoiceNumber = header.invoiceNumber.trim();

    const customerCache = new Map<string, { id: string; name: string }>();
    const { customer, created: createdCustomer } = await this.resolveCustomer(
      client,
      organizationId,
      customerCache,
    );

    // DD/MM/YYYY → dates
    const invoiceDate = this.parseDMY(header.invoiceDate) || new Date();
    const periodFromStr = this.formatDayDisplay(this.parseDMY(header.periodFrom));
    const periodToStr = this.formatDayDisplay(this.parseDMY(header.periodTo));
    const periodStr =
      periodFromStr && periodToStr ? `${periodFromStr} – ${periodToStr}` : periodFromStr || periodToStr || '';

    // Lines from the material summaries. `amount` (gross) = subtotal + gst per
    // line; the item's standard `amount` stays NET so posting math is uniform.
    const items = summaries.map((m, i) => ({
      lineNumber: i + 1,
      no: i + 1,
      description: m.description ?? '',
      qtyTonnes: this.num(m.qtyTonnes),
      rate: this.num(m.rate),
      gstPercentLine: this.num(m.gstPercent, 9),
      grossAmount: this.num(m.amount),
      // Standard fields (GL posting + generic renderers):
      quantity: this.num(m.qtyTonnes),
      unitPrice: this.num(m.rate),
      amount: this.num(m.subtotal),
      taxAmount: this.num(m.gst),
      accountCode: DISPOSAL_REVENUE_ACCOUNT,
      itemCode: null,
      taxType: null,
      discount: 0,
    }));

    const subTotal = this.num(payload.totals?.soilSubtotal, items.reduce((s, it) => s + it.amount, 0));
    const gstAmount = this.num(payload.totals?.gst, items.reduce((s, it) => s + it.taxAmount, 0));
    const nettTotal = this.num(payload.totals?.total, subTotal + gstAmount);
    const gstPercent = this.num(summaries[0]?.gstPercent, subTotal > 0 ? Math.round((gstAmount / subTotal) * 100) : 9);

    const config: Prisma.InputJsonValue = {
      date: invoiceDate.toISOString(),
      dueDate: null,
      documentNumber: invoiceNumber,
      items,
      customer: {
        id: customer.id,
        name: customer.name,
        address: client.address ?? '',
        uen: client.uen ?? '',
      },
      customerId: customer.id,
      billTo: client.address ?? '',
      attention: {
        name: client.attention ?? '',
        phone: client.mobile ?? '',
        email: client.email ?? '',
      },
      subTotal,
      gstAmount,
      nettTotal,
      documentInfo: {
        documentNumber: invoiceNumber,
        date: invoiceDate.toISOString(),
        period: periodStr,
        currency: header.currency || 'SGD',
        gstPercent,
      },
      // Consolidated-invoice extras (drive the JPSG_CONSOLIDATED render):
      consolidated: {
        periodFrom: header.periodFrom ?? null,
        periodTo: header.periodTo ?? null,
        dailyBreakdowns: (payload.dailyBreakdowns as any) ?? [],
        transportSummaries: (payload.transportSummaries as any) ?? null,
        transactionCount: payload.transactionCount ?? null,
        paymentMethod: payload.paymentMethod ?? null,
      },
      glPosting: {
        status: 'pending',
        journalEntryId: null,
        postedAt: null,
        postedBy: null,
        rejectedAt: null,
        rejectedBy: null,
        rejectReason: null,
        source: 'weighbridge_json',
      },
      ingestBatch: {
        type: payload.type ?? null,
        date: header.invoiceDate ?? null,
        sentAt: payload.sentAt ?? null,
      },
      xeroImported: false,
    };

    // Idempotent upsert by invoice number (the postpaid key). Never clobber an
    // already-posted invoice's GL state.
    const existing = await this.prisma.document.findFirst({
      where: { organizationId, type: 'INVOICE', name: invoiceNumber },
      select: { id: true, config: true },
    });

    let documentId: string;
    let outcome: 'created' | 'updated';
    if (existing) {
      const prevGl = (existing.config as any)?.glPosting;
      const merged =
        prevGl && prevGl.status === 'posted' ? { ...(config as any), glPosting: prevGl } : config;
      await this.prisma.document.update({
        where: { id: existing.id },
        data: { documentTemplateId: templateId, status: 'confirmed', config: merged },
      });
      documentId = existing.id;
      outcome = 'updated';
    } else {
      const doc = await this.prisma.document.create({
        data: {
          organizationId,
          documentTemplateId: templateId,
          name: invoiceNumber,
          type: 'INVOICE',
          status: 'confirmed',
          config,
        },
        select: { id: true },
      });
      documentId = doc.id;
      outcome = 'created';
    }

    return {
      organizationId,
      org: 'Biofuel Industries Pte Ltd',
      batchType: payload.type ?? 'postpaid_consolidated',
      batchDate: header.invoiceDate ?? null,
      totalInvoices: 1,
      created: outcome === 'created' ? 1 : 0,
      updated: outcome === 'updated' ? 1 : 0,
      failed: 0,
      customersCreated: createdCustomer ? 1 : 0,
      results: [{ invoiceNumber, transactionId: invoiceNumber, outcome, documentId }] as PerInvoiceResult[],
    };
  }

  // -------------------------------------------------------------------------
  // Per-invoice: resolve customer, build config, upsert by transactionId.
  // -------------------------------------------------------------------------
  private async ingestOne(
    inv: IngestInvoice,
    organizationId: string,
    templateId: string,
    batchDateIso: string,
    payload: IngestBatchDto,
    customerCache: Map<string, { id: string; name: string }>,
  ): Promise<{ result: PerInvoiceResult; createdCustomer: boolean }> {
    if (!inv?.invoiceNumber) throw new BadRequestException('Invoice missing invoiceNumber');
    if (!inv?.transactionId) throw new BadRequestException('Invoice missing transactionId');

    const { customer, created: createdCustomer } = await this.resolveCustomer(
      inv.client || {},
      organizationId,
      customerCache,
    );

    // --- Amounts (prefer explicit payload numbers) -----------------------
    // Real feed uses `soilSubtotal`; keep legacy `subtotal` as fallback.
    const subTotal = this.num(inv.soilSubtotal ?? inv.subtotal);
    const gstAmount = this.num(inv.gstAmount);
    const nettTotal = this.num(inv.totalCharge, subTotal + gstAmount);
    const gstPercent =
      subTotal > 0 ? Math.round((gstAmount / subTotal) * 100) : 9;

    const weightT = this.num(inv.chargedWeightKg) / 1000;
    const unitRate = this.num(inv.ratePerTonne);
    // Real feed sends Min. Load in kg (`minLoadKg`) → convert to tonnes for the
    // "Min. Load (T)" column; fall back to legacy `minLoadTonnes` if present.
    const minLoad =
      inv.minLoadKg != null ? this.num(inv.minLoadKg) / 1000 : this.num(inv.minLoadTonnes);
    const description =
      `${inv.materialType ?? 'Waste'} disposal — ${this.num(inv.chargedWeightKg)} kg ` +
      `@ $${unitRate}/tonne` +
      (inv.licensePlate ? ` (plate ${inv.licensePlate})` : '');

    // Invoice date = when the batch was sent (generated); period = the disposal
    // day (a prepaid_daily batch is a single day, so both ends are the batch date).
    const client = inv.client || {};
    const docDateIso = this.toIso(payload.sentAt) || batchDateIso;
    const periodStr = this.formatDay(batchDateIso);

    const config: Prisma.InputJsonValue = {
      date: batchDateIso,
      dueDate: null,
      documentNumber: inv.invoiceNumber,
      items: [
        {
          lineNumber: 1,
          // --- JPSG soil-disposal columns (rendered by the CleanDocumentPreview
          //     JPSG branch, keyed to the template's tableColumnOrder) ---
          no: 1,
          vehicleNo: inv.licensePlate ?? '',
          vehicleTimestamp: inv.timestamp ?? '',
          materialType: inv.materialType ?? '',
          weightT,
          unitRate,
          minLoad,
          // --- Standard fields kept for GL posting + generic renderers ---
          description,
          quantity: weightT,
          unitPrice: unitRate,
          amount: subTotal,
          taxAmount: gstAmount,
          accountCode: DISPOSAL_REVENUE_ACCOUNT,
          itemCode: null,
          taxType: null,
          discount: 0,
        },
      ],
      customer: {
        id: customer.id,
        name: customer.name,
        address: client.address ?? '',
        uen: client.uen ?? '',
      },
      customerId: customer.id,
      billTo: client.address ?? '',
      attention: {
        name: client.attention ?? '',
        phone: client.mobile ?? '',
        email: client.email ?? '',
      },
      // Canonical total fields the posting flow reads (documents.service
      // confirmInvoice / journal-auto-post):
      subTotal,
      gstAmount,
      nettTotal,
      documentInfo: {
        documentNumber: inv.invoiceNumber,
        date: docDateIso,
        period: periodStr,
        currency: 'SGD',
        gstPercent,
      },
      // Weighbridge audit trail:
      weighbridge: {
        transactionId: inv.transactionId,
        licensePlate: inv.licensePlate ?? null,
        materialType: inv.materialType ?? null,
        pickupLocation: inv.pickupLocation ?? null,
        entryWeightKg: this.num(inv.entryWeightKg),
        exitWeightKg: this.num(inv.exitWeightKg),
        disposedWeightKg: this.num(inv.disposedWeightKg),
        chargedWeightKg: this.num(inv.chargedWeightKg),
        minLoadKg: inv.minLoadKg ?? null,
        ratePerTonne: this.num(inv.ratePerTonne),
        transport: inv.transport ?? null,
        timestamp: inv.timestamp ?? null,
      },
      // GL posting is deferred to the accountant Posting Queue:
      glPosting: {
        status: 'pending',
        journalEntryId: null,
        postedAt: null,
        postedBy: null,
        rejectedAt: null,
        rejectedBy: null,
        rejectReason: null,
        source: 'weighbridge_json',
      },
      ingestBatch: {
        type: payload.type ?? null,
        date: payload.date ?? null,
        sentAt: payload.sentAt ?? null,
      },
      xeroImported: false,
    };

    // --- Idempotent upsert by weighbridge.transactionId, then by name ----
    // transactionId is the primary idempotency key. Fall back to the invoice
    // number so we update (not duplicate / not collide with the unique
    // [name, org, templateId] constraint) if a row already exists under that
    // number — e.g. a prior import — without our transactionId stamped.
    const existing =
      (await this.prisma.document.findFirst({
        where: {
          organizationId,
          type: 'INVOICE',
          config: {
            path: ['weighbridge', 'transactionId'],
            equals: inv.transactionId,
          },
        },
        select: { id: true, config: true },
      })) ||
      (await this.prisma.document.findFirst({
        where: { organizationId, type: 'INVOICE', name: inv.invoiceNumber },
        select: { id: true, config: true },
      }));

    if (existing) {
      // Update in place — but never clobber an already-posted invoice's GL state.
      const prevGl = (existing.config as any)?.glPosting;
      const mergedConfig =
        prevGl && prevGl.status === 'posted'
          ? { ...(config as any), glPosting: prevGl }
          : config;
      await this.prisma.document.update({
        where: { id: existing.id },
        data: {
          name: inv.invoiceNumber,
          documentTemplateId: templateId,
          status: 'confirmed',
          config: mergedConfig,
        },
      });
      return {
        result: {
          invoiceNumber: inv.invoiceNumber,
          transactionId: inv.transactionId,
          outcome: 'updated',
          documentId: existing.id,
        },
        createdCustomer,
      };
    }

    const doc = await this.prisma.document.create({
      data: {
        organizationId,
        documentTemplateId: templateId,
        name: inv.invoiceNumber,
        type: 'INVOICE',
        status: 'confirmed',
        config,
      },
      select: { id: true },
    });

    // Document-history "Created" entry — same resource/resourceId convention as
    // DocumentsService.logDocumentEvent, attributed to the ingestion pipeline.
    void this.audit.logAction({
      userId: 'system',
      userName: 'JSON ingestion',
      action: 'CREATED',
      resource: 'document',
      resourceId: doc.id,
      resourceName: inv.invoiceNumber,
      organizationId,
      details: { detail: `${inv.invoiceNumber} created (weighbridge ingestion)` },
    });

    return {
      result: {
        invoiceNumber: inv.invoiceNumber,
        transactionId: inv.transactionId,
        outcome: 'created',
        documentId: doc.id,
      },
      createdCustomer,
    };
  }

  // -------------------------------------------------------------------------
  // Customer resolution: gstRegNo (UEN) match → fuzzy name → create.
  // -------------------------------------------------------------------------
  private async resolveCustomer(
    client: IngestClient,
    organizationId: string,
    cache: Map<string, { id: string; name: string }>,
  ): Promise<{ customer: { id: string; name: string }; created: boolean }> {
    const name = (client.name || '').trim();
    const uen = (client.uen || '').trim();
    const cacheKey = (uen || this.normalizeName(name)).toLowerCase();
    if (!name && !uen) {
      throw new BadRequestException('Invoice client has neither name nor uen');
    }

    const cached = cache.get(cacheKey);
    if (cached) return { customer: cached, created: false };

    // 1) Match by UEN → Customer.gstRegNo (exact, case-insensitive).
    if (uen) {
      const byUen = await this.prisma.customer.findFirst({
        where: { organizationId, gstRegNo: { equals: uen, mode: 'insensitive' } },
        select: { id: true, name: true },
      });
      if (byUen) {
        cache.set(cacheKey, byUen);
        return { customer: byUen, created: false };
      }
    }

    // 2) Fuzzy name match against existing customers.
    if (name) {
      const byName = await this.fuzzyMatchCustomer(organizationId, name);
      if (byName) {
        cache.set(cacheKey, byName);
        return { customer: byName, created: false };
      }
    }

    // 3) Create from the client block. The client's attention/mobile/email are
    // the point-of-contact — they go on a CustomerContact, NOT on the Customer's
    // own email/phone fields (those stay empty; Customer holds name/UEN/address).
    const contactName = (client.attention || '').trim();
    const contacts =
      contactName || client.mobile || client.email
        ? [
            {
              name: contactName || name || uen,
              phone: client.mobile ?? null,
              email: client.email ?? null,
              isPrimary: true,
            },
          ]
        : [];
    try {
      const createdCustomer = await this.customers.createCustomers(
        {
          name: name || uen,
          address: client.address ?? null,
          gstRegNo: uen || null,
          contacts,
        } as any,
        organizationId,
      );
      const shaped = { id: createdCustomer.id, name: createdCustomer.name };
      cache.set(cacheKey, shaped);
      return { customer: shaped, created: true };
    } catch (err: any) {
      // Fall back to an existing customer by name if the create collided.
      const fallback = name
        ? await this.prisma.customer.findFirst({
            where: { organizationId, name: { equals: name, mode: 'insensitive' } },
            select: { id: true, name: true },
          })
        : null;
      if (fallback) {
        cache.set(cacheKey, fallback);
        return { customer: fallback, created: false };
      }
      throw err;
    }
  }

  private async fuzzyMatchCustomer(
    organizationId: string,
    customerName: string,
  ): Promise<{ id: string; name: string } | null> {
    const target = this.normalizeName(customerName);
    const targetCore = this.coreName(customerName);
    if (!target) return null;

    const all = await this.prisma.customer.findMany({
      where: { organizationId },
      select: { id: true, name: true },
    });

    let best: { id: string; name: string } | null = null;
    let bestScore = 0;
    for (const c of all) {
      const n = this.normalizeName(c.name);
      const core = this.coreName(c.name);
      let score = 0;
      if (n && n === target) score = 1;
      else if (n && (n.includes(target) || target.includes(n))) score = 0.95;
      else if (
        core &&
        targetCore &&
        (core === targetCore || core.includes(targetCore) || targetCore.includes(core))
      )
        score = 0.9;
      else {
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
        best = { id: c.id, name: c.name };
      }
    }
    return bestScore >= 0.6 ? best : null;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  private async resolveInvoiceTemplateId(organizationId: string): Promise<string> {
    // Prefer the bespoke JPSG soil-disposal invoice template (custom columns:
    // Vehicle No / Weight (T) / Unit Rate / Min. Load / Amount). Seed it with
    // scripts/create-jpsg-invoice-template.ts.
    const jpsg = await this.prisma.documentTemplate.findFirst({
      where: { organizationId, type: 'INVOICE', templateVariant: 'JPSG_DISPOSAL' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (jpsg) return jpsg.id;
    throw new BadRequestException(
      'JPSG_DISPOSAL invoice template not found for this org — run scripts/create-jpsg-invoice-template.ts first',
    );
  }

  private async resolveConsolidatedTemplateId(organizationId: string): Promise<string> {
    // Bespoke consolidated postpaid invoice template (period header + material
    // summary + daily breakdown). Seed via scripts/create-jpsg-consolidated-template.ts.
    const tmpl = await this.prisma.documentTemplate.findFirst({
      where: { organizationId, type: 'INVOICE', templateVariant: 'JPSG_CONSOLIDATED' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (tmpl) return tmpl.id;
    throw new BadRequestException(
      'JPSG_CONSOLIDATED invoice template not found for this org — run scripts/create-jpsg-consolidated-template.ts first',
    );
  }

  // "DD/MM/YYYY" (weighbridge postpaid format) → Date, else null.
  private parseDMY(s?: string | null): Date | null {
    if (!s) return null;
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
    if (m) {
      const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const fallback = new Date(s);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  private formatDayDisplay(d?: Date | null): string {
    if (!d) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  private formatDay(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const day = d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    return `${day} – ${day}`;
  }

  private num(v: any, fallback = 0): number {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }

  private toIso(dateStr?: string): string | null {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  private normalizeName(s: string): string {
    return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private coreName(s: string): string {
    return this.normalizeName(s)
      .replace(/\b(pte|ltd|llp|inc|co|company|limited|corporation|corp|sdn|bhd|pvt|private)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
