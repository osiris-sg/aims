/**
 * Every @Permissions() string, checked against the catalogue at boot.
 *
 * A guard that names a permission no row defines is a permanently closed
 * door: nobody can hold it, so the endpoint 403s for every user in every org,
 * for good. /dashboard/ops/stock, /ops/movements and /ops/map asked for
 * 'inventory:read' while the whole codebase (and the seed) use 'inventories'.
 * Nothing failed at startup, nothing logged; it surfaced weeks later when
 * someone asked the WhatsApp agent about stock and was told the dashboard was
 * "blocked for your account" (guru 2026-10-22).
 *
 * This WARNS rather than refusing to boot. A dead guard denies access, which
 * is the safe direction to fail, and taking the API down over it would turn a
 * locked report into an outage. The log line is the thing that was missing.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './decorators/permissions.decorator';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class PermissionAuditService implements OnModuleInit {
  private readonly logger = new Logger(PermissionAuditService.name);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.audit();
    } catch (e: any) {
      // Never let the check itself stop the server coming up.
      this.logger.warn(`Permission audit skipped: ${e?.message}`);
    }
  }

  /** Returns the guards that name a permission the database does not define. */
  async audit(): Promise<string[]> {
    const used = new Set<string>();
    for (const wrapper of this.discovery.getControllers()) {
      const instance = wrapper.instance;
      const proto = instance && Object.getPrototypeOf(instance);
      if (!proto) continue;
      // Class-level guards count too.
      for (const p of this.reflector.get<string[]>(PERMISSIONS_KEY, wrapper.metatype as any) || []) used.add(p);
      for (const method of this.scanner.getAllMethodNames(proto)) {
        for (const p of this.reflector.get<string[]>(PERMISSIONS_KEY, proto[method]) || []) used.add(p);
      }
    }
    if (!used.size) return [];

    const defined = new Set(
      (await this.prisma.permission.findMany({ select: { resource: true, action: true } })).map(
        (p) => `${p.resource}:${p.action}`,
      ),
    );
    const dead = [...used].filter((u) => !defined.has(u)).sort();

    if (dead.length) {
      this.logger.error(
        `${dead.length} endpoint permission(s) are not defined, so NOBODY can satisfy them: ${dead.join(', ')}. ` +
          `Either seed the permission or correct the guard — check the plural ("inventories", not "inventory").`,
      );
    } else {
      this.logger.log(`Permission audit: all ${used.size} endpoint permissions exist`);
    }
    return dead;
  }
}
