import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { ADD_MEMBER_FAILED, ADD_MEMBER_REPLY, ADMIN_SET_PASSWORD_FLAG, MembershipsService, SET_PASSWORD_LINK_SECONDS, memberLabel, normSgMobile } from './memberships.service';

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
  const logins: Record<string, any> = { 'existing@x.sg': { id: 'existing' }, '+6591112222': { id: 'existing' }, '+6598887777': { id: 'phoneonly' }, 'boss@osiris.sg': { id: 'boss' } };
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
  // logins keyed by email AND by phone (one login can be under both keys)
  const clerk: any = {
    users: {
      getUserList: jest.fn(async ({ emailAddress, phoneNumber }: any) => {
        const k = (emailAddress ?? phoneNumber)[0];
        return { data: logins[k] ? [logins[k]] : [] };
      }),
      createUser: jest.fn(async (p: any) => {
        const u = { id: `new_${p.emailAddress?.[0] ?? p.phoneNumber[0]}` };
        if (p.emailAddress) logins[p.emailAddress[0]] = u;
        if (p.phoneNumber) logins[p.phoneNumber[0]] = u;
        return u;
      }),
      updateUser: jest.fn(async () => ({})),
      updateUserMetadata: jest.fn(async () => ({})),
    },
  };
  clerk.signInTokens = { createSignInToken: jest.fn(async ({ userId }: any) => ({ token: `tok-${userId}` })) };
  const identity: any = { stampExternalId: jest.fn(async () => undefined) };
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
    expect(ADD_MEMBER_REPLY('a@x.sg', 'WCT')).toBe('a@x.sg has been added to WCT. They can sign in at app.ai-ms.io with their email or mobile.');
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

  // ── the full form (2026-11-03) ──
  const add = (w: any, input: any) => w.svc.addMember({ roleIds: ['roleA'], ...input }, adminOfA);
  const sentTo = (w: any) => w.email.sendSimpleEmail.mock.calls.map((c: any[]) => c[0]);

  it('SG mobile: 8 digits starting with 8 or 9, spaces / +65 / 65 accepted; the label shows both when both are entered', () => {
    expect(normSgMobile('9123 4567')).toBe('+6591234567');
    expect(normSgMobile('+65 8123-4567')).toBe('+6581234567');
    expect(normSgMobile('6591234567')).toBe('+6591234567');
    for (const bad of ['6123 4567', '912345', '+60 91234567', '91234567x', '']) expect(normSgMobile(bad)).toBeNull();
    expect(memberLabel('a@b.sg', '+6591234567')).toBe('a@b.sg (+65 9123 4567)');
    expect(memberLabel(null, '+6591234567')).toBe('+65 9123 4567');
    expect(memberLabel('a@b.sg', null)).toBe('a@b.sg');
  });

  it('new vs existing: IDENTICAL responses, by email and by phone, with and without names / password', async () => {
    const w = world();
    const extras = [{}, { firstName: 'Hui', lastName: 'Kong' }, { firstName: 'Hui', lastName: 'Kong', password: 'secret123' }];
    for (const x of extras) {
      const ex = await add(w, { email: 'existing@x.sg', ...x });
      const nu = await add(w, { email: `n${extras.indexOf(x)}@x.sg`, ...x });
      expect(Object.keys(ex).sort()).toEqual(['message', 'ok']);
      expect(ex.message.replace('existing@x.sg', 'E')).toBe(nu.message.replace(`n${extras.indexOf(x)}@x.sg`, 'E'));
      const exP = await add(w, { phone: '9111 2222', ...x });
      const nuP = await add(w, { phone: `9300 000${extras.indexOf(x)}`, ...x });
      expect(Object.keys(exP).sort()).toEqual(['message', 'ok']);
      expect(exP.message.replace('+65 9111 2222', 'P')).toBe(nuP.message.replace(`+65 9300 000${extras.indexOf(x)}`, 'P'));
    }
    const both = await add(w, { email: 'both@x.sg', phone: '91234567' });
    expect(both).toEqual({ ok: true, message: 'both@x.sg (+65 9123 4567) has been added to ORG-A. They can sign in at app.ai-ms.io with their email or mobile.' });
  });

  it('an existing login (by email or by phone) is never changed and is sent nothing', async () => {
    const w = world();
    await add(w, { email: 'existing@x.sg', firstName: 'New', lastName: 'Name', password: 'override123' });
    await add(w, { phone: '+65 9888 7777', firstName: 'X', password: 'override123' });
    expect(w.clerk.users.createUser).not.toHaveBeenCalled();
    expect(w.clerk.users.updateUser).not.toHaveBeenCalled();
    expect(w.clerk.users.updateUserMetadata).not.toHaveBeenCalled();
    expect(w.email.sendSimpleEmail).not.toHaveBeenCalled();
    expect(w.clerk.signInTokens.createSignInToken).not.toHaveBeenCalled();
    expect(memberOfA(w, 'existing')).toBeTruthy();
    expect(memberOfA(w, 'phoneonly')).toBeTruthy();
  });

  it('email matching one login and phone matching ANOTHER: refused with the one generic error, nothing made', async () => {
    const w = world();
    const e = await add(w, { email: 'existing@x.sg', phone: '9888 7777' }).catch((x: any) => x);
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e.message).toBe(ADD_MEMBER_FAILED);
    expect(memberOfA(w, 'existing')).toBeFalsy();
    expect(memberOfA(w, 'phoneonly')).toBeFalsy();
    // email matches, phone is new: the existing login (its phone is not added)
    await add(w, { email: 'existing@x.sg', phone: '9333 4444' });
    expect(w.clerk.users.createUser).not.toHaveBeenCalled();
    expect(memberOfA(w, 'existing')).toBeTruthy();
  });

  it('a new login is made with what was typed; a given password is flagged as admin-set', async () => {
    const w = world();
    await add(w, { email: 'Pw@x.sg', phone: '9123 4567', firstName: ' Hui ', lastName: 'Kong', password: 'secret123' });
    expect(w.clerk.users.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        emailAddress: ['pw@x.sg'],
        phoneNumber: ['+6591234567'],
        firstName: 'Hui',
        lastName: 'Kong',
        password: 'secret123',
        privateMetadata: { [ADMIN_SET_PASSWORD_FLAG]: true },
      }),
    );
    await add(w, { email: 'nopw@x.sg' });
    const p = (w.clerk.users.createUser.mock.calls[1] as any[])[0];
    expect(p.password).toBeUndefined();
    expect(p.privateMetadata).toBeUndefined();
    expect(p.firstName).toBeUndefined();
  });

  it('new + email ALWAYS gets the email: normal wording without a password, the admin-set wording with one', async () => {
    const w = world();
    await add(w, { email: 'a1@x.sg' });
    await add(w, { email: 'a2@x.sg', firstName: 'A', lastName: 'Two', password: 'secret123' });
    const [plain, withPw] = sentTo(w);
    expect(plain.to).toEqual(['a1@x.sg']);
    expect(plain.html).toContain('Choose a password to sign in:');
    expect(plain.html).not.toContain('Your admin has set a password');
    expect(withPw.to).toEqual(['a2@x.sg']);
    expect(withPw.html).toContain('Your admin has set a password for you. You can sign in with it, or choose your own using this link.');
    for (const m of [plain, withPw]) {
      expect(m.subject).toBe('Set your AIMS password');
      expect(m.html).toMatch(/\/set-password\?ticket=tok-/);
      expect(m.html).not.toMatch(/\u2014|\u2013/);
    }
    expect(w.clerk.signInTokens.createSignInToken).toHaveBeenCalledWith({ userId: 'new_a2@x.sg', expiresInSeconds: SET_PASSWORD_LINK_SECONDS });
  });

  it('phone only: a login with the phone, no email address, nothing sent', async () => {
    const w = world();
    const r = await add(w, { phone: '8123 4567', firstName: 'Ah', lastName: 'Tan' });
    expect(r.message).toBe('+65 8123 4567 has been added to ORG-A. They can sign in at app.ai-ms.io with their email or mobile.');
    const p = (w.clerk.users.createUser.mock.calls[0] as any[])[0];
    expect(p.phoneNumber).toEqual(['+6581234567']);
    expect(p.emailAddress).toBeUndefined();
    expect(w.email.sendSimpleEmail).not.toHaveBeenCalled();
    expect(w.clerk.signInTokens.createSignInToken).not.toHaveBeenCalled();
    expect(memberOfA(w, 'new_+6581234567')).toBeTruthy();
  });

  it('form checks: at least one of email / mobile, a valid SG mobile, password of 8+', async () => {
    const w = world();
    await expect(add(w, {})).rejects.toThrow('Enter an email or a mobile number');
    await expect(add(w, { phone: '6123 4567' })).rejects.toThrow('Enter a Singapore mobile number: 8 digits starting with 8 or 9');
    await expect(add(w, { email: 'x@x.sg', password: 'short' })).rejects.toThrow('The password must be at least 8 characters');
    expect(w.clerk.users.getUserList).not.toHaveBeenCalled();
  });

  it('first password: replaced once when the admin set it, then refused; refused for anyone else', async () => {
    const w = world();
    const meta: Record<string, any> = { flagged: { [ADMIN_SET_PASSWORD_FLAG]: true }, plain: {} };
    w.identity.toClerkUser = jest.fn(async (id: string) => ({ id, privateMetadata: meta[id] }));
    w.identity.invalidate = jest.fn();
    w.clerk.users.updateUserMetadata = jest.fn(async (id: string, p: any) => Object.assign(meta[id], p.privateMetadata));
    await expect(w.svc.setFirstPassword('flagged', 'mine12345')).resolves.toEqual({ ok: true });
    expect(w.clerk.users.updateUser).toHaveBeenCalledWith('flagged', expect.objectContaining({ password: 'mine12345' }));
    expect(meta.flagged[ADMIN_SET_PASSWORD_FLAG]).toBeNull();
    await expect(w.svc.setFirstPassword('flagged', 'again12345')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(w.svc.setFirstPassword('plain', 'mine12345')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(w.svc.setFirstPassword('flagged', 'short')).rejects.toBeInstanceOf(BadRequestException);
    expect(w.clerk.users.updateUser).toHaveBeenCalledTimes(1);
  });

  it("the drawer's salesman code / mobile go on this org's membership (new or existing login), never on the login", async () => {
    const w = world();
    await add(w, { email: 'existing@x.sg', salesmanCode: ' S007 ', salesmanMobile: '9014 5879' });
    await add(w, { email: 'fresh@x.sg', salesmanCode: 'S008' });
    expect(memberOfA(w, 'existing')).toEqual(expect.objectContaining({ salesmanCode: 'S007', salesmanMobile: '9014 5879' }));
    expect(memberOfA(w, 'new_fresh@x.sg')).toEqual(expect.objectContaining({ salesmanCode: 'S008', salesmanMobile: null }));
    expect(w.clerk.users.createUser).toHaveBeenCalledWith(expect.not.objectContaining({ salesmanCode: expect.anything() }));
  });

  it('a first name with no last name is fine; the welcome email row records the Resend message id', async () => {
    const w = world();
    await add(w, { email: 'solo@x.sg', firstName: 'Solo', lastName: '   ' });
    const p = (w.clerk.users.createUser.mock.calls[0] as any[])[0];
    expect(p.firstName).toBe('Solo');
    expect(p.lastName).toBeUndefined();
    expect(w.actionLog.system).toHaveBeenCalledWith('add-user-welcome-email', 'EMAIL_SENT', 'user', expect.objectContaining({ details: { messageId: 'm1' } }));
  });
});
