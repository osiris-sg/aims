import { likeOrders, PiOrderRow, toHint } from './order-pi-hints';
import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ActionLogService } from '../action-log/action-log.service';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import { DocumentExtractionService } from '../document-extraction/document-extraction.service';
import { TradeActor } from './shipments.request';
import { Db } from './trade-config.service';
import {
  AN_SCHEMA,
  AN_SYSTEM_PROMPT,
  AN_USER_PROMPT,
  anCostInputs,
  anFillable,
  anRawFromText,
  arrivalNoticeDraft,
  BL_SCHEMA,
  BL_SYSTEM_PROMPT,
  BL_USER_PROMPT,
  blDraftChecks,
  BlCheck,
  CI_SCHEMA,
  CI_SYSTEM_PROMPT,
  CI_USER_PROMPT,
  CiRaw,
  contractDraftFromPi,
  issueCount,
  lineForGrade,
  parseWith,
  permitFromRaw,
  PERMIT_SCHEMA,
  PERMIT_SYSTEM_PROMPT,
  PERMIT_USER_PROMPT,
  PI_SCHEMA,
  PI_SYSTEM_PROMPT,
  PI_USER_PROMPT,
  ShipmentDraft,
  shipmentDraftFromBl,
  withTextFields,
  piLineForOrder,
} from './trade-extract.rules';
import { parseVedantaPiText } from './trade-pi-text';
import { hsWarning, productHsForShipment } from './trade-hs';
import { ciAmountOf, ciHistory, ciProposal, CiText, ciVersionOf, ciVersionsFor, latestCi, parseCiText } from './trade-ci';
import { fixedPremiumFromPi } from './trade-contract';
import { TradeFilesService } from './trade-files.service';
import { AnData, importTax, parseAnText, parsePermitText, PermitData, permitChecks, permitTotalFromFileName, sameBl } from './trade-customs';
import { pdfText } from './trade-coa';
import { INVOICE_SYSTEM_PROMPT, INVOICE_USER_PROMPT, readInvoiceBuffer } from './trade-invoice-read';
import { ShipmentCosts } from './trade-estimator';
import { supplierProfileFor } from './trade-profile';
import * as XLSX from 'xlsx';
import { Classification, classifyByName, classifyPrompt, classifySheetText, combineClassification, isSpreadsheet } from './trade-classify';
import { decodeUploadName, depositOf, resolveTradeFileMime, tradeDateError } from './shipments.rules';

export type ExtractKind = 'PI' | 'BL_DRAFT' | 'AN' | 'IMPORT_PERMIT' | 'CI';
const DOC_TYPE: Record<ExtractKind, string> = { PI: 'PI', BL_DRAFT: 'BL_DRAFT', AN: 'ARRIVAL_NOTICE', IMPORT_PERMIT: 'IMPORT_PERMIT', CI: 'CI' };
/** The step a newly uploaded source PDF is tagged with. */
const STEP_CODE: Partial<Record<ExtractKind, string>> = { BL_DRAFT: 'BL_DRAFT_APPROVAL', AN: 'AN_INSTRUCTIONS', IMPORT_PERMIT: 'IMPORT_PERMIT' };
const PROMPTS: Record<ExtractKind, [string, string]> = {
  PI: [PI_SYSTEM_PROMPT, PI_USER_PROMPT],
  BL_DRAFT: [BL_SYSTEM_PROMPT, BL_USER_PROMPT],
  AN: [AN_SYSTEM_PROMPT, AN_USER_PROMPT],
  IMPORT_PERMIT: [PERMIT_SYSTEM_PROMPT, PERMIT_USER_PROMPT],
  CI: [CI_SYSTEM_PROMPT, CI_USER_PROMPT],
};
/** Read from the PDF's text layer first (exact, free); the AI read only when it isn't enough. */
const TEXT_FIRST: Partial<Record<ExtractKind, (text: string) => { data: unknown; complete: boolean }>> = {
  // Round BP: Vedanta's e-signed PIs carry a text layer — both amount columns and the instrument date read exactly.
  PI: parseVedantaPiText,
  AN: parseAnText,
  IMPORT_PERMIT: parsePermitText,
  // Round BJ: Vedanta's CIs carry a text layer — no., date, FINAL / PROVISIONAL and the Sub Total read exactly.
  CI: (text) => {
    const c = parseCiText(text);
    return { data: c, complete: !!c.ciNumber && ciAmountOf(c) !== null };
  },
};
/** A text-layer CI read in the AI read's shape (+ Sub Total, advance, FINAL / PROVISIONAL, shipper). */
const ciRawFromText = (c: CiText): CiRaw & Record<string, unknown> => ({
  ciNumber: c.ciNumber,
  ciDate: c.ciDate,
  blNumber: null,
  currency: 'USD',
  totalAmount: c.total,
  subTotal: c.subTotal,
  advance: c.advance,
  status: c.status,
  netWeightMt: c.netMt,
  unitPrice: c.rate,
  lme: c.lme,
  premium: c.premium,
  shipperBlock: c.shipperBlock,
  countryOfOrigin: c.countryOfOrigin,
  hsCode: c.hsCode,
});
const READABLE = /^(application\/pdf|image\/(png|jpe?g|webp))$/;
/** Round BQ: the filed types the invoice reader reads on upload (vendor bills + customer invoices made outside AIMS). */
export const INVOICE_READ_DOC_TYPES = ['VENDOR_INVOICE', 'INVOICE_1', 'INVOICE_2', 'INVOICE_SINGLE', 'INVOICE_ADJUSTMENT'];
/**
 * Round BJ — the filed types each reader accepts. "Fill from B/L draft" also reads the carrier's final / original B/L
 * and its scan (#18-1: the OBL uploaded on step 3a was refused as "filed as BL, not BL_DRAFT", so nothing was read).
 */
