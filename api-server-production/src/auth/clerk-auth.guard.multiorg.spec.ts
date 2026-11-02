import { ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ClerkAuthGuard } from './clerk-auth.guard';
import { NOT_A_MEMBER_MESSAGE } from './active-org';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PERMISSIONS_KEY } from './decorators/permissions.decorator';

/**
 * Multi-organisation users (2026-11-02): which org a request runs in.
 * A user in A + B: the header picks one of THEIR orgs, any other org is a 403,
 * no header = the most recently used membership, roles / permissions come from
 * the active org only; osiris admins keep any-org; an invited email becomes a
 * member on its first request.
 */
const A = 'org-a';
const B = 'org-b';
const C = 'org-c';
const day = (d: number) => new Date(Date.UTC(2026, 10, d));

function world() {
  const orgs: Record<string, any> = {
    [A]: { id: A, name: 'Org A' },
    [B]: { id: B, name: 'Org B' },
    [C]: { id: C, name: 'Org C' },
    'osiris-platform': { id: 'osiris-platform', name: 'osiris-platform' },
  };
  const role = (id: string, organizationId: string, name: string, perms: string[]) => ({
    id,
    name,
    organizationId,
    permissions: perms.map((p) => ({ name: p, resource: p.split(':')[0], action: p.split(':')[1] })),
  });
  const roles: Record<string, any> = {
    adminA: role('adminA', A, 'Admin', ['documents:delete', 'documents:read']),
    accountsB: role('accountsB', B, 'Accounts', ['documents:read']),
    osiris: role('osiris', 'osiris-platform', 'osirisadmin', []),
    salesC: role('salesC', C, 'Sales', ['documents:read']),
  };
  const memberships: any[] = [
    { userId: 'u1', organizationId: A, isActive: true, joinedAt: day(1), lastActiveAt: null },
    { userId: 'u1', organizationId: B, isActive: true, joinedAt: day(2), lastActiveAt: null },
    { userId: 'admin', organizationId: 'osiris-platform', isActive: true, joinedAt: day(1), lastActiveAt: null },
  ];
  const userRoles: any[] = [
    { id: 'ur1', userId: 'u1', organizationId: A, roleId: 'adminA', isActive: true },
    { id: 'ur2', userId: 'u1', organizationId: B, roleId: 'accountsB', isActive: true },
    { id: 'ur3', userId: 'admin', organizationId: 'osiris-platform', roleId: 'osiris', isActive: true },
  ];
  const invites: any[] = [];
  const withOrg = (m: any) => (m ? { organization: orgs[m.organizationId] } : null);
  const prisma: any = {
    userRole: {
      findMany: async ({ where }: any) => userRoles.filter((r) => r.userId === where.userId && r.isActive).map((r) => ({ id: r.id, organizationId: r.organizationId, role: roles[r.roleId] })),
      upsert: async ({ create }: any) => (userRoles.push({ id: `ur${userRoles.length + 1}`, ...create, isActive: true }), create),
    },
    userOrganization: {
      findFirst: async ({ where, orderBy }: any) => {
        let list = memberships.filter((m) => m.userId === where.userId && m.isActive && (!where.organizationId || m.organizationId === where.organizationId));
        if (orderBy) list = [...list].sort((x, y) => (y.lastActiveAt?.getTime() ?? -1) - (x.lastActiveAt?.getTime() ?? -1) || x.joinedAt - y.joinedAt);
        return withOrg(list[0]);
      },
      upsert: async ({ create }: any) => (memberships.push({ ...create, joinedAt: new Date(), lastActiveAt: null }), create),
    },
    organization: { findUnique: async ({ where }: any) => orgs[where.id] ?? null },
    pendingOrgInvite: {
      findMany: async ({ where }: any) => invites.filter((i) => where.email.in.includes(i.email) && !i.acceptedAt && !i.revokedAt),
      update: async ({ where, data }: any) =>
        Object.assign(
          invites.find((i) => i.id === where.id),
          data,
        ),
    },
    role: { findMany: async ({ where }: any) => Object.values(roles).filter((r: any) => where.id.in.includes(r.id) && r.organizationId === where.organizationId) },
  };
  return { prisma, memberships, invites, userRoles };
}

