import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import { AddTradeFileLinksDto, ListTradeFilesQuery, UploadTradeFileDto } from './dto/trade-file.dto';
import { TradeActor } from './shipments.request';
import { decodeUploadName, isUuid, parseIdList, resolveTradeFileMime, sanitizeFileName, TRADE_FILE_MAX_BYTES } from './shipments.rules';
import { Db, optText, pageArgs, RemovalOwner, TradeConfigService, TradeOwner } from './trade-config.service';
import { TradeThumbsService } from './trade-thumbs.service';

const SIGNED_URL_TTL = 600; // 10 minutes

const LINK_SELECT = {
  id: true,
  contractId: true,
  shipmentId: true,
  stepId: true,
  createdAt: true,
  contract: { select: { contractNo: true } },
  shipment: { select: { blNumber: true } },
};

interface Targets {
  contracts: Array<{ id: string; contractNo: string }>;
  shipments: Array<{ id: string; blNumber: string | null }>;
  step: { id: string; contractId: string | null; shipmentId: string | null } | null;
}

/**
 * Trade documents: typed S3 uploads that link to any number of contracts and
 * shipments. Keys are built server-side under shipments/{orgId}/ and only the
 * key is stored; downloads go through short-lived signed URLs.
 */
@Injectable()
export class TradeFilesService {
  private readonly logger = new Logger(TradeFilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly config: TradeConfigService,
    private readonly thumbs: TradeThumbsService,
  ) {}

  static keyPrefix(organizationId: string) {
    return `shipments/${organizationId}/`;
  }

  /** `opts.docRef`: the in-app document's ID for its finalized PDF (otherwise the next free one is assigned). */
  async upload(organizationId: string, file: Express.Multer.File | undefined, dto: UploadTradeFileDto, actor: TradeActor, opts: { docRef?: string | null } = {}) {
    if (!file) throw new BadRequestException('Please attach a file');
    const fileName = decodeUploadName(file.originalname || 'upload');
    const mimeType = resolveTradeFileMime(fileName, file.mimetype);
    if (!mimeType) throw new BadRequestException(`File type not allowed: ${fileName}`);
    if (file.size > TRADE_FILE_MAX_BYTES) throw new BadRequestException('File is larger than 25 MB');
    const docType = (dto.docType || '').trim();
    const contractIds = parseIdList(dto.contractIds);
    const shipmentIds = parseIdList(dto.shipmentIds);

    // Validate before touching S3 so a bad request stores nothing.
    await this.config.assertActiveDocType(organizationId, docType);
    await this.resolveTargets(this.prisma, organizationId, contractIds, shipmentIds, dto.stepId);

    const fileId = randomUUID();
    const key = `${TradeFilesService.keyPrefix(organizationId)}${new Date().getUTCFullYear()}/${fileId}_${sanitizeFileName(fileName)}`;
    try {
      await this.s3.uploadFile(key, file.buffer, mimeType);
    } catch (e) {
      this.logger.error(`S3 upload failed for ${key}: ${(e as Error)?.message}`);
      throw new HttpException(`Could not store the file: ${(e as Error)?.message || 'storage error'}`, HttpStatus.BAD_GATEWAY);
    }

    let owners: TradeOwner[] = [];
    let docRef: string | null = null;
    try {
      await this.prisma.$transaction(async (tx: Db) => {
        // Re-check inside the transaction: a record may have closed meanwhile.
        await this.config.assertActiveDocType(organizationId, docType, tx);
        const targets = await this.resolveTargets(tx, organizationId, contractIds, shipmentIds, dto.stepId);
        owners = ownersOfTargets(targets);
        // Document ID from the record it was uploaded for (the step's record, else the first shipment / contract).
        const refOwner: TradeOwner | undefined = targets.step
          ? targets.step.shipmentId
            ? { shipmentId: targets.step.shipmentId }
            : { contractId: targets.step.contractId! }
          : (owners.find((o) => o.shipmentId) ?? owners[0]);
        docRef = opts.docRef ?? (refOwner ? await this.config.docRefFor(tx, organizationId, refOwner, docType) : null);
        await tx.tradeFile.create({
          data: {
            id: fileId,
            organizationId,
            docType,
            s3Key: key,
            fileName,
            mimeType,
            sizeBytes: file.size,
            uploadedById: actor.id ?? 'unknown',
            uploadedByName: actor.name,
            notes: optText(dto.notes) ?? null,
            docRef,
          },
        });
        const links = this.linkRows(organizationId, fileId, targets, new Set());
        if (links.length) await tx.tradeFileLink.createMany({ data: links });
      });
    } catch (e) {
      // No DB row was written; don't leave the object behind either.
      await this.s3.deleteFile(key).catch((err) => this.logger.warn(`Could not remove orphan upload ${key}: ${err?.message}`));
      throw e;
    }
    // Best effort: a file that can't be rendered just shows its type icon.
    await this.thumbs.make(organizationId, fileId, file.buffer);
    // Steps that now have every required document complete by themselves.
    const completedSteps = await this.config.syncSteps(this.prisma, organizationId, owners, actor, { docTypes: [docType] });
    return { ...(await this.getById(organizationId, fileId)), completedSteps };
  }

