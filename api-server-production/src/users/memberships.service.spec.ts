import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ADD_MEMBER_REPLY, MembershipsService } from './memberships.service';

const A = 'org-a';
const B = 'org-b';

function world() {
  const memberships: any[] = [
    { userId: 'me', organizationId: A, isActive: true, joinedAt: new Date('2026-11-01'), lastActiveAt: null },
    { userId: 'me', organizationId: B, isActive: true, joinedAt: new Date('2026-11-02'), lastActiveAt: null },
    { userId: 'existing', organizationId: B, isActive: true, joinedAt: new Date('2026-10-01'), lastActiveAt: null },
  ];
  const userRoles: any[] = [{ userId: 'boss', organizationId: 'osiris-platform', roleId: 'osirisadmin', isActive: true, platform: true }];
  const invites: any[] = [];
  const roles = [
    { id: 'roleA', name: 'Admin', organizationId: A },
    { id: 'roleB', name: 'Accounts', organizationId: B },
  ];
  const logins: Record<string, any> = { 'existing@x.sg': { id: 'existing' }, 'boss@osiris.sg': { id: 'boss' } };
  const key = (w: any) => w.userId_organizationId ?? w;
  const prisma: any = {
    userOrganization: {
      findMany: async ({ where }: any) =>
        memberships
          .filter((m) => m.userId === where.userId && m.isActive)
          .map((m) => ({ organizationId: m.organizationId, lastActiveAt: m.lastActiveAt, organization: { id: m.organizationId, name: m.organizationId.toUpperCase(), logo: null } })),
      findUnique: async ({ where }: any) => memberships.find((m) => m.userId === key(where).userId && m.organizationId === key(where).organizationId) ?? null,
      updateMany: async ({ where, data }: any) => {
        const rows = memberships.filter((m) => m.userId === where.userId && m.organizationId === where.organizationId && m.isActive);
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
      upsert: async ({ where, update, create }: any) => {
        const k = key(where);
        const row = memberships.find((m) => m.userId === k.userId && m.organizationId === k.organizationId);
        if (row) Object.assign(row, update);
        else memberships.push({ ...create, joinedAt: new Date(), lastActiveAt: null });
      },
    },
    userRole: {
      findMany: async () => [],
      count: async ({ where }: any) => userRoles.filter((r) => r.userId === where.userId && r.platform).length,
      upsert: async ({ create }: any) => userRoles.push({ ...create, isActive: true }),
    },
    notification: { groupBy: async () => [] },
    role: { findMany: async ({ where }: any) => roles.filter((r) => where.id.in.includes(r.id) && r.organizationId === where.organizationId) },
    organization: { findUnique: async ({ where }: any) => ({ id: where.id, name: where.id.toUpperCase() }) },
    pendingOrgInvite: {
      findMany: async ({ where }: any) => invites.filter((i) => i.organizationId === where.organizationId && !i.acceptedAt && !i.revokedAt),
      findFirst: async ({ where }: any) => invites.find((i) => i.id === where.id && i.organizationId === where.organizationId && !i.acceptedAt && !i.revokedAt) ?? null,
      update: async ({ where, data }: any) =>
        Object.assign(
          invites.find((i) => i.id === where.id),
          data,
        ),
      upsert: async ({ where, update, create }: any) => {
        const k = where.organizationId_email;
        const row = invites.find((i) => i.organizationId === k.organizationId && i.email === k.email);
        if (row) Object.assign(row, update);
        else invites.push({ id: `inv${invites.length + 1}`, ...create, acceptedAt: null, revokedAt: null });
      },
    },
  };
  const clerk: any = {
    users: { getUserList: jest.fn(async ({ emailAddress }: any) => ({ data: logins[emailAddress[0]] ? [logins[emailAddress[0]]] : [] })) },
    invitations: { createInvitation: jest.fn(async () => ({ id: 'clerk_inv_1' })), revokeInvitation: jest.fn(async () => ({})) },
  };
  const email = { sendSimpleEmail: jest.fn(async () => ({ success: true })) };
  const notifications = { emit: jest.fn(async () => undefined) };
  const svc = new MembershipsService(prisma, clerk, email as any, notifications as any);
  return { svc, memberships, userRoles, invites, clerk, email, notifications };
}
const adminOfA = { orgId: A, platform: false, userId: 'me', name: 'Finance Lead' };

describe('MembershipsService', () => {
  it('my organisations: only mine, default first', async () => {
    const w = world();
    w.memberships.find((m) => m.organizationId === B).lastActiveAt = new Date('2026-11-02T10:00:00Z');
    const r = await w.svc.myOrganizations('me', [], { id: A }, false);
    expect(r.organizations.map((o) => o.id).sort()).toEqual([A, B]);
    expect(r.isOsirisAdmin).toBe(false);
  });

  it('switching remembers one of my orgs; another org is a 403', async () => {
    const w = world();
    await expect(w.svc.setActiveOrg('me', B, false)).resolves.toEqual({ organizationId: B, remembered: true });
    expect(w.memberships.find((m) => m.userId === 'me' && m.organizationId === B).lastActiveAt).toBeInstanceOf(Date);
    await expect(w.svc.setActiveOrg('me', 'org-c', false)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(w.svc.setActiveOrg('boss', 'org-c', true)).resolves.toEqual({ organizationId: 'org-c', remembered: false });
  });

  it('add by email gives the SAME reply for a login in another org, no login, and a login that cannot be added', async () => {
    const w = world();
    const existing = await w.svc.addByEmail('Existing@x.sg', ['roleA'], adminOfA); // in org B already
    const nobody = await w.svc.addByEmail('nobody@x.sg', ['roleA'], adminOfA);
    const platform = await w.svc.addByEmail('boss@osiris.sg', ['roleA'], adminOfA);
    expect(Object.keys(existing).sort()).toEqual(['message', 'ok']);
    expect(existing).toEqual({ ok: true, message: ADD_MEMBER_REPLY('existing@x.sg', 'ORG-A') });
    expect(nobody).toEqual({ ok: true, message: ADD_MEMBER_REPLY('nobody@x.sg', 'ORG-A') });
    expect(platform).toEqual({ ok: true, message: ADD_MEMBER_REPLY('boss@osiris.sg', 'ORG-A') });
    // what actually happened behind the same words:
    expect(w.memberships.some((m) => m.userId === 'existing' && m.organizationId === A && m.isActive)).toBe(true);
    expect(w.memberships.filter((m) => m.userId === 'existing' && m.organizationId === B)).toHaveLength(1); // B untouched
    expect(w.invites).toMatchObject([{ organizationId: A, email: 'nobody@x.sg', roleIds: ['roleA'] }]);
    expect(w.clerk.invitations.createInvitation).toHaveBeenCalledTimes(1);
    expect(w.memberships.some((m) => m.userId === 'boss' && m.organizationId === A)).toBe(false);
  });

  it('the added person gets an in-app notice in that org and an email; re-adding an active member sends nothing again', async () => {
    const w = world();
    await w.svc.addByEmail('existing@x.sg', ['roleA'], adminOfA);
    expect(w.notifications.emit).toHaveBeenCalledWith(expect.objectContaining({ organizationId: A, forUserId: 'existing', exclusive: true, kind: 'member_added' }));
    expect(w.email.sendSimpleEmail).toHaveBeenCalledWith(expect.objectContaining({ to: ['existing@x.sg'] }));
    await w.svc.addByEmail('existing@x.sg', ['roleA'], adminOfA);
    expect(w.email.sendSimpleEmail).toHaveBeenCalledTimes(1);
  });

  it("roles must be the caller's org's; the email must be an email", async () => {
    const w = world();
    await expect(w.svc.addByEmail('existing@x.sg', ['roleB'], adminOfA)).rejects.toBeInstanceOf(NotFoundException);
    await expect(w.svc.addByEmail('not-an-email', ['roleA'], adminOfA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(w.svc.addByEmail('a@x.sg', [], adminOfA)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("invitations: listed and cancelled in the caller's org only", async () => {
    const w = world();
    await w.svc.addByEmail('nobody@x.sg', ['roleA'], adminOfA);
    expect(await w.svc.listInvites(B)).toEqual([]);
    const [inv] = await w.svc.listInvites(A);
    expect(inv).toMatchObject({ email: 'nobody@x.sg', roles: ['Admin'], invitedByName: 'Finance Lead' });
    await expect(w.svc.revokeInvite(B, inv.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(w.svc.revokeInvite(A, inv.id)).resolves.toEqual({ ok: true });
    expect(w.clerk.invitations.revokeInvitation).toHaveBeenCalledWith('clerk_inv_1');
    expect(await w.svc.listInvites(A)).toEqual([]);
  });
});
