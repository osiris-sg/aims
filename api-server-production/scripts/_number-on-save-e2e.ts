/**
 * "Number on first save" end-to-end (2026-11-02), DEV database, real HTTP.
 *
 * Boots the real AppModule with a test sign-in (`x-e2e-user` header instead of
 * a Clerk token); everything else is real (guard, tenancy, documents service,
 * numbering, dev DB). Checks:
 *   A the "New <type>" draft creates nothing and claims no number
 *   B concurrent first saves: every document a different number, no gaps,
 *     the counter moved by exactly that many (format path: WCT QUOTATION),
 *     and the legacy path (no format: Osiris QUOTATION) the same
 *   C a typed number is kept and claims no serial
 *   D a failed create gives its number back (nothing claimed)
 *   E the actions that need a number find it on the created document
 *     (share link, the rendered HTML)
 * Every row it made is removed and the counters are restored at the end.
 *
 *   TENANCY_MODE=per-org npx ts-node -r tsconfig-paths/register --transpile-only scripts/_number-on-save-e2e.ts
 */
import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { Injectable, ValidationPipe } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import { AppModule } from '../src/app.module';
import { ClerkStrategy } from '../src/auth/clerk.strategy';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
import { CustomExceptionFilter } from '../helpers/custom-exception.filter';
import { CustomResponseInterceptor } from '../helpers/custom-sucess.filter';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const WCT_QO_TEMPLATE = 'ea0bf909-456e-47ff-a482-948db074948a';
const WCT_ADMIN = '0cb82844-c14f-415e-b831-05470042b508';
const OSI = 'd068f159-e45a-4da8-beaf-62e903f44141';
const OSI_QO_TEMPLATE = '4115a240-2c7c-40d4-b038-f9db03056c9c';
const OSI_ADMIN = '7b18bdc6-bac2-42c6-88e7-92a73bc43512'; // superadmin (dev Osiris's Admin role lacks documents:create-basic)
const USER = 'user_e2e_numbering_1';
const N = 12;

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
    return { id, clerkId: id, firstName: 'E2E', lastName: 'Numbering', emailAddresses: [] };
  }
}

