import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { resolveTier } from '../common/role-tier';

/**
 * Row-level scope for Designer-only users (CIEL 09-14): they may only touch
 * projects where they are the designer in charge. Users holding any broader
 * role (Management, admin…) and osiris-admins pass untouched.
 *
 * The list endpoints already filter server-side; this guard closes the
 * detail/sub-resource routes, so a guessed or leaked project id — from the
 * portal or the WA agent's api_get — gets the same 404 a stranger would.
 * Runs AFTER ClerkAuthGuard (req.user + req.userOrganization are set).
 */
@Injectable()
export class DesignerProjectScopeGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userId: string | undefined = req.user?.id;
    const organizationId: string | undefined = req.userOrganization?.id;
    if (!userId || !organizationId || req.isOsirisAdmin) return true;

    const scope = await resolveTier(this.prisma, organizationId, userId);
    if (scope.tier === 'master' || scope.tier === 'senior') return true;

    const projectId = await this.resolveProjectId(req.params || {}, organizationId);
    if (!projectId) return true; // not a project-scoped route

    const p = await this.prisma.project.findFirst({ where: { id: projectId, organizationId }, select: { designerUserId: true } });
    if (!p) return true; // let the handler 404 with its own message
    // Designer: their own projects. Junior Manager: their team's projects.
    if (scope.tier === 'designer' && p.designerUserId === userId) return true;
    if (scope.tier === 'junior' && p.designerUserId && (scope.teamUserIds || []).includes(p.designerUserId)) return true;
    throw new NotFoundException('Project not found'); // no existence leak
  }

  /** Project id straight from :id, or via the sub-resource row's projectId. */
  private async resolveProjectId(params: Record<string, string>, organizationId: string): Promise<string | null> {
    if (params.id) return params.id;
    if (params.costId) {
      return (await this.prisma.projectCost.findFirst({ where: { id: params.costId, organizationId }, select: { projectId: true } }))?.projectId || null;
    }
    if (params.itemId) {
      return (await this.prisma.projectScheduleItem.findFirst({ where: { id: params.itemId, organizationId }, select: { projectId: true } }))?.projectId || null;
    }
    if (params.stepId) {
      return (await this.prisma.projectQuestStep.findFirst({ where: { id: params.stepId, organizationId }, select: { projectId: true } }))?.projectId || null;
    }
    if (params.milestoneId) {
      return (await this.prisma.projectMilestone.findFirst({ where: { id: params.milestoneId, organizationId }, select: { projectId: true } }))?.projectId || null;
    }
    if (params.docId) {
      return (await this.prisma.document.findFirst({ where: { id: params.docId, organizationId }, select: { projectId: true } }))?.projectId || null;
    }
    return null;
  }
}
