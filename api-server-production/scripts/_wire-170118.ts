/** Update Xero JP drafts: external (ref'd) bills 442→443; push the 22 new
 *  bills with the correct account; all NoTax. */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const XERO_API = 'https://api.xero.com/api.xro/2.0';
const m = fs.readFileSync('.env.production', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const url = new URL(m[1]); url.searchParams.delete('pool_timeout'); url.searchParams.delete('connect_timeout');
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url.toString() }) } as any);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const XT2_FILE = __dirname + '/_xero2-tokens.json';
async function tokens() {
  const t = JSON.parse(fs.readFileSync(XT2_FILE, 'utf8'));
  if (t.expiresAt - Date.now() > 5 * 60 * 1000) return { at: t.accessToken, tid: t.tenantId };
  const basic = Buffer.from(`${t.clientId}:${t.clientSecret}`).toString('base64');
  const res = await fetch('https://identity.xero.com/connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refreshToken }) });
  if (!res.ok) throw new Error(`app2 refresh ${res.status}: ${await res.text()}`);
  const n = await res.json();
  const upd = { ...t, accessToken: n.access_token, refreshToken: n.refresh_token, expiresAt: Date.now() + n.expires_in * 1000 };
  fs.writeFileSync(XT2_FILE, JSON.stringify(upd, null, 2));
  return { at: upd.accessToken, tid: upd.tenantId };
}
let TK: any;
async function xero(method: string, path: string, body?: any) {
  for (let i = 0; i < 6; i++) {
    let res: Response;
    try { res = await fetch(`${XERO_API}${path}`, { method, headers: { Authorization: `Bearer ${TK.at}`, 'Xero-Tenant-Id': TK.tid, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
    catch { await sleep((i + 1) * 15000); continue; }
    if (res.status === 401) { TK = await tokens(); continue; }
    if (res.status === 429) { const w = parseInt(res.headers.get('Retry-After') || '60', 10); console.log(`  ⏸ 429 ${w}s`); await sleep(w * 1000); continue; }
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    return json;
  }
  throw new Error('gave up');
}
async function main() {
  TK = await tokens();
  const b = await prisma.document.findFirst({ where: { organizationId: ORG, type: 'BILL', name: 'JP2607170118' }, select: { id: true, config: true } });
  const c: any = b!.config || {};
  const a443 = await prisma.chartOfAccount.findFirst({ where: { organizationId: ORG, code: '443' }, select: { id: true } });
  const lines = (c.lines || [{ description: 'JP Pass Application', amount: 20, quantity: 1, unitPrice: 20 }]).map((l: any) => ({ ...l, accountId: a443!.id, accountCode: '443', amount: 20, unitPrice: 20 }));
  await prisma.document.update({ where: { id: b!.id }, data: { config: { ...c, reference: 'BI202607106', lines, amountsAre: 'NO_TAX', taxAmount: 0, subtotal: 20, totalAmount: 20, billStatus: 'PAID', amountPaid: 20 } } });
  console.log('AIMS wired: ref BI202607106, 443, NO_TAX');
  // payment record (Eve, bill date 17 Jul — same as its 43 siblings)
  const eve = await prisma.chartOfAccount.findFirst({ where: { organizationId: ORG, code: '106-2' }, select: { id: true } });
  const existing = await prisma.billPayment.findFirst({ where: { organizationId: ORG, billId: b!.id } });
  if (!existing) {
    await prisma.billPayment.create({ data: { organizationId: ORG, billId: b!.id, supplierId: c.supplierId, amount: 20, paymentDate: new Date('2026-07-17'), paymentMethod: 'cash', reference: 'Petty Cash - Eve', notes: 'JP pass paid at application via petty cash (Eve) — late-arriving bill uploaded by accountant.', bankAccountId: eve!.id, journalEntryId: null, createdBy: 'jp-pass-payment-script' } });
    console.log('AIMS payment recorded ($20 Eve, 17 Jul)');
  }
  // Xero: create, approve, pay
  const accts = await xero('GET', '/Accounts');
  const eveXero = (accts.Accounts || []).find((a: any) => a.Name === 'Petty Cash - Eve')?.AccountID;
  const sup = await prisma.supplier.findUnique({ where: { id: c.supplierId }, select: { xeroId: true, name: true } });
  const contact = sup?.xeroId ? { ContactID: sup.xeroId } : { Name: sup?.name || 'Jurong Port Pte Ltd' };
  const res = await xero('PUT', '/Invoices?SummarizeErrors=false', { Invoices: [{ Type: 'ACCPAY', Contact: contact, InvoiceNumber: 'JP2607170118 · BI202607106', Date: '2026-07-17', DueDate: '2026-07-17', Status: 'AUTHORISED', LineAmountTypes: 'NoTax', LineItems: [{ Description: 'Administrative Fee - 365 Days for 1 Applications (JP Pass)', Quantity: 1, UnitAmount: 20, AccountCode: '443', TaxType: 'NONE' }] }] });
  const inv = res.Invoices[0];
  if (inv.HasErrors) { console.log(`x xero: ${inv.ValidationErrors?.[0]?.Message}`); return; }
  console.log(`xero bill created+approved (${inv.InvoiceID})`);
  await sleep(1100);
  await xero('PUT', '/Payments?SummarizeErrors=false', { Payments: [{ Invoice: { InvoiceID: inv.InvoiceID }, Account: { AccountID: eveXero }, Date: '2026-07-17', Amount: 20 }] });
  await prisma.document.update({ where: { id: b!.id }, data: { status: 'confirmed', config: { ...c, reference: 'BI202607106', lines, amountsAre: 'NO_TAX', taxAmount: 0, subtotal: 20, totalAmount: 20, billStatus: 'PAID', amountPaid: 20, xeroBillId: inv.InvoiceID, xeroStatus: 'PAID', xeroSyncedAt: new Date().toISOString(), xeroSyncedBy: 'jp-pass-late' } } });
  console.log('xero payment applied ($20 Eve, 17 Jul) — bill complete');
  await prisma.$disconnect();
}
main().catch(e => { console.error('FATAL', e.message.slice(0, 300)); process.exit(1); });
