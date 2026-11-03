/**
 * The full "Add user" form (2026-11-03), DEV database + DEV Clerk (sk_test), real HTTP.
 *
 * Boots the real AppModule with a test sign-in (`x-e2e-user` header); the guard,
 * memberships service and Clerk calls are real. Outgoing email is captured (not
 * sent) so the wording and link can be checked.
 *   A new login, email + mobile + names + password: made with all of it, flagged admin-set,
 *     the email goes out with the admin-set wording
 *   B the same person again by email and by mobile, with other names / password: identical
 *     reply shape, nothing about the login changes, nothing sent
 *   C new, email only, no password: the normal wording
 *   D new, mobile only: no email address, nothing sent, the list shows the number
 *   E email of one login + mobile of another: the one generic error
 *   F /users/me/first-password: replaces the admin-set password once, then refused
 * Every Clerk user and row it made is removed at the end.
 *
 *   AIMS_SECRETS_KEY=... TENANCY_MODE=per-org npx ts-node -r tsconfig-paths/register --transpile-only scripts/_add-user-full-e2e.ts
 */
import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { Injectable, ValidationPipe } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import { createClerkClient } from '@clerk/backend';
import { AppModule } from '../src/app.module';
import { ClerkStrategy } from '../src/auth/clerk.strategy';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
import { CustomExceptionFilter } from '../helpers/custom-exception.filter';
import { CustomResponseInterceptor } from '../helpers/custom-sucess.filter';
import { EmailService } from '../src/email/email.service';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const WCT_ADMIN = '0cb82844-c14f-415e-b831-05470042b508';
const ADMIN = 'user_e2e_addfull_admin';
const RUN = Date.now().toString(36);
const RND = String(Date.now()).slice(-6);
const TAIL = 'They can sign in at app.ai-ms.io with their email or mobile.';

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
    return { id, clerkId: id, firstName: 'E2E', lastName: 'Admin', emailAddresses: [] };
  }
}