const READS_DOC_TYPES: Partial<Record<ExtractKind, string[]>> = { BL_DRAFT: ['BL_DRAFT', 'BL', 'BL_SCAN'] };

/** Sonnet list price (USD per million tokens) — only for the cost shown in reports/logs. */
export const PRICE_PER_MTOK = { input: 3, output: 15 };
export const costUsd = (inputTokens: number | null, outputTokens: number | null) =>
  Math.round((((inputTokens ?? 0) * PRICE_PER_MTOK.input + (outputTokens ?? 0) * PRICE_PER_MTOK.output) / 1_000_000) * 10000) / 10000;

const EXTRACTION_SELECT = {
  id: true,
  fileId: true,
  kind: true,
  status: true,
  result: true,
  checks: true,
  error: true,
  model: true,
  inputTokens: true,
  outputTokens: true,
  durationMs: true,
  shipmentId: true,
  contractId: true,
  acknowledgedByName: true,
  acknowledgedAt: true,
  createdAt: true,
  file: { select: { id: true, fileName: true, mimeType: true, docType: true } },
};

/**
 * Reads a PI or a B/L draft with the shared Claude extractor (same model, key
 * and PDF handling as every other extraction), validates the JSON with zod,
 * and turns it into a contract / shipment draft. The source PDF is always a
 * stored TradeFile; each run is a TradeExtraction row (newest wins).
 */
@Injectable()
export class TradeExtractService {
  private readonly logger = new Logger(TradeExtractService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly files: TradeFilesService,
    // Concrete class (Nest's DI token); tests and the smoke run pass a mock with extractStructured.
    private readonly extractor: DocumentExtractionService,
    @Optional() private readonly actionLog?: ActionLogService,
  ) {
    // Round BQ: an invoice / bill filed by upload or email is read once, after the upload (never blocks it).
    this.files?.onUploaded?.((organizationId, fileId, docType) => {
      if (!INVOICE_READ_DOC_TYPES.includes(docType)) return;
      this.readInvoice(organizationId, fileId).catch((e) => this.logger.warn(`invoice read failed for ${fileId}: ${(e as Error)?.message}`));
    });
  }

  /**
   * Round BQ — read an invoice / bill / debit note once (text layer, else AI) and store it as a TradeExtraction of
   * kind INVOICE: what the Dashboard "Unpaid" list shows for invoices that exist only as files (Mitsui Soko, carriers,
   * customer invoices made outside AIMS). Runs after the upload (fire-and-forget) and from the backfill script.
   */
  async readInvoice(organizationId: string, fileId: string, actor: TradeActor | null = null) {
    const file = await this.prisma.tradeFile.findFirst({ where: { id: fileId, organizationId }, select: { id: true, docType: true, s3Key: true, mimeType: true, fileName: true } });
    if (!file || !INVOICE_READ_DOC_TYPES.includes(file.docType) || !READABLE.test(file.mimeType)) return null;
    const started = Date.now();
    let tokens = { model: 'text-layer', inputTokens: 0, outputTokens: 0 };
    const buffer = await this.s3.downloadFile(file.s3Key);
    const read = await readInvoiceBuffer(buffer, file.mimeType, {
      pdfText,
      ai: async (buf, mimetype) => {
        const out = await this.extractor.extractStructured({ buffer: buf, mimetype }, INVOICE_SYSTEM_PROMPT, INVOICE_USER_PROMPT, { maxTokens: 1500 });
        tokens = { model: out.model, inputTokens: out.inputTokens, outputTokens: out.outputTokens };
        return out.data;
      },
    });
    const row = await this.prisma.tradeExtraction.create({
      data: {
        organizationId,
        fileId,
        kind: 'INVOICE',
        status: read.invoices ? 'DONE' : 'FAILED',
        result: read.invoices ? ({ invoices: read.invoices } as any) : undefined,
        error: read.error?.slice(0, 2000) ?? null,
        ...tokens,
        durationMs: Date.now() - started,
        createdById: actor?.id ?? 'system:invoice-read',
      },
      select: { id: true },
    });
    this.actionLog?.system('invoice-read', 'CREATE', 'trade-extraction', {
      organizationId,
      resourceId: row.id,
      details: { fileId, fileName: file.fileName, docType: file.docType, invoices: (read.invoices ?? []).map((f) => ({ via: f.via, docKind: f.docKind, invoiceNo: f.invoiceNo, total: f.total, currency: f.currency, dueDate: f.dueDate })), error: read.error },
    });
    return read.invoices;
  }

