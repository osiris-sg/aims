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
  const g = await xero('GET', `/Invoices?where=${encodeURIComponent('InvoiceNumber=="BIPL-JPSG-INV-20260708-0089"')}`);
  const i89 = g.Invoices[0];
  console.log(`fetched: ${i89.Status} $${i89.Total} lines acct=${i89.LineItems?.[0]?.AccountCode} payments=${(i89.Payments || []).length}`);
  await sleep(1100);
  const pay89: any[] = [];
  for (const p of i89.Payments || []) {
    try {
      const pg = await xero('GET', `/Payments/${p.PaymentID}`);
      pay89.push(pg.Payments[0]);
      console.log(`payment detail ok: $${pg.Payments[0].Amount} acct=${pg.Payments[0].Account?.Name}`);
    } catch (e: any) { console.log(`payment GET failed (${e.message.slice(0, 40)}) — using summary`); pay89.push(p); }
    await sleep(1100);
    await xero('POST', `/Payments/${p.PaymentID}`, { Status: 'DELETED' });
    console.log('payment deleted');
    await sleep(1100);
  }
  const l89 = (i89.LineItems || []).map((l: any) =>
    Number(l.LineAmount) > 0 ? { LineItemID: l.LineItemID, Description: l.Description, Quantity: l.Quantity, UnitAmount: l.UnitAmount, AccountCode: '443', TaxType: l.TaxType } : { Description: l.Description });
  const up = await xero('POST', `/Invoices/${i89.InvoiceID}`, { Invoices: [{ InvoiceID: i89.InvoiceID, LineItems: l89 }] });
  console.log(up.Invoices[0].HasErrors ? `edit ERR: ${up.Invoices[0].ValidationErrors?.[0]?.Message}` : 'line → 443 ✓');
  await sleep(1100);
  for (const p of pay89) {
    const acctId = p.Account?.AccountID;
    const date = typeof p.Date === 'string' && p.Date.includes('Date(') ? new Date(Number(p.Date.match(/\d+/)[0])).toISOString().slice(0, 10) : String(p.Date).slice(0, 10);
    const pr = await xero('PUT', '/Payments?SummarizeErrors=false', { Payments: [{ Invoice: { InvoiceID: i89.InvoiceID }, Account: { AccountID: acctId }, Date: date, Amount: Number(p.Amount) }] });
    const r = pr.Payments?.[0];
    console.log(r?.ValidationErrors?.length ? `re-pay ERR: ${r.ValidationErrors[0].Message}` : `payment re-applied $${p.Amount} → ${p.Account?.Name || acctId}`);
    await sleep(1100);
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error('FATAL', e.message.slice(0, 400)); process.exit(1); });
