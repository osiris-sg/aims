/**
 * User management fixes (2026-11-03), DEV database + DEV Clerk (sk_test), real HTTP.
 *
 * Boots the real AppModule with a test sign-in (`x-e2e-user` header); the
 * guard, users service, memberships service, Clerk calls and Resend are real.
 *   A Edit User on a login with NO email: the email is added (verified, primary), the list shows it
 *   B changing it again replaces it; the same email sent back is not a change
 *   C an email another login has: 409 "That email is already used by another login", nothing changes
 *   D a phone-less/email-less login in the list: email null, never its id
 *   E Add user, new email: Clerk login + membership + a sign-in token; the welcome email is accepted by
 *     Resend (sent to Resend's test inbox delivered+...@resend.dev, never a real person); the reply is
 *     the same text as for an existing login, which is sent nothing
 * Every Clerk user and row it made is removed at the end.
 *
 *   AIMS_SECRETS_KEY=... TENANCY_MODE=per-org npx ts-node -r tsconfig-paths/register --transpile-only scripts/_user-mgmt-e2e.ts
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
const ADMIN = 'user_e2e_usermgmt_admin';
const RUN = Date.now().toString(36);

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
  const email = app.get(EmailService);
  const realSend = email.sendSimpleEmail.bind(email);
  (email as any).sendSimpleEmail = async (p: any) => {
    const r = await realSend(p);
    sent.push({ ...p, result: r });
    return r;
  };
  const call = async (method: string, path: string, body?: any) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'x-e2e-user': ADMIN, 'x-active-org-id': WCT, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let j: any = null;
    try {
      j = JSON.parse(text);
    } catch {}
    return { status: r.status, body: j, text, data: j?.data };
  };
  const madeClerk: string[] = [];
  const member = async (userId: string) => {
    await prisma.userOrganization.upsert({ where: { userId_organizationId: { userId, organizationId: WCT } }, update: { isActive: true }, create: { userId, organizationId: WCT, isActive: true } });
    await runAsOrg(WCT, () => prisma.userRole.upsert({ where: { userId_roleId_organizationId: { userId, roleId: WCT_ADMIN, organizationId: WCT } }, update: { isActive: true }, create: { userId, roleId: WCT_ADMIN, organizationId: WCT } }));
  };
  await member(ADMIN);

  // A login with NO email (the dev instance needs an identifier: a username stands in for SiteClock's phone)
  const nomail = await clerk.users.createUser({ username: `e2e_nomail_${RUN}`, firstName: 'Shukkee', lastName: 'E2E', skipPasswordRequirement: true } as any);
  madeClerk.push(nomail.id);
  await member(nomail.id);
  const other = await clerk.users.createUser({ emailAddress: [`e2e-other-${RUN}+clerk_test@example.com`], firstName: 'Other', lastName: 'E2E', skipPasswordRequirement: true } as any);
  madeClerk.push(other.id);

  try {
    // ── D the list never shows the id as an email ──
    const list0 = await call('POST', '/users/list', { page: 1, limit: 100 });
    const row0 = (list0.data?.users ?? []).find((u: any) => u.id === nomail.id);
    ok(row0 && row0.email === null && row0.name === 'Shukkee E2E', 'list: a login with no email shows email null and its name (not its id)', row0);

    // ── A add an email to a login that has none ──
    const e1 = `e2e-shukkee-${RUN}+clerk_test@example.com`;
    const a = await call('PATCH', `/users/${nomail.id}`, { firstName: 'Shukkee', lastName: 'E2E', email: e1, roleIds: [WCT_ADMIN] });
    ok(a.status === 200 && a.data?.email === e1, 'edit: the email is saved (200, returned)', `${a.status} ${a.text.slice(0, 200)}`);
    const c1 = await clerk.users.getUser(nomail.id);
    const p1 = c1.emailAddresses.find((x) => x.id === c1.primaryEmailAddressId);
    ok(p1?.emailAddress === e1 && p1?.verification?.status === 'verified', 'Clerk: it is the primary email and verified', { primary: p1?.emailAddress, status: p1?.verification?.status });
    const list1 = await call('POST', '/users/list', { page: 1, limit: 100 });
    ok((list1.data?.users ?? []).find((u: any) => u.id === nomail.id)?.email === e1, 'list: shows the new email (no revert)');

    // ── B change it; the same one back is no change ──
    const e2 = `e2e-shukkee2-${RUN}+clerk_test@example.com`;
    const b = await call('PATCH', `/users/${nomail.id}`, { email: e2, roleIds: [WCT_ADMIN] });
    const c2 = await clerk.users.getUser(nomail.id);
    ok(b.status === 200 && c2.emailAddresses.map((x) => x.emailAddress).join(',') === e2, 'edit: changing the email replaces the old one', c2.emailAddresses.map((x) => x.emailAddress));
    const same = await call('PATCH', `/users/${nomail.id}`, { email: e2.toUpperCase(), roleIds: [WCT_ADMIN] });
    const c3 = await clerk.users.getUser(nomail.id);
    ok(same.status === 200 && c3.emailAddresses.length === 1 && c3.emailAddresses[0].id === c2.emailAddresses[0].id, 'edit: the same email sent back is not a change');

    // ── C another login's email ──
    const c = await call('PATCH', `/users/${nomail.id}`, { email: other.emailAddresses[0].emailAddress, roleIds: [WCT_ADMIN] });
    ok(c.status === 409 && c.body?.message === 'That email is already used by another login', 'edit: another login\'s email gives 409 with the clear message', `${c.status} ${c.body?.message}`);
    const c4 = await clerk.users.getUser(nomail.id);
    ok(c4.emailAddresses.map((x) => x.emailAddress).join(',') === e2, 'edit: after the 409 the email is unchanged');

    // ── E Add user ──
    const newEmail = `delivered+aims-e2e-${RUN}@resend.dev`;
    const add = await call('POST', '/users/members/add-by-email', { email: newEmail, roleIds: [WCT_ADMIN] });
    const expected = (e: string) => `${e} has been added to WCT. They'll get an email to set their password, or can sign in with Google/phone if set up.`;
    ok(add.status < 300 && add.data?.message === expected(newEmail), 'add (new email): the success text', add.data?.message ?? add.text.slice(0, 200));
    const created: any = await clerk.users.getUserList({ emailAddress: [newEmail] });
    const nu = (created.data ?? created)[0];
    if (nu) madeClerk.push(nu.id);
    ok(!!nu, 'add (new email): a Clerk login was made');
    ok(nu && (await prisma.userOrganization.count({ where: { userId: nu.id, organizationId: WCT, isActive: true } })) === 1, 'add (new email): a member of WCT at once');
    ok(sent.length === 1 && sent[0].to[0] === newEmail && sent[0].subject === 'Set your AIMS password', 'add (new email): one "Set your AIMS password" email to that address', sent.map((s) => s.to));
    ok(sent[0]?.result?.success === true && !!sent[0]?.result?.messageId, 'Resend accepted the email', sent[0]?.result);
    const link = String(sent[0]?.html ?? '').match(/href="([^"]*\/set-password\?ticket=[^"]+)"/)?.[1];
    ok(!!link, 'the email has the set-password link', link && link.replace(/ticket=.*/, 'ticket=…'));
    const addAgain = await call('POST', '/users/members/add-by-email', { email: e2, roleIds: [WCT_ADMIN] });
    ok(addAgain.data?.message === expected(e2), 'add (existing login): the same success text');
    ok(sent.length === 1, 'add (existing login): nothing is sent');
    if (sent[0]?.result?.messageId && process.env.RESEND_API_KEY) {
      await new Promise((r) => setTimeout(r, 4000));
      const st: any = await fetch(`https://api.resend.com/emails/${sent[0].result.messageId}`, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } }).then((r) => r.json());
      console.log(`      Resend: from "${st.from}", last event "${st.last_event}"`);
      ok(['delivered', 'sent', 'queued'].includes(st.last_event), 'Resend reports the test email delivered/sent', st.last_event);
    }
  } finally {
    for (const id of madeClerk) {
      await prisma.userOrganization.deleteMany({ where: { userId: id } }).catch(() => {});
      await runAsOrg(WCT, () => prisma.userRole.deleteMany({ where: { userId: id, organizationId: WCT } })).catch(() => {});
      await clerk.users.deleteUser(id).catch((e: any) => console.log('cleanup: clerk delete failed', id, e?.message));
    }
    await runAsOrg(WCT, () => prisma.userRole.deleteMany({ where: { userId: ADMIN, organizationId: WCT } })).catch(() => {});
    await prisma.userOrganization.deleteMany({ where: { userId: ADMIN } });
    console.log(`cleanup: ${madeClerk.length} dev Clerk users and their rows removed`);
    await app.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