  async extract(organizationId: string, kind: ExtractKind, input: { file?: Express.Multer.File; fileId?: string; shipmentId?: string; contractId?: string; orderId?: string }, actor: TradeActor) {
    if (input.shipmentId) {
      const s = await this.prisma.shipment.findFirst({ where: { id: input.shipmentId, organizationId }, select: { id: true } });
      if (!s) throw new BadRequestException('Shipment not found');
    }
    // 1. The source file: a new upload goes through the normal trade-file path.
    let fileId = input.fileId;
    if (input.file) {
      const stepId = input.shipmentId && STEP_CODE[kind] ? await this.stepId(input.shipmentId, STEP_CODE[kind]!) : undefined;
      const uploaded = await this.files.upload(
        organizationId,
        input.file,
        { docType: DOC_TYPE[kind], ...(input.shipmentId ? { shipmentIds: JSON.stringify([input.shipmentId]) } : {}), ...(stepId ? { stepId } : {}) } as any,
        actor,
      );
      fileId = uploaded.id;
    }
    if (!fileId) throw new BadRequestException('Attach the PDF or pick an uploaded file');
    const file = await this.prisma.tradeFile.findFirst({ where: { id: fileId, organizationId }, select: { id: true, docType: true, s3Key: true, mimeType: true, fileName: true, createdAt: true } });
    if (!file) throw new NotFoundException('File not found');
    if (!(READS_DOC_TYPES[kind] ?? [DOC_TYPE[kind]]).includes(file.docType)) throw new BadRequestException(`${file.fileName} is filed as ${file.docType}, not ${DOC_TYPE[kind]}`);
    if (!READABLE.test(file.mimeType)) throw new BadRequestException(`${file.fileName} is not a PDF or image the reader can open`);

    const row = await this.prisma.tradeExtraction.create({
      data: { organizationId, fileId, kind, status: 'PENDING', shipmentId: input.shipmentId ?? null, contractId: input.contractId ?? null, createdById: actor.id ?? 'unknown' },
      select: { id: true },
    });

    // 2. Read it (synchronous: a PI / B/L page takes ~10–30 s).
    const started = Date.now();
    try {
      const buffer = await this.s3.downloadFile(file.s3Key);
      const fromText = TEXT_FIRST[kind] && file.mimeType === 'application/pdf' ? await this.readText(buffer, TEXT_FIRST[kind]!) : null;
      const out = fromText?.complete
        ? { data: fromText.data, model: 'text-layer', inputTokens: 0, outputTokens: 0 }
        : await this.extractor.extractStructured({ buffer, mimetype: file.mimeType }, PROMPTS[kind][0], PROMPTS[kind][1], {
            maxTokens: 4000,
          });
      const via = fromText?.complete ? ('text' as const) : ('ai' as const);
      const result =
        kind === 'PI'
          ? await this.piResult(organizationId, out.data)
          : kind === 'AN'
            ? await this.anResult(organizationId, via === 'text' ? anRawFromText(out.data as AnData) : out.data, input, via)
            : kind === 'IMPORT_PERMIT'
              ? await this.permitResult(organizationId, via === 'text' ? (out.data as PermitData) : permitFromRaw(parseWith(PERMIT_SCHEMA, out.data, 'import permit')), input, file.fileName, via)
              : kind === 'CI'
                ? { raw: via === 'text' ? ciRawFromText(out.data as CiText) : parseWith(CI_SCHEMA, out.data, 'CI') }
                : await this.blResult(organizationId, out.data, input, file.mimeType === 'application/pdf' ? await pdfText(buffer).catch(() => '') : '');
      // Read on upload (round H click-through): blank record fields are filled from the document — typed values are kept.
      const filled =
        kind === 'PI' && input.orderId
          ? await this.fillOrderFromPi(organizationId, input.orderId, (result as { draft: PiFill }).draft)
          : kind === 'CI' && input.shipmentId
            ? await this.fillShipmentFromCi(organizationId, input.shipmentId, (result as { raw: CiRaw }).raw, file)
            : [];
      if (filled.length) (result as Record<string, unknown>).filled = filled;
      if (kind === 'CI' && input.shipmentId) {
        // A CI version newer than the stored amount: proposed on the shipment, never written over it.
        const versions = ciHistory([...(await ciVersionsFor(this.prisma, organizationId, input.shipmentId)).filter((v) => v.fileId !== file.id), ciVersionOf((result as { raw: CiRaw }).raw as Record<string, unknown>, file)]);
        const stored = await this.prisma.shipment.findFirst({ where: { id: input.shipmentId, organizationId }, select: { ciAmount: true } });
        const proposal = ciProposal(stored?.ciAmount === null || stored?.ciAmount === undefined ? null : Number(stored.ciAmount), versions);
        if (proposal) (result as Record<string, unknown>).ciProposal = proposal;
      }
      const checks = kind === 'BL_DRAFT' && input.shipmentId ? await computeBlChecks(this.prisma, organizationId, input.shipmentId, (result as { draft: ShipmentDraft }).draft) : null;
      await this.prisma.tradeExtraction.update({
        where: { id: row.id },
        data: {
          status: 'DONE',
          result: result as any,
          checks: checks as any,
          model: out.model,
          inputTokens: out.inputTokens,
          outputTokens: out.outputTokens,
          durationMs: Date.now() - started,
        },
      });
      this.logger.log(`${kind} ${file.fileName}: ${Date.now() - started} ms, ${out.inputTokens}/${out.outputTokens} tokens ≈ $${costUsd(out.inputTokens, out.outputTokens)}`);
    } catch (e) {
      const msg = (e as Error)?.message || String(e);
      this.logger.warn(`${kind} extraction failed for ${file.fileName}: ${msg}`);
      await this.prisma.tradeExtraction.update({ where: { id: row.id }, data: { status: 'FAILED', error: msg.slice(0, 2000), durationMs: Date.now() - started } });
    }
    return this.get(organizationId, row.id);
  }

