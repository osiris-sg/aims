import { UsersService } from './users.service';
import { MembershipsService } from './memberships.service';
import { UsersController } from './users.controller';
import {
  MULTI_ROLE_FLAG,
  multiRoleOn,
  multiRoleUnionGrants,
  orderPrimaryFirst,
  planRoleSave,
  primaryRoleIdOf,
  roleChangeSummary,
  rolesGrant,
  unionAllowedModules,
} from '../roles/multi-role';

// Multi-role users (features.enableMultiRole, WCT group 2026-11-17). A small in-memory
// Prisma runs the real service code. Org WCT has the setting; CIEL and BCAIR do not.
type Row = Record<string, any>;
let seq = 0;
const nid = () => `id${++seq}`;
const WCT = 'wct';
const CIEL = 'ciel';
const BCAIR = 'bcair';
const t = (s: string) => new Date(`2026-11-${s}Z`);

const P = (resource: string, action: string) => ({ id: `${resource}:${action}`, name: `${resource}:${action}`, resource, action });

function world(flags: Record<string, Record<string, unknown>> = { [WCT]: { [MULTI_ROLE_FLAG]: true } }) {
  const db: Record<string, Row[]> = {
    role: [
      { id: 'w-sales', name: 'Sales', organizationId: WCT, allowedModules: ['SALES', 'CUSTOMERS'], permissions: [P('documents', 'read'), P('customers', 'create')] },
      { id: 'w-ops', name: 'Operations', organizationId: WCT, allowedModules: ['DELIVERIES', 'INVENTORY'], permissions: [P('deliveries', 'update')] },
      { id: 'w-acc', name: 'Accounting', organizationId: WCT, allowedModules: ['ACCOUNTING'], permissions: [P('journal', 'read')] },
      { id: 'c-mgmt', name: 'Management', organizationId: CIEL, allowedModules: [], permissions: [P('*', '*')] },
      { id: 'c-des', name: 'Designer', organizationId: CIEL, allowedModules: ['PROJECTS'], permissions: [P('projects', 'read')] },
      { id: 'b-sales', name: 'Sales', organizationId: BCAIR, allowedModules: ['SALES'], permissions: [P('documents', 'read')] },
      { id: 'b-ops', name: 'Operations', organizationId: BCAIR, allowedModules: ['DELIVERIES'], permissions: [P('deliveries', 'update')] },
    ],
    userRole: [
      // WCT (multi-role on): one person with one role, one with two.
      { id: 'u1', userId: 'ann', roleId: 'w-sales', organizationId: WCT, isActive: true, createdAt: t('03T01:00:00'), assignedAt: t('03T01:00:00') },
      { id: 'u2', userId: 'ben', roleId: 'w-ops', organizationId: WCT, isActive: true, createdAt: t('02T01:00:00'), assignedAt: t('02T01:00:00') },
      { id: 'u3', userId: 'ben', roleId: 'w-acc', organizationId: WCT, isActive: true, createdAt: t('05T01:00:00'), assignedAt: t('05T01:00:00') },
      // CIEL (off): an existing multi-role user, Management + Designer, same second.
      { id: 'c1', userId: 'mia', roleId: 'c-mgmt', organizationId: CIEL, isActive: true, createdAt: t('15T01:00:00'), assignedAt: t('15T01:00:00') },
      { id: 'c2', userId: 'mia', roleId: 'c-des', organizationId: CIEL, isActive: true, createdAt: t('15T01:00:00'), assignedAt: t('15T01:00:00') },
      // BC Air (off): one active role and one switched off by the preset single Role dropdown.
      { id: 'b1', userId: 'joe', roleId: 'b-ops', organizationId: BCAIR, isActive: false, createdAt: t('17T01:00:00'), assignedAt: t('17T01:00:00') },
      { id: 'b2', userId: 'joe', roleId: 'b-sales', organizationId: BCAIR, isActive: true, createdAt: t('17T02:00:00'), assignedAt: t('17T02:00:00') },
    ],
    userOrganization: [
      { userId: 'ann', organizationId: WCT, isActive: true },
      { userId: 'ben', organizationId: WCT, isActive: true },
      { userId: 'mia', organizationId: CIEL, isActive: true },
      { userId: 'joe', organizationId: BCAIR, isActive: true },
    ],
  };
  const writes: Array<{ op: string; args: any }> = [];
  const roleById = (id: string) => db.role.find((r) => r.id === id)!;
  const match = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'userId_roleId_organizationId') return match(row, v);
      const x = row[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        if ('in' in v) return v.in.includes(x);
        if ('notIn' in v) return !v.notIn.includes(x);
        if ('not' in v) return x !== v.not;
        if ('contains' in v) return String(x).includes(v.contains);
      }
      return x === v;
    });
  const withRole = (r: Row, args: any) => (args?.include?.role || args?.select?.role ? { ...r, role: roleById(r.roleId) } : { ...r });
  const userRole = {
    count: async ({ where }: any = {}) => db.userRole.filter((r) => match(r, where)).length,
    findMany: async (args: any = {}) => {
      let rows = db.userRole.filter((r) => match(r, args.where));
      if (args.orderBy?.createdAt === 'desc') rows = [...rows].sort((a, b) => b.createdAt - a.createdAt);
      if (args.distinct?.includes('userId')) rows = rows.filter((r, i) => rows.findIndex((x) => x.userId === r.userId) === i);
      if (args.skip || args.take) rows = rows.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? rows.length));
      return rows.map((r) => withRole(r, args));
    },
    findFirst: async (args: any = {}) => db.userRole.find((r) => match(r, args.where)) ?? null,
    update: async ({ where, data, include }: any) => {
      writes.push({ op: 'userRole.update', args: { where, data } });
      const r = db.userRole.find((x) => match(x, where))!;
      Object.assign(r, data);
      return withRole(r, { include });
    },
    updateMany: async ({ where, data }: any) => {
      writes.push({ op: 'userRole.updateMany', args: { where, data } });
      const rows = db.userRole.filter((r) => match(r, where));
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    },
    upsert: async ({ where, update, create }: any) => {
      writes.push({ op: 'userRole.upsert', args: { where, update, create } });
      const r = db.userRole.find((x) => match(x, where));
      if (r) return Object.assign(r, update);
      const row = { id: nid(), isActive: true, createdAt: new Date(), assignedAt: new Date(), ...create };
      db.userRole.push(row);
      return row;
    },
    create: async ({ data, include }: any) => {
      writes.push({ op: 'userRole.create', args: { data } });
      const row = { id: nid(), isActive: true, createdAt: new Date(), assignedAt: new Date(), ...data };
      db.userRole.push(row);
      return withRole(row, { include });
    },
    delete: async ({ where }: any) => {
      const i = db.userRole.findIndex((x) => match(x, where));
      return db.userRole.splice(i, 1)[0];
    },
  };
  const prisma: any = {
    userRole,
    role: { findMany: async ({ where }: any) => db.role.filter((r) => match(r, where)) },
    userOrganization: {
      count: async ({ where }: any) => db.userOrganization.filter((r) => match(r, where)).length,
      upsert: async ({ where, update, create }: any) => {
        const r = db.userOrganization.find((x) => x.userId === where.userId_organizationId.userId && x.organizationId === where.userId_organizationId.organizationId);
        if (r) Object.assign(r, update);
        else db.userOrganization.push({ ...create });
      },
      findMany: async ({ where }: any) =>
        db.userOrganization.filter((m) => m.userId === where.userId && m.isActive).map((m) => ({ organizationId: m.organizationId, lastActiveAt: null, organization: { id: m.organizationId, name: m.organizationId, logo: null } })),
    },
    organizationMemberProfile: { findMany: async () => [] },
    organization: { findUnique: async ({ where }: any) => ({ id: where.id, name: where.id.toUpperCase() }) },
    notification: { groupBy: async () => [] },
    organizationUIConfig: {
      findUnique: async ({ where }: any) => (flags[where.organizationId] ? { features: flags[where.organizationId] } : null),
      findMany: async ({ where }: any) => Object.entries(flags).filter(([o]) => where.organizationId.in.includes(o)).map(([organizationId, features]) => ({ organizationId, features })),
    },
  };
  const clerkUser = (uid: string) => ({ id: uid, firstName: uid, lastName: 'X', emailAddresses: [{ emailAddress: `${uid}@x.sg` }], publicMetadata: {} });
  const clerkIdentity: any = {
    toClerkUser: jest.fn(async (uid: string) => clerkUser(uid)),
    toClerkUsers: jest.fn(async (ids: string[]) => new Map(ids.map((i) => [i, clerkUser(i)]))),
    invalidate: jest.fn(),
    stampExternalId: jest.fn(async () => undefined),
  };
  const clerkClient: any = {
    users: {
      updateUser: jest.fn(async (uid: string) => clerkUser(uid)),
      getUserList: jest.fn(async ({ emailAddress }: any) => ({ data: emailAddress?.[0] === 'ann@x.sg' ? [{ id: 'ann' }] : [] })),
      createUser: jest.fn(async () => ({ id: 'newbie' })),
      updateUserMetadata: jest.fn(async () => ({})),
    },
    signInTokens: { createSignInToken: jest.fn(async () => ({ token: 'tok' })) },
  };
  const users = new UsersService(clerkClient, prisma, clerkIdentity);
  const memberships = new MembershipsService(prisma, clerkClient, clerkIdentity, { sendSimpleEmail: jest.fn(async () => ({ success: true })) } as any, { system: jest.fn() } as any);
  return { db, prisma, users, memberships, writes };
}
const actor = (orgId: string) => ({ orgId, platform: false, userId: 'admin' }) as any;
const active = (db: Record<string, Row[]>, userId: string, org: string) => orderPrimaryFirst(db.userRole.filter((r) => r.userId === userId && r.organizationId === org && r.isActive) as any[]).map((r) => r.roleId);

