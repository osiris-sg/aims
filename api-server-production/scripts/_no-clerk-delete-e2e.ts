/**
 * Removing a user never deletes their Clerk login (2026-11-03), DEV database + DEV Clerk, real HTTP.
 *   A an org admin removes a person whose only org it is: membership + roles off, Clerk login kept
 *   B a platform admin removes a SiteClock-linked login (no other org): Clerk login kept
 *   C "Delete login everywhere": org admin refused; platform admin gets the warnings; wrong typed text
 *     and unacknowledged warnings refused; with both, the login is deleted
 * Every Clerk user and row it made is removed at the end.
 *
 *   AIMS_SECRETS_KEY=... TENANCY_MODE=per-org npx ts-node -r tsconfig-paths/register --transpile-only scripts/_no-clerk-delete-e2e.ts
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

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const WCT_ADMIN = '0cb82844-c14f-415e-b831-05470042b508';
const PLATFORM = 'osiris-platform';
const ORG_ADMIN = 'user_e2e_noclerkdel_admin';
const OSIRIS = 'user_e2e_noclerkdel_osiris';
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
  const call = async (as: string, method: string, path: string, body?: any) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'x-e2e-user': as, 'x-active-org-id': WCT, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let j: any = null;
    try {
      j = JSON.parse(text);
    } catch {}
    return { status: r.status, body: j, text, data: j?.data };
  };
  const member = async (userId: string, org: string, roleId: string) => {
    await prisma.userOrganization.upsert({ where: { userId_organizationId: { userId, organizationId: org } }, update: { isActive: true }, create: { userId, organizationId: org, isActive: true } });
    await runAsOrg(org, () => prisma.userRole.upsert({ where: { userId_roleId_organizationId: { userId, roleId, organizationId: org } }, update: { isActive: true }, create: { userId, roleId, organizationId: org } }));
  };
  const osirisRole = await runAsOrg(PLATFORM, () => prisma.role.findFirst({ where: { name: 'osirisadmin', organizationId: PLATFORM } }));
  if (!osirisRole) throw new Error('no dev osirisadmin role');
  await member(ORG_ADMIN, WCT, WCT_ADMIN);
  await member(OSIRIS, PLATFORM, osirisRole.id);
  const made: string[] = [];
  const exists = async (id: string) => !!(await clerk.users.getUser(id).catch(() => null));
  try {
    // A
    const a = await clerk.users.createUser({ emailAddress: [`e2e-nodel-a-${RUN}+clerk_test@example.com`], firstName: 'Only', lastName: 'Wct', skipPasswordRequirement: true } as any);
    made.push(a.id);
    await member(a.id, WCT, WCT_ADMIN);
    const ra = await call(ORG_ADMIN, 'DELETE', `/users/${a.id}`);
    ok(ra.status < 300 && ra.data?.clerkDeleted === false && ra.data?.otherMemberships === 0, 'A: org admin removes their only org: 200, clerkDeleted false, nothing left', ra.data ?? ra.text.slice(0, 200));
    ok(await exists(a.id), 'A: the Clerk login still exists');
    ok((await prisma.userOrganization.count({ where: { userId: a.id, isActive: true } })) === 0, 'A: the membership is off');
    // B
    const b = await clerk.users.createUser({ emailAddress: [`e2e-nodel-b-${RUN}+clerk_test@example.com`], firstName: 'Site', lastName: 'Worker', publicMetadata: { siteclock: { role: 'WORKER', userId: 'sc-e2e', companyId: 'c-e2e' } }, skipPasswordRequirement: true } as any);
    made.push(b.id);
    await member(b.id, WCT, WCT_ADMIN);
    const rb = await call(OSIRIS, 'DELETE', `/users/${b.id}`);
    ok(rb.status < 300 && rb.data?.clerkDeleted === false, 'B: platform admin removes a SiteClock-linked login: clerkDeleted false', rb.data ?? rb.text.slice(0, 200));
    ok(await exists(b.id), 'B: the SiteClock-linked Clerk login still exists');
    // C
    await member(b.id, WCT, WCT_ADMIN); // back in WCT, so there is an "other org" warning too
    const c0 = await call(ORG_ADMIN, 'GET', `/users/${b.id}/login-delete-check`);
    const c0b = await call(ORG_ADMIN, 'POST', `/users/${b.id}/delete-login`, { confirm: `e2e-nodel-b-${RUN}+clerk_test@example.com`, acknowledgeWarnings: true });
    ok(c0.status === 403 && c0b.status === 403, 'C: an org admin cannot check or delete a login (403)', [c0.status, c0b.status]);
    const c1 = await call(OSIRIS, 'GET', `/users/${b.id}/login-delete-check`);
    ok(c1.status < 300 && c1.data?.siteclock === true && (c1.data?.warnings ?? []).length === 2 && c1.data?.confirmWith === `e2e-nodel-b-${RUN}+clerk_test@example.com`, 'C: the check warns (SiteClock + still in WCT) and names the email to type', c1.data);
    const c2 = await call(OSIRIS, 'POST', `/users/${b.id}/delete-login`, { confirm: 'nope', acknowledgeWarnings: true });
    const c3 = await call(OSIRIS, 'POST', `/users/${b.id}/delete-login`, { confirm: `e2e-nodel-b-${RUN}+clerk_test@example.com` });
    ok(c2.status === 400 && c3.status === 400 && (await exists(b.id)), 'C: wrong typed text / warnings not acknowledged: 400, login kept', [c2.body?.message, c3.body?.message]);
    const c4 = await call(OSIRIS, 'POST', `/users/${b.id}/delete-login`, { confirm: `E2E-NODEL-B-${RUN}+clerk_test@example.com `, acknowledgeWarnings: true });
    ok(c4.status < 300 && c4.data?.deleted === true && !(await exists(b.id)), 'C: typed + acknowledged: the login is deleted', c4.data ?? c4.text.slice(0, 200));
    ok((await prisma.userOrganization.count({ where: { userId: b.id, isActive: true } })) === 0, 'C: and every membership is off');
    const log = await prisma.actionLog.findFirst({ where: { path: `/users/${b.id}/delete-login`, statusCode: { lt: 300 } }, orderBy: { createdAt: 'desc' } });
    ok(log?.action === 'DELETE_LOGIN', 'C: Activity Log action DELETE_LOGIN', log?.action);
  } finally {
    for (const id of made) {
      await prisma.userOrganization.deleteMany({ where: { userId: id } }).catch(() => {});
      await runAsOrg(WCT, () => prisma.userRole.deleteMany({ where: { userId: id, organizationId: WCT } })).catch(() => {});
      await clerk.users.deleteUser(id).catch(() => {});
    }
    await runAsOrg(WCT, () => prisma.userRole.deleteMany({ where: { userId: ORG_ADMIN, organizationId: WCT } })).catch(() => {});
    await runAsOrg(PLATFORM, () => prisma.userRole.deleteMany({ where: { userId: OSIRIS, organizationId: PLATFORM } })).catch(() => {});
    await prisma.userOrganization.deleteMany({ where: { userId: { in: [ORG_ADMIN, OSIRIS] } } });
    console.log(`cleanup: ${made.length} dev Clerk users and their rows removed`);
    await app.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
