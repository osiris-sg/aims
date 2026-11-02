/**
 * Multi-organisation users end-to-end (2026-11-02), DEV database, real HTTP.
 *
 * Boots the real AppModule on a random local port with three test doubles:
 *   - the Clerk sign-in: an `x-e2e-user` (+ `x-e2e-email`) header names the
 *     user instead of a Clerk token (FakeStrategy, this script only);
 *   - the Clerk API client (no real logins are looked up or created);
 *   - the email sender (asserts nothing is sent).
 * Everything else (guard, tenancy, controllers, services, dev DB) is real.
 *
 *   A org choice: no header = default (oldest, then most recently used);
 *     header of my org = that org; header of an org I'm not in = 403 on
 *     every endpoint tried; X-Use-Real-Org = default
 *   B cross-org reads: a user in A (or only in B) sending another org's id
 *     without membership reads nothing of it (403), and lists return only the
 *     active org's rows
 *   C roles per org: Admin in A, Manager in B (users:read only in A)
 *   D my orgs + switch remembered; switching to a non-member org = 403
 *   E "Add user" by email: an existing login (in another org) and a new email
 *     give IDENTICAL replies and identical users-list entries, both members at
 *     once; one error wording; nothing sent; org admins see only their org's
 *     members
 *   F remove from org A only; B untouched
 * Every row it made is removed at the end.
 *
 *   TENANCY_MODE=per-org npx ts-node -r tsconfig-paths/register --transpile-only scripts/_multiorg-e2e.ts
 */
import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { Injectable, ValidationPipe } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import { AppModule } from '../src/app.module';
import { ClerkStrategy } from '../src/auth/clerk.strategy';
import { EmailService } from '../src/email/email.service';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
import { CustomExceptionFilter } from '../helpers/custom-exception.filter';
import { CustomResponseInterceptor } from '../helpers/custom-sucess.filter';
import { NOT_A_MEMBER_MESSAGE } from '../src/auth/active-org';

const A = '5c700000-0000-4000-8000-5c7000000001'; // WCT
const B = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1'; // Biofuel
const C = '5a12a9f9-f139-44e8-ab68-dd63f1c23ae3'; // CIEL (no test user is a member)
const ROLE_A_ADMIN = '0cb82844-c14f-415e-b831-05470042b508';
const ROLE_B_MANAGER = '0f47ac39-6446-4d23-993c-69ba06aabd5e';
const ROLE_B_ADMIN = '8da505ed-f335-4beb-b0af-21ba356f18f4';
const MULTI = 'user_e2e_multiorg_1';
const SINGLE = 'user_e2e_multiorg_2';
const SINGLE_EMAIL = 'e2e.multiorg.single@example.test';
const NEW_EMAIL = 'e2e.multiorg.new@example.test';
const USERS = [MULTI, SINGLE];