describe('multi-role helpers', () => {
  const sales = { permissions: [P('documents', 'read'), P('customers', 'create')] };
  const ops = { permissions: [P('deliveries', 'update')] };

  it('union permissions: two roles together grant what neither grants alone; one-role rule unchanged', () => {
    expect(rolesGrant([sales, ops], ['documents:read', 'deliveries:update'], true)).toBe(true);
    expect(rolesGrant([sales, ops], ['documents:read', 'deliveries:update'], false)).toBe(false);
    expect(rolesGrant([sales, ops], ['journal:read'], true)).toBe(false);
    // every @Permissions today names ONE permission: both rules agree
    for (const p of ['documents:read', 'deliveries:update', 'journal:read', 'customers:create']) {
      expect(rolesGrant([sales, ops], [p], true)).toBe(rolesGrant([sales, ops], [p], false));
    }
    expect(rolesGrant([{ permissions: [P('*', '*')] }], ['anything:at-all'], true)).toBe(true);
  });

  it('union modules: any unrestricted role opens everything, else the lists together', () => {
    expect(unionAllowedModules([{ allowedModules: ['SALES'] }, { allowedModules: ['DELIVERIES', 'SALES'] }])).toEqual(['SALES', 'DELIVERIES']);
    expect(unionAllowedModules([{ allowedModules: ['SALES'] }, { allowedModules: [] }])).toBeNull();
    expect(unionAllowedModules([])).toBeNull();
  });

  it('primary role = earliest assignedAt, then createdAt, then id', () => {
    const rows = [
      { roleId: 'b', assignedAt: t('05T00:00:00'), createdAt: t('01T00:00:00') },
      { roleId: 'a', assignedAt: t('03T00:00:00'), createdAt: t('04T00:00:00') },
    ];
    expect(primaryRoleIdOf(rows)).toBe('a');
    expect(primaryRoleIdOf([{ roleId: 'z', assignedAt: t('01T00:00:00'), id: 'r2' }, { roleId: 'y', assignedAt: t('01T00:00:00'), id: 'r1' }])).toBe('y');
    expect(primaryRoleIdOf([])).toBeNull();
  });

  it('plan: add a role keeps the primary; make primary moves only that role ahead; remove switches off', () => {
    const cur = [
      { roleId: 'ops', assignedAt: t('02T00:00:00') },
      { roleId: 'acc', assignedAt: t('05T00:00:00') },
    ];
    const now = t('17T00:00:00');
    const add = planRoleSave(cur, ['ops', 'acc', 'sales'], undefined, now);
    expect(add).toEqual({ deactivate: [], upserts: [{ roleId: 'sales', assignedAt: now }], primaryRoleId: 'ops' });

    const promote = planRoleSave(cur, ['ops', 'acc'], 'acc', now);
    expect(promote.primaryRoleId).toBe('acc');
    expect(promote.upserts).toEqual([{ roleId: 'acc', assignedAt: new Date(t('02T00:00:00').getTime() - 1000) }]);

    const newPrimary = planRoleSave(cur, ['sales', 'ops'], 'sales', now);
    expect(newPrimary.deactivate).toEqual(['acc']);
    expect(newPrimary.primaryRoleId).toBe('sales');
    expect(primaryRoleIdOf([{ roleId: 'ops', assignedAt: t('02T00:00:00') }, ...newPrimary.upserts])).toBe('sales');

    // the primary removed: the next earliest takes over (no write needed)
    expect(planRoleSave(cur, ['acc'], undefined, now)).toEqual({ deactivate: ['ops'], upserts: [], primaryRoleId: 'acc' });
    // a fresh person: first chosen is primary, the rest follow in order
    const fresh = planRoleSave([], ['b', 'a'], undefined, now);
    expect(primaryRoleIdOf(fresh.upserts)).toBe('b');
    expect(() => planRoleSave(cur, [], undefined, now)).toThrow();
  });

  it('Activity Log summary names added / removed roles and the primary change', () => {
    expect(roleChangeSummary(['Operations', 'Accounting'], ['Sales', 'Operations'], 'Operations', 'Sales')).toEqual({
      roles: { from: ['Operations', 'Accounting'], to: ['Sales', 'Operations'] },
      added: ['Sales'],
      removed: ['Accounting'],
      primaryRole: { from: 'Operations', to: 'Sales' },
    });
    expect(roleChangeSummary(['Sales'], ['Sales'], 'Sales', 'Sales')).toEqual({ roles: { from: ['Sales'], to: ['Sales'] } });
  });

  it('guard fallback: union only for a multi-role org and two or more roles', async () => {
    const { prisma } = world();
    expect(await multiRoleOn(prisma, WCT)).toBe(true);
    expect(await multiRoleOn(prisma, CIEL)).toBe(false);
    expect(await multiRoleOn({}, WCT)).toBe(false); // no config table: off, never throws
    const both = ['documents:read', 'deliveries:update'];
    expect(await multiRoleUnionGrants(prisma, WCT, [sales, ops], both)).toBe(true);
    expect(await multiRoleUnionGrants(prisma, CIEL, [sales, ops], both)).toBe(false);
    expect(await multiRoleUnionGrants(prisma, WCT, [sales], both)).toBe(false);
  });
});

