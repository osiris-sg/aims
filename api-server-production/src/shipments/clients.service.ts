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
import { CustomerProfile, DOC_FORMAT_TYPES, DocFormatType, FormatSample, naStepCodes, OTHER_DOC_TEMPLATES, profileFor, supplierProfileFor } from './trade-profile';
import { cleanSkipSteps, ImpactRecord, PROCESS_STEPS, processImpact } from './trade-process';
import { cleanCompany, cleanContacts, cleanLogistics, cleanShippingLine, companyView, ContactInfo, lineCode, maskedProfile, ShippingLineInfo, typesOf } from './clients-company';
import { carrierCatalog, carrierOf } from './trade-carrier';
import { defaultProfile, defaultSupplierProfile, SupplierProfile } from './trade-profile';
import { cleanSiFormat, siTemplateMappingOf } from './trade-si';
import { cleanPacking, cleanProduct, ClientProduct, PackingInfo, productLabel, productMatch, productSize, ProfileFile } from './clients-products';

type Party = 'customer' | 'supplier';
import { shipmentRef } from './shipments.rules';
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
      select: { id: true, customerCode: true, name: true, jpName: true, currency: true, email: true, phone: true, contacts: { select: { name: true, email: true, phone: true, isPrimary: true } }, _count: { select: { tradeOrders: true, contracts: true } } },
      orderBy: { name: 'asc' },
    });
    const orders = await this.ordersOf(organizationId, {});
    const today = tradeToday();
    const senders = await this.senders(organizationId);
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
          // Round AY part 3: the table's columns.
          country: p.company?.country ?? null,
          email: c.email ?? null,
          phone: c.phone ?? null,
          mainContact: mainContactOf([...(p.contacts ?? []).map((k) => ({ name: k.name, email: k.email ?? null, phone: k.phone ?? null, isPrimary: !!k.isPrimary })), ...c.contacts], contactsFrom(senders, [p.key ?? ''], p.emailDomains ?? [], OWN_DOMAINS)),
          carriers: p.logistics?.carriers ?? [],
          ...clientStats(orders.filter((o) => o.customerId === c.id), today),
        };
      });
  }

  async customer(organizationId: string, id: string) {
    const c: any = await this.prisma.customer.findFirst({
      where: { id, organizationId },
      select: { id: true, customerCode: true, name: true, jpName: true, jpAddress: true, jpContact: true, email: true, phone: true, address: true, currency: true, gstRegNo: true, contacts: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], select: { id: true, name: true, email: true, phone: true, designation: true, isPrimary: true } } },
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
      contactList: profile.contacts ?? [],
      short: clientName(profile.key?.toUpperCase() ?? null, c.name),
      profile: maskedProfile(profile),
      company: companyView(profile.company),
      logistics: profile.logistics ?? {},
      hasProfile: !!settings.customerProfiles?.[id],
      stats: clientStats(orders, tradeToday()),
      contracts: await this.contracts(organizationId, { customerId: id }),
      contacts: contactsFrom(await this.senders(organizationId), [profile.key ?? ''], profile.emailDomains ?? [], OWN_DOMAINS),
      ports: [...new Set([profile.port, ...shipPorts.map((s) => s.portOfDischarge)].filter((x): x is string => !!x))],
      deliverySites: [...(profile.deliveryProfile ? [{ ...profile.deliveryProfile, source: 'profile' }] : []), ...legacy.map((d) => ({ ...d, source: 'documents defaults' }))],
      formats: formatViews(profile, c.jpName || c.name),
      process: { steps: PROCESS_STEPS, skipSteps: profile.skipSteps ?? [] },
      // Round BA: Products / Packing tabs.
      catalog: await this.catalogView(organizationId, 'customer', id),
    };
  }

  // ── Round AY: the customer's process (which steps apply) ─────────────────
  /** What saving `skipSteps` would do to the customer's open orders / shipments (nothing is written). */
  async processImpact(organizationId: string, customerId: string, skipSteps: unknown) {
    const p = await this.profileFor(organizationId, customerId);
    const next: CustomerProfile = { ...p, skipSteps: cleanSkipSteps(skipSteps, (m) => { throw new BadRequestException(m); }) };
    const STEPS = { select: { code: true, status: true, isOngoing: true, notApplicable: true, skipReason: true, displayNo: true, title: true } };
    const orders: any[] = await this.prisma.tradeOrder.findMany({
      where: { organizationId, customerId, status: 'OPEN' },
      select: { id: true, orderNo: true, status: true, supplierId: true, steps: STEPS, shipments: { select: { id: true, seqNo: true, status: true, steps: STEPS } } },
      orderBy: { orderNo: 'asc' },
    });
    const sp = new Map<string, any>();
    for (const o of orders) if (!sp.has(o.supplierId)) sp.set(o.supplierId, await this.config.supplierProfileOf(organizationId, o.supplierId));
    const supplierOf = new Map<string, string>();
    const records: ImpactRecord[] = [];
    for (const o of orders) {
      records.push({ kind: 'order', id: o.id, ref: `#${o.orderNo}`, status: o.status, steps: o.steps });
      supplierOf.set(o.id, o.supplierId);
      for (const sh of o.shipments) {
        records.push({ kind: 'shipment', id: sh.id, ref: shipmentRef(o.orderNo, sh.seqNo), orderId: o.id, status: sh.status, steps: sh.steps });
        supplierOf.set(sh.id, o.supplierId);
      }
    }
    const impact = processImpact(records, (r) => new Set(naStepCodes(next, r.kind === 'order' ? 'ORDER' : 'SHIPMENT', sp.get(supplierOf.get(r.id)!))));
    return { skipSteps: next.skipSteps, ...impact };
  }

  /** Save the customer's process; its open orders / shipments follow (done steps stay done, nothing is deleted). */
  async updateProcess(organizationId: string, customerId: string, skipSteps: unknown) {
    const impact = await this.processImpact(organizationId, customerId, skipSteps);
    const p = await this.profileFor(organizationId, customerId);
    await this.config.updateSettings(organizationId, { customerProfiles: { [customerId]: { ...p, skipSteps: impact.skipSteps } } } as any);
    return { impact, customer: await this.customer(organizationId, customerId) };
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
      select: { id: true, supplierCode: true, name: true, currency: true, email: true, phone: true, contracts: { select: { contractNo: true, status: true } }, _count: { select: { tradeOrders: true, supplierOrders: true } } },
      orderBy: { name: 'asc' },
    });
    const orders = await this.ordersOf(organizationId, {});
    const today = tradeToday();
    const senders = await this.senders(organizationId);
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
          // Round AY part 3: the table's columns.
          jpName: p.company?.legalNameJa ?? null,
          country: p.country ?? p.company?.country ?? null,
          email: s.email ?? null,
          phone: s.phone ?? null,
          mainContact: mainContactOf((p.contacts ?? []).map((k) => ({ name: k.name, email: k.email ?? null, phone: k.phone ?? null, isPrimary: !!k.isPrimary })), contactsFrom(senders, [p.key ?? ''], p.emailDomains ?? [], OWN_DOMAINS)),
          lastDelivery: clientStats(mine, today).lastDelivery,
          carriers: p.logistics?.carriers ?? [],
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
      profile: maskedProfile(profile),
      company: companyView(profile.company),
      logistics: profile.logistics ?? {},
      contactList: profile.contacts ?? [],
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
      // Round BA: Products / Packing tabs.
      catalog: await this.catalogView(organizationId, 'supplier', id),
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
  async updateFormat(organizationId: string, customerId: string, docType: string, body: { generator?: string | null; language?: string | null; addressee?: string | null; notes?: string | null; si?: unknown }) {
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
    // Round BF — 出庫・納入依頼書 settings (new SIs only). Written straight to the stored profile (a settings save keeps
    // si / xlsxTemplate as they are, like the samples).
    if (body.si !== undefined) {
      if (t !== 'SHIPPING_INSTRUCTIONS') throw new BadRequestException('These settings are for the 出庫・納入依頼書');
      const si = body.si === null ? null : cleanSiFormat(body.si, this.bad);
      await this.config.updateSettings(organizationId, { customerProfiles: { [customerId]: next } });
      await this.writeFormat(organizationId, customerId, t, (cur) => {
        const out = { ...cur };
        if (si && Object.keys(si).length) out.si = si;
        else delete out.si;
        return out;
      });
      return this.customer(organizationId, customerId);
    }
    await this.config.updateSettings(organizationId, { customerProfiles: { [customerId]: next } });
    return this.customer(organizationId, customerId);
  }

  /** Round BF: ADH's own .xlsx for the 出庫・納入依頼書 — "Download .xlsx" fills it (replaces the previous one, which is kept in S3). */
  async setSiTemplate(organizationId: string, customerId: string, file: Express.Multer.File | undefined, actor: TradeActor) {
    await this.profileFor(organizationId, customerId);
    if (!file) throw new BadRequestException('Please attach a file');
    const fileName = decodeUploadName(file.originalname || 'template.xlsx');
    if (!/\.xlsx$/i.test(fileName)) throw new BadRequestException('The template must be an .xlsx file');
    if (file.size > TRADE_FILE_MAX_BYTES) throw new BadRequestException('File is larger than 25 MB');
    let mapping;
    try {
      mapping = await siTemplateMappingOf(file.buffer);
    } catch {
      throw new BadRequestException(`${fileName} could not be read as an .xlsx`);
    }
    const id = randomUUID();
    const s3Key = `${TradeFilesService.keyPrefix(organizationId)}format-samples/${customerId}/si-template_${id}_${sanitizeFileName(fileName)}`;
    const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    await this.s3.uploadFile(s3Key, file.buffer, mimeType);
    const tpl: FormatSample = { id, fileName, mimeType, sizeBytes: file.size, s3Key, uploadedAt: new Date().toISOString(), uploadedByName: actor.name };
    let replaced: string | null = null;
    await this.writeFormat(organizationId, customerId, 'SHIPPING_INSTRUCTIONS', (cur) => {
      // The previous template stays a (hidden) sample: nothing is deleted.
      if (cur.xlsxTemplate && !cur.xlsxTemplate.hidden) {
        replaced = cur.xlsxTemplate.fileName;
        return { ...cur, samples: [...(cur.samples ?? []), { ...cur.xlsxTemplate, hidden: true }], xlsxTemplate: tpl };
      }
      return { ...cur, xlsxTemplate: tpl };
    });
    return { ...(await this.customer(organizationId, customerId)), siTemplate: { fileName, found: mapping.filter((m) => m.cell).length, replaced } };
  }

  /** Stop using the uploaded template (kept, hidden): "Download .xlsx" goes back to AIMS's own sheet. */
  async hideSiTemplate(organizationId: string, customerId: string) {
    await this.profileFor(organizationId, customerId);
    let found = false;
    await this.writeFormat(organizationId, customerId, 'SHIPPING_INSTRUCTIONS', (cur) => {
      if (!cur.xlsxTemplate || cur.xlsxTemplate.hidden) return cur;
      found = true;
      return { ...cur, xlsxTemplate: { ...cur.xlsxTemplate, hidden: true } };
    });
    if (!found) throw new NotFoundException('No template to hide');
    return this.customer(organizationId, customerId);
  }

  /** The template's field → cell mapping (placeholders / printed labels, then the typed overrides). Read-only. */
  async siTemplateMapping(organizationId: string, customerId: string) {
    const p = await this.profileFor(organizationId, customerId);
    const f = p.docFormats?.SHIPPING_INSTRUCTIONS;
    const tpl = f?.xlsxTemplate && !f.xlsxTemplate.hidden ? f.xlsxTemplate : null;
    if (!tpl || !tpl.s3Key.startsWith(TradeFilesService.keyPrefix(organizationId))) return { template: null, mapping: [] };
    const buf = await this.s3.downloadFile(tpl.s3Key);
    return { template: { id: tpl.id, fileName: tpl.fileName, uploadedAt: tpl.uploadedAt, uploadedByName: tpl.uploadedByName ?? null }, mapping: await siTemplateMappingOf(buf, f?.si?.xlsxMapping ?? {}) };
  }

  /** One document format of the stored profile, rewritten (si / xlsxTemplate / samples — the Clients service's keys). */
  private async writeFormat(organizationId: string, customerId: string, t: DocFormatType, fn: (cur: NonNullable<CustomerProfile['docFormats']>[DocFormatType] & object) => NonNullable<CustomerProfile['docFormats']>[DocFormatType] & object) {
    const row = await this.prisma.tradeSetting.findUnique({ where: { organizationId }, select: { id: true, customerProfiles: true } });
    const profiles = (row?.customerProfiles as unknown as Record<string, CustomerProfile> | null) ?? {};
    const p = profiles[customerId] ?? profileFor({}, customerId);
    const formats = { ...(p.docFormats ?? {}) };
    formats[t] = fn({ ...(formats[t] ?? {}) });
    const next = { ...profiles, [customerId]: { ...p, docFormats: formats } };
    if (row) await this.prisma.tradeSetting.update({ where: { organizationId }, data: { customerProfiles: next as any } });
    else await this.prisma.tradeSetting.create({ data: { organizationId, customerProfiles: next as any } });
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
  // ── Round AY part 3: add / edit a customer or supplier, shipping lines ──
  private bad = (m: string): never => {
    throw new BadRequestException(m);
  };

  /** Customer / Supplier columns from a form (only the keys sent). */
  private columns(body: Record<string, unknown>, kind: 'customer' | 'supplier') {
    const t = (v: unknown, max: number, name: string) => {
      if (v === undefined) return undefined;
      if (v === null || v === '') return null;
      if (typeof v !== 'string' || v.length > max) this.bad(`${name} must be text (up to ${max} characters)`);
      return (v as string).trim() || null;
    };
    const email = t(body.email, 200, 'email');
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) this.bad(`"${email}" is not an e-mail address`);
    const currency = t(body.currency, 3, 'currency');
    if (currency && !/^[A-Z]{3}$/.test(currency)) this.bad('currency must be a 3-letter code (USD, JPY …)');
    const out: Record<string, unknown> = { name: t(body.name, 200, 'name'), email, phone: t(body.phone, 60, 'phone'), address: t(body.address, 1000, 'address'), gstRegNo: t(body.gstRegNo, 60, 'tax / registration no.'), currency: currency ?? undefined };
    if (kind === 'customer') Object.assign(out, { jpName: t(body.jpName, 200, '日本語名'), jpAddress: t(body.jpAddress, 1000, '住所') });
    if (out.name === null) this.bad('A name is needed');
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
  }

  /** The shipping lines a client profile may name (known by their B/L + those added with the Shipping line type). */
  private async knownCarriers(organizationId: string) {
    const stored = await this.storedLines(organizationId);
    return new Set([...carrierCatalog().map((c) => c.code), ...Object.entries(stored).filter(([, v]) => typesOf(v).includes('SHIPPING_LINE')).map(([k]) => k)]);
  }

  private uniqueName(e: unknown, what: string): never {
    if ((e as { code?: string })?.code === 'P2002') this.bad(`Another ${what} already uses this e-mail address or code`);
    throw e;
  }

  /** "+ Add customer": the Customer record, its trade profile (default billing: two-stage) and contacts. */
  async createCustomer(organizationId: string, body: Record<string, unknown>) {
    const cols = this.columns(body ?? {}, 'customer');
    if (!cols.name) this.bad('A name is needed');
    const company = cleanCompany(body.company, undefined, this.bad);
    const logistics = cleanLogistics(body.logistics, await this.knownCarriers(organizationId), this.bad);
    const contacts = cleanContacts(body.contacts, this.bad);
    // Contacts live on the trade profile (CustomerContact rows from Master Files are shown as they are).
    const c = await this.prisma.customer.create({ data: { organizationId, ...(cols as any) }, select: { id: true } }).catch((e: unknown) => this.uniqueName(e, 'customer'));
    await this.config.updateSettings(organizationId, { customerProfiles: { [c.id]: { ...defaultProfile(c.id), company, logistics, contacts: contacts.map((k) => ({ ...k, id: k.id ?? randomUUID() })) } } } as any);
    return this.customer(organizationId, c.id);
  }

  /** Details: company columns, profile company / logistics, contacts (added or edited — never deleted). */
  async updateCustomerDetails(organizationId: string, id: string, body: Record<string, unknown>) {
    const exists = await this.prisma.customer.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Customer not found');
    const cols = this.columns(body ?? {}, 'customer');
    const p = await this.config.profileOf(organizationId, id);
    const company = body.company === undefined ? p.company : cleanCompany(body.company, p.company, this.bad);
    const logistics = body.logistics === undefined ? p.logistics : cleanLogistics(body.logistics, await this.knownCarriers(organizationId), this.bad);
    const contacts = body.contacts === undefined ? p.contacts : mergeContacts(p.contacts, cleanContacts(body.contacts, this.bad));
    if (Object.keys(cols).length) await this.prisma.customer.update({ where: { id }, data: cols as any }).catch((e: unknown) => this.uniqueName(e, 'customer'));
    await this.config.updateSettings(organizationId, { customerProfiles: { [id]: { ...p, company, logistics, contacts } } } as any);
    return this.customer(organizationId, id);
  }

  /** "+ Add supplier": the Supplier record and its trade profile (with a PI and the org's document set, like Vedanta). */
  async createSupplier(organizationId: string, body: Record<string, unknown>) {
    const cols = this.columns(body ?? {}, 'supplier');
    if (!cols.name) this.bad('A name is needed');
    const company = cleanCompany(body.company, undefined, this.bad);
    const logistics = cleanLogistics(body.logistics, await this.knownCarriers(organizationId), this.bad);
    const contacts = cleanContacts(body.contacts, this.bad).map((k) => ({ ...k, id: k.id ?? randomUUID() }));
    const s = await this.prisma.supplier.create({ data: { organizationId, ...(cols as any) }, select: { id: true } }).catch((e: unknown) => this.uniqueName(e, 'supplier'));
    await this.config.updateSettings(organizationId, { supplierProfiles: { [s.id]: { ...defaultSupplierProfile(s.id), company, logistics, contacts } } } as any);
    return this.supplier(organizationId, s.id);
  }

  async updateSupplierDetails(organizationId: string, id: string, body: Record<string, unknown>) {
    const exists = await this.prisma.supplier.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Supplier not found');
    const cols = this.columns(body ?? {}, 'supplier');
    const p: SupplierProfile = await this.config.supplierProfileOf(organizationId, id);
    const patch: Record<string, unknown> = {};
    if (body.company !== undefined) patch.company = cleanCompany(body.company, p.company, this.bad);
    if (body.logistics !== undefined) patch.logistics = cleanLogistics(body.logistics, await this.knownCarriers(organizationId), this.bad);
    if (body.contacts !== undefined) patch.contacts = mergeContacts(p.contacts, cleanContacts(body.contacts, this.bad));
    if (Object.keys(cols).length) await this.prisma.supplier.update({ where: { id }, data: cols as any }).catch((e: unknown) => this.uniqueName(e, 'supplier'));
    if (Object.keys(patch).length) await this.config.updateSettings(organizationId, { supplierProfiles: { [id]: patch } } as any);
    return this.supplier(organizationId, id);
  }

  // ── Round BA: products & packing (customers and suppliers) ─────────────
  // Stored on the trade profile; this service is their only writer. Hidden
  // rows / files stay stored (nothing is deleted).

  private async assertParty(organizationId: string, kind: Party, id: string) {
    const row = kind === 'customer'
      ? await this.prisma.customer.findFirst({ where: { id, organizationId }, select: { id: true } })
      : await this.prisma.supplier.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!row) throw new NotFoundException(kind === 'customer' ? 'Customer not found' : 'Supplier not found');
  }

  private async readParty(organizationId: string, kind: Party, id: string): Promise<{ products: ClientProduct[]; packing: PackingInfo }> {
    const row: any = await this.prisma.tradeSetting.findUnique({ where: { organizationId }, select: { customerProfiles: true, supplierProfiles: true } });
    const p = ((kind === 'customer' ? row?.customerProfiles : row?.supplierProfiles) ?? {})[id] ?? {};
    return { products: p.products ?? [], packing: p.packing ?? {} };
  }

  /** The only writer of profile.products / profile.packing (a missing profile gets the default one, as a settings save would). */
  private async writeParty(organizationId: string, kind: Party, id: string, fn: (cur: { products: ClientProduct[]; packing: PackingInfo }) => { products: ClientProduct[]; packing: PackingInfo }) {
    const field = kind === 'customer' ? 'customerProfiles' : 'supplierProfiles';
    const row: any = await this.prisma.tradeSetting.findUnique({ where: { organizationId }, select: { id: true, [field]: true } });
    const profiles = (row?.[field] ?? {}) as Record<string, any>;
    const p = profiles[id] ?? (kind === 'customer' ? profileFor({}, id) : defaultSupplierProfile(id));
    const next = fn({ products: [...(p.products ?? [])], packing: { ...(p.packing ?? {}) } });
    const all = { ...profiles, [id]: { ...p, products: next.products, packing: next.packing } };
    if (row) await this.prisma.tradeSetting.update({ where: { organizationId }, data: { [field]: all } as any });
    else await this.prisma.tradeSetting.create({ data: { organizationId, [field]: all } as any });
  }

  private fileView = (f: ProfileFile) => ({ id: f.id, fileName: f.fileName, mimeType: f.mimeType, sizeBytes: f.sizeBytes, uploadedAt: f.uploadedAt, uploadedByName: f.uploadedByName ?? null, caption: f.caption ?? null, takenOn: f.takenOn ?? null });

  /** Products + packing as the screens see them (visible rows / files, no S3 keys; linked issues with their titles). */
  async catalogView(organizationId: string, kind: Party, id: string) {
    const { products, packing } = await this.readParty(organizationId, kind, id);
    const issueIds = packing.issueIds ?? [];
    const issues: any[] = issueIds.length
      ? await this.prisma.tradeIssue.findMany({ where: { organizationId, id: { in: issueIds } }, select: { id: true, title: true, summaryEn: true, summaryJa: true, status: true, createdAt: true } })
      : [];
    return {
      products: products.filter((p) => !p.hidden).map((p) => ({
        ...p,
        label: productLabel(p),
        size: productSize(p),
        specFiles: (p.specFiles ?? []).filter((f) => !f.hidden).map(this.fileView),
        packingImages: (p.packingImages ?? []).filter((f) => !f.hidden).map(this.fileView),
      })),
      hiddenProducts: products.filter((p) => p.hidden).length,
      packing: { notes: packing.notes ?? null, images: (packing.images ?? []).filter((f) => !f.hidden).map(this.fileView), issues },
    };
  }

  /** Add (productId null) or edit one product. */
  async saveProduct(organizationId: string, kind: Party, id: string, productId: string | null, body: unknown) {
    await this.assertParty(organizationId, kind, id);
    const now = new Date().toISOString();
    await this.writeParty(organizationId, kind, id, (cur) => {
      if (productId) {
        const i = cur.products.findIndex((p) => p.id === productId);
        if (i < 0) throw new NotFoundException('Product not found');
        cur.products[i] = cleanProduct(body, cur.products[i], productId, now, this.bad);
      } else cur.products.push(cleanProduct(body, undefined, randomUUID(), now, this.bad));
      return cur;
    });
    return this.catalogView(organizationId, kind, id);
  }

  /** Hide (or show again) a product — kept, never deleted. */
  async hideProduct(organizationId: string, kind: Party, id: string, productId: string, hidden = true) {
    await this.assertParty(organizationId, kind, id);
    await this.writeParty(organizationId, kind, id, (cur) => {
      const p = cur.products.find((x) => x.id === productId);
      if (!p) throw new NotFoundException('Product not found');
      p.hidden = hidden;
      p.updatedAt = new Date().toISOString();
      return cur;
    });
    return this.catalogView(organizationId, kind, id);
  }

  /** Validate + store one upload in S3 (images only for packing photos). */
  private async storeProfileFile(organizationId: string, kind: Party, id: string, folder: string, file: Express.Multer.File | undefined, meta: { caption?: unknown; takenOn?: unknown }, actor: TradeActor, imagesOnly: boolean): Promise<ProfileFile> {
    if (!file) throw new BadRequestException('Please attach a file');
    const fileName = decodeUploadName(file.originalname || 'file');
    const mimeType = resolveTradeFileMime(fileName, file.mimetype);
    if (!mimeType) throw new BadRequestException(`File type not allowed: ${fileName}`);
    if (imagesOnly && !mimeType.startsWith('image/')) throw new BadRequestException('Packing photos must be images (JPG, PNG…)');
    if (file.size > TRADE_FILE_MAX_BYTES) throw new BadRequestException('File is larger than 25 MB');
    const takenOn = typeof meta.takenOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(meta.takenOn) ? meta.takenOn : null;
    const caption = typeof meta.caption === 'string' && meta.caption.trim() ? meta.caption.trim().slice(0, 300) : null;
    const fid = randomUUID();
    const s3Key = `${TradeFilesService.keyPrefix(organizationId)}${folder}/${kind}/${id}/${fid}_${sanitizeFileName(fileName)}`;
    await this.s3.uploadFile(s3Key, file.buffer, mimeType);
    return { id: fid, fileName, mimeType, sizeBytes: file.size, s3Key, uploadedAt: new Date().toISOString(), uploadedByName: actor.name, caption, takenOn };
  }

  /** A spec sheet ("spec") or packing photo ("packing") on one product. */
  async addProductFile(organizationId: string, kind: Party, id: string, productId: string, slot: string, file: Express.Multer.File | undefined, meta: { caption?: unknown; takenOn?: unknown }, actor: TradeActor) {
    if (slot !== 'spec' && slot !== 'packing') throw new BadRequestException('slot must be spec or packing');
    await this.assertParty(organizationId, kind, id);
    const cur = await this.readParty(organizationId, kind, id);
    if (!cur.products.some((p) => p.id === productId)) throw new NotFoundException('Product not found');
    const f = await this.storeProfileFile(organizationId, kind, id, 'client-products', file, meta, actor, slot === 'packing');
    try {
      await this.writeParty(organizationId, kind, id, (c) => {
        const p = c.products.find((x) => x.id === productId);
        if (!p) throw new NotFoundException('Product not found');
        if (slot === 'spec') p.specFiles = [...(p.specFiles ?? []), f];
        else p.packingImages = [...(p.packingImages ?? []), f];
        p.updatedAt = new Date().toISOString();
        return c;
      });
    } catch (e) {
      await this.s3.deleteFile(f.s3Key).catch(() => undefined);
      throw e;
    }
    return this.catalogView(organizationId, kind, id);
  }

  /** A packing photo in the company's general Packing gallery. */
  async addPackingImage(organizationId: string, kind: Party, id: string, file: Express.Multer.File | undefined, meta: { caption?: unknown; takenOn?: unknown }, actor: TradeActor) {
    await this.assertParty(organizationId, kind, id);
    const f = await this.storeProfileFile(organizationId, kind, id, 'client-packing', file, meta, actor, true);
    try {
      await this.writeParty(organizationId, kind, id, (c) => ({ ...c, packing: { ...c.packing, images: [...(c.packing.images ?? []), f] } }));
    } catch (e) {
      await this.s3.deleteFile(f.s3Key).catch(() => undefined);
      throw e;
    }
    return this.catalogView(organizationId, kind, id);
  }

  /** Every file of this company's products + gallery, by id (for hide / url). */
  private findProfileFile(cur: { products: ClientProduct[]; packing: PackingInfo }, fileId: string): ProfileFile | null {
    for (const p of cur.products) for (const f of [...(p.specFiles ?? []), ...(p.packingImages ?? [])]) if (f.id === fileId) return f;
    return (cur.packing.images ?? []).find((f) => f.id === fileId) ?? null;
  }

  /** Hide a spec sheet / packing photo (kept in S3 and on the profile). */
  async hideProfileFile(organizationId: string, kind: Party, id: string, fileId: string) {
    await this.assertParty(organizationId, kind, id);
    let found = false;
    await this.writeParty(organizationId, kind, id, (c) => {
      const f = this.findProfileFile(c, fileId);
      if (f) {
        f.hidden = true;
        found = true;
      }
      return c;
    });
    if (!found) throw new NotFoundException('File not found');
    return this.catalogView(organizationId, kind, id);
  }

  async profileFileUrl(organizationId: string, kind: Party, id: string, fileId: string) {
    await this.assertParty(organizationId, kind, id);
    const f = this.findProfileFile(await this.readParty(organizationId, kind, id), fileId);
    if (!f || f.hidden || !f.s3Key.startsWith(TradeFilesService.keyPrefix(organizationId))) throw new NotFoundException('File not found');
    return { url: await this.s3.getSignedUrl(f.s3Key, SIGNED_URL_TTL), fileName: f.fileName, mimeType: f.mimeType, expiresIn: SIGNED_URL_TTL };
  }

  /** Packing notes and linked issues (the issues must be this org's). */
  async savePacking(organizationId: string, kind: Party, id: string, body: unknown) {
    await this.assertParty(organizationId, kind, id);
    const cur = await this.readParty(organizationId, kind, id);
    const next = cleanPacking(body, cur.packing, this.bad);
    if (next.issueIds?.length) {
      const n = await this.prisma.tradeIssue.count({ where: { organizationId, id: { in: next.issueIds } } });
      if (n !== next.issueIds.length) this.bad('An issue to link was not found');
    }
    await this.writeParty(organizationId, kind, id, (c) => ({ ...c, packing: next }));
    return this.catalogView(organizationId, kind, id);
  }

  /**
   * New order: every customer's and supplier's visible products (no files), each
   * customer product with the supplier products that fit it (exact / same grade).
   */
  async productCatalog(organizationId: string) {
    const row: any = await this.prisma.tradeSetting.findUnique({ where: { organizationId }, select: { customerProfiles: true, supplierProfiles: true } });
    const brief = (p: ClientProduct) => ({ id: p.id, label: productLabel(p), grade: p.grade ?? null, form: p.form ?? null, size: productSize(p), monthlyQtyMt: p.monthlyQtyMt ?? null, priceBasis: p.priceBasis ?? null });
    const suppliers = Object.entries((row?.supplierProfiles ?? {}) as Record<string, SupplierProfile>).map(([sid, p]) => ({ supplierId: sid, products: (p.products ?? []).filter((x) => !x.hidden) }));
    return {
      customers: Object.entries((row?.customerProfiles ?? {}) as Record<string, CustomerProfile>).map(([cid, p]) => ({
        customerId: cid,
        products: (p.products ?? []).filter((x) => !x.hidden).map((x) => ({
          ...brief(x),
          matches: suppliers.flatMap((s) => s.products.map((sp) => ({ supplierId: s.supplierId, productId: sp.id, label: productLabel(sp), fit: productMatch(x, sp) })).filter((m) => m.fit)),
        })),
      })).filter((c) => c.products.length),
      suppliers: suppliers.map((s) => ({ supplierId: s.supplierId, products: s.products.map(brief) })).filter((s) => s.products.length),
    };
  }

  /** Order / shipment pages: the customer's packing notes, photos (signed URLs) and linked issues, and each product's bundle data. */
  async packingFor(organizationId: string, customerId: string) {
    await this.assertParty(organizationId, 'customer', customerId);
    const view = await this.catalogView(organizationId, 'customer', customerId);
    const cur = await this.readParty(organizationId, 'customer', customerId);
    const urlOf = async (fid: string) => {
      const f = this.findProfileFile(cur, fid);
      return f ? this.s3.getSignedUrl(f.s3Key, SIGNED_URL_TTL) : null;
    };
    const withUrls = async (list: ReturnType<typeof this.fileView>[]) => Promise.all(list.map(async (f) => ({ ...f, url: await urlOf(f.id) })));
    return {
      notes: view.packing.notes,
      images: await withUrls(view.packing.images),
      issues: view.packing.issues,
      products: await Promise.all(
        view.products
          .filter((p) => p.packingImages.length || p.piecesPerBundle || p.bundleWeightKg)
          .map(async (p) => ({ id: p.id, label: p.label, piecesPerBundle: p.piecesPerBundle ?? null, bundleWeightKg: p.bundleWeightKg ?? null, images: await withUrls(p.packingImages) })),
      ),
    };
  }

  private async storedLines(organizationId: string): Promise<Record<string, ShippingLineInfo>> {
    const row: any = await this.prisma.tradeSetting.findUnique({ where: { organizationId }, select: { shippingLines: true } });
    return (row?.shippingLines ?? {}) as Record<string, ShippingLineInfo>;
  }

  /**
   * Clients → Logistics (round AZ; round AY's Shipping lines): the shipping lines AIMS knows by their B/L + every
   * company added here (forwarders / 乙仲, customs brokers, warehouses, trucking, insurers — one company may be several),
   * their info and contacts; shipping lines also their shipments and the clients using them; companies with e-mail
   * domains their e-mail count.
   */
  async shippingLines(organizationId: string) {
    const stored = await this.storedLines(organizationId);
    const catalog = carrierCatalog();
    const ships: any[] = await this.prisma.shipment.findMany({
      where: { organizationId, status: { not: 'CANCELLED' }, order: { isTest: false } },
      select: { id: true, seqNo: true, status: true, blNumber: true, shippingLine: true, eta: true, orderId: true, order: { select: { orderNo: true, customer: { select: { name: true } } } } },
      orderBy: [{ eta: 'desc' }],
    });
    const settings = await this.config.getSettings(organizationId);
    const users = (map: Record<string, { logistics?: { carriers?: string[] }; key?: string; label?: string }>, kind: 'customer' | 'supplier') =>
      Object.entries(map ?? {}).flatMap(([id, p]) => (p.logistics?.carriers ?? []).map((code) => ({ code, id, kind, name: p.label || p.key || id })));
    const used = [...users(settings.customerProfiles as any, 'customer'), ...users(settings.supplierProfiles as any, 'supplier')];
    // Short names (SUS, Kato …) from the profile, else the record's name.
    const [cn, sn]: [any[], any[]] = await Promise.all([
      this.prisma.customer.findMany({ where: { organizationId, id: { in: used.filter((u) => u.kind === 'customer').map((u) => u.id) } }, select: { id: true, name: true } }),
      this.prisma.supplier.findMany({ where: { organizationId, id: { in: used.filter((u) => u.kind === 'supplier').map((u) => u.id) } }, select: { id: true, name: true } }),
    ]);
    for (const u of used) {
      const p: any = (u.kind === 'customer' ? settings.customerProfiles : settings.supplierProfiles)?.[u.id];
      const rec = (u.kind === 'customer' ? cn : sn).find((x) => x.id === u.id);
      u.name = u.kind === 'customer' ? clientName(p?.key?.toUpperCase() ?? null, rec?.name ?? u.name) : p?.label || (rec ? shortSupplier(rec.name) : u.name);
    }
    const codes = [...new Set([...catalog.map((c) => c.code), ...Object.keys(stored)])];
    const isLine = (code: string) => !!catalog.find((c) => c.code === code) || typesOf(stored[code]).includes('SHIPPING_LINE');
    const byCode = new Map<string, any[]>();
    const unmatched: any[] = [];
    for (const s of ships) {
      const c = carrierOf(s.blNumber, s.shippingLine);
      const custom = !c && s.shippingLine ? Object.entries(stored).find(([k, v]) => v.custom && isLine(k) && v.name.toLowerCase() === String(s.shippingLine).trim().toLowerCase())?.[0] : undefined;
      const code = c?.code ?? custom;
      const row = { id: s.id, ref: shipmentRef(s.order?.orderNo, s.seqNo), orderId: s.orderId, status: s.status, blNumber: s.blNumber, eta: s.eta, customer: s.order?.customer?.name ?? null };
      if (code) byCode.set(code, [...(byCode.get(code) ?? []), row]);
      else if (s.blNumber && !/^TEST/i.test(s.blNumber)) unmatched.push({ ...row, shippingLine: s.shippingLine });
    }
    // E-mails from each company's domains (the intake log; counts only).
    const domains = [...new Set(Object.values(stored).flatMap((v) => v.emailDomains ?? []))];
    const mailCount = new Map<string, number>();
    for (const d of domains) mailCount.set(d, await this.prisma.emailIngestLog.count({ where: { organizationId, fromAddress: { endsWith: `@${d}`, mode: 'insensitive' } } }));
    const partners = codes.map((code) => {
      const known = catalog.find((c) => c.code === code);
      const info = stored[code] ?? ({} as ShippingLineInfo);
      const types = known ? [...new Set(['SHIPPING_LINE' as const, ...typesOf(info)])] : typesOf(info);
      const line = types.includes('SHIPPING_LINE');
      const list = line ? (byCode.get(code) ?? []) : [];
      return {
        code,
        name: info.name ?? known?.name ?? code,
        nameJa: info.nameJa ?? null,
        types,
        website: info.website ?? null,
        phone: info.phone ?? null,
        address: info.address ?? null,
        emailDomains: info.emailDomains ?? [],
        emails: (info.emailDomains ?? []).reduce((n, d) => n + (mailCount.get(d) ?? 0), 0),
        trackingUrl: line ? (info.trackingUrl ?? known?.trackingUrl ?? null) : null,
        agents: info.agents ?? [],
        freeTime: line ? (info.freeTime ?? null) : null,
        notes: info.notes ?? null,
        known: !!known,
        shipments: list.length,
        openShipments: list.filter((x) => x.status === 'OPEN').length,
        lastEta: list.find((x) => x.eta)?.eta ?? null,
        recent: list.slice(0, 20),
        clients: line ? used.filter((u) => u.code === code).map((u) => ({ id: u.id, kind: u.kind, name: u.name })) : [],
      };
    });
    const sorted = partners.sort((a, b) => b.shipments - a.shipments || b.emails - a.emails || a.name.localeCompare(b.name));
    // `lines` = round AY's name for the same list (kept for a portal tab still open during the deploy).
    return { partners: sorted, lines: sorted, unmatched: unmatched.slice(0, 50) };
  }

  /** "+ Add company" (a shipping line AIMS doesn't know by its B/L, a forwarder, a warehouse …), or edit one's info. */
  async saveShippingLine(organizationId: string, code: string | null, body: unknown) {
    const stored = await this.storedLines(organizationId);
    const catalog = carrierCatalog();
    const taken = new Set([...catalog.map((c) => c.code), ...Object.keys(stored)]);
    let key = code;
    if (!key) {
      const name = String((body as Record<string, unknown>)?.name ?? '').trim();
      if (!name) this.bad('A logistics company needs a name');
      if ([...catalog.map((c) => c.name), ...Object.values(stored).map((v) => v.name)].some((n) => n.toLowerCase() === name.toLowerCase())) this.bad(`"${name}" is already on the list`);
      key = lineCode(name, taken);
    } else if (!taken.has(key)) throw new NotFoundException('Logistics company not found');
    const known = !!catalog.find((c) => c.code === key);
    const cur = stored[key] ?? (known ? { name: catalog.find((c) => c.code === key)!.name } : { name: '', custom: true });
    const next = cleanShippingLine(body, cur as ShippingLineInfo, this.bad, known);
    const all = { ...stored, [key]: { ...next, ...(code ? {} : { custom: true }) } };
    await this.prisma.tradeSetting.upsert({ where: { organizationId }, update: { shippingLines: all as any }, create: { organizationId, shippingLines: all as any } });
    return { code: key, ...(await this.shippingLines(organizationId)) };
  }

}

/** The table's "main contact": the primary (else first) contact on record, else the busiest e-mail sender. */
function mainContactOf(records: Array<{ name: string; email: string | null; phone: string | null; isPrimary: boolean }>, senders: Array<{ email: string }>) {
  const r = records.find((x) => x.isPrimary) ?? records[0];
  if (r) return { name: r.name, email: r.email, phone: r.phone };
  return senders[0] ? { name: null, email: senders[0].email, phone: null } : null;
}

/** Contacts edited / added in place; one left out of the list is kept (contacts are never deleted from here). */
function mergeContacts(stored: ContactInfo[] | undefined, next: ContactInfo[]): ContactInfo[] {
  const withIds = next.map((k) => ({ ...k, id: k.id ?? randomUUID() }));
  const kept = (stored ?? []).filter((k) => !withIds.some((n) => n.id === k.id));
  const all = [...withIds, ...kept];
  // One main contact: the first marked.
  const main = all.findIndex((k) => k.isPrimary);
  return all.map((k, i) => ({ ...k, isPrimary: i === main || undefined }));
}
