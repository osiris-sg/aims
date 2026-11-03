import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ADD_MEMBER_FAILED, ADD_MEMBER_REPLY, MembershipsService, SET_PASSWORD_LINK_SECONDS } from './memberships.service';

const A = 'org-a';
const B = 'org-b';

function world() {
  const memberships: any[] = [
    { userId: 'me', organizationId: A, isActive: true, joinedAt: new Date('2026-11-01'), lastActiveAt: null },
    { userId: 'me', organizationId: B, isActive: true, joinedAt: new Date('2026-11-02'), lastActiveAt: null },
    { userId: 'existing', organizationId: B, isActive: true, joinedAt: new Date('2026-10-01'), lastActiveAt: null },
  ];
  const userRoles: any[] = [{ userId: 'boss', organizationId: 'osiris-platform', roleId: 'osirisadmin', isActive: true, platform: true }];
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
  };
  const clerk: any = {
    users: {
      getUserList: jest.fn(async ({ emailAddress }: any) => ({ data: logins[emailAddress[0]] ? [logins[emailAddress[0]]] : [] })),
      createUser: jest.fn(async ({ emailAddress }: any) => {
        const u = { id: `new_${emailAddress[0]}` };
        logins[emailAddress[0]] = u;
        return u;
      }),
    },
  };
  clerk.signInTokens = { createSignInToken: jest.fn(async ({ userId }: any) => ({ token: `tok-${userId}` })) };
  const identity = { stampExternalId: jest.fn(async () => undefined) };
  const email = { sendSimpleEmail: jest.fn(async () => ({ success: true, messageId: 'm1' })) };
  const actionLog = { system: jest.fn() };
  const svc = new MembershipsService(prisma, clerk, identity as any, email as any, actionLog as any);
  return { svc, memberships, userRoles, clerk, identity, email, actionLog };
}
const adminOfA = { orgId: A, platform: false, userId: 'me' };
const memberOfA = (w: any, userId: string) => w.memberships.find((m: any) => m.userId === userId && m.organizationId === A && m.isActive);

