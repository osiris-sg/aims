/**
 * WCT round 30 (Elroy 20 Nov 2026): prove that turning features.enableCustomAccess ON for the 4 WCT
 * group orgs changes nothing for their existing members while no CustomAccess rows exist.
 * READ-ONLY: one read-only transaction loads the 4 orgs' members, their role rows (all orgs, so
 * platform admins are recognised), permissions, settings and CustomAccess rows; then the REAL
 * code runs in memory twice (setting off / on): ClerkAuthGuard over a set of routes (header
 * X-Active-Org-Id = the org), UsersService.getUserRoles (= GET /users/me/roles), the Users list
 * "Custom" ids and resolveCustomAccess. Any difference is printed. Nothing is written anywhere.
 *
 *   npx ts-node --transpile-only scripts/wct-r30-custom-access-noop-check.ts --env prod
 *   (--out <file> also writes the report there)
 * dev = DATABASE_URL (public schema), prod = PROD_DATABASE_URL. URLs never printed.
 */
import * as fs from 'fs';
import * as path from 'path';
import { AuthGuard } from '@nestjs/passport';
import { ClerkAuthGuard } from '../src/auth/clerk-auth.guard';
import { PERMISSIONS_KEY } from '../src/auth/decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../src/decorators/public.decorator';
import { UsersService } from '../src/users/users.service';
import { CUSTOM_ACCESS_FLAG, customAccessUserIds, invalidateCustomAccess, resolveCustomAccess } from '../src/access/custom-access';

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Client } = require('pg');

const ORGS: Record<string, string> = {
  '5c700000-0000-4000-8000-5c7000000001': 'WCT (S)',
  '5c700000-0000-4000-8000-5c7000000002': 'Racking',
  '5c700000-0000-4000-8000-5c7000000003': 'YMM',
  '5c700000-0000-4000-8000-5c7000000004': 'BC Air',
};
const ROUTES: Array<[string, string, string[]]> = [
  ['GET', '/orders', ['orders:read']],
  ['PATCH', '/orders/x', ['orders:update']],
  ['DELETE', '/orders/x', ['orders:delete']],
  ['GET', '/journal', ['journal:read']],
  ['POST', '/journal', ['journal:create']],
  ['GET', '/accounting/accounts', ['accounting:read']],
  ['POST', '/import/invoices', []],
  ['GET', '/deliveries', ['maintenance-reports:read']],
  ['POST', '/deliveries/x/cancel', ['maintenance-reports:create']],
  ['POST', '/deliveries/x/verify', ['documents:update']],
  ['POST', '/maintenance-reports/office', ['maintenance-reports:create']],
  ['GET', '/dashboard/role-home', ['dashboard:read']],
  ['GET', '/dashboard/jobs-calendar', ['dashboard:read']],
  ['POST', '/dashboard/jobs-calendar/notes', ['dashboard:read']],
  ['POST', '/documents', ['documents:read']],
  ['POST', '/documents/create-basic', ['documents:create-basic']],
  ['POST', '/documents/update', ['documents:update']],
  ['DELETE', '/documents/delete/x', ['documents:delete']],
  ['GET', '/sales-report', ['documents:read']],
  ['GET', '/inventories', ['inventories:read']],
  ['GET', '/vehicles', ['vehicles:read']],
  ['POST', '/users', ['users:create']],
  ['POST', '/users/list', ['users:read']],
  ['GET', '/users/me/roles', []],
  ['GET', '/action-log', ['audit:read']],
  ['PATCH', '/organizations/x', ['organizations:update']],
];

const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
const ENV = arg('--env') || 'dev';
const OUT = arg('--out');

