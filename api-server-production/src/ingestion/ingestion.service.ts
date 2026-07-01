import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
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

    // 3) Create from the client block.
    const contacts =
      client.attention && client.attention.trim()
        ? [
            {
              name: client.attention.trim(),
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
          email: client.email ?? null,
          phone: client.mobile ?? null,
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
      // Likely a unique-email collision — fall back to an existing customer by name.
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
