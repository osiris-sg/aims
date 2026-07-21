/** Push all PROD JP bills to Xero as DRAFT ACCPAY bills (batched).
 *  Skips bills already in Xero (by invoice number) or already stamped.
 *  Stamps xeroBillId back so future syncs update instead of duplicate. */
import { PrismaClient, Prisma } from '@prisma/client';
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
  if (!conn) throw new Error('no prod XeroConnection');
  if (conn.accessTokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
    const envTxt = fs.readFileSync('.env.production', 'utf8');
    const cid = envTxt.match(/^XERO_CLIENT_ID="?([^"\n]+)"?/m)?.[1] || process.env.XERO_CLIENT_ID;
    const csec = envTxt.match(/^XERO_CLIENT_SECRET="?([^"\n]+)"?/m)?.[1] || process.env.XERO_CLIENT_SECRET;
    const basic = Buffer.from(`${cid}:${csec}`).toString('base64');
    const res = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refreshToken }),
    });
    if (!res.ok) throw new Error(`refresh failed ${res.status}: ${await res.text()}`);
    const t: any = await res.json();
    const upd = await prisma.xeroConnection.update({ where: { organizationId: ORG }, data: { accessToken: t.access_token, refreshToken: t.refresh_token, accessTokenExpiresAt: new Date(Date.now() + t.expires_in * 1000), refreshTokenExpiresAt: new Date(Date.now() + 60 * 864e5) } });
    return { at: upd.accessToken, tid: upd.tenantId };
  }
  return { at: conn.accessToken, tid: conn.tenantId };
}
async function xero(tk: any, method: string, path: string, body?: any) {
  for (let i = 0; i < 5; i++) {
    let res: Response;
    try {
      res = await fetch(`${XERO_API}${path}`, { method, headers: { Authorization: `Bearer ${tk.at}`, 'Xero-Tenant-Id': tk.tid, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch { await sleep((i + 1) * 15000); continue; }
    if (res.status === 429) { const w = parseInt(res.headers.get('Retry-After') || '60', 10); console.log(`  ⏸ 429 wait ${w}s`); await sleep(w * 1000); continue; }
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    return json;
  }
  throw new Error('gave up');
}
async function main() {
  const tk = await tokens();
  // 0) existing JP bill numbers in Xero
  const inXero = new Set<string>();
  for (let page = 1; ; page++) {
    const r = await xero(tk, 'GET', `/Invoices?where=${encodeURIComponent('Type=="ACCPAY"')}&page=${page}&summaryOnly=true`);
    const invs: any[] = r.Invoices || [];
    for (const i of invs) {
      const num = (i.InvoiceNumber || '').trim();
      if (num.startsWith('JP26') && !['DELETED', 'VOIDED'].includes(i.Status)) inXero.add(num);
    }
    if (invs.length < 100) break;
    await sleep(1200);
  }
  console.log(`already in Xero: ${inXero.size} JP bills (${[...inXero].slice(0, 6).join(', ')}...)`);

  // 1) contact
  const found = await xero(tk, 'GET', `/Contacts?where=${encodeURIComponent('Name="Jurong Port Pte Ltd"')}`);
  const contactID = found.Contacts?.[0]?.ContactID;
  if (!contactID) throw new Error('Jurong Port contact not found in Xero');
  console.log('contact:', contactID);

  // 2) candidates
  const bills = await prisma.document.findMany({ where: { organizationId: ORG, type: 'BILL', name: { startsWith: 'JP26' } }, select: { id: true, name: true, config: true } });
  const todo = bills.filter(b => { const c: any = b.config || {}; return !c.xeroBillId && !inXero.has(b.name!); });
  console.log(`AIMS JP bills: ${bills.length}  to push: ${todo.length}  skipped(existing): ${bills.length - todo.length}`);

  // 3) batched push (40 per call)
  let pushed = 0, failed = 0;
  for (let i = 0; i < todo.length; i += 40) {
    const chunk = todo.slice(i, i + 40);
    const payload = {
      Invoices: chunk.map(b => {
        const c: any = b.config || {};
        const l = (c.lines || [])[0] || {};
        return {
          Type: 'ACCPAY', Contact: { ContactID: contactID },
          Date: c.billDate, DueDate: c.dueDate || c.billDate,
          InvoiceNumber: b.name, Reference: 'JP Pass application',
          Status: 'DRAFT', LineAmountTypes: 'NoTax',
          LineItems: (c.lines || []).map((li: any) => ({ Description: li.description, Quantity: li.quantity || 1, UnitAmount: li.unitPrice ?? li.amount, AccountCode: '442', TaxType: 'NONE' })),
        };
      }),
    };
    try {
      const res = await xero(tk, 'POST', '/Invoices?SummarizeErrors=false', payload);
      for (const inv of res.Invoices || []) {
        const b = chunk.find(x => x.name === (inv.InvoiceNumber || '').trim());
        if (!b) continue;
        if (inv.HasErrors) { failed++; console.log(`  ✗ ${inv.InvoiceNumber}: ${inv.ValidationErrors?.map((v: any) => v.Message).join('; ').slice(0, 120)}`); continue; }
        const c: any = b.config || {};
        await prisma.document.update({ where: { id: b.id }, data: { config: { ...c, xeroBillId: inv.InvoiceID, xeroStatus: 'DRAFT', xeroSyncedAt: new Date().toISOString(), xeroSyncedBy: 'jp-batch-push' } as unknown as Prisma.InputJsonValue } });
        pushed++;
      }
      console.log(`  batch ${Math.floor(i / 40) + 1}: pushed=${pushed} failed=${failed}`);
    } catch (e: any) {
      console.log(`  ✗ batch @${i}: ${(e?.message || '').slice(0, 200)}`);
      failed += chunk.length;
    }
    await sleep(1500);
  }
  console.log(`\nDONE: pushed=${pushed} failed=${failed} skipped=${bills.length - todo.length}`);
}
main().catch(e => { console.error('FATAL', e?.message || e); process.exit(1); }).finally(() => prisma.$disconnect());
