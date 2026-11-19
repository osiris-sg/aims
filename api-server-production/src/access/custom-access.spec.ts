/**
 * Custom access (WCT round 25, Elroy 19 Nov 2026): the preset table, custom roles, a person's own
 * Custom access overriding their roles, the server refusing blocked calls (403), only Admin /
 * superadmin granting, and other orgs unchanged.
 */
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { lastValueFrom, of } from 'rxjs';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { ActionLogInterceptor } from '../action-log/action-log.interceptor';
import { reportScope } from '../sales-report/sales-report';
import { PRESET_FIXES, ROLE_PRESETS, isReadPermission, planPresetFix, resolvePresetPermissions } from '../roles/role-presets';
import { AccessService } from './access.service';
import { CUSTOM_ACCESS_ROLE_ID, NO_TAB_ACCESS_MESSAGE, customAccessUserIds, invalidateCustomAccess, resolveCustomAccess, withCustomAccess } from './custom-access';
import {
  ORG_SETTINGS_EDIT_NEEDS_ADMIN,
  PRESET_TAB_ACCESS,
  TAB_KEYS,
  modulesFor,
  noAccess,
  normalizeTabAccess,
  permissionsFor,
  tabAccessGrants,
  tabsForRequest,
  type TabAccessMap,
} from './tab-access';

// The prod permission catalogue (read-only snapshot, 19 Nov 2026).
const CATALOGUE: string[] = [
  'accounting:create', 'accounting:delete', 'accounting:read', 'accounting:update', 'assets:bind-nfc-tag',
  'assets:check-sku', 'assets:create', 'assets:create-basic', 'assets:create-child', 'assets:delete', 'assets:read',
  'assets:read-id', 'assets:read-sku', 'assets:update', 'audit:read', 'bankrec:create', 'bankrec:read',
  'bills:approve', 'bills:create', 'bills:read', 'bills:update', 'categories:create', 'categories:delete',
  'categories:read', 'categories:read-one', 'categories:update', 'configuration:write', 'customer-info:create',
  'customer-info:read', 'customers:create', 'customers:create-by-name', 'customers:delete', 'customers:read',
  'customers:read-one', 'customers:update', 'dashboard:read', 'document-extraction:extract',
  'document-extraction:extract-url', 'document-extraction:read-types', 'documentTemplates:create',
  'documentTemplates:delete', 'documentTemplates:read', 'documentTemplates:read-one', 'documentTemplates:update',
  'documents:create-basic', 'documents:create-revision', 'documents:create-with-timeline', 'documents:delete',
  'documents:generate-pdf', 'documents:payment-summary', 'documents:read', 'documents:read-by-asset',
  'documents:read-by-inventory', 'documents:read-one', 'documents:send-email', 'documents:tag-template-to-asset',
  'documents:untag-template-from-asset', 'documents:update', 'field-scan:access', 'inventories:create',
  'inventories:delete', 'inventories:generate-qrcode', 'inventories:generate-sku', 'inventories:read',
  'inventories:read-by-asset', 'inventories:read-by-ids', 'inventories:read-by-sku', 'inventories:read-by-status',
  'inventories:read-one', 'inventories:update', 'journal:create', 'journal:post', 'journal:read', 'journal:void',
  'maintenance-reports:create', 'maintenance-reports:read', 'maintenance-reports:sign', 'orders:create',
  'orders:delete', 'orders:read', 'orders:update', 'organizations:create', 'organizations:delete',
  'organizations:read', 'organizations:read-one', 'organizations:read-user', 'organizations:update',
  'payments:create', 'payments:delete', 'payments:read', 'payments:update', 'permissions:create',
  'permissions:delete', 'permissions:read', 'permissions:update', 'projects:add-assignments', 'projects:create',
  'projects:create-by-name', 'projects:delete', 'projects:read', 'projects:read-one', 'projects:update',
  'roles:create', 'roles:delete', 'roles:read', 'roles:update', 'shipments:create', 'shipments:delete',
  'shipments:money', 'shipments:read', 'shipments:update', 'statements:read', 'suppliers:create', 'suppliers:delete',
  'suppliers:read', 'suppliers:read-one', 'suppliers:update', 'timeline-items:create', 'timeline-items:delete',
  'timeline-items:read-by-document', 'timeline-items:read-by-inventory', 'timeline-items:read-one',
  'timeline-items:update', 'transactions:create', 'transactions:delete', 'transactions:read', 'transactions:update',
  'uploads:upload-image', 'users:assign-role', 'users:create', 'users:delete', 'users:read', 'users:read-roles',
  'users:remove-role', 'users:update', 'vehicles:approve', 'vehicles:read', 'vehicles:update', 'whatsapp:manage',
  'whatsapp:read', 'whatsapp:send', 'xerosync:create', 'xerosync:read',
];