  /**
   * Bulk upload with AI sorting: classify one dropped file into one of the
   * step's document types (file name + spreadsheet header + Claude for PDFs /
   * images). Nothing is stored — the portal uploads the confirmed files the
   * normal way. The AI read is best effort: on failure the name rules decide.
   */
  async classify(organizationId: string, file: Express.Multer.File, allowed: string[], shipmentId?: string): Promise<Classification & { fileName: string }> {
    if (!file) throw new BadRequestException('Attach the file to classify');
    const types = [...new Set(allowed.filter((t) => typeof t === 'string' && /^[A-Z0-9_]{2,40}$/.test(t)))];
    if (!types.length) throw new BadRequestException('Give the step\'s document types');
    const fileName = decodeUploadName(file.originalname);
    // File-name rules are Vedanta's naming: a supplier with its own document set (Inalum, the Thai supplier) is read by content only.
    const contentOnly = shipmentId ? await this.contentOnly(organizationId, shipmentId) : false;
    const name = contentOnly ? null : classifyByName(fileName);
    let sheet: ReturnType<typeof classifySheetText> = null;
    let ai: Record<string, unknown> | null = null;
    if (isSpreadsheet(fileName)) {
      sheet = classifySheetText(sheetText(file.buffer));
    } else {
      const mime = resolveTradeFileMime(fileName, file.mimetype) ?? file.mimetype;
      if (READABLE.test(mime)) {
        try {
          const [system, user] = classifyPrompt(types);
          ai = (await this.extractor.extractStructured({ buffer: file.buffer, mimetype: mime }, system, user, { maxTokens: 300 })).data;
        } catch (e) {
          this.logger.warn(`classify ${fileName}: AI read failed (${(e as Error)?.message}) — using the file name`);
        }
      }
    }
    return { fileName, ...combineClassification(types, name, sheet, ai) };
  }

  /** The shipment's supplier sends its own document set (profile: no PI, or its own step 3b list). */
  private async contentOnly(organizationId: string, shipmentId: string): Promise<boolean> {
    const s = await this.prisma.shipment.findFirst({ where: { id: shipmentId, organizationId }, select: { order: { select: { supplierId: true } } } });
    if (!s?.order?.supplierId) return false;
    const row = await this.prisma.tradeSetting.findUnique({ where: { organizationId }, select: { supplierProfiles: true } });
    const p = supplierProfileFor(row?.supplierProfiles, s.order.supplierId);
    return !p.hasPI || !!p.shippingDocs?.length;
  }

  async get(organizationId: string, id: string) {
    const x = await this.prisma.tradeExtraction.findFirst({ where: { id, organizationId }, select: EXTRACTION_SELECT });
    if (!x) throw new NotFoundException('Extraction not found');
    const checks = (x.checks as unknown as BlCheck[] | null) ?? null;
    return { ...x, issueCount: checks ? issueCount(checks) : null, costUsd: x.inputTokens === null ? null : costUsd(x.inputTokens, x.outputTokens) };
  }

  /** "Acknowledge" on the B/L check: the step chip stops warning; who/when is kept. */
  async acknowledge(organizationId: string, id: string, actor: TradeActor) {
    const x = await this.prisma.tradeExtraction.findFirst({ where: { id, organizationId }, select: { id: true, kind: true, status: true } });
    if (!x) throw new NotFoundException('Extraction not found');
    if (x.kind !== 'BL_DRAFT' || x.status !== 'DONE') throw new BadRequestException('Only a finished B/L draft check can be acknowledged');
    await this.prisma.tradeExtraction.update({ where: { id }, data: { acknowledgedById: actor.id, acknowledgedByName: actor.name, acknowledgedAt: new Date() } });
    return this.get(organizationId, id);
  }

