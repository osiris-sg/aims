import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { computeFieldAccess, grantFromTabMap, type FieldAccess } from './field-access';
import { accessFlags, resolveCustomAccess } from '../../access/custom-access';
import { FIELD_AREAS, fieldAreaOn, type FieldArea } from './field-flags';
import { todayIn } from './time';

/** Who is calling and what they may see in the Field module (one per request). */
export interface FieldCtx {
  organizationId: string;
  userId: string;
  userName: string;
  features: Record<string, unknown>;
  timezone: string;
  access: FieldAccess;
  /** The Worker this login is (Worker.userId), if any. */
  workerId: string | null;
  /** Supervisor scope (ported lib/supervision.ts): sites they supervise, people in the teams they lead today. */
  supervisedSiteIds: string[];
  supervisedWorkerIds: string[];
}

/**
 * Builds the FieldCtx. Supervision is ported from siteclock backend/src/lib/supervision.ts @62b7d9d:
 * a site supervisor (FieldSiteAssignment.isSupervisor) and / or a team supervisor
 * (FieldTeamSupervisor on an active team: its members as the teams stand today).
 */
@Injectable()
export class FieldContextService {
  constructor(private readonly prisma: PrismaService) {}
  private get db(): any {
    return this.prisma as any;
  }

  async features(organizationId: string): Promise<Record<string, unknown>> {
    const ui = await this.db.organizationUIConfig.findUnique({ where: { organizationId }, select: { features: true } });
    return (ui?.features as Record<string, unknown>) || {};
  }

  async timezone(organizationId: string): Promise<string> {
    const s = await this.db.fieldSettings.findUnique({ where: { organizationId }, select: { timezone: true } });
    return s?.timezone || 'Asia/Singapore';
  }

  /** area 'any': the module plus at least one area on (GET /field/me). */
  async build(req: any, area: FieldArea | 'any'): Promise<FieldCtx> {
    const organizationId: string | undefined = req.userOrganization?.id;
    if (!organizationId) throw new ForbiddenException('User is not assigned to any organization');
    const features = await this.features(organizationId);
    // Flag off: the route does not exist for this org.
    const on = area === 'any' ? FIELD_AREAS.some((a) => fieldAreaOn(features, a)) : fieldAreaOn(features, area);
    if (!on) throw new NotFoundException();
    const userId: string = req.user?.id ?? '';
    const roles: Array<{ role: { id: string; name: string } }> = await this.db.userRole.findMany({
      where: { userId, organizationId, isActive: true },
      select: { role: { select: { id: true, name: true } } },
    });
    // Custom access orgs: the HR tabs of the person's tab map decide (null = roles by name, as before).
    const osiris = req.isOsirisAdmin === true;
    const flags = osiris ? { custom: false, presets: false } : await accessFlags(this.db, organizationId);
    const resolved = osiris
      ? null
      : await resolveCustomAccess(
          this.db,
          organizationId,
          userId,
          roles.filter((r) => r.role).map((r) => ({ id: r.role.id, name: r.role.name })),
        );
    const worker = userId ? await this.db.worker.findFirst({ where: { organizationId, userId, active: true }, select: { id: true, name: true } }) : null;
    const timezone = await this.timezone(organizationId);
    const [supervisedSiteIds, supervisedWorkerIds] = worker
      ? await Promise.all([this.supervisedSiteIds(organizationId, worker.id), this.supervisedWorkerIds(organizationId, worker.id, timezone)])
      : [[], []];
    const access = computeFieldAccess({
      isOsirisAdmin: osiris,
      roleNames: roles.map((r) => r.role?.name ?? ''),
      supervises: supervisedSiteIds.length > 0 || supervisedWorkerIds.length > 0,
      grant: resolved ? grantFromTabMap(resolved.map) : null,
      customAccessOrg: flags.custom,
    });
    // Same naming as the Activity Log (action-log.interceptor resolveActor).
    const u: any = req.user || {};
    const userName = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || worker?.name || u.emailAddresses?.[0]?.emailAddress || 'AIMS user';
    return { organizationId, userId, userName, features, timezone, access, workerId: worker?.id ?? null, supervisedSiteIds, supervisedWorkerIds };
  }

  /** Sites this supervisor supervises. */
  async supervisedSiteIds(organizationId: string, workerId: string): Promise<string[]> {
    const rows = await this.db.fieldSiteAssignment.findMany({ where: { organizationId, workerId, isSupervisor: true }, select: { siteId: true } });
    return rows.map((r: any) => r.siteId);
  }

  /** People in the (active) teams this supervisor leads, as the teams stand today. */
  async supervisedWorkerIds(organizationId: string, workerId: string, timezone: string): Promise<string[]> {
    const sups = await this.db.fieldTeamSupervisor.findMany({ where: { organizationId, workerId }, select: { teamId: true } });
    if (!sups.length) return [];
    const activeTeams = await this.db.workerTeam.findMany({ where: { organizationId, id: { in: sups.map((s: any) => s.teamId) }, active: true }, select: { id: true } });
    if (!activeTeams.length) return [];
    const today = todayIn(timezone);
    const stints = await this.db.fieldTeamStint.findMany({
      where: { organizationId, teamId: { in: activeTeams.map((t: any) => t.id) }, startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] },
      select: { workerId: true },
    });
    return [...new Set<string>(stints.map((s: any) => s.workerId))];
  }
}

/** Prisma filter for rows with siteId + workerId the caller may see (ported reviewScope). */
export function reviewScope(ctx: FieldCtx, area: FieldArea): Record<string, unknown> {
  if (!ctx.access.scoped[area]) return {};
  return { OR: [{ siteId: { in: ctx.supervisedSiteIds } }, { workerId: { in: ctx.supervisedWorkerIds } }] };
}

/** May the caller review this worker's row at this site? (ported mayReview) */
export function mayReview(ctx: FieldCtx, area: FieldArea, siteId: string, workerId: string): boolean {
  if (!ctx.access.scoped[area]) return true;
  return ctx.supervisedSiteIds.includes(siteId) || ctx.supervisedWorkerIds.includes(workerId);
}
