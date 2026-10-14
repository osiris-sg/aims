import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { stampDocumentMoney } from '../common/document-money';
import { PrismaService } from '../common/prisma.service';
import { PdfGeneratorService } from '../common/services/pdf-generator.service';
import { S3Service } from '../common/services/s3.service';
import { DocumentsService } from '../documents/documents.service';
import { DocumentTemplatesService } from '../documentTemplates/documentTemplates.service';
import { TradeActor } from './shipments.request';
import { docDateErrors, stepLabel, tradeDateError, tradeToday } from './shipments.rules';
import { GenHeader, GenRef, renderGeneratedHtml } from './trade-generated.html';
import { buildCustomerCoaJp, classifyCoaText, COA_JP_COLUMNS, CoaFormatError, CoaSourceKind, parseCoaPdfText, pdfText } from './trade-coa';
import {
  addBusinessDays,
  dueBusinessDays,
  amountOf,
  finalizeMessage,
  invoiceFinalizeProblems,
  defaultLmeMonth,
  DeliveryProfile,
  DocDefaults,
  invoice1Line,
  invoice2FinalLines,
  InvoiceHeader,
  invoiceHeaderDefaults,
  invoiceTotals,
  renderInvoiceHtml,
  roundTo,
  qmjpForMonth,
  toInvoiceLines,
  unitPriceOf,
} from './trade-invoice';
import {
  billetSize,
  PackingRow,
  renderSgjpHtml,
  renderSgjpV2Html,
  renderSiHtml,
  renderSiV2Html,
  ScheduleRow,
  SgjpHeader,
  SgjpHeaderV2,
  SgjpItem,
  sgjpFinalizeProblems,
  sgjpInvoiceNo,
  SiHeader,
  SiHeaderV2,
  SiRowV2,
} from './trade-logistics-docs';
import { buildCustomerPl, CUSTOMER_PL_COLUMNS, GenColumn, GenRow, parseSheetFile, plTotals, SheetFormatError } from './trade-sheet.parser';
import { Db, TradeConfigService } from './trade-config.service';
import { TradeFilesService } from './trade-files.service';

export type TemplateKind = 'table' | 'invoice' | 'sgjp' | 'si';
type Owner = { shipmentId: string; contractId?: undefined } | { contractId: string; shipmentId?: undefined };

/**
 * In-app trade documents. One generic engine: each docType says what it is
 * drawn as (kind), which record it belongs to (scope), its PDF number prefix
 * and — for Customer PL / COA — which supplier spreadsheet can prefill it.
 * Every template can also be created blank (prefilled from the record).
 */
export const GENERATED_TEMPLATES: Record<
  string,
  { title: string; short: string; kind: TemplateKind; scope: 'SHIPMENT' | 'CONTRACT'; sourceDocType?: string; sourcePdf?: boolean; multiple?: boolean }
> = {
  CUSTOMER_PL: { title: '計量検収票', short: 'CPL', kind: 'table', scope: 'SHIPMENT', sourceDocType: 'PL' },
  // The COA summary PDF (COA_集計) and Vedanta's COA PDF are read too.
  CUSTOMER_COA: { title: '納品書兼分析試験成績報告書', short: 'CCOA', kind: 'table', scope: 'SHIPMENT', sourceDocType: 'COA', sourcePdf: true },
  INVOICE_1: { title: '請求書 (Invoice #1)', short: 'INV1', kind: 'invoice', scope: 'CONTRACT' },
  INVOICE_2: { title: '請求書 (Invoice #2)', short: 'INV2', kind: 'invoice', scope: 'SHIPMENT' },
  // Split arrivals (先着 / 後着) each get their own SG→JP invoice.
  SGJP_IV_PL: { title: 'INVOICE & PACKING LIST', short: 'SGJP', kind: 'sgjp', scope: 'SHIPMENT', multiple: true },
  SHIPPING_INSTRUCTIONS: { title: '出庫・納入依頼書', short: 'SI', kind: 'si', scope: 'SHIPMENT' },
};
export const GENERATED_DOC_TYPES = Object.keys(GENERATED_TEMPLATES);

/** Supplier spreadsheets the prefill can read (real .xls/.xlsx, Vedanta's tab-delimited ".XLS" text, CSV — the parser sniffs the bytes). */
const SOURCE_EXTENSIONS = /\.(xls|xlsx|csv|txt|tsv)$/i;
const isSource = (fileName: string, pdf?: boolean) => SOURCE_EXTENSIONS.test(fileName) || (!!pdf && /\.pdf$/i.test(fileName));
const PDF_MARGIN = { top: '12mm', right: '11mm', bottom: '14mm', left: '11mm' };
/** The 請求書 follows ADH's own invoice page: wider margins. */
const INVOICE_MARGIN = { top: '18mm', right: '17mm', bottom: '14mm', left: '20mm' };
const marginFor = (docType: string) => (GENERATED_TEMPLATES[docType]?.kind === 'invoice' ? INVOICE_MARGIN : PDF_MARGIN);