  /**
   * Fill from PI / B/L draft was cancelled: remove the source PDF uploaded for
   * it (DB row, its extraction rows by cascade, S3 object). Only a file that is
   * still unlinked, was read by AI and was uploaded by the same user can go —
   * a PDF saved with a contract/shipment is never touched.
   */
  async discardSource(organizationId: string, fileId: string, actor: TradeActor) {
    const f = await this.prisma.tradeFile.findFirst({
      where: { id: fileId, organizationId },
      select: { id: true, docType: true, uploadedById: true, _count: { select: { links: true, extractions: true } } },
    });
    if (!f) return { id: fileId, deleted: false };
    if (f._count.links > 0) throw new BadRequestException('This PDF is attached to a contract or shipment — it is kept');
    if (!f._count.extractions || !Object.values(DOC_TYPE).includes(f.docType)) throw new BadRequestException('Only an unsaved PI / B/L draft read by AI can be discarded');
    if (actor.id && f.uploadedById !== actor.id) throw new BadRequestException('Only the person who uploaded this PDF can discard it');
    await this.files.remove(organizationId, fileId);
    return { id: fileId, deleted: true };
  }

  // ── helpers ─────────────────────────────────────────────────────────────
  private async stepId(shipmentId: string, code: string) {
    const s = await this.prisma.tradeStep.findFirst({ where: { shipmentId, code }, select: { id: true } });
    return s?.id;
  }

  private async piResult(organizationId: string, raw: unknown) {
    const pi = parseWith(PI_SCHEMA, raw, 'PI');
    const [suppliers, customers] = await Promise.all([
      this.prisma.supplier.findMany({ where: { organizationId }, select: { id: true, name: true } }),
      this.prisma.customer.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    ]);
    const draft = contractDraftFromPi(pi, { suppliers, customers });
    // Premiums are stored as the fixed part: take QMJP (quarter of the PI's pricing month) off the printed premium.
    const ts = await this.prisma.tradeSetting.findUnique({ where: { organizationId }, select: { docDefaults: true } });
    const qmjpByQuarter = ((ts?.docDefaults as { qmjpByQuarter?: Record<string, number> } | null)?.qmjpByQuarter ?? {}) as Record<string, number>;
    draft.lines = draft.lines.map((l) => ({ ...l, supplierPremium: fixedPremiumFromPi(l.piPremium, draft.shipmentMonth, qmjpByQuarter) }));
    const existing = draft.contractNo ? await this.prisma.contract.findFirst({ where: { organizationId, contractNo: draft.contractNo }, select: { id: true, contractNo: true } }) : null;
    // An order already made from this PI (same PI no.) — the New Order form warns instead of creating it twice.
    // Round BF: with its status and who made it, and the orders of the same contract / grade / month without a PI yet.
    const sel = { id: true, orderNo: true, year: true, status: true, isTest: true, piNo: true, grade: true, qtyMt: true, shipMonth: true, createdAt: true, createdById: true };
    const order: PiOrderRow | null = draft.piNumber ? await this.prisma.tradeOrder.findFirst({ where: { organizationId, piNo: draft.piNumber, isTest: false }, orderBy: { createdAt: 'asc' }, select: sel }) : null;
    const sameContract: PiOrderRow[] = existing && !order ? await this.prisma.tradeOrder.findMany({ where: { organizationId, contractId: existing.id, isTest: false, piNo: null }, select: sel }) : [];
    const like = likeOrders(sameContract, { shipmentMonth: draft.shipmentMonth, lines: draft.lines }).slice(0, 3);
    const names = await this.actorNames([order, ...like].map((o) => o?.createdById).filter((x): x is string => !!x));
    return { raw: pi, draft, existingContractId: existing?.id ?? null, existingOrder: order ? toHint(order, names) : null, likeOrders: like.map((o) => toHint(o, names)) };
  }

