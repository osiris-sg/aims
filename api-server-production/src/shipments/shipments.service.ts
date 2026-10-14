import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CreateShipmentDto, ListShipmentsQuery, UpdateShipmentDto } from './dto/shipment.dto';
import { CONTRACT_LINE_SELECT, FILE_LINK_SELECT, shapeFileLinks, STEP_SELECT, STEP_SUMMARY_SELECT } from './trade-selects';
import { TradeActor } from './shipments.request';
import { blockingSteps, currentStepOf, lineLabel, progressOf, stepLabels } from './shipments.rules';
import { latestBlCheck } from './trade-extract.service';
import { Db, DOC_LINK_SELECT, isUniqueViolation, optText, pageArgs, TradeConfigService } from './trade-config.service';

/** Shipments: one per Bill of Lading, always under a contract. */
@Injectable()
export class ShipmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TradeConfigService,
  ) {}

  async list(organizationId: string, query: ListShipmentsQuery) {
    const { page, pageSize, skip, take } = pageArgs(query.page, query.pageSize);
    const q = query.q?.trim();
    const where = {
      organizationId,
      ...(query.contractId ? { contractId: query.contractId } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.status ? { status: query.status as 'OPEN' | 'COMPLETED' | 'CANCELLED' } : {}),
      ...(q
        ? {
            OR: [
              { blNumber: { contains: q, mode: 'insensitive' as const } },
              { vessel: { contains: q, mode: 'insensitive' as const } },
              { contract: { contractNo: { contains: q, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
    const select = {
      id: true,
      blNumber: true,
      vessel: true,
      voyageNo: true,
      etd: true,
      eta: true,
      actualArrivalDate: true,
      netWeightMt: true,
      status: true,
      createdAt: true,
      contractId: true,
      contract: { select: { id: true, contractNo: true } },
      contractLine: { select: CONTRACT_LINE_SELECT },
      customer: { select: { id: true, name: true } },
      steps: { select: STEP_SUMMARY_SELECT },
    };
    const orderBy = [{ eta: { sort: 'desc' as const, nulls: 'last' as const } }, { createdAt: 'desc' as const }];
    const shape = ({ steps, ...s }: any) => ({
      ...s,
      contractNo: s.contract?.contractNo ?? null,
      customerName: s.customer?.name ?? null,
      productLine: s.contractLine ? lineLabel(s.contractLine) : null,
      progress: progressOf(steps ?? []),
      currentStep: currentStepOf(steps ?? []),
    });
    // "Current step" is derived from the steps, so that filter runs in memory
    // over the org's (small) shipment list before paging.
    if (query.currentStep) {
      const all = (await this.prisma.shipment.findMany({ where, orderBy, select })).map(shape);
      const want = query.currentStep;
      const hit = all.filter((s: any) => (want === 'COMPLETED' ? s.currentStep === null && s.progress.total > 0 : s.currentStep?.code === want));
      return { items: hit.slice(skip, skip + take), total: hit.length, page, pageSize, totalPages: Math.ceil(hit.length / pageSize) };
    }
    const [rows, total] = await Promise.all([this.prisma.shipment.findMany({ where, orderBy, skip, take, select }), this.prisma.shipment.count({ where })]);
    const items = rows.map(shape);
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  /** Detail; with an actor, auto-complete runs first (e.g. an invoice confirmed in the invoice editor). */
  async getById(organizationId: string, id: string, actor?: TradeActor) {
    if (actor) await this.config.syncSteps(this.prisma, organizationId, [{ shipmentId: id }], actor);
    const s = await this.prisma.shipment.findFirst({
      where: { id, organizationId },
      include: {
        contract: {
          select: {
            id: true,
            contractNo: true,
            piNumber: true,
            status: true,
            deliveryMonth: true,
            lines: { orderBy: { sortOrder: 'asc' }, select: CONTRACT_LINE_SELECT },
            supplier: { select: { id: true, name: true } },
            customer: { select: { id: true, name: true } },
          },
        },
        contractLine: { select: CONTRACT_LINE_SELECT },
        customer: { select: { id: true, name: true, customerCode: true } },
        steps: { orderBy: { sortOrder: 'asc' }, select: STEP_SELECT },
        fileLinks: { orderBy: { createdAt: 'desc' }, select: FILE_LINK_SELECT },
        docLinks: { orderBy: { createdAt: 'desc' }, select: DOC_LINK_SELECT },
      },
    });
    if (!s) throw new NotFoundException('Shipment not found');
    const { steps, docLinks } = await this.config.decorateRecord(organizationId, s);
    const blCheck = await latestBlCheck(this.prisma, organizationId, id);
    return {
      ...s,
      steps,
      docLinks,
      fileLinks: shapeFileLinks(s.fileLinks),
      productLine: s.contractLine ? lineLabel(s.contractLine) : null,
      progress: progressOf(s.steps),
      currentStep: currentStepOf(s.steps),
      blCheck,
    };
  }

  async create(organizationId: string, dto: CreateShipmentDto, actor: TradeActor) {
    const blNumber = optText(dto.blNumber) ?? null;
    try {
      const id = await this.prisma.$transaction((tx: Db) => this.createInTx(tx, organizationId, dto, actor));
      await this.config.syncSteps(this.prisma, organizationId, [{ shipmentId: id }], actor);
      return this.getById(organizationId, id);
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException(`B/L number "${blNumber}" is already used by another shipment`);
      throw e;
    }
  }

  /**
   * One shipment row + its steps, inside the caller's transaction. Used by
   * "Add shipment" and by a new contract (its shipment #1, B/L pending): the
   * B/L, vessel and weights are filled in on shipment step 2.
   */
  async createInTx(tx: Db, organizationId: string, dto: CreateShipmentDto, actor: TradeActor): Promise<string> {
    const blNumber = optText(dto.blNumber) ?? null;
    const contract = await tx.contract.findFirst({
      where: { id: dto.contractId, organizationId },
      select: { id: true, contractNo: true, status: true, customerId: true, currency: true, deliveryMonth: true, lines: { orderBy: { sortOrder: 'asc' }, select: CONTRACT_LINE_SELECT } },
    });
    if (!contract) throw new BadRequestException('Contract not found in this organization');
    if (contract.status === 'CANCELLED') {
      throw new BadRequestException(`Contract ${contract.contractNo} is cancelled — reopen it before adding shipments`);
    }
    const customerId = dto.customerId || contract.customerId;
    if (dto.customerId) await this.assertCustomer(tx, organizationId, dto.customerId);
    if (blNumber) await this.assertBlFree(tx, organizationId, blNumber);
    const line = pickLine(contract.lines, dto.contractLineId);
    const fields = this.fields(dto);
    // Commodity / size prefill from the product line; delivery month from the contract.
    if (line && dto.commodity === undefined) fields.commodity = commodityOf(line);
    if (line && dto.sizeSpec === undefined) fields.sizeSpec = line.sizeSpec ?? null;
    if (dto.deliveryMonth === undefined) fields.deliveryMonth = contract.deliveryMonth ?? null;
    const created = await tx.shipment.create({
      data: {
        organizationId,
        contractId: contract.id,
        contractLineId: line?.id ?? null,
        customerId,
        blNumber,
        currency: dto.currency || contract.currency || 'USD',
        ...fields,
        createdById: actor.id,
      },
      select: { id: true },
    });
    await this.config.snapshotSteps(tx, organizationId, 'SHIPMENT', { shipmentId: created.id });
    if (dto.blDraftFileId) await this.config.linkSourceFile(tx, organizationId, dto.blDraftFileId, 'BL_DRAFT', { shipmentId: created.id }, 'BL_DRAFT_APPROVAL');
    return created.id as string;
  }

  async update(organizationId: string, id: string, dto: UpdateShipmentDto, actor: TradeActor | null = null) {
    const blNumber = optText(dto.blNumber);
    try {
      await this.prisma.$transaction(async (tx: Db) => {
        const existing = await tx.shipment.findFirst({
          where: { id, organizationId },
          select: { id: true, blNumber: true, contract: { select: { lines: { select: { id: true, grade: true, sizeSpec: true } } } } },
        });
        if (!existing) throw new NotFoundException('Shipment not found');
        if (dto.contractLineId !== undefined) {
          const lines = existing.contract?.lines ?? [];
          if (dto.contractLineId === null || dto.contractLineId === '') {
            if (lines.length) throw new BadRequestException('Pick the contract product line this shipment ships');
          } else if (!lines.some((l: { id: string }) => l.id === dto.contractLineId)) {
            throw new BadRequestException("That product line is not on this shipment's contract");
          }
        }
        if (dto.customerId) await this.assertCustomer(tx, organizationId, dto.customerId);
        if (blNumber && blNumber !== existing.blNumber) await this.assertBlFree(tx, organizationId, blNumber, id);
        await tx.shipment.update({
          where: { id, organizationId },
          data: {
            ...(blNumber !== undefined ? { blNumber } : {}),
            ...(dto.contractLineId !== undefined ? { contractLineId: dto.contractLineId || null } : {}),
            ...(dto.customerId !== undefined ? { customerId: dto.customerId || null } : {}),
            ...(dto.currency ? { currency: dto.currency } : {}),
            ...this.fields(dto),
            ...(dto.status === 'CANCELLED' ? { status: 'CANCELLED' } : {}),
          },
        });
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException(`B/L number "${blNumber}" is already used by another shipment`);
      throw e;
    }
    // Step 2's B/L fields (requiredFields) complete it once its B/L draft is there too.
    await this.config.syncSteps(this.prisma, organizationId, [{ shipmentId: id }], actor, { fields: Object.keys(dto) });
    return this.getById(organizationId, id);
  }

  async remove(organizationId: string, id: string) {
    await this.prisma.$transaction(async (tx: Db) => {
      const s = await tx.shipment.findFirst({ where: { id, organizationId }, select: { id: true } });
      if (!s) throw new NotFoundException('Shipment not found');
      // Steps and file links cascade; the files themselves stay in the Documents library.
      await tx.shipment.delete({ where: { id, organizationId } });
    });
    return { id, deleted: true };
  }

  async complete(organizationId: string, id: string) {
    await this.prisma.$transaction(async (tx: Db) => {
      const s = await tx.shipment.findFirst({
        where: { id, organizationId },
        select: {
          blNumber: true,
          status: true,
          steps: { orderBy: { sortOrder: 'asc' }, select: { id: true, title: true, displayNo: true, sortOrder: true, status: true, isOngoing: true, requiredDocTypes: true } },
        },
      });
      if (!s) throw new NotFoundException('Shipment not found');
      const label = s.blNumber ? `shipment ${s.blNumber}` : 'this shipment';
      if (s.status === 'COMPLETED') throw new BadRequestException(`${cap(label)} is already completed`);
      if (s.status === 'CANCELLED') throw new BadRequestException(`${cap(label)} is cancelled — reopen it first`);
      const blocking = blockingSteps(s.steps);
      if (blocking.length) {
        throw new BadRequestException(`Cannot complete ${label}: these steps are not done: ${blocking.map((x) => stepLabels(s.steps).get(x.id)).join(', ')}`);
      }
      await tx.shipment.update({ where: { id, organizationId }, data: { status: 'COMPLETED' } });
    });
    return this.getById(organizationId, id);
  }

  /**
   * Back to OPEN. A shipment can't be worked on under a completed contract, so
   * a COMPLETED contract is reopened with it (reported as reopenedContract so
   * the portal can say so); a cancelled contract is left alone.
   */
  async reopen(organizationId: string, id: string, actor: TradeActor | null = null) {
    let reopenedContract: string | null = null;
    await this.prisma.$transaction(async (tx: Db) => {
      const s = await tx.shipment.findFirst({ where: { id, organizationId }, select: { blNumber: true, status: true, contract: { select: { id: true, contractNo: true, status: true } } } });
      if (!s) throw new NotFoundException('Shipment not found');
      if (s.status === 'OPEN') throw new BadRequestException(`${s.blNumber ? `Shipment ${s.blNumber}` : 'This shipment'} is already open`);
      await tx.shipment.update({ where: { id, organizationId }, data: { status: 'OPEN' } });
      if (s.contract?.status === 'COMPLETED') {
        await tx.contract.update({ where: { id: s.contract.id, organizationId }, data: { status: 'OPEN' } });
        reopenedContract = s.contract.contractNo;
      }
    });
    return { ...(await this.getById(organizationId, id, actor ?? undefined)), reopenedContract };
  }

  // ── helpers ─────────────────────────────────────────────────────────────
  private async assertCustomer(db: Db, organizationId: string, customerId: string) {
    const c = await db.customer.findFirst({ where: { id: customerId, organizationId }, select: { id: true } });
    if (!c) throw new BadRequestException('Customer not found in this organization');
  }

  private async assertBlFree(db: Db, organizationId: string, blNumber: string, exceptId?: string) {
    const dup = await db.shipment.findFirst({
      where: { organizationId, blNumber, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { id: true },
    });
    if (dup) throw new BadRequestException(`B/L number "${blNumber}" is already used by another shipment`);
  }

  /** Optional columns shared by create and update; undefined = leave unchanged. */
  private fields(dto: Partial<CreateShipmentDto>) {
    const out: Record<string, unknown> = {};
    const texts = [
      'vessel',
      'voyageNo',
      'shippingLine',
      'deliveryMonth',
      'portOfLoading',
      'portOfDischarge',
      'hsCode',
      'countryOfOrigin',
      'commodity',
      'sizeSpec',
      'ciNumber',
      'telexReleaseCode',
      'notes',
    ] as const;
    for (const k of texts) {
      const v = optText(dto[k]);
      if (v !== undefined) out[k] = v;
    }
    for (const k of ['netWeightMt', 'grossWeightMt', 'totalBundles', 'totalPieces', 'containerCount', 'ciAmount'] as const) {
      if (dto[k] !== undefined) out[k] = dto[k];
    }
    for (const k of ['etd', 'eta', 'actualArrivalDate'] as const) {
      if (dto[k] !== undefined) out[k] = dto[k] ? new Date(dto[k] as string) : null;
    }
    return out;
  }
}

type LineRow = { id: string; grade: string | null; product: string | null; sizeSpec: string | null };

/**
 * The line a new shipment ships: the one asked for, else the contract's only
 * line; with several lines and none asked for it stays empty and is picked on
 * shipment step 2 (a required field there).
 */
export function pickLine<L extends LineRow>(lines: L[], requested: string | null | undefined): L | null {
  if (requested) {
    const l = lines.find((x) => x.id === requested);
    if (!l) throw new BadRequestException("That product line is not on this shipment's contract");
    return l;
  }
  return lines.length === 1 ? lines[0] : null;
}

/** "Aluminium Billet 6063" — the line's product + grade, as the shipment's commodity. */
export const commodityOf = (l: { product: string | null; grade: string | null }) => [l.product, l.grade].filter(Boolean).join(' ') || null;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