const GEN_SELECT = {
  id: true,
  shipmentId: true,
  contractId: true,
  docType: true,
  number: true,
  status: true,
  header: true,
  columns: true,
  rows: true,
  sourceFileId: true,
  finalFileId: true,
  documentId: true,
  docRef: true,
  createdById: true,
  createdByName: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class TradeGeneratedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly pdf: PdfGeneratorService,
    private readonly config: TradeConfigService,
    private readonly files: TradeFilesService,
    private readonly documents: DocumentsService,
    private readonly templates: DocumentTemplatesService,
  ) {}

  private template(docType: string) {
    const t = GENERATED_TEMPLATES[docType];
    if (!t) throw new BadRequestException(`No in-app template for ${docType} (available: ${Object.keys(GENERATED_TEMPLATES).join(', ')})`);
    return t;
  }

  /** Supplier spreadsheets on this shipment that can prefill `docType`. */
  async sources(organizationId: string, shipmentId: string, docType: string) {
    const t = this.template(docType);
    if (!t.sourceDocType) return [];
    const files: Array<{ id: string; fileName: string; createdAt: Date; uploadedByName: string | null; docRef: string | null }> = await this.prisma.tradeFile.findMany({
      where: { organizationId, docType: t.sourceDocType, links: { some: { shipmentId } } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, fileName: true, createdAt: true, uploadedByName: true, docRef: true },
    });
    const list = files.filter((f) => isSource(f.fileName, t.sourcePdf));
    // Best source first, labelled by what it holds: a spreadsheet (PL.XLS / COA.XLS) or the COA
    // summary PDF before Vedanta's per-cast test report (chemistry only).
    const ranked = await Promise.all(
      list.map(async (f) => {
        const isPdf = /\.pdf$/i.test(f.fileName);
        let kind: 'spreadsheet' | CoaSourceKind = isPdf ? 'unknown' : 'spreadsheet';
        if (isPdf) {
          try {
            const row = await this.prisma.tradeFile.findFirst({ where: { id: f.id, organizationId }, select: { s3Key: true } });
            kind = classifyCoaText(await pdfText(await this.s3.downloadFile(row!.s3Key)));
          } catch {
            kind = 'unknown';
          }
        }
        const coa = docType === 'CUSTOMER_COA';
        const label =
          kind === 'report'
            ? 'Test report: chemistry only'
            : kind === 'summary' || (kind === 'spreadsheet' && coa)
              ? 'COA summary: weights + chemistry'
              : kind === 'spreadsheet'
                ? 'Packing list spreadsheet: containers + weights'
                : coa
                  ? 'COA PDF'
                  : 'Packing list PDF';
        const rank = kind === 'spreadsheet' || kind === 'summary' ? 0 : kind === 'unknown' ? 1 : 2;
        return { ...f, kind, label, rank };
      }),
    );
    return ranked.sort((a, b) => a.rank - b.rank || b.createdAt.getTime() - a.createdAt.getTime()).map(({ rank, ...f }, i) => ({ ...f, best: i === 0 }));
  }

  async list(organizationId: string, filter: { shipmentId?: string; contractId?: string } = {}) {
    return this.prisma.tradeGeneratedDoc.findMany({
      where: { organizationId, ...(filter.shipmentId ? { shipmentId: filter.shipmentId } : {}), ...(filter.contractId ? { contractId: filter.contractId } : {}) },
      orderBy: { createdAt: 'desc' },
      select: GEN_SELECT,
    });
  }

  async get(organizationId: string, id: string) {
    const g = await this.prisma.tradeGeneratedDoc.findFirst({
      where: { id, organizationId },
      select: {
        ...GEN_SELECT,
        shipment: { select: { id: true, blNumber: true, status: true, contractId: true } },
        contract: { select: { id: true, contractNo: true, status: true } },
      },
    });
    if (!g) throw new NotFoundException('Document not found');
    return g;
  }

  /** The generated document a Sales invoice was finalized from, plus every contract / shipment linked to that invoice. */
  async byDocument(organizationId: string, documentId: string) {
    const g = await this.prisma.tradeGeneratedDoc.findFirst({
      where: { organizationId, documentId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, docType: true, number: true, status: true, documentId: true, finalFileId: true },
    });
    if (!g) throw new NotFoundException('No in-app document for this invoice');
    const links: Array<{ contract: { id: string; contractNo: string } | null; shipment: { id: string; blNumber: string | null; contract: { id: string; contractNo: string } | null } | null }> =
      await this.prisma.tradeDocumentLink.findMany({
        where: { organizationId, documentId },
        orderBy: { createdAt: 'asc' },
        select: {
          contract: { select: { id: true, contractNo: true } },
          shipment: { select: { id: true, blNumber: true, contract: { select: { id: true, contractNo: true } } } },
        },
      });
    const contracts = new Map<string, { id: string; contractNo: string }>();
    const shipments = new Map<string, { id: string; blNumber: string | null; contractNo: string | null }>();
    for (const l of links) {
      if (l.contract) contracts.set(l.contract.id, l.contract);
      if (l.shipment) {
        shipments.set(l.shipment.id, { id: l.shipment.id, blNumber: l.shipment.blNumber, contractNo: l.shipment.contract?.contractNo ?? null });
        if (l.shipment.contract) contracts.set(l.shipment.contract.id, l.shipment.contract);
      }
    }
    return { ...g, contracts: [...contracts.values()], shipments: [...shipments.values()] };
  }

  /** New DRAFT prefilled from a supplier PL / COA spreadsheet on the same shipment. */
  async createFromSource(organizationId: string, shipmentId: string, docType: string, sourceFileId: string, actor: TradeActor) {
    const t = this.template(docType);
    if (!t.sourceDocType) throw new BadRequestException(`${docType} is not created from a supplier file — use Create blank`);
    const shipment = await this.loadShipment(organizationId, shipmentId);
    if (shipment.status !== 'OPEN') throw new BadRequestException('Reopen the shipment before creating documents');
    const src = await this.prisma.tradeFile.findFirst({
      where: { id: sourceFileId, organizationId, links: { some: { shipmentId } } },
      select: { id: true, docType: true, fileName: true, s3Key: true },
    });
    if (!src) throw new BadRequestException('Source file not found on this shipment');
    if (src.docType !== t.sourceDocType) throw new BadRequestException(`The source must be a ${t.sourceDocType} file (this one is ${src.docType})`);
    if (!isSource(src.fileName, t.sourcePdf)) throw new BadRequestException(`${src.fileName} is not a spreadsheet (.xls, .xlsx, .csv, .txt${t.sourcePdf ? ' or a COA PDF' : ''})`);

    let built: { columns: GenColumn[]; rows: GenRow[]; notes: string[] };
    let fromPdf: { date: string | null; invoiceNo: string | null } | null = null;
    try {
      const buf = await this.s3.downloadFile(src.s3Key);
      if (docType === 'CUSTOMER_PL') {
        const sheet = parseSheetFile(buf);
        built = buildCustomerPl(sheet);
        built = { ...built, notes: [...sheet.notes, ...built.notes] };
      } else if (/\.pdf$/i.test(src.fileName)) {
        const sheet = parseCoaPdfText(await pdfText(buf));
        fromPdf = { date: sheet.date, invoiceNo: sheet.invoiceNo };
        built = buildCustomerCoaJp(sheet);
      } else {
        const sheet = parseSheetFile(buf);
        built = buildCustomerCoaJp(sheet);
        built = { ...built, notes: [...sheet.notes, ...built.notes] };
      }
    } catch (e) {
      if (e instanceof SheetFormatError || e instanceof CoaFormatError) throw new BadRequestException(`${src.fileName}: ${e.message}`);
      throw e;
    }
    if (!built.rows.length) throw new BadRequestException(`${src.fileName} has no data rows`);

    let header = await this.defaultHeader(organizationId, shipment, t.title, docType);
    if (docType === 'CUSTOMER_COA') {
      const date = fromPdf?.date ?? (await this.coaPdfDateFor(organizationId, shipmentId));
      if (date) header = { ...header, analysisDate: date };
    }
    return this.prisma.tradeGeneratedDoc
      .create({
        data: {
          organizationId,
          shipmentId,
          docType,
          header: header as any,
          columns: built.columns as any,
          rows: built.rows as any,
          sourceFileId: src.id,
          createdById: actor.id ?? 'unknown',
          createdByName: actor.name,
        },
        select: GEN_SELECT,
      })
      .then((g) => ({ ...g, importNotes: built.notes }));
  }

  /** Edit a DRAFT (header / columns / rows). */
  async update(organizationId: string, id: string, body: { header?: unknown; columns?: unknown; rows?: unknown }) {
    const g = await this.get(organizationId, id);
    if (g.status !== 'DRAFT') throw new BadRequestException('This document is final — use "Edit again" first');
    if (body.columns !== undefined && !Array.isArray(body.columns)) throw new BadRequestException('columns must be a list');
    if (body.rows !== undefined && !Array.isArray(body.rows)) throw new BadRequestException('rows must be a list');
    assertDocDates(body.header, body.rows);
    return this.prisma.tradeGeneratedDoc.update({
      where: { id, organizationId },
      data: {
        ...(body.header !== undefined ? { header: body.header as any } : {}),
        ...(body.columns !== undefined ? { columns: body.columns as any } : {}),
        ...(body.rows !== undefined ? { rows: body.rows as any } : {}),
      },
      select: GEN_SELECT,
    });
  }

  // ── create blank ────────────────────────────────────────────────────────
  /**
   * A new DRAFT typed in-app, prefilled from its contract / shipment (customer,
   * contract no., B/L, vessel, ports, weights, product line, containers …) and
   * the org's document defaults (TradeSetting.docDefaults).
   */
  async createBlank(organizationId: string, input: { docType: string; shipmentId?: string; contractId?: string }, actor: TradeActor) {
    const t = this.template(input.docType);
    const owner = this.ownerFor(t.scope, input);
    const settings = await this.config.getSettings(organizationId);
    const defaults = (settings.docDefaults ?? {}) as DocDefaults;
    const org = await this.prisma.organization.findFirst({ where: { id: organizationId }, select: { name: true, address: true, phoneNumber: true, registrationNumber: true } });
    const today = tradeToday();
    let header: unknown;
    let columns: unknown = [];
    let rows: unknown[] = [];

    if (t.kind === 'table') {
      const s = await this.loadShipment(organizationId, owner.shipmentId!);
      this.assertOpen(s.status, 'shipment');
      header = await this.defaultHeader(organizationId, s, t.title, input.docType);
      if (input.docType === 'CUSTOMER_COA') {
        const date = await this.coaPdfDateFor(organizationId, s.id);
        if (date) header = { ...(header as GenHeader), analysisDate: date };
      }
      columns = (input.docType === 'CUSTOMER_PL' ? CUSTOMER_PL_COLUMNS : COA_JP_COLUMNS).map((c) => ({ ...c }));
      rows = [input.docType === 'CUSTOMER_PL' ? { no: 1, batch: '', container: '', netMt: null, grossMt: null } : { batch: '', bundles: null, netwt: null }];
    } else if (t.kind === 'invoice' && input.docType === 'INVOICE_1') {
      const c = await this.loadContract(organizationId, owner.contractId!);
      this.assertOpen(c.status, 'contract');
      const h = invoiceHeaderDefaults({
        today,
        org: org ?? { name: '' },
        // 請求書 is Japanese: the customer's Japanese legal name (name only, as on ADH's invoices).
        customerName: c.customer?.jpName || c.customer?.name || '',
        grades: c.lines.map((l) => l.grade ?? ''),
        products: c.lines.map((l) => l.product ?? ''),
        defaults,
        lmeMonth: defaultLmeMonth('INVOICE_1', c.shipmentMonth),
      });
      header = h;
      rows = c.lines.map((l) => invoice1Line({ id: c.id, contractNo: c.contractNo }, l, defaults, h.dueDate, h.lmeMonth));
    } else if (t.kind === 'invoice') {
      // Invoice #2 as ADH issues it: final price on the actual net weight, customs / transport / other costs,
      // and the 差額 against what Invoice #1 billed for this product.
      const s = await this.loadShipmentCtx(organizationId, owner.shipmentId!);
      this.assertOpen(s.status, 'shipment');
      const line = s.contractLine;
      const h = invoiceHeaderDefaults({
        today,
        docType: 'INVOICE_2',
        org: org ?? { name: '' },
        customerName: s.customer?.jpName || s.customer?.name || '',
        grades: [line?.grade ?? ''],
        products: [line?.product ?? ''],
        defaults,
      });
      const inv1 = await this.invoice1LineFor(organizationId, s.contract.id, line?.id ?? null, true);
      const lmeMonth = defaultLmeMonth('INVOICE_2', s.contract.shipmentMonth);
      header = {
        ...h,
        lmeMonth,
        variant: 'final',
        invoice1No: inv1?.number ?? null,
        // What Invoice #1 billed for this product, tax incl.; blank (with a hint in the form) when it billed nothing.
        invoice1Amount: inv1 && amountOf(inv1.line) !== 0 ? roundTo(amountOf(inv1.line) * (1 + (inv1.taxRate ?? h.taxRate) / 100), 2) : null,
      } satisfies InvoiceHeader;
      rows = invoice2FinalLines({
        netWeightMt: s.netWeightMt,
        line,
        contract: { id: s.contract.id, contractNo: s.contract.contractNo },
        // Price parts: Invoice #1's line for this product, else the contract line's; QMJP from the
        // quarter of the shipment month (the org's QMJP table) — not Invoice #1's quarter.
        invoice1Line: pricePartsOf(inv1?.line ?? null, line, qmjpForMonth(defaults, s.contract.shipmentMonth)),
        defaults,
        dueDate: h.dueDate,
        lmeMonth,
      });
    } else if (t.kind === 'sgjp') {
      const s = await this.loadShipmentCtx(organizationId, owner.shipmentId!);
      this.assertOpen(s.status, 'shipment');
      const h: SgjpHeaderV2 = {
        layout: 2,
        invoiceNo: sgjpInvoiceNo(today),
        invoiceDate: today,
        // The supplier's master record when it has an address, else the org's default Shipper block.
        shipperBlock: s.contract.supplier?.address ? `${s.contract.supplier.name}\n${s.contract.supplier.address}` : (defaults.sgjpShipperBlock ?? s.contract.supplier?.name ?? ''),
        consigneeBlock: defaults.sgjpConsigneeBlock ?? settings.defaultConsignee ?? s.contract.consignee ?? '',
        sellerBlock: defaults.sgjpSellerBlock ?? defaults.sgSellerBlock ?? org?.name ?? '',
        buyerBlock: defaults.sgjpBuyerBlock ?? defaults.sgjpConsigneeBlock ?? settings.defaultConsignee ?? s.contract.consignee ?? '',
        placeOfReceipt: s.portOfLoading ?? '',
        portOfLoading: s.portOfLoading ?? '',
        portOfDischarge: s.portOfDischarge ?? s.contract.destinationPort ?? '',
        placeOfDelivery: s.portOfDischarge ?? s.contract.destinationPort ?? '',
        payment: '',
        countryOfOrigin: (s.countryOfOrigin ?? '').toUpperCase(),
        vessel: [s.vessel, s.voyageNo].filter(Boolean).join(' / '),
        others: '',
        shippingMarks: '',
        signBlock: defaults.sgjpSignBlock ?? defaults.sgjpSellerBlock ?? defaults.sgSellerBlock ?? org?.name ?? '',
        currency: s.currency || 'USD',
        lmeMonth: defaultLmeMonth('SGJP_IV_PL', s.contract.shipmentMonth),
      };
      header = h;
      // The customer price: helper fields start from Invoice #1's line for this product (LME of the shipment month is typed).
      const inv1 = await this.invoice1LineFor(organizationId, s.contract.id, s.contractLine?.id ?? null, false);
      const pl = s.netWeightMt === null || s.grossWeightMt === null || s.totalBundles === null ? await this.plTotalsFor(organizationId, s.id) : null;
      const net = dec(s.netWeightMt) ?? pl?.netMt ?? null;
      const item: SgjpItem = {
        goods: sgjpGoods(s.contractLine?.product ?? s.commodity, s.contractLine?.grade, s.sizeSpec ?? s.contractLine?.sizeSpec, defaults),
        hsCode: s.hsCode ?? '',
        terms: s.contract.incoterm ?? 'CIF',
        lme: null,
        ...pricePartsOf(inv1?.line ?? null, s.contractLine, qmjpForMonth(defaults, s.contract.shipmentMonth)),
        unitPrice: null,
        quantity: net,
        bundles: s.totalBundles ?? pl?.bundles ?? null,
        pieces: s.totalPieces,
        netMt: net,
        grossMt: dec(s.grossWeightMt) ?? pl?.grossMt ?? null,
        dimension: defaults.sgjpDimension ?? '',
      };
      rows = [item];
    } else {
      const s = await this.loadShipmentCtx(organizationId, owner.shipmentId!);
      this.assertOpen(s.status, 'shipment');
      const profile = deliveryProfileFor(defaults.deliveryProfiles, s.customer?.name ?? '') ?? deliveryProfileFor(defaults.deliveryProfiles, s.customer?.jpName ?? '');
      const h: SiHeaderV2 = {
        layout: 2,
        requestDate: today,
        // 宛先 line incl. 御中 — a document setting (ADH's sheets use both "三井倉庫 株式会社 御中" and "三井倉庫 御中").
        toName: defaults.siAddressee ?? (defaults.siWarehouseTo || defaults.siTo ? `${defaults.siWarehouseTo ?? defaults.siTo} 御中` : '三井倉庫 株式会社 御中'),
        issuerName: defaults.siIssuerName ?? org?.name ?? '',
        title: '出庫・納入依頼書',
        vessel: s.vessel ?? '',
        voyageNo: s.voyageNo ?? '',
        blNumber: s.blNumber ?? '',
        warehouseName: defaults.siWarehouseName ?? '',
        grossWeightMt: dec(s.grossWeightMt),
        netWeightMt: dec(s.netWeightMt),
        shipper: defaults.siIssuerName ?? org?.name ?? '',
        carrier: defaults.siCarrier ?? '',
        remarks: profile ? deliveryRemarks(profile) : '',
        deliveryProfileId: profile?.id ?? null,
      };
      header = h;
      const row: SiRowV2 = {
        shipDate: '',
        deliveryDate: '',
        destination: profile?.siteName ?? (s.customer?.jpName || s.customer?.name || ''),
        billet: `${defaults.siBilletLabel ?? ''}${billetSize(s.sizeSpec ?? s.contractLine?.sizeSpec)}`,
        bundles: null,
      };
      rows = [row];
    }

    const docRef = await this.config.docRefFor(this.prisma, organizationId, owner as any, input.docType);
    return this.prisma.tradeGeneratedDoc.create({
      data: {
        organizationId,
        ...owner,
        docType: input.docType,
        docRef,
        header: header as any,
        columns: columns as any,
        rows: rows as any,
        createdById: actor.id ?? 'unknown',
        createdByName: actor.name,
      },
      select: GEN_SELECT,
    });
  }

  // ── render ──────────────────────────────────────────────────────────────
  /** The document's HTML (preview and PDF share it); drafts print like the final document. */
  render(docType: string, header: unknown, columns: unknown, rows: unknown, opts: { draft?: boolean; seal?: string | null } = {}): string {
    const t = this.template(docType);
    const list = Array.isArray(rows) ? rows : [];
    const layout2 = (header as { layout?: unknown } | null)?.layout === 2;
    if (t.kind === 'invoice') return renderInvoiceHtml(header as InvoiceHeader, toInvoiceLines(list), opts);
    // Documents created before the ADH layouts keep their original template.
    if (t.kind === 'sgjp') return layout2 ? renderSgjpV2Html(header as SgjpHeaderV2, list as SgjpItem[], opts) : renderSgjpHtml(header as SgjpHeader, list as PackingRow[], opts);
    if (t.kind === 'si') return layout2 ? renderSiV2Html(header as SiHeaderV2, list as SiRowV2[], opts) : renderSiHtml(header as SiHeader, list as ScheduleRow[], opts);
    return renderGeneratedHtml(docType, header as GenHeader, (columns as GenColumn[]) ?? [], list as GenRow[], opts);
  }

  /** HTML for the live preview (same template as the PDF). Pass the org to print its seal. */
  previewHtml(docType: string, header: unknown, columns: unknown, rows: unknown, draft = true, seal: string | null = null) {
    return this.render(docType, header, columns ?? [], rows ?? [], { draft, seal });
  }

  /** 請求書 due date: Japanese bank business days after the issue date — Invoice #1 7, Invoice #2 6 (see dueBusinessDays). */
  async dueDateFor(organizationId: string, issueDate: string, docType?: string): Promise<{ issueDate: string; dueDate: string; businessDays: number }> {
    assertIsoDate(issueDate, 'issueDate');
    const settings = await this.config.getSettings(organizationId);
    const days = dueBusinessDays((settings.docDefaults as DocDefaults | undefined) ?? {}, docType);
    return { issueDate, dueDate: addBusinessDays(issueDate, days), businessDays: days };
  }

  /** The org's seal image (docDefaults.sealImage), for 請求書. */
  async sealFor(organizationId: string): Promise<string | null> {
    const settings = await this.config.getSettings(organizationId);
    const v = (settings.docDefaults as DocDefaults | undefined)?.sealImage;
    return typeof v === 'string' && v.startsWith('data:image/') ? v : null;
  }

  /**
   * Download PDF: a FINAL document returns the stored PDF; a DRAFT is rendered
   * now (no watermark; the file name ends in -DRAFT).
   */
  async pdfFor(organizationId: string, id: string): Promise<{ buffer: Buffer; fileName: string }> {
    const g = await this.get(organizationId, id);
    const t = this.template(g.docType);
    if (g.status === 'FINAL' && g.finalFileId) {
      const f = await this.prisma.tradeFile.findFirst({ where: { id: g.finalFileId, organizationId }, select: { s3Key: true, fileName: true } });
      if (f) return { buffer: await this.s3.downloadFile(f.s3Key), fileName: f.fileName };
    }
    const seal = t.kind === 'invoice' ? await this.sealFor(organizationId) : null;
    const buffer = await this.pdf.generatePdfFromHtml(this.render(g.docType, g.header, g.columns, g.rows, { draft: true, seal }), { margin: marginFor(g.docType) });
    return { buffer, fileName: `${g.number ?? t.short}-DRAFT.pdf` };
  }

  // ── finalize / edit again / delete ──────────────────────────────────────
  /**
   * Render the PDF, store it as a TradeFile of this docType linked to its
   * record(s) (tagged with the step that needs it) and mark the doc FINAL.
   * Invoices also create / update and confirm the Sales Document (type
   * INVOICE, the org's invoice numbering) and link it to every contract /
   * shipment billed — the confirmed invoice satisfies the step.
   */
  async finalize(organizationId: string, id: string, actor: TradeActor) {
    const g = await this.get(organizationId, id);
    if (g.status !== 'DRAFT') throw new BadRequestException('Already final');
    if (g.shipment && g.shipment.status !== 'OPEN') throw new BadRequestException('Reopen the shipment before finalizing');
    if (g.contract && g.contract.status !== 'OPEN') throw new BadRequestException('Reopen the contract before finalizing');
    const t = this.template(g.docType);
    const rows = (g.rows as unknown[]) ?? [];
    if (!rows.length) throw new BadRequestException('Add at least one row before finalizing');
    assertDocDates(g.header, rows);
    const gh = (g.header ?? {}) as { layout?: unknown; analysisDate?: unknown };
    if (g.docType === 'CUSTOMER_COA' && gh.layout === 'jp' && !String(gh.analysisDate ?? '').trim()) {
      throw new BadRequestException("Can't finalize: enter the analysis date (分析 日付).");
    }
    const blank = blankDocProblems(g.docType, g.header, rows);
    if (blank.length) throw new BadRequestException(finalizeMessage(blank));
    const owners = await this.ownersOf(organizationId, g);

    let number = g.number;
    let header = g.header as any;
    let documentId = g.documentId;
    if (t.kind === 'invoice') {
      const lines = toInvoiceLines(rows);
      if (!lines.some((l) => l.description.trim() || amountOf(l) !== 0)) throw new BadRequestException('Add at least one invoice line');
      // No unpriced lines and no US$0.00 invoice (a blank Invoice #1 used to finalize at 0).
      const problems = invoiceFinalizeProblems(lines, Number((header as InvoiceHeader).taxRate ?? 10));
      if (problems.length) throw new BadRequestException(finalizeMessage(problems));
      const doc = await this.ensureSalesInvoice(organizationId, g, header as InvoiceHeader, lines, owners, actor);
      documentId = doc.id;
      number = doc.name;
      header = { ...header, invoiceNo: doc.name };
    } else if (t.kind === 'sgjp' && header?.layout === 2) {
      const problems = sgjpFinalizeProblems(rows as SgjpItem[]);
      if (problems.length) throw new BadRequestException(finalizeMessage(problems));
      // The SG→JP invoice no. (ADH + yyyymmdd) is the document number; split arrivals need different numbers.
      number = String(header.invoiceNo ?? '').trim() || `${t.short}-${g.shipment?.blNumber || g.id.slice(0, 8)}`;
      const clash = await this.prisma.tradeGeneratedDoc.findFirst({
        where: { organizationId, docType: g.docType, status: 'FINAL', number, id: { not: g.id } },
        select: { id: true },
      });
      if (clash) throw new BadRequestException(`Another SG→JP invoice is already numbered ${number} — change the invoice no. (e.g. the date of this arrival)`);
      header = { ...header, invoiceNo: number };
    } else {
      number = number || `${t.short}-${g.shipment?.blNumber || g.contract?.contractNo || g.id.slice(0, 8)}`;
      header = t.kind === 'sgjp' ? { ...header, invoiceNo: header.invoiceNo || number } : t.kind === 'si' ? { ...header, number } : { ...header, number };
    }

    const seal = t.kind === 'invoice' ? await this.sealFor(organizationId) : null;
    const pdf = await this.pdf.generatePdfFromHtml(this.render(g.docType, header, g.columns, rows, { draft: false, seal }), { margin: marginFor(g.docType) });
    const [primary, ...more] = owners;
    const file = await this.files.upload(
      organizationId,
      { originalname: `${number}.pdf`, mimetype: 'application/pdf', size: pdf.length, buffer: pdf } as Express.Multer.File,
      {
        docType: g.docType,
        ...(primary.shipmentId ? { shipmentIds: [primary.shipmentId] } : { contractIds: [primary.contractId] }),
        ...(primary.stepId ? { stepId: primary.stepId } : {}),
        notes: 'Created in-app',
      } as any,
      actor,
      // The PDF carries the in-app document's ID (454003255-1-CPL); an older document without one takes the PDF's.
      { docRef: (g as { docRef?: string | null }).docRef ?? null },
    );
    // Every other record it belongs to (Invoice #1 billing several contracts), each tagged with its own step.
    for (const o of more) {
      await this.files.addLinks(
        organizationId,
        file.id,
        {
          ...(o.contractId ? { contractIds: [o.contractId] } : { shipmentIds: [o.shipmentId] }),
          ...(o.stepId ? { stepId: o.stepId } : {}),
        } as any,
        actor,
      );
    }
    return this.prisma.tradeGeneratedDoc.update({
      where: { id, organizationId },
      data: { status: 'FINAL', number, header, finalFileId: file.id, documentId, ...((g as { docRef?: string | null }).docRef ? {} : { docRef: (file as { docRef?: string | null }).docRef ?? null }) },
      select: GEN_SELECT,
    });
  }

  /**
   * "Edit again": back to DRAFT, removing the finalized PDF. Refused while a
   * DONE step on any record it belongs to needs this document type (reopen it
   * first). An invoice's Sales Document goes back to unconfirmed.
   */
  async revert(organizationId: string, id: string) {
    const g = await this.get(organizationId, id);
    if (g.status !== 'FINAL') throw new BadRequestException('Only a final document can be edited again');
    const owners = await this.ownersOf(organizationId, g);
    const done = await this.prisma.tradeStep.findMany({
      where: {
        organizationId,
        status: 'DONE',
        requiredDocTypes: { has: g.docType },
        OR: owners.map((o) => (o.contractId ? { contractId: o.contractId } : { shipmentId: o.shipmentId })),
      },
      select: { title: true, displayNo: true },
    });
    if (done.length) {
      throw new BadRequestException(`Can't edit again: reopen ${done.map((s) => `"${stepLabel(s)}"`).join(', ')} first — it needs this document`);
    }
    if (g.documentId) await this.unconfirmSalesInvoice(organizationId, g.documentId);
    if (g.finalFileId) {
      const exists = await this.prisma.tradeFile.findFirst({ where: { id: g.finalFileId, organizationId }, select: { id: true } });
      if (exists) await this.files.remove(organizationId, g.finalFileId);
    }
    return this.prisma.tradeGeneratedDoc.update({ where: { id, organizationId }, data: { status: 'DRAFT', finalFileId: null }, select: GEN_SELECT });
  }

  /** Delete a document; a final one also removes its PDF (same DONE-step guard); a draft invoice's unconfirmed Sales Document goes too. */
  async remove(organizationId: string, id: string) {
    const g = await this.get(organizationId, id);
    if (g.finalFileId) {
      const exists = await this.prisma.tradeFile.findFirst({ where: { id: g.finalFileId, organizationId }, select: { id: true } });
      if (exists) await this.files.remove(organizationId, g.finalFileId);
    }
    if (g.documentId) {
      if (g.status === 'FINAL') throw new BadRequestException('Use "Edit again" before deleting a finalized invoice');
      const doc = await this.prisma.document.findFirst({ where: { id: g.documentId, organizationId }, select: { id: true, status: true } });
      if (doc) {
        if (!['draft', 'unconfirmed'].includes(doc.status)) throw new BadRequestException('Its Sales invoice is confirmed — use "Edit again" first');
        await this.prisma.tradeDocumentLink.deleteMany({ where: { organizationId, documentId: doc.id } });
        await this.prisma.document.delete({ where: { id: doc.id } });
      }
    }
    await this.prisma.tradeGeneratedDoc.delete({ where: { id, organizationId } });
    return { id, deleted: true };
  }

  // ── invoices ↔ Sales Documents ──────────────────────────────────────────
  /**
   * Create (or refresh, after "Edit again") the Sales Document behind an ADH
   * 請求書 and confirm it through the normal invoice confirm path, so it shows
   * in the Invoices tab with the org's invoice number and satisfies the step
   * via TradeDocumentLink.
   */
  private async ensureSalesInvoice(
    organizationId: string,
    g: { id: string; docType: string; documentId: string | null; shipment: { blNumber: string | null } | null; contract: { contractNo: string } | null },
    h: InvoiceHeader,
    lines: ReturnType<typeof toInvoiceLines>,
    owners: Array<{ contractId?: string; shipmentId?: string; stepId?: string }>,
    actor: TradeActor,
  ): Promise<{ id: string; name: string }> {
    const totals = invoiceTotals(lines, h.taxRate, h.fxRate);
    const customer = await this.customerOf(organizationId, owners);
    const contractNos = [...new Set(lines.map((l) => l.contractNo).filter(Boolean))];
    const reference = [contractNos.length ? `Contract ${contractNos.join(', ')}` : null, g.shipment?.blNumber ? `B/L ${g.shipment.blNumber}` : null].filter(Boolean).join(' / ');
    const items = lines
      .filter((l) => l.description.trim() || amountOf(l) !== 0)
      .map((l, i) => ({
        id: Date.now() + i,
        itemCode: '',
        inventoryItemId: '',
        description: l.description,
        uom: l.unit,
        quantity: l.quantity ?? 0,
        unitPrice: unitPriceOf(l) ?? 0,
        discount: 0,
        amount: amountOf(l),
        remarks: l.remarks,
      }));
    // Invoice #2 (final price): the Sales invoice is the 差額 still owed — what Invoice #1 billed (tax incl.) is deducted.
    const first = h.variant === 'final' && h.invoice1Amount !== null && h.invoice1Amount !== undefined && Number.isFinite(Number(h.invoice1Amount)) ? roundTo(Number(h.invoice1Amount), 2) : 0;
    if (first) {
      items.push({
        id: Date.now() + items.length,
        itemCode: '',
        inventoryItemId: '',
        description: `１回目の金額${h.invoice1No ? ` (${h.invoice1No})` : ''} — 税込`,
        uom: '',
        quantity: 1,
        unitPrice: -first,
        discount: 0,
        amount: -first,
        remarks: '',
      });
    }
    const subtotal = roundTo(totals.subtotal - first, 2);
    const gross = roundTo(totals.total - first, 2);
    const patch = stampDocumentMoney(
      {
        customer: customer ? { id: customer.id, name: customer.name, customerCode: customer.customerCode, address: customer.address } : undefined,
        customerId: customer?.id,
        currency: h.currency || 'USD',
        // config.referenceNo is the canonical reference key.
        referenceNo: reference || undefined,
        items,
        subtotal,
        gstAmount: totals.tax,
        taxRate: h.taxRate,
        // The invoice editor / list read the tax-inclusive total from nettTotal (flat and documentInfo).
        nettTotal: gross,
        // Same keys the invoice editor writes (Y/N select, gstPercent).
        // documentInfo.date / date: the invoice editor's and the Invoices list's issue date.
        documentInfo: { taxApplicable: 'Y', gstPercent: h.taxRate, subtotal, gstAmount: totals.tax, nettTotal: gross, currency: h.currency || 'USD', date: h.issueDate, dueDate: h.dueDate },
        date: h.issueDate,
        issueDate: h.issueDate,
        dueDate: h.dueDate,
        tradeGeneratedDocId: g.id,
        tradeDocType: g.docType,
      },
      { gross },
    );

    let doc: { id: string; name: string | null; status: string } | null = g.documentId
      ? await this.prisma.document.findFirst({ where: { id: g.documentId, organizationId }, select: { id: true, name: true, status: true } })
      : null;
    if (doc) {
      if (!['draft', 'unconfirmed'].includes(doc.status)) throw new BadRequestException('Its Sales invoice is already confirmed');
      const cur = await this.prisma.document.findFirst({ where: { id: doc.id }, select: { config: true } });
      const prev = (cur?.config as Record<string, any>) ?? {};
      await this.prisma.document.update({ where: { id: doc.id }, data: { config: { ...prev, ...patch, documentInfo: { ...(prev.documentInfo ?? {}), ...patch.documentInfo } } } });
    } else {
      const tpl = await this.templates.getDocumentTemplateByType('INVOICE', organizationId);
      if (!tpl?.id) throw new BadRequestException('No invoice template is set up for this organization');
      const created = await this.documents.createBasicDocument(tpl.id, 'INVOICE', organizationId, patch, undefined, { id: actor.id ?? undefined, name: actor.name ?? undefined });
      doc = { id: created.id, name: created.name, status: created.status };
    }
    await this.documents.confirmInvoice(doc.id, { fromInvoiceNo: '', toInvoiceNo: '' }, organizationId, { id: actor.id ?? undefined, name: actor.name ?? undefined });
    for (const o of owners) {
      const where = o.contractId ? { documentId: doc.id, contractId: o.contractId } : { documentId: doc.id, shipmentId: o.shipmentId };
      const exists = await this.prisma.tradeDocumentLink.findFirst({ where: { organizationId, ...where }, select: { id: true } });
      if (!exists) await this.prisma.tradeDocumentLink.create({ data: { organizationId, docType: g.docType, stepId: o.stepId ?? null, ...where } });
    }
    const fresh = await this.prisma.document.findFirst({ where: { id: doc.id }, select: { id: true, name: true } });
    return { id: fresh!.id, name: fresh!.name ?? doc.id.slice(0, 8) };
  }

  /** "Edit again" on an invoice: its Sales Document back to unconfirmed (refused once it has journal entries). */
  private async unconfirmSalesInvoice(organizationId: string, documentId: string) {
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, organizationId }, select: { id: true, status: true, config: true } });
    if (!doc || ['draft', 'unconfirmed'].includes(doc.status)) return;
    if (doc.status === 'paid') throw new BadRequestException('This invoice is already paid — it cannot be edited again');
    const journals = await this.prisma.journalEntry.count({ where: { organizationId, sourceDocumentId: documentId, status: { not: 'VOID' } } });
    if (journals) throw new BadRequestException('This invoice has accounting entries — void them in Accounting before editing it again');
    const { confirmedAt: _c, ...config } = (doc.config as Record<string, unknown>) ?? {};
    void _c;
    await this.prisma.document.update({ where: { id: documentId }, data: { status: 'unconfirmed', config: config as any } });
  }

  // ── helpers ─────────────────────────────────────────────────────────────
  private ownerFor(scope: 'SHIPMENT' | 'CONTRACT', input: { shipmentId?: string; contractId?: string }): Owner {
    if (scope === 'SHIPMENT') {
      if (!input.shipmentId) throw new BadRequestException('This document belongs to a shipment — pass shipmentId');
      return { shipmentId: input.shipmentId };
    }
    if (!input.contractId) throw new BadRequestException('This document belongs to a contract — pass contractId');
    return { contractId: input.contractId };
  }

  private assertOpen(status: string, what: string) {
    if (status !== 'OPEN') throw new BadRequestException(`Reopen the ${what} before creating documents`);
  }

  /**
   * The records a document belongs to, each with its step that needs the
   * docType: the doc's own record, plus (Invoice #1) every other contract its
   * lines bill.
   */
  private async ownersOf(organizationId: string, g: { docType: string; shipmentId: string | null; contractId: string | null; rows: unknown }) {
    const owners: Array<{ contractId?: string; shipmentId?: string }> = g.shipmentId ? [{ shipmentId: g.shipmentId }] : g.contractId ? [{ contractId: g.contractId }] : [];
    if (g.contractId && GENERATED_TEMPLATES[g.docType]?.kind === 'invoice') {
      const extra = [
        ...new Set(
          toInvoiceLines(g.rows)
            .map((l) => l.contractId)
            .filter((c): c is string => !!c && c !== g.contractId),
        ),
      ];
      if (extra.length) {
        const found = await this.prisma.contract.findMany({ where: { organizationId, id: { in: extra } }, select: { id: true } });
        owners.push(...found.map((c) => ({ contractId: c.id })));
      }
    }
    const out: Array<{ contractId?: string; shipmentId?: string; stepId?: string }> = [];
    for (const o of owners) {
      const step = await this.prisma.tradeStep.findFirst({
        where: { organizationId, ...o, requiredDocTypes: { has: g.docType } },
        orderBy: { sortOrder: 'asc' },
        select: { id: true },
      });
      out.push({ ...o, stepId: step?.id });
    }
    return out;
  }

  private async customerOf(organizationId: string, owners: Array<{ contractId?: string; shipmentId?: string }>) {
    const o = owners[0];
    const sel = { id: true, name: true, customerCode: true, address: true };
    if (o?.shipmentId) return (await this.prisma.shipment.findFirst({ where: { id: o.shipmentId, organizationId }, select: { customer: { select: sel } } }))?.customer ?? null;
    if (o?.contractId) return (await this.prisma.contract.findFirst({ where: { id: o.contractId, organizationId }, select: { customer: { select: sel } } }))?.customer ?? null;
    return null;
  }

  /**
   * The Invoice #1 line billing a contract product line (newest first): FINAL
   * only for Invoice #2's 1回目 amount; any for prefilling price helpers.
   */
  private async invoice1LineFor(organizationId: string, contractId: string, contractLineId: string | null, finalOnly: boolean) {
    const docs = await this.prisma.tradeGeneratedDoc.findMany({
      where: { organizationId, docType: 'INVOICE_1', ...(finalOnly ? { status: 'FINAL' as const } : {}) },
      orderBy: [{ status: 'desc' }, { updatedAt: 'desc' }],
      select: { number: true, contractId: true, rows: true, header: true },
    });
    for (const d of docs) {
      const lines = toInvoiceLines(d.rows);
      const l = lines.find((x) => (contractLineId ? x.contractLineId === contractLineId : x.contractId === contractId || d.contractId === contractId));
      if (l) return { number: d.number, line: l, unitPrice: unitPriceOf(l), taxRate: Number((d.header as any)?.taxRate ?? 10) };
    }
    return null;
  }

  /** The date on the newest Vedanta COA PDF on the shipment ("Date: dd/mm/yyyy"), or null when there is none / it can't be read. */
  private async coaPdfDateFor(organizationId: string, shipmentId: string): Promise<string | null> {
    const pdfs = await this.prisma.tradeFile.findMany({
      where: { organizationId, docType: 'COA', links: { some: { shipmentId } } },
      orderBy: { createdAt: 'desc' },
      select: { s3Key: true, fileName: true },
    });
    for (const f of pdfs.filter((x) => /\.pdf$/i.test(x.fileName))) {
      try {
        const date = parseCoaPdfText(await pdfText(await this.s3.downloadFile(f.s3Key))).date;
        if (date && !tradeDateError(date, 'date')) return date;
      } catch {
        /* not a readable COA PDF — try the next one */
      }
    }
    return null;
  }

  /** Bundles and net / gross MT from the supplier PL spreadsheet on the shipment (null when there is none or it can't be read). */
  private async plTotalsFor(organizationId: string, shipmentId: string): Promise<{ bundles: number; netMt: number; grossMt: number } | null> {
    const pl = await this.prisma.tradeFile.findFirst({
      where: { organizationId, docType: 'PL', links: { some: { shipmentId } } },
      orderBy: { createdAt: 'desc' },
      select: { s3Key: true, fileName: true },
    });
    if (!pl || !SOURCE_EXTENSIONS.test(pl.fileName)) return null;
    try {
      return plTotals(buildCustomerPl(parseSheetFile(await this.s3.downloadFile(pl.s3Key))).rows);
    } catch {
      return null;
    }
  }

  private async loadContract(organizationId: string, contractId: string) {
    const c = await this.prisma.contract.findFirst({
      where: { id: contractId, organizationId },
      select: {
        id: true,
        contractNo: true,
        status: true,
        shipmentMonth: true,
        customer: { select: { id: true, name: true, address: true, jpName: true, jpAddress: true, jpContact: true } },
        lines: { orderBy: { sortOrder: 'asc' }, select: { id: true, grade: true, product: true, sizeSpec: true, quantityMt: true, tolerancePct: true, qmjp: true, billetPremium: true, upcharge: true } },
      },
    });
    if (!c) throw new NotFoundException('Contract not found');
    return c;
  }

  private async loadShipmentCtx(organizationId: string, shipmentId: string) {
    const s = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, organizationId },
      select: {
        id: true,
        status: true,
        blNumber: true,
        vessel: true,
        voyageNo: true,
        eta: true,
        portOfLoading: true,
        portOfDischarge: true,
        netWeightMt: true,
        grossWeightMt: true,
        totalBundles: true,
        totalPieces: true,
        containerCount: true,
        telexReleaseCode: true,
        hsCode: true,
        countryOfOrigin: true,
        commodity: true,
        sizeSpec: true,
        currency: true,
        customer: { select: { id: true, name: true, address: true, jpName: true, jpAddress: true, jpContact: true } },
        contract: { select: { id: true, contractNo: true, incoterm: true, destinationPort: true, consignee: true, shipmentMonth: true, supplier: { select: { name: true, address: true } } } },
        contractLine: { select: { id: true, grade: true, product: true, sizeSpec: true, quantityMt: true, tolerancePct: true, qmjp: true, billetPremium: true, upcharge: true } },
      },
    });
    if (!s) throw new NotFoundException('Shipment not found');
    return s;
  }

  private async loadShipment(organizationId: string, shipmentId: string, db: Db = this.prisma) {
    const s = await db.shipment.findFirst({
      where: { id: shipmentId, organizationId },
      select: {
        id: true,
        status: true,
        blNumber: true,
        vessel: true,
        voyageNo: true,
        portOfLoading: true,
        portOfDischarge: true,
        commodity: true,
        sizeSpec: true,
        hsCode: true,
        countryOfOrigin: true,
        ciNumber: true,
        totalPieces: true,
        customer: { select: { name: true, address: true, jpName: true, jpAddress: true, jpContact: true } },
        contractLine: { select: { grade: true, product: true, sizeSpec: true } },
        contract: { select: { contractNo: true, piNumber: true } },
        totalBundles: true,
      },
    });
    if (!s) throw new NotFoundException('Shipment not found');
    return s;
  }

  /** Editable header defaults: ADH letterhead, customer, today, shipment references, and ADH's Japanese layout fields. */
  private async defaultHeader(organizationId: string, s: HeaderShipment, title: string, docType: string): Promise<GenHeader> {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: { name: true, address: true, phoneNumber: true, registrationNumber: true },
    });
    const settings = await this.config.getSettings(organizationId);
    return customerDocHeader(buildDefaultHeader(org, s, title, docType, tradeToday()), s, docType, (settings.docDefaults ?? {}) as DocDefaults);
  }
}