describe('multi-role ON (WCT)', () => {
  it('me/roles: active roles only, primary first and marked', async () => {
    const { users, db } = world();
    db.userRole.push({ id: 'u9', userId: 'ben', roleId: 'w-sales', organizationId: WCT, isActive: false, createdAt: t('01T00:00:00'), assignedAt: t('01T00:00:00') });
    const roles = await users.getUserRoles('ben', WCT);
    expect(roles.map((r: any) => [r.id, r.isPrimary])).toEqual([
      ['w-ops', true],
      ['w-acc', false],
    ]);
  });

  it('Edit User: add a role and make it primary, then remove one; Activity Log row says so', async () => {
    const { db, prisma, users } = world();
    const ctl = new UsersController(users, {} as any);
    const req: any = {};
    const res: any = await ctl.updateUser('ben', { roleIds: ['w-ops', 'w-acc', 'w-sales'], primaryRoleId: 'w-sales' } as any, { id: WCT, name: 'WCT' }, Object.assign(req, { user: { id: 'admin' }, userOrganization: { id: WCT } }));
    expect(active(db, 'ben', WCT)).toEqual(['w-sales', 'w-ops', 'w-acc']);
    expect(res.primaryRoleId).toBe('w-sales');
    expect(res.roles.map((r: any) => r.name)).toEqual(['Sales', 'Operations', 'Accounting']);
    expect(res.roleChange).toBeUndefined(); // moved to the log row, not the reply
    expect(req.actionLogResult).toEqual({ roles: { from: ['Operations', 'Accounting'], to: ['Sales', 'Operations', 'Accounting'] }, added: ['Sales'], primaryRole: { from: 'Operations', to: 'Sales' } });

    await users.updateUser('ben', { roleIds: ['w-sales', 'w-acc'], primaryRoleId: 'w-sales' } as any, actor(WCT));
    expect(active(db, 'ben', WCT)).toEqual(['w-sales', 'w-acc']);
    expect(db.userRole.find((r) => r.id === 'u2')!.isActive).toBe(false); // row kept, switched off
    // permissions + modules: the union of what is left
    const left = await users.getUserRoles('ben', WCT);
    expect(rolesGrant(left as any, ['documents:read', 'journal:read'], true)).toBe(true);
    expect(rolesGrant(left as any, ['deliveries:update'], true)).toBe(false);
    expect(unionAllowedModules(left as any)).toEqual(['SALES', 'CUSTOMERS', 'ACCOUNTING']);
    expect(prisma).toBeDefined();
  });

  it('Edit User: change only the primary (same roles)', async () => {
    const { db, users } = world();
    await users.updateUser('ben', { roleIds: ['w-ops', 'w-acc'], primaryRoleId: 'w-acc' } as any, actor(WCT));
    expect(active(db, 'ben', WCT)).toEqual(['w-acc', 'w-ops']);
    // no primaryRoleId sent (an older client): the current primary stays
    await users.updateUser('ben', { roleIds: ['w-ops', 'w-acc'] } as any, actor(WCT));
    expect(active(db, 'ben', WCT)).toEqual(['w-acc', 'w-ops']);
  });

  it('users list: one entry per person with all roles, primary first and named', async () => {
    const { users } = world();
    const list: any = await users.getUsers({ page: 1, limit: 1 } as any, WCT);
    expect(list.totalDocuments).toBe(2); // people, not role rows
    const page2: any = await users.getUsers({ page: 2, limit: 1 } as any, WCT);
    const ben = [...list.users, ...page2.users].find((u: any) => u.id === 'ben');
    expect(ben.roles.map((r: any) => r.id)).toEqual(['w-ops', 'w-acc']);
    expect(ben.primaryRoleId).toBe('w-ops');
  });

  it('bug fix (setting on): a page never splits a person; the same data with the setting off still pages by role row', async () => {
    // newest role rows first: ben (Accounting), ann, ben (Operations); the old paging cuts after two rows
    const off = world({});
    const oldPage1: any = await off.users.getUsers({ page: 1, limit: 2 } as any, WCT);
    const oldBen = oldPage1.users.find((u: any) => u.id === 'ben');
    expect(oldBen.roles).toHaveLength(1); // today's all-org bug: ben's second role is on page 2
    const on = world();
    const page1: any = await on.users.getUsers({ page: 1, limit: 2 } as any, WCT);
    expect(page1.users.map((u: any) => u.id).sort()).toEqual(['ann', 'ben']);
    expect(page1.users.find((u: any) => u.id === 'ben').roles.map((r: any) => r.id)).toEqual(['w-ops', 'w-acc']);
    expect(page1.totalPagesCount).toBe(1);
  });

  it('bug fix (setting on): me/roles leaves out switched-off roles; with the setting off they are still listed', async () => {
    const flags = { [WCT]: { [MULTI_ROLE_FLAG]: true } };
    const on = world(flags);
    on.db.userRole.find((r) => r.id === 'u3')!.isActive = false;
    expect((await on.users.getUserRoles('ben', WCT)).map((r: any) => r.id)).toEqual(['w-ops']);
    const off = world({});
    off.db.userRole.find((r) => r.id === 'u3')!.isActive = false;
    expect((await off.users.getUserRoles('ben', WCT)).map((r: any) => r.id)).toEqual(['w-ops', 'w-acc']);
  });

  it('Add User: several roles, the first chosen is primary', async () => {
    const { db, memberships } = world();
    const res: any = await memberships.addMember({ email: 'new@x.sg', roleIds: ['w-acc', 'w-sales'] }, actor(WCT));
    expect(res.ok).toBe(true);
    expect(active(db, 'newbie', WCT)).toEqual(['w-acc', 'w-sales']);
    expect(res.roleChange).toMatchObject({ added: ['Accounting', 'Sales'], primaryRole: { from: null, to: 'Accounting' } });
    const res2: any = await memberships.addMember({ email: 'new2@x.sg', roleIds: ['w-acc', 'w-sales'], primaryRoleId: 'w-sales' }, actor(WCT));
    expect(res2.ok).toBe(true);
    // (the fake Clerk hands back the same login) an explicit primary wins, nothing is removed
    expect(active(db, 'newbie', WCT)).toEqual(['w-sales', 'w-acc']);
  });

  it('org switcher lists the primary role first', async () => {
    const { db, memberships } = world();
    db.userRole.find((r) => r.id === 'u3')!.assignedAt = t('01T00:00:00'); // Accounting made primary
    const me = await memberships.myOrganizations('ben', null, false);
    expect(me.organizations[0].roles).toEqual(['Accounting', 'Operations']);
  });
});

