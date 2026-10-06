import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { resolveTier } from '../common/role-tier';

/**
 * Designer advances (guru 2026-10-06): a designer requests money ahead of
 * commission; Senior Manager/Master decide. Approved advances surface on the
 * project's Contract & P&L "Advanced to designer" line and net off against
 * commission at handover; `paid` is stamped when finance pays it (bi-weekly).
 */
@Injectable()
export class AdvancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(organizationId: string, userId: string, userName: string | null, dto: { amount: number; projectId?: string | null; reason?: string | null }) {
    const amount = Number(dto.amount);
    if (!(amount > 0)) throw new BadRequestException('Amount must be greater than zero');
    let projectName: string | null = null;
    if (dto.projectId) {
      const proj = await this.prisma.project.findFirst({ where: { id: dto.projectId, organizationId }, select: { name: true } });
      if (!proj) throw new NotFoundException('Project not found');
      projectName = proj.name;
    }
    const row = await this.prisma.designerAdvance.create({
      data: {
        organizationId,
        projectId: dto.projectId || null,
        projectName,
        requestedById: userId,
        requestedByName: userName,
        amount,
        reason: dto.reason?.slice(0, 500) || null,
      },
    });
    // Management hears about it in the bell (org-wide; designers don't get
    // management traffic, so this never echoes back to other designers).
    await this.notifications
      .emit({
        organizationId,
        kind: 'advance_requested',
        title: `Advance request: ${userName || 'a designer'} — S$ ${amount.toFixed(2)}`,
        body: [projectName, dto.reason].filter(Boolean).join(' · ') || null,
        entityType: 'advance',
        entityId: row.id,
        linkUrl: '/portal/dashboard',
      })
      .catch(() => null);
    return row;
  }

  /** Tier-scoped list: designers their own, juniors their team's, senior/master all. */
  async list(organizationId: string, callerUserId: string | undefined, status?: string) {
    const scope = await resolveTier(this.prisma, organizationId, callerUserId);
    const where: any = { organizationId };
    if (status) where.status = status;
    if (scope.tier === 'designer') where.requestedById = callerUserId;
    else if (scope.tier === 'junior') where.requestedById = { in: scope.teamUserIds || [callerUserId] };
    const rows = await this.prisma.designerAdvance.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
    return { rows, viewer: { tier: scope.tier, canDecide: scope.tier === 'master' || scope.tier === 'senior' } };
  }

  /** Approve / decline — Senior Manager and Master only (money leaves the company). */
  async decide(organizationId: string, callerUserId: string | undefined, callerName: string | null, id: string, dto: { approve: boolean; note?: string | null }) {
    const scope = await resolveTier(this.prisma, organizationId, callerUserId);
    if (scope.tier !== 'master' && scope.tier !== 'senior') {
      throw new ForbiddenException('Only Senior Managers and above can decide advance requests');
    }
    const row = await this.prisma.designerAdvance.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException('Advance request not found');
    if (row.status !== 'pending') throw new BadRequestException(`Already ${row.status}`);
    const updated = await this.prisma.designerAdvance.update({
      where: { id },
      data: {
        status: dto.approve ? 'approved' : 'declined',
        decidedById: callerUserId,
        decidedByName: callerName,
        decidedAt: new Date(),
        decisionNote: dto.note?.slice(0, 500) || null,
      },
    });
    await this.notifications
      .emit({
        organizationId,
        kind: 'advance_decided',
        title: `Advance ${dto.approve ? 'approved' : 'declined'}: S$ ${row.amount.toFixed(2)}${row.projectName ? ` · ${row.projectName}` : ''}`,
        body: dto.note || null,
        entityType: 'advance',
        entityId: id,
        forUserId: row.requestedById,
        linkUrl: '/portal/dashboard',
      })
      .catch(() => null);
    return updated;
  }

  /** Finance stamps the actual payout (approved → paid). Senior/master only. */
  async markPaid(organizationId: string, callerUserId: string | undefined, id: string) {
    const scope = await resolveTier(this.prisma, organizationId, callerUserId);
    if (scope.tier !== 'master' && scope.tier !== 'senior') {
      throw new ForbiddenException('Only Senior Managers and above can mark an advance paid');
    }
    const row = await this.prisma.designerAdvance.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundException('Advance request not found');
    if (row.status !== 'approved') throw new BadRequestException(`Only an approved advance can be marked paid (this one is ${row.status})`);
    return this.prisma.designerAdvance.update({ where: { id }, data: { status: 'paid', paidAt: new Date() } });
  }

  /** Approved+paid advances for one project — the Contract & P&L "Advanced to designer" figure. */
  async projectAdvanceTotal(organizationId: string, projectId: string): Promise<number> {
    const agg = await this.prisma.designerAdvance.aggregate({
      where: { organizationId, projectId, status: { in: ['approved', 'paid'] } },
      _sum: { amount: true },
    });
    return agg._sum.amount || 0;
  }
}