async function main() {
  if (process.env.RENDER) throw new Error('Refusing: Render');
  if (process.env.PROD_DATABASE_URL && new URL(process.env.DATABASE_URL!).host === new URL(process.env.PROD_DATABASE_URL).host) throw new Error('Refusing: prod DB');
  const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ClerkStrategy).useClass(FakeStrategy).compile();
  const app = mod.createNestApplication({ logger: ['error'] });
  app.useGlobalPipes(new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } }));
  app.useGlobalFilters(new CustomExceptionFilter());
  app.useGlobalInterceptors(new CustomResponseInterceptor());
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as any).port}`;
  const prisma = app.get(PrismaService);
  const call = async (method: string, path: string, org: string, body?: any) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'x-e2e-user': USER, 'x-active-org-id': org, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let j: any = null;
    try {
      j = JSON.parse(text);
    } catch {}
    return { status: r.status, body: j, text, data: j?.data };
  };
  const made: Array<{ id: string; org: string }> = [];
  const docCount = (org: string) => runAsOrg(org, () => prisma.document.count({ where: { organizationId: org } }));
  const fmt = () => runAsOrg(WCT, () => prisma.documentNumberFormat.findFirst({ where: { organizationId: WCT, documentType: 'QUOTATION', isActive: true }, orderBy: { sortOrder: 'asc' } }));

  // fixtures: a member of both orgs with Admin
  for (const [org, role] of [[WCT, WCT_ADMIN], [OSI, OSI_ADMIN]]) {
    await prisma.userOrganization.upsert({ where: { userId_organizationId: { userId: USER, organizationId: org } }, update: { isActive: true }, create: { userId: USER, organizationId: org, isActive: true } });
    await runAsOrg(org, () => prisma.userRole.upsert({ where: { userId_roleId_organizationId: { userId: USER, roleId: role, organizationId: org } }, update: { isActive: true }, create: { userId: USER, roleId: role, organizationId: org } }));
  }
  const f0 = (await fmt())!;
  console.log(`fixtures: WCT QUOTATION format ${f0.pattern} nextSerial ${f0.nextSerial}; Osiris has no QUOTATION format (legacy numbers)`);

  try {
    // ── A the draft creates nothing ──
    const before = await docCount(WCT);
    const draft = await call('POST', '/documents/basic/draft', WCT, { documentTemplateId: WCT_QO_TEMPLATE, type: 'QUOTATION', config: {} });
    ok(draft.status < 300 && draft.data?.id === null && draft.data?.name === null && draft.data?.numberOnSave === true, 'draft: no id, no number, numberOnSave', draft.data && { id: draft.data.id, name: draft.data.name });
    ok(draft.data?.config?.documentInfo && 'currency' in (draft.data.config.documentInfo ?? {}) , 'draft carries the org defaults (documentInfo)');
    ok((await docCount(WCT)) === before, 'draft: no document created');
    ok((await fmt())!.nextSerial === f0.nextSerial, 'draft: no number claimed (counter unchanged)');

    // ── B concurrent first saves (format path) ──
    const results = await Promise.all(Array.from({ length: N }, () => call('POST', '/documents/basic', WCT, { documentTemplateId: WCT_QO_TEMPLATE, type: 'QUOTATION', config: { items: [{ description: 'e2e line', quantity: 1, unitPrice: 1 }] } })));
    for (const r of results) if (r.data?.id) made.push({ id: r.data.id, org: WCT });
    const names = results.map((r) => r.data?.name);
    ok(results.every((r) => r.status < 300 && r.data?.id), `${N} concurrent first saves all succeeded`, results.filter((r) => r.status >= 300).map((r) => r.text.slice(0, 120)));
    ok(new Set(names).size === N, `${N} different numbers (no duplicates)`, names);
    const serials = names.map((n) => Number(String(n).match(/(\d+)$/)?.[1])).sort((a, b) => a - b);
    ok(serials.every((s, i) => i === 0 || s === serials[i - 1] + 1), 'consecutive (no gaps)', serials);
    const f1 = (await fmt())!;
    ok(f1.nextSerial === serials[N - 1] + 1, `counter moved to one past the last (${f1.nextSerial})`, { counter: f1.nextSerial, last: serials[N - 1] });

    // legacy path (no format)
    const legacy = await Promise.all(Array.from({ length: 6 }, () => call('POST', '/documents/basic', OSI, { documentTemplateId: OSI_QO_TEMPLATE, type: 'QUOTATION', config: {} })));
    for (const r of legacy) if (r.data?.id) made.push({ id: r.data.id, org: OSI });
    const lnames = legacy.map((r) => r.data?.name);
    ok(legacy.every((r) => r.status < 300) && new Set(lnames).size === 6, 'legacy numbering (no format): 6 concurrent saves, 6 different numbers', legacy.map((r) => `${r.status} ${r.data?.name ?? r.text.slice(0, 160)}`));

    // ── C a typed number claims no serial ──
    const typed = await call('POST', '/documents/basic', WCT, { documentTemplateId: WCT_QO_TEMPLATE, type: 'QUOTATION', config: { documentInfo: { documentNumber: `E2E-TYPED-${Date.now()}` } } });
    if (typed.data?.id) made.push({ id: typed.data.id, org: WCT });
    ok(String(typed.data?.name).startsWith('E2E-TYPED-'), 'a typed number is the document\'s number', typed.data?.name);
    ok((await fmt())!.nextSerial === f1.nextSerial, 'a typed number claims no serial (counter unchanged)');

    // ── D a refused create gives nothing away ──
    const bad = await call('POST', '/documents/basic', WCT, { documentTemplateId: WCT_QO_TEMPLATE, type: 'QUOTATION', config: {}, projectId: '00000000-0000-4000-8000-000000000000' });
    if (bad.data?.id) made.push({ id: bad.data.id, org: WCT });
    ok(bad.status === 404, 'create refused (project not in this org): 404', bad.status);
    ok((await fmt())!.nextSerial === f1.nextSerial, 'the refused create claimed no number (counter unchanged)');

    // ── E the number is there for the actions that need it ──
    const doc = results[0].data;
    const sign = await call('POST', `/documents/${doc.id}/sign-link`, WCT, {});
    ok(sign.status < 300 && JSON.stringify(sign.data ?? {}).length > 2, 'e-sign link on the saved quotation', `${sign.status} ${sign.text.slice(0, 160)}`);
    const signView = sign.data?.token ? await fetch(`${base}/public/sign/${sign.data.token}`).then((r) => r.text()) : '';
    if (sign.data?.token) ok(signView.includes(doc.name), `the customer's sign page shows the number (${doc.name})`);
    const html = await call('GET', `/documents/${doc.id}/html`, WCT);
    ok(html.status < 300 && html.text.includes(doc.name), `the rendered document prints its number (${doc.name})`, html.status);
  } finally {
    for (const m of made) await runAsOrg(m.org, () => prisma.document.delete({ where: { id: m.id } })).catch((e: any) => console.log('cleanup delete failed', m.id, e?.message));
    await runAsOrg(WCT, () => prisma.documentNumberFormat.update({ where: { id: f0.id }, data: { nextSerial: f0.nextSerial, lastResetKey: f0.lastResetKey } }));
    for (const [org, role] of [[WCT, WCT_ADMIN], [OSI, OSI_ADMIN]]) {
      await runAsOrg(org, () => prisma.userRole.deleteMany({ where: { userId: USER, roleId: role, organizationId: org } })).catch(() => {});
    }
    await prisma.userOrganization.deleteMany({ where: { userId: USER } });
    console.log(`cleanup: ${made.length} documents removed, WCT counter back to ${f0.nextSerial}`);
    await app.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