let pass = 0;
let fail = 0;
const ok = (cond: any, label: string, extra?: any) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && extra !== undefined ? `  -> ${JSON.stringify(extra).slice(0, 300)}` : ''}`);
};

@Injectable()
class FakeStrategy extends PassportStrategy(Strategy, 'clerk') {
  async validate(req: any) {
    const id = String(req.headers['x-e2e-user'] || '');
    if (!id) throw new Error('no e2e user');
    const email = String(req.headers['x-e2e-email'] || '');
    return { id, clerkId: id, firstName: 'E2E', lastName: id.slice(-1), emailAddresses: email ? [{ emailAddress: email }] : [] };
  }
}

const sentEmails: any[] = [];
const clerkCalls: string[] = [];
// Fake Clerk logins: no names, so the users list shows each by its email.
const logins: Record<string, any> = {};
const login = (id: string, email: string) => (logins[id] = { id, externalId: id, firstName: null, lastName: null, username: null, emailAddresses: [{ emailAddress: email }] });
const fakeClerk: any = {
  users: {
    getUserList: async (q: any) => {
      if (q?.emailAddress) {
        clerkCalls.push(`getUserList ${q.emailAddress[0]}`);
        return { data: Object.values(logins).filter((u: any) => u.emailAddresses[0].emailAddress === q.emailAddress[0]) };
      }
      const ids: string[] = q?.externalId ?? q?.userId ?? [];
      return { data: ids.map((id) => logins[id]).filter(Boolean) };
    },
    getUser: async (id: string) => logins[id] ?? { id, firstName: null, lastName: null, emailAddresses: [] },
    createUser: async ({ emailAddress }: any) => (clerkCalls.push(`createUser ${emailAddress[0]}`), login(`user_e2e_created_${Date.now()}`, emailAddress[0])),
    updateUser: async (id: string) => logins[id],
  },
};

async function main() {
  if (process.env.RENDER) throw new Error('Refusing: Render');
  if (process.env.PROD_DATABASE_URL && new URL(process.env.DATABASE_URL!).host === new URL(process.env.PROD_DATABASE_URL).host) throw new Error('Refusing: prod DB');
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ClerkStrategy)
    .useClass(FakeStrategy)
    .overrideProvider('ClerkClient')
    .useValue(fakeClerk)
    .overrideProvider(EmailService)
    .useValue({ sendSimpleEmail: async (p: any) => (sentEmails.push(p), { success: true }) })
    .compile();
  const app = mod.createNestApplication({ logger: ['error'] });
  app.useGlobalPipes(new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } }));
  app.useGlobalFilters(new CustomExceptionFilter());
  app.useGlobalInterceptors(new CustomResponseInterceptor());
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as any).port}`;
  const prisma = app.get(PrismaService);

  const call = async (user: string, method: string, path: string, opts: { org?: string; real?: boolean; body?: any; email?: string } = {}) => {
    const headers: Record<string, string> = { 'x-e2e-user': user, 'content-type': 'application/json' };
    if (opts.org) headers['x-active-org-id'] = opts.org;
    if (opts.real) headers['x-use-real-org'] = '1';
    if (opts.email) headers['x-e2e-email'] = opts.email;
    const r = await fetch(`${base}${path}`, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const j: any = await r.json().catch(() => null);
    return { status: r.status, body: j, data: j?.data?.success && 'data' in (j.data ?? {}) ? j.data.data : j?.data };
  };
  const orgOf = async (user: string, opts: any = {}) => (await call(user, 'GET', '/organizations/user', opts)).data?.id;

  // ── fixtures ──
  const cleanup = async () => {
    const created = Object.keys(logins).filter((id) => id.startsWith('user_e2e_created_'));
    USERS.push(...created.filter((id) => !USERS.includes(id)));
    await prisma.userRole.deleteMany({ where: { userId: { in: [...USERS, 'user_e2e_platform'] } } }).catch(() => {});
    for (const org of [A, B, C]) await runAsOrg(org, () => prisma.userRole.deleteMany({ where: { userId: { in: [...USERS, 'user_e2e_platform'] }, organizationId: org } })).catch(() => {});
    await prisma.userOrganization.deleteMany({ where: { userId: { in: [...USERS, 'user_e2e_platform'] } } });
    for (const org of [A, B, C]) await runAsOrg(org, () => prisma.notification.deleteMany({ where: { userId: { in: USERS }, organizationId: org } })).catch(() => {});
  };
  login(MULTI, 'e2e.multiorg.admin@example.test');
  login(SINGLE, SINGLE_EMAIL);
  login('user_e2e_platform', 'e2e.platform@example.test');
  await cleanup();
  const t0 = Date.now();
  await prisma.userOrganization.create({ data: { userId: MULTI, organizationId: A, isActive: true, joinedAt: new Date(t0 - 2 * 86400e3) } });
  await prisma.userOrganization.create({ data: { userId: MULTI, organizationId: B, isActive: true, joinedAt: new Date(t0 - 86400e3) } });
  await prisma.userOrganization.create({ data: { userId: SINGLE, organizationId: B, isActive: true } });
  await runAsOrg(A, () => prisma.userRole.create({ data: { userId: MULTI, roleId: ROLE_A_ADMIN, organizationId: A } }));
  await runAsOrg(B, () => prisma.userRole.create({ data: { userId: MULTI, roleId: ROLE_B_MANAGER, organizationId: B } }));
  await runAsOrg(B, () => prisma.userRole.create({ data: { userId: SINGLE, roleId: ROLE_B_ADMIN, organizationId: B } }));
  const custIds = async (org: string) =>
    new Set(((await runAsOrg(org, () => prisma.customer.findMany({ where: { organizationId: org }, select: { id: true }, take: 100000 }))) as any[]).map((c) => c.id));
  const idsA = await custIds(A);
  const idsB = await custIds(B);
  console.log(`fixtures: ${MULTI} in WCT (Admin) + Biofuel (Manager); ${SINGLE} in Biofuel (Admin); customers WCT ${idsA.size}, Biofuel ${idsB.size}`);

  try {
    // ── A org choice ──
    ok((await orgOf(MULTI)) === A, 'no header: the oldest membership (WCT)');
    ok((await orgOf(MULTI, { org: B })) === B, 'header of my other org: Biofuel');
    for (const [m, p, body] of [
      ['GET', '/organizations/user', null],
      ['POST', '/customers', { page: 1, limit: 5 }],
      ['GET', '/users/me/roles', null],
      ['GET', '/configuration/complete', null],
      ['POST', '/users/list', { page: 1, limit: 5 }],
    ] as const) {
      const r = await call(MULTI, m, p, { org: C, body });
      ok(r.status === 403 && String(r.body?.message).includes(NOT_A_MEMBER_MESSAGE), `header of an org I'm not in -> 403 on ${m} ${p}`, { status: r.status, msg: r.body?.message });
    }
    ok((await orgOf(MULTI, { org: C, real: true })) === A, 'X-Use-Real-Org skips the header: default org');

    // ── B cross-org reads ──
    const listA = await call(MULTI, 'POST', '/customers', { body: { page: 1, limit: 50 } });
    const docsA: any[] = listA.data?.docs ?? listA.data?.data ?? [];
    ok(listA.status === 201 || listA.status === 200, 'customer list in my default org answers', listA.status);
    ok(docsA.every((c) => idsA.has(c.id)) && !docsA.some((c) => idsB.has(c.id)), `customer list (WCT): only WCT rows (${docsA.length} checked)`);
    const listB = await call(MULTI, 'POST', '/customers', { org: B, body: { page: 1, limit: 50 } });
    const docsB: any[] = listB.data?.docs ?? listB.data?.data ?? [];
    ok(docsB.every((c) => idsB.has(c.id)) && !docsB.some((c) => idsA.has(c.id)), `customer list (Biofuel): only Biofuel rows (${docsB.length} checked)`);
    const single = await call(SINGLE, 'POST', '/customers', { org: A, body: { page: 1, limit: 50 } });
    ok(single.status === 403 && !(single.data?.docs ?? []).length, "a user only in Biofuel sending WCT's id: 403, no WCT rows", single.status);
    const aCust = [...idsA][0];
    if (aCust) {
      const one = await call(SINGLE, 'GET', `/customers/${aCust}`, { org: A });
      ok(one.status === 403, "a user only in Biofuel reading a WCT customer by id with WCT's header: 403", one.status);
      const noHdr = await call(SINGLE, 'GET', `/customers/${aCust}`);
      ok(!noHdr.data?.id || noHdr.data.id !== aCust || noHdr.status >= 400, "the same id without the header (their own org): not WCT's customer", { status: noHdr.status, id: noHdr.data?.id });
    }

    // ── C roles per org ──
    ok((await call(MULTI, 'POST', '/users/list', { body: { page: 1, limit: 5 } })).status < 300, 'Admin in WCT: users list allowed');
    ok((await call(MULTI, 'POST', '/users/list', { org: B, body: { page: 1, limit: 5 } })).status === 403, 'Manager in Biofuel: users list refused there');
    const rolesB = (await call(MULTI, 'GET', '/users/me/roles', { org: B })).data;
    ok(JSON.stringify(rolesB).includes('Manager') && !JSON.stringify(rolesB).includes('"Admin"'), 'my roles in Biofuel: Manager only', rolesB);

    // ── D my orgs + switch ──
    const mine = (await call(MULTI, 'GET', '/users/me/organizations', { real: true })).data;
    ok(
      mine?.organizations
        ?.map((o: any) => o.id)
        .sort()
        .join() === [A, B].sort().join() && mine.isOsirisAdmin === false,
      'my organisations: WCT + Biofuel only',
      mine,
    );
    ok((await call(SINGLE, 'GET', '/users/me/organizations', { real: true })).data?.organizations?.map((o: any) => o.id).join() === B, 'a one-org user sees only their org');
    ok((await call(MULTI, 'POST', '/users/me/active-org', { real: true, body: { organizationId: B } })).status < 300, 'switch to Biofuel: remembered');
    ok((await orgOf(MULTI)) === B, 'no header now: the most recently used org (Biofuel)');
    ok((await call(MULTI, 'POST', '/users/me/active-org', { real: true, body: { organizationId: C } })).status === 403, "switch to an org I'm not in: 403");
    await call(MULTI, 'POST', '/users/me/active-org', { real: true, body: { organizationId: A } });
    ok((await orgOf(MULTI)) === A, 'switched back: WCT is the default again');

    // ── E "Add user" by email (as MULTI, Admin of WCT) ──
    const add = (email: string) => call(MULTI, 'POST', '/users/members/add-by-email', { org: A, body: { email, roleIds: [ROLE_A_ADMIN] } });
    const rLogin = await add(SINGLE_EMAIL); // a login that is in Biofuel
    const rNew = await add(NEW_EMAIL); // no login yet
    const norm = (r: any, e: string) => JSON.stringify(r.data).replace(e, '<email>');
    ok(rLogin.status === rNew.status && rLogin.status < 300, 'both answer with the same success status', [rLogin.status, rNew.status]);
    ok(norm(rLogin, SINGLE_EMAIL) === norm(rNew, NEW_EMAIL), 'IDENTICAL reply for a login in another org and a brand-new email', [rLogin.data, rNew.data]);
    ok(
      Object.keys(rLogin.data ?? {})
        .sort()
        .join() === 'message,ok',
      'the reply carries only ok + message',
      rLogin.data,
    );
    ok(clerkCalls.filter((c) => c.startsWith('createUser')).length === 1 && clerkCalls.includes(`createUser ${NEW_EMAIL}`), 'a login was made for the new email only');
    const newId = Object.keys(logins).find((id) => logins[id].emailAddresses[0].emailAddress === NEW_EMAIL)!;
    ok((await orgOf(SINGLE, { org: A })) === A && (await orgOf(SINGLE, { org: B })) === B, 'the existing login now works in WCT, and still in Biofuel');
    ok((await orgOf(newId, { org: A })) === A, 'the new login works in WCT at once (no accept step)');
    const listed = ((await call(MULTI, 'POST', '/users/list', { org: A, body: { page: 1, limit: 200 } })).data?.users ?? []) as any[];
    const eLogin = listed.find((u) => u.id === SINGLE);
    const eNew = listed.find((u) => u.id === newId);
    const shape = (u: any, email: string) =>
      u && JSON.stringify({ ...u, id: '<id>', email: '<email>', name: u.name === email ? '<email>' : u.name, createdAt: '<t>', updatedAt: '<t>', roles: u.roles.map((r: any) => r.name) });
    ok(!!eLogin && !!eNew && shape(eLogin, SINGLE_EMAIL) === shape(eNew, NEW_EMAIL), 'IDENTICAL users-list entries for the two (a normal member, role Admin, shown by email)', [
      shape(eLogin, SINGLE_EMAIL),
      shape(eNew, NEW_EMAIL),
    ]);
    ok(sentEmails.length === 0, 'no email sent to anyone');
    const notes = await runAsOrg(A, () => prisma.notification.count({ where: { userId: { in: [SINGLE, newId] }, organizationId: A } }));
    ok(notes === 0, 'no in-app notice either');
    const mineNow = (await call(SINGLE, 'GET', '/users/me/organizations', { real: true })).data?.organizations?.map((o: any) => o.id).sort();
    ok(mineNow?.join() === [A, B].sort().join(), 'the org simply appears in their picker (WCT + Biofuel)', mineNow);
    // one error wording
    await prisma.userRole
      .create({
        data: {
          userId: 'user_e2e_platform',
          roleId: (await prisma.role.findFirst({ where: { organizationId: 'osiris-platform', name: 'osirisadmin' }, select: { id: true } }))!.id,
          organizationId: 'osiris-platform',
        },
      })
      .catch(() => null);
    const rPlat = await add('e2e.platform@example.test');
    ok(rPlat.status === 400 && /could not be added/.test(rPlat.body?.message), "a platform admin's login is refused with the one error wording", rPlat.body?.message);
    ok(!(await prisma.userOrganization.findFirst({ where: { userId: 'user_e2e_platform', organizationId: A } })), '...and not added');
    // org admins see only their own org's members
    const bList = ((await call(SINGLE, 'POST', '/users/list', { org: B, body: { page: 1, limit: 500 } })).data?.users ?? []) as any[]; // Biofuel Admin
    ok(!bList.some((u) => u.id === newId), "Biofuel's admin does not see WCT's new member");
    ok(!listed.some((u) => u.id === 'user_e2e_platform'), "WCT's list has no one it did not add");
    const bIds = new Set(((await runAsOrg(B, () => prisma.userRole.findMany({ where: { organizationId: B, isActive: true }, select: { userId: true } }))) as any[]).map((r) => r.userId));
    ok(
      bList.every((u) => bIds.has(u.id)),
      `Biofuel's list holds only Biofuel members (${bList.length} checked)`,
    );

    // ── F remove from WCT only ──
    const rm = await call(MULTI, 'DELETE', `/users/${SINGLE}`, { org: A });
    ok(rm.status < 300, 'WCT admin removes the person from WCT', rm.status);
    ok((await call(SINGLE, 'GET', '/organizations/user', { org: A })).status === 403, "removed: WCT's header is now a 403");
    ok((await orgOf(SINGLE, { org: B })) === B, 'still a member of Biofuel');
  } finally {
    await cleanup();
    const left = await prisma.userOrganization.count({ where: { userId: { in: USERS } } });
    console.log(`cleanup: test memberships left ${left}`);
    await app.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
