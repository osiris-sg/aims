/**
 * WCT: a supplier invoice's Quotation No. (2026-11-03; PER LINE since 2026-11-04), DEV database, real HTTP (+ one real AI extraction).
 *   A create a SIN whose two lines carry two quotations: each line stored with id + number; the list carries both; the filter finds it by either
 *   B a posted SIN's line quotations change through PATCH /bills/:id/quotation { lines } (no amounts change); clearing works
 *   C the order of a quotation lists the SIN under supplierInvoices with THAT quotation's line amount (and the invoice total)
 *   D another org: quotationId ignored on create; the tag endpoint refused
 *   E a PDF invoice printing the quotation number: /bills/extract pre-fills it (exact match), another number does not
 * The test SINs are voided and removed at the end.
 *
 *   AIMS_SECRETS_KEY=... TENANCY_MODE=per-org npx ts-node -r tsconfig-paths/register --transpile-only scripts/_sin-quotation-e2e.ts
 *
 * Last run 2026-11-03 on dev: 14/14 (posted SIN re-tagged; one real extraction pre-filled the exact quotation).
 * 2026-11-04 (per line): see the round's report.
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
const WCT_ADMIN = '0cb82844-c14f-415e-b831-05470042b508';
const OSI = 'd068f159-e45a-4da8-beaf-62e903f44141';
const OSI_ADMIN = '7b18bdc6-bac2-42c6-88e7-92a73bc43512';
const USER = 'user_e2e_sin_quotation';
const RUN = Date.now().toString(36).toUpperCase();

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
    return { id: String(req.headers['x-e2e-user']), firstName: 'E2E', lastName: 'Sin', emailAddresses: [] };
  }
}

async function pdfOf(html: string): Promise<string> {
  const puppeteer = require('puppeteer');
  const b = await puppeteer.launch({ headless: 'new' });
  const p = await b.newPage();
  await p.setContent(html);
  const buf = await p.pdf({ format: 'A4' });
  await b.close();
  return Buffer.from(buf).toString('base64');
}

async function main() {
  if (process.env.PROD_DATABASE_URL && new URL(process.env.DATABASE_URL!).host === new URL(process.env.PROD_DATABASE_URL).host) throw new Error('Refusing: prod DB');
  const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ClerkStrategy).useClass(FakeStrategy).compile();
  const app = mod.createNestApplication({ logger: ['error'] });
  app.useGlobalPipes(new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } }));
  app.useGlobalFilters(new CustomExceptionFilter());
  app.useGlobalInterceptors(new CustomResponseInterceptor());
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as any).port}`;
  const prisma = app.get(PrismaService);
  const call = async (org: string, method: string, path: string, body?: any) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'x-e2e-user': USER, 'x-active-org-id': org, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j: any = await r.json().catch(() => null);
    return { status: r.status, body: j, data: j?.data };
  };
  for (const [org, role] of [[WCT, WCT_ADMIN], [OSI, OSI_ADMIN]]) {
    await prisma.userOrganization.upsert({ where: { userId_organizationId: { userId: USER, organizationId: org } }, update: { isActive: true }, create: { userId: USER, organizationId: org, isActive: true } });
    await runAsOrg(org, () => prisma.userRole.upsert({ where: { userId_roleId_organizationId: { userId: USER, roleId: role, organizationId: org } }, update: { isActive: true }, create: { userId: USER, roleId: role, organizationId: org } }));
  }
  const made: Array<{ org: string; id: string }> = [];
  const suppliers: Array<{ org: string; id: string }> = [];
  try {
    const order = await runAsOrg(WCT, () => prisma.order.findFirst({ where: { organizationId: WCT, sourceQuotationId: { not: null } }, orderBy: { createdAt: 'desc' }, select: { id: true, orderNumber: true, sourceQuotationId: true } }));
    const quote = await runAsOrg(WCT, () => prisma.document.findFirst({ where: { id: order!.sourceQuotationId! }, select: { id: true, name: true } }));
    // A second WCT quotation for the other line (the same one again when the org has only one).
    const quote2 = (await runAsOrg(WCT, () => prisma.document.findFirst({ where: { organizationId: WCT, type: 'QUOTATION', id: { not: quote!.id } }, select: { id: true, name: true } }))) ?? quote!;
    // A test supplier per org (removed at the end).
    const supplier = await runAsOrg(WCT, () => prisma.supplier.create({ data: { organizationId: WCT, name: `E2E Supplier ${RUN}` } as any, select: { id: true, name: true } }));
    suppliers.push({ org: WCT, id: supplier.id });
    const line = [{ description: 'E2E ducting', quantity: 1, unitPrice: 100, amount: 100 }];
    const twoSites = [
      { description: 'E2E ducting (site A)', quantity: 1, unitPrice: 100, amount: 100, quotationId: quote!.id },
      { description: 'E2E fan (site B)', quantity: 1, unitPrice: 40, amount: 40, quotationId: quote2.id },
    ];
    // A
    const a = await call(WCT, 'POST', '/bills', { supplierId: supplier!.id, billNumber: `E2E-SINQ-${RUN}-A`, billDate: '2026-11-03', lines: twoSites, taxAmount: 12.6 });
    const aId = a.data?.id;
    if (aId) made.push({ org: WCT, id: aId });
    ok(a.status < 300 && a.data?.lines?.[0]?.quotationNumber === quote!.name && a.data?.lines?.[1]?.quotationNumber === quote2.name && (a.data?.quotations ?? []).some((q: any) => q.id === quote2.id), `A: SIN created, line 1 → ${quote!.name}, line 2 → ${quote2.name}`, a.data ?? a.body);
    const list = await call(WCT, 'GET', `/bills?quotationId=${quote2.id}`);
    ok((list.data ?? []).some((b: any) => b.id === aId && (b.quotations ?? []).some((q: any) => q.number === quote!.name)), 'A: the list filter finds it by the second line\'s quotation, with every number', (list.data ?? []).length);
    const none = await call(WCT, 'GET', '/bills?quotationId=none&limit=50');
    ok(!(none.data ?? []).some((b: any) => b.id === aId), 'A: "Not tagged" leaves it out');
    const bad = await call(WCT, 'POST', '/bills', { supplierId: supplier!.id, billNumber: `E2E-SINQ-${RUN}-X`, billDate: '2026-11-03', lines: [{ ...line[0], quotationId: '00000000-0000-4000-8000-000000000000' }] });
    if (bad.data?.id) made.push({ org: WCT, id: bad.data.id });
    ok(bad.status === 400, 'A: a quotation that is not ours: 400', bad.status);
    // B: post it first (submit + approve), so the tag is changed on a POSTED SIN
    await call(WCT, 'POST', `/bills/${aId}/submit`);
    await call(WCT, 'POST', `/bills/${aId}/approve`);
    const before = await call(WCT, 'GET', `/bills/${aId}`);
    ok(before.data?.status === 'POSTED', 'B: the SIN is posted', before.data?.status);
    const locked = await call(WCT, 'PATCH', `/bills/${aId}`, { reference: 'changed' });
    ok(locked.status >= 400, 'B: a posted SIN stays locked for normal edits', locked.status);
    const cleared = await call(WCT, 'PATCH', `/bills/${aId}/quotation`, { lines: [null, null] });
    ok(cleared.status < 300 && (cleared.data?.quotations ?? []).length === 0, `B: lines cleared on a ${before.data?.status} SIN`, cleared.body);
    const again = await call(WCT, 'PATCH', `/bills/${aId}/quotation`, { lines: [quote!.id, quote2.id] });
    ok(again.status < 300 && again.data?.lines?.[1]?.quotationNumber === quote2.name && again.data?.totalAmount === before.data?.totalAmount && again.data?.status === before.data?.status, 'B: lines tagged again; amounts and status unchanged', again.data);
    const log = await prisma.actionLog.findFirst({ where: { path: `/bills/${aId}/quotation` }, orderBy: { createdAt: 'desc' } });
    ok(log?.action === 'TAG_QUOTATION', 'B: Activity Log action TAG_QUOTATION', log?.action);
    // C
    const o = await call(WCT, 'GET', `/orders/${order!.id}`);
    const sin = (o.data?.supplierInvoices?.rows ?? []).find((r: any) => r.id === aId);
    ok(sin && sin.supplierName && sin.quotationAmount === (quote2.id === quote!.id ? 140 : 100) && sin.totalAmount === before.data?.totalAmount, `C: order ${order!.orderNumber} lists it with its quotation's lines only (${sin?.quotationAmount} of ${sin?.totalAmount})`, o.data?.supplierInvoices);
    // D
    const osup = await runAsOrg(OSI, () => prisma.supplier.create({ data: { organizationId: OSI, name: `E2E Supplier ${RUN}` } as any, select: { id: true } }));
    suppliers.push({ org: OSI, id: osup.id });
    if (osup) {
      const d = await call(OSI, 'POST', '/bills', { supplierId: osup.id, billNumber: `E2E-SINQ-${RUN}-D`, billDate: '2026-11-03', lines: [{ ...line[0], quotationId: quote!.id }] });
      if (d.data?.id) made.push({ org: OSI, id: d.data.id });
      ok(d.status < 300 && !d.data?.lines?.[0]?.quotationId && !(d.data?.quotations ?? []).length, 'D: another org: a line quotationId is ignored', d.data ?? d.body);
      const dt = d.data?.id ? await call(OSI, 'PATCH', `/bills/${d.data.id}/quotation`, { quotationId: quote!.id }) : { status: 0 };
      ok(dt.status === 400, 'D: another org: the tag endpoint is refused', dt.status);
    }
    // E
    if (process.env.ANTHROPIC_API_KEY) {
      const inv = (ref: string) => `<html><body style="font-family:Arial;padding:40px"><h2>Cool Air Engineering Pte Ltd</h2><p>TAX INVOICE No. CA-${RUN}</p><p>Date: 03/11/2026</p><p>Bill To: WCT Engineering Pte Ltd</p><p>Your Ref: ${ref}</p><table border="1" cellpadding="6"><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Amount</th></tr><tr><td>Supply of exhaust fan</td><td>1</td><td>500.00</td><td>500.00</td></tr></table><p>Subtotal 500.00</p><p>GST 9% 45.00</p><p>Total 545.00</p></body></html>`;
      const e1 = await call(WCT, 'POST', '/bills/extract', { base64: await pdfOf(inv(quote!.name!)), mediaType: 'application/pdf' });
      ok(e1.status < 300 && e1.data?.quotationId === quote!.id && e1.data?.quotationFromInvoice === true, `E: the invoice's "Your Ref: ${quote!.name}" pre-fills the Quotation No.`, { status: e1.status, q: e1.data?.quotationId, refs: e1.data?.quotationRefs });
      const e2 = await call(WCT, 'POST', '/bills/extract', { base64: await pdfOf(inv('QO209912-9999')), mediaType: 'application/pdf' });
      ok(e2.status < 300 && !e2.data?.quotationId, 'E: a quotation number that is not ours: nothing pre-filled', { status: e2.status, q: e2.data?.quotationId });
    }
  } finally {
    for (const m of made) {
      await call(m.org, 'DELETE', `/bills/${m.id}`).catch(() => {});
      await runAsOrg(m.org, async () => {
        const jes = await prisma.journalEntry.findMany({ where: { organizationId: m.org, sourceDocumentId: m.id }, select: { id: true, status: true } });
        if (jes.every((j: any) => j.status === 'VOID')) {
          for (const j of jes) {
            await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: j.id } });
            await prisma.journalEntry.delete({ where: { id: j.id } });
          }
          await prisma.document.delete({ where: { id: m.id } });
        } else console.log('cleanup: kept', m.id, jes.map((j: any) => j.status));
      }).catch((e: any) => console.log('cleanup failed', m.id, e?.message));
    }
    for (const s of suppliers) await runAsOrg(s.org, () => prisma.supplier.delete({ where: { id: s.id } })).catch((e: any) => console.log('cleanup: supplier kept', s.id, e?.message?.slice(0, 120)));
    for (const [org, role] of [[WCT, WCT_ADMIN], [OSI, OSI_ADMIN]]) await runAsOrg(org, () => prisma.userRole.deleteMany({ where: { userId: USER, roleId: role, organizationId: org } })).catch(() => {});
    await prisma.userOrganization.deleteMany({ where: { userId: USER } });
    console.log(`cleanup: ${made.length} test SINs voided and removed`);
    await app.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
