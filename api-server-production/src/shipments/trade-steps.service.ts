import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { TradeActor } from './shipments.request';
import { fieldRequirements, hasExactlyOneOwner, missingDocTypes, stepLabel } from './shipments.rules';
import { Db, TradeConfigService, TradeOwner } from './trade-config.service';

type StepAction = 'start' | 'complete' | 'reopen';

/**
 * Step status changes by hand. No ordering is enforced between steps; the
 * rules are: the parent contract/shipment must be OPEN, DONE needs every
 * required doc type linked to the same parent and every required field filled.
 * Steps can't be skipped. Most steps complete by themselves
 * (TradeConfigService.syncSteps); "complete" here is "Mark done" for steps
 * with nothing to tick and for a reopened step. Reopen holds the step open
 * until one of its documents / fields changes.
 */
@Injectable()
export class TradeStepsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TradeConfigService,
  ) {}

  start(organizationId: string, id: string, actor: TradeActor) {
    return this.change(organizationId, id, 'start', actor);
  }

  complete(organizationId: string, id: string, actor: TradeActor) {
    return this.change(organizationId, id, 'complete', actor);
  }

  reopen(organizationId: string, id: string, actor: TradeActor) {
    return this.change(organizationId, id, 'reopen', actor);
  }

  private async change(organizationId: string, id: string, action: StepAction, actor: TradeActor) {
    return this.prisma.$transaction(async (tx: Db) => {
      const step = await tx.tradeStep.findFirst({
        where: { id, organizationId },
        select: {
          id: true,
          title: true,
          displayNo: true,
          status: true,
          requiredDocTypes: true,
          requiredFields: true,
          contractId: true,
          shipmentId: true,
          orderId: true,
          notApplicable: true,
          contract: true,
          shipment: true,
          order: true,
        },
      });
      if (!step) throw new NotFoundException('Step not found');
      if (!hasExactlyOneOwner(step)) throw new BadRequestException('Step is not attached to exactly one order, shipment or contract');
      if (step.notApplicable) throw new BadRequestException(`"${stepLabel(step)}" doesn't apply to this customer (customer profile)`);

      const owner = step.orderId
        ? { kind: 'order', label: `Order #${step.order?.orderNo}`, status: step.order?.status }
        : step.contractId
          ? { kind: 'contract', label: `Contract ${step.contract?.contractNo}`, status: step.contract?.status }
          : { kind: 'shipment', label: step.shipment?.blNumber ? `Shipment ${step.shipment.blNumber}` : 'This shipment', status: step.shipment?.status };
      const stepOwner: TradeOwner = step.orderId ? { orderId: step.orderId } : step.contractId ? { contractId: step.contractId } : { shipmentId: step.shipmentId! };
      if (owner.status !== 'OPEN') {
        throw new BadRequestException(`${owner.label} is ${String(owner.status).toLowerCase()} — reopen it before changing steps`);
      }

      const now = new Date();
      const stamp = { updatedById: actor.id, updatedByName: actor.name };
      let data: Record<string, unknown> = {};
      switch (action) {
        case 'start':
          if (step.status === 'IN_PROGRESS') return this.read(tx, organizationId, id);
          if (step.status !== 'NOT_STARTED') {
            throw new BadRequestException(`"${stepLabel(step)}" is ${label(step.status)} — reopen it instead`);
          }
          data = { status: 'IN_PROGRESS', ...stamp };
          break;
        case 'complete': {
          if (step.status === 'DONE') throw new BadRequestException(`"${stepLabel(step)}" is already done`);
          // A required type is met by a linked file or a linked (live) in-app document.
          const present = await this.config.presentDocTypes(tx, organizationId, stepOwner);
          const missing = missingDocTypes(step.requiredDocTypes, present);
          if (missing.length) {
            const labels = await this.config.docTypeLabels(organizationId, tx);
            throw new BadRequestException(`Cannot complete "${stepLabel(step)}": missing required document(s) on this ${owner.kind}: ${missing.map((c) => labels.get(c) ?? c).join(', ')}`);
          }
          const emptyFields = fieldRequirements(step.requiredFields, (step.order ?? step.contract ?? step.shipment) as Record<string, unknown>).filter((f) => !f.satisfied);
          if (emptyFields.length) {
            throw new BadRequestException(`Cannot complete "${stepLabel(step)}": fill in ${emptyFields.map((f) => f.label).join(', ')} on this ${owner.kind} first`);
          }
          data = { status: 'DONE', completedAt: now, skipReason: null, holdOpen: false, ...stamp };
          break;
        }
        case 'reopen':
          // SKIPPED can't be set any more; a legacy SKIPPED row can still be reopened.
          if (step.status !== 'DONE' && step.status !== 'SKIPPED') {
            throw new BadRequestException(`"${stepLabel(step)}" is ${label(step.status)} — only a done step can be reopened`);
          }
          // Held open: auto-complete leaves it until one of its documents / fields changes.
          data = { status: 'IN_PROGRESS', completedAt: null, skipReason: null, holdOpen: true, ...stamp };
          break;
      }
      await tx.tradeStep.update({ where: { id, organizationId }, data });
      // The next open step becomes current (and anything already satisfied completes).
      // "Mark done" may be the last step: the shipment (and the deal) complete with it.
      await this.config.syncSteps(tx, organizationId, [stepOwner], actor, {}, { closeCheck: action === 'complete' });
      return this.read(tx, organizationId, id);
    });
  }

  /**
   * Tick / untick a step's sub-task ("Sent to customer" …). Sub-tasks are
   * evidence only — they never block or complete a step. `source` EMAIL is set
   * by the email intake (with the log row id) so it can be undone there.
   */
  async setSubtask(organizationId: string, id: string, key: string, done: boolean, actor: TradeActor, source: { kind: 'MANUAL' | 'EMAIL'; emailLogId?: string | null } = { kind: 'MANUAL' }) {
    const step = await this.prisma.tradeStep.findFirst({ where: { id, organizationId }, select: { id: true, subtasks: true, title: true, displayNo: true } });
    if (!step) throw new NotFoundException('Step not found');
    const list = Array.isArray(step.subtasks) ? (step.subtasks as Array<Record<string, unknown>>) : [];
    const i = list.findIndex((t) => t.key === key);
    if (i < 0) throw new BadRequestException(`"${stepLabel(step)}" has no sub-task "${key}"`);
    if (list[i].na) throw new BadRequestException(`"${String(list[i].label)}" doesn't apply to this customer`);
    const next = list.map((t, j) =>
      j === i
        ? { ...t, done, at: done ? new Date().toISOString() : null, by: done ? actor.name : null, source: done ? source.kind : null, emailLogId: done ? (source.emailLogId ?? null) : null }
        : t,
    );
    await this.prisma.tradeStep.update({ where: { id, organizationId }, data: { subtasks: next as any } });
    return this.read(this.prisma, organizationId, id);
  }

  private read(db: Db, organizationId: string, id: string) {
    return db.tradeStep.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        contractId: true,
        shipmentId: true,
        orderId: true,
        code: true,
        title: true,
        displayNo: true,
        sortOrder: true,
        requiredDocTypes: true,
        optionalDocTypes: true,
        requiredFields: true,
        isOngoing: true,
        status: true,
        holdOpen: true,
        notApplicable: true,
        subtasks: true,
        updatedById: true,
        updatedByName: true,
        completedAt: true,
        updatedAt: true,
      },
    });
  }
}

const label = (status: string) => status.toLowerCase().replace('_', ' ');