const P = (name: string) => ({ name, resource: name.split(':')[0], action: name.split(':')[1] });
const WCT = 'org-wct';
const RACK = 'org-racking';
const CIEL = 'org-ciel';

const presetPerms = (name: string) => resolvePresetPermissions(ROLE_PRESETS.find((p) => p.name === name)!, CATALOGUE);
const ORDERS_DESK: TabAccessMap = { ...noAccess(), orders: 'edit', jobs: 'view', calendar: 'view', salesReport: 'view' };
const ACCOUNTS_VIEW: TabAccessMap = { ...noAccess(), accounting: 'view' };

type Row = Record<string, any>;

/** An in-memory org world: roles (presets + custom), memberships, CustomAccess rows and per-org settings. */
function world(flags: Record<string, Record<string, unknown>> = { [WCT]: { enableCustomAccess: true } }) {
  invalidateCustomAccess();
  ClerkAuthGuard.invalidateAll();
  let n = 0;
  const nid = () => `id-${++n}`;
  const role = (id: string, organizationId: string, name: string, perms: string[], extra: Row = {}) => ({ id, organizationId, name, description: null, allowedModules: [], createdAt: new Date(2026, 0, n++), permissions: perms.map(P), ...extra });
  const db: Record<string, Row[]> = {
    permission: CATALOGUE.map((name, i) => ({ id: `p${i}`, ...P(name) })),
    role: [
      role('w-admin', WCT, 'Admin', resolvePresetPermissions(ROLE_PRESETS[0], CATALOGUE)),
      role('w-super', WCT, 'superadmin', ['*:*']),
      role('w-sales', WCT, 'Sales', presetPerms('Sales'), { description: 'Preset · Sales — x' }),
      role('w-acc', WCT, 'Accounting', presetPerms('Accounting'), { description: 'Preset · Accounting — x' }),
      role('w-ops', WCT, 'Operations', presetPerms('Operations'), { description: 'Preset · Operations — x' }),
      role('w-ft', WCT, 'field-tech', presetPerms('field-tech')),
      role('w-desk', WCT, 'Orders desk', permissionsFor(ORDERS_DESK, CATALOGUE), { description: 'Custom · Orders edit' }),
      role('w-accv', WCT, 'Accounts viewer', permissionsFor(ACCOUNTS_VIEW, CATALOGUE), { description: 'Custom · Accounting view' }),
      role('r-sales', RACK, 'Sales', presetPerms('Sales'), { description: 'Preset · Sales — x' }),
      role('c-sales', CIEL, 'Sales', ['documents:read', 'documents:create-basic']),
      role('c-admin', CIEL, 'Admin', ['*:*']),
    ],
    userRole: [] as Row[],
    userOrganization: [] as Row[],
    customAccess: [
      { id: 'ca1', organizationId: WCT, kind: 'ROLE', subjectId: 'w-desk', tabs: ORDERS_DESK },
      { id: 'ca2', organizationId: WCT, kind: 'ROLE', subjectId: 'w-accv', tabs: ACCOUNTS_VIEW },
      // A CustomAccess row in an org WITHOUT the setting (CIEL): must change nothing.
      { id: 'ca3', organizationId: CIEL, kind: 'USER', subjectId: 'cia', tabs: noAccess() },
    ],
  };
  const member = (userId: string, organizationId: string, ...roleIds: string[]) => {
    db.userOrganization.push({ userId, organizationId, isActive: true, joinedAt: new Date(2026, 0, 1), lastActiveAt: null });
    for (const roleId of roleIds) db.userRole.push({ id: nid(), userId, roleId, organizationId, isActive: true, createdAt: new Date(), assignedAt: new Date() });
  };
  member('adam', WCT, 'w-admin');
  member('sam', WCT, 'w-sales');
  member('ola', WCT, 'w-ops');
  member('fred', WCT, 'w-ft');
  member('sue', WCT, 'w-super');
  member('dora', WCT, 'w-desk');
  member('dual', WCT, 'w-desk', 'w-accv');
  member('mixed', WCT, 'w-sales', 'w-accv');
  member('ivy', WCT, 'w-admin'); // gets her own Custom access below
  member('rex', RACK, 'r-sales');
  member('cia', CIEL, 'c-sales');
  member('cadmin', CIEL, 'c-admin');
  db.customAccess.push({ id: 'ca4', organizationId: WCT, kind: 'USER', subjectId: 'ivy', tabs: { ...noAccess(), sales: 'view' } });

  const match = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'OR') return (v as Row[]).some((w) => match(row, w));
      if (k === 'NOT') return !match(row, v);
      if (k === 'organizationId_kind_subjectId') return match(row, v);
      const x = row[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if ('in' in v) return v.in.includes(x);
        if ('equals' in v) return v.mode === 'insensitive' ? String(x).toLowerCase() === String(v.equals).toLowerCase() : x === v.equals;
        if ('not' in v) return x !== v.not;
      }
      return x === v;
    });
  const roleById = (id: string) => db.role.find((r) => r.id === id)!;
  const calls = { customAccess: 0 };
  const prisma: any = {
    organizationUIConfig: { findUnique: async ({ where }: any) => (flags[where.organizationId] ? { features: flags[where.organizationId] } : null) },
    organization: { findUnique: async ({ where }: any) => ({ id: where.id, name: where.id }) },
    permission: { findMany: async () => db.permission },
    userRole: {
      findMany: async ({ where, select }: any) =>
        db.userRole
          .filter((r) => match(r, where))
          .map((r) => (select?.id ? { id: r.id, organizationId: r.organizationId, role: roleById(r.roleId) } : { ...r, role: roleById(r.roleId) })),
      count: async ({ where }: any) => db.userRole.filter((r) => match(r, where)).length,
      deleteMany: async ({ where }: any) => {
        const keep = db.userRole.filter((r) => !match(r, where));
        const count = db.userRole.length - keep.length;
        db.userRole = keep;
        return { count };
      },
      groupBy: async ({ where }: any) => {
        const out = new Map<string, number>();
        for (const r of db.userRole.filter((x) => match(x, where))) out.set(r.roleId, (out.get(r.roleId) ?? 0) + 1);
        return [...out].map(([roleId, c]) => ({ roleId, _count: { _all: c } }));
      },
    },
    userOrganization: {
      findFirst: async ({ where }: any) => {
        const m = db.userOrganization.find((x) => x.userId === where.userId && x.isActive && (!where.organizationId || x.organizationId === where.organizationId));
        return m ? { userId: m.userId, organization: { id: m.organizationId, name: m.organizationId } } : null;
      },
    },
    role: {
      findMany: async ({ where }: any) => db.role.filter((r) => match(r, where)),
      findFirst: async ({ where }: any) => db.role.find((r) => match(r, where)) ?? null,
      create: async ({ data }: any) => {
        const row = { id: nid(), createdAt: new Date(), ...data, permissions: (data.permissions?.connect ?? []).map((c: any) => db.permission.find((p) => p.id === c.id)) };
        db.role.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const r = roleById(where.id);
        Object.assign(r, { ...data, permissions: (data.permissions?.set ?? []).map((c: any) => db.permission.find((p) => p.id === c.id)) });
        return r;
      },
      delete: async ({ where }: any) => {
        db.role = db.role.filter((r) => r.id !== where.id);
        return { id: where.id };
      },
    },
    customAccess: {
      findMany: async ({ where }: any) => {
        calls.customAccess++;
        return db.customAccess.filter((r) => match(r, where));
      },
      findFirst: async ({ where }: any) => db.customAccess.find((r) => match(r, where)) ?? null,
      create: async ({ data }: any) => {
        const row = { id: nid(), ...data };
        db.customAccess.push(row);
        return row;
      },
      update: async ({ where, data }: any) => Object.assign(db.customAccess.find((r) => r.id === where.id)!, data),
      delete: async ({ where }: any) => {
        db.customAccess = db.customAccess.filter((r) => r.id !== where.id);
        return { id: where.id };
      },
    },
  };
  return { db, prisma, calls };
}