  /** Round BF: display names of the users who made orders — the name their Activity Log rows carry. */
  private async actorNames(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const id of [...new Set(ids)]) {
      try {
        const r: any = await (this.prisma as any).actionLog?.findFirst?.({ where: { actorId: id, actorName: { not: null } }, orderBy: { createdAt: 'desc' }, select: { actorName: true } });
        if (r?.actorName) out.set(id, r.actorName);
      } catch {
        /* no name — the hint shows the date only */
      }
    }
    return out;
  }

  /** Order PI fields from a read PI — blanks only (PI no. / date / amount / deposit / deposit due). Returns the field names filled. */
  private async fillOrderFromPi(organizationId: string, orderId: string, d: PiFill) {
    const o = await this.prisma.tradeOrder.findFirst({ where: { id: orderId, organizationId }, select: { grade: true, qtyMt: true, piNo: true, piDate: true, piAmount: true, depositPct: true, depositAmount: true, depositDueDate: true } });
    if (!o) return [];
    const data = piFillFor(o, d);
    if (Object.keys(data).length) await this.prisma.tradeOrder.update({ where: { id: orderId, organizationId }, data });
    return Object.keys(data);
  }

  /**
   * Shipment CI fields from a read CI — blanks only (CI no. / amount). Round BJ: the amount is the LATEST CI version's
   * Sub Total (FINAL after PROVISIONAL, later date, "REVISED" file) — reading an older version never fills it.
   */
  private async fillShipmentFromCi(organizationId: string, shipmentId: string, ci: CiRaw, file: { id: string; fileName: string }) {
    const s = await this.prisma.shipment.findFirst({ where: { id: shipmentId, organizationId }, select: { ciNumber: true, ciAmount: true } });
    if (!s) return [];
    const self = ciVersionOf(ci as Record<string, unknown>, { ...file, createdAt: new Date() });
    const latest = latestCi([...(await ciVersionsFor(this.prisma, organizationId, shipmentId)).filter((v) => v.fileId !== file.id), self]);
    const data: Record<string, unknown> = {};
    if (!s.ciNumber && ci.ciNumber) data.ciNumber = ci.ciNumber;
    if (s.ciAmount === null && latest?.fileId === file.id && latest.amount !== null && latest.amount > 0) data.ciAmount = latest.amount;
    if (!Object.keys(data).length) return [];
    // Blank-only even under a concurrent edit (the request itself is in the Activity Log).
    const r = await this.prisma.shipment.updateMany({ where: { id: shipmentId, organizationId, ...(data.ciAmount !== undefined ? { ciAmount: null } : {}), ...(data.ciNumber !== undefined ? { ciNumber: null } : {}) }, data });
    return r.count ? Object.keys(data) : [];
  }

  /** A PDF's text layer through a layout reader; null when there's no text / the reader fails. */
  private async readText(buffer: Buffer, reader: (text: string) => { data: unknown; complete: boolean }) {
    try {
      const text = await pdfText(buffer);
      return text.trim().length > 40 ? reader(text) : null;
    } catch (e) {
      this.logger.warn(`text layer unreadable: ${(e as Error)?.message}`);
      return null;
    }
  }

  /**
   * Arrival notice → draft + the blank shipment fields it can fill, and the
   * step 9 estimator inputs (THC / DOC / EQMC) — offered, the user confirms in
   * the portal ("costs.thc" keys go into Shipment.costs).
   */
  private async anResult(organizationId: string, raw: unknown, input: { shipmentId?: string }, via: 'text' | 'ai' = 'ai') {
    const draft = arrivalNoticeDraft(parseWith(AN_SCHEMA, raw, 'arrival notice'));
    const shipment = input.shipmentId ? await this.prisma.shipment.findFirst({ where: { id: input.shipmentId, organizationId } }) : null;
    const fill: Record<string, unknown> = shipment ? anFillable(draft, shipment as unknown as Record<string, unknown>) : {};
    // ETA: offered whenever it differs (a later A/N moves it; the shipment keeps the history).
    if (shipment && draft.eta && (!shipment.eta || shipment.eta.toISOString().slice(0, 10) !== draft.eta)) fill.eta = draft.eta;
    const costs = (shipment?.costs ?? {}) as ShipmentCosts;
    const inputs = anCostInputs(draft);
    for (const [k, v] of Object.entries(inputs)) if (v !== null && (costs as Record<string, unknown>)[k] !== v) fill[`costs.${k}`] = v;
    const blMismatch = !!(shipment?.blNumber && draft.blNumber && !sameBl(draft.blNumber, shipment.blNumber));
    return { raw, draft, fill, blMismatch, via };
  }

  /**
   * 輸入許可書 → the actual import tax, customs rate, CIF and 加算運賃 for step 10
   * (offered; the user confirms), plus warnings when its B/L or 仕入書番号 don't
   * match the shipment (never blocking). The file name is the last resort for
   * the total ("輸入許可書…_JPY18,386,700_…pdf").
   */
  private async permitResult(organizationId: string, data: PermitData, input: { shipmentId?: string }, fileName: string, via: 'text' | 'ai') {
    const fromName = permitTotalFromFileName(fileName);
    const permit: PermitData = { ...data, total: data.total ?? fromName };
    const shipment = input.shipmentId
      ? await this.prisma.shipment.findFirst({ where: { id: input.shipmentId, organizationId }, select: { id: true, blNumber: true, costs: true } })
      : null;
    const sgjp = shipment
      ? await this.prisma.tradeGeneratedDoc.findFirst({
          where: { organizationId, docType: 'SGJP_IV_PL', OR: [{ shipmentId: shipment.id }, { coversShipmentIds: { has: shipment.id } }] },
          orderBy: [{ status: 'desc' }, { updatedAt: 'desc' }],
          select: { header: true, number: true },
        })
      : null;
    const sgjpNo = String((sgjp?.header as { invoiceNo?: string } | null)?.invoiceNo ?? sgjp?.number ?? '').trim() || null;
    const checks = shipment ? permitChecks(permit, { blNumber: shipment.blNumber, sgjpInvoiceNo: sgjpNo }) : [];
    // The permit's own figures must reproduce with the formula — a misread shows here.
    const recomputed = permit.invoiceAmount !== null && permit.fxRate !== null ? importTax(permit.invoiceAmount, permit.fxRate, permit.addOnJpy ?? 0) : null;
    const formulaOk = recomputed && permit.total !== null ? recomputed.total === permit.total : null;
    const costs = (shipment?.costs ?? {}) as ShipmentCosts;
    const fill: Record<string, unknown> = {};
    const offer = (k: keyof ShipmentCosts, v: number | null) => {
      if (v !== null && (costs as Record<string, unknown>)[k] !== v) fill[`costs.${k}`] = v;
    };
    offer('importTaxActual', permit.total);
    offer('fxRate', permit.fxRate);
    if ((permit.invoiceCurrency ?? 'USD') === 'USD') offer('cifUsd', permit.invoiceAmount);
    offer('customsAddOnJpy', permit.addOnJpy);
    return { permit, totalFrom: data.total !== null ? via : fromName !== null ? 'fileName' : null, checks, formulaOk, recomputed, sgjpInvoiceNo: sgjpNo, fill, via };
  }

  private async blResult(organizationId: string, raw: unknown, input: { shipmentId?: string; contractId?: string }, text = '') {
    // The AI read, with what the text layer states filling its gaps (HS code, origin, containers).
    const bl = withTextFields(parseWith(BL_SCHEMA, raw, 'B/L draft'), text);
    const draft = shipmentDraftFromBl(bl);
    // HS code: the B/L's, else the product's (Clients › Products); a different one is only warned about.
    const productHs = input.shipmentId ? await productHsForShipment(this.prisma, organizationId, input.shipmentId) : null;
    if (draft.hsCode) draft.hsCodeFrom = 'bl';
    else if (productHs) Object.assign(draft, { hsCode: productHs.hsCode, hsCodeFrom: 'product' as const });
    // Contract: the record it was run for, else the one whose number the B/L prints.
    let contractId = input.contractId ?? null;
    if (!contractId && input.shipmentId) {
      contractId = (await this.prisma.shipment.findFirst({ where: { id: input.shipmentId, organizationId }, select: { contractId: true } }))?.contractId ?? null;
    }
    if (!contractId && draft.contractNo) {
      contractId = (await this.prisma.contract.findFirst({ where: { organizationId, contractNo: draft.contractNo }, select: { id: true } }))?.id ?? null;
    }
    const lines: Array<{ id: string; grade: string | null }> = contractId
      ? await this.prisma.contractLine.findMany({ where: { organizationId, contractId }, orderBy: { sortOrder: 'asc' }, select: { id: true, grade: true } })
      : [];
    // Another shipment with this B/L (the one being read for doesn't count — re-reading its own B/L is fine).
    const existingShipment = draft.blNumber
      ? await this.prisma.shipment.findFirst({ where: { organizationId, blNumber: draft.blNumber, ...(input.shipmentId ? { NOT: { id: input.shipmentId } } : {}) }, select: { id: true } })
      : null;
    return {
      raw: bl,
      draft,
      contractId,
      contractLineId: lineForGrade(lines, draft.grade)?.id ?? null,
      existingShipmentId: existingShipment?.id ?? null,
      productHs: productHs?.hsCode ?? null,
      hsWarning: hsWarning(draft.hsCode, productHs?.hsCode),
    };
  }
}

