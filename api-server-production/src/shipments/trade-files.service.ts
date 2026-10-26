import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import { AddTradeFileLinksDto, ListTradeFilesQuery, UploadTradeFileDto } from './dto/trade-file.dto';
import { TradeActor } from './shipments.request';
import { decodeUploadName, isUuid, parseIdList, resolveTradeFileMime, sanitizeFileName, TRADE_FILE_MAX_BYTES } from './shipments.rules';
import { Db, optText, ownerIdOf, pageArgs, RemovalOwner, toOwner, TradeConfigService, TradeOwner } from './trade-config.service';
import { TradeThumbsService } from './trade-thumbs.service';
import { folderFileNames, shipmentFolderName } from './trade-folder';

const SIGNED_URL_TTL = 600; // 10 minutes

const LINK_SELECT = {
  id: true,
  contractId: true,
  shipmentId: true,
  orderId: true,
  supplierOrderId: true,
  stepId: true,
  createdAt: true,
  contract: { select: { contractNo: true } },
  shipment: { select: { blNumber: true, seqNo: true, order: { select: { orderNo: true } } } },
  order: { select: { orderNo: true, year: true } },
  supplierOrder: { select: { soNo: true, year: true, piNo: true } },
};

interface Targets {
  contracts: Array<{ id: string; contractNo: string }>;
  shipments: Array<{ id: string; blNumber: string | null }>;
  orders: Array<{ id: string; orderNo: number }>;
  supplierOrders: Array<{ id: string; soNo: number }>;
  step: { id: string; contractId: string | null; shipmentId: string | null; orderId: string | null; supplierOrderId: string | null } | null;
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
  async upload(
    organizationId: string,
    file: Express.Multer.File | undefined,
    dto: UploadTradeFileDto,
    actor: TradeActor,
    opts: { docRef?: string | null; source?: 'UPLOAD' | 'GENERATED' | 'EMAIL'; emailLogId?: string | null; sha256?: string | null; completedShipmentsOk?: boolean } = {},
  ) {
    if (!file) throw new BadRequestException('Please attach a file');
    const fileName = decodeUploadName(file.originalname || 'upload');
    const mimeType = resolveTradeFileMime(fileName, file.mimetype);
    if (!mimeType) throw new BadRequestException(`File type not allowed: ${fileName}`);
    if (file.size > TRADE_FILE_MAX_BYTES) throw new BadRequestException('File is larger than 25 MB');
    const docType = (dto.docType || '').trim();
    const contractIds = parseIdList(dto.contractIds);
    const shipmentIds = parseIdList(dto.shipmentIds);
    const orderIds = parseIdList(dto.orderIds);
    const supplierOrderIds = parseIdList(dto.supplierOrderIds);

    // Validate before touching S3 so a bad request stores nothing.
    await this.config.assertActiveDocType(organizationId, docType);
    await this.resolveTargets(this.prisma, organizationId, contractIds, shipmentIds, dto.stepId, orderIds, supplierOrderIds, opts.completedShipmentsOk);

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
        const targets = await this.resolveTargets(tx, organizationId, contractIds, shipmentIds, dto.stepId, orderIds, supplierOrderIds, opts.completedShipmentsOk);
        owners = ownersOfTargets(targets);
        // Document ID from the record it was uploaded for (the step's record, else the first shipment / order / supplier order / contract).
        const refOwner: TradeOwner | undefined = targets.step
          ? toOwner(targets.step)
          : (owners.find((o) => o.shipmentId) ?? owners.find((o) => o.orderId) ?? owners.find((o) => o.supplierOrderId) ?? owners[0]);
        // Replace keeps the replaced file's ID (same type, same org); a genuinely new file gets the next one.
        const replaced = dto.replacesFileId
          ? await tx.tradeFile.findFirst({ where: { id: dto.replacesFileId, organizationId, docType }, select: { docRef: true } })
          : null;
        docRef = opts.docRef ?? replaced?.docRef ?? (refOwner ? await this.config.docRefFor(tx, organizationId, refOwner, docType) : null);
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
            source: opts.source ?? 'UPLOAD',
            emailLogId: opts.emailLogId ?? null,
            sha256: opts.sha256 ?? sha256Of(file.buffer),
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
    if (query.orderId) and.push({ links: { some: { OR: [{ orderId: query.orderId }, { shipment: { orderId: query.orderId } }] } } });
    if (query.supplierOrderId) and.push({ links: { some: { supplierOrderId: query.supplierOrderId } } });
    if (query.customerId) {
      and.push({
        links: {
          some: { OR: [{ contract: { customerId: query.customerId } }, { shipment: { customerId: query.customerId } }, { order: { customerId: query.customerId } }] },
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

  /**
   * "Download shipment folder (.zip)": every file linked to the shipment, in a
   * folder named after ADH's sheet ("6063-8inch_Sep_198GX04630_305.804_Yokohama_454003422"),
   * each file named "{folder}_{document ID}.{ext}". (SharePoint sync: later phase.)
   */
  async shipmentZip(organizationId: string, shipmentId: string): Promise<{ name: string; buffer: Buffer; count: number }> {
    const s = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, organizationId },
      select: {
        blNumber: true,
        netWeightMt: true,
        portOfDischarge: true,
        sizeSpec: true,
        deliveryMonth: true,
        contract: { select: { contractNo: true } },
        order: { select: { grade: true, size: true, deliveryMonth: true } },
        fileLinks: { where: { hiddenAt: null }, orderBy: { createdAt: 'asc' }, select: { file: { select: { id: true, s3Key: true, fileName: true, docType: true, docRef: true } } } },
      },
    });
    if (!s) throw new NotFoundException('Shipment not found');
    const folder =
      shipmentFolderName({
        grade: s.order?.grade,
        size: s.order?.size ?? s.sizeSpec,
        deliveryMonth: s.order?.deliveryMonth ?? s.deliveryMonth,
        blNumber: s.blNumber,
        netWeightMt: s.netWeightMt === null ? null : Number(s.netWeightMt),
        portOfDischarge: s.portOfDischarge,
        contractNo: s.contract?.contractNo,
      }) || `shipment-${shipmentId.slice(0, 8)}`;
    const files = s.fileLinks.map((l: { file: { id: string; s3Key: string; fileName: string; docType: string; docRef: string | null } }) => l.file);
    const names = folderFileNames(folder, files);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    for (const [i, f] of files.entries()) {
      if (!f.s3Key.startsWith(TradeFilesService.keyPrefix(organizationId))) continue;
      zip.addFile(`${folder}/${names[i]}`, await this.s3.downloadFile(f.s3Key));
    }
    return { name: `${folder}.zip`, buffer: zip.toBuffer(), count: files.length };
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

  /** The file's bytes, for the in-app viewer (pdf.js renders them; no cross-origin fetch of the signed URL). */
  async getContent(organizationId: string, id: string) {
    const f = await this.prisma.tradeFile.findFirst({ where: { id, organizationId }, select: { s3Key: true, fileName: true, mimeType: true } });
    if (!f) throw new NotFoundException('File not found');
    if (!f.s3Key.startsWith(TradeFilesService.keyPrefix(organizationId))) throw new ForbiddenException('File not in this organization');
    return { buffer: await this.s3.downloadFile(f.s3Key), fileName: f.fileName, mimeType: f.mimeType };
  }

  async addLinks(organizationId: string, id: string, dto: AddTradeFileLinksDto, actor: TradeActor | null = null, opts: { completedShipmentsOk?: boolean } = {}) {
    const contractIds = parseIdList(dto.contractIds);
    const shipmentIds = parseIdList(dto.shipmentIds);
    const orderIds = parseIdList(dto.orderIds);
    const supplierOrderIds = parseIdList(dto.supplierOrderIds);
    if (!contractIds.length && !shipmentIds.length && !orderIds.length && !supplierOrderIds.length && !dto.stepId) {
      throw new BadRequestException('Give at least one order, shipment or step to link');
    }
    let owners: TradeOwner[] = [];
    let docType = '';
    await this.prisma.$transaction(async (tx: Db) => {
      const f = await tx.tradeFile.findFirst({
        where: { id, organizationId },
        select: { id: true, docType: true, links: { select: { id: true, contractId: true, shipmentId: true, orderId: true, supplierOrderId: true, stepId: true } } },
      });
      if (!f) throw new NotFoundException('File not found');
      const targets = await this.resolveTargets(tx, organizationId, contractIds, shipmentIds, dto.stepId, orderIds, supplierOrderIds, opts.completedShipmentsOk);
      owners = ownersOfTargets(targets);
      docType = f.docType;
      const existing = new Set<string>(f.links.map((l: { contractId: string | null; shipmentId: string | null; orderId: string | null; supplierOrderId: string | null }) => ownerIdOf(l)));
      const rows = this.linkRows(organizationId, id, targets, existing);
      if (rows.length) await tx.tradeFileLink.createMany({ data: rows });
      if (owners[0])
        await this.config.ensureFileDocRef(tx, organizationId, id, owners.find((o) => o.shipmentId) ?? owners.find((o) => o.orderId) ?? owners.find((o) => o.supplierOrderId) ?? owners[0]);
      // Already linked to the step's parent: just tag that link with the step.
      if (targets.step) {
        const ownerId = ownerIdOf(targets.step);
        const link = f.links.find((l: { contractId: string | null; shipmentId: string | null; orderId: string | null; supplierOrderId: string | null }) => ownerIdOf(l) === ownerId);
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
          orderId: true,
          supplierOrderId: true,
          contract: { select: { contractNo: true, status: true } },
          shipment: { select: { blNumber: true, status: true } },
          order: { select: { orderNo: true, status: true } },
          supplierOrder: { select: { soNo: true, piNo: true, status: true } },
        },
      });
      if (!link) throw new NotFoundException('Link not found on this file');
      await this.config.assertRemovalKeepsDoneSteps(tx, organizationId, [ownerOf(link)], { fileId }, 'unlink this document');
      await tx.tradeFileLink.delete({ where: { id: linkId, organizationId } });
    });
    return this.getById(organizationId, fileId);
  }

  /** opts.allowClosed (round N): an email's Undo removes the file it filed even on a completed record. */
  async remove(organizationId: string, id: string, opts: { allowClosed?: boolean } = {}) {
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
              orderId: true,
              supplierOrderId: true,
              contract: { select: { contractNo: true, status: true } },
              shipment: { select: { blNumber: true, status: true } },
              order: { select: { orderNo: true, status: true } },
              supplierOrder: { select: { soNo: true, piNo: true, status: true } },
            },
          },
        },
      });
      if (!f) throw new NotFoundException('File not found');
      await this.config.assertRemovalKeepsDoneSteps(tx, organizationId, f.links.map(ownerOf), { fileId: id }, 'delete this document', opts);
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
      source: true,
      emailLogId: true,
      createdAt: true,
      links: { orderBy: { createdAt: 'asc' as const }, select: LINK_SELECT },
    };
  }

  /**
   * Validate link targets: ids are UUIDs, belong to the org, and are OPEN
   * (completed/cancelled records take no new documents until reopened). A
   * stepId adds its own contract/shipment to the targets.
   */
  /** completedShipmentsOk: an order-level invoice (step 11, round H) is filed on shipments that already completed their own steps. */
  async resolveTargets(db: Db, organizationId: string, contractIds: string[], shipmentIds: string[], stepId?: string, orderIds: string[] = [], supplierOrderIds: string[] = [], completedShipmentsOk = false): Promise<Targets> {
    const bad = [...contractIds, ...shipmentIds, ...orderIds, ...supplierOrderIds].filter((x) => !isUuid(x));
    if (bad.length) throw new BadRequestException(`Invalid id(s): ${bad.join(', ')}`);
    const cIds = new Set(contractIds);
    const sIds = new Set(shipmentIds);
    const oIds = new Set(orderIds);
    const soIds = new Set(supplierOrderIds);
    let step: Targets['step'] = null;
    if (stepId) {
      step = await db.tradeStep.findFirst({ where: { id: stepId, organizationId }, select: { id: true, contractId: true, shipmentId: true, orderId: true, supplierOrderId: true } });
      if (!step) throw new BadRequestException('Step not found in this organization');
      if (step.contractId) cIds.add(step.contractId);
      if (step.shipmentId) sIds.add(step.shipmentId);
      if (step.orderId) oIds.add(step.orderId);
      if (step.supplierOrderId) soIds.add(step.supplierOrderId);
    }
    const supplierOrders: Array<{ id: string; soNo: number; piNo: string | null; status: string }> = soIds.size
      ? await db.supplierOrder.findMany({ where: { organizationId, id: { in: [...soIds] } }, select: { id: true, soNo: true, piNo: true, status: true } })
      : [];
    if (supplierOrders.length !== soIds.size) throw new BadRequestException('One or more supplier orders were not found in this organization');
    const orders: Array<{ id: string; orderNo: number; status: string }> = oIds.size
      ? await db.tradeOrder.findMany({ where: { organizationId, id: { in: [...oIds] } }, select: { id: true, orderNo: true, status: true } })
      : [];
    if (orders.length !== oIds.size) throw new BadRequestException('One or more orders were not found in this organization');
    const contracts: Array<{ id: string; contractNo: string; status: string }> = cIds.size
      ? await db.contract.findMany({ where: { organizationId, id: { in: [...cIds] } }, select: { id: true, contractNo: true, status: true } })
      : [];
    const shipments: Array<{ id: string; blNumber: string | null; status: string }> = sIds.size
      ? await db.shipment.findMany({ where: { organizationId, id: { in: [...sIds] } }, select: { id: true, blNumber: true, status: true } })
      : [];
    if (contracts.length !== cIds.size) throw new BadRequestException('One or more contracts were not found in this organization');
    if (shipments.length !== sIds.size) throw new BadRequestException('One or more shipments were not found in this organization');
    const closed = [
      ...supplierOrders.filter((o) => o.status !== 'OPEN').map((o) => `supplier order ${o.piNo ? `PI ${o.piNo}` : `S${o.soNo}`} (${o.status.toLowerCase()})`),
      ...orders.filter((o) => o.status !== 'OPEN').map((o) => `order #${o.orderNo} (${o.status.toLowerCase()})`),
      ...contracts.filter((c) => c.status !== 'OPEN').map((c) => `contract ${c.contractNo} (${c.status.toLowerCase()})`),
      ...shipments.filter((s) => s.status !== 'OPEN' && !(completedShipmentsOk && s.status === 'COMPLETED')).map((s) => `shipment ${s.blNumber ?? '(no B/L)'} (${s.status.toLowerCase()})`),
    ];
    if (closed.length) throw new BadRequestException(`Reopen before adding documents: ${closed.join(', ')}`);
    return { contracts, shipments, orders, supplierOrders, step };
  }

  /** One link row per target not already linked; each has exactly one of contractId / shipmentId / orderId / supplierOrderId. */
  private linkRows(organizationId: string, fileId: string, t: Targets, existing: Set<string>) {
    const stepFor = (ownerId: string) => (t.step && ownerIdOf(t.step) === ownerId ? t.step.id : null);
    const none = { contractId: null, shipmentId: null, orderId: null, supplierOrderId: null };
    return [
      ...(t.supplierOrders ?? []).filter((o) => !existing.has(o.id)).map((o) => ({ organizationId, fileId, ...none, supplierOrderId: o.id, stepId: stepFor(o.id) })),
      ...(t.orders ?? []).filter((o) => !existing.has(o.id)).map((o) => ({ organizationId, fileId, ...none, orderId: o.id, stepId: stepFor(o.id) })),
      ...t.contracts.filter((c) => !existing.has(c.id)).map((c) => ({ organizationId, fileId, ...none, contractId: c.id, stepId: stepFor(c.id) })),
      ...t.shipments.filter((s) => !existing.has(s.id)).map((s) => ({ organizationId, fileId, ...none, shipmentId: s.id, stepId: stepFor(s.id) })),
    ];
  }


}