describe('MembershipsService', () => {
  it('my organisations: only mine', async () => {
    const w = world();
    const r = await w.svc.myOrganizations('me', { id: A }, false);
    expect(r.organizations.map((o) => o.id).sort()).toEqual([A, B]);
    expect(r.isOsirisAdmin).toBe(false);
  });

  it('switching remembers one of my orgs; another org is a 403', async () => {
    const w = world();
    await expect(w.svc.setActiveOrg('me', B, false)).resolves.toEqual({ organizationId: B, remembered: true });
    await expect(w.svc.setActiveOrg('me', 'org-c', false)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(w.svc.setActiveOrg('boss', 'org-c', true)).resolves.toEqual({ organizationId: 'org-c', remembered: false });
  });

  it('Add user: an existing login (in another org) and a new email get IDENTICAL replies and both become members at once', async () => {
    const w = world();
    const existing = await w.svc.addByEmail('Existing@x.sg', ['roleA'], adminOfA);
    const fresh = await w.svc.addByEmail('new@x.sg', ['roleA'], adminOfA);
    expect(existing).toEqual({ ok: true, message: ADD_MEMBER_REPLY('existing@x.sg', 'ORG-A') });
    expect(fresh).toEqual({ ok: true, message: ADD_MEMBER_REPLY('new@x.sg', 'ORG-A') });
    expect(existing.message.replace('existing@x.sg', 'E')).toBe(fresh.message.replace('new@x.sg', 'E'));
    expect(Object.keys(existing).sort()).toEqual(['message', 'ok']);
    expect(memberOfA(w, 'existing')).toBeTruthy();
    expect(memberOfA(w, 'new_new@x.sg')).toBeTruthy();
    // the existing login's other org is untouched; only the new email got a login made for it
    expect(w.memberships.filter((m) => m.userId === 'existing' && m.organizationId === B && m.isActive)).toHaveLength(1);
    expect(w.clerk.users.createUser).toHaveBeenCalledTimes(1);
    expect(w.clerk.users.createUser).toHaveBeenCalledWith(expect.objectContaining({ emailAddress: ['new@x.sg'] }));
    expect(w.identity.stampExternalId).toHaveBeenCalledWith('new_new@x.sg');
  });

  it('adding again is harmless and gives the same reply', async () => {
    const w = world();
    const a = await w.svc.addByEmail('existing@x.sg', ['roleA'], adminOfA);
    const b = await w.svc.addByEmail('existing@x.sg', ['roleA'], adminOfA);
    expect(b).toEqual(a);
    expect(w.memberships.filter((m) => m.userId === 'existing' && m.organizationId === A)).toHaveLength(1);
  });

  it('one error wording for anything that stops it: a platform admin, a login lookup failure, a create failure', async () => {
    const w = world();
    const err = async (p: Promise<any>) =>
      p.then(
        () => null,
        (e) => e,
      );
    const e1 = await err(w.svc.addByEmail('boss@osiris.sg', ['roleA'], adminOfA));
    w.clerk.users.getUserList.mockRejectedValueOnce(new Error('clerk down'));
    const e2 = await err(w.svc.addByEmail('x@x.sg', ['roleA'], adminOfA));
    w.clerk.users.createUser.mockRejectedValueOnce(new Error('form_identifier_exists'));
    const e3 = await err(w.svc.addByEmail('y@x.sg', ['roleA'], adminOfA));
    for (const e of [e1, e2, e3]) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect(e.message).toBe(ADD_MEMBER_FAILED);
    }
    expect(memberOfA(w, 'boss')).toBeFalsy();
  });

  it("form checks: a valid email and roles of the caller's org", async () => {
    const w = world();
    await expect(w.svc.addByEmail('existing@x.sg', ['roleB'], adminOfA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(w.svc.addByEmail('not-an-email', ['roleA'], adminOfA)).rejects.toBeInstanceOf(BadRequestException);
    await expect(w.svc.addByEmail('a@x.sg', [], adminOfA)).rejects.toBeInstanceOf(BadRequestException);
    expect(w.clerk.users.createUser).not.toHaveBeenCalled();
  });

  it('the success text is the one the owner asked for, the same for every case', () => {
    expect(ADD_MEMBER_REPLY('a@x.sg', 'WCT')).toBe("a@x.sg has been added to WCT. They'll get an email to set their password, or can sign in with Google/phone if set up.");
    expect(ADD_MEMBER_REPLY('a@x.sg', 'WCT')).not.toMatch(/\u2014|\u2013/);
  });

  it('a NEW login gets a "set your password" email (one-time link, 7 days); an existing login is sent nothing', async () => {
    const w = world();
    await w.svc.addByEmail('existing@x.sg', ['roleA'], adminOfA);
    expect(w.email.sendSimpleEmail).not.toHaveBeenCalled();
    expect(w.clerk.signInTokens.createSignInToken).not.toHaveBeenCalled();
    await w.svc.addByEmail('new@x.sg', ['roleA'], adminOfA);
    expect(w.clerk.signInTokens.createSignInToken).toHaveBeenCalledWith({ userId: 'new_new@x.sg', expiresInSeconds: SET_PASSWORD_LINK_SECONDS });
    expect(w.email.sendSimpleEmail).toHaveBeenCalledTimes(1);
    const sent = (w.email.sendSimpleEmail.mock.calls[0] as any[])[0];
    expect(sent.to).toEqual(['new@x.sg']);
    expect(sent.subject).toBe('Set your AIMS password');
    expect(sent.html).toContain('/set-password?ticket=tok-new_new%40x.sg');
    expect(sent.html).toContain('ORG-A');
    expect(sent.html).not.toMatch(/\u2014|\u2013/);
    // the outcome is logged without an org, so the org's Activity Log can't tell a new login from an existing one
    expect(w.actionLog.system).toHaveBeenCalledWith('add-user-welcome-email', 'EMAIL_SENT', 'user', expect.not.objectContaining({ organizationId: expect.anything() }));
  });

  it('a failed welcome email never changes the reply (logged as a platform-only failure)', async () => {
    const w = world();
    w.email.sendSimpleEmail.mockResolvedValueOnce({ success: false, error: 'resend down' } as any);
    const r = await w.svc.addByEmail('new@x.sg', ['roleA'], adminOfA);
    expect(r).toEqual({ ok: true, message: ADD_MEMBER_REPLY('new@x.sg', 'ORG-A') });
    expect(memberOfA(w, 'new_new@x.sg')).toBeTruthy();
    expect(w.actionLog.system).toHaveBeenCalledWith('add-user-welcome-email', 'EMAIL_FAILED', 'user', expect.objectContaining({ status: 'FAILURE', details: { error: 'resend down' } }));
    w.clerk.signInTokens.createSignInToken.mockRejectedValueOnce(new Error('clerk down'));
    await expect(w.svc.addByEmail('other@x.sg', ['roleA'], adminOfA)).resolves.toEqual({ ok: true, message: ADD_MEMBER_REPLY('other@x.sg', 'ORG-A') });
  });
});
