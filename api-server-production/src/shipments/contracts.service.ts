import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ContractLineDto, CreateContractDto, ListContractsQuery, UpdateContractDto } from './dto/contract.dto';
import { CreateShipmentDto } from './dto/shipment.dto';
import { TradeActor } from './shipments.request';
import { blockingSteps, currentStepOf, depositOf, linesSummary, progressOf, stepLabels } from './shipments.rules';
import { Db, DOC_LINK_SELECT, isUniqueViolation, optText, pageArgs, TradeConfigService } from './trade-config.service';
import { CONTRACT_LINE_SELECT, FILE_LINK_SELECT, shapeFileLinks, STEP_SELECT, STEP_SUMMARY_SELECT } from './trade-selects';
import { ShipmentsService } from './shipments.service';
import { DEFAULT_DEPOSIT_DUE, depositDueDate, depositDueText, parseDepositDue } from './trade-deposit';

export { CONTRACT_LINE_SELECT, FILE_LINK_SELECT, STEP_SELECT, STEP_SUMMARY_SELECT } from './trade-selects';

/**
 * Contracts: the supplier contract / PI level. A contract and its shipments
 * are one deal: a new contract gets shipment #1 straight away (B/L pending,
 * filled in on shipment step 2), and "Add shipment" adds more.
 */