/** Refuse dates outside 2000–2100 (a 5-digit year typed into a date input) in a document's header / rows. */
function assertDocDates(header: unknown, rows: unknown) {
  const errors = docDateErrors(header, rows);
  if (errors.length) throw new BadRequestException(`Fix the date${errors.length > 1 ? 's' : ''}: ${errors.join('; ')}`);
}

/** A required "YYYY-MM-DD" query / body value in range. */
function assertIsoDate(v: unknown, name: string) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new BadRequestException(`${name} must be YYYY-MM-DD`);
  const e = tradeDateError(v, name);
  if (e) throw new BadRequestException(e);
}

type HeaderShipment = Awaited<ReturnType<TradeGeneratedService['loadShipment']>>;

const dec = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * Header defaults for a new generated document. Pieces is the shipment's
 * "Total pieces" as entered (editable in the editor) — never derived from the
 * rows, bundles or size.
 */
export function buildDefaultHeader(
  org: { name: string; address: string | null; phoneNumber: string | null; registrationNumber: string | null } | null,
  s: Pick<
    HeaderShipment,
    | 'blNumber'
    | 'vessel'
    | 'voyageNo'
    | 'portOfLoading'
    | 'portOfDischarge'
    | 'commodity'
    | 'sizeSpec'
    | 'hsCode'
    | 'countryOfOrigin'
    | 'ciNumber'
    | 'totalPieces'
    | 'customer'
    | 'contract'
    | 'contractLine'
  >,
  title: string,
  docType: string,
  today: string,
): GenHeader {
  const ref = (key: string, label: string, value: string | null | undefined, visible = true): GenRef => ({ key, label, value: value ?? '', visible: visible && !!value });
  const refs: GenRef[] = [
    ref('contractNo', 'Contract No.', s.contract?.contractNo),
    ref('piNumber', 'PI No.', s.contract?.piNumber),
    ref('blNumber', 'B/L No.', s.blNumber),
    ref('vessel', 'Vessel / Voyage', [s.vessel, s.voyageNo].filter(Boolean).join(' / ')),
    ref('route', 'Port of loading → discharge', s.portOfLoading || s.portOfDischarge ? `${s.portOfLoading ?? '—'} → ${s.portOfDischarge ?? '—'}` : ''),
    ref('commodity', 'Commodity', s.commodity ?? ([s.contractLine?.product, s.contractLine?.grade].filter(Boolean).join(' ') || null)),
    ref('sizeSpec', 'Size / spec', s.sizeSpec ?? s.contractLine?.sizeSpec),
    ref('hsCode', 'HS code', s.hsCode),
    ref('origin', 'Country of origin', s.countryOfOrigin),
    ref('ciNumber', 'CI No.', s.ciNumber, false), // optional, off by default
  ];
  // Grade / size come from the shipment's contract product line.
  const grade = s.contractLine?.grade;
  const size = s.sizeSpec ?? s.contractLine?.sizeSpec;
  return {
    title,
    number: null,
    letterhead: { name: org?.name ?? '', address: org?.address ?? null, phone: org?.phoneNumber ?? null, registrationNo: org?.registrationNumber ?? null },
    to: { name: s.customer?.name ?? '', address: s.customer?.address ?? null },
    date: today,
    refs,
    spec: docType === 'CUSTOMER_COA' ? [grade ? `Grade ${grade}` : null, size ? `Size ${size}` : null].filter(Boolean).join(' · ') || null : null,
    pieces: s.totalPieces ?? null,
    remarks: null,
  };
}

