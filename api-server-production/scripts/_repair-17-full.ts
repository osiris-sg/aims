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
const NAMES = 'JP2606240089 JP2605120049 JP2605300021 JP2604300060 JP2605010015 JP2605010020 JP2605010016 JP2605040079 JP2605040088 JP2605050025 JP2605050022 JP2605050027 JP2605050023 JP2605110122 JP2605120037 JP2605120060 JP2605140022'.split(' ');
async function main() {
  TK = await tokens();
  const accts = await xero('GET', '/Accounts');
  const acctIdByName = (n: string) => (accts.Accounts || []).find((a: any) => a.Name === n && a.Status === 'ACTIVE')?.AccountID;
  const PETTY: Record<string, string> = { '106': acctIdByName('Petty Cash - Dennis'), '106-2': acctIdByName('Petty Cash - Eve'), '103': acctIdByName('Petty Cash a/c') };
  const aimsPetty = new Map<string, string>();
  for (const code of ['103', '106', '106-2']) {
    const a = await prisma.chartOfAccount.findFirst({ where: { organizationId: ORG, code }, select: { id: true } });
    if (a) aimsPetty.set(a.id, code);
  }
  let ok = 0, failed = 0;
  for (const name of NAMES) {
    const b = await prisma.document.findFirst({ where: { organizationId: ORG, type: 'BILL', name }, select: { id: true, config: true } });
    const c: any = b!.config || {};
    const truth = Number(c.totalAmount);
    try {
      const g = await xero('GET', `/Invoices/${c.xeroBillId}`);
      const inv = g.Invoices[0];
      await sleep(1100);
      if (Math.abs(Number(inv.Total) - truth) < 0.005) { ok++; continue; }
      for (const p of inv.Payments || []) { await xero('POST', `/Payments/${p.PaymentID}`, { Status: 'DELETED' }); await sleep(1100); }
      const lines = (inv.LineItems || []).map((l: any) =>
        Number(l.LineAmount) > 0
          ? { LineItemID: l.LineItemID, Description: l.Description, Quantity: 1.0, UnitAmount: truth, AccountCode: l.AccountCode || '443', TaxType: 'NONE' }
          : { Description: l.Description });
      const up = await xero('POST', `/Invoices/${inv.InvoiceID}`, { Invoices: [{ InvoiceID: inv.InvoiceID, LineAmountTypes: 'NoTax', LineItems: lines }] });
      const u = up.Invoices[0];
      await sleep(1100);
      if (u.HasErrors) { failed++; console.log(`x ${name}: ${u.ValidationErrors?.[0]?.Message}`); continue; }
      const bp = await prisma.billPayment.findFirst({ where: { organizationId: ORG, billId: b!.id } });
      if (bp) {
        const code = aimsPetty.get(bp.bankAccountId) || '106-2';
        await xero('PUT', '/Payments?SummarizeErrors=false', { Payments: [{ Invoice: { InvoiceID: inv.InvoiceID }, Account: { AccountID: PETTY[code] }, Date: bp.paymentDate.toISOString().slice(0, 10), Amount: Number(bp.amount) }] });
        await sleep(1100);
      }
      console.log(`ok ${name}: ${inv.Total} → ${u.Total}, payment re-applied`);
      ok++;
    } catch (e: any) { failed++; console.log(`x ${name}: ${e.message.slice(0, 100)}`); }
  }
  console.log(`repair: ok=${ok} failed=${failed}`);
  await prisma.$disconnect();
}
main().catch(e => { console.error('FATAL', e.message.slice(0, 300)); process.exit(1); });
