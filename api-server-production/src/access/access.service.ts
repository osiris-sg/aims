import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import type { AdminActor } from '../auth/admin-scope';
import { ROLE_PRESETS } from '../roles/role-presets';
import { CUSTOM_ACCESS_ROLE_NAME, CUSTOM_PREFIX, accessFlags, invalidateCustomAccess } from './custom-access';
import {
  ACCESS_TABS,
  PRESET_TAB_ACCESS,
  roleModulesFor,
  normalizeTabAccess,
  permissionsFor,
  readTabAccess,
  tabChanges,
  type TabAccessMap,
} from './tab-access';

/** Roles that may manage roles and custom access (with the platform admin). */
export const MANAGER_ROLES = new Set(['Admin', 'superadmin']);
const RESERVED = new Set([...ROLE_PRESETS.map((p) => p.name), 'superadmin', 'osirisadmin', 'field-tech', CUSTOM_ACCESS_ROLE_NAME].map((n) => n.toLowerCase()));

/** "Sales edit, Orders view" — a custom role's one-line summary (its description after the prefix). */
export function accessSummary(map: TabAccessMap): string {
  const parts = ACCESS_TABS.filter((t) => map[t.key] !== 'none').map((t) => `${t.label} ${map[t.key]}`);
  return parts.length ? parts.join(', ') : 'No access';
}

const cleanName = (raw: unknown) => String(raw ?? '').replace(/\s+/g, ' ').trim();

