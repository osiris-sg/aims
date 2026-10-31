import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { RolesService } from '../roles/roles.service';
import { PermissionsController } from '../permissions/permissions.controller';
import { UsersController } from './users.controller';
import { isReservedRoleName } from '../auth/admin-scope';

// Round AW — users / roles / permissions endpoints stay inside the caller's org.
// A tiny in-memory Prisma runs the real service code.
type Row = Record<string, any>;
let seq = 0;
const id = () => `id${++seq}`;

function fakePrisma(db: { userOrganization: Row[]; userRole: Row[]; role: Row[]; permission: Row[] }) {
  const roleById = (rid: string) => db.role.find((r) => r.id === rid);
  const match = (row: Row, where: Row = {}, table?: string): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'role' && table === 'userRole') return match(roleById(row.roleId) ?? {}, v);
      if (k.includes('_') && typeof v === 'object' && !Array.isArray(v) && k !== 'organizationId') return match(row, v, table); // compound unique
      const x = row[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if ('in' in v) return v.in.includes(x);
        if ('notIn' in v) return !v.notIn.includes(x);
        if ('not' in v) return x !== v.not;
      }
      return x === v;
    });
  const withRole = (r: Row, args: any) => (args?.include?.role ? { ...r, role: { ...roleById(r.roleId), permissions: roleById(r.roleId)?.permissions ?? [] } } : r);
  const table = (name: keyof typeof db) => ({
    count: async ({ where }: any = {}) => db[name].filter((r) => match(r, where, name)).length,
    findMany: async (args: any = {}) => db[name].filter((r) => match(r, args.where, name)).map((r) => withRole(r, args)),
    findFirst: async (args: any = {}) => db[name].find((r) => match(r, args.where, name)) ?? null,
    findUnique: async (args: any = {}) => {
      const r = db[name].find((x) => match(x, args.where, name));
      if (!r) return null;
      if (name === 'role' && args.include?.permissions) return { ...r, permissions: r.permissions ?? [] };
      if (name === 'role' && args.include?.userRoles) return { ...r, userRoles: db.userRole.filter((u) => u.roleId === r.id) };
      return r;
    },
    create: async ({ data, include }: any) => {
      const row = { id: id(), isActive: true, createdAt: new Date(), ...data };
      if (name === 'role') row.permissions = (data.permissions?.connect ?? []).map((c: any) => db.permission.find((p) => p.id === c.id));
      db[name].push(row);
      return withRole(row, { include });
    },
    update: async ({ where, data, include }: any) => {
      const r = db[name].find((x) => match(x, where, name))!;
      const { permissions, ...rest } = data;
      Object.assign(r, rest);
      if (name === 'role' && permissions?.set) r.permissions = permissions.set.map((c: any) => db.permission.find((p) => p.id === c.id));
      return withRole(r, { include });
    },
    updateMany: async ({ where, data }: any) => {
      const rows = db[name].filter((r) => match(r, where, name));
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    },
    upsert: async ({ where, update, create }: any) => {
      const r = db[name].find((x) => match(x, where, name));
      if (r) return Object.assign(r, update);
      const row = { id: id(), isActive: true, createdAt: new Date(), ...create };
      db[name].push(row);
      return row;
    },
    delete: async ({ where }: any) => {
      const i = db[name].findIndex((x) => match(x, where, name));
      return db[name].splice(i, 1)[0];
    },
    deleteMany: async ({ where }: any) => {
      const before = db[name].length;
      db[name] = db[name].filter((r) => !match(r, where, name));
      return { count: before - db[name].length };
    },
  });
  return { userOrganization: table('userOrganization'), userRole: table('userRole'), role: table('role'), permission: table('permission'), organizationMemberProfile: { upsert: async () => ({}) } } as any;
}