async function main() {
  if (process.env.RENDER) throw new Error('Refusing: Render');
  if (process.env.PROD_DATABASE_URL && new URL(process.env.DATABASE_URL!).host === new URL(process.env.PROD_DATABASE_URL).host) throw new Error('Refusing: prod DB');
  if (!String(process.env.CLERK_SECRET_KEY).startsWith('sk_test_')) throw new Error('Refusing: not the dev Clerk instance');
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
  const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ClerkStrategy).useClass(FakeStrategy).compile();
  const app = mod.createNestApplication({ logger: ['error'] });
  app.useGlobalPipes(new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } }));
  app.useGlobalFilters(new CustomExceptionFilter());
  app.useGlobalInterceptors(new CustomResponseInterceptor());
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as any).port}`;
  const prisma = app.get(PrismaService);
  const sent: any[] = [];
  (app.get(EmailService) as any).sendSimpleEmail = async (p: any) => {
    sent.push(p);
    return { success: true, messageId: `captured-${sent.length}` };
  };
  const call = async (method: string, path: string, body?: any, as = ADMIN) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'x-e2e-user': as, 'x-active-org-id': WCT, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let j: any = null;
    try {
      j = JSON.parse(text);
    } catch {}
    return { status: r.status, body: j, text, data: j?.data };
  };
  const add = (b: any) => call('POST', '/users/members/add-member', { roleIds: [WCT_ADMIN], ...b });
  const madeClerk = new Set<string>();
  const find = async (q: any) => {
    const r: any = await clerk.users.getUserList(q);
    const u = (r.data ?? r)[0];
    if (u) madeClerk.add(u.id);
    return u;
  };
  await prisma.userOrganization.upsert({ where: { userId_organizationId: { userId: ADMIN, organizationId: WCT } }, update: { isActive: true }, create: { userId: ADMIN, organizationId: WCT, isActive: true } });
  await runAsOrg(WCT, () => prisma.userRole.upsert({ where: { userId_roleId_organizationId: { userId: ADMIN, roleId: WCT_ADMIN, organizationId: WCT } }, update: { isActive: true }, create: { userId: ADMIN, roleId: WCT_ADMIN, organizationId: WCT } }));

  const eA = `e2e-full-a-${RUN}+clerk_test@example.com`;
  const mA = `9${RND}1`; // 8 digits, starts with 9
  const mD = `8${RND}2`;
  const pretty = (m: string) => `+65 ${m.slice(0, 4)} ${m.slice(4)}`;
  try {
    // ── A ──
    const a = await add({ email: eA, phone: mA.replace(/(\d{4})/, '$1 '), firstName: 'Hui', lastName: 'Kong', password: 'adminSet123' });
    ok(a.status < 300 && a.data?.message === `${eA} (${pretty(mA)}) has been added to WCT. ${TAIL}`, 'A: reply shows both (email (+65 xxxx xxxx))', a.data?.message ?? a.text.slice(0, 200));
    const uA = await find({ emailAddress: [eA] });
    ok(uA && uA.firstName === 'Hui' && uA.lastName === 'Kong' && uA.phoneNumbers[0]?.phoneNumber === `+65${mA}` && uA.passwordEnabled, 'A: login made with email, mobile, names and the password', uA && { f: uA.firstName, p: uA.phoneNumbers.map((x: any) => x.phoneNumber), pw: uA.passwordEnabled });
    ok((uA?.privateMetadata as any)?.aimsPasswordSetByAdmin === true, 'A: flagged as an admin-set password');
    ok((await clerk.users.verifyPassword({ userId: uA.id, password: 'adminSet123' }).catch(() => null))?.verified === true, 'A: the admin-set password works');
    ok(sent.length === 1 && sent[0].to[0] === eA && sent[0].html.includes('Your admin has set a password for you. You can sign in with it, or choose your own using this link.') && /\/set-password\?ticket=/.test(sent[0].html), 'A: the email went out, admin-set wording, with the link');
    ok(uA && (await prisma.userOrganization.count({ where: { userId: uA.id, organizationId: WCT, isActive: true } })) === 1, 'A: a WCT member at once');

    // ── B the same person again ──
    const before = await clerk.users.getUser(uA.id);
    const b1 = await add({ email: eA, firstName: 'Other', lastName: 'Name', password: 'override999' });
    const b2 = await add({ phone: mA, firstName: 'Phone', lastName: 'Match', password: 'override999' });
    const after = await clerk.users.getUser(uA.id);
    ok(b1.data?.message === `${eA} has been added to WCT. ${TAIL}` && b2.data?.message === `${pretty(mA)} has been added to WCT. ${TAIL}`, 'B: existing by email / by mobile: the same text');
    ok(JSON.stringify(Object.keys(b1.body).sort()) === JSON.stringify(Object.keys(a.body).sort()) && JSON.stringify(Object.keys(b1.data).sort()) === JSON.stringify(Object.keys(a.data).sort()), 'B: the same response shape as a new login');
    ok(after.firstName === 'Hui' && after.lastName === 'Kong' && after.updatedAt === before.updatedAt && after.emailAddresses.length === 1 && after.phoneNumbers.length === 1, 'B: the existing login is untouched (name, email, phone, updatedAt)', { f: after.firstName, upd: [before.updatedAt, after.updatedAt] });
    ok((await clerk.users.verifyPassword({ userId: uA.id, password: 'adminSet123' }).catch(() => null))?.verified === true, 'B: its password is unchanged');
    ok(sent.length === 1, 'B: nothing sent');

    // ── C new, email only, no password ──
    const eC = `e2e-full-c-${RUN}+clerk_test@example.com`;
    const c = await add({ email: eC, firstName: 'Cee', lastName: 'Only' });
    const uC = await find({ emailAddress: [eC] });
    ok(c.data?.message === `${eC} has been added to WCT. ${TAIL}` && uC && !uC.passwordEnabled, 'C: made without a password');
    ok(sent.length === 2 && sent[1].to[0] === eC && sent[1].html.includes('Choose a password to sign in:') && !sent[1].html.includes('Your admin has set'), 'C: the email went out with the normal wording');

    // ── D new, mobile only ──
    const d = await add({ phone: `+65 ${mD}`, firstName: 'Dee', lastName: 'Phone' });
    const uD = await find({ phoneNumber: [`+65${mD}`] });
    ok(d.data?.message === `${pretty(mD)} has been added to WCT. ${TAIL}`, 'D: reply shows the mobile', d.data?.message ?? d.text.slice(0, 200));
    ok(uD && uD.emailAddresses.length === 0 && uD.phoneNumbers[0]?.phoneNumber === `+65${mD}`, 'D: a login with the mobile and no email');
    ok(sent.length === 2, 'D: nothing sent');
    const list = await call('POST', '/users/list', { page: 1, limit: 200 });
    const rowD = (list.data?.users ?? []).find((u: any) => u.id === uD?.id);
    ok(rowD && rowD.email === null && rowD.phone === pretty(mD) && rowD.name === 'Dee Phone', 'D: the list shows email null, the number and the name', rowD);

    // ── E email of one login + mobile of another ──
    const e = await add({ email: eC, phone: mD });
    ok(e.status === 400 && e.body?.message === 'This person could not be added. Check the email address and try again.', 'E: the one generic error', `${e.status} ${e.body?.message}`);
    // form checks
    const f1 = await add({});
    const f2 = await add({ phone: '6123 4567' });
    ok(f1.status === 400 && f2.status === 400 && /email or a mobile/.test(f1.body?.message) && /Singapore mobile/.test(f2.body?.message), 'form checks: one of email / mobile, a valid SG mobile');

    // ── F first password ──
    const p1 = await call('POST', '/users/me/first-password', { newPassword: 'mine12345' }, uA.id);
    ok(p1.status < 300, 'F: the admin-set password is replaced (no current password asked)', `${p1.status} ${p1.text.slice(0, 160)}`);
    ok((await clerk.users.verifyPassword({ userId: uA.id, password: 'mine12345' }).catch(() => null))?.verified === true, 'F: the new password works');
    const p2 = await call('POST', '/users/me/first-password', { newPassword: 'again12345' }, uA.id);
    ok(p2.status === 403, 'F: a second time is refused (403)', p2.status);
    const p3 = await call('POST', '/users/me/first-password', { newPassword: 'mine12345' }, uC.id);
    ok(p3.status === 403, 'F: a login without an admin-set password is refused (403)', p3.status);
  } finally {
    for (const id of madeClerk) {
      await prisma.userOrganization.deleteMany({ where: { userId: id } }).catch(() => {});
      await runAsOrg(WCT, () => prisma.userRole.deleteMany({ where: { userId: id, organizationId: WCT } })).catch(() => {});
      await clerk.users.deleteUser(id).catch((err: any) => console.log('cleanup: clerk delete failed', id, err?.message));
    }
    await runAsOrg(WCT, () => prisma.userRole.deleteMany({ where: { userId: ADMIN, organizationId: WCT } })).catch(() => {});
    await prisma.userOrganization.deleteMany({ where: { userId: ADMIN } });
    console.log(`cleanup: ${madeClerk.size} dev Clerk users and their rows removed`);
    await app.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
