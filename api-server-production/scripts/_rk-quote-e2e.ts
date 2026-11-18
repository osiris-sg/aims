/**
 * WCT Racking quotation (2026-11-18) end to end on the DEV database.
 *
 * Dev has no Racking org, so this runs in dev WCT (manual order flow on there) with dev's "TEST Client",
 * and the Racking look is applied to the renders by passing { enableRackingLayout: true } to
 * effectiveDesign (no dev flag is changed). The order / invoice / GL path it drives is the same code
 * Racking uses: nothing in it reads the Racking flag.
 *
 *   A quotation with a section title, UOM, a $188 Goodwill Discount (discountType "amount") and no GST
 *     → the Racking PDF: titles take no S/No, UOM column, Total Amount / Goodwill Discount / Final Amount,
 *       no GST line, no GST Reg No, no Remarks heading, the Racking sign-off.
 *   B confirm → order (+ draft DO) → "Create invoice" (invoiceOrderFromQuotation)
 *     → the invoice carries the discount as the header discount: gross 3,760, discount 188, nett 3,572, GST 0.
 *   C the invoice confirmed → its journal balances, AR = 3,572, no GST line.
 *   D the invoice prints its Discount line; the Racking invoice letterhead has no GST Reg No.
 *
 *   TENANCY_MODE=per-org npx ts-node -r tsconfig-paths/register --transpile-only scripts/_rk-quote-e2e.ts
 *
 * Dev writes (kept, named QO-E2E-RK-*): one quotation, its order + draft DO, one invoice + journal.
 */
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from '../config/configuration';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { ClerkModule } from '../src/clerk/clerk.module';
import { PushModule } from '../src/push/push.module';
import { PushService } from '../src/push/push.service';
import { StaffWhatsAppService } from '../src/staff-whatsapp/staff-whatsapp.service';
import { DeliveriesModule } from '../src/deliveries/deliveries.module';
import { DocumentsService } from '../src/documents/documents.service';
import { PublicSignModule } from '../src/public-sign/public-sign.module';
import { OrdersModule } from '../src/orders/orders.module';
import { OrgRulesModule } from '../src/org-rules/org-rules.module';
import { ShortLinksModule } from '../src/short-links/short-links.module';
import { renderDocumentHtml } from '../src/common/services/document-html';
import { effectiveDesign } from '../src/common/services/document-html/wct-brand';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const RACKING = { enableRackingLayout: true };

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ClerkModule, PushModule, ActionLogModule, OrgRulesModule, ShortLinksModule, DeliveriesModule, PublicSignModule, OrdersModule] })
class E2EModule {}
const noop = () => new Proxy({}, { get: (_t, prop) => (prop === 'then' ? undefined : async () => undefined) });

let failures = 0;
const check = (label: string, ok: boolean, got?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  → got ${JSON.stringify(got)}`}`);
};