/** One request through ClerkAuthGuard. */
async function guard(w: ReturnType<typeof world>, userId: string, method: string, path: string, perms: string[] = [], headers: Record<string, string> = {}) {
  const reflector: any = { getAllAndOverride: (key: string) => (key === IS_PUBLIC_KEY ? false : undefined), get: (key: string) => (key === PERMISSIONS_KEY ? perms : undefined) };
  const g = new ClerkAuthGuard(reflector, w.prisma);
  const req: any = { headers, method, originalUrl: path, url: path, user: { id: userId } };
  const ctx: any = { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => null, getClass: () => null };
  try {
    return { ok: await g.canActivate(ctx), err: null as any };
  } catch (err: any) {
    return { ok: false, err };
  }
}
const allowed = async (...a: Parameters<typeof guard>) => (await guard(...a)).ok;
const blocked = async (...a: Parameters<typeof guard>) => {
  const r = await guard(...a);
  return !r.ok && r.err instanceof ForbiddenException;
};

beforeAll(() => jest.spyOn((AuthGuard('clerk') as any).prototype, 'canActivate').mockResolvedValue(true));
afterAll(() => jest.restoreAllMocks());
beforeEach(() => invalidateCustomAccess());

describe('the preset table (final role x tab)', () => {
  it('matches Elroy 19 Nov: Sales, Accounting, Operations, Viewer', () => {
    const S = PRESET_TAB_ACCESS.Sales;
    expect([S.orders, S.jobs, S.serviceReports, S.calendar, S.accounting]).toEqual(['edit', 'edit', 'view', 'edit', 'none']);
    const A = PRESET_TAB_ACCESS.Accounting;
    expect([A.orders, A.accounting, A.jobs]).toEqual(['view', 'edit', 'none']);
    const O = PRESET_TAB_ACCESS.Operations;
    expect([O.orders, O.jobs, O.serviceReports, O.calendar, O.sales, O.accounting]).toEqual(['view', 'edit', 'edit', 'edit', 'none', 'none']);
    const V = PRESET_TAB_ACCESS.Viewer;
    expect(TAB_KEYS.every((k) => V[k] !== 'none')).toBe(true);
    expect(TAB_KEYS.filter((k) => V[k] === 'edit')).toEqual(['salesReport']); // Sales report "All" = read everyone's quotations
  });

  it('the preset definitions grant those tabs (code used by apply-role-presets)', () => {
    const sales = presetPerms('Sales');
    for (const p of ['orders:read', 'orders:create', 'orders:update', 'maintenance-reports:create', 'dashboard:read', 'documents:create-basic']) expect(sales).toContain(p);
    expect(sales.some((p) => p.startsWith('journal:') || p.startsWith('accounting:'))).toBe(false);
    expect(ROLE_PRESETS.find((p) => p.name === 'Sales')!.allowedModules).toContain('ORDERS');
    const acc = presetPerms('Accounting');
    expect(acc).toContain('orders:read');
    expect(acc).not.toContain('orders:update');
    const ops = presetPerms('Operations');
    expect(ops).toEqual(expect.arrayContaining(['orders:read', 'documents:update', 'maintenance-reports:create', 'dashboard:read']));
    expect(ops).not.toContain('orders:update');
    const viewer = presetPerms('Viewer');
    expect(viewer.every((p) => isReadPermission(p))).toBe(true);
    expect(viewer).toContain('orders:read');
  });

  it('the existing-row fix adds only what is missing and keeps hand narrowing (YMM modules off)', () => {
    const sales = planPresetFix(PRESET_FIXES.Sales, { permissions: ['dashboard:read', 'maintenance-reports:read'], allowedModules: ['DASHBOARD', 'SALES'] }, CATALOGUE, ['DASHBOARD', 'SALES', 'ORDERS']);
    expect(sales).toEqual({ addPerms: ['maintenance-reports:create', 'orders:create', 'orders:read', 'orders:update'], removePerms: [], addModules: ['ORDERS'] });
    const ymm = planPresetFix(PRESET_FIXES.Accounting, { permissions: ['accounting:read'], allowedModules: ['ACCOUNTING'] }, CATALOGUE, ['ACCOUNTING', 'USER_MANAGEMENT']);
    expect(ymm.addModules).toEqual([]);
    expect(ymm.addPerms).toEqual(['maintenance-reports:read', 'orders:read']);
    const viewer = planPresetFix(PRESET_FIXES.Viewer, { permissions: ['documents:read', 'documents:update'], allowedModules: ['SALES'] }, CATALOGUE, ['SALES', 'ORDERS']);
    expect(viewer.removePerms).toEqual(['documents:update']);
    expect(viewer.addModules).toEqual(['ORDERS']);
    // A role with every module ([]) gets no module list.
    expect(planPresetFix(PRESET_FIXES.Sales, { permissions: [], allowedModules: [] }, CATALOGUE, ['ORDERS']).addModules).toEqual([]);
  });
});