@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TradeConfigService,
    private readonly shipments: ShipmentsService,
  ) {}

  async list(organizationId: string, query: ListContractsQuery) {
    const { page, pageSize, skip, take } = pageArgs(query.page, query.pageSize);
    const q = query.q?.trim();
    const where = {
      organizationId,
      ...(query.status ? { status: query.status as 'OPEN' | 'COMPLETED' | 'CANCELLED' } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(q
        ? {
            OR: [{ contractNo: { contains: q, mode: 'insensitive' as const } }, { piNumber: { contains: q, mode: 'insensitive' as const } }],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          supplier: { select: { id: true, name: true, supplierCode: true } },
          customer: { select: { id: true, name: true, customerCode: true } },
          lines: { orderBy: { sortOrder: 'asc' }, select: CONTRACT_LINE_SELECT },
          steps: { select: STEP_SUMMARY_SELECT },
          _count: { select: { shipments: true } },
        },
      }),
      this.prisma.contract.count({ where }),
    ]);
    const items = rows.map(({ steps, _count, ...c }) => ({
      ...c,
      depositDueDate: depositDueDate(c.piDate, c.depositDueDays, c.depositDueUnit),
      linesSummary: linesSummary(c.lines ?? []),
      totalQuantityMt: totalQty(c.lines ?? []),
      shipmentCount: _count?.shipments ?? 0,
      progress: progressOf(steps ?? []),
      currentStep: currentStepOf(steps ?? []),
    }));
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  /** Detail; with an actor, auto-complete runs first on the contract and its shipments. */
  async getById(organizationId: string, id: string, actor?: TradeActor) {
    if (actor) {
      const ships: Array<{ id: string }> = await this.prisma.shipment.findMany({ where: { organizationId, contractId: id }, select: { id: true } });
      await this.config.syncSteps(this.prisma, organizationId, [{ contractId: id }, ...ships.map((x) => ({ shipmentId: x.id }))], actor);
    }
    const c = await this.prisma.contract.findFirst({
      where: { id, organizationId },
      include: {
        supplier: { select: { id: true, name: true, supplierCode: true, currency: true } },
        customer: { select: { id: true, name: true, customerCode: true, currency: true } },
        lines: { orderBy: { sortOrder: 'asc' }, select: CONTRACT_LINE_SELECT },
        shipments: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            blNumber: true,
            vessel: true,
            voyageNo: true,
            etd: true,
            eta: true,
            netWeightMt: true,
            status: true,
            contractLineId: true,
            createdAt: true,
            steps: { select: STEP_SUMMARY_SELECT },
          },
        },
        steps: { orderBy: { sortOrder: 'asc' }, select: STEP_SELECT },
        fileLinks: { orderBy: { createdAt: 'desc' }, select: FILE_LINK_SELECT },
        docLinks: { orderBy: { createdAt: 'desc' }, select: DOC_LINK_SELECT },
      },
    });
    if (!c) throw new NotFoundException('Contract not found');
    const { shipments, ...rest } = c;
    const { steps, docLinks } = await this.config.decorateRecord(organizationId, c);
    return {
      ...rest,
      steps,
      docLinks,
      fileLinks: shapeFileLinks(c.fileLinks),
      depositDueDate: depositDueDate(c.piDate, c.depositDueDays, c.depositDueUnit),
      linesSummary: linesSummary(c.lines),
      totalQuantityMt: totalQty(c.lines),
      progress: progressOf(c.steps),
      currentStep: currentStepOf(c.steps),
      shipments: shipments.map(({ steps, ...s }) => ({ ...s, progress: progressOf(steps), currentStep: currentStepOf(steps) })),
    };
  }

  async create(organizationId: string, dto: CreateContractDto, actor: TradeActor) {
    const contractNo = dto.contractNo.trim();
    if (!contractNo) throw new BadRequestException('Contract number is required');
    try {
      const id = await this.prisma.$transaction(async (tx: Db) => {
        await this.assertParties(tx, organizationId, dto.supplierId, dto.customerId);
        await this.assertContractNoFree(tx, organizationId, contractNo);
        const defaults = await this.config.getSettings(organizationId, tx);
        const fields = this.fields(dto);
        // B/L instructions default from the org settings when not sent.
        if (dto.consignee === undefined) fields.consignee = defaults.defaultConsignee;
        if (dto.notifyParty === undefined) fields.notifyParty = defaults.defaultNotifyParty;
        if (dto.depositAmount === undefined) fields.depositAmount = depositOf(dto.piAmount, dto.depositPercent ?? 10);
        // Deposit due: as sent, else read from the PI's wording, else Vedanta's 3 business days.
        if (dto.depositDueDays === undefined) {
          const due = parseDepositDue(dto.depositDueNote) ?? DEFAULT_DEPOSIT_DUE;
          fields.depositDueDays = due.days;
          fields.depositDueUnit = due.unit;
          if (dto.depositDueNote === undefined) fields.depositDueNote = depositDueText(due.days, due.unit);
        }
        const created = await tx.contract.create({
          data: {
            organizationId,
            contractNo,
            supplierId: dto.supplierId,
            customerId: dto.customerId,
            ...fields,
            createdById: actor.id,
          },
          select: { id: true },
        });
        await this.syncLines(tx, organizationId, created.id, dto.lines);
        await this.config.snapshotSteps(tx, organizationId, 'CONTRACT', { contractId: created.id });
        if (dto.piFileId) await this.config.linkSourceFile(tx, organizationId, dto.piFileId, 'PI', { contractId: created.id }, 'PI_PAYMENT');
        // Shipment #1 of the deal, B/L pending.
        await this.shipments.createInTx(tx, organizationId, { contractId: created.id } as CreateShipmentDto, actor);
        return created.id as string;
      });
      return this.getById(organizationId, id, actor);
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException(`Contract number "${contractNo}" already exists`);
      throw e;
    }
  }

  async update(organizationId: string, id: string, dto: UpdateContractDto, actor: TradeActor | null = null) {
    const contractNo = dto.contractNo === undefined ? undefined : dto.contractNo.trim();
    if (contractNo === '') throw new BadRequestException('Contract number cannot be empty');
    try {
      await this.prisma.$transaction(async (tx: Db) => {
        const existing = await tx.contract.findFirst({ where: { id, organizationId }, select: { id: true, contractNo: true } });
        if (!existing) throw new NotFoundException('Contract not found');
        if (dto.supplierId || dto.customerId) await this.assertParties(tx, organizationId, dto.supplierId, dto.customerId);
        if (contractNo && contractNo !== existing.contractNo) await this.assertContractNoFree(tx, organizationId, contractNo, id);
        await tx.contract.update({
          where: { id, organizationId },
          data: {
            ...(contractNo ? { contractNo } : {}),
            ...(dto.supplierId ? { supplierId: dto.supplierId } : {}),
            ...(dto.customerId ? { customerId: dto.customerId } : {}),
            ...this.fields(dto),
            ...(dto.status === 'CANCELLED' ? { status: 'CANCELLED' } : {}),
          },
        });
        if (dto.lines !== undefined) await this.syncLines(tx, organizationId, id, dto.lines);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new BadRequestException(`Contract number "${contractNo}" already exists`);
      throw e;
    }
    await this.config.syncSteps(this.prisma, organizationId, [{ contractId: id }], actor, { fields: Object.keys(dto) });
    return this.getById(organizationId, id);
  }

  async remove(organizationId: string, id: string) {
    await this.prisma.$transaction(async (tx: Db) => {
      const c = await tx.contract.findFirst({
        where: { id, organizationId },
        select: {
          id: true,
          contractNo: true,
          shipments: { select: { id: true, blNumber: true, _count: { select: { fileLinks: true, docLinks: true, generatedDocs: true } } } },
        },
      });
      if (!c) throw new NotFoundException('Contract not found');
      // Shipments with nothing on them yet (e.g. the automatic shipment #1) go with the contract.
      const used = c.shipments.filter((x: { _count: { fileLinks: number; docLinks: number; generatedDocs: number } }) => x._count.fileLinks + x._count.docLinks + x._count.generatedDocs > 0);
      if (used.length) {
        throw new BadRequestException(`Contract ${c.contractNo} has shipment(s) with documents (${used.map((x: { blNumber: string | null }) => x.blNumber || 'B/L pending').join(', ')}) — delete them first`);
      }
      if (c.shipments.length) await tx.shipment.deleteMany({ where: { organizationId, contractId: id } });
      // Steps and file links cascade; the files themselves stay in the Documents library.
      await tx.contract.delete({ where: { id, organizationId } });
    });
    return { id, deleted: true };
  }

  async complete(organizationId: string, id: string) {
    await this.prisma.$transaction(async (tx: Db) => {
      const c = await tx.contract.findFirst({
        where: { id, organizationId },
        select: {
          id: true,
          contractNo: true,
          status: true,
          steps: { orderBy: { sortOrder: 'asc' }, select: { id: true, title: true, displayNo: true, sortOrder: true, status: true, isOngoing: true, requiredDocTypes: true } },
          shipments: { orderBy: { createdAt: 'asc' }, select: { blNumber: true, status: true } },
        },
      });
      if (!c) throw new NotFoundException('Contract not found');
      // The deal is complete when every (not cancelled) shipment is.
      const openShipments = c.shipments.filter((x: { status: string }) => x.status === 'OPEN');
      if (openShipments.length) {
        throw new BadRequestException(
          `Cannot complete contract ${c.contractNo}: complete its shipment(s) first — ${openShipments.map((x: { blNumber: string | null }) => x.blNumber || 'B/L pending').join(', ')}`,
        );
      }
      if (c.status === 'COMPLETED') throw new BadRequestException(`Contract ${c.contractNo} is already completed`);
      if (c.status === 'CANCELLED') throw new BadRequestException(`Contract ${c.contractNo} is cancelled — reopen it first`);
      const blocking = blockingSteps(c.steps);
      if (blocking.length) {
        throw new BadRequestException(`Cannot complete contract ${c.contractNo}: these steps are not done: ${blocking.map((s) => stepLabels(c.steps).get(s.id)).join(', ')}`);
      }
      await tx.contract.update({ where: { id, organizationId }, data: { status: 'COMPLETED' } });
    });
    return this.getById(organizationId, id);
  }

  async reopen(organizationId: string, id: string, actor: TradeActor | null = null) {
    await this.prisma.$transaction(async (tx: Db) => {
      const c = await tx.contract.findFirst({ where: { id, organizationId }, select: { contractNo: true, status: true } });
      if (!c) throw new NotFoundException('Contract not found');
      if (c.status === 'OPEN') throw new BadRequestException(`Contract ${c.contractNo} is already open`);
      await tx.contract.update({ where: { id, organizationId }, data: { status: 'OPEN' } });
    });
    return this.getById(organizationId, id, actor ?? undefined);
  }

  /** PI date + N business / calendar days (the form's preview of what getById computes). */
  depositDue(piDate: string, days: string, unit: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(piDate ?? '')) throw new BadRequestException('piDate must be YYYY-MM-DD');
    const n = Number(days);
    if (!Number.isInteger(n) || n < 0 || n > 365) throw new BadRequestException('days must be a whole number 0–365');
    if (unit !== 'BUSINESS' && unit !== 'CALENDAR') throw new BadRequestException('unit must be BUSINESS or CALENDAR');
    return { piDate, days: n, unit, dueDate: depositDueDate(piDate, n, unit) };
  }

  // ── helpers ─────────────────────────────────────────────────────────────
  private async assertParties(db: Db, organizationId: string, supplierId?: string, customerId?: string) {
    if (supplierId) {
      const s = await db.supplier.findFirst({ where: { id: supplierId, organizationId }, select: { id: true } });
      if (!s) throw new BadRequestException('Supplier not found in this organization');
    }
    if (customerId) {
      const c = await db.customer.findFirst({ where: { id: customerId, organizationId }, select: { id: true } });
      if (!c) throw new BadRequestException('Customer not found in this organization');
    }
  }

  private async assertContractNoFree(db: Db, organizationId: string, contractNo: string, exceptId?: string) {
    const dup = await db.contract.findFirst({
      where: { organizationId, contractNo, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { id: true },
    });
    if (dup) throw new BadRequestException(`Contract number "${contractNo}" already exists`);
  }

  /**
   * Make the contract's product lines exactly `lines` (in this order): rows
   * with an id are updated, rows without one created, missing ones deleted —
   * unless a shipment still ships that line.
   */
  private async syncLines(db: Db, organizationId: string, contractId: string, lines: ContractLineDto[] | undefined) {
    if (!lines || !lines.length) throw new BadRequestException('Add at least one product line');
    const existing: Array<{ id: string; grade: string | null; sizeSpec: string | null; shipments: Array<{ blNumber: string | null }> }> = await db.contractLine.findMany({
      where: { organizationId, contractId },
      select: { id: true, grade: true, sizeSpec: true, shipments: { select: { blNumber: true } } },
    });
    const keep = new Set(lines.map((l) => l.id).filter(Boolean) as string[]);
    for (const id of keep) {
      if (!existing.some((e) => e.id === id)) throw new BadRequestException('A product line does not belong to this contract');
    }
    for (const e of existing.filter((x) => !keep.has(x.id))) {
      if (e.shipments.length) {
        const bl = e.shipments.map((s) => s.blNumber || '(no B/L yet)').join(', ');
        const what = [e.grade, e.sizeSpec].filter(Boolean).join(' ');
        throw new BadRequestException(`Can't remove product line${what ? ` ${what}` : ''}: shipment(s) ${bl} ship it — move them to another line first`);
      }
      await db.contractLine.delete({ where: { id: e.id } });
    }
    for (const [i, l] of lines.entries()) {
      const data = {
        grade: optText(l.grade) ?? null,
        product: optText(l.product) ?? null,
        sizeSpec: optText(l.sizeSpec) ?? null,
        quantityMt: l.quantityMt ?? null,
        tolerancePct: l.tolerancePct ?? 5,
        supplierPremium: l.supplierPremium ?? null,
        clientPremium: l.clientPremium ?? null,
        notes: optText(l.notes) ?? null,
        sortOrder: i + 1,
      };
      if (l.id) await db.contractLine.update({ where: { id: l.id }, data });
      else await db.contractLine.create({ data: { organizationId, contractId, ...data } });
    }
  }

  /** Optional columns shared by create and update; undefined = leave unchanged. */
  private fields(dto: Partial<CreateContractDto>) {
    const out: Record<string, unknown> = {};
    const texts = ['piNumber', 'destinationPort', 'destinationCountry', 'incoterm', 'shipmentMonth', 'deliveryMonth', 'consignee', 'notifyParty', 'depositDueNote', 'notes'] as const;
    for (const k of texts) {
      const v = optText(dto[k]);
      if (v !== undefined) out[k] = v;
    }
    for (const k of ['piAmount', 'depositPercent', 'depositAmount', 'depositDueDays'] as const) {
      if (dto[k] !== undefined) out[k] = dto[k];
    }
    if (dto.depositDueUnit !== undefined) out.depositDueUnit = dto.depositDueUnit || null;
    // Keep the words in depositDueNote too (lists / exports that still read the note).
    if (dto.depositDueDays !== undefined && dto.depositDueNote === undefined) out.depositDueNote = depositDueText(dto.depositDueDays, dto.depositDueUnit ?? 'BUSINESS');
    for (const k of ['piDate', 'depositPaidAt'] as const) {
      if (dto[k] !== undefined) out[k] = dto[k] ? new Date(dto[k] as string) : null;
    }
    if (dto.currency) out.currency = dto.currency;
    return out;
  }
}

const totalQty = (lines: Array<{ quantityMt: unknown }>) => {
  const q = lines.filter((l) => l.quantityMt !== null && l.quantityMt !== undefined);
  return q.length ? Math.round(q.reduce((s, l) => s + Number(l.quantityMt), 0) * 1000) / 1000 : null;
};