describe('multi-role OFF: other orgs and the existing multi-role users exactly as before', () => {
  it('me/roles: unchanged shape and rows (no isPrimary, switched-off roles still listed as today)', async () => {
    const { users } = world();
    const mia = await users.getUserRoles('mia', CIEL);
    expect(mia.map((r: any) => r.id)).toEqual(['c-mgmt', 'c-des']);
    expect(mia.every((r: any) => !('isPrimary' in r))).toBe(true);
    const joe = await users.getUserRoles('joe', BCAIR);
    expect(joe.map((r: any) => r.id)).toEqual(['b-ops', 'b-sales']); // today's behaviour, kept
  });

  it('the CIEL multi-role user keeps the union of both roles (any role grants, any unrestricted role opens all)', async () => {
    const { users } = world();
    const mia = await users.getUserRoles('mia', CIEL);
    expect(rolesGrant(mia as any, ['projects:read'], false)).toBe(true);
    expect(rolesGrant(mia as any, ['journal:read'], false)).toBe(true); // Management *:*
    expect(unionAllowedModules(mia as any)).toBeNull();
  });

  it('Edit User: same writes as before; primaryRoleId ignored; no Activity Log extra', async () => {
    const { db, users, writes } = world();
    const ctl = new UsersController(users, {} as any);
    const req: any = { user: { id: 'admin' }, userOrganization: { id: CIEL } };
    const res: any = await ctl.updateUser('mia', { roleIds: ['c-des', 'c-mgmt'], primaryRoleId: 'c-des' } as any, { id: CIEL, name: 'CIEL' }, req);
    expect(req.actionLogResult).toBeUndefined();
    expect(res.primaryRoleId).toBeUndefined();
    const roleWrites = writes.filter((w) => w.op.startsWith('userRole'));
    expect(roleWrites.map((w) => w.op)).toEqual(['userRole.updateMany', 'userRole.upsert', 'userRole.upsert']);
    expect(roleWrites[0].args).toEqual({ where: { userId: 'mia', organizationId: CIEL, isActive: true, roleId: { notIn: ['c-des', 'c-mgmt'] } }, data: { isActive: false } });
    expect(roleWrites.slice(1).every((w) => !('assignedAt' in w.args.update) && !('assignedAt' in w.args.create))).toBe(true);
    // the rows (and so their order) untouched
    expect(db.userRole.filter((r) => r.userId === 'mia').map((r) => [r.id, r.isActive, r.assignedAt.toISOString()])).toEqual([
      ['c1', true, t('15T01:00:00').toISOString()],
      ['c2', true, t('15T01:00:00').toISOString()],
    ]);
  });

  it('users list: role-row paging and no primaryRoleId, as before', async () => {
    const { users } = world();
    const list: any = await users.getUsers({ page: 1, limit: 10 } as any, CIEL);
    expect(list.totalDocuments).toBe(2); // role rows (today's count)
    expect(list.users).toHaveLength(1);
    expect(list.users[0]).not.toHaveProperty('primaryRoleId');
    expect(list.users[0].roles.map((r: any) => r.id).sort()).toEqual(['c-des', 'c-mgmt']);
  });

  it('Add User and re-assign: no assignedAt stamped, no log summary', async () => {
    const { users, memberships, writes } = world();
    const res: any = await memberships.addMember({ email: 'x@y.sg', roleIds: ['b-sales', 'b-ops'], primaryRoleId: 'b-ops' }, actor(BCAIR));
    expect(res.roleChange).toBeUndefined();
    await users.assignRoleToUser('joe', 'b-ops', BCAIR, actor(BCAIR));
    expect(writes.filter((w) => w.op.startsWith('userRole')).every((w) => !JSON.stringify(w.args).includes('assignedAt'))).toBe(true);
  });

  it('org switcher: roles in the stored order, as before', async () => {
    const { memberships } = world();
    const me = await memberships.myOrganizations('mia', null, false);
    expect(me.organizations[0].roles).toEqual(['Management', 'Designer']);
  });

  it('a multi-role org with the setting turned off behaves like any other org', async () => {
    const { users } = world({});
    const ben = await users.getUserRoles('ben', WCT);
    expect(ben.every((r: any) => !('isPrimary' in r))).toBe(true);
  });
});
