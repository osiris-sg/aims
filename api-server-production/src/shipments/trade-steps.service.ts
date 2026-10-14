import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { TradeActor } from './shipments.request';
import { hasExactlyOneOwner, missingDocTypes, stepLabel } from './shipments.rules';
import { Db, TradeConfigService } from './trade-config.service';

type StepAction = 'start' | 'complete' | 'reopen';

/**
 * Step status changes. No ordering is enforced between steps; the rules are:
 * the parent contract/shipment must be OPEN, DONE needs every required doc
 * type linked to the same parent. Steps can't be skipped.
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
          contractId: true,
          shipmentId: true,
          contract: { select: { contractNo: true, status: true } },
          shipment: { select: { blNumber: true, status: true } },
        },
      });
      if (!step) throw new NotFoundException('Step not found');
      if (!hasExactlyOneOwner(step)) throw new BadRequestException('Step is not attached to exactly one contract or shipment');

      const owner = step.contractId
        ? { kind: 'contract', label: `Contract ${step.contract?.contractNo}`, status: step.contract?.status }
        : { kind: 'shipment', label: step.shipment?.blNumber ? `Shipment ${step.shipment.blNumber}` : 'This shipment', status: step.shipment?.status };
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
          const present = await this.config.presentDocTypes(tx, organizationId, step.contractId ? { contractId: step.contractId } : { shipmentId: step.shipmentId });
          const missing = missingDocTypes(step.requiredDocTypes, present);
          if (missing.length) {
            const labels = await this.config.docTypeLabels(organizationId, tx);
            throw new BadRequestException(`Cannot complete "${stepLabel(step)}": missing required document(s) on this ${owner.kind}: ${missing.map((c) => labels.get(c) ?? c).join(', ')}`);
          }
          data = { status: 'DONE', completedAt: now, skipReason: null, ...stamp };
          break;
        }
        case 'reopen':
          // SKIPPED can't be set any more; a legacy SKIPPED row can still be reopened.
          if (step.status !== 'DONE' && step.status !== 'SKIPPED') {
            throw new BadRequestException(`"${stepLabel(step)}" is ${label(step.status)} — only a done step can be reopened`);
          }
          data = { status: 'IN_PROGRESS', completedAt: null, skipReason: null, ...stamp };
          break;
      }
      await tx.tradeStep.update({ where: { id, organizationId }, data });
      return this.read(tx, organizationId, id);
    });
  }

  private read(db: Db, organizationId: string, id: string) {
    return db.tradeStep.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        contractId: true,
        shipmentId: true,
        code: true,
        title: true,
        displayNo: true,
        sortOrder: true,
        requiredDocTypes: true,
        isOngoing: true,
        status: true,
        updatedById: true,
        updatedByName: true,
        completedAt: true,
        updatedAt: true,
      },
    });
  }
}

const label = (status: string) => status.toLowerCase().replace('_', ' ');
