import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../common/prisma.service';
import { REQUIRES_MODULE_KEY } from './decorators/requires-module.decorator';

/**
 * Round Y: module gating at the API. Runs after ClerkAuthGuard (global guards run in registration order), reads the
 * @RequiresModule(code) metadata of the route or its controller and refuses (403) when request.userOrganization —
 * the org the request is scoped to, the admin "viewing as" override included — has no enabled OrganizationModule
 * row for that code. Routes without the metadata are untouched; so are requests with no organization (public
 * routes, webhooks). The answer is cached 60 s per (org, module).
 */
@Injectable()
export class ModuleGuard implements CanActivate {
  private readonly logger = new Logger(ModuleGuard.name);
  private readonly cache = new Map<string, { at: number; enabled: boolean }>();
  static readonly TTL_MS = 60_000;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const code = this.reflector.getAllAndOverride<string | undefined>(REQUIRES_MODULE_KEY, [context.getHandler(), context.getClass()]);
    if (!code) return true;
    const request = context.switchToHttp().getRequest();
    const orgId: string | undefined = request?.userOrganization?.id;
    if (!orgId) return true;
    if (!(await this.enabled(orgId, code))) {
      this.logger.warn(`module ${code} is not enabled for org ${orgId}: ${request.method} ${request.url} refused`);
      throw new ForbiddenException(`The ${code} module is not enabled for this organization`);
    }
    return true;
  }

  /** Enabled iff the org has an enabled row for the module (a missing row = the catalog default, which is off for opt-in modules like SHIPMENTS). */
  async enabled(organizationId: string, moduleCode: string): Promise<boolean> {
    const key = `${organizationId}:${moduleCode}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ModuleGuard.TTL_MS) return hit.enabled;
    const row = await this.prisma.organizationModule.findFirst({ where: { organizationId, moduleCode, enabled: true }, select: { id: true } }).catch(() => null);
    const enabled = !!row;
    this.cache.set(key, { at: Date.now(), enabled });
    return enabled;
  }

  /** Forget a cached answer (an admin toggled the module). */
  forget(organizationId: string, moduleCode?: string) {
    for (const k of [...this.cache.keys()]) if (k.startsWith(`${organizationId}:`) && (!moduleCode || k.endsWith(`:${moduleCode}`))) this.cache.delete(k);
  }
}