const A = 'orgA', B = 'orgB', PLATFORM_ORG = 'osiris-platform';
const perm = (name: string) => ({ id: `p-${name}`, name });
const PERMS = ['users:read', 'users:delete', 'roles:update', 'permissions:create', 'organizations:read', 'organizations:update'].map(perm);

function setup() {
  const db = {
    permission: PERMS,
    role: [
      { id: 'rA-admin', name: 'ADH Admin', organizationId: A, permissions: [perm('users:read')] },
      { id: 'rA-sales', name: 'ADH Sales', organizationId: A, permissions: [] },
      { id: 'rA-super', name: 'superadmin', organizationId: A, permissions: [] },
      { id: 'rB-admin', name: 'Admin', organizationId: B, permissions: [] },
      { id: 'rP-osiris', name: 'osirisadmin', organizationId: PLATFORM_ORG, permissions: [] },
    ] as Row[],
    userOrganization: [
      { id: 'uo1', userId: 'take', organizationId: A, isActive: true },
      { id: 'uo2', userId: 'sayaka', organizationId: A, isActive: true },
      { id: 'uo3', userId: 'bob', organizationId: B, isActive: true },
      { id: 'uo4', userId: 'shared', organizationId: A, isActive: true },
      { id: 'uo5', userId: 'shared', organizationId: B, isActive: true },
      { id: 'uo6', userId: 'osiris', organizationId: PLATFORM_ORG, isActive: true },
      { id: 'uo7', userId: 'osiris', organizationId: A, isActive: true },
    ] as Row[],
    userRole: [
      { id: 'ur1', userId: 'take', roleId: 'rA-admin', organizationId: A, isActive: true },
      { id: 'ur2', userId: 'sayaka', roleId: 'rA-sales', organizationId: A, isActive: true },
      { id: 'ur3', userId: 'bob', roleId: 'rB-admin', organizationId: B, isActive: true },
      { id: 'ur4', userId: 'shared', roleId: 'rA-sales', organizationId: A, isActive: true },
      { id: 'ur5', userId: 'shared', roleId: 'rB-admin', organizationId: B, isActive: true },
      { id: 'ur6', userId: 'osiris', roleId: 'rP-osiris', organizationId: PLATFORM_ORG, isActive: true },
      { id: 'ur7', userId: 'osiris', roleId: 'rA-sales', organizationId: A, isActive: true },
    ] as Row[],
  };
  const prisma = fakePrisma(db);
  const clerkClient = {
    users: {
      deleteUser: jest.fn(async () => ({})),
      updateUser: jest.fn(async (_id: string, d: any) => ({ id: _id, firstName: d.firstName ?? 'F', lastName: 'L', emailAddresses: [{ emailAddress: 'x@y' }] })),
      createUser: jest.fn(async () => { throw Object.assign(new Error('exists'), { errors: [{ code: 'form_identifier_exists' }] }); }),
      getUserList: jest.fn(async () => ({ data: [{ id: 'sayaka', externalId: 'sayaka', firstName: 'Sayaka', lastName: 'S', emailAddresses: [{ emailAddress: 'sayaka@adh' }] }] })),
    },
  };
  const clerkIdentity = {
    toClerkUser: jest.fn(async (uid: string) => ({ id: uid, firstName: 'F', lastName: 'L', emailAddresses: [{ emailAddress: `${uid}@x` }], publicMetadata: {} })),
    invalidate: jest.fn(),
    stampExternalId: jest.fn(),
  };
  const users = new UsersService(clerkClient as any, prisma, clerkIdentity as any);
  const roles = new RolesService(prisma);
  return { db, users, roles, clerkClient };
}
const adhAdmin = { orgId: A, platform: false, userId: 'take' };
const platformAdmin = { orgId: A, platform: true, userId: 'osiris' };