@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): any {
    return this.prisma as any;
  }

  /** The org must have Custom access on. */
  private async assertOn(organizationId: string) {
    if (!(await accessFlags(this.prisma, organizationId)).custom) throw new ForbiddenException('Custom access is off for this organisation');
  }

  private async activeRoleNames(userId: string, organizationId: string): Promise<string[]> {
    const rows: any[] = await this.db.userRole.findMany({ where: { userId, organizationId, isActive: true }, select: { role: { select: { name: true } } } });
    return rows.map((r) => r.role?.name).filter(Boolean);
  }

  /** May this person create roles / set custom access here? Admin or superadmin (not narrowed by their own Custom access), or the platform admin. */
  async canManage(organizationId: string, actor: AdminActor): Promise<boolean> {
    if (actor.platform) return true;
    if (!actor.userId) return false;
    const names = await this.activeRoleNames(actor.userId, organizationId);
    if (!names.some((n) => MANAGER_ROLES.has(n))) return false;
    const own = await this.db.customAccess?.findFirst?.({ where: { organizationId, kind: 'USER', subjectId: actor.userId }, select: { tabs: true } });
    return !own || readTabAccess(own.tabs).orgSettings === 'edit';
  }

  private async assertManager(organizationId: string, actor: AdminActor) {
    await this.assertOn(organizationId);
    if (!(await this.canManage(organizationId, actor))) throw new ForbiddenException('Only an Admin can change roles and access');
  }

  /** The tab catalogue + the presets' table + whether the caller may manage. */
  async overview(organizationId: string, actor: AdminActor) {
    const enabled = (await accessFlags(this.prisma, organizationId)).custom;
    return {
      enabled,
      canManage: enabled ? await this.canManage(organizationId, actor) : false,
      tabs: ACCESS_TABS.map((t) => ({ key: t.key, label: t.label, levels: t.levels })),
      presets: ROLE_PRESETS.filter((p) => PRESET_TAB_ACCESS[p.name]).map((p) => ({ name: p.name, label: p.label, tabs: PRESET_TAB_ACCESS[p.name] })),
    };
  }

  /** Org Settings > Roles: the custom roles (with their maps and holders) and the org's presets. */
  async listRoles(organizationId: string, actor: AdminActor) {
    await this.assertManager(organizationId, actor);
    const [roles, rows] = await Promise.all([
      this.db.role.findMany({ where: { organizationId }, select: { id: true, name: true, description: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
      this.db.customAccess.findMany({ where: { organizationId, kind: 'ROLE' }, select: { subjectId: true, tabs: true } }),
    ]);
    const mapOf = new Map<string, TabAccessMap>(rows.map((r: any) => [r.subjectId, readTabAccess(r.tabs)]));
    const holders: any[] = roles.length
      ? await this.db.userRole.groupBy({ by: ['roleId'], where: { organizationId, isActive: true, roleId: { in: roles.map((r: any) => r.id) } }, _count: { _all: true } }).catch(() => [])
      : [];
    const countOf = new Map<string, number>(holders.map((h: any) => [h.roleId, h._count?._all ?? 0]));
    const presetLabel = new Map(ROLE_PRESETS.map((p) => [p.name, p.label]));
    return {
      roles: roles
        .filter((r: any) => mapOf.has(r.id))
        .map((r: any) => ({ id: r.id, name: r.name, tabs: mapOf.get(r.id), users: countOf.get(r.id) ?? 0 })),
      presets: roles
        .filter((r: any) => !mapOf.has(r.id) && PRESET_TAB_ACCESS[r.name])
        .map((r: any) => ({ id: r.id, name: r.name, label: presetLabel.get(r.name) ?? r.name, tabs: PRESET_TAB_ACCESS[r.name], users: countOf.get(r.id) ?? 0 })),
    };
  }

  private async catalogueIds(map: TabAccessMap): Promise<string[]> {
    const catalogue: any[] = await this.db.permission.findMany({ select: { id: true, name: true } });
    const want = new Set(permissionsFor(map, catalogue.map((p) => p.name)));
    return catalogue.filter((p) => want.has(p.name)).map((p) => p.id);
  }

  private parseTabs(raw: unknown, allowOrgSettingsEdit: boolean): TabAccessMap {
    try {
      return normalizeTabAccess(raw, { allowOrgSettingsEdit });
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'Invalid access');
    }
  }

  private async assertFreeName(organizationId: string, name: string, exceptId?: string) {
    if (!name) throw new BadRequestException('Enter a role name');
    if (name.length > 40) throw new BadRequestException('A role name is at most 40 characters');
    if (RESERVED.has(name.toLowerCase())) throw new BadRequestException(`"${name}" is a built-in role name`);
    const clash = await this.db.role.findFirst({ where: { organizationId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { id: true } });
    if (clash) throw new ConflictException(`A role named "${name}" already exists`);
  }

  async createRole(organizationId: string, body: { name?: unknown; tabs?: unknown }, actor: AdminActor) {
    await this.assertManager(organizationId, actor);
    const name = cleanName(body?.name);
    await this.assertFreeName(organizationId, name);
    // Nobody gets Org Settings edit through a role: that is the Admin role's alone.
    const tabs = this.parseTabs(body?.tabs, false);
    const ids = await this.catalogueIds(tabs);
    const role = await this.db.role.create({
      data: { organizationId, name, description: `${CUSTOM_PREFIX}${accessSummary(tabs)}`, allowedModules: roleModulesFor(tabs), permissions: { connect: ids.map((id) => ({ id })) } },
      select: { id: true, name: true },
    });
    try {
      await this.db.customAccess.create({ data: { organizationId, kind: 'ROLE', subjectId: role.id, tabs, createdBy: actor.userId ?? null, updatedBy: actor.userId ?? null } });
    } catch (e) {
      await this.db.role.delete({ where: { id: role.id } }).catch(() => undefined);
      throw e;
    }
    invalidateCustomAccess(organizationId);
    return { role: { id: role.id, name: role.name, tabs, users: 0 }, log: { role: role.name, tabs: accessSummary(tabs) } };
  }

  private async customRole(organizationId: string, id: string) {
    const role = await this.db.role.findFirst({ where: { id, organizationId }, select: { id: true, name: true } });
    if (!role) throw new NotFoundException('Role not found');
    const row = await this.db.customAccess.findFirst({ where: { organizationId, kind: 'ROLE', subjectId: id }, select: { id: true, tabs: true } });
    if (!row) throw new BadRequestException('Built-in roles cannot be changed here');
    return { role, row, tabs: readTabAccess(row.tabs) };
  }

  async updateRole(organizationId: string, id: string, body: { name?: unknown; tabs?: unknown }, actor: AdminActor) {
    await this.assertManager(organizationId, actor);
    const { role, row, tabs: before } = await this.customRole(organizationId, id);
    const oldName: string = role.name;
    const name = body?.name === undefined ? oldName : cleanName(body.name);
    if (name !== oldName) await this.assertFreeName(organizationId, name, id);
    const tabs = body?.tabs === undefined ? before : this.parseTabs(body.tabs, false);
    const ids = await this.catalogueIds(tabs);
    await this.db.role.update({
      where: { id },
      data: { name, description: `${CUSTOM_PREFIX}${accessSummary(tabs)}`, allowedModules: roleModulesFor(tabs), permissions: { set: ids.map((pid) => ({ id: pid })) } },
    });
    await this.db.customAccess.update({ where: { id: row.id }, data: { tabs, updatedBy: actor.userId ?? null } });
    invalidateCustomAccess(organizationId);
    ClerkAuthGuard.invalidateAll();
    const changes = tabChanges(before, tabs);
    return {
      role: { id, name, tabs },
      log: { role: name, ...(name !== oldName ? { renamed: { from: oldName, to: name } } : {}), ...(Object.keys(changes).length ? { changes } : {}) },
    };
  }

  async deleteRole(organizationId: string, id: string, actor: AdminActor) {
    await this.assertManager(organizationId, actor);
    const { role, row, tabs } = await this.customRole(organizationId, id);
    const holders = await this.db.userRole.count({ where: { roleId: id, organizationId, isActive: true } });
    if (holders > 0) throw new ConflictException(`Take this role off its ${holders} user${holders === 1 ? '' : 's'} first`);
    // Switched-off assignments hold nothing; they go with the role.
    await this.db.userRole.deleteMany({ where: { roleId: id, organizationId, isActive: false } });
    await this.db.role.delete({ where: { id } });
    await this.db.customAccess.delete({ where: { id: row.id } }).catch(() => undefined);
    invalidateCustomAccess(organizationId);
    return { deleted: true, log: { role: role.name, tabs: accessSummary(tabs) } };
  }

  /** Edit User: the person's own Custom access. */
  async getUserAccess(organizationId: string, userId: string, actor: AdminActor) {
    await this.assertManager(organizationId, actor);
    const [row, names] = await Promise.all([
      this.db.customAccess.findFirst({ where: { organizationId, kind: 'USER', subjectId: userId }, select: { tabs: true } }),
      this.activeRoleNames(userId, organizationId),
    ]);
    return { enabled: !!row, tabs: row ? readTabAccess(row.tabs) : null, isAdmin: names.includes('Admin'), isSuperadmin: names.includes('superadmin') };
  }

  async setUserAccess(organizationId: string, userId: string, body: { enabled?: unknown; tabs?: unknown }, actor: AdminActor) {
    await this.assertManager(organizationId, actor);
    if (!userId) throw new BadRequestException('No user');
    if (actor.userId && actor.userId === userId) throw new BadRequestException('You cannot change your own access');
    const member = await this.db.userOrganization.findFirst({ where: { userId, organizationId, isActive: true }, select: { userId: true } });
    if (!member) throw new NotFoundException('This person is not a member of this organisation');
    const names = await this.activeRoleNames(userId, organizationId);
    const existing = await this.db.customAccess.findFirst({ where: { organizationId, kind: 'USER', subjectId: userId }, select: { id: true, tabs: true } });
    const before = existing ? readTabAccess(existing.tabs) : null;
    const enabled = body?.enabled === true;
    let after: TabAccessMap | null = null;
    if (enabled) {
      if (names.includes('superadmin')) throw new BadRequestException('superadmin keeps full access');
      // Org Settings edit only for someone who holds the Admin role.
      after = this.parseTabs(body?.tabs, names.includes('Admin'));
      if (existing) await this.db.customAccess.update({ where: { id: existing.id }, data: { tabs: after, updatedBy: actor.userId ?? null } });
      else await this.db.customAccess.create({ data: { organizationId, kind: 'USER', subjectId: userId, tabs: after, createdBy: actor.userId ?? null, updatedBy: actor.userId ?? null } });
    } else if (existing) {
      await this.db.customAccess.delete({ where: { id: existing.id } });
    }
    invalidateCustomAccess(organizationId);
    ClerkAuthGuard.invalidateUser(userId);
    const changes = tabChanges(before, after);
    return {
      enabled: !!after,
      tabs: after,
      log: {
        userId,
        customAccess: { from: before ? 'on' : 'off', to: after ? 'on' : 'off' },
        ...(after ? { access: accessSummary(after) } : {}),
        ...(Object.keys(changes).length ? { changes } : {}),
      },
    };
  }
}
