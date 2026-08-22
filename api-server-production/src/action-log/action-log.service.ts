import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

// Non-human actors are displayed as "System creation" (guru, 2026-08-21).
export const SYSTEM_ACTOR_NAME = 'System creation';

export type ActorType = 'USER' | 'API_KEY' | 'GUEST' | 'SYSTEM';

export interface ActionLogEntry {
  actorType: ActorType;
  actorId: string;
  actorName?: string | null;
  actorEmail?: string | null;
  organizationId?: string | null;
  homeOrgId?: string | null;
  channel?: string | null;
  method?: string | null;
  path?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  details?: any;
  status?: 'SUCCESS' | 'FAILURE';
}

@Injectable()
export class ActionLogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fire-and-forget write. Never throws — a logging failure must never break
   * the request it describes. Callers should NOT await unless they need to.
   */
  async log(entry: ActionLogEntry): Promise<void> {
    try {
      await (this.prisma as any).actionLog.create({
        data: {
          actorType: entry.actorType,
          actorId: (entry.actorId || 'unknown').substring(0, 120),
          actorName: entry.actorName?.substring(0, 120),
          actorEmail: entry.actorEmail?.substring(0, 120),
          organizationId: entry.organizationId || null,
          homeOrgId: entry.homeOrgId || null,
          channel: entry.channel?.substring(0, 40),
          method: entry.method?.substring(0, 10),
          path: entry.path?.substring(0, 300),
          action: entry.action.substring(0, 60),
          resource: entry.resource.substring(0, 60),
          resourceId: entry.resourceId?.substring(0, 120),
          statusCode: entry.statusCode ?? null,
          durationMs: entry.durationMs ?? null,
          ipAddress: entry.ipAddress?.substring(0, 45),
          userAgent: entry.userAgent?.substring(0, 300),
          details: entry.details ?? undefined,
          status: entry.status || 'SUCCESS',
        },
      });
    } catch (e: any) {
      console.error('[action-log] write failed:', e?.message || e);
    }
  }

  /** Convenience for cron jobs / pipelines — shows as "System creation". */
  system(job: string, action: string, resource: string, opts: Partial<ActionLogEntry> = {}): void {
    void this.log({
      actorType: 'SYSTEM',
      actorId: `system:${job}`,
      actorName: SYSTEM_ACTOR_NAME,
      channel: 'cron',
      action,
      resource,
      ...opts,
    });
  }

  async query(filters: {
    organizationId?: string;
    actorType?: string;
    actorId?: string;
    action?: string;
    resource?: string;
    resourceId?: string;
    status?: string;
    search?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
  }) {
    const { page = 1, limit = 25 } = filters;
    const where: any = {};
    if (filters.organizationId) where.organizationId = filters.organizationId;
    if (filters.actorType) where.actorType = filters.actorType;
    if (filters.actorId) where.actorId = filters.actorId;
    if (filters.action) where.action = filters.action;
    if (filters.resource) where.resource = filters.resource;
    if (filters.resourceId) where.resourceId = filters.resourceId;
    if (filters.status) where.status = filters.status;
    if (filters.search) {
      where.OR = [
        { actorName: { contains: filters.search, mode: 'insensitive' } },
        { actorEmail: { contains: filters.search, mode: 'insensitive' } },
        { path: { contains: filters.search, mode: 'insensitive' } },
        { resource: { contains: filters.search, mode: 'insensitive' } },
        { resourceId: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = filters.startDate;
      if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

    const [logs, total] = await Promise.all([
      (this.prisma as any).actionLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      (this.prisma as any).actionLog.count({ where }),
    ]);
    return { logs, total, page, limit };
  }
}