describe('tab map -> permissions, modules, routes', () => {
  it('View grants reads, Edit adds writes; some permissions are never granted', () => {
    const view = { ...noAccess(), orders: 'view' } as TabAccessMap;
    expect(tabAccessGrants(view, ['orders:read'])).toBe(true);
    expect(tabAccessGrants(view, ['orders:update'])).toBe(false);
    expect(tabAccessGrants({ ...view, orders: 'edit' }, ['orders:update'])).toBe(true);
    expect(tabAccessGrants(fullAccessMap(), ['orders:delete'])).toBe(false);
    expect(tabAccessGrants(fullAccessMap(), ['roles:create'])).toBe(false);
    expect(permissionsFor(ORDERS_DESK, CATALOGUE)).not.toContain('journal:read');
    expect(modulesFor(ORDERS_DESK).sort()).toEqual(['DELIVERIES', 'ORDERS', 'SALES']);
  });

  it('Org Settings edit only for an Admin; odd input refused', () => {
    expect(() => normalizeTabAccess({ orgSettings: 'edit' })).toThrow(ORG_SETTINGS_EDIT_NEEDS_ADMIN);
    expect(normalizeTabAccess({ orgSettings: 'edit' }, { allowOrgSettingsEdit: true }).orgSettings).toBe('edit');
    expect(() => normalizeTabAccess({ sales: 'admin' })).toThrow();
    // A view-only tab offered Edit reads as its highest level.
    expect(normalizeTabAccess({ dashboard: 'edit' }).dashboard).toBe('view');
  });

  it('routes map to tabs (GET = view, writes = edit, list POSTs = view)', () => {
    expect(tabsForRequest('GET', '/orders')).toEqual({ tabs: ['orders'], need: 'view' });
    expect(tabsForRequest('PATCH', '/orders/abc')).toEqual({ tabs: ['orders'], need: 'edit' });
    expect(tabsForRequest('POST', '/import/invoices')).toEqual({ tabs: ['orgSettings'], need: 'edit' });
    expect(tabsForRequest('POST', '/documents')).toBeNull(); // the list: shared, permission only
    expect(tabsForRequest('POST', '/documents/create-basic')?.tabs).toEqual(['sales', 'orders', 'jobs', 'accounting']);
    expect(tabsForRequest('POST', '/maintenance-reports/office')).toEqual({ tabs: ['serviceReports'], need: 'edit' });
    expect(tabsForRequest('GET', '/users/me/roles')).toBeNull();
    expect(tabsForRequest('PUT', '/access/users/u1/custom-access')).toBeNull();
    expect(tabsForRequest('GET', '/journal?x=1')).toEqual({ tabs: ['accounting'], need: 'view' });
  });
});

