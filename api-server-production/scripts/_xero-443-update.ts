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
  const bills = await prisma.document.findMany({ where: { organizationId: ORG, type: 'BILL', name: { startsWith: 'JP26' } }, select: { id: true, name: true, config: true } });
  const external = bills.filter(b => ((b.config as any)?.reference || '').startsWith('BIPL-JPSG'));
  const linked = external.filter(b => (b.config as any)?.xeroBillId);
  const unpushed = bills.filter(b => !(b.config as any)?.xeroBillId);
  console.log(`external=${external.length} (linked=${linked.length}) unpushed=${unpushed.length}`);

  // 1) update linked external drafts → 443
  let updated = 0, failed = 0;
  for (let i = 0; i < linked.length; i += 40) {
    const chunk = linked.slice(i, i + 40);
    const payload = {
      Invoices: chunk.map(b => {
        const c: any = b.config;
        return {
          InvoiceID: c.xeroBillId,
          LineItems: (c.lines || []).map((li: any) => ({ Description: li.description, Quantity: li.quantity || 1, UnitAmount: li.unitPrice ?? li.amount, AccountCode: '443', TaxType: 'NONE' })),
        };
      }),
    };
    const res = await xero('POST', '/Invoices?SummarizeErrors=false', payload);
    for (const inv of res.Invoices || []) { if (inv.HasErrors) { failed++; console.log(`  ✗ ${inv.InvoiceNumber}: ${inv.ValidationErrors?.[0]?.Message}`); } else updated++; }
    await sleep(1500);
  }
  console.log(`Xero drafts moved to 443: ${updated} failed: ${failed}`);

  // 2) push the unpushed bills (443 if ref'd else 442)
  const contact = await xero('GET', `/Contacts?where=${encodeURIComponent('Name="Jurong Port Pte Ltd"')}`);
  const contactID = contact.Contacts?.[0]?.ContactID;
  let pushed = 0, pfailed = 0;
  for (let i = 0; i < unpushed.length; i += 40) {
    const chunk = unpushed.slice(i, i + 40);
    const payload = {
      Invoices: chunk.map(b => {
        const c: any = b.config;
        const code = (c.reference || '').startsWith('BIPL-JPSG') ? '443' : '442';
        return {
          Type: 'ACCPAY', Contact: { ContactID: contactID },
          Date: c.billDate, DueDate: c.dueDate || c.billDate,
          InvoiceNumber: c.reference?.startsWith('BIPL-JPSG') ? `${b.name} · ${c.reference}` : b.name,
          Status: 'DRAFT', LineAmountTypes: 'NoTax',
          LineItems: (c.lines || []).map((li: any) => ({ Description: li.description, Quantity: li.quantity || 1, UnitAmount: li.unitPrice ?? li.amount, AccountCode: code, TaxType: 'NONE' })),
        };
      }),
    };
    const res = await xero('PUT', '/Invoices?SummarizeErrors=false', payload);
    for (const inv of res.Invoices || []) {
      const b = chunk.find(x => (inv.InvoiceNumber || '').startsWith(x.name!));
      if (inv.HasErrors) { pfailed++; console.log(`  ✗ ${inv.InvoiceNumber}: ${inv.ValidationErrors?.[0]?.Message}`); continue; }
      if (b) {
        const c: any = b.config;
        await prisma.document.update({ where: { id: b.id }, data: { config: { ...c, xeroBillId: inv.InvoiceID, xeroStatus: 'DRAFT', xeroSyncedAt: new Date().toISOString(), xeroSyncedBy: 'jp-443-push' } as any } });
      }
      pushed++;
    }
    await sleep(1500);
  }
  console.log(`new bills pushed: ${pushed} failed: ${pfailed}`);
}
main().catch(e => { console.error('FATAL', e?.message || e); process.exit(1); }).finally(() => prisma.$disconnect());