  async list(organizationId: string, query: ListTradeFilesQuery) {
    const { page, pageSize, skip, take } = pageArgs(query.page, query.pageSize);
    const and: Record<string, unknown>[] = [];
    if (query.contractId) and.push({ links: { some: { contractId: query.contractId } } });
    if (query.shipmentId) and.push({ links: { some: { shipmentId: query.shipmentId } } });
    if (query.customerId) {
      and.push({
        links: {
          some: { OR: [{ contract: { customerId: query.customerId } }, { shipment: { customerId: query.customerId } }] },
        },
      });
    }
    const createdAt: Record<string, Date> = {};
    if (query.from) createdAt.gte = parseDay(query.from, 'from');
    if (query.to) {
      const to = parseDay(query.to, 'to');
      // A bare date means "through the end of that day".
      if (/^\d{4}-\d{2}-\d{2}$/.test(query.to)) createdAt.lt = new Date(to.getTime() + 86_400_000);
      else createdAt.lte = to;
    }
    const q = query.q?.trim();
    const where = {
      organizationId,
      ...(query.docType ? { docType: query.docType } : {}),
      // Search by file name or document ID ("454003255-1-PL").
      ...(q ? { OR: [{ fileName: { contains: q, mode: 'insensitive' as const } }, { docRef: { contains: q, mode: 'insensitive' as const } }] } : {}),
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
      ...(and.length ? { AND: and } : {}),
    };
    const [rows, total, labels] = await Promise.all([
      this.prisma.tradeFile.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: this.fileSelect(),
      }),
      this.prisma.tradeFile.count({ where }),
      this.config.docTypeLabels(organizationId),
    ]);
    const items = rows.map((f) => shapeFile(f, labels));
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getById(organizationId: string, id: string) {
    const [f, labels] = await Promise.all([this.prisma.tradeFile.findFirst({ where: { id, organizationId }, select: this.fileSelect() }), this.config.docTypeLabels(organizationId)]);
    if (!f) throw new NotFoundException('File not found');
    return shapeFile(f, labels);
  }

  /** Short-lived download URL; the key must sit under this org's prefix (as orders.service does). */
  async getUrl(organizationId: string, id: string) {
    const f = await this.prisma.tradeFile.findFirst({
      where: { id, organizationId },
      select: { s3Key: true, fileName: true, mimeType: true },
    });
    if (!f) throw new NotFoundException('File not found');
    if (!f.s3Key.startsWith(TradeFilesService.keyPrefix(organizationId))) {
      throw new ForbiddenException('File not in this organization');
    }
    const url = await this.s3.getSignedUrl(f.s3Key, SIGNED_URL_TTL);
    return { url, fileName: f.fileName, mimeType: f.mimeType, expiresIn: SIGNED_URL_TTL };
  }

  async addLinks(organizationId: string, id: string, dto: AddTradeFileLinksDto, actor: TradeActor | null = null) {
    const contractIds = parseIdList(dto.contractIds);
    const shipmentIds = parseIdList(dto.shipmentIds);
    if (!contractIds.length && !shipmentIds.length && !dto.stepId) {
      throw new BadRequestException('Give at least one contract, shipment or step to link');
    }
    let owners: TradeOwner[] = [];
    let docType = '';
    await this.prisma.$transaction(async (tx: Db) => {
      const f = await tx.tradeFile.findFirst({
        where: { id, organizationId },
        select: { id: true, docType: true, links: { select: { id: true, contractId: true, shipmentId: true, stepId: true } } },
      });
      if (!f) throw new NotFoundException('File not found');
      const targets = await this.resolveTargets(tx, organizationId, contractIds, shipmentIds, dto.stepId);
      owners = ownersOfTargets(targets);
      docType = f.docType;
      const existing = new Set<string>(f.links.map((l: { contractId: string | null; shipmentId: string | null }) => l.contractId ?? l.shipmentId));
      const rows = this.linkRows(organizationId, id, targets, existing);
      if (rows.length) await tx.tradeFileLink.createMany({ data: rows });
      if (owners[0]) await this.config.ensureFileDocRef(tx, organizationId, id, owners.find((o) => o.shipmentId) ?? owners[0]);
      // Already linked to the step's parent: just tag that link with the step.
      if (targets.step) {
        const ownerId = targets.step.contractId ?? targets.step.shipmentId;
        const link = f.links.find((l: { contractId: string | null; shipmentId: string | null }) => (l.contractId ?? l.shipmentId) === ownerId);
        if (link && link.stepId !== targets.step.id) {
          await tx.tradeFileLink.update({ where: { id: link.id, organizationId }, data: { stepId: targets.step.id } });
        }
      }
    });
    const completedSteps = await this.config.syncSteps(this.prisma, organizationId, owners, actor, { docTypes: [docType] });
    return { ...(await this.getById(organizationId, id)), completedSteps };
  }

  /** Signed URL of the file's thumbnail ({ url: null } when it has none). */
  thumbUrl(organizationId: string, id: string) {
    return this.thumbs.url(organizationId, id);
  }

  async removeLink(organizationId: string, fileId: string, linkId: string) {
    await this.prisma.$transaction(async (tx: Db) => {
      const link = await tx.tradeFileLink.findFirst({
        where: { id: linkId, fileId, organizationId },
        select: {
          id: true,
          contractId: true,
          shipmentId: true,
          contract: { select: { contractNo: true, status: true } },
          shipment: { select: { blNumber: true, status: true } },
        },
      });
      if (!link) throw new NotFoundException('Link not found on this file');
      await this.config.assertRemovalKeepsDoneSteps(tx, organizationId, [ownerOf(link)], { fileId }, 'unlink this document');
      await tx.tradeFileLink.delete({ where: { id: linkId, organizationId } });
    });
    return this.getById(organizationId, fileId);
  }

  async remove(organizationId: string, id: string) {
    let thumbKey: string | null = null;
    const key = await this.prisma.$transaction(async (tx: Db) => {
      const f = await tx.tradeFile.findFirst({
        where: { id, organizationId },
        select: {
          s3Key: true,
          thumbKey: true,
          links: {
            select: {
              contractId: true,
              shipmentId: true,
              contract: { select: { contractNo: true, status: true } },
              shipment: { select: { blNumber: true, status: true } },
            },
          },
        },
      });
      if (!f) throw new NotFoundException('File not found');
      await this.config.assertRemovalKeepsDoneSteps(tx, organizationId, f.links.map(ownerOf), { fileId: id }, 'delete this document');
      await tx.tradeFile.delete({ where: { id, organizationId } }); // links cascade
      thumbKey = f.thumbKey;
      return f.s3Key as string;
    });
    await this.thumbs.removeObject(thumbKey);
    try {
      await this.s3.deleteFile(key);
    } catch (e) {
      this.logger.warn(`Trade file ${id} deleted but S3 object ${key} could not be removed: ${(e as Error)?.message}`);
    }
    return { id, deleted: true };
  }

  // ── helpers ─────────────────────────────────────────────────────────────
  private fileSelect() {
    return {
      id: true,
      docType: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      uploadedById: true,
      uploadedByName: true,
      notes: true,
      thumbKey: true,
      docRef: true,
      createdAt: true,
      links: { orderBy: { createdAt: 'asc' as const }, select: LINK_SELECT },
    };
  }

  /**
   * Validate link targets: ids are UUIDs, belong to the org, and are OPEN
   * (completed/cancelled records take no new documents until reopened). A
   * stepId adds its own contract/shipment to the targets.
   */
  async resolveTargets(db: Db, organizationId: string, contractIds: string[], shipmentIds: string[], stepId?: string): Promise<Targets> {
    const bad = [...contractIds, ...shipmentIds].filter((x) => !isUuid(x));
    if (bad.length) throw new BadRequestException(`Invalid id(s): ${bad.join(', ')}`);
    const cIds = new Set(contractIds);
    const sIds = new Set(shipmentIds);
    let step: Targets['step'] = null;
    if (stepId) {
      step = await db.tradeStep.findFirst({ where: { id: stepId, organizationId }, select: { id: true, contractId: true, shipmentId: true } });
      if (!step) throw new BadRequestException('Step not found in this organization');
      if (step.contractId) cIds.add(step.contractId);
      if (step.shipmentId) sIds.add(step.shipmentId);
    }
    const contracts: Array<{ id: string; contractNo: string; status: string }> = cIds.size
      ? await db.contract.findMany({ where: { organizationId, id: { in: [...cIds] } }, select: { id: true, contractNo: true, status: true } })
      : [];
    const shipments: Array<{ id: string; blNumber: string | null; status: string }> = sIds.size
      ? await db.shipment.findMany({ where: { organizationId, id: { in: [...sIds] } }, select: { id: true, blNumber: true, status: true } })
      : [];
    if (contracts.length !== cIds.size) throw new BadRequestException('One or more contracts were not found in this organization');
    if (shipments.length !== sIds.size) throw new BadRequestException('One or more shipments were not found in this organization');
    const closed = [
      ...contracts.filter((c) => c.status !== 'OPEN').map((c) => `contract ${c.contractNo} (${c.status.toLowerCase()})`),
      ...shipments.filter((s) => s.status !== 'OPEN').map((s) => `shipment ${s.blNumber ?? '(no B/L)'} (${s.status.toLowerCase()})`),
    ];
    if (closed.length) throw new BadRequestException(`Reopen before adding documents: ${closed.join(', ')}`);
    return { contracts, shipments, step };
  }

  /** One link row per target not already linked; each has exactly one of contractId / shipmentId. */
  private linkRows(organizationId: string, fileId: string, t: Targets, existing: Set<string>) {
    const stepFor = (ownerId: string) => (t.step && (t.step.contractId ?? t.step.shipmentId) === ownerId ? t.step.id : null);
    return [
      ...t.contracts.filter((c) => !existing.has(c.id)).map((c) => ({ organizationId, fileId, contractId: c.id, shipmentId: null, stepId: stepFor(c.id) })),
      ...t.shipments.filter((s) => !existing.has(s.id)).map((s) => ({ organizationId, fileId, contractId: null, shipmentId: s.id, stepId: stepFor(s.id) })),
    ];
  }


}

