/**
 * Round AM — Clients (Customers · Suppliers) for SHIPMENTS orgs: the lists, a client's profile (orders come from the
 * Orders / Monthly endpoints with a customer / supplier filter), and Document formats per customer. Reads the records
 * AIMS already has; writes only the customer profile (through TradeConfigService.updateSettings, the same path as
 * Org Settings → Customers) and the format sample files (S3 under the org's trade prefix + the profile's docFormats).
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import { tradeToday, decodeUploadName, resolveTradeFileMime, sanitizeFileName, TRADE_FILE_MAX_BYTES } from './shipments.rules';
import { TradeConfigService } from './trade-config.service';
import { TradeFilesService } from './trade-files.service';
import { TradeGeneratedService } from './trade-generated.service';
import { TradeActor } from './shipments.request';
import { clientStats, ClientOrderFact, contactsFrom, DOC_FORMAT_SLOTS, formatViews, generatorFits } from './clients';
import { clientName, shortSupplier } from './monthly-list';
import { CustomerProfile, DOC_FORMAT_TYPES, DocFormatType, FormatSample, OTHER_DOC_TEMPLATES, profileFor, supplierProfileFor } from './trade-profile';
import { orderStage, supplierStage } from './trade-stage';

const STEP = { code: true, status: true, notApplicable: true };
const SHIP = { id: true, seqNo: true, status: true, blNumber: true, etd: true, eta: true, actualArrivalDate: true, dischargeDate: true, ciNumber: true, ciAmount: true, deliveryMonth: true, steps: { select: STEP } };
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const OWN_DOMAINS = ['asiadealhub.com'];
const SIGNED_URL_TTL = 300;

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TradeConfigService,
    private readonly s3: S3Service,
    private readonly generated: TradeGeneratedService,
  ) {}

  private async ordersOf(organizationId: string, where: Record<string, unknown>) {
    const rows: any[] = await this.prisma.tradeOrder.findMany({
      where: { organizationId, isTest: false, ...where },
      select: {
        id: true,
        orderNo: true,
        status: true,
        isTest: true,
        qtyMt: true,
        shipMonth: true,
        deliveryMonth: true,
        customerId: true,
        supplierId: true,
        piNo: true,
        piDate: true,
        steps: { select: STEP },
        supplierOrder: { select: { status: true, piNo: true, piDate: true, steps: { select: STEP } } },
        shipments: { where: { status: { not: 'CANCELLED' } }, select: SHIP },
      },
    });
    return rows.map((o) => ({
      ...o,
      qtyMt: num(o.qtyMt),
      shipments: (o.shipments ?? []).map((s: any) => ({ ...s, ciAmount: num(s.ciAmount) })),
    })) as Array<ClientOrderFact & { id: string; customerId: string; supplierId: string; piNo: string | null; piDate: Date | null; steps: any[]; supplierOrder: any }>;
  }

  /** Recent incoming senders (counterparty + domain), for the contacts. */
  private async senders(organizationId: string) {
    return this.prisma.emailIngestLog.findMany({
      where: { organizationId, direction: 'IN' },
      select: { fromAddress: true, direction: true, counterparty: true, emailDate: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
  }

  // ── customers ──────────────────────────────────────────────────────────
  async customers(organizationId: string) {
    const settings = await this.config.getSettings(organizationId);
    const profiles = settings.customerProfiles ?? {};
    const customers: any[] = await this.prisma.customer.findMany({
      where: { organizationId },
      select: { id: true, customerCode: true, name: true, jpName: true, currency: true, _count: { select: { tradeOrders: true, contracts: true } } },
      orderBy: { name: 'asc' },
    });
    const orders = await this.ordersOf(organizationId, {});
    const today = tradeToday();
    // Trade customers: a profile, an order or a contract (the org's other customers stay in Master Files).
    return customers
      .filter((c) => profiles[c.id] || c._count.tradeOrders || c._count.contracts)
      .map((c) => {
        const p = profileFor(profiles, c.id);
        return {
          id: c.id,
          code: c.customerCode,
          short: clientName(p.key?.toUpperCase() ?? null, c.name),
          name: c.name,
          jpName: c.jpName,
          currency: c.currency,
          contracts: c._count.contracts,
          billingMode: p.billingMode,
          hasProfile: !!profiles[c.id],
          port: p.port ?? null,
          ...clientStats(orders.filter((o) => o.customerId === c.id), today),
        };
      });
  }

  async customer(organizationId: string, id: string) {
    const c: any = await this.prisma.customer.findFirst({
      where: { id, organizationId },
      select: { id: true, customerCode: true, name: true, jpName: true, jpAddress: true, jpContact: true, email: true, phone: true, address: true, currency: true, contacts: { select: { id: true, name: true, email: true, phone: true, designation: true, isPrimary: true } } },
    });
    if (!c) throw new NotFoundException('Customer not found');
    const settings = await this.config.getSettings(organizationId);
    const profile = profileFor(settings.customerProfiles, id);
    const orders = await this.ordersOf(organizationId, { customerId: id });
    const shipPorts: any[] = await this.prisma.shipment.findMany({ where: { organizationId, order: { customerId: id }, portOfDischarge: { not: null } }, select: { portOfDischarge: true }, distinct: ['portOfDischarge'] });
    // Legacy delivery sites (docDefaults.deliveryProfiles) still offered in the 出庫・納入依頼書 editor, matched by name.
    const legacy = ((settings.docDefaults as { deliveryProfiles?: Array<Record<string, unknown>> } | null)?.deliveryProfiles ?? []).filter((d) => {
      const n = String(d.customerName ?? '').toLowerCase();
      return !!n && (c.name.toLowerCase().includes(n) || (profile.key ?? '').toLowerCase() === n);
    });
    return {
      customer: c,
      short: clientName(profile.key?.toUpperCase() ?? null, c.name),
      profile,
      hasProfile: !!settings.customerProfiles?.[id],
      stats: clientStats(orders, tradeToday()),
      contracts: await this.contracts(organizationId, { customerId: id }),
      contacts: contactsFrom(await this.senders(organizationId), [profile.key ?? ''], profile.emailDomains ?? [], OWN_DOMAINS),
      ports: [...new Set([profile.port, ...shipPorts.map((s) => s.portOfDischarge)].filter((x): x is string => !!x))],
      deliverySites: [...(profile.deliveryProfile ? [{ ...profile.deliveryProfile, source: 'profile' }] : []), ...legacy.map((d) => ({ ...d, source: 'documents defaults' }))],
      formats: formatViews(profile, c.jpName || c.name),
    };
  }

  private async contracts(organizationId: string, where: { customerId?: string; supplierId?: string }) {
    const rows: any[] = await this.prisma.contract.findMany({
      where: { organizationId, ...where },
      orderBy: [{ periodStart: 'desc' }, { contractNo: 'asc' }],
      select: {
        id: true,
        contractNo: true,
        status: true,
        grade: true,
        sizeSpec: true,
        periodStart: true,
        periodEnd: true,
        annualQtyMt: true,
        tolerancePct: true,
        incoterm: true,
        qpBasis: true,
        qmjpRule: true,
        balanceTerms: true,
        depositPercent: true,
        premiumSchedule: true,
        checkFields: true,
        customer: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        lines: { orderBy: { sortOrder: 'asc' }, select: { id: true, grade: true, sizeSpec: true, quantityMt: true, supplierPremium: true, clientPremium: true, upcharge: true } },
        fileLinks: { where: { hiddenAt: null }, select: { file: { select: { id: true, docType: true, fileName: true, docRef: true, mimeType: true } } } },
        _count: { select: { orders: true } },
      },
    });
    return rows.map(({ fileLinks, _count, ...k }) => ({ ...k, orders: _count.orders, files: fileLinks.map((l: any) => l.file).filter(Boolean) }));
  }

  // ── suppliers ──────────────────────────────────────────────────────────
  async suppliers(organizationId: string) {
    const settings = await this.config.getSettings(organizationId);
    const profiles = settings.supplierProfiles ?? {};
    const suppliers: any[] = await this.prisma.supplier.findMany({
      where: { organizationId },
      select: { id: true, supplierCode: true, name: true, currency: true, contracts: { select: { contractNo: true, status: true } }, _count: { select: { tradeOrders: true, supplierOrders: true } } },
      orderBy: { name: 'asc' },
    });
    const orders = await this.ordersOf(organizationId, {});
    const today = tradeToday();
    // Trade suppliers: a supplier profile, a contract or an order (Mitsui Soko / ADH Pte stay in Master Files).
    return suppliers
      .filter((s) => profiles[s.id] || s.contracts.length || s._count.tradeOrders || s._count.supplierOrders)
      .map((s) => {
        const p = supplierProfileFor(profiles, s.id);
        const mine = orders.filter((o) => o.supplierId === s.id);
        const open = mine.filter((o) => o.status === 'OPEN');
        // PI status of the open orders: received (PI no. / date on the order or its supplier order), deposit paid, waiting.
        const piOf = (o: (typeof mine)[number]) => supplierStage(this.stageOrder(o), null, today);
        const counts = { waiting: 0, received: 0, depositPaid: 0 };
        for (const o of open) {
          const st = piOf(o);
          if (st === 'DEPOSIT_PAID') counts.depositPaid++;
          else if (st === 'PI_RECEIVED') counts.received++;
          else counts.waiting++;
        }
        return {
          id: s.id,
          code: s.supplierCode,
          short: p.label || shortSupplier(s.name),
          name: s.name,
          currency: s.currency,
          hasPI: p.hasPI,
          pricingMode: p.pricingMode ?? 'LME_FORMULA',
          contracts: s.contracts.map((k: any) => ({ contractNo: k.contractNo, status: k.status })),
          openOrders: open.length,
          pi: p.hasPI ? counts : null,
          stats: clientStats(mine, today),
        };
      });
  }

  private stageOrder(o: any) {
    return {
      status: o.status,
      piNo: o.supplierOrder?.piNo ?? o.piNo ?? null,
      piDate: o.supplierOrder?.piDate ?? o.piDate ?? null,
      supplierDone: o.supplierOrder ? o.supplierOrder.status === 'COMPLETED' && o.status === 'COMPLETED' : o.status === 'COMPLETED',
      steps: [...(o.supplierOrder?.steps ?? []), ...(o.steps ?? [])],
      shipments: o.shipments ?? [],
    };
  }

  async supplier(organizationId: string, id: string) {
    const s: any = await this.prisma.supplier.findFirst({ where: { id, organizationId }, select: { id: true, supplierCode: true, name: true, email: true, phone: true, address: true, currency: true, gstRegNo: true } });
    if (!s) throw new NotFoundException('Supplier not found');
    const settings = await this.config.getSettings(organizationId);
    const profile = supplierProfileFor(settings.supplierProfiles, id);
    const contracts = await this.contracts(organizationId, { supplierId: id });
    const orders = await this.ordersOf(organizationId, { supplierId: id });
    const today = tradeToday();
    // The document set they send with a shipment: the profile's own, else the org's step 3b template (Vedanta's set).
    const step3b: any = await this.prisma.tradeStepTemplate.findFirst({ where: { organizationId, code: 'SHIPPING_DOCS', isActive: true }, select: { requiredDocTypes: true, optionalDocTypes: true } });
    const types: any[] = await this.config.listDocTypes(organizationId);
    const label = (code: string) => types.find((t) => t.code === code)?.label ?? code;
    const required: string[] = profile.shippingDocs?.length ? profile.shippingDocs : (step3b?.requiredDocTypes ?? []);
    const optional: string[] = (step3b?.optionalDocTypes ?? []).filter((c: string) => !required.includes(c) && c !== 'OTHER');
    const stages = orders
      .filter((o) => o.status === 'OPEN')
      .map((o) => ({ orderNo: o.orderNo, supplierStage: supplierStage(this.stageOrder(o), null, today), orderStage: orderStage(this.stageOrder(o), null, today) }));
    return {
      supplier: s,
      short: profile.label || shortSupplier(s.name),
      profile,
      hasProfile: !!settings.supplierProfiles?.[id],
      stats: clientStats(orders, today),
      contracts,
      contacts: contactsFrom(await this.senders(organizationId), [profile.key ?? ''], profile.emailDomains ?? [], OWN_DOMAINS),
      documentSet: {
        source: profile.shippingDocs?.length ? 'supplier profile' : 'step 3b template',
        required: required.map((code) => ({ code, label: label(code) })),
        optional: optional.map((code) => ({ code, label: label(code) })),
      },
      terms: {
        hasPI: profile.hasPI,
        pricingMode: profile.pricingMode ?? 'LME_FORMULA',
        priceUnit: profile.priceUnit ?? null,
        paymentTerms: profile.paymentTerms ?? null,
        country: profile.country ?? null,
        loadingPort: profile.loadingPort ?? null,
        depositPercents: [...new Set(contracts.map((k) => (k.depositPercent === null || k.depositPercent === undefined ? null : Number(k.depositPercent))).filter((x): x is number => x !== null))],
        balanceTerms: contracts.map((k) => ({ contractNo: k.contractNo, text: k.balanceTerms })).filter((x) => !!x.text),
        lmeBasis: contracts.map((k) => ({ contractNo: k.contractNo, text: k.qpBasis })).filter((x) => !!x.text),
      },
      openStages: stages,
    };
  }

  // ── document formats (customers) ───────────────────────────────────────
  private assertFormatType(docType: string): DocFormatType {
    if (!DOC_FORMAT_TYPES.includes(docType as DocFormatType)) throw new BadRequestException(`Unknown document "${docType}" (one of ${DOC_FORMAT_TYPES.join(', ')})`);
    return docType as DocFormatType;
  }

  private async profileFor(organizationId: string, customerId: string): Promise<CustomerProfile> {
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, organizationId }, select: { id: true } });
    if (!c) throw new NotFoundException('Customer not found');
    return this.config.profileOf(organizationId, customerId);
  }

  /** Generator (Customer COA / PL), language, 宛先 and note of one document — saved on the customer profile. */
  async updateFormat(organizationId: string, customerId: string, docType: string, body: { generator?: string | null; language?: string | null; addressee?: string | null; notes?: string | null }) {
    const t = this.assertFormatType(docType);
    const slot = DOC_FORMAT_SLOTS.find((s) => s.docType === t)!;
    const p = await this.profileFor(organizationId, customerId);
    const next: CustomerProfile = { ...p, docVariants: { ...p.docVariants }, docFormats: { ...(p.docFormats ?? {}) } };
    if (body.generator !== undefined && body.generator !== null && body.generator !== '') {
      if (slot.choose === 'fixed') throw new BadRequestException('This document has one layout for every customer');
      // Round AN: the invoice follows the billing mode; only a single-billing customer may pick Hoei's USD 請求書.
      if (slot.choose === 'billing') {
        const byBilling = p.billingMode === 'SINGLE' ? 'INVOICE_SINGLE' : 'INVOICE_2';
        const usd = p.billingMode === 'SINGLE' && OTHER_DOC_TEMPLATES[body.generator]?.docType === 'INVOICE';
        if (body.generator !== byBilling && !usd) throw new BadRequestException('The invoice follows the billing mode (Org Settings → Customers)');
      }
      if (!generatorFits(t, body.generator)) throw new BadRequestException(`"${body.generator}" is not a ${slot.title} format`);
      next.docVariants[t as 'CUSTOMER_COA' | 'CUSTOMER_PL' | 'SGJP_IV_PL' | 'INVOICE'] = body.generator;
    }
    const cur = next.docFormats![t] ?? {};
    next.docFormats![t] = {
      ...cur,
      ...(body.language !== undefined ? { language: body.language === 'en' ? 'en' : body.language === 'ja' ? 'ja' : undefined } : {}),
      ...(body.addressee !== undefined ? { addressee: body.addressee ?? undefined } : {}),
      ...(body.notes !== undefined ? { notes: body.notes ?? undefined } : {}),
    };
    await this.config.updateSettings(organizationId, { customerProfiles: { [customerId]: next } });
    return this.customer(organizationId, customerId);
  }

  /** A sample / template file the customer gave for one document type (S3 + the profile's docFormats). */
  async addSample(organizationId: string, customerId: string, docType: string, file: Express.Multer.File | undefined, actor: TradeActor) {
    const t = this.assertFormatType(docType);
    await this.profileFor(organizationId, customerId);
    if (!file) throw new BadRequestException('Please attach a file');
    const fileName = decodeUploadName(file.originalname || 'sample');
    const mimeType = resolveTradeFileMime(fileName, file.mimetype);
    if (!mimeType) throw new BadRequestException(`File type not allowed: ${fileName}`);
    if (file.size > TRADE_FILE_MAX_BYTES) throw new BadRequestException('File is larger than 25 MB');
    const id = randomUUID();
    const s3Key = `${TradeFilesService.keyPrefix(organizationId)}format-samples/${customerId}/${id}_${sanitizeFileName(fileName)}`;
    await this.s3.uploadFile(s3Key, file.buffer, mimeType);
    const sample: FormatSample = { id, fileName, mimeType, sizeBytes: file.size, s3Key, uploadedAt: new Date().toISOString(), uploadedByName: actor.name };
    try {
      await this.writeSamples(organizationId, customerId, t, (list) => [...list, sample]);
    } catch (e) {
      await this.s3.deleteFile(s3Key).catch(() => undefined);
      throw e;
    }
    return this.customer(organizationId, customerId);
  }

  /** Hide a sample from the list (the file is kept — nothing is deleted). */
  async hideSample(organizationId: string, customerId: string, docType: string, sampleId: string) {
    const t = this.assertFormatType(docType);
    await this.profileFor(organizationId, customerId);
    let found = false;
    await this.writeSamples(organizationId, customerId, t, (list) =>
      list.map((s) => {
        if (s.id !== sampleId) return s;
        found = true;
        return { ...s, hidden: true };
      }),
    );
    if (!found) throw new NotFoundException('Sample not found');
    return this.customer(organizationId, customerId);
  }

  async sampleUrl(organizationId: string, customerId: string, docType: string, sampleId: string) {
    const t = this.assertFormatType(docType);
    const p = await this.profileFor(organizationId, customerId);
    const s = p.docFormats?.[t]?.samples?.find((x) => x.id === sampleId);
    if (!s || !s.s3Key.startsWith(TradeFilesService.keyPrefix(organizationId))) throw new NotFoundException('Sample not found');
    return { url: await this.s3.getSignedUrl(s.s3Key, SIGNED_URL_TTL), fileName: s.fileName, mimeType: s.mimeType, expiresIn: SIGNED_URL_TTL };
  }

  /** The stored profile's samples of one type, rewritten (the only writer of docFormats[*].samples). */
  private async writeSamples(organizationId: string, customerId: string, t: DocFormatType, fn: (list: FormatSample[]) => FormatSample[]) {
    const row = await this.prisma.tradeSetting.findUnique({ where: { organizationId }, select: { id: true, customerProfiles: true } });
    const profiles = ((row?.customerProfiles as unknown as Record<string, CustomerProfile> | null) ?? {});
    // A customer without a stored profile gets the default one (TWO_STAGE), as a settings save would.
    const p = profiles[customerId] ?? profileFor({}, customerId);
    const formats = { ...(p.docFormats ?? {}) };
    formats[t] = { ...(formats[t] ?? {}), samples: fn([...(formats[t]?.samples ?? [])]) };
    const next = { ...profiles, [customerId]: { ...p, docFormats: formats } };
    if (row) await this.prisma.tradeSetting.update({ where: { organizationId }, data: { customerProfiles: next as any } });
    else await this.prisma.tradeSetting.create({ data: { organizationId, customerProfiles: next as any } });
  }

  /**
   * Preview a format on a real shipment of this customer (Customer COA / PL): the document as AIMS would make it from
   * the shipment's Vedanta file, as a PDF (and SUS's .xlsx). Read-only.
   */
  async preview(organizationId: string, customerId: string, docType: string, body: { shipmentId?: string; generator?: string | null }) {
    const t = this.assertFormatType(docType);
    if (t !== 'CUSTOMER_COA' && t !== 'CUSTOMER_PL') throw new BadRequestException('Preview is for the customer COA and packing list');
    const p = await this.profileFor(organizationId, customerId);
    if (!body.shipmentId || !/^[0-9a-f-]{36}$/i.test(body.shipmentId)) throw new BadRequestException('Pick a shipment');
    const s = await this.prisma.shipment.findFirst({ where: { id: body.shipmentId, organizationId }, select: { id: true, customerId: true, order: { select: { customerId: true } } } });
    if (!s || (s.order?.customerId ?? s.customerId) !== customerId) throw new BadRequestException("That shipment isn't this customer's");
    const key = body.generator ? (generatorFits(t, body.generator) ? body.generator : null) : (p.docVariants[t] ?? `${t}_KATO`);
    if (!key) throw new BadRequestException(`"${body.generator}" is not a ${t} format`);
    const r = await this.generated.previewFormat(organizationId, s.id, t, key);
    const pdf = await this.generated.pdfOf(r.html, t, r.landscape);
    return {
      generator: key,
      source: r.source,
      notes: r.notes,
      pdf: { fileName: `${t}-${key}-preview.pdf`, contentType: 'application/pdf', base64: pdf.toString('base64') },
      xlsx: r.xlsx ? { fileName: `PACKING LIST-preview.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: r.xlsx.toString('base64') } : null,
    };
  }

  /** Shipments of this customer that have the supplier files a preview needs (newest first). */
  async previewShipments(organizationId: string, customerId: string) {
    const rows: any[] = await this.prisma.shipment.findMany({
      where: { organizationId, status: { not: 'CANCELLED' }, order: { customerId, isTest: false } },
      orderBy: [{ etd: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 40,
      select: { id: true, seqNo: true, blNumber: true, order: { select: { orderNo: true } }, fileLinks: { where: { hiddenAt: null }, select: { file: { select: { docType: true } } } } },
    });
    return rows.map((s) => {
      const types = new Set(s.fileLinks.map((l: any) => l.file?.docType));
      return {
        id: s.id,
        ref: `#${s.order?.orderNo ?? '?'}${s.seqNo ? `-${s.seqNo}` : ''}`,
        blNumber: s.blNumber,
        hasCoa: types.has('COA_XLS') || types.has('COA'),
        hasPl: types.has('PL_XLS') || types.has('PL'),
      };
    });
  }
}