(async () => {
  const url = process.env.DATABASE_URL || '';
  const prod = (process.env.PROD_DATABASE_URL || '').replace(/["\r]/g, '');
  if (prod && new URL(url).host === new URL(prod).host) throw new Error('Refusing: DATABASE_URL is the prod database');

  const mod = await Test.createTestingModule({ imports: [E2EModule] })
    .overrideProvider(StaffWhatsAppService).useValue(noop())
    .overrideProvider(PushService).useValue(noop())
    .compile();
  const prisma = mod.get(PrismaService);
  const documents = mod.get(DocumentsService);

  await runAsOrg(WCT, async () => {
    const customer = await prisma.customer.findFirst({ where: { organizationId: WCT, name: 'TEST Client' } });
    if (!customer) throw new Error('dev TEST Client missing');
    const tpl = await prisma.documentTemplate.findFirst({ where: { organizationId: WCT, type: 'QUOTATION', styleConfig: { path: ['layout'], equals: 'wct' } }, select: { id: true, styleConfig: true } });
    if (!tpl) throw new Error('no WCT-layout quotation template on dev');
    const org = await prisma.organization.findUnique({ where: { id: WCT } });
    const featuresBefore = JSON.stringify((await prisma.organizationUIConfig.findUnique({ where: { organizationId: WCT } }))?.features);

    const items = [
      { id: 1, description: 'Heavy Duty Racking Works', isGroupHeader: true },
      { id: 2, description: 'Supply heavy duty end frame\n- H3000xD900mm', quantity: 8, uom: 'pcs', unitPrice: 200, amount: 1600, isService: true, tax: '0' },
      { id: 3, description: 'Supply heavy duty boxbeam', quantity: 16, uom: '', unitPrice: 50, amount: 800, isService: true, tax: '0' },
      { id: 4, description: 'Pre Renovation works', isGroupHeader: true },
      { id: 5, description: 'Supply 25mm thk plywood shelvings', quantity: 8, uom: 'bay', unitPrice: 70, amount: 560, isService: true, tax: '0' },
      { id: 6, description: 'Delivery and installation', quantity: 1, uom: 'lot', unitPrice: 800, amount: 800, isService: true, tax: '0' },
    ];
    const name = `QO-E2E-RK-${Date.now()}`;
    const config: any = {
      documentNumber: name, date: '2026-11-18', currency: 'SGD', customerId: customer.id, customerName: customer.name, billTo: '1 Raffles Place',
      subject: 'Heavy duty racking works', location: 'TEST site', salesPersonName: 'Nee Meng Tan', salesContact: '9181 9107',
      items, taxApplicable: 'N', absorbTax: 'N', gstPercent: 9,
      discountType: 'amount', discountPercent: 188, discountAmount: 188, grossTotal: 3760, subTotal: 3572, gstAmount: 0, nettTotal: 3572,
      signedBy: 'Nee Meng Tan', signedByTitle: 'Manager',
      termsAndConditions: 'PAYMENT TERMS:\nFirst Payment - 50% Upon confirmation\n\nTERMS & CONDITIONS:\n• Terms & Conditions may change without prior notice to customer',
      note: '', footerMessage: 'This is computer generated, no signature is required',
    };
    const qo = await prisma.document.create({ data: { organizationId: WCT, type: 'QUOTATION', documentTemplateId: tpl.id, name, status: 'unconfirmed', config } as any });

    // A: the Racking quotation PDF (HTML is what Puppeteer prints).
    const design = effectiveDesign(tpl.styleConfig, 'QUOTATION', RACKING);
    check('A design: racking stamped for the WCT-layout quotation', (design as any).racking === true, design);
    const qh = renderDocumentHtml('QUOTATION', { documentType: 'QUOTATION', ...config, name, design, customer, organization: org }, org)!;
    const sNos = [...qh.matchAll(/<td class="no">(\d*)<\/td>/g)].map((m) => m[1]);
    check('A S/No: section titles take none, items 1..4', JSON.stringify(sNos) === '["1","2","3","4"]', sNos);
    check('A UOM column between Qty and Unit Price', /Qty<\/th><th[^>]*>UOM<\/th><th[^>]*>Unit Price/.test(qh), qh.match(/<thead><tr>.*?<\/tr><\/thead>/)?.[0]);
    check('A UOM blank prints blank', qh.includes('<td class="qty"></td>'));
    check('A totals: Total Amount 3,760 / Goodwill Discount (188) / Final Amount 3,572', qh.includes('Total Amount:</td><td class="v">$3,760.00') && qh.includes('Goodwill Discount:</td><td class="v">$188.00') && qh.includes('Final Amount:</td><td class="v">$3,572.00'));
    check('A no GST line, no GST Reg No, no Remarks heading, no computer-generated line', !/GST \d/.test(qh) && !qh.includes('GST Reg No') && !qh.includes('Remarks:') && !qh.includes('computer generated'));
    check('A sign-off: Yours Sincerely, / signer / Manager of / company', qh.includes('Yours Sincerely,') && qh.includes('<div class="scr">Nee Meng Tan</div>') && qh.includes('Manager of') && !qh.includes('Director of'));

    // B: confirm → order + draft DO → Create invoice.
    await documents.updateDocument({ id: qo.id, type: 'QUOTATION', status: 'confirmed' } as any, WCT);
    const order = await prisma.order.findFirst({ where: { organizationId: WCT, sourceQuotationId: qo.id } });
    check('B confirm → one order', !!order, order);
    // Dev WCT's manual flow may already have billed the quotation on confirm; else "Create invoice".
    const fresh: any = await prisma.order.findFirst({ where: { id: order!.id } });
    const invId = fresh?.invoiceDocumentId || (await documents.invoiceOrderFromQuotation(order!.id, WCT).then((r: any) => r?.id ?? r?.document?.id ?? r?.invoice?.id));
    const invDoc: any = await prisma.document.findFirst({ where: { id: invId, organizationId: WCT } });
    check('B the order has its invoice', !!invDoc, { invId });
    const ic: any = invDoc?.config || {};
    check('B invoice carries the Goodwill Discount as the header discount (gross 3,760, discount 188, nett 3,572, GST 0)',
      Number(ic.grossTotal) === 3760 && Number(ic.discountAmount) === 188 && Number(ic.nettTotal) === 3572 && Number(ic.gstAmount) === 0,
      { grossTotal: ic.grossTotal, discountAmount: ic.discountAmount, discountPercent: ic.discountPercent, nettTotal: ic.nettTotal, gstAmount: ic.gstAmount });
    check('B the invoice % reproduces the amount over its gross', Math.abs((3760 * Number(ic.discountPercent)) / 100 - 188) < 0.01, ic.discountPercent);
    check('B no GST on the invoice', String(ic.taxApplicable) === 'N', ic.taxApplicable);

    // C: confirm the invoice → the journal.
    await documents.updateDocument({ id: invDoc.id, type: 'INVOICE', status: 'confirmed' } as any, WCT);
    const je = await prisma.journalEntry.findMany({ where: { organizationId: WCT, sourceDocumentId: invDoc.id, status: { not: 'VOID' } }, include: { lines: { include: { account: { select: { code: true, name: true, type: true } } } } } } as any);
    const lines = (je as any[]).flatMap((e) => e.lines);
    const dr = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const cr = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    console.log('   journal:', lines.map((l: any) => `${l.account?.code} ${l.account?.name} Dr ${Number(l.debit)} Cr ${Number(l.credit)}`).join(' | '));
    check('C one journal, balanced', je.length === 1 && Math.abs(dr - cr) < 0.005, { n: je.length, dr, cr });
    check('C AR debit = 3,572', lines.some((l: any) => Number(l.debit) === 3572), lines.map((l: any) => [l.account?.code, l.debit, l.credit]));
    check('C no GST line', !lines.some((l: any) => /gst|tax/i.test(String(l.account?.name)) && (Number(l.debit) || Number(l.credit))), lines.map((l: any) => l.account?.name));
    check('C net sales = 3,572 (revenue credits less discount debits)',
      Math.abs(lines.filter((l: any) => l.account?.type === 'REVENUE' || /revenue|sales|discount/i.test(String(l.account?.name))).reduce((s: number, l: any) => s + Number(l.credit || 0) - Number(l.debit || 0), 0) - 3572) < 0.005);

    // D: the invoice prints its discount; the Racking invoice letterhead drops GST Reg No.
    const invDesign = effectiveDesign({ layout: 'wct', logoPosition: 'left', titleText: 'TAX INVOICE' }, 'INVOICE', RACKING);
    const ih = renderDocumentHtml('INVOICE', { documentType: 'INVOICE', ...ic, name: invDoc.name, design: invDesign, organization: org }, org)!;
    check('D invoice prints the Discount line and no GST Reg No', ih.includes('Discount:</td><td class="v">$188.00') && !ih.includes('GST Reg No'), null);

    const featuresAfter = JSON.stringify((await prisma.organizationUIConfig.findUnique({ where: { organizationId: WCT } }))?.features);
    check('dev WCT flags unchanged by the run', featuresBefore === featuresAfter);
    console.log(`dev records kept: ${name}, order ${order?.orderNumber}, invoice ${invDoc?.name}`);
  });
  await mod.close();
  console.log(failures ? `${failures} FAILED` : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