function run(w: ReturnType<typeof world>, userId: string, headers: Record<string, string> = {}, perms: string[] = [], emails: string[] = []) {
  ClerkAuthGuard.invalidateAll();
  const reflector: any = {
    getAllAndOverride: (key: string) => (key === IS_PUBLIC_KEY ? false : undefined),
    get: (key: string) => (key === PERMISSIONS_KEY ? perms : undefined),
  };
  const guard = new ClerkAuthGuard(reflector, w.prisma);
  const req: any = { headers, user: { id: userId, emailAddresses: emails.map((e) => ({ emailAddress: e })) } };
  const ctx: any = { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => null, getClass: () => null };
  return guard.canActivate(ctx).then(
    (ok) => ({ ok, req }),
    (err) => ({ ok: false, err, req }),
  );
}

describe('ClerkAuthGuard: multi-organisation users', () => {
  // Skip Clerk token verification: request.user is set by the test.
  beforeAll(() => jest.spyOn((AuthGuard('clerk') as any).prototype, 'canActivate').mockResolvedValue(true));
  afterAll(() => jest.restoreAllMocks());

  it('no header: the oldest membership when none was used yet, then the most recently used one', async () => {
    const w = world();
    expect((await run(w, 'u1')).req.userOrganization.id).toBe(A);
    w.memberships.find((m) => m.organizationId === B).lastActiveAt = day(5);
    expect((await run(w, 'u1')).req.userOrganization.id).toBe(B);
  });

  it('a header for one of my orgs switches to it', async () => {
    const r = await run(world(), 'u1', { 'x-active-org-id': B });
    expect(r.ok).toBe(true);
    expect(r.req.userOrganization.id).toBe(B);
  });

  it("a header for an org I am not an active member of is a 403, never another org's data", async () => {
    for (const org of [C, 'no-such-org']) {
      const r: any = await run(world(), 'u1', { 'x-active-org-id': org });
      expect(r.err).toBeInstanceOf(ForbiddenException);
      expect(r.err.message).toBe(NOT_A_MEMBER_MESSAGE);
      expect(r.req.userOrganization).toBeUndefined();
    }
    const w = world();
    w.memberships.find((m) => m.organizationId === B).isActive = false; // removed from B
    expect(((await run(w, 'u1', { 'x-active-org-id': B })) as any).err).toBeInstanceOf(ForbiddenException);
  });

  it('X-Use-Real-Org ignores the header (the portal bootstrap) and gives the default org', async () => {
    const r = await run(world(), 'u1', { 'x-active-org-id': C, 'x-use-real-org': '1' });
    expect(r.ok).toBe(true);
    expect(r.req.userOrganization.id).toBe(A);
  });

  it('permissions come from the active org only: Admin in A, Accounts in B', async () => {
    const w = world();
    expect((await run(w, 'u1', {}, ['documents:delete'])).ok).toBe(true);
    const inB: any = await run(w, 'u1', { 'x-active-org-id': B }, ['documents:delete']);
    expect(inB.err).toBeInstanceOf(ForbiddenException);
    expect((await run(w, 'u1', { 'x-active-org-id': B }, ['documents:read'])).ok).toBe(true);
  });

  it('osiris admins keep switching to any org', async () => {
    const r = await run(world(), 'admin', { 'x-active-org-id': C });
    expect(r.ok).toBe(true);
    expect(r.req.userOrganization.id).toBe(C);
    expect(r.req.isOsirisAdmin).toBe(true);
  });

  it('an invited email becomes a member with its roles on its first request; a cancelled invitation does not', async () => {
    const w = world();
    w.invites.push({ id: 'i1', organizationId: C, email: 'new@x.sg', roleIds: ['salesC'], acceptedAt: null, revokedAt: null });
    const r = await run(w, 'newbie', {}, ['documents:read'], ['New@X.sg']);
    expect(r.ok).toBe(true);
    expect(r.req.userOrganization.id).toBe(C);
    expect(w.invites[0].acceptedAt).toBeInstanceOf(Date);
    expect(w.userRoles.some((u) => u.userId === 'newbie' && u.roleId === 'salesC')).toBe(true);

    const w2 = world();
    w2.invites.push({ id: 'i2', organizationId: C, email: 'gone@x.sg', roleIds: ['salesC'], acceptedAt: null, revokedAt: new Date() });
    const r2: any = await run(w2, 'other', {}, [], ['gone@x.sg']);
    expect(r2.err).toBeInstanceOf(ForbiddenException);
    expect(r2.err.message).toMatch(/not assigned to any organization/);
  });
});