/** API shape of a file row: the doc type's label, and hasThumb instead of the storage key. */
function shapeFile<F extends { docType: string; thumbKey?: string | null }>(f: F, labels: Map<string, string>) {
  const { thumbKey, ...rest } = f;
  return { ...rest, docTypeLabel: labels.get(f.docType) ?? f.docType, hasThumb: !!thumbKey };
}

/** The contracts / shipments a file was just linked to. */
export const ownersOfTargets = (t: Targets): TradeOwner[] => [...t.contracts.map((c) => ({ contractId: c.id })), ...t.shipments.map((s) => ({ shipmentId: s.id }))];

export function ownerOf(link: {
  contractId: string | null;
  shipmentId: string | null;
  contract?: { contractNo: string; status: string } | null;
  shipment?: { blNumber: string | null; status: string } | null;
}): RemovalOwner {
  return link.contractId
    ? { contractId: link.contractId, label: `contract ${link.contract?.contractNo}`, status: link.contract?.status ?? 'OPEN' }
    : { shipmentId: link.shipmentId!, label: `shipment ${link.shipment?.blNumber ?? '(no B/L)'}`, status: link.shipment?.status ?? 'OPEN' };
}

function parseDay(v: string, name: string): Date {
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new BadRequestException(`${name} is not a valid date`);
  return d;
}