describe('round AW — users', () => {
  it('delete: another org\'s user id → 404, nothing changes', async () => {
    const { users, db, clerkClient } = setup();
    await expect(users.deleteUser('bob', adhAdmin)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.userRole.find((r) => r.id === 'ur3')!.isActive).toBe(true);
    expect(clerkClient.users.deleteUser).not.toHaveBeenCalled();
  });

  it('delete: own-org user → membership + roles in this org marked removed (rows kept), Clerk login kept', async () => {
    const { users, db, clerkClient } = setup();
    const res = await users.deleteUser('sayaka', adhAdmin);
    expect(res).toMatchObject({ removedFrom: A, rolesRemoved: 1, clerkDeleted: false, otherMemberships: 0 });
    expect(db.userRole.find((r) => r.id === 'ur2')).toMatchObject({ isActive: false });
    expect(db.userOrganization.find((r) => r.id === 'uo2')).toMatchObject({ isActive: false });
    expect(clerkClient.users.deleteUser).not.toHaveBeenCalled();
  });

  it('delete: a user in two orgs keeps the other org (roles + membership)', async () => {
    const { users, db } = setup();
    await users.deleteUser('shared', adhAdmin);
    expect(db.userRole.find((r) => r.id === 'ur4')!.isActive).toBe(false);
    expect(db.userRole.find((r) => r.id === 'ur5')!.isActive).toBe(true);
    expect(db.userOrganization.find((r) => r.id === 'uo5')!.isActive).toBe(true);
  });

  it('delete: yourself → 400; a platform admin who is in your org → 403', async () => {
    const { users } = setup();
    await expect(users.deleteUser('take', adhAdmin)).rejects.toBeInstanceOf(BadRequestException);
    await expect(users.deleteUser('osiris', adhAdmin)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('delete by a platform admin: Clerk login deleted only when no membership is left', async () => {
    const { users, clerkClient } = setup();
    await users.deleteUser('shared', platformAdmin); // still in org B
    expect(clerkClient.users.deleteUser).not.toHaveBeenCalled();
    const res = await users.deleteUser('sayaka', platformAdmin); // only in A
    expect(res.clerkDeleted).toBe(true);
    expect(clerkClient.users.deleteUser).toHaveBeenCalledWith('sayaka');
  });

  it('update: another org\'s user → 404 (no Clerk change); a role from another org → 404', async () => {
    const { users, clerkClient } = setup();
    await expect(users.updateUser('bob', { password: 'whatever123' } as any, adhAdmin)).rejects.toBeInstanceOf(NotFoundException);
    await expect(users.updateUser('sayaka', { roleIds: ['rB-admin'] } as any, adhAdmin)).rejects.toBeInstanceOf(NotFoundException);
    await expect(users.updateUser('sayaka', { roleIds: ['rP-osiris'] } as any, adhAdmin)).rejects.toBeInstanceOf(NotFoundException);
    expect(clerkClient.users.updateUser).not.toHaveBeenCalled();
  });

  it('update: a body organizationId of another org → 403', async () => {
    const { users } = setup();
    await expect(users.updateUser('sayaka', { organizationId: B, roleIds: ['rA-sales'] } as any, adhAdmin)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('update: email / password of a login shared with another org → 403; the name still changes', async () => {
    const { users, clerkClient } = setup();
    await expect(users.updateUser('shared', { password: 'newpass123' } as any, adhAdmin)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(users.updateUser('shared', { email: 'new@x' } as any, adhAdmin)).rejects.toBeInstanceOf(ForbiddenException);
    await users.updateUser('shared', { firstName: 'New' } as any, adhAdmin);
    expect(clerkClient.users.updateUser).toHaveBeenCalledTimes(1);
  });

  it('change role (own org): old role row kept inactive, new one active', async () => {
    const { users, db } = setup();
    const res = await users.updateUser('sayaka', { roleIds: ['rA-admin'] } as any, adhAdmin);
    expect(db.userRole.find((r) => r.id === 'ur2')!.isActive).toBe(false);
    expect(db.userRole.some((r) => r.userId === 'sayaka' && r.roleId === 'rA-admin' && r.isActive)).toBe(true);
    expect(res.roles.map((r: any) => r.name)).toEqual(['ADH Admin']);
  });

  it('assign / remove role: other-org user → 404, other-org role → 404, own org works (re-assign revives the kept row)', async () => {
    const { users, db } = setup();
    await expect(users.assignRoleToUser('bob', 'rA-sales', A, adhAdmin)).rejects.toBeInstanceOf(NotFoundException);
    await expect(users.assignRoleToUser('sayaka', 'rB-admin', A, adhAdmin)).rejects.toBeInstanceOf(NotFoundException);
    await expect(users.removeRoleFromUser('bob', 'rB-admin', A, adhAdmin)).rejects.toBeInstanceOf(NotFoundException);
    db.userRole.find((r) => r.id === 'ur2')!.isActive = false;
    db.userRole.push({ id: 'ur9', userId: 'sayaka', roleId: 'rA-admin', organizationId: A, isActive: true });
    await users.assignRoleToUser('sayaka', 'rA-sales', A, adhAdmin);
    expect(db.userRole.find((r) => r.id === 'ur2')!.isActive).toBe(true);
  });

  it('add user: another org id or another org\'s role → refused; a removed member comes back', async () => {
    const { users, db } = setup();
    await expect(users.createUser({ email: 'n@x', roleIds: ['rA-sales'], organizationId: B } as any, adhAdmin)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(users.createUser({ email: 'n@x', roleIds: ['rB-admin'] } as any, adhAdmin)).rejects.toBeInstanceOf(NotFoundException);
    await users.deleteUser('sayaka', adhAdmin);
    const back: any = await users.createUser({ email: 'sayaka@adh', roleIds: ['rA-sales'] } as any, adhAdmin);
    expect(back.readded).toBe(true);
    expect(db.userOrganization.find((r) => r.id === 'uo2')!.isActive).toBe(true);
    expect(db.userRole.find((r) => r.id === 'ur2')!.isActive).toBe(true);
  });

  it('platform admin keeps cross-org reach (update another org\'s user)', async () => {
    const { users } = setup();
    await expect(users.updateUser('bob', { firstName: 'Bobby' } as any, platformAdmin)).resolves.toBeTruthy();
  });

  it('profile edit (PATCH /users/:id/profile) checks the user is in the org', async () => {
    const { users } = setup();
    await expect(users.assertReach('bob', adhAdmin)).rejects.toBeInstanceOf(NotFoundException);
    await expect(users.assertReach('sayaka', adhAdmin)).resolves.toBeUndefined();
  });
});

describe('round AW — roles', () => {
  it.each(['osirisadmin', 'OsirisAdmin', 'osiris admin', 'super_admin', 'Super Admin', 'ADMIN', 'field tech', 'Normal User', 'designer', 'junior-manager', 'Senior  Manager', 'marketing'])(
    'reserved name "%s" → 400 on create',
    async (name) => {
      const { roles } = setup();
      await expect(roles.create({ name } as any, A, adhAdmin)).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('ordinary names are not reserved', () => {
    for (const n of ['ADH Admin', 'Management', 'Manager', 'Sales', 'Admin Assistant']) expect(isReservedRoleName(n)).toBe(false);
  });

  it('rename to a reserved name → 400; a platform admin may', async () => {
    const { roles } = setup();
    await expect(roles.update('rA-sales', { name: 'osirisadmin' } as any, adhAdmin)).rejects.toBeInstanceOf(BadRequestException);
    await expect(roles.update('rA-sales', { name: 'Marketing' } as any, platformAdmin)).resolves.toBeTruthy();
  });

  it('another org\'s role: read / update / delete → 404', async () => {
    const { roles } = setup();
    await expect(roles.findOne('rB-admin', adhAdmin)).rejects.toBeInstanceOf(NotFoundException);
    await expect(roles.update('rB-admin', { description: 'x' } as any, adhAdmin)).rejects.toBeInstanceOf(NotFoundException);
    await expect(roles.remove('rB-admin', adhAdmin)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('own-org role edit works; the superadmin role is Osiris-only (403)', async () => {
    const { roles } = setup();
    await expect(roles.update('rA-sales', { description: 'sales team', permissionIds: ['p-users:read'] } as any, adhAdmin)).resolves.toBeTruthy();
    await expect(roles.update('rA-super', { description: 'x' } as any, adhAdmin)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(roles.remove('rA-super', adhAdmin)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('adding a cross-org permission → 403; keeping one the role already has is fine', async () => {
    const { roles, db } = setup();
    await expect(roles.update('rA-sales', { permissionIds: ['p-permissions:create'] } as any, adhAdmin)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(roles.create({ name: 'Ops', permissionIds: ['p-organizations:read'] } as any, A, adhAdmin)).rejects.toBeInstanceOf(ForbiddenException);
    db.role.find((r) => r.id === 'rA-admin')!.permissions.push(perm('organizations:read'));
    await expect(roles.update('rA-admin', { permissionIds: ['p-users:read', 'p-organizations:read', 'p-organizations:update'] } as any, adhAdmin)).resolves.toBeTruthy();
  });
});

describe('round AW — permission catalogue', () => {
  const ctrl = new PermissionsController({ create: jest.fn(), update: jest.fn(), remove: jest.fn(), findAll: jest.fn(() => []) } as any);
  it('create / update / delete → 403 unless osirisadmin; read unchanged', () => {
    expect(() => ctrl.create({} as any, { isOsirisAdmin: false })).toThrow(ForbiddenException);
    expect(() => ctrl.update('x', {} as any, {})).toThrow(ForbiddenException);
    expect(() => ctrl.remove('x', { isOsirisAdmin: false })).toThrow(ForbiddenException);
    expect(() => ctrl.create({} as any, { isOsirisAdmin: true })).not.toThrow();
    expect(ctrl.findAll()).toEqual([]);
  });
});

describe('round AW — controller passes the caller through', () => {
  it('DELETE /users/:id acts in the caller\'s org and records what it did', async () => {
    const svc = { deleteUser: jest.fn(async () => ({ removedFrom: A, rolesRemoved: 1, clerkDeleted: false })) };
    const req: any = { isOsirisAdmin: false, user: { id: 'take' } };
    await new UsersController(svc as any).deleteUser('sayaka', { id: A, name: 'ADH' }, req);
    expect(svc.deleteUser).toHaveBeenCalledWith('sayaka', { orgId: A, platform: false, userId: 'take' });
    expect(req.actionLogResult).toEqual({ removedFrom: A, rolesRemoved: 1, clerkDeleted: false });
  });
});

describe('round AW — platform admin = the osiris-platform org\'s osirisadmin role', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { isPlatformAdminRole, PLATFORM_ORG_ID } = require('../auth/admin-scope');
  it('only the osirisadmin role of osiris-platform counts', () => {
    expect(PLATFORM_ORG_ID).toBe('osiris-platform');
    expect(isPlatformAdminRole({ organizationId: 'osiris-platform', role: { name: 'osirisadmin', organizationId: 'osiris-platform' } })).toBe(true);
    expect(isPlatformAdminRole({ organizationId: 'orgA', role: { name: 'osirisadmin', organizationId: 'orgA' } })).toBe(false);
    expect(isPlatformAdminRole({ organizationId: 'orgA', role: { name: 'osirisadmin', organizationId: 'osiris-platform' } })).toBe(false);
    expect(isPlatformAdminRole({ organizationId: 'osiris-platform', role: { name: 'superadmin', organizationId: 'osiris-platform' } })).toBe(false);
    expect(isPlatformAdminRole({ role: { name: 'osirisadmin', organizationId: 'osiris-platform' } })).toBe(true); // selects without the row's org id
    expect(isPlatformAdminRole(null)).toBe(false);
  });
  it('the guard, the WhatsApp operator, notifications and users all use that rule (no bare name check left)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    for (const f of ['../auth/clerk-auth.guard.ts', '../operator/operator-auth.service.ts', '../notifications/notifications.service.ts', './users.service.ts']) {
      const src = fs.readFileSync(require('path').join(__dirname, f), 'utf8');
      expect(src).not.toMatch(/name === 'osirisadmin'|name: 'osirisadmin' \}/);
      expect(src).toMatch(/isPlatformAdminRole|PLATFORM_ADMIN_ROLE_WHERE/);
    }
  });
});

describe('round AW — GET /organizations and /organizations/:id', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { OrganizationsController } = require('../organizations/organizations.controller');
  const orgs = [{ id: 'orgA', name: 'ADH' }, { id: 'orgB', name: 'WCT' }];
  const svc = { findAll: jest.fn(async () => orgs), findOne: jest.fn(async (id: string) => orgs.find((o) => o.id === id) ?? null) };
  const ctrl = new OrganizationsController(svc as any);
  it('a non-platform caller lists only their current org', async () => {
    const res = await ctrl.getOrganizations({ isOsirisAdmin: false, userOrganization: { id: 'orgA' } } as any);
    expect(res.data.map((o: any) => o.id)).toEqual(['orgA']);
  });
  it('a platform admin lists every org', async () => {
    const res = await ctrl.getOrganizations({ isOsirisAdmin: true, userOrganization: { id: 'orgA' } } as any);
    expect(res.data).toHaveLength(2);
  });
  it('another org by id reads as not found (service not even called); own org and platform admin work', async () => {
    svc.findOne.mockClear();
    const other = await ctrl.getOrganizationById('orgB', { isOsirisAdmin: false, userOrganization: { id: 'orgA' } } as any);
    expect(other).toMatchObject({ success: false, data: null });
    expect(svc.findOne).not.toHaveBeenCalled();
    expect((await ctrl.getOrganizationById('orgA', { isOsirisAdmin: false, userOrganization: { id: 'orgA' } } as any)).data.id).toBe('orgA');
    expect((await ctrl.getOrganizationById('orgB', { isOsirisAdmin: true, userOrganization: { id: 'orgA' } } as any)).data.id).toBe('orgB');
  });
});

describe('round AW — ADH Admin\'s normal flows in ADH', () => {
  it('add a new user → Clerk user + ADH membership + ADH role; change their role; remove them (Clerk login kept)', async () => {
    const { users, db, clerkClient } = setup();
    (clerkClient.users.createUser as jest.Mock).mockImplementationOnce(async () => ({ id: 'newbie', firstName: 'New', lastName: 'Hire', emailAddresses: [{ emailAddress: 'new@adh' }] }) as any);
    const made: any = await users.createUser({ email: 'new@adh', firstName: 'New', lastName: 'Hire', password: 'x', roleIds: ['rA-sales'] } as any, adhAdmin);
    expect(made.roles.map((r: any) => r.name)).toEqual(['ADH Sales']);
    expect(db.userOrganization.some((r) => r.userId === 'newbie' && r.organizationId === A && r.isActive)).toBe(true);
    const changed = await users.updateUser('newbie', { roleIds: ['rA-admin'] } as any, adhAdmin);
    expect(changed.roles.map((r: any) => r.name)).toEqual(['ADH Admin']);
    const gone = await users.deleteUser('newbie', adhAdmin);
    expect(gone).toMatchObject({ removedFrom: A, clerkDeleted: false });
    expect(db.userRole.filter((r) => r.userId === 'newbie' && r.isActive)).toHaveLength(0);
    expect(clerkClient.users.deleteUser).not.toHaveBeenCalled();
  });
});
