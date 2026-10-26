import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { stampDocumentMoney } from '../common/document-money';
import { PrismaService } from '../common/prisma.service';
import { PdfGeneratorService } from '../common/services/pdf-generator.service';
import { S3Service } from '../common/services/s3.service';
import { DocumentsService } from '../documents/documents.service';
import { DocumentTemplatesService } from '../documentTemplates/documentTemplates.service';
import { TradeActor } from './shipments.request';
import { docDateErrors, stepLabel, tradeDateError, tradeToday, ORDER_INVOICE_TYPES } from './shipments.rules';
import { GenHeader, GenRef, renderGeneratedHtml } from './trade-generated.html';
import { buildCustomerCoaJp, classifyCoaText, COA_JP_COLUMNS, CoaFormatError, CoaSourceKind, parseCoaPdfText, pdfText } from './trade-coa';
import {
  addBusinessDays,
  customsWeek,
  defaultBank,
  InvoiceLine,
  quarterOf,
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
  lmeForMonth,
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
  sgjpTotals,
  sgjpFinalizeProblems,
  sgjpInvoiceNo,
  SiHeader,
  SiHeaderV2,
  SiRowV2,
} from './trade-logistics-docs';
import { buildCustomerPl, CUSTOMER_PL_COLUMNS, GenColumn, GenRow, parseSheetFile, plTotals, SheetFormatError } from './trade-sheet.parser';
import { Db, ownerWhere, TradeConfigService } from './trade-config.service';
import { TradeFilesService } from './trade-files.service';
import { actualsTable, estimate } from './trade-estimator';
import { entityFor, entityProblem } from './trade-entity';
import { adjustmentLine, costVariance, creditIdsOf, creditLine, estimatedCostsUsd, isCreditNote } from './trade-credit';
import { CUSTOMER_DOC_TEMPLATES, CustomerProfile, defaultSingleRemarks, formatOf, templateKeyFor } from './trade-profile';
import {
  renderSingleInvoiceHtml,
  singleAsInvoiceLines,
  singleFinalizeProblems,
  singleGoodsRemarks,
  SingleInvoiceHeader,
  SingleLine,
  singleTotals,
  toSingleLines,
  singleInvoiceNoFor,
  singleLineCalc,
} from './trade-invoice-single';
import { attachPiecesPng, containerPlFacts } from './trade-attach';
import {
  AS_RECEIVED_COA,
  HOEI_INVOICE_TEMPLATE,
  HOEI_IVPL_TEMPLATE,
  HoeiInvoiceHeader,
  hoeiInvoiceDraft,
  hoeiInvoiceFinalizeProblems,
  HoeiIvPlHeader,
  hoeiIvPlDraft,
  hoeiIvPlFinalizeProblems,
  hoeiParties,
  isAsReceived,
  isHoeiLayout,
  renderHoeiInvoiceHtml,
  renderHoeiIvPlHtml,
  toHoeiLines,
} from './trade-hoei-formats';
import { applicantName, buildSusCoaSummary, buildSusPackingList, isSusTemplate, SUS_COA_COLUMNS, SUS_COA_TEMPLATE, SUS_PL_COLUMNS, SUS_PL_TEMPLATE, SusFormatError, susPackingListXlsx, VEDANTA_PRODUCER_BLOCK } from './trade-sus-formats';

export type TemplateKind = 'table' | 'invoice' | 'single' | 'sgjp' | 'si';
type Owner = { shipmentId: string; contractId?: undefined; orderId?: undefined } | { contractId: string; shipmentId?: undefined; orderId?: undefined } | { orderId: string; shipmentId?: undefined; contractId?: undefined };

/**
 * In-app trade documents. One generic engine: each docType says what it is
 * drawn as (kind), which record it belongs to (scope), its PDF number prefix
 * and — for Customer PL / COA — which supplier spreadsheet can prefill it.
 * Every template can also be created blank (prefilled from the record).
 */
export const GENERATED_TEMPLATES: Record<
  string,
  {
    title: string;
    short: string;
    kind: TemplateKind;
    /** ORDER: Invoice #1 (a legacy contract-level Invoice #1 keeps CONTRACT). */
    scope: 'SHIPMENT' | 'CONTRACT' | 'ORDER';
    sourceDocType?: string;
    /** Every doc type the source can be filed as (round H click-through: PL.XLS / COA.XLS have their own types). */
    sourceDocTypes?: string[];
    sourcePdf?: boolean;
    multiple?: boolean;
    /** Can bill several shipments of the same customer (coversShipmentIds), even across orders. */
    covers?: boolean;
  }
