import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import { DocumentExtractionService } from '../document-extraction/document-extraction.service';
import { TradeActor } from './shipments.request';
import { Db } from './trade-config.service';
import {
  AN_SCHEMA,
  AN_SYSTEM_PROMPT,
  AN_USER_PROMPT,
  anFillable,
  arrivalNoticeDraft,
  BL_SCHEMA,
  BL_SYSTEM_PROMPT,
  BL_USER_PROMPT,
  blDraftChecks,
  BlCheck,
  contractDraftFromPi,
  issueCount,
  lineForGrade,
  parseWith,
  PI_SCHEMA,
  PI_SYSTEM_PROMPT,
  PI_USER_PROMPT,
  ShipmentDraft,
  shipmentDraftFromBl,
} from './trade-extract.rules';
import { TradeFilesService } from './trade-files.service';

export type ExtractKind = 'PI' | 'BL_DRAFT' | 'AN';
const DOC_TYPE: Record<ExtractKind, string> = { PI: 'PI', BL_DRAFT: 'BL_DRAFT', AN: 'ARRIVAL_NOTICE' };
/** The step a newly uploaded source PDF is tagged with. */
const STEP_CODE: Partial<Record<ExtractKind, string>> = { BL_DRAFT: 'BL_DRAFT_APPROVAL', AN: 'AN_INSTRUCTIONS' };
const PROMPTS: Record<ExtractKind, [string, string]> = {
  PI: [PI_SYSTEM_PROMPT, PI_USER_PROMPT],
  BL_DRAFT: [BL_SYSTEM_PROMPT, BL_USER_PROMPT],
  AN: [AN_SYSTEM_PROMPT, AN_USER_PROMPT],
};
const READABLE = /^(application\/pdf|image\/(png|jpe?g|webp))$/;

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
  ) {}

  async extract(organizationId: string, kind: ExtractKind, input: { file?: Express.Multer.File; fileId?: string; shipmentId?: string; contractId?: string }, actor: TradeActor) {
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
    const file = await this.prisma.tradeFile.findFirst({ where: { id: fileId, organizationId }, select: { id: true, docType: true, s3Key: true, mimeType: true, fileName: true } });
    if (!file) throw new NotFoundException('File not found');
    if (file.docType !== DOC_TYPE[kind]) throw new BadRequestException(`${file.fileName} is filed as ${file.docType}, not ${DOC_TYPE[kind]}`);
    if (!READABLE.test(file.mimeType)) throw new BadRequestException(`${file.fileName} is not a PDF or image the reader can open`);

    const row = await this.prisma.tradeExtraction.create({
      data: { organizationId, fileId, kind, status: 'PENDING', shipmentId: input.shipmentId ?? null, contractId: input.contractId ?? null, createdById: actor.id ?? 'unknown' },
      select: { id: true },
    });

    // 2. Read it (synchronous: a PI / B/L page takes ~10–30 s).
    const started = Date.now();
    try {
      const buffer = await this.s3.downloadFile(file.s3Key);
      const out = await this.extractor.extractStructured({ buffer, mimetype: file.mimeType }, PROMPTS[kind][0], PROMPTS[kind][1], {
        maxTokens: 4000,
      });
      const result =
        kind === 'PI' ? await this.piResult(organizationId, out.data) : kind === 'AN' ? await this.anResult(organizationId, out.data, input) : await this.blResult(organizationId, out.data, input);
      const checks = kind === 'BL_DRAFT' && input.shipmentId ? await computeBlChecks(this.prisma, organizationId, input.shipmentId, result.draft as ShipmentDraft) : null;
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
    const existing = draft.contractNo ? await this.prisma.contract.findFirst({ where: { organizationId, contractNo: draft.contractNo }, select: { id: true, contractNo: true } }) : null;
    return { raw: pi, draft, existingContractId: existing?.id ?? null };
  }

  /** Arrival notice → draft + the blank shipment fields it can fill (the user confirms in the portal). */
  private async anResult(organizationId: string, raw: unknown, input: { shipmentId?: string }) {
    const draft = arrivalNoticeDraft(parseWith(AN_SCHEMA, raw, 'arrival notice'));
    const shipment = input.shipmentId ? await this.prisma.shipment.findFirst({ where: { id: input.shipmentId, organizationId } }) : null;
    const fill = shipment ? anFillable(draft, shipment as unknown as Record<string, unknown>) : {};
    const blMismatch = !!(shipment?.blNumber && draft.blNumber && shipment.blNumber !== draft.blNumber);
    return { raw, draft, fill, blMismatch };
  }

  private async blResult(organizationId: string, raw: unknown, input: { shipmentId?: string; contractId?: string }) {
    const bl = parseWith(BL_SCHEMA, raw, 'B/L draft');
    const draft = shipmentDraftFromBl(bl);
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
    const existingShipment = draft.blNumber ? await this.prisma.shipment.findFirst({ where: { organizationId, blNumber: draft.blNumber }, select: { id: true } }) : null;
    return { raw: bl, draft, contractId, contractLineId: lineForGrade(lines, draft.grade)?.id ?? null, existingShipmentId: existingShipment?.id ?? null };
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
      contract: { select: { contractNo: true, consignee: true, notifyParty: true, destinationPort: true } },
      contractLine: { select: { id: true, grade: true, quantityMt: true, tolerancePct: true } },
    },
  });
  if (!s) return [];
  const others: Array<{ netWeightMt: unknown }> = s.contractLineId
    ? await db.shipment.findMany({ where: { organizationId, contractLineId: s.contractLineId, NOT: { id: s.id } }, select: { netWeightMt: true } })
    : [];
  const shipped = others.reduce((n, o) => n + (Number(o.netWeightMt) || 0), 0);
  const { contract, contractLine, ...fields } = s;
  return blDraftChecks({ draft, contract, line: contractLine, lineShippedElsewhereMt: shipped, shipment: fields as any });
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