/** Run the B/L checks for a shipment against its contract, line and saved fields. */
export async function computeBlChecks(db: Db, organizationId: string, shipmentId: string, draft: ShipmentDraft): Promise<BlCheck[]> {
  const s = await db.shipment.findFirst({
    where: { id: shipmentId, organizationId },
    select: {
      id: true,
      contractLineId: true,
      blNumber: true,
      shippingLine: true,
      vessel: true,
      voyageNo: true,
      etd: true,
      portOfLoading: true,
      portOfDischarge: true,
      netWeightMt: true,
      grossWeightMt: true,
      totalBundles: true,
      totalPieces: true,
      containerCount: true,
      hsCode: true,
      countryOfOrigin: true,
      orderId: true,
      contract: { select: { contractNo: true, consignee: true, notifyParty: true, destinationPort: true } },
      contractLine: { select: { id: true, grade: true, quantityMt: true, tolerancePct: true } },
      order: { select: { grade: true, qtyMt: true, tolPct: true, consignee: true, notifyParty: true, destinationPort: true, contract: { select: { contractNo: true } } } },
    },
  });
  if (!s) return [];
  // Under an order: its B/L instructions, product and quantity (shipped elsewhere = its other shipments); else the contract line's.
  const others: Array<{ netWeightMt: unknown }> = s.orderId
    ? await db.shipment.findMany({ where: { organizationId, orderId: s.orderId, NOT: { id: s.id } }, select: { netWeightMt: true } })
    : s.contractLineId
      ? await db.shipment.findMany({ where: { organizationId, contractLineId: s.contractLineId, NOT: { id: s.id } }, select: { netWeightMt: true } })
      : [];
  const shipped = others.reduce((n, o) => n + (Number(o.netWeightMt) || 0), 0);
  const { contract, contractLine, order, orderId: _o, ...fields } = s;
  void _o;
  const terms = order
    ? { contractNo: order.contract?.contractNo ?? contract?.contractNo ?? '', consignee: order.consignee, notifyParty: order.notifyParty, destinationPort: order.destinationPort }
    : contract;
  const line = order ? { grade: order.grade, quantityMt: order.qtyMt, tolerancePct: order.tolPct } : contractLine;
  return blDraftChecks({ draft, contract: terms, line, lineShippedElsewhereMt: shipped, shipment: fields as any });
}