describe('ClerkAuthGuard with custom access', () => {
  it('other orgs unchanged: no setting = no CustomAccess read, roles and permissions as before', async () => {
    const w = world();
    expect(await allowed(w, 'cia', 'GET', '/documents/x', ['documents:read'])).toBe(true);
    expect(await allowed(w, 'cia', 'POST', '/import/invoices')).toBe(true); // no @Permissions: authenticated is enough, as before
    expect(await blocked(w, 'cia', 'PATCH', '/orders/1', ['orders:update'])).toBe(true); // her role lacks it, as before
    expect(await allowed(w, 'cadmin', 'DELETE', '/documents/x', ['documents:delete'])).toBe(true);
    expect(w.calls.customAccess).toBe(0);
  });

  it('presets in a custom-access org keep their permissions (enforcePresetTabs off)', async () => {
    const w = world();
    expect(await allowed(w, 'sam', 'POST', '/maintenance-reports/office', ['maintenance-reports:create'])).toBe(true);
    expect(await allowed(w, 'sam', 'PATCH', '/orders/1', ['orders:update'])).toBe(true);
    expect(await blocked(w, 'sam', 'GET', '/journal', ['journal:read'])).toBe(true);
    expect(await allowed(w, 'adam', 'POST', '/import/invoices')).toBe(true);
    expect(await allowed(w, 'fred', 'POST', '/deliveries/r1/finalize', ['maintenance-reports:create'])).toBe(true);
  });

  it('a custom role: its tabs open, the rest is 403 (also routes with no @Permissions)', async () => {
    const w = world();
    expect(await allowed(w, 'dora', 'GET', '/orders', ['orders:read'])).toBe(true);
    expect(await allowed(w, 'dora', 'PATCH', '/orders/1', ['orders:update'])).toBe(true);
    expect(await allowed(w, 'dora', 'GET', '/deliveries/r1', ['maintenance-reports:read'])).toBe(true);
    expect(await blocked(w, 'dora', 'POST', '/deliveries/r1/cancel', ['maintenance-reports:create'])).toBe(true); // Jobs view only
    expect(await allowed(w, 'dora', 'GET', '/dashboard/jobs-calendar', ['dashboard:read'])).toBe(true);
    expect(await blocked(w, 'dora', 'POST', '/dashboard/jobs-calendar/notes', ['dashboard:read'])).toBe(true); // Calendar view only
    expect(await blocked(w, 'dora', 'GET', '/journal', ['journal:read'])).toBe(true);
    expect(await blocked(w, 'dora', 'POST', '/import/invoices')).toBe(true); // no @Permissions, Org Settings: none
    expect(await blocked(w, 'dora', 'DELETE', '/orders/1', ['orders:delete'])).toBe(true);
    expect(await allowed(w, 'dora', 'GET', '/users/me/roles')).toBe(true);
    const r = await guard(w, 'dora', 'GET', '/journal', ['journal:read']);
    expect(r.err.message).toBe(NO_TAB_ACCESS_MESSAGE);
  });

  it('several custom roles = union', async () => {
    const w = world();
    expect(await allowed(w, 'dual', 'GET', '/journal', ['journal:read'])).toBe(true);
    expect(await allowed(w, 'dual', 'PATCH', '/orders/1', ['orders:update'])).toBe(true);
    expect(await blocked(w, 'dual', 'POST', '/journal', ['journal:create'])).toBe(true);
  });

  it('a preset + a custom role: the roles together, by permission (no tab narrowing)', async () => {
    const w = world();
    expect(await allowed(w, 'mixed', 'GET', '/journal', ['journal:read'])).toBe(true); // from Accounts viewer
    expect(await allowed(w, 'mixed', 'POST', '/documents/create-basic', ['documents:create-basic'])).toBe(true); // from Sales
  });

  it("a person's own Custom access supersedes their roles (even Admin)", async () => {
    const w = world();
    expect(await allowed(w, 'ivy', 'GET', '/documents/x', ['documents:read'])).toBe(true);
    expect(await blocked(w, 'ivy', 'DELETE', '/documents/x', ['documents:delete'])).toBe(true);
    expect(await blocked(w, 'ivy', 'POST', '/users', ['users:create'])).toBe(true);
    expect(await blocked(w, 'ivy', 'GET', '/sales-report', ['documents:read'])).toBe(true);
  });

  it('enforcePresetTabs: preset users are narrowed by the preset table too', async () => {
    const w = world({ [WCT]: { enableCustomAccess: true, enforcePresetTabs: true } });
    expect(await blocked(w, 'sam', 'POST', '/maintenance-reports/office', ['maintenance-reports:create'])).toBe(true); // Sales: Service Reports view
    expect(await allowed(w, 'sam', 'POST', '/deliveries/r1/cancel', ['maintenance-reports:create'])).toBe(true); // Jobs edit
    expect(await blocked(w, 'ola', 'PATCH', '/orders/1', ['documents:update'])).toBe(true); // Operations: Orders view
    expect(await allowed(w, 'adam', 'POST', '/maintenance-reports/office', ['maintenance-reports:create'])).toBe(true); // Admin never narrowed
  });

  it('another WCT group org without the setting is unchanged', async () => {
    const w = world();
    expect(await allowed(w, 'rex', 'POST', '/import/invoices')).toBe(true);
    expect(await allowed(w, 'rex', 'POST', '/maintenance-reports/office', ['maintenance-reports:create'])).toBe(true);
  });
});