(async () => {
  const url = ENV === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error(`no database url for --env ${ENV}`);
  const c = new Client({ connectionString: url });
  await c.connect();
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows as any[];
  const orgIds = Object.keys(ORGS);
  let data: any;
  try {
    await c.query('begin read only');
    const members = await q(`select "userId", "organizationId", "isActive", "joinedAt", "lastActiveAt" from "UserOrganization" where "organizationId" = any($1::text[]) and "isActive"`, [orgIds]);
    const userIds = [...new Set(members.map((m) => m.userId))];
    const memberships = await q(`select "userId", "organizationId", "isActive", "joinedAt", "lastActiveAt" from "UserOrganization" where "userId" = any($1::text[]) and "isActive"`, [userIds]);
    const userRoles = await q(`select id, "userId", "roleId", "organizationId", "isActive", "createdAt", "assignedAt" from "UserRole" where "userId" = any($1::text[])`, [userIds]);
    const roleIds = [...new Set(userRoles.map((r) => r.roleId))];
    const roles = await q(`select id, name, description, "organizationId", "allowedModules", "createdAt", "updatedAt" from "Role" where id = any($1::text[])`, [roleIds]);
    const links = await q(`select pr."B" "roleId", p.id, p.name, p.resource, p.action, p.description from "_PermissionToRole" pr join "Permission" p on p.id = pr."A" where pr."B" = any($1::text[])`, [roleIds]);
    const orgs = await q(`select id, name from "Organization" where id = any($1::text[])`, [[...new Set(memberships.map((m) => m.organizationId).concat(roles.map((r) => r.organizationId)))]]);
    const ui = await q(`select "organizationId", features from "OrganizationUIConfig" where "organizationId" = any($1::text[])`, [orgs.map((o) => o.id)]);
    const custom = await q(`select "organizationId", kind, "subjectId", tabs from "CustomAccess" where "organizationId" = any($1::text[])`, [orgIds]).catch(() => null);
    const catalogue = await q(`select id, name, resource, action, description from "Permission"`);
    await c.query('rollback');
    data = { members, memberships, userRoles, roles, links, orgs, ui, custom, catalogue };
  } finally {
    await c.end();
  }

  // ── in-memory, read-only Prisma stand-in (only what the code under test calls) ──
  const permsOf = new Map<string, any[]>();
  for (const l of data.links) (permsOf.get(l.roleId) ?? permsOf.set(l.roleId, []).get(l.roleId)!).push({ id: l.id, name: l.name, resource: l.resource, action: l.action, description: l.description });
  const roleById = new Map<string, any>(data.roles.map((r: any) => [r.id, { ...r, permissions: permsOf.get(r.id) ?? [] }]));
  const orgById = new Map<string, any>(data.orgs.map((o: any) => [o.id, o]));
  const featuresOf = new Map<string, any>(data.ui.map((u: any) => [u.organizationId, u.features || {}]));
  const customRows: any[] = data.custom ?? [];
  const has = (row: any, where: any = {}): boolean =>
    Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === 'OR') return v.some((w: any) => has(row, w));
      if (v && typeof v === 'object' && 'in' in v) return v.in.includes(row[k]);
      return row[k] === v;
    });
  const mk = (flagOn: boolean): any => ({
    organizationUIConfig: {
      findUnique: async ({ where }: any) => {
        const f = { ...(featuresOf.get(where.organizationId) ?? {}) };
        if (ORGS[where.organizationId]) f[CUSTOM_ACCESS_FLAG] = flagOn;
        return { features: f };
      },
    },
    customAccess: { findMany: async ({ where }: any) => customRows.filter((r) => has(r, { organizationId: where.organizationId }) && (!where.OR || has(r, { OR: where.OR })) && (!where.kind || r.kind === where.kind) && (!where.subjectId || has(r, { subjectId: where.subjectId }))) },
    permission: { findMany: async () => data.catalogue },
    organization: { findUnique: async ({ where }: any) => orgById.get(where.id) ?? null },
    userOrganization: {
      findFirst: async ({ where }: any) => {
        const list = data.memberships
          .filter((m: any) => m.userId === where.userId && m.isActive && (!where.organizationId || m.organizationId === where.organizationId))
          .sort((a: any, b: any) => (b.lastActiveAt ? +new Date(b.lastActiveAt) : -1) - (a.lastActiveAt ? +new Date(a.lastActiveAt) : -1) || +new Date(a.joinedAt) - +new Date(b.joinedAt));
        return list[0] ? { userId: list[0].userId, organization: orgById.get(list[0].organizationId) ?? { id: list[0].organizationId, name: list[0].organizationId } } : null;
      },
    },
    userRole: {
      findMany: async ({ where }: any) =>
        data.userRoles
          .filter((r: any) => has(r, where))
          .map((r: any) => ({ ...r, role: roleById.get(r.roleId) })),
    },
  });

  (AuthGuard('clerk') as any).prototype.canActivate = async () => true; // the token is not what is under test
  const run = async (flagOn: boolean) => {
    ClerkAuthGuard.invalidateAll();
    invalidateCustomAccess();
    const prisma = mk(flagOn);
    const users = new UsersService(null as any, prisma, null as any);
    const out = new Map<string, string>();
    for (const org of Object.keys(ORGS)) {
      const people = [...new Set<string>(data.members.filter((m: any) => m.organizationId === org).map((m: any) => m.userId))];
      for (const userId of people) {
        for (const [method, p, perms] of ROUTES) {
          const reflector: any = { getAllAndOverride: (k: string) => (k === IS_PUBLIC_KEY ? false : undefined), get: (k: string) => (k === PERMISSIONS_KEY ? perms : undefined) };
          const req: any = { headers: { 'x-active-org-id': org }, method, originalUrl: p, url: p, user: { id: userId }, params: {}, body: {} };
          const ctx: any = { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => null, getClass: () => null };
          let decision: string;
          try {
            decision = (await new ClerkAuthGuard(reflector, prisma).canActivate(ctx)) ? 'allow' : 'deny';
          } catch (e: any) {
            decision = `403 ${e?.message ?? ''}`;
          }
          out.set(`${ORGS[org]}|${userId}|${method} ${p}`, decision);
        }
        out.set(`${ORGS[org]}|${userId}|me/roles`, JSON.stringify(await users.getUserRoles(userId, org)));
        const rolesHere = data.userRoles.filter((r: any) => r.userId === userId && r.organizationId === org && r.isActive).map((r: any) => roleById.get(r.roleId)).filter(Boolean);
        out.set(`${ORGS[org]}|${userId}|resolveCustomAccess`, JSON.stringify(await resolveCustomAccess(prisma, org, userId, rolesHere)));
      }
      out.set(`${ORGS[org]}|users-list-custom`, JSON.stringify([...(await customAccessUserIds(prisma, org, people))]));
    }
    return out;
  };

  const off = await run(false);
  const on = await run(true);
  const lines: string[] = [];
  const say = (s: string) => {
    lines.push(s);
    console.log(s);
  };
  say(`${ENV}: enableCustomAccess off vs on, 4 WCT group orgs (read-only, ${new Date().toISOString()})`);
  say(`CustomAccess rows in these orgs: ${data.custom === null ? 'table missing' : data.custom.length}`);
  const diffs: string[] = [];
  for (const [k, v] of off) if (on.get(k) !== v) diffs.push(`${k}\n    off: ${v.slice(0, 300)}\n    on:  ${String(on.get(k)).slice(0, 300)}`);
  for (const org of Object.keys(ORGS)) {
    const people = [...new Set<string>(data.members.filter((m: any) => m.organizationId === org).map((m: any) => m.userId))];
    const combos = new Map<string, number>();
    for (const u of people) {
      const names = data.userRoles.filter((r: any) => r.userId === u && r.organizationId === org && r.isActive).map((r: any) => roleById.get(r.roleId)?.name).sort().join('+') || '(no role)';
      combos.set(names, (combos.get(names) ?? 0) + 1);
    }
    const allow = [...off].filter(([k, v]) => k.startsWith(`${ORGS[org]}|`) && v === 'allow').length;
    const nonNull = [...on].filter(([k, v]) => k.startsWith(`${ORGS[org]}|`) && k.endsWith('|resolveCustomAccess') && v !== 'null').length;
    say(`  ${ORGS[org]}: ${people.length} members (${[...combos].map(([n, c]) => `${n} ${c}`).join(', ')}); ${people.length * ROUTES.length} guard decisions (${allow} allowed) + ${people.length} /users/me/roles compared; custom access applies to ${nonNull} people with the flag on`);
  }
  say(`compared: ${off.size} results; differences: ${diffs.length}`);
  for (const d of diffs) say(`  DIFF ${d}`);
  say(diffs.length ? 'RESULT: the flag changes something, see the DIFF lines' : 'RESULT: no difference. With no CustomAccess rows the flag changes no guard decision, no /users/me/roles and no Users list mark for any member.');
  if (OUT) fs.writeFileSync(OUT, lines.join('\n') + '\n');
})().catch((e) => {
  console.error(e?.stack || e?.message || e);
  process.exit(1);
});