/**
 * The shipment's B/L draft check for its detail page: the newest finished
 * extraction of a BL_DRAFT file linked to it, re-checked against the
 * shipment as it is now (stored checks are refreshed when they changed).
 */
export async function latestBlCheck(db: Db, organizationId: string, shipmentId: string) {
  const x = await db.tradeExtraction.findFirst({
    where: { organizationId, kind: 'BL_DRAFT', status: 'DONE', OR: [{ shipmentId }, { file: { links: { some: { shipmentId } } } }] },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      fileId: true,
      result: true,
      checks: true,
      model: true,
      createdAt: true,
      acknowledgedByName: true,
      acknowledgedAt: true,
      shipmentId: true,
      file: { select: { fileName: true } },
    },
  });
  if (!x) return null;
  const draft = (x.result as { draft?: ShipmentDraft } | null)?.draft;
  if (!draft) return null;
  const checks = await computeBlChecks(db, organizationId, shipmentId, draft);
  if (JSON.stringify(checks) !== JSON.stringify(x.checks) || x.shipmentId !== shipmentId) {
    await db.tradeExtraction.update({ where: { id: x.id }, data: { checks: checks as any, shipmentId } });
  }
  return {
    extractionId: x.id,
    fileId: x.fileId,
    fileName: x.file?.fileName ?? null,
    extractedAt: x.createdAt,
    model: x.model,
    checks,
    issueCount: issueCount(checks),
    acknowledgedByName: x.acknowledgedByName,
    acknowledgedAt: x.acknowledgedAt,
    containers: draft.containers,
  };
}

/** A spreadsheet's first sheet as tab-separated text (Vedanta's .XLS is already text; .xlsx is parsed). */
export function sheetText(buffer: Buffer): string {
  const head = buffer.subarray(0, 4).toString('latin1');
  if (head.startsWith('PK') || head.startsWith('\xD0\xCF')) {
    try {
      const wb = XLSX.read(buffer, { type: 'buffer', sheetRows: 30 });
      const ws = wb.Sheets[wb.SheetNames[0]];
      return ws ? XLSX.utils.sheet_to_csv(ws, { FS: '\t' }) : '';
    } catch {
      return '';
    }
  }
  return buffer.subarray(0, 20000).toString('utf8');
}

/** What a read PI gives an order (ContractDraft's PI fields). */
export type PiFill = { piNumber?: string | null; piDate?: string | null; piAmount?: number | null; depositAmount?: number | null; depositDueDate?: string | null; lines?: Array<{ grade: string | null; quantityMt: number | null; amount?: number | null; amountPayable?: number | null }> };

/**
 * Round BP — the order's PI fields from a read PI, BLANKS ONLY: PI no. / date; the amount and the deposit (Amount
 * Payable) of the order's OWN line on a PI shared by several orders (PI 9331004393: #30 → 359,000.00 / 35,900.00,
 * #31 → 711,000.00 / 71,100.00), the PI totals on a one-line PI; the deposit due = "Instrument to be received by".
 * Without a printed Amount Payable the deposit stays the order's % of the amount (as before).
 */
export function piFillFor(
  o: { grade: string | null; qtyMt: unknown; piNo: string | null; piDate: Date | null; piAmount: unknown; depositPct: unknown; depositAmount: unknown; depositDueDate: Date | null },
  d: PiFill,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const iso = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  if (!o.piNo && d.piNumber) data.piNo = d.piNumber;
  const piDate = iso(d.piDate);
  if (!o.piDate && piDate && !tradeDateError(piDate, 'piDate')) data.piDate = new Date(piDate);
  const lines = d.lines ?? [];
  const line = lines.length ? piLineForOrder(lines, o) : null;
  // A shared PI whose line for this order can't be told apart: its totals would be wrong for the order — leave them.
  const shared = lines.length > 1;
  const amount = line?.amount ?? (shared ? null : (d.piAmount ?? null));
  const payable = line?.amountPayable ?? (shared ? null : (d.depositAmount ?? null));
  if ((o.piAmount === null || o.piAmount === undefined) && typeof amount === 'number' && amount > 0) data.piAmount = amount;
  if (o.depositAmount === null || o.depositAmount === undefined) {
    if (typeof payable === 'number' && payable > 0) data.depositAmount = payable;
    else if (typeof data.piAmount === 'number') data.depositAmount = depositOf(data.piAmount, Number(o.depositPct ?? 10));
  }
  const due = iso(d.depositDueDate);
  if (!o.depositDueDate && due && !tradeDateError(due, 'depositDueDate')) data.depositDueDate = new Date(due);
  return data;
}