describe('AccessService: only Admin / superadmin grant, nobody gets Org Settings edit unless Admin', () => {
  const actor = (userId: string, orgId = WCT) => ({ orgId, platform: false, userId }) as any;

  it('refuses when the setting is off, and for non-Admins', async () => {
    const w = world();
    const s = new AccessService(w.prisma);
    await expect(s.createRole(CIEL, { name: 'X', tabs: {} }, actor('cadmin', CIEL))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(s.createRole(WCT, { name: 'X', tabs: {} }, actor('sam'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(s.setUserAccess(WCT, 'ola', { enabled: true, tabs: {} }, actor('dora'))).rejects.toBeInstanceOf(ForbiddenException);
    // An Admin narrowed by their own Custom access (Org Settings not Edit) cannot manage either.
    expect(await s.canManage(WCT, actor('ivy'))).toBe(false);
    expect(await s.canManage(WCT, actor('adam'))).toBe(true);
    expect(await s.canManage(WCT, actor('sue'))).toBe(true);
    expect((await s.overview(WCT, actor('sam'))).canManage).toBe(false);
  });

  it('Admin creates a custom role: derived permissions + modules, never Org Settings edit, no clashing names', async () => {
    const w = world();
    const s = new AccessService(w.prisma);
    const out = await s.createRole(WCT, { name: ' Service desk ', tabs: { serviceReports: 'edit', jobs: 'view' } }, actor('adam'));
    const row = w.db.role.find((r) => r.id === out.role.id)!;
    expect(row.name).toBe('Service desk');
    expect(row.description).toBe('Custom · Jobs view, Service Reports edit');
    expect(row.allowedModules.sort()).toEqual(['DELIVERIES', 'MAINTENANCE']);
    expect(row.permissions.map((p: any) => p.name)).toEqual(expect.arrayContaining(['maintenance-reports:create', 'maintenance-reports:read']));
    expect(row.permissions.map((p: any) => p.name)).not.toContain('orders:read');
    expect(w.db.customAccess.find((r) => r.kind === 'ROLE' && r.subjectId === row.id)).toBeTruthy();
    expect(out.log).toEqual({ role: 'Service desk', tabs: 'Jobs view, Service Reports edit' });
    // A role with no access never reads as "every module" ([]).
    const none = await s.createRole(WCT, { name: 'Nothing yet', tabs: {} }, actor('adam'));
    expect(w.db.role.find((r) => r.id === none.role.id)!.allowedModules).toEqual(['NONE']);
    await expect(s.createRole(WCT, { name: 'Boss', tabs: { orgSettings: 'edit' } }, actor('adam'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.createRole(WCT, { name: 'admin', tabs: {} }, actor('adam'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.createRole(WCT, { name: 'orders DESK', tabs: {} }, actor('adam'))).rejects.toBeInstanceOf(ConflictException);
  });

  it('edits and deletes only custom roles; the Activity Log result names what changed', async () => {
    const w = world();
    const s = new AccessService(w.prisma);
    await expect(s.updateRole(WCT, 'w-sales', { tabs: {} }, actor('adam'))).rejects.toBeInstanceOf(BadRequestException);
    const up = await s.updateRole(WCT, 'w-desk', { name: 'Order desk', tabs: { ...ORDERS_DESK, jobs: 'edit' } }, actor('adam'));
    expect(up.log).toEqual({ role: 'Order desk', renamed: { from: 'Orders desk', to: 'Order desk' }, changes: { Jobs: 'view -> edit' } });
    await expect(s.deleteRole(WCT, 'w-desk', actor('adam'))).rejects.toBeInstanceOf(ConflictException); // dora + dual hold it
    const fresh = await s.createRole(WCT, { name: 'Temp', tabs: {} }, actor('adam'));
    expect((await s.deleteRole(WCT, fresh.role.id, actor('adam'))).log.role).toBe('Temp');
    expect(w.db.role.some((r) => r.id === fresh.role.id)).toBe(false);
  });

  it("sets a person's Custom access: Org Settings edit only for an Admin; not superadmin, not yourself", async () => {
    const w = world();
    const s = new AccessService(w.prisma);
    await expect(s.setUserAccess(WCT, 'sam', { enabled: true, tabs: { orgSettings: 'edit' } }, actor('adam'))).rejects.toThrow(ORG_SETTINGS_EDIT_NEEDS_ADMIN);
    const ok = await s.setUserAccess(WCT, 'ivy', { enabled: true, tabs: { orgSettings: 'edit', sales: 'view' } }, actor('adam'));
    expect(ok.tabs!.orgSettings).toBe('edit');
    expect(ok.log.changes).toEqual({ 'Org Settings': 'none -> edit' });
    await expect(s.setUserAccess(WCT, 'sue', { enabled: true, tabs: {} }, actor('adam'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.setUserAccess(WCT, 'adam', { enabled: true, tabs: {} }, actor('adam'))).rejects.toBeInstanceOf(BadRequestException);
    const on = await s.setUserAccess(WCT, 'sam', { enabled: true, tabs: { sales: 'edit' } }, actor('adam'));
    expect(on.log.customAccess).toEqual({ from: 'off', to: 'on' });
    const off = await s.setUserAccess(WCT, 'sam', { enabled: false }, actor('adam'));
    expect(off.log.customAccess).toEqual({ from: 'on', to: 'off' });
    expect(w.db.customAccess.some((r) => r.kind === 'USER' && r.subjectId === 'sam')).toBe(false);
  });
});

describe('what the portal and the reports read', () => {
  it('GET /users/me/roles: own access = one "Custom access" role; custom roles carry their map; other orgs unchanged', async () => {
    const w = world();
    const mine = await withCustomAccess(w.prisma, WCT, 'ivy', [{ id: 'w-admin', name: 'Admin' }]);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: CUSTOM_ACCESS_ROLE_ID, name: 'Custom access', tabAccess: { sales: 'view' } });
    expect(mine[0].allowedModules.sort()).toEqual(['CUSTOMERS', 'SALES']);
    expect(mine[0].permissions.map((p: any) => p.name)).not.toContain('documents:update');
    const desk = await withCustomAccess(w.prisma, WCT, 'dora', [{ id: 'w-desk', name: 'Orders desk' }]);
    expect(desk[0].tabAccess.orders).toBe('edit');
    const ciel = [{ id: 'c-sales', name: 'Sales' }];
    expect(await withCustomAccess(w.prisma, CIEL, 'cia', ciel)).toBe(ciel);
    expect(await customAccessUserIds(w.prisma, WCT, ['ivy', 'sam'])).toEqual(new Set(['ivy']));
    expect(await customAccessUserIds(w.prisma, CIEL, ['cia'])).toEqual(new Set());
  });

  it('the Sales report scope follows the Sales report tab for custom access (View = own, Edit = all)', async () => {
    const w = world();
    expect((await resolveCustomAccess(w.prisma, WCT, 'dora', [{ id: 'w-desk', name: 'Orders desk' }]))!.map.salesReport).toBe('view');
    expect(await resolveCustomAccess(w.prisma, WCT, 'sam', [{ id: 'w-sales', name: 'Sales' }])).toBeNull();
    expect(reportScope(['Viewer'])).toBe('all');
  });

  it('the Activity Log reads SET_ACCESS for a person and keeps the summary', async () => {
    const rows: any[] = [];
    const interceptor = new ActionLogInterceptor({ log: async (e: any) => void rows.push(e) } as any);
    const req: any = { method: 'PUT', originalUrl: '/access/users/user_2abc/custom-access', url: '/access/users/user_2abc/custom-access', params: { userId: 'user_2abc' }, headers: {}, body: { enabled: true }, user: { id: 'adam' }, userOrganization: { id: WCT } };
    const ctx: any = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) };
    await lastValueFrom(
      interceptor.intercept(ctx, {
        handle: () => {
          req.actionLogResult = { userId: 'user_2abc', customAccess: { from: 'off', to: 'on' } };
          return of({ ok: true });
        },
      } as any),
    );
    expect(rows[0]).toMatchObject({ action: 'SET_ACCESS', resource: 'access' });
    expect(rows[0].details.result.customAccess).toEqual({ from: 'off', to: 'on' });
    const get: any = { ...req, method: 'GET', originalUrl: '/access/users/user_2abc', url: '/access/users/user_2abc' };
    const rows2: any[] = [];
    const i2 = new ActionLogInterceptor({ log: async (e: any) => void rows2.push(e) } as any);
    await lastValueFrom(i2.intercept({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => get }) } as any, { handle: () => of({}) } as any));
    expect(rows2[0].action).not.toBe('SET_ACCESS');
  });
});

function fullAccessMap(): TabAccessMap {
  return Object.fromEntries(TAB_KEYS.map((k) => [k, 'edit'])) as TabAccessMap;
}
