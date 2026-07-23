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
async function tokens() {
  const conn = await prisma.xeroConnection.findUnique({ where: { organizationId: ORG } });
  if (!conn) throw new Error('no conn');
  if (conn.accessTokenExpiresAt.getTime() - Date.now() > 5 * 60 * 1000) return { at: conn.accessToken, tid: conn.tenantId };
  const envTxt = fs.readFileSync('.env.production', 'utf8');
  const basic = Buffer.from(`${envTxt.match(/^XERO_CLIENT_ID="?([^"\n]+)"?/m)?.[1]}:${envTxt.match(/^XERO_CLIENT_SECRET="?([^"\n]+)"?/m)?.[1]}`).toString('base64');
  const res = await fetch('https://identity.xero.com/connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refreshToken }) });
  if (!res.ok) throw new Error(`refresh ${res.status}: ${await res.text()}`);
  const t: any = await res.json();
  const upd = await prisma.xeroConnection.update({ where: { organizationId: ORG }, data: { accessToken: t.access_token, refreshToken: t.refresh_token, accessTokenExpiresAt: new Date(Date.now() + t.expires_in * 1000), refreshTokenExpiresAt: new Date(Date.now() + 60 * 864e5) } });
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
  // 1. delete the stale $320 May draft in Xero (wrong contact/account/amount)
  const del = await xero('POST', '/Invoices/20613639-5543-4cac-ac84-0958d09ea475', { Invoices: [{ InvoiceID: '20613639-5543-4cac-ac84-0958d09ea475', Status: 'DELETED' }] });
  console.log(del?.Invoices?.[0]?.HasErrors ? `x delete: ${del.Invoices[0].ValidationErrors?.[0]?.Message}` : 'old $320 Xero draft deleted');
  await sleep(1100);

  // 2. remove the stale May 28 AIMS row (its Xero counterpart is deleted)
  const oldRow = await prisma.document.findFirst({
    where: { organizationId: ORG, type: 'INVOICE', name: 'BIPL-JPSG-INV-20260521-0001', config: { path: ['xeroInvoiceId'], equals: '6a51c654-4864-476d-8d7b-132c6fcfa4c1' } },
    select: { id: true },
  });
  if (oldRow) {
    await prisma.documentItem.deleteMany({ where: { documentId: oldRow.id } });
    await prisma.documentEmbedding.deleteMany({ where: { documentId: oldRow.id } }).catch(() => null);
    await prisma.timelineItem.deleteMany({ where: { documentId: oldRow.id } }).catch(() => null);
    await prisma.document.updateMany({ where: { baseDocumentId: oldRow.id }, data: { baseDocumentId: null } });
    await prisma.document.delete({ where: { id: oldRow.id } });
    console.log('old May-28 AIMS row deleted');
  } else console.log('old AIMS row not found (already gone?)');

  // 3. push the real $120 ingested invoice as a fresh proper draft
  const d = await prisma.document.findFirst({
    where: { organizationId: ORG, type: 'INVOICE', name: 'BIPL-JPSG-INV-20260521-0001' },
    select: { id: true, name: true, config: true },
  });
  const c: any = d!.config || {};
  const cust = c.customerId ? await prisma.customer.findUnique({ where: { id: c.customerId }, select: { name: true, xeroId: true } }) : null;
  const contact = cust?.xeroId ? { ContactID: cust.xeroId } : { Name: cust?.name || c.customerName || c.customer?.name };
  const di: any = c.documentInfo || {};
  const lines = (c.items || []).map((it: any) => {
    const qty = Number(it.quantity) || 0, unit = Number(it.unitPrice) || 0, amt = Number(it.amount) || 0;
    if (amt === 0 && unit === 0) return { Description: it.description || '' };
    const ok = qty > 0 && Math.abs(qty * unit - amt) < 0.01;
    return { Description: it.description || 'Jurong Port Pass Application', Quantity: ok ? qty : 1, UnitAmount: ok ? unit : amt, AccountCode: '443', TaxType: 'NONE' };
  });
  const res = await xero('POST', '/Invoices?SummarizeErrors=false', { Invoices: [{ Type: 'ACCREC', Contact: contact, InvoiceNumber: d!.name, Reference: `${d!.name} (JP Pass Application)`, Date: di.date || '2026-05-21', DueDate: di.dueDate || di.date || '2026-05-21', Status: 'DRAFT', LineAmountTypes: 'NoTax', LineItems: lines }] });
  const inv = res?.Invoices?.[0];
  if (inv?.HasErrors) { console.log(`x push: ${inv.ValidationErrors?.[0]?.Message}`); return; }
  await prisma.document.update({ where: { id: d!.id }, data: { config: { ...c, xeroInvoiceId: inv.InvoiceID, xeroStatus: 'DRAFT', xeroSyncedAt: new Date().toISOString(), xeroSyncedBy: 'jpsg-push' } } });
  console.log(`pushed fresh draft: total=${inv.Total} contact=${inv.Contact?.Name} ref="${inv.Reference}"`);
  await prisma.$disconnect();
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
