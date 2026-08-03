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
  // the invoice
  const inv = await prisma.document.findFirst({ where: { organizationId: ORG, type: 'INVOICE', name: 'BIPL-JPSG-INV-20260729-0179' }, select: { id: true, config: true } });
  const c: any = inv!.config || {};
  const cust = c.customerId ? await prisma.customer.findUnique({ where: { id: c.customerId }, select: { name: true, xeroId: true } }) : null;
  const contact = cust?.xeroId ? { ContactID: cust.xeroId } : { Name: cust?.name || c.customerName || c.customer?.name };
  const di: any = c.documentInfo || {};
  const lines = (c.items || []).map((it: any) => {
    const qty = Number(it.quantity) || 0, unit = Number(it.unitPrice) || 0, amt = Number(it.amount) || 0;
    if (amt === 0 && unit === 0) return { Description: it.description || '' };
    const ok = qty > 0 && Math.abs(qty * unit - amt) < 0.01;
    return { Description: it.description || 'Jurong Port Pass Application', Quantity: ok ? qty : 1, UnitAmount: ok ? unit : amt, AccountCode: '443', TaxType: 'NONE' };
  });
  const res = await xero('PUT', '/Invoices?SummarizeErrors=false', { Invoices: [{ Type: 'ACCREC', Contact: contact, InvoiceNumber: inv!.name, Reference: `${inv!.name} (JP Pass Application)`, Date: di.date || '2026-07-29', DueDate: di.dueDate || di.date || '2026-07-29', Status: 'DRAFT', LineAmountTypes: 'NoTax', LineItems: lines }] });
  const xi = res.Invoices[0];
  if (xi.HasErrors) { console.log(`x invoice: ${xi.ValidationErrors?.[0]?.Message}`); } else {
    await prisma.document.update({ where: { id: inv!.id }, data: { config: { ...c, xeroInvoiceId: xi.InvoiceID, xeroStatus: 'DRAFT', xeroSyncedAt: new Date().toISOString(), xeroSyncedBy: 'jpsg-push' } } });
    console.log(`invoice 0179 pushed: DRAFT $${xi.Total} → ${xi.Contact?.Name}`);
  }
  await sleep(1100);
  // the two bills
  for (const name of ['JP2607290103', 'JP2607290104']) {
    const b = await prisma.document.findFirst({ where: { organizationId: ORG, type: 'BILL', name }, select: { id: true, config: true } });
    const bc: any = b!.config || {};
    const sup = bc.supplierId ? await prisma.supplier.findUnique({ where: { id: bc.supplierId }, select: { name: true, xeroId: true } }) : null;
    const bcontact = sup?.xeroId ? { ContactID: sup.xeroId } : { Name: sup?.name || 'Jurong Port Pte Ltd' };
    const br = await xero('PUT', '/Invoices?SummarizeErrors=false', { Invoices: [{ Type: 'ACCPAY', Contact: bcontact, InvoiceNumber: `${name} · ${bc.reference}`, Date: bc.billDate?.slice(0, 10) || '2026-07-29', DueDate: bc.billDate?.slice(0, 10) || '2026-07-29', Status: 'DRAFT', LineAmountTypes: 'NoTax', LineItems: [{ Description: (bc.lines?.[0]?.description || 'JP Pass Application').slice(0, 500), Quantity: 1, UnitAmount: Number(bc.totalAmount || 20), AccountCode: '443', TaxType: 'NONE' }] }] });
    const xb = br.Invoices[0];
    if (xb.HasErrors) { console.log(`x ${name}: ${xb.ValidationErrors?.[0]?.Message}`); continue; }
    await prisma.document.update({ where: { id: b!.id }, data: { config: { ...bc, xeroBillId: xb.InvoiceID, xeroStatus: 'DRAFT', xeroSyncedAt: new Date().toISOString(), xeroSyncedBy: 'jpsg-push' } } });
    console.log(`${name} pushed: DRAFT $${xb.Total}`);
    await sleep(1100);
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error('FATAL', e.message.slice(0, 300)); process.exit(1); });