/** API shape of a file row: the doc type's label, and hasThumb instead of the storage key. */
function shapeFile<F extends { docType: string; thumbKey?: string | null }>(f: F, labels: Map<string, string>) {
  const { thumbKey, ...rest } = f;
  return { ...rest, docTypeLabel: labels.get(f.docType) ?? f.docType, hasThumb: !!thumbKey };
}

/** The orders / contracts / shipments a file was just linked to. */
export const ownersOfTargets = (t: Targets): TradeOwner[] => [
  ...(t.supplierOrders ?? []).map((o) => ({ supplierOrderId: o.id })),
  ...(t.orders ?? []).map((o) => ({ orderId: o.id })),
  ...t.contracts.map((c) => ({ contractId: c.id })),
  ...t.shipments.map((s) => ({ shipmentId: s.id })),
];

export function ownerOf(link: {
  contractId: string | null;
  shipmentId: string | null;
  orderId?: string | null;
  supplierOrderId?: string | null;
  contract?: { contractNo: string; status: string } | null;
  shipment?: { blNumber: string | null; status: string } | null;
  order?: { orderNo: number; status: string } | null;
  supplierOrder?: { soNo: number; piNo: string | null; status: string } | null;
}): RemovalOwner {
  if (link.supplierOrderId)
    return {
      supplierOrderId: link.supplierOrderId,
      label: `supplier order ${link.supplierOrder?.piNo ? `PI ${link.supplierOrder.piNo}` : `S${link.supplierOrder?.soNo ?? ''}`}`,
      status: link.supplierOrder?.status ?? 'OPEN',
    };
  if (link.orderId) return { orderId: link.orderId, label: `order #${link.order?.orderNo ?? ''}`, status: link.order?.status ?? 'OPEN' };
  return link.contractId
    ? { contractId: link.contractId, label: `contract ${link.contract?.contractNo}`, status: link.contract?.status ?? 'OPEN' }
    : { shipmentId: link.shipmentId!, label: `shipment ${link.shipment?.blNumber ?? '(no B/L)'}`, status: link.shipment?.status ?? 'OPEN' };
}

/** sha256 of a file's bytes (hex) — the email intake skips a file it already has. */
export const sha256Of = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

function parseDay(v: string, name: string): Date {
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new BadRequestException(`${name} is not a valid date`);
  return d;
}