> = {
  CUSTOMER_PL: { title: '計量検収票', short: 'CPL', kind: 'table', scope: 'SHIPMENT', sourceDocType: 'PL', sourceDocTypes: ['PL_XLS', 'PL'] },
  // The COA summary PDF (COA_集計) and Vedanta's COA PDF are read too.
  CUSTOMER_COA: { title: '納品書兼分析試験成績報告書', short: 'CCOA', kind: 'table', scope: 'SHIPMENT', sourceDocType: 'COA', sourceDocTypes: ['COA_XLS', 'COA'], sourcePdf: true },
  INVOICE_1: { title: '請求書 (Invoice #1)', short: 'INV1', kind: 'invoice', scope: 'ORDER' },
  INVOICE_2: { title: '請求書 (Invoice #2)', short: 'INV2', kind: 'invoice', scope: 'SHIPMENT', covers: true },
  // SINGLE billing (Kato, Hoei): one invoice after the B/L — no Invoice #1, no import permit needed.
  INVOICE_SINGLE: { title: '請求書 (single invoice)', short: 'INV', kind: 'single', scope: 'SHIPMENT', covers: true },
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
/** 計量検収票 with an attached Vedanta page prints A4 landscape, as ADH's Kato sample. */
export const isLandscape = (docType: string, header: unknown) => docType === 'CUSTOMER_PL' && (header as { bodyMode?: string } | null)?.bodyMode === 'attach';
export const marginFor = (docType: string) => (GENERATED_TEMPLATES[docType]?.kind === 'invoice' ? INVOICE_MARGIN : GENERATED_TEMPLATES[docType]?.kind === 'single' ? SINGLE_MARGIN : PDF_MARGIN);
/** The single invoice's page (ADH's Kato sheet). */
const SINGLE_MARGIN = { top: '14mm', right: '13mm', bottom: '14mm', left: '13mm' };
/** Kinds that create / confirm a Sales invoice on finalize. */
const isInvoiceKind = (k: TemplateKind | undefined) => k === 'invoice' || k === 'single';

const GEN_SELECT = {
  id: true,
  shipmentId: true,
  contractId: true,
  orderId: true,
  coversShipmentIds: true,
  templateKey: true,
  issuingEntity: true,
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
      where: { organizationId, docType: { in: t.sourceDocTypes ?? [t.sourceDocType] }, links: { some: { shipmentId } } },
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

  async list(organizationId: string, filter: { shipmentId?: string; contractId?: string; orderId?: string } = {}) {
    // An order's documents include its shipments' Invoice #2 / single invoices (step 11 is the order's since round H).
    const shipIds: string[] = filter.orderId
      ? (await this.prisma.shipment.findMany({ where: { organizationId, orderId: filter.orderId }, select: { id: true } })).map((x: { id: string }) => x.id)
      : [];
    return this.prisma.tradeGeneratedDoc.findMany({
      where: {
        organizationId,
        // A shipment's documents include invoices that cover it (Invoice #2 / single invoice for several shipments).
        ...(filter.shipmentId ? { OR: [{ shipmentId: filter.shipmentId }, { coversShipmentIds: { has: filter.shipmentId } }] } : {}),
        ...(filter.contractId ? { contractId: filter.contractId } : {}),
        ...(filter.orderId
          ? {
              OR: [
                { orderId: filter.orderId },
                ...(shipIds.length ? [{ docType: { in: ['INVOICE_2', 'INVOICE_SINGLE'] }, OR: [{ shipmentId: { in: shipIds } }, { coversShipmentIds: { hasSome: shipIds } }] }] : []),
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: GEN_SELECT,
    });
  }

  async get(organizationId: string, id: string) {
    const g = await this.prisma.tradeGeneratedDoc.findFirst({
      where: { id, organizationId },
      select: {
        ...GEN_SELECT,
        shipment: { select: { id: true, blNumber: true, status: true, contractId: true, orderId: true, seqNo: true, order: { select: { orderNo: true } } } },
        contract: { select: { id: true, contractNo: true, status: true } },
        order: { select: { id: true, orderNo: true, year: true, status: true } },
      },
    });
    if (!g) throw new NotFoundException('Document not found');
    // Editor-only flags: the template variant's label and whether its format is confirmed (never printed).
    const variant = g.templateKey ? CUSTOMER_DOC_TEMPLATES[g.templateKey] : undefined;
    const covers: Array<{ id: string; seqNo: number | null; blNumber: string | null; order: { orderNo: number } | null }> = g.coversShipmentIds?.length
      ? await this.prisma.shipment.findMany({ where: { organizationId, id: { in: g.coversShipmentIds } }, select: { id: true, seqNo: true, blNumber: true, order: { select: { orderNo: true } } } })
      : [];
    return {
      ...g,
      templateLabel: variant?.label ?? null,
      formatConfirmed: variant ? variant.formatConfirmed : true,
      covers: covers.map((c) => ({ id: c.id, blNumber: c.blNumber, ref: c.order ? `#${c.order.orderNo}${c.seqNo ? `-${c.seqNo}` : ''}` : (c.blNumber ?? '') })),
    };
  }

  /** The generated document a Sales invoice was finalized from, plus every contract / shipment linked to that invoice. */
  async byDocument(organizationId: string, documentId: string) {
    const g = await this.prisma.tradeGeneratedDoc.findFirst({
      where: { organizationId, documentId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, docType: true, number: true, status: true, documentId: true, finalFileId: true },
    });
    if (!g) throw new NotFoundException('No in-app document for this invoice');
    const links: Array<{
      contract: { id: string; contractNo: string } | null;
      order: { id: string; orderNo: number } | null;
      shipment: { id: string; blNumber: string | null; seqNo: number | null; contract: { id: string; contractNo: string } | null; order: { id: string; orderNo: number } | null } | null;
    }> = await this.prisma.tradeDocumentLink.findMany({
      where: { organizationId, documentId },
      orderBy: { createdAt: 'asc' },
      select: {
        contract: { select: { id: true, contractNo: true } },
        order: { select: { id: true, orderNo: true } },
        shipment: { select: { id: true, blNumber: true, seqNo: true, contract: { select: { id: true, contractNo: true } }, order: { select: { id: true, orderNo: true } } } },
      },
    });
    const contracts = new Map<string, { id: string; contractNo: string }>();
    const orders = new Map<string, { id: string; orderNo: number; label: string }>();
    const shipments = new Map<string, { id: string; blNumber: string | null; contractNo: string | null; ref: string | null; orderId: string | null }>();
    for (const l of links) {
      if (l.contract) contracts.set(l.contract.id, l.contract);
      if (l.order) orders.set(l.order.id, { ...l.order, label: `#${l.order.orderNo}` });
      if (l.shipment) {
        const ref = l.shipment.order ? `#${l.shipment.order.orderNo}${l.shipment.seqNo ? `-${l.shipment.seqNo}` : ''}` : null;
        shipments.set(l.shipment.id, { id: l.shipment.id, blNumber: l.shipment.blNumber, contractNo: l.shipment.contract?.contractNo ?? null, ref, orderId: l.shipment.order?.id ?? null });
        if (l.shipment.contract) contracts.set(l.shipment.contract.id, l.shipment.contract);
        if (l.shipment.order) orders.set(l.shipment.order.id, { ...l.shipment.order, label: `#${l.shipment.order.orderNo}` });
      }
    }
    return { ...g, contracts: [...contracts.values()], orders: [...orders.values()], shipments: [...shipments.values()] };
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
    if (!(t.sourceDocTypes ?? [t.sourceDocType]).includes(src.docType)) throw new BadRequestException(`The source must be a ${(t.sourceDocTypes ?? [t.sourceDocType]).join(' / ')} file (this one is ${src.docType})`);
    if (!isSource(src.fileName, t.sourcePdf)) throw new BadRequestException(`${src.fileName} is not a spreadsheet (.xls, .xlsx, .csv, .txt${t.sourcePdf ? ' or a COA PDF' : ''})`);

    const templateKey = templateKeyFor(await this.profileForShipment(organizationId, shipmentId), docType);
    const { built, header } = await this.buildFromSource(organizationId, shipment, docType, src, templateKey);
    const docRef = await this.config.docRefFor(this.prisma, organizationId, { shipmentId }, docType);
    return this.prisma.tradeGeneratedDoc
      .create({
        data: {
          organizationId,
          shipmentId,
          docType,
          docRef,
          templateKey,
          issuingEntity: entityFor(docType),
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

  /**
   * Rows + header of a Customer PL / COA built from a supplier file, in the format `templateKey` (the customer's, or the
   * one being previewed in Clients → Document formats). Nothing is stored.
   */
  private async buildFromSource(organizationId: string, shipment: HeaderShipment, docType: string, src: { id: string; fileName: string; s3Key: string }, templateKey: string): Promise<{ built: { columns: GenColumn[]; rows: GenRow[]; notes: string[] }; header: GenHeader }> {
    if (isAsReceived(templateKey)) throw new BadRequestException(asReceivedMessage(templateKey));
    let built: { columns: GenColumn[]; rows: GenRow[]; notes: string[] };
    let fromPdf: { date: string | null; invoiceNo: string | null } | null = null;
    const pieces = ((await this.config.getSettings(organizationId)).docDefaults as DocDefaults | undefined)?.customerCoaPiecesPerBundle ?? null;
    try {
      const buf = await this.s3.downloadFile(src.s3Key);
      if (isSusTemplate(templateKey)) {
        const pdf = /\.pdf$/i.test(src.fileName);
        const sheet = pdf ? parseCoaPdfText(await pdfText(buf)) : parseSheetFile(buf);
        if (pdf) fromPdf = { date: (sheet as { date?: string | null }).date ?? null, invoiceNo: (sheet as { invoiceNo?: string | null }).invoiceNo ?? null };
        const b = templateKey === SUS_PL_TEMPLATE ? buildSusPackingList(sheet) : buildSusCoaSummary(sheet, { piecesPerBundle: pieces ?? 5 });
        built = { columns: b.columns, rows: b.rows, notes: [...((sheet as { notes?: string[] }).notes ?? []), ...b.notes] };
      } else if (docType === 'CUSTOMER_PL') {
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
      if (e instanceof SheetFormatError || e instanceof CoaFormatError || e instanceof SusFormatError) throw new BadRequestException(`${src.fileName}: ${e.message}`);
      throw e;
    }
    if (!built.rows.length) throw new BadRequestException(`${src.fileName} has no data rows`);

    let header = await this.defaultHeader(organizationId, shipment, this.template(docType).title, docType);
    if (isSusTemplate(templateKey)) {
      header = await this.susHeader(organizationId, shipment, header, docType, fromPdf);
    } else if (docType === 'CUSTOMER_COA') {
      // 分析日付: the source's own date, else Vedanta's COA PDF, else the B/L (on-board) date — editable before finalizing.
      const date = fromPdf?.date ?? (await this.coaPdfDateFor(organizationId, shipment.id)) ?? isoDay(shipment.etd);
      if (date) header = { ...header, analysisDate: date };
    }
    if (docType === 'CUSTOMER_PL') header = await this.withAttachDefault(organizationId, shipment.id, templateKey, header);
    return { built, header };
  }

  /**
   * Round AM — Clients → Document formats → Preview: the document `docType` of a real shipment in the format
   * `templateKey`, from the shipment's best supplier file. Returns the HTML (the portal renders it as a PDF via the
   * preview endpoint) and, for SUS's PACKING LIST, the .xlsx. Read-only: nothing is created or changed.
   */
  async previewFormat(organizationId: string, shipmentId: string, docType: string, templateKey: string): Promise<{ html: string; landscape: boolean; notes: string[]; source: string | null; xlsx: Buffer | null }> {
    const shipment = await this.loadShipment(organizationId, shipmentId);
    const best = (await this.sources(organizationId, shipmentId, docType))[0] as { id: string; fileName: string } | undefined;
    if (!best) throw new BadRequestException(`This shipment has no ${docType === 'CUSTOMER_COA' ? 'COA (COA.xls or a COA PDF)' : 'packing list (PL.xls / PL)'} yet — pick a shipment whose step 3b has Vedanta's files`);
    const src = await this.prisma.tradeFile.findFirst({ where: { id: best.id, organizationId }, select: { id: true, fileName: true, s3Key: true } });
    if (!src) throw new BadRequestException('Source file not found');
    const { built, header } = await this.buildFromSource(organizationId, shipment, docType, src, templateKey);
    const printable = await this.hydrate(organizationId, docType, header);
    const xlsx = docType === 'CUSTOMER_PL' && (header as { layout?: string }).layout === 'sus' ? await susPackingListXlsx(built.rows) : null;
    return { html: this.render(docType, printable, built.columns, built.rows, { draft: true }), landscape: isLandscape(docType, printable), notes: built.notes, source: src.fileName, xlsx };
  }

  /** PDF bytes of an HTML document (the Clients preview). */
  pdfOf(html: string, docType: string, landscape: boolean) {
    return this.pdf.generatePdfFromHtml(html, { margin: marginFor(docType), landscape });
  }

  /** Edit a DRAFT (header / columns / rows). */
  async update(organizationId: string, id: string, body: { header?: unknown; columns?: unknown; rows?: unknown; issuingEntity?: string }) {
    const g = await this.get(organizationId, id);
    if (g.status !== 'DRAFT') throw new BadRequestException('This document is final — use "Edit again" first');
    if (body.issuingEntity !== undefined) {
      const problem = entityProblem(g.docType, body.issuingEntity);
      if (problem) throw new BadRequestException(problem);
    }
    if (body.columns !== undefined && !Array.isArray(body.columns)) throw new BadRequestException('columns must be a list');
    if (body.rows !== undefined && !Array.isArray(body.rows)) throw new BadRequestException('rows must be a list');
    assertDocDates(body.header, body.rows);
    return this.prisma.tradeGeneratedDoc.update({
      where: { id, organizationId },
      data: {
        ...(body.header !== undefined ? { header: body.header as any } : {}),
        ...(body.columns !== undefined ? { columns: body.columns as any } : {}),
        ...(body.rows !== undefined ? { rows: body.rows as any } : {}),
        ...(body.issuingEntity !== undefined ? { issuingEntity: body.issuingEntity } : {}),
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
  async createBlank(organizationId: string, input: { docType: string; shipmentId?: string; contractId?: string; orderId?: string; coversShipmentIds?: string[] }, actor: TradeActor) {
    // Step 11 is the order's (round H): Invoice #2 / the single invoice made from the order bills the shipments it covers
    // (default: the order's open shipments not yet invoiced); the first covered shipment is its record.
    if (ORDER_INVOICE_TYPES.includes(input.docType) && !input.shipmentId) input = await this.orderInvoiceInput(organizationId, input);
    const t = this.template(input.docType);
    const owner = this.ownerFor(t.scope, input);
    let templateKey: string | null = null;
    let covers: string[] = [];
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
        const date = (await this.coaPdfDateFor(organizationId, s.id)) ?? isoDay(s.etd);
        if (date) header = { ...(header as GenHeader), analysisDate: date };
      }
      // The customer's template variant (Kato / SUS / Hoei); Kato's 計量検収票 body is a page of Vedanta's container PL.
      templateKey = templateKeyFor(await this.profileForShipment(organizationId, s.id), input.docType);
      if (isAsReceived(templateKey)) throw new BadRequestException(asReceivedMessage(templateKey));
      if (input.docType === 'CUSTOMER_PL') header = await this.withAttachDefault(organizationId, s.id, templateKey, header as GenHeader);
      columns = (input.docType === 'CUSTOMER_PL' ? CUSTOMER_PL_COLUMNS : COA_JP_COLUMNS).map((c) => ({ ...c }));
      rows = [input.docType === 'CUSTOMER_PL' ? { no: 1, batch: '', container: '', netMt: null, grossMt: null } : { batch: '', bundles: null, netwt: null }];
      // Round AM: SUS's own formats start blank in their own columns.
      if (isSusTemplate(templateKey)) {
        header = await this.susHeader(organizationId, s, header as GenHeader, input.docType, null);
        columns = (templateKey === SUS_PL_TEMPLATE ? SUS_PL_COLUMNS : SUS_COA_COLUMNS).map((c) => ({ ...c }));
        rows = [templateKey === SUS_PL_TEMPLATE ? { no: 1, batch: '', cast: '', bundleNo: null, netMt: null, grossMt: null, container: '' } : { batch: '', material: '', netwt: null, grosswt: null, bundles: null, pieces: null }];
      }
    } else if (input.docType === 'INVOICE_1' && owner.orderId) {
      // Invoice #1 on an order: one line for the order's product, priced at the LME of the month before shipment.
      const o = await this.loadOrder(organizationId, owner.orderId);
      this.assertOpen(o.status, 'order');
      const h = invoiceHeaderDefaults({
        today,
        org: org ?? { name: '' },
        customerName: invoiceAddressee(o.customer),
        grades: [o.grade ?? ''],
        products: [o.product ?? ''],
        defaults,
        lmeMonth: defaultLmeMonth('INVOICE_1', o.shipMonth),
      });
      header = h;
      rows = [{ ...invoice1Line({ id: o.contract?.id ?? '', contractNo: o.contract?.contractNo ?? '' }, orderLine(o), defaults, h.dueDate, h.lmeMonth), contractId: o.contract?.id ?? null, contractLineId: null, orderId: o.id }];
    } else if (t.kind === 'invoice' && input.docType === 'INVOICE_1') {
      const c = await this.loadContract(organizationId, owner.contractId!);
      this.assertOpen(c.status, 'contract');
      const h = invoiceHeaderDefaults({
        today,
        org: org ?? { name: '' },
        // 請求書 is Japanese: the customer's Japanese legal name (name only, as on ADH's invoices).
        customerName: invoiceAddressee(c.customer),
        grades: c.lines.map((l) => l.grade ?? ''),
        products: c.lines.map((l) => l.product ?? ''),
        defaults,
        lmeMonth: defaultLmeMonth('INVOICE_1', c.shipmentMonth),
      });
      header = h;
      rows = c.lines.map((l) => invoice1Line({ id: c.id, contractNo: c.contractNo }, l, defaults, h.dueDate, h.lmeMonth));
    } else if (t.kind === 'single') {
      // Single invoice (Kato / Hoei): billet at the shipment month's LME + QMJP + premium, the customs / trucking
      // lines in yen (from the estimator) and 他諸掛 — over every covered shipment.
      covers = await this.coveredShipments(organizationId, owner.shipmentId!, input.coversShipmentIds, input.docType);
      // Round AN: Hoei's 請求書 is Asia Deal Hub Pte. Ltd.'s, in USD only (trade-hoei-formats.ts).
      templateKey = templateKeyFor(await this.profileForShipment(organizationId, owner.shipmentId!), input.docType);
      const built = templateKey === HOEI_INVOICE_TEMPLATE ? await this.hoeiInvoice(organizationId, covers, defaults, today) : await this.singleInvoiceDraft(organizationId, covers, defaults, settings, org, today);
      if (templateKey !== HOEI_INVOICE_TEMPLATE) templateKey = null;
      header = built.header;
      rows = built.rows;
    } else if (t.kind === 'invoice' && owner.shipmentId && (input.coversShipmentIds?.length ?? 0) > 1) {
      // Invoice #2 over several shipments of one customer ("6063_262.450T+40.775T" = #9-1 + #9-2): a final-price line per
      // shipment, the cost lines over the total weight, and each covered order's Invoice #1 deducted once.
      covers = await this.coveredShipments(organizationId, owner.shipmentId, input.coversShipmentIds, input.docType);
      const built = await this.invoice2Draft(organizationId, covers, defaults, org, today);
      header = built.header;
      rows = built.rows;
    } else if (t.kind === 'invoice') {
      // Invoice #2 as ADH issues it: final price on the actual net weight, customs / transport / other costs,
      // and the 差額 against what Invoice #1 billed for this product.
      const s = await this.loadShipmentCtx(organizationId, owner.shipmentId!);
      if (s.order) await this.assertInvoiceOrderOpen(organizationId, [s.id, ...(input.coversShipmentIds ?? [])]);
      else this.assertOpen(s.status, 'shipment');
      covers = await this.coveredShipments(organizationId, s.id, input.coversShipmentIds, input.docType);
      if (s.order) {
        const built = await this.invoice2Draft(organizationId, covers, defaults, org, today);
        header = built.header;
        rows = built.rows;
      } else {
      const line = s.contractLine;
      const h = invoiceHeaderDefaults({
        today,
        docType: 'INVOICE_2',
        org: org ?? { name: '' },
        customerName: invoiceAddressee(s.customer),
        grades: [line?.grade ?? ''],
        products: [line?.product ?? ''],
        defaults,
      });
      if (!s.contract) throw new BadRequestException('This shipment has no order or contract to price from');
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
      }
    } else if (t.kind === 'sgjp') {
      const s = await this.loadShipmentCtx(organizationId, owner.shipmentId!);
      this.assertOpen(s.status, 'shipment');
      // Order-era shipments take supplier / consignee / port / incoterm / month from the order; older ones from the contract.
      const o = s.order;
      const supplier = o?.supplier ?? s.contract?.supplier ?? null;
      const consignee = o?.consignee ?? s.contract?.consignee ?? null;
      const destPort = o?.destinationPort ?? s.contract?.destinationPort ?? null;
      const shipMonth = o?.shipMonth ?? s.contract?.shipmentMonth ?? null;
      const cp = await this.profileForShipment(organizationId, s.id);
      if (templateKeyFor(cp, 'SGJP_IV_PL') === HOEI_IVPL_TEMPLATE) {
        // Round AN: Hoei's INVOICE & PACKING LIST — ADH SG's sale to Hoei, CIF Laem Chabang (trade-hoei-formats.ts).
        templateKey = HOEI_IVPL_TEMPLATE;
        const pl = s.netWeightMt === null || s.grossWeightMt === null || s.totalBundles === null ? await this.plTotalsFor(organizationId, s.id) : null;
        const bank = defaultBank(defaults, cp.defaultBankId);
        const d = hoeiIvPlDraft({
          today,
          shipMonth,
          supplierBlock: supplier?.address ? `${supplier.name}\n${supplier.address}` : (defaults.sgjpShipperBlock ?? supplier?.name ?? ''),
          parties: hoeiParties(cp, s.customer),
          sellerBlock: defaults.sgjpSellerBlock ?? defaults.sgSellerBlock ?? org?.name ?? '',
          signBlock: defaults.sgjpSignBlock ?? defaults.sgjpSellerBlock ?? org?.name ?? '',
          bank: bank ? { id: bank.id, block: bank.block } : null,
          portOfLoading: s.portOfLoading,
          portOfDischarge: s.portOfDischarge ?? destPort,
          countryOfOrigin: s.countryOfOrigin,
          vessel: s.vessel,
          voyageNo: s.voyageNo,
          product: o?.product ?? s.contractLine?.product ?? s.commodity,
          grade: o?.grade ?? s.contractLine?.grade ?? null,
          hsCode: s.hsCode,
          incoterm: o?.incoterm ?? s.contract?.incoterm ?? null,
          lme: lmeForMonth(defaults, shipMonth),
          qmjp: qmjpForMonth(defaults, shipMonth),
          premium: num(o?.clientPremium),
          netMt: dec(s.netWeightMt) ?? pl?.netMt ?? null,
          grossMt: dec(s.grossWeightMt) ?? pl?.grossMt ?? null,
          bundles: s.totalBundles ?? pl?.bundles ?? null,
          pieces: s.totalPieces,
        });
        header = d.header;
        rows = d.items;
      } else {
      const h: SgjpHeaderV2 = {
        layout: 2,
        invoiceNo: sgjpInvoiceNo(today),
        invoiceDate: today,
        // The supplier's master record when it has an address, else the org's default Shipper block.
        shipperBlock: supplier?.address ? `${supplier.name}\n${supplier.address}` : (defaults.sgjpShipperBlock ?? supplier?.name ?? ''),
        consigneeBlock: defaults.sgjpConsigneeBlock ?? settings.defaultConsignee ?? consignee ?? '',
        sellerBlock: defaults.sgjpSellerBlock ?? defaults.sgSellerBlock ?? org?.name ?? '',
        buyerBlock: defaults.sgjpBuyerBlock ?? defaults.sgjpConsigneeBlock ?? settings.defaultConsignee ?? consignee ?? '',
        placeOfReceipt: s.portOfLoading ?? '',
        portOfLoading: s.portOfLoading ?? '',
        portOfDischarge: s.portOfDischarge ?? destPort ?? '',
        placeOfDelivery: s.portOfDischarge ?? destPort ?? '',
        payment: '',
        countryOfOrigin: (s.countryOfOrigin ?? '').toUpperCase(),
        vessel: [s.vessel, s.voyageNo].filter(Boolean).join(' / '),
        others: '',
        shippingMarks: '',
        signBlock: defaults.sgjpSignBlock ?? defaults.sgjpSellerBlock ?? defaults.sgSellerBlock ?? org?.name ?? '',
        currency: s.currency || 'USD',
        lmeMonth: defaultLmeMonth('SGJP_IV_PL', shipMonth),
      };
      header = h;
      // The customer price: the order's premium / upcharge (or Invoice #1's line for a contract-era shipment); the LME of the shipment month from the table.
      const inv1 = o ? null : s.contract ? await this.invoice1LineFor(organizationId, s.contract.id, s.contractLine?.id ?? null, false) : null;
      const pl = s.netWeightMt === null || s.grossWeightMt === null || s.totalBundles === null ? await this.plTotalsFor(organizationId, s.id) : null;
      const net = dec(s.netWeightMt) ?? pl?.netMt ?? null;
      const item: SgjpItem = {
        goods: sgjpGoods(o?.product ?? s.contractLine?.product ?? s.commodity, o?.grade ?? s.contractLine?.grade, s.sizeSpec ?? o?.size ?? s.contractLine?.sizeSpec, defaults),
        hsCode: s.hsCode ?? '',
        terms: o?.incoterm ?? s.contract?.incoterm ?? 'CIF',
        // The LME of the shipment month from the org's table when it has it (else typed).
        lme: lmeForMonth(defaults, shipMonth),
        ...(o
          ? { qmjp: qmjpForMonth(defaults, shipMonth), premium: num(o.clientPremium), upcharge: num(o.upcharge) }
          : pricePartsOf(inv1?.line ?? null, s.contractLine, qmjpForMonth(defaults, shipMonth))),
        unitPrice: null,
        quantity: net,
        bundles: s.totalBundles ?? pl?.bundles ?? null,
        pieces: s.totalPieces,
        netMt: net,
        grossMt: dec(s.grossWeightMt) ?? pl?.grossMt ?? null,
        dimension: defaults.sgjpDimension ?? '',
      };
      rows = [item];
      }
    } else {
      const s = await this.loadShipmentCtx(organizationId, owner.shipmentId!);
      this.assertOpen(s.status, 'shipment');
      // The customer's profile delivery site first (Org Settings → Customers), else the legacy delivery profiles.
      const cp = await this.profileForShipment(organizationId, s.id);
      const profile = cp.deliveryProfile
        ? { id: `profile:${cp.customerId}`, customerName: s.customer?.name ?? '', ...cp.deliveryProfile }
        : (deliveryProfileFor(defaults.deliveryProfiles, s.customer?.name ?? '') ?? deliveryProfileFor(defaults.deliveryProfiles, s.customer?.jpName ?? ''));
      const h: SiHeaderV2 = {
        layout: 2,
        requestDate: today,
        // 宛先 line incl. 御中 — a document setting (ADH's sheets use both "三井倉庫 株式会社 御中" and "三井倉庫 御中").
        toName: defaults.siAddressee ?? (defaults.siWarehouseTo || defaults.siTo ? `${defaults.siWarehouseTo ?? defaults.siTo} 御中` : '三井倉庫 株式会社 御中'),
        issuerName: defaults.siIssuerName ?? org?.name ?? '',
        title: '出庫・納入依頼書',
        // 本船 = the vessel arriving in Japan: the A/N's vessel after transshipment (WAN HAI 365 / N044), else the B/L's.
        ...(await this.arrivingVessel(organizationId, s.id, s.vessel, s.voyageNo)),
        blNumber: s.blNumber ?? '',
        // Round N: the site's own 倉庫名; a non-Yokohama port (Kato, Nagoya) never gets the Yokohama default — blank + check.
        ...siWarehouse(profile, cp.port, defaults.siWarehouseName),
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

    // Invoices preselect the customer's own bank account (profile.defaultBankId), any entity.
    if (header && typeof header === 'object' && 'bankId' in (header as object)) {
      const customerId = await this.invoiceCustomerId(organizationId, owner as { orderId?: string | null; shipmentId?: string | null });
      const bankId = customerId ? (await this.config.profileOf(organizationId, customerId)).defaultBankId : undefined;
      const bank = bankId ? defaultBank(defaults, bankId) : null;
      if (bank && bank.id === bankId) header = { ...(header as object), bankId: bank.id, bankBlock: bank.block } as typeof header;
    }
    const docRef = await this.config.docRefFor(this.prisma, organizationId, owner as any, input.docType);
    return this.prisma.tradeGeneratedDoc.create({
      data: {
        organizationId,
        ...owner,
        docType: input.docType,
        docRef,
        templateKey,
        issuingEntity: templateKey === HOEI_INVOICE_TEMPLATE ? 'ADH_SG' : entityFor(input.docType),
        coversShipmentIds: covers,
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
    if (t.kind === 'single' && isHoeiLayout(header)) return renderHoeiInvoiceHtml(header as HoeiInvoiceHeader, toHoeiLines(list), opts);
    if (t.kind === 'single') return renderSingleInvoiceHtml(header as SingleInvoiceHeader, toSingleLines(list), opts);
    if (t.kind === 'sgjp' && isHoeiLayout(header)) return renderHoeiIvPlHtml(header as HoeiIvPlHeader, list as SgjpItem[], opts);
    // Documents created before the ADH layouts keep their original template.
    if (t.kind === 'sgjp') return layout2 ? renderSgjpV2Html(header as SgjpHeaderV2, list as SgjpItem[], opts) : renderSgjpHtml(header as SgjpHeader, list as PackingRow[], opts);
    if (t.kind === 'si') return layout2 ? renderSiV2Html(header as SiHeaderV2, list as SiRowV2[], opts) : renderSiHtml(header as SiHeader, list as ScheduleRow[], opts);
    return renderGeneratedHtml(docType, header as GenHeader, (columns as GenColumn[]) ?? [], list as GenRow[], opts);
  }

  /** HTML for the live preview (same template as the PDF). Pass the org to print its seal and resolve an attached PL page. */
  async previewHtml(docType: string, header: unknown, columns: unknown, rows: unknown, draft = true, seal: string | null = null, organizationId?: string) {
    const h = organizationId ? await this.hydrate(organizationId, docType, header) : header;
    return this.render(docType, h, columns ?? [], rows ?? [], { draft, seal });
  }

  /**
   * Resolve render-time data that isn't stored in the header: the PNG of the
   * attached Vedanta container-PL page (計量検収票 "attach" body).
   */
  async hydrate(organizationId: string, docType: string, header: unknown): Promise<unknown> {
    const h = (header ?? {}) as GenHeader;
    if (docType !== 'CUSTOMER_PL' || h.bodyMode !== 'attach' || !h.attachFileId) return header;
    const f = await this.prisma.tradeFile.findFirst({ where: { id: h.attachFileId, organizationId }, select: { s3Key: true, mimeType: true } });
    if (!f) return { ...h, attachImage: null, attachImages: [] };
    try {
      const pngs = await attachPiecesPng(f.s3Key, f.mimeType, Number(h.attachPage) || 1, h.attachCrop ?? null, (k) => this.s3.downloadFile(k));
      const urls = pngs.map((png) => `data:image/png;base64,${png.toString('base64')}`);
      return { ...h, attachImage: urls[0] ?? null, attachImages: urls };
    } catch {
      return { ...h, attachImage: null, attachImages: [] };
    }
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
    const seal = isInvoiceKind(t.kind) ? await this.sealFor(organizationId) : null;
    const header = await this.hydrate(organizationId, g.docType, g.header);
    const buffer = await this.pdf.generatePdfFromHtml(this.render(g.docType, header, g.columns, g.rows, { draft: true, seal }), { margin: marginFor(g.docType), landscape: isLandscape(g.docType, header) });
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
    // An order-level invoice (step 11, round H) may bill shipments that already completed their own steps — its order must be open.
    const orderInvoice = ORDER_INVOICE_TYPES.includes(g.docType);
    if (g.shipment && g.shipment.status !== 'OPEN' && !(orderInvoice && g.shipment.status === 'COMPLETED')) throw new BadRequestException('Reopen the shipment before finalizing');
    if (orderInvoice) await this.assertInvoiceOrderOpen(organizationId, [g.shipmentId, ...((g.coversShipmentIds as string[] | undefined) ?? [])]);
    if (g.contract && g.contract.status !== 'OPEN') throw new BadRequestException('Reopen the contract before finalizing');
    if (g.order && g.order.status !== 'OPEN') throw new BadRequestException('Reopen the order before finalizing');
    const t = this.template(g.docType);
    const rows = (g.rows as unknown[]) ?? [];
    const attachBody = g.docType === 'CUSTOMER_PL' && (g.header as { bodyMode?: string } | null)?.bodyMode === 'attach';
    if (!rows.length && !attachBody) throw new BadRequestException('Add at least one row before finalizing');
    assertDocDates(g.header, rows);
    const gh = (g.header ?? {}) as { layout?: unknown; analysisDate?: unknown };
    if (g.docType === 'CUSTOMER_COA' && gh.layout === 'jp' && !String(gh.analysisDate ?? '').trim()) {
      throw new BadRequestException("Can't finalize: enter the analysis date (分析 日付).");
    }
    const blank = blankDocProblems(g.docType, g.header, rows);
    if (blank.length) throw new BadRequestException(finalizeMessage(blank));
    // A customer invoice is never issued by ADH SG.
    // Round AN: Hoei's 請求書 is Asia Deal Hub Pte. Ltd.'s (ADH SG sells to Thailand).
    const hoei = isHoeiLayout(g.header);
    const entityIssue = hoei ? null : entityProblem(g.docType, (g as { issuingEntity?: string | null }).issuingEntity ?? entityFor(g.docType));
    if (entityIssue) throw new BadRequestException(entityIssue);
    // Invoice #1 applying credits: each must still be open (or already used by this invoice) and the same customer's.
    const creditIds = g.docType === 'INVOICE_1' ? creditIdsOf(rows) : [];
    if (creditIds.length) {
      const customerId = await this.invoiceCustomerId(organizationId, g);
      const credits: Array<{ id: string; status: string; customerId: string; usedByDocId: string | null; sourceNumber: string | null }> = await this.prisma.tradeCredit.findMany({
        where: { organizationId, id: { in: creditIds } },
        select: { id: true, status: true, customerId: true, usedByDocId: true, sourceNumber: true },
      });
      for (const cid of creditIds) {
        const c = credits.find((x) => x.id === cid);
        if (!c) throw new BadRequestException('A credit applied on this invoice no longer exists — remove its 前回差額充当 line');
        if (c.customerId !== customerId) throw new BadRequestException(`Credit ${c.sourceNumber ?? ''} belongs to another customer`);
        if (c.status === 'VOID') throw new BadRequestException(`Credit ${c.sourceNumber ?? ''} was voided — remove its line`);
        if (c.status === 'USED' && c.usedByDocId !== g.id) throw new BadRequestException(`Credit ${c.sourceNumber ?? ''} is already used on another invoice`);
      }
    }
    const owners = await this.ownersOf(organizationId, g);

    let number = g.number;
    let header = g.header as any;
    let documentId = g.documentId;
    if (t.kind === 'single' && hoei) {
      // Hoei's USD 請求書 (ADH SG): no 消費税, no FX; ADH Japan's Sales invoice isn't created (not ADH Japan's sale).
      const problems = hoeiInvoiceFinalizeProblems(header as HoeiInvoiceHeader, toHoeiLines(rows));
      if (problems.length) throw new BadRequestException(finalizeMessage(problems));
      const hh = header as HoeiInvoiceHeader;
      const printedNo = String(hh.invoiceNo ?? '').trim() || (hh.issueDate ?? '').replace(/-/g, '').slice(0, 8);
      const clash = await this.prisma.tradeGeneratedDoc.findFirst({ where: { organizationId, docType: g.docType, status: 'FINAL', number: printedNo, id: { not: g.id } }, select: { id: true } });
      if (clash) throw new BadRequestException(`Another single invoice is already numbered ${printedNo} — change the 番号 (e.g. ${printedNo}_2)`);
      number = printedNo;
      header = { ...header, invoiceNo: number };
    } else if (t.kind === 'single') {
      const sl = toSingleLines(rows);
      const sh = header as SingleInvoiceHeader;
      const problems = singleFinalizeProblems(sl, sh.fxRate);
      if (problems.length) throw new BadRequestException(finalizeMessage(problems));
      // The printed 番号 is ADH's own (default: the 発行日 as yyyymmdd, as on Kato's invoices); the Sales invoice keeps its number.
      const printedNo = String(sh.invoiceNo ?? '').trim() || singleInvoiceNoFor(sh.issueDate);
      if (printedNo) {
        const clash = await this.prisma.tradeGeneratedDoc.findFirst({
          where: { organizationId, docType: g.docType, status: 'FINAL', number: printedNo, id: { not: g.id } },
          select: { id: true },
        });
        if (clash) throw new BadRequestException(`Another single invoice is already numbered ${printedNo} — change the 番号 (e.g. ${printedNo}_2)`);
      }
      const tt = singleTotals(sl, sh.taxRate, sh.fxRate);
      const lines = singleAsInvoiceLines(sl, sh.fxRate, sh.dueDate);
      const doc = await this.ensureSalesInvoice(organizationId, g, { ...(sh as any), variant: undefined } as InvoiceHeader, lines, owners, actor, {
        subtotal: roundTo(tt.usd.taxable + tt.usd.nonTaxable, 2),
        tax: tt.usd.tax,
        total: tt.usd.total,
      });
      documentId = doc.id;
      number = printedNo || doc.name;
      header = { ...header, invoiceNo: number, salesInvoiceNo: doc.name };
    } else if (t.kind === 'invoice') {
      const lines = toInvoiceLines(rows);
      if (!lines.some((l) => l.description.trim() || amountOf(l) !== 0)) throw new BadRequestException('Add at least one invoice line');
      // No unpriced lines and no US$0.00 invoice (a blank Invoice #1 used to finalize at 0).
      const problems = invoiceFinalizeProblems(lines, Number((header as InvoiceHeader).taxRate ?? 10));
      if (problems.length) throw new BadRequestException(finalizeMessage(problems));
      const doc = await this.ensureSalesInvoice(organizationId, g, header as InvoiceHeader, lines, owners, actor);
      documentId = doc.id;
      number = doc.name;
      header = { ...header, invoiceNo: doc.name };
    } else if (t.kind === 'sgjp' && (header?.layout === 2 || hoei)) {
      const problems = hoei ? hoeiIvPlFinalizeProblems(header as HoeiIvPlHeader, rows as SgjpItem[]) : sgjpFinalizeProblems(rows as SgjpItem[]);
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

    const seal = isInvoiceKind(t.kind) ? await this.sealFor(organizationId) : null;
    const printable = await this.hydrate(organizationId, g.docType, header);
    // Round AM: SUS's PACKING LIST is finalized as the spreadsheet SUS takes (.xlsx); everything else as a PDF.
    const susXlsx = g.docType === 'CUSTOMER_PL' && (printable as { layout?: string } | null)?.layout === 'sus';
    const pdf = susXlsx
      ? await susPackingListXlsx(rows as GenRow[])
      : await this.pdf.generatePdfFromHtml(this.render(g.docType, printable, g.columns, rows, { draft: false, seal }), { margin: marginFor(g.docType), landscape: isLandscape(g.docType, printable) });
    const [primary, ...more] = owners;
    const target = (o: { contractId?: string; shipmentId?: string; orderId?: string }) =>
      o.shipmentId ? { shipmentIds: [o.shipmentId] } : o.orderId ? { orderIds: [o.orderId] } : { contractIds: [o.contractId] };
    const file = await this.files.upload(
      organizationId,
      (susXlsx
        ? { originalname: `PACKING LIST_${number}.xlsx`, mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: pdf.length, buffer: pdf }
        : { originalname: `${number}.pdf`, mimetype: 'application/pdf', size: pdf.length, buffer: pdf }) as Express.Multer.File,
      {
        docType: g.docType,
        ...target(primary),
        ...(primary.stepId ? { stepId: primary.stepId } : {}),
        notes: 'Created in-app',
      } as any,
      actor,
      // The PDF carries the in-app document's ID (26-19-1-CPL); an older document without one takes the PDF's.
      { docRef: (g as { docRef?: string | null }).docRef ?? null, source: 'GENERATED', ...(orderInvoice ? { completedShipmentsOk: true } : {}) },
    );
    // Every other record it belongs to (an Invoice #2 covering several shipments …), each tagged with its own step.
    for (const o of more) {
      await this.files.addLinks(
        organizationId,
        file.id,
        {
          ...target(o),
          ...(o.stepId ? { stepId: o.stepId } : {}),
        } as any,
        actor,
        ...(orderInvoice ? [{ completedShipmentsOk: true }] : []),
      );
    }
    const finalized = await this.prisma.tradeGeneratedDoc.update({
      where: { id, organizationId },
      data: { status: 'FINAL', number, header, finalFileId: file.id, documentId, ...((g as { docRef?: string | null }).docRef ? {} : { docRef: (file as { docRef?: string | null }).docRef ?? null }) },
      select: GEN_SELECT,
    });
    await this.bookCredits(organizationId, { ...g, number, header, rows }, creditIds);
    // The finalized SG→JP IV's amount is the customs CIF (step 7's import-tax estimate) — filled when blank.
    // (Not Hoei's: its IV is the sale to Thailand, no Japanese import.)
    if (g.docType === 'SGJP_IV_PL' && g.shipmentId && !hoei) await this.fillCifFromSgjp(organizationId, g.shipmentId, rows);
    return finalized;
  }

  /**
   * Credits on finalize: a negative Invoice #2 opens (or re-opens) a credit for
   * the customer; an Invoice #1 marks the credits it applies as used.
   */
  private async bookCredits(organizationId: string, g: { id: string; docType: string; number: string | null; header: any; rows: unknown; orderId?: string | null; shipmentId?: string | null }, creditIds: string[]) {
    if (g.docType === 'INVOICE_2') {
      const total = invoiceTotals(toInvoiceLines(g.rows), Number(g.header?.taxRate ?? 10), null, g.header?.variant === 'final' ? 'final' : undefined).total;
      const existing = await this.prisma.tradeCredit.findFirst({ where: { organizationId, sourceDocId: g.id }, select: { id: true, status: true } });
      if (isCreditNote(g.docType, total)) {
        const customerId = await this.invoiceCustomerId(organizationId, g);
        if (!customerId) return;
        const data = { customerId, sourceNumber: g.number, amount: roundTo(Math.abs(total), 2), currency: 'USD' };
        if (existing) await this.prisma.tradeCredit.update({ where: { id: existing.id }, data: { ...data, ...(existing.status === 'VOID' ? { status: 'OPEN' } : {}) } });
        else await this.prisma.tradeCredit.create({ data: { organizationId, sourceDocId: g.id, ...data } });
      } else if (existing && existing.status === 'OPEN') {
        await this.prisma.tradeCredit.update({ where: { id: existing.id }, data: { status: 'VOID' } });
      }
    }
    if (g.docType === 'INVOICE_1' && creditIds.length) {
      await this.prisma.tradeCredit.updateMany({ where: { organizationId, id: { in: creditIds } }, data: { status: 'USED', usedByDocId: g.id, usedByNumber: g.number, usedAt: new Date() } });
    }
  }

  /** The customer an invoice bills (its order's, else its shipment's / covered shipments'). */
  private async invoiceCustomerId(organizationId: string, g: { orderId?: string | null; shipmentId?: string | null }): Promise<string | null> {
    if (g.orderId) return (await this.prisma.tradeOrder.findFirst({ where: { id: g.orderId, organizationId }, select: { customerId: true } }))?.customerId ?? null;
    if (g.shipmentId) {
      const s = await this.prisma.shipment.findFirst({ where: { id: g.shipmentId, organizationId }, select: { customerId: true, order: { select: { customerId: true } } } });
      return s?.order?.customerId ?? s?.customerId ?? null;
    }
    return null;
  }

  /**
   * 出庫・納入依頼書: tick a delivery row delivered (any status — deliveries
   * happen after the SI is sent). Only that row's flag changes; the Stock page
   * subtracts delivered bundles.
   */
  async setDelivered(organizationId: string, id: string, rowIndex: number, delivered: boolean) {
    const g = await this.get(organizationId, id);
    if (g.docType !== 'SHIPPING_INSTRUCTIONS') throw new BadRequestException('Only a 出庫・納入依頼書 has delivery rows');
    const rows = (Array.isArray(g.rows) ? [...g.rows] : []) as Array<Record<string, unknown>>;
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= rows.length) throw new BadRequestException('No such delivery row');
    rows[rowIndex] = { ...rows[rowIndex], delivered, deliveredAt: delivered ? new Date().toISOString().slice(0, 10) : null };
    return this.prisma.tradeGeneratedDoc.update({ where: { id, organizationId }, data: { rows: rows as any }, select: GEN_SELECT });
  }

  /** Open credits (credit notes not yet offset) — for Invoice #1's "Apply open credit". */
  async credits(organizationId: string, q: { customerId?: string; status?: string; forDocId?: string }) {
    // forDocId: the credits of that invoice's customer (Invoice #1's picker), plus any it already uses / issued.
    let customerId = q.customerId;
    if (q.forDocId) {
      const g = await this.prisma.tradeGeneratedDoc.findFirst({ where: { id: q.forDocId, organizationId }, select: { orderId: true, shipmentId: true } });
      customerId = (g ? await this.invoiceCustomerId(organizationId, g) : null) ?? '00000000-0000-0000-0000-000000000000';
    }
    const rows = await this.prisma.tradeCredit.findMany({
      where: { organizationId, ...(customerId ? { customerId } : {}), ...(q.status ? { status: q.status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((c: any) => ({ ...c, amount: Number(c.amount) }));
  }

  /** Add a "前回差額充当" line using an open credit to an Invoice #1 draft. */
  async applyCredit(organizationId: string, id: string, creditId: string) {
    const g = await this.get(organizationId, id);
    if (g.docType !== 'INVOICE_1') throw new BadRequestException('A credit is applied on an Invoice #1');
    if (g.status !== 'DRAFT') throw new BadRequestException('This invoice is final — use "Edit again" first');
    const c = await this.prisma.tradeCredit.findFirst({ where: { id: creditId, organizationId } });
    if (!c) throw new NotFoundException('Credit not found');
    if (c.status !== 'OPEN') throw new BadRequestException(`Credit ${c.sourceNumber ?? ''} is ${c.status.toLowerCase()}`);
    const customerId = await this.invoiceCustomerId(organizationId, g);
    if (customerId !== c.customerId) throw new BadRequestException('That credit belongs to another customer');
    const rows = (Array.isArray(g.rows) ? g.rows : []) as Array<Record<string, unknown>>;
    if (creditIdsOf(rows).includes(creditId)) throw new BadRequestException('That credit is already on this invoice');
    const next = [...rows, creditLine({ id: c.id, amount: Number(c.amount), sourceNumber: c.sourceNumber })];
    return this.prisma.tradeGeneratedDoc.update({ where: { id, organizationId }, data: { rows: next as any }, select: GEN_SELECT });
  }

  /** Estimated cost lines vs step 12 actuals for an Invoice #2 / single invoice issued on estimates. */
  async costVarianceOf(organizationId: string, id: string) {
    const g = await this.get(organizationId, id);
    if (g.docType !== 'INVOICE_2' && g.docType !== 'INVOICE_SINGLE') throw new BadRequestException('Only Invoice #2 / the single invoice carry costs');
    const h = (g.header ?? {}) as { fxRate?: number | null; costsBasis?: string };
    const est =
      g.docType === 'INVOICE_SINGLE'
        ? estimatedCostsUsd(g.docType, g.rows, (r) => singleLineCalc(r as unknown as SingleLine, h.fxRate ?? null).amountUsd)
        : estimatedCostsUsd(g.docType, g.rows, (r) => amountOf(r as unknown as InvoiceLine));
    const ids = [...new Set([...(g.shipmentId ? [g.shipmentId] : []), ...((g.coversShipmentIds as string[] | undefined) ?? [])])];
    const settings = await this.config.getSettings(organizationId);
    const actuals: Array<number | null> = [];
    for (const sid of ids) {
      const s = await this.prisma.shipment.findFirst({ where: { id: sid, organizationId }, select: { netWeightMt: true, grossWeightMt: true, costs: true, customerId: true } });
      if (!s) continue;
      const costs = (s.costs ?? {}) as Record<string, unknown>;
      const hasActual = !!costs.actual && Object.values(costs.actual as Record<string, unknown>).some((v) => typeof v === 'number' && v > 0);
      const profile = await this.config.profileOf(organizationId, s.customerId);
      const e = estimate(s as any, costs as any, settings.estimatorRates, profile);
      actuals.push(hasActual ? actualsTable(e, costs as any, settings.estimatorRates).actual : null);
    }
    return { invoiceId: g.id, number: g.number, costsBasis: h.costsBasis ?? 'ACTUAL', ...costVariance(est, actuals, h.fxRate ?? null) };
  }

  /** "Issue adjustment": a new Invoice #2 draft billing (or crediting) the cost variance of an estimated invoice. */
  async issueAdjustment(organizationId: string, id: string, actor: TradeActor) {
    const v = await this.costVarianceOf(organizationId, id);
    if (!v.complete || v.varianceUsd === null) throw new BadRequestException('The actual costs (step 12) are not all in yet');
    if (Math.abs(v.varianceUsd) < 0.01) throw new BadRequestException('No difference to adjust');
    const g = await this.get(organizationId, id);
    const header = { ...((g.header as Record<string, unknown>) ?? {}), invoiceNo: null, variant: undefined, adjustmentOf: g.id, adjustmentOfNumber: g.number, costsBasis: 'ACTUAL', invoice1No: null, invoice1Amount: null, invoice1Orders: [] };
    const docRef = await this.config.docRefFor(this.prisma, organizationId, (g.shipmentId ? { shipmentId: g.shipmentId } : { orderId: g.orderId! }) as any, 'INVOICE_2');
    return this.prisma.tradeGeneratedDoc.create({
      data: {
        organizationId,
        shipmentId: g.shipmentId ?? null,
        orderId: g.orderId ?? null,
        docType: 'INVOICE_2',
        docRef,
        templateKey: 'INVOICE_2',
        issuingEntity: 'ADH_JP',
        coversShipmentIds: (g.coversShipmentIds as string[] | undefined) ?? [],
        header: header as any,
        columns: [] as any,
        rows: [adjustmentLine(g.number, v.varianceUsd, (header as { dueDate?: string | null }).dueDate ?? null)] as any,
        createdById: actor.id ?? 'unknown',
        createdByName: actor.name,
      },
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
        OR: owners.map((o) => ownerWhere(o)),
      },
      select: { title: true, displayNo: true },
    });
    if (done.length) {
      throw new BadRequestException(`Can't edit again: reopen ${done.map((s) => `"${stepLabel(s)}"`).join(', ')} first — it needs this document`);
    }
    // A credit note already offset on an Invoice #1 can't change; an open one is voided until finalized again.
    const credit = g.docType === 'INVOICE_2' ? await this.prisma.tradeCredit.findFirst({ where: { organizationId, sourceDocId: g.id }, select: { id: true, status: true, usedByNumber: true } }) : null;
    if (credit?.status === 'USED') throw new BadRequestException(`Can't edit again: its credit is used on Invoice #1 ${credit.usedByNumber ?? ''} — edit that one again first`);
    if (g.documentId) await this.unconfirmSalesInvoice(organizationId, g.documentId);
    if (g.finalFileId) {
      const exists = await this.prisma.tradeFile.findFirst({ where: { id: g.finalFileId, organizationId }, select: { id: true } });
      if (exists) await this.files.remove(organizationId, g.finalFileId);
    }
    if (credit?.status === 'OPEN') await this.prisma.tradeCredit.update({ where: { id: credit.id }, data: { status: 'VOID' } });
    // An Invoice #1 back to draft gives its credits back.
    if (g.docType === 'INVOICE_1') await this.prisma.tradeCredit.updateMany({ where: { organizationId, usedByDocId: g.id, status: 'USED' }, data: { status: 'OPEN', usedByDocId: null, usedByNumber: null, usedAt: null } });
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
    g: { id: string; docType: string; documentId: string | null; shipment: { blNumber: string | null } | null; contract: { contractNo: string } | null; order?: { orderNo: number } | null },
    h: InvoiceHeader,
    lines: ReturnType<typeof toInvoiceLines>,
    owners: Array<{ contractId?: string; shipmentId?: string; orderId?: string; stepId?: string }>,
    actor: TradeActor,
    /** Precomputed totals (the single invoice rounds tax its own way). */
    given?: { subtotal: number; tax: number; total: number },
  ): Promise<{ id: string; name: string }> {
    const totals = given ?? invoiceTotals(lines, h.taxRate, h.fxRate);
    const customer = await this.customerOf(organizationId, owners);
    const contractNos = [...new Set(lines.map((l) => l.contractNo).filter(Boolean))];
    const shipRefs = await this.shipmentRefs(
      organizationId,
      owners.map((o) => o.shipmentId).filter((x): x is string => !!x),
    );
    const reference = [
      g.order ? `Order #${g.order.orderNo}` : null,
      shipRefs.length ? `Shipment ${shipRefs.join(', ')}` : null,
      contractNos.length ? `Contract ${contractNos.join(', ')}` : null,
      !shipRefs.length && g.shipment?.blNumber ? `B/L ${g.shipment.blNumber}` : null,
    ]
      .filter(Boolean)
      .join(' / ');
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
        // The Invoices tab's "Covers" column: the shipments billed ("#9-1, #9-2"), else the order ("#11").
        tradeCovers: shipRefs.length ? shipRefs.join(', ') : g.order ? `#${g.order.orderNo}` : undefined,
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
      const where = { documentId: doc.id, ...ownerWhere(o) };
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
  private ownerFor(scope: 'SHIPMENT' | 'CONTRACT' | 'ORDER', input: { shipmentId?: string; contractId?: string; orderId?: string; coversShipmentIds?: string[] }): Owner {
    if (scope === 'SHIPMENT') {
      const sid = input.shipmentId ?? input.coversShipmentIds?.[0];
      if (!sid) throw new BadRequestException('This document belongs to a shipment — pass shipmentId');
      return { shipmentId: sid };
    }
    if (input.orderId) return { orderId: input.orderId };
    if (!input.contractId) throw new BadRequestException('This document belongs to an order — pass orderId');
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
  private async ownersOf(organizationId: string, g: { docType: string; shipmentId: string | null; contractId: string | null; orderId?: string | null; coversShipmentIds?: string[]; rows: unknown }) {
    const owners: Array<{ contractId?: string; shipmentId?: string; orderId?: string }> = g.shipmentId
      ? [{ shipmentId: g.shipmentId }]
      : g.orderId
        ? [{ orderId: g.orderId }]
        : g.contractId
          ? [{ contractId: g.contractId }]
          : [];
    // Invoice #2 / single invoice: every covered shipment (finalizing completes step 11 on each).
    for (const sid of g.coversShipmentIds ?? []) if (!owners.some((o) => o.shipmentId === sid)) owners.push({ shipmentId: sid });
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
    const out: Array<{ contractId?: string; shipmentId?: string; orderId?: string; stepId?: string }> = [];
    for (const o of owners) {
      const step = await this.prisma.tradeStep.findFirst({
        // Not a step marked N/A (a shipment's old step 11 moved to the order in round H).
        where: { organizationId, ...ownerWhere(o), requiredDocTypes: { has: g.docType }, notApplicable: false },
        orderBy: { sortOrder: 'asc' },
        select: { id: true },
      });
      out.push({ ...o, stepId: step?.id });
    }
    return out;
  }

  private async customerOf(organizationId: string, owners: Array<{ contractId?: string; shipmentId?: string; orderId?: string }>) {
    const o = owners[0];
    const sel = { id: true, name: true, customerCode: true, address: true };
    if (o?.orderId) return (await this.prisma.tradeOrder.findFirst({ where: { id: o.orderId, organizationId }, select: { customer: { select: sel } } }))?.customer ?? null;
    if (o?.shipmentId) return (await this.prisma.shipment.findFirst({ where: { id: o.shipmentId, organizationId }, select: { customer: { select: sel } } }))?.customer ?? null;
    if (o?.contractId) return (await this.prisma.contract.findFirst({ where: { id: o.contractId, organizationId }, select: { customer: { select: sel } } }))?.customer ?? null;
    return null;
  }


  // ── orders, covered shipments, Invoice #2 / single invoice drafts ───────
  private async loadOrder(organizationId: string, orderId: string) {
    const o = await this.prisma.tradeOrder.findFirst({
      where: { id: orderId, organizationId },
      select: {
        id: true,
        orderNo: true,
        year: true,
        status: true,
        shipMonth: true,
        product: true,
        grade: true,
        size: true,
        qtyMt: true,
        tolPct: true,
        clientPremium: true,
        upcharge: true,
        customerId: true,
        customer: { select: { id: true, name: true, address: true, jpName: true, jpAddress: true, jpContact: true } },
        contract: { select: { id: true, contractNo: true } },
      },
    });
    if (!o) throw new NotFoundException('Order not found');
    return o;
  }

  /** The customer profile of a shipment's order (else its own customer). */
  private async profileForShipment(organizationId: string, shipmentId: string): Promise<CustomerProfile> {
    const s = await this.prisma.shipment.findFirst({ where: { id: shipmentId, organizationId }, select: { customerId: true, order: { select: { customerId: true } } } });
    return this.config.profileOf(organizationId, s?.order?.customerId ?? s?.customerId ?? null);
  }

  /** "#19-1, #19-2" for shipment ids (in order). */
  private async shipmentRefs(organizationId: string, ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows: Array<{ id: string; seqNo: number | null; blNumber: string | null; order: { orderNo: number } | null }> = await this.prisma.shipment.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, seqNo: true, blNumber: true, order: { select: { orderNo: true } } },
    });
    return ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean).map((r) => (r!.order ? `#${r!.order.orderNo}${r!.seqNo ? `-${r!.seqNo}` : ''}` : (r!.blNumber ?? '')));
  }

  /**
   * The 計量検収票 body defaults to a page of Vedanta's container PL (Kato's
   * layout: the newest PL PDF on the shipment whose name says "container",
   * else any PL PDF); the typed table stays as the fallback.
   */
  private async withAttachDefault(organizationId: string, shipmentId: string, templateKey: string | null, header: GenHeader): Promise<GenHeader> {
    // Every 計量検収票 variant copies Kato's layout (SUS / Hoei until ADH sends their own samples) — except SUS's own .xlsx.
    if (isSusTemplate(templateKey)) return { ...header, bodyMode: 'table' } as GenHeader;
    if (!templateKey?.startsWith('CUSTOMER_PL_')) return { ...header, bodyMode: 'table' } as GenHeader;
    const pls: Array<{ id: string; fileName: string; mimeType: string; docType: string }> = await this.prisma.tradeFile.findMany({
      where: { organizationId, docType: { in: ['CONTAINER_PL', 'PL'] }, links: { some: { shipmentId } } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, fileName: true, mimeType: true, docType: true },
    });
    const pdfs = pls.filter((f) => f.mimeType === 'application/pdf' || /^image\//.test(f.mimeType));
    // The container PL (its own type since the click-through; else by name) is the body.
    const pick = pdfs.find((f) => f.docType === 'CONTAINER_PL') ?? pdfs.find((f) => /container/i.test(f.fileName)) ?? pdfs[0] ?? null;
    // No PL PDF on the shipment yet: the typed table (switch to the page once Vedanta's PL is in).
    if (!pick) return { ...header, bodyMode: 'table' } as GenHeader;
    // The page's INVOICE NO. / DATE (XP2652101334 · 22/07/2026) fill the 計量検収票's blank header fields.
    const facts = pick.mimeType === 'application/pdf' ? await this.containerPlFacts(organizationId, pick.id) : null;
    const h = header as GenHeader & { invoiceNo?: string; plDate?: string };
    const filled = { ...(facts?.invoiceNo && !h.invoiceNo ? { invoiceNo: facts.invoiceNo } : {}), ...(facts?.date && !h.plDate ? { plDate: facts.date } : {}) };
    // ADH pastes Vedanta's PL from "INVOICE NO." down to its AUTHORISED SIGNATORY seal: found in the PDF's text.
    return { ...header, ...filled, bodyMode: 'attach', attachFileId: pick.id, attachPage: 1, attachCrop: { auto: true } } as GenHeader;
  }

  /** An order-level Invoice #2 / single invoice: { orderId, coversShipmentIds? } → its first covered shipment as the record. */
  private async orderInvoiceInput(organizationId: string, input: { docType: string; orderId?: string; coversShipmentIds?: string[] } & Record<string, unknown>) {
    const picked = [...new Set(input.coversShipmentIds ?? [])];
    if (picked.length) return { ...input, shipmentId: picked[0], coversShipmentIds: picked };
    if (!input.orderId) throw new BadRequestException('Pick the order or the shipments this invoice covers');
    const o = await this.prisma.tradeOrder.findFirst({ where: { id: input.orderId, organizationId }, select: { orderNo: true, shipments: { where: { status: { not: 'CANCELLED' } }, orderBy: [{ seqNo: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }], select: { id: true } } } });
    if (!o) throw new NotFoundException('Order not found');
    const invoiced = new Set(await this.invoicedIds(organizationId, o.shipments.map((x: { id: string }) => x.id)));
    const ids = o.shipments.map((x: { id: string }) => x.id).filter((id: string) => !invoiced.has(id));
    if (!ids.length) throw new BadRequestException(`No shipment of order #${o.orderNo} is waiting for an invoice — add the shipment first`);
    return { ...input, shipmentId: ids[0], coversShipmentIds: ids };
  }

  /** INVOICE NO. / DATE printed on a container PL PDF (null when unreadable). */
  private async containerPlFacts(organizationId: string, fileId: string) {
    try {
      const f = await this.prisma.tradeFile.findFirst({ where: { id: fileId, organizationId }, select: { s3Key: true } });
      return f ? containerPlFacts(await pdfText(await this.s3.downloadFile(f.s3Key))) : null;
    } catch {
      return null;
    }
  }

  /** 本船 / 海事№ for the SI: the shipment's confirmed arriving vessel, else the latest A/N read's (transshipment), else the B/L's. */
  private async arrivingVessel(organizationId: string, shipmentId: string, vessel: string | null, voyageNo: string | null): Promise<{ vessel: string; voyageNo: string }> {
    // Round AL: the arriving vessel confirmed on the shipment (tracking / carrier email) wins over the A/N read.
    const own = await this.prisma.shipment.findFirst({ where: { id: shipmentId, organizationId }, select: { arrivingVessel: true, arrivingVoyageNo: true } });
    if (own?.arrivingVessel) return { vessel: own.arrivingVessel, voyageNo: own.arrivingVoyageNo ?? '' };
    const ex = await this.prisma.tradeExtraction.findFirst({ where: { organizationId, shipmentId, kind: 'AN', status: 'DONE' }, orderBy: { createdAt: 'desc' }, select: { result: true } });
    const d = ((ex?.result as { draft?: { vessel?: string | null; voyageNo?: string | null; tsVessel?: string | null; tsVoyageNo?: string | null } } | null)?.draft ?? null);
    if (d?.tsVessel) return { vessel: d.tsVessel, voyageNo: d.tsVoyageNo ?? '' };
    if (d?.vessel) return { vessel: d.vessel, voyageNo: d.voyageNo ?? voyageNo ?? '' };
    return { vessel: vessel ?? '', voyageNo: voyageNo ?? '' };
  }

  /** costs.cifUsd ← the SG→JP IV amount (blanks only; a typed CIF is kept). */
  private async fillCifFromSgjp(organizationId: string, shipmentId: string, rows: unknown) {
    const amount = sgjpTotals((Array.isArray(rows) ? rows : []) as SgjpItem[]).amount;
    if (!(amount > 0)) return;
    const s = await this.prisma.shipment.findFirst({ where: { id: shipmentId, organizationId }, select: { costs: true } });
    const costs = (s?.costs ?? {}) as Record<string, unknown>;
    if (costs.cifUsd !== null && costs.cifUsd !== undefined && costs.cifUsd !== '') return;
    await this.prisma.shipment.update({ where: { id: shipmentId, organizationId }, data: { costs: { ...costs, cifUsd: roundTo(amount, 2) } as any } });
  }

  /** The orders of these shipments must be open (an order-level invoice; completed shipments are fine). */
  private async assertInvoiceOrderOpen(organizationId: string, shipmentIds: Array<string | null | undefined>) {
    const ids = [...new Set(shipmentIds.filter((x): x is string => !!x))];
    if (!ids.length) return;
    const rows: Array<{ order: { orderNo: number; status: string } | null }> = await this.prisma.shipment.findMany({ where: { organizationId, id: { in: ids } }, select: { order: { select: { orderNo: true, status: true } } } });
    const closed = rows.map((r) => r.order).filter((o): o is { orderNo: number; status: string } => !!o && o.status !== 'OPEN');
    if (closed.length) throw new BadRequestException(`Reopen order ${[...new Set(closed.map((o) => `#${o.orderNo}`))].join(', ')} before invoicing`);
  }

  /** Of `ids`, the shipments a FINAL Invoice #2 / single invoice already bills. */
  private async invoicedIds(organizationId: string, ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const billed: Array<{ shipmentId: string | null; coversShipmentIds: string[] }> = await this.prisma.tradeGeneratedDoc.findMany({
      where: { organizationId, status: 'FINAL', docType: { in: ORDER_INVOICE_TYPES }, OR: [{ shipmentId: { in: ids } }, { coversShipmentIds: { hasSome: ids } }] },
      select: { shipmentId: true, coversShipmentIds: true },
    });
    return ids.filter((id) => billed.some((b) => b.shipmentId === id || b.coversShipmentIds.includes(id)));
  }

  /**
   * The shipments an Invoice #2 / single invoice bills: the primary one plus
   * any picked; all of the same customer, not cancelled (a completed shipment
   * can still be billed — step 11 is the order's), and not already billed by
   * another FINAL invoice of either kind. A single invoice also needs each
   * shipment's B/L and CI (it goes out once they are in; no import permit needed).
   */
  private async coveredShipments(organizationId: string, primary: string, picked: string[] | undefined, docType: string): Promise<string[]> {
    const ids = [...new Set([primary, ...(picked ?? [])])];
    const rows: Array<{ id: string; status: string; seqNo: number | null; blNumber: string | null; customerId: string | null; order: { orderNo: number; customerId: string } | null }> = await this.prisma.shipment.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, status: true, seqNo: true, blNumber: true, customerId: true, order: { select: { orderNo: true, customerId: true } } },
    });
    if (rows.length !== ids.length) throw new BadRequestException('One or more shipments were not found in this organization');
    const ref = (r: (typeof rows)[number]) => (r.order ? `#${r.order.orderNo}${r.seqNo ? `-${r.seqNo}` : ''}` : (r.blNumber ?? 'shipment'));
    const customers = new Set(rows.map((r) => r.order?.customerId ?? r.customerId));
    if (customers.size > 1) throw new BadRequestException('An invoice can only cover shipments of the same customer');
    // Completed shipments can still be invoiced (step 11 is the order's since round H); cancelled ones can't.
    const closed = rows.filter((r) => r.status === 'CANCELLED');
    if (closed.length) throw new BadRequestException(`${closed.map(ref).join(', ')} ${closed.length === 1 ? 'is' : 'are'} cancelled — it can't be invoiced`);
    const billed: Array<{ number: string | null; shipmentId: string | null; coversShipmentIds: string[] }> = await this.prisma.tradeGeneratedDoc.findMany({
      where: { organizationId, status: 'FINAL', docType: { in: ['INVOICE_2', 'INVOICE_SINGLE'] }, OR: [{ shipmentId: { in: ids } }, { coversShipmentIds: { hasSome: ids } }] },
      select: { number: true, shipmentId: true, coversShipmentIds: true },
    });
    if (billed.length) {
      const hit = rows.filter((r) => billed.some((b) => b.shipmentId === r.id || b.coversShipmentIds.includes(r.id)));
      throw new BadRequestException(`Already invoiced: ${hit.map(ref).join(', ')} (${billed.map((b) => b.number).filter(Boolean).join(', ')})`);
    }
    if (docType === 'INVOICE_SINGLE') {
      const labels = await this.config.docTypeLabels(organizationId);
      const missing: string[] = [];
      for (const r of rows) {
        const present = new Set(await this.config.presentDocTypes(this.prisma, organizationId, { shipmentId: r.id }));
        const lack = ['BL', 'CI'].filter((t) => !present.has(t));
        if (lack.length) missing.push(`${ref(r)} needs ${lack.map((t) => labels.get(t) ?? t).join(' + ')}`);
      }
      if (missing.length) throw new BadRequestException(`The invoice goes out once the B/L and CI are in: ${missing.join('; ')}`);
    }
    return ids;
  }

  /**
   * Invoice #2 for order-era shipments: a final-price line per covered
   * shipment (its net weight at the shipment month's LME + QMJP of that
   * quarter + the order's client premium / upcharge), the three cost lines on
   * the total weight, and every covered order's Invoice #1 deducted once
   * (an order already deducted by another Invoice #2 isn't deducted again).
   */
  private async invoice2Draft(organizationId: string, covers: string[], defaults: DocDefaults, org: { name: string; address: string | null; registrationNumber: string | null } | null, today: string) {
    const ships: Array<{ id: string; seqNo: number | null; netWeightMt: unknown; customer: { name: string; jpName: string | null } | null; order: Awaited<ReturnType<TradeGeneratedService['loadOrder']>> | null }> = [];
    for (const id of covers) {
      const s = await this.prisma.shipment.findFirst({ where: { id, organizationId }, select: { id: true, seqNo: true, netWeightMt: true, orderId: true, customer: { select: { name: true, jpName: true } } } });
      ships.push({ ...s!, order: s?.orderId ? await this.loadOrder(organizationId, s.orderId) : null });
    }
    const first = ships[0];
    const o0 = first.order;
    const customerName = o0?.customer?.jpName || o0?.customer?.name || first.customer?.jpName || first.customer?.name || '';
    const grades = [...new Set(ships.map((s) => s.order?.grade ?? '').filter(Boolean))];
    const h = invoiceHeaderDefaults({ today, docType: 'INVOICE_2', org: org ?? { name: '' }, customerName, grades, products: [o0?.product ?? ''], defaults });
    const lmeMonth = defaultLmeMonth('INVOICE_2', o0?.shipMonth);
    const finals: InvoiceLine[] = [];
    let totalNet = 0;
    for (const s of ships) {
      const o = s.order;
      const net = s.netWeightMt === null || s.netWeightMt === undefined ? null : Number(s.netWeightMt);
      totalNet += net ?? 0;
      const [line] = invoice2FinalLines({
        netWeightMt: net,
        line: o ? orderLine(o) : null,
        contract: { id: o?.contract?.id ?? '', contractNo: o?.contract?.contractNo ?? '' },
        invoice1Line: o ? { qmjp: qmjpForMonth(defaults, o.shipMonth), premium: num(o.clientPremium), upcharge: num(o.upcharge) } : null,
        defaults,
        dueDate: h.dueDate,
        lmeMonth: o?.shipMonth ?? lmeMonth,
      });
      finals.push({ ...line, contractId: o?.contract?.id ?? null, contractLineId: null, shipmentId: s.id, orderId: o?.id ?? null } as InvoiceLine);
    }
    const costLines = invoice2FinalLines({
      netWeightMt: ships.length > 1 ? roundTo(totalNet, 3) : (first.netWeightMt as number | null),
      line: o0 ? orderLine(o0) : null,
      contract: { id: o0?.contract?.id ?? '', contractNo: o0?.contract?.contractNo ?? '' },
      invoice1Line: null,
      defaults,
      dueDate: h.dueDate,
      lmeMonth,
    }).slice(1);
    // Invoice #1 of each covered order, deducted once across all its Invoice #2s.
    const orderIds = [...new Set(ships.map((s) => s.order?.id).filter((x): x is string => !!x))];
    const otherInv2: Array<{ header: any }> = await this.prisma.tradeGeneratedDoc.findMany({ where: { organizationId, docType: 'INVOICE_2' }, select: { header: true } });
    const deducted = new Set(otherInv2.flatMap((d) => (Array.isArray(d.header?.invoice1Orders) ? (d.header.invoice1Orders as string[]) : [])));
    const inv1s: Array<{ number: string | null; orderId: string | null; rows: unknown; header: any }> = await this.prisma.tradeGeneratedDoc.findMany({
      where: { organizationId, docType: 'INVOICE_1', status: 'FINAL', orderId: { in: orderIds.filter((x) => !deducted.has(x)) } },
      select: { number: true, orderId: true, rows: true, header: true },
    });
    const amount = inv1s.reduce((a, d) => a + invoiceTotals(toInvoiceLines(d.rows), Number(d.header?.taxRate ?? 10), null).total, 0);
    const header = {
      ...h,
      lmeMonth,
      variant: 'final' as const,
      invoice1No: inv1s.map((d) => d.number).filter(Boolean).join(', ') || null,
      invoice1Amount: inv1s.length ? roundTo(amount, 2) : null,
      invoice1Orders: inv1s.map((d) => d.orderId).filter(Boolean),
    };
    return { header, rows: [...finals, ...costLines] };
  }

  /**
   * Single invoice (Kato / Hoei) over the covered shipments: a billet line per
   * shipment; 通関、車輸送料 (taxable) = Σ net × customs rate + trucks × truck
   * rate + net × storage /MT in yen; 通関 (non-taxable) = Σ B/L fee + AN
   * charges in yen; 他諸掛 40 USD/MT. Rates and trucks come from the customer
   * profile + estimator; every figure is editable.
   */

  /**
   * Round AN — Hoei's 請求書 (trade-hoei-formats.ts): one USD line per covered shipment at the shipment month's LME +
   * QMJP + the order's client premium (else 60), from Asia Deal Hub Pte. Ltd., 有効期限 = the end of the issue month.
   */
  private async hoeiInvoice(organizationId: string, covers: string[], defaults: DocDefaults, today: string): Promise<{ header: HoeiInvoiceHeader; rows: unknown[] }> {
    const lines: Parameters<typeof hoeiInvoiceDraft>[0]['lines'] = [];
    let first: Awaited<ReturnType<TradeGeneratedService['loadOrder']>> | null = null;
    let profile: CustomerProfile | null = null;
    for (const id of covers) {
      const s = await this.prisma.shipment.findFirst({ where: { id, organizationId }, select: { id: true, netWeightMt: true, orderId: true, customerId: true } });
      const o = s?.orderId ? await this.loadOrder(organizationId, s.orderId) : null;
      first ??= o;
      profile ??= await this.config.profileOf(organizationId, o?.customerId ?? s?.customerId ?? null);
      lines.push({ quantity: dec(s?.netWeightMt ?? null), lme: o ? lmeForMonth(defaults, o.shipMonth) : null, qmjp: o ? qmjpForMonth(defaults, o.shipMonth) : null, premium: num(o?.clientPremium), product: o?.product ?? null, grade: o?.grade ?? null, shipmentId: s?.id ?? null, orderId: o?.id ?? null });
    }
    const bank = defaultBank(defaults, profile?.defaultBankId);
    const sg = (defaults.sgjpSignBlock ?? defaults.sgjpSellerBlock ?? '').split(/\r?\n/).filter((l) => l.trim() && !/@|^\+|^tel/i.test(l.trim()));
    const m = /^(\d{4})-(\d{2})/.exec(today);
    const monthEnd = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).toISOString().slice(0, 10) : today;
    const built = hoeiInvoiceDraft({
      today,
      toName: formatOf(profile, 'INVOICE')?.addressee || profile?.docAddressee || invoiceAddressee(first?.customer),
      fromName: (defaults.sgSellerBlock ?? '').split(/\r?\n/)[0]?.trim() || (sg[0] ?? ''),
      fromAddress: sg.slice(1).join('\n'),
      bank: bank ? { id: bank.id, block: bank.block } : null,
      shipMonth: first?.shipMonth ?? null,
      validity: monthEnd,
      dueDate: addBusinessDays(today, dueBusinessDays(defaults, 'INVOICE_SINGLE')),
      lines,
    });
    return { header: built.header, rows: built.rows };
  }

  private async singleInvoiceDraft(
    organizationId: string,
    covers: string[],
    defaults: DocDefaults,
    settings: Awaited<ReturnType<TradeConfigService['getSettings']>>,
    org: { name: string; address: string | null; registrationNumber: string | null } | null,
    today: string,
  ): Promise<{ header: SingleInvoiceHeader; rows: SingleLine[] }> {
    const rows: SingleLine[] = [];
    let net = 0;
    let customsJpy = 0;
    let nonTaxJpy = 0;
    let fx: number | null = null;
    let o0: Awaited<ReturnType<TradeGeneratedService['loadOrder']>> | null = null;
    let profile: CustomerProfile | null = null;
    const d = defaults as DocDefaults & Record<string, string | undefined>;
    for (const id of covers) {
      const s = await this.prisma.shipment.findFirst({ where: { id, organizationId }, select: { id: true, netWeightMt: true, grossWeightMt: true, costs: true, orderId: true, customerId: true } });
      const o = s?.orderId ? await this.loadOrder(organizationId, s.orderId) : null;
      o0 ??= o;
      profile ??= await this.config.profileOf(organizationId, o?.customerId ?? s?.customerId ?? null);
      const q = s?.netWeightMt === null || s?.netWeightMt === undefined ? null : Number(s.netWeightMt);
      net += q ?? 0;
      const costs = (s?.costs ?? {}) as Record<string, any>;
      if (fx === null && typeof costs.fxRate === 'number') fx = costs.fxRate;
      const e = estimate(s ?? {}, costs, settings.estimatorRates, { truckCapacityT: profile.truckCapacityT });
      const customsRate = profile.customsRatePerMt ?? settings.estimatorRates.customsPerMt;
      customsJpy += (q ?? 0) * customsRate + (e.trucks ?? 0) * e.truckRate + (q ?? 0) * settings.estimatorRates.storagePerMt;
      nonTaxJpy += e.blFee + e.anCharges;
      const goods: SingleLine = {
        kind: 'goods',
        description: (d.singleGoodsTemplate ?? 'アルミニウムビレット{grade}').replace('{grade}', o?.grade ?? '').replace('{product}', o?.product ?? ''),
        quantity: q,
        lme: o ? lmeForMonth(defaults, o.shipMonth) : null,
        qmjp: o ? qmjpForMonth(defaults, o.shipMonth) : null,
        premium: num(o?.clientPremium),
        upcharge: num(o?.upcharge) || null,
        taxable: true,
        remarks: '',
        autoRemarks: true,
        shipmentId: s?.id ?? null,
        orderId: o?.id ?? null,
        grade: o?.grade ?? null,
      };
      goods.remarks = singleGoodsRemarks(goods, o?.shipMonth ?? '', d.singleRemarksTemplate);
      rows.push(goods);
    }
    const qty = roundTo(net, 3);
    const block = profile?.invoiceRemarks ?? defaultSingleRemarks(profile?.port);
    rows.push(
      { kind: 'jpy', description: d.singleCustomsTaxableLabel ?? '通関、車輸送料\n　課税対象　消費税率10％', quantity: qty, jpyAmount: roundTo(customsJpy, 2), taxable: true, remarks: block },
      { kind: 'jpy', description: d.singleCustomsLabel ?? '通関\n　課税対象外', quantity: qty, jpyAmount: roundTo(nonTaxJpy, 2), taxable: false, remarks: block },
      { kind: 'usd', description: d.singleOtherLabel ?? '他諸掛\n　課税対象　消費税率10％', quantity: qty, unitPrice: Number(defaults.invoice2OtherPerMt ?? 40), taxable: true, remarks: `${Number(defaults.invoice2OtherPerMt ?? 40)}USD/MT` },
    );
    const bank = defaultBank(defaults);
    const lmeMonth = o0?.shipMonth ?? '';
    const m = /^(\d{4})-(\d{2})$/.exec(lmeMonth);
    const fill = (tpl: string) =>
      tpl
        .replace('{month}', m ? String(Number(m[2])) : '')
        .replace('{q}', quarterOf(lmeMonth))
        .replace('{grade}', o0?.grade ?? '')
        .replace('{inch}', inchJa(o0?.size, defaults))
        .replace('{product}', o0?.product ? (defaults.productJa?.[o0.product] ?? 'アルミニウムビレット') : 'アルミニウムビレット');
    const header: SingleInvoiceHeader = {
      layout: 'single',
      title: '請　求　書',
      invoiceNo: null,
      issueDate: today,
      registrationNo: org?.registrationNumber ?? '',
      toName: invoiceAddressee(o0?.customer),
      toSuffix: '御中',
      subject: fill(d.singleSubjectTemplate ?? '{product}品 {grade} {inch}').trim(),
      paymentTerms: d.singlePaymentTerms ?? 'BLコピー提供・請求書発行後５営業日以内、弊社指定口座振込',
      validity: d.singleValidity ?? '請求書発行後 5営業日以内 弊社指定口座振込',
      fromBlock: d.singleFromBlock ?? defaults.invoiceFromBlock ?? [org?.name, org?.address].filter(Boolean).join('\n'),
      fxRate: fx,
      fxNote: (d.invoiceFxNote ?? '円/USD 税関 {range} 外国為替相場参照').replace('{range}', customsWeek(today)),
      taxRate: defaults.invoiceTaxRate ?? 10,
      lmeMonth,
      conditions: fill(
        d.singleConditions ??
          '・アルミニウムビレットの価格は、船積み{month}月平均LME Cash, {q}QMJPを適用。\n・トラック積替え貴社指定場所に納入（車上渡し）\n・関税・消費税、船社立替、税関検査、保管料等は実費にてご請求\n・為替は輸入許可通知書の為替レートを活用予定',
      ),
      paymentBlock: d.singlePaymentBlock ?? '・BLコピー提供　請求書発行後５営業日以内、弊社指定口座振込',
      bankBlock: bank?.block ?? '',
      bankId: bank?.id ?? null,
      showSeal: true,
      dueDate: addBusinessDays(today, dueBusinessDays(defaults, 'INVOICE_SINGLE')),
      currency: 'USD',
    };
    return { header, rows };
  }

  /**
   * Invoice #2 / single invoice: the cost lines suggested by the estimator of
   * every covered shipment, in JPY and in USD at the given FX. The editor only
   * fills cost lines the user hasn't typed (never overwrites).
   */
  async costSuggestion(organizationId: string, id: string, fxRate?: number | null) {
    const g = await this.get(organizationId, id);
    const settings = await this.config.getSettings(organizationId);
    const ids = [...new Set([g.shipmentId, ...(g.coversShipmentIds ?? [])].filter((x): x is string => !!x))];
    let taxableJpy = 0;
    let nonTaxableJpy = 0;
    for (const sid of ids) {
      const s = await this.prisma.shipment.findFirst({ where: { id: sid, organizationId }, select: { netWeightMt: true, grossWeightMt: true, costs: true, customerId: true, order: { select: { customerId: true } } } });
      if (!s) continue;
      const p = await this.config.profileOf(organizationId, s.order?.customerId ?? s.customerId);
      const e = estimate(s, (s.costs ?? {}) as any, settings.estimatorRates, p);
      taxableJpy += (e.customs ?? 0) + e.anCharges + (e.trucking ?? 0) + e.storage + e.other;
      nonTaxableJpy += e.blFee;
    }
    const fx = fxRate ?? (g.header as { fxRate?: number | null })?.fxRate ?? null;
    const usd = (v: number) => (fx && fx > 0 ? Math.floor((v / fx) * 100 + 1e-7) / 100 : null);
    return { fxRate: fx, shipments: ids.length, taxableJpy, nonTaxableJpy, taxableUsd: usd(taxableJpy), nonTaxableUsd: usd(nonTaxableJpy) };
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
      where: { organizationId, docType: { in: ['COA', 'COA_XLS'] }, links: { some: { shipmentId } } },
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
    const pls: Array<{ s3Key: string; fileName: string }> = await this.prisma.tradeFile.findMany({
      where: { organizationId, docType: { in: ['PL_XLS', 'PL'] }, links: { some: { shipmentId } } },
      orderBy: { createdAt: 'desc' },
      select: { s3Key: true, fileName: true },
    });
    const pl = pls.find((f) => SOURCE_EXTENSIONS.test(f.fileName));
    if (!pl) return null;
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
        order: {
          select: {
            id: true,
            shipMonth: true,
            grade: true,
            product: true,
            size: true,
            qtyMt: true,
            tolPct: true,
            clientPremium: true,
            upcharge: true,
            incoterm: true,
            destinationPort: true,
            consignee: true,
            supplier: { select: { name: true, address: true } },
          },
        },
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
        etd: true,
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
        customerId: true,
        customer: { select: { name: true, address: true, jpName: true, jpAddress: true, jpContact: true } },
        contractLine: { select: { grade: true, product: true, sizeSpec: true } },
        contract: { select: { contractNo: true, piNumber: true } },
        seqNo: true,
        order: {
          select: { orderNo: true, piNo: true, grade: true, product: true, size: true, customerId: true, customer: { select: { name: true, address: true, jpName: true, jpAddress: true, jpContact: true } } },
        },
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
    const profile = await this.config.profileOf(organizationId, s.order?.customerId ?? s.customerId ?? null);
    const withCustomer = { ...s, customer: shipmentAddressee(s, profile, docType) };
    const h = customerDocHeader(buildDefaultHeader(org, withCustomer, title, docType, tradeToday()), withCustomer, docType, (settings.docDefaults ?? {}) as DocDefaults);
    // Round AM: Clients → Document formats → language "English" prints the PL / COA in the English table layout.
    if (h.layout === 'jp' && formatOf(profile, docType)?.language === 'en') {
      const { layout: _jp, ...en } = h;
      return en as GenHeader;
    }
    return h;
  }

  /** Round AM — the header of SUS's own formats: Vedanta's producer block and key lines, filled from the shipment. */
  private async susHeader(organizationId: string, s: HeaderShipment, base: GenHeader, docType: string, fromPdf: { date: string | null; invoiceNo: string | null } | null): Promise<GenHeader> {
    const d = ((await this.config.getSettings(organizationId)).docDefaults ?? {}) as DocDefaults;
    const grade = s.order?.grade ?? s.contractLine?.grade ?? '';
    const size = s.order?.size ?? s.sizeSpec ?? s.contractLine?.sizeSpec ?? '';
    const product = (s.order?.product ?? s.contractLine?.product ?? 'Aluminium Billet').toUpperCase();
    if (docType === 'CUSTOMER_PL') return { ...base, layout: 'sus', title: 'PACKING LIST', bodyMode: 'table' } as GenHeader;
    const date = fromPdf?.date ?? (await this.coaPdfDateFor(organizationId, s.id)) ?? isoDay(s.etd) ?? '';
    return {
      ...base,
      layout: 'sus',
      title: 'CERTIFICATE OF ANALYSIS',
      producerBlock: VEDANTA_PRODUCER_BLOCK,
      date,
      invoiceNo: fromPdf?.invoiceNo ?? s.ciNumber ?? '',
      goodsDescription: [product, grade ? `ALLOY ${grade}` : null, size.toUpperCase()].filter(Boolean).join(' '),
      brand: 'VEDANTA',
      origin: (s.countryOfOrigin ?? 'INDIA').toUpperCase(),
      applicant: applicantName(d.customerPlApplicant) || 'ASIA DEAL HUB PTE. LTD',
      footer: '',
    } as GenHeader;
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

const num = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** The order as a "product line" for the invoice helpers (premium = the order's client premium). */
export function orderLine(o: { id: string; grade: string | null; product: string | null; size: string | null; qtyMt: unknown; tolPct: unknown; clientPremium: unknown; upcharge: unknown }) {
  return { id: o.id, grade: o.grade, product: o.product, sizeSpec: o.size, quantityMt: o.qtyMt, tolerancePct: o.tolPct, qmjp: null, billetPremium: o.clientPremium, upcharge: o.upcharge };
}

/** "8インチ" for a 203 MM billet (docDefaults.sizeInch { "203": "8 inch" }); '' when unknown. */
export function inchJa(size: string | null | undefined, d: DocDefaults): string {
  const mm = /(\d{2,4})\s*MM/i.exec(size ?? '')?.[1];
  const v = mm ? d.sizeInch?.[mm] : undefined;
  const n = v ? /(\d+)/.exec(v)?.[1] : undefined;
  return n ? `${n}インチ` : '';
}

export { defaultSingleRemarks } from './trade-profile';

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
  > & { seqNo?: number | null; order?: { orderNo: number; piNo: string | null; grade: string | null; product: string | null; size: string | null } | null },
  title: string,
  docType: string,
  today: string,
): GenHeader {
  const ref = (key: string, label: string, value: string | null | undefined, visible = true): GenRef => ({ key, label, value: value ?? '', visible: visible && !!value });
  const refs: GenRef[] = [
    ref('orderRef', 'Order / shipment', s.order ? `#${s.order.orderNo}${s.seqNo ? `-${s.seqNo}` : ''}` : null),
    ref('contractNo', 'Contract No.', s.contract?.contractNo),
    ref('piNumber', 'PI No.', s.order?.piNo ?? s.contract?.piNumber),
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

/** The customer a shipment's PL / COA is addressed to: the order's (else the shipment's), with the profile's 宛先. */
export function shipmentAddressee(
  s: { customer?: JpPartySource | null; order?: { customer?: JpPartySource | null } | null },
  profile: { docAddressee?: string | null; docFormats?: CustomerProfile['docFormats'] },
  docType?: string,
): JpPartySource | null {
  const c = s.order?.customer ?? s.customer;
  // Round AM: a document's own 宛先 (Clients → Document formats) wins over the customer's.
  const own = docType ? formatOf(profile, docType)?.addressee?.trim() : null;
  return c ? { ...c, docAddressee: own || profile.docAddressee || null } : null;
}

/** 請求書 宛先: the customer's Japanese legal name (name only, as on ADH's invoices), else its name. */
export const invoiceAddressee = (c: { name: string; jpName?: string | null } | null | undefined) => c?.jpName || c?.name || '';

type JpPartySource = { name: string; address?: string | null; jpName?: string | null; jpAddress?: string | null; jpContact?: string | null; docAddressee?: string | null };

/**
 * The customer as Japanese documents print it: its Japanese legal name /
 * address / contact when any is on the record (no mixing in the English
 * address), else the English name and address. Blank parts are null.
 */
export function jpParty(c: JpPartySource): { name: string; address: string | null; contact: string | null } {
  const t = (v: string | null | undefined) => (v ?? '').trim() || null;
  // The profile's 宛先 (a department after the legal name) wins over the name alone.
  if (t(c.jpName) || t(c.jpAddress) || t(c.jpContact)) return { name: t(c.docAddressee) ?? t(c.jpName) ?? c.name, address: t(c.jpAddress), contact: t(c.jpContact) };
  return { name: t(c.docAddressee) ?? c.name, address: t(c.address), contact: null };
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
  if (docType === 'CUSTOMER_PL' && h.bodyMode === 'attach') {
    if (!h.attachFileId) problems.push("attach a page of Vedanta's container packing list (or switch the body to the typed table)");
  } else if (docType === 'CUSTOMER_PL') {
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

/** "2026-07-22" of a date (or null). */
const isoDay = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** 倉庫名 for a 出庫・納入依頼書 (round N): the delivery site's own, else the org default only for Yokohama (or an unknown port). */
export function siWarehouse(profile: { warehouseName?: string | null; warehouseCheck?: boolean } | null | undefined, port: string | null | undefined, orgDefault: string | null | undefined): { warehouseName: string; warehouseCheck?: boolean } {
  if (profile?.warehouseName) return { warehouseName: profile.warehouseName };
  if (profile?.warehouseCheck) return { warehouseName: '', warehouseCheck: true };
  if (port && !/yokohama|横浜/i.test(port)) return { warehouseName: '', warehouseCheck: true };
  return { warehouseName: orgDefault ?? '' };
}

/** Round AN: step 4 for a customer who gets Vedanta's own COA / PL (Hoei). */
function asReceivedMessage(templateKey: string): string {
  return `This customer gets Vedanta's ${templateKey === AS_RECEIVED_COA ? 'COA' : 'packing list'} as received (Clients → Document formats) — nothing to create; send Vedanta's file from step 3b`;
}