/** "Aluminium Billet Alloy 6063-8 inch": product + Alloy + grade + the size's inch label (docDefaults.sizeInch, e.g. 203 → "8 inch"). */
export function sgjpGoods(product: string | null | undefined, grade: string | null | undefined, size: string | null | undefined, d: DocDefaults): string {
  const mm = /(\d{2,4})\s*MM/i.exec(size ?? '')?.[1];
  const inch = mm ? d.sizeInch?.[mm] : undefined;
  const base = [product?.replace(/\s*\d{4}$/, '') || 'Aluminium Billet', grade ? `Alloy ${grade}` : null].filter(Boolean).join(' ');
  return inch ? `${base}-${inch}` : [base, size].filter(Boolean).join(' ');
}

type JpPartySource = { name: string; address?: string | null; jpName?: string | null; jpAddress?: string | null; jpContact?: string | null };

/**
 * The customer as Japanese documents print it: its Japanese legal name /
 * address / contact when any is on the record (no mixing in the English
 * address), else the English name and address. Blank parts are null.
 */
export function jpParty(c: JpPartySource): { name: string; address: string | null; contact: string | null } {
  const t = (v: string | null | undefined) => (v ?? '').trim() || null;
  if (t(c.jpName) || t(c.jpAddress) || t(c.jpContact)) return { name: t(c.jpName) ?? c.name, address: t(c.jpAddress), contact: t(c.jpContact) };
  return { name: c.name, address: t(c.address), contact: null };
}

