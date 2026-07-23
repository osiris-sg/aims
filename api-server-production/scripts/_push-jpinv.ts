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
  const docs = await prisma.document.findMany({
    where: { organizationId: ORG, type: 'INVOICE', name: { startsWith: 'JPINV-' } },
    select: { id: true, name: true, config: true },
  });
  const svc = await prisma.revenueItem.findFirst({ where: { organizationId: ORG, accountCode: '443', isActive: true }, select: { code: true } });
  for (const d of docs) {
    const c: any = d.config || {};
    if (c.xeroInvoiceId) { console.log(`= ${d.name} already synced`); continue; }
    // normalize: 443 + SV025 on priced lines, no GST
    const items = (c.items || []).map((it: any) =>
      Number(it.amount) > 0 ? { ...it, accountCode: '443', ...(svc?.code ? { itemCode: svc.code, isService: true } : {}) } : it,
    );
    const cust = c.customerId ? await prisma.customer.findUnique({ where: { id: c.customerId }, select: { name: true, xeroId: true } }) : null;
    const contact = cust?.xeroId ? { ContactID: cust.xeroId } : { Name: cust?.name || c.customerName || c.customer?.name };
    const di: any = c.documentInfo || {};
    const date = di.date || d.name.match(/JPINV-(\d{4})(\d{2})(\d{2})/)?.slice(1).join('-') || '2026-05-01';
    const lines = (c.items || []).map((it: any) => {
      const qty = Number(it.quantity) || 0, unit = Number(it.unitPrice) || 0, amt = Number(it.amount) || 0;
      if (amt === 0 && unit === 0) return { Description: it.description || '' };
      const ok = qty > 0 && Math.abs(qty * unit - amt) < 0.01;
      return { Description: it.description || 'Jurong Port Pass Application', Quantity: ok ? qty : 1, UnitAmount: ok ? unit : amt, AccountCode: '443', TaxType: 'NONE' };
    });
    const res = await xero('POST', '/Invoices?SummarizeErrors=false', { Invoices: [{ Type: 'ACCREC', Contact: contact, InvoiceNumber: d.name, Reference: `${d.name} (JP Pass Application)`, Date: date, DueDate: date, Status: 'DRAFT', LineAmountTypes: 'NoTax', LineItems: lines }] });
    const inv = res?.Invoices?.[0];
    if (inv?.HasErrors) { console.log(`x ${d.name}: ${inv.ValidationErrors?.[0]?.Message}`); continue; }
    await prisma.document.update({
      where: { id: d.id },
      data: { config: { ...c, items, gstAmount: 0, subTotal: Number(c.nettTotal ?? c.totals?.total ?? 0), documentInfo: { ...di, taxCode: null, taxApplicable: 'N', gstPercent: 0, reference: `${d.name} (JP Pass Application)`, referenceNo: `${d.name} (JP Pass Application)` }, xeroInvoiceId: inv.InvoiceID, xeroStatus: 'DRAFT', xeroSyncedAt: new Date().toISOString(), xeroSyncedBy: 'jpsg-push' } },
    });
    console.log(`ok ${d.name}: pushed $${inv.Total} → ${inv.Contact?.Name}`);
    await sleep(1100);
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