/** The delivery profile for a customer (its customerName is contained in the customer's name, case-insensitive). */
export function deliveryProfileFor(profiles: DeliveryProfile[] | undefined, customerName: string): DeliveryProfile | null {
  const c = customerName.toLowerCase();
  return (profiles ?? []).find((p) => p.customerName && c.includes(p.customerName.toLowerCase())) ?? null;
}

/** 備考 lines for a delivery profile: "指定荷卸し場→　site　address", then one line per note. */
export function deliveryRemarks(p: DeliveryProfile): string {
  return [
    `指定荷卸し場→　${p.siteName}　${p.address}`.trim(),
    ...(p.notes ?? '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean),
  ].join('\n');
}

/**
 * ADH's Japanese layout for Customer PL (計量検収票) and Customer COA
 * (納品書兼分析試験成績報告書): 様式 label, 御中, the issuer block from
 * docDefaults (アジアディールハブ合同会社 + address + 担当), and the PL header /
 * 品種 fields prefilled from the shipment.
 */
export function customerDocHeader(
  base: GenHeader,
  s: {
    ciNumber?: string | null;
    portOfDischarge?: string | null;
    hsCode?: string | null;
    countryOfOrigin?: string | null;
    sizeSpec?: string | null;
    totalPieces?: number | null;
    totalBundles?: number | null;
    contractLine?: { grade: string | null; product: string | null; sizeSpec: string | null } | null;
    commodity?: string | null;
    customer?: JpPartySource | null;
  },
  docType: string,
  d: DocDefaults,
): GenHeader {
  const grade = s.contractLine?.grade ?? '';
  const size = s.sizeSpec ?? s.contractLine?.sizeSpec ?? '';
  const product = (s.contractLine?.product ?? 'Aluminium Billet').toUpperCase();
  const common: Partial<GenHeader> = {
    layout: 'jp',
    // Japanese documents address the customer by its Japanese legal name + address + contact.
    ...(s.customer ? { to: jpParty(s.customer) } : {}),
    toSuffix: '御中',
    issuer: { name: d.customerDocIssuerName ?? base.letterhead.name, address: d.customerDocIssuerAddress ?? base.letterhead.address ?? '', contact: d.customerDocContact ?? '' },
  };
  if (docType === 'CUSTOMER_COA') {
    const ppb = d.customerCoaPiecesPerBundle ?? null;
    return {
      ...base,
      ...common,
      formLabel: d.customerCoaFormLabel ?? '',
      productLine: [product, grade].filter(Boolean).join(' '),
      sizeLine: size
        .replace(/\s*MM/gi, 'MM')
        .replace(/\s*[xX×]\s*/, ' × ')
        .toUpperCase(),
      bundles: null,
      piecesPerBundle: ppb,
      weightUnit: d.customerCoaWeightUnit ?? 'MT',
      // Never "today": the source file's date, a Vedanta COA PDF's date, or typed (required to finalize).
      analysisDate: '',
      vendor: d.customerCoaVendor ?? '',
    };
  }
  return {
    ...base,
    ...common,
    formLabel: d.customerPlFormLabel ?? '',
    invoiceNo: s.ciNumber ?? '',
    plDate: '',
    portOfDischarge: (s.portOfDischarge ?? '').toUpperCase(),
    goodsDescription: [product, grade ? `ALLOY ${grade}` : null, size.toUpperCase()].filter(Boolean).join(' '),
    origin: (s.countryOfOrigin ?? '').toUpperCase(),
    hsCode: s.hsCode ?? '',
    applicant: d.customerPlApplicant ?? '',
  };
}

/**
 * QMJP / billet premium / upcharge for a pricing helper: Invoice #1's line for
 * the product when it has them, else the contract line's (a blank or unpriced
 * Invoice #1 used to leave SG→JP and Invoice #2 empty).
 */
export function pricePartsOf(
  inv1: { qmjp?: number | null; premium?: number | null; upcharge?: number | null } | null,
  line: { qmjp?: unknown; billetPremium?: unknown; upcharge?: unknown } | null | undefined,
  /** QMJP of the shipment month's quarter (org table): wins over Invoice #1's, which is an earlier quarter. */
  quarterQmjp: number | null = null,
): { qmjp: number | null; premium: number | null; upcharge: number | null } {
  const v = (x: unknown) => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
  return {
    qmjp: quarterQmjp ?? v(inv1?.qmjp) ?? v(line?.qmjp),
    premium: v(inv1?.premium) ?? v(line?.billetPremium),
    upcharge: v(inv1?.upcharge) ?? v(line?.upcharge),
  };
}

/**
 * A blank in-app document must not be finalized (a Customer COA went out with
 * no rows and 0 bundles): Customer PL / COA need rows with data and bundles,
 * shipping instructions at least one delivery row. Invoices have their own
 * check (invoiceFinalizeProblems). Messages read "Can't finalize: …".
 */
export function blankDocProblems(docType: string, header: unknown, rows: unknown[]): string[] {
  const h = (header ?? {}) as Record<string, unknown>;
  const rs = (rows ?? []) as Array<Record<string, unknown>>;
  const num = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));
  const text = (v: unknown) => String(v ?? '').trim() !== '';
  const problems: string[] = [];
  if (docType === 'CUSTOMER_PL') {
    const filled = rs.filter((r) => text(r.batch) || text(r.container) || num(r.netMt ?? r.netwt) > 0);
    if (!filled.length) problems.push('add the packing rows (batch, container, net weight)');
    else if (filled.reduce((a, r) => a + num(r.netMt ?? r.netwt), 0) <= 0) problems.push('the total net weight is 0');
  } else if (docType === 'CUSTOMER_COA') {
    const filled = rs.filter((r) => text(r.batch) || num(r.netwt ?? r.netMt) > 0);
    if (!filled.length) problems.push('add the analysis rows (cast / batch and its chemistry)');
    const bundles = h.bundles !== null && h.bundles !== undefined && h.bundles !== '' ? num(h.bundles) : rs.reduce((a, r) => a + num(r.bundles), 0);
    if (bundles <= 0) problems.push('the bundle count (バンドル数) is 0');
  } else if (docType === 'SHIPPING_INSTRUCTIONS') {
    const filled = rs.filter((r) => text(r.shipDate) || text(r.deliveryDate) || num(r.bundles) > 0);
    if (!filled.length) problems.push('add at least one delivery row (出荷日 · 納入日 · 束数)');
    else if (filled.reduce((a, r) => a + num(r.bundles), 0) <= 0) problems.push('the bundles (束数) total 0');
  }
  return problems;
}
