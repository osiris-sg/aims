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
  const accts = await xero('GET', '/Accounts');
  const acctIdByName = (n: string) => (accts.Accounts || []).find((a: any) => a.Name === n && a.Status === 'ACTIVE')?.AccountID;
  const PETTY: Record<string, string> = { '106': acctIdByName('Petty Cash - Dennis'), '106-2': acctIdByName('Petty Cash - Eve'), '103': acctIdByName('Petty Cash a/c') };
  const aimsPetty = new Map<string, string>();
  for (const code of ['103', '106', '106-2']) {
    const a = await prisma.chartOfAccount.findFirst({ where: { organizationId: ORG, code }, select: { id: true } });
    if (a) aimsPetty.set(a.id, code);
  }
  const bills = await prisma.document.findMany({ where: { organizationId: ORG, type: 'BILL', name: { startsWith: 'JP26' } }, select: { id: true, name: true, config: true } });
  const targets = bills.filter(b => { const c: any = b.config || {}; return /^(BIPL-JPSG-INV|JPINV-|BI\d)/.test(c.reference || '') && c.xeroBillId; });
  let fixed = 0, already = 0, failed = 0;
  for (const b of targets) {
    const c: any = b.config || {};
    try {
      const g = await xero('GET', `/Invoices/${c.xeroBillId}`);
      const inv = g.Invoices[0];
      await sleep(1100);
      if (!inv || ['VOIDED', 'DELETED', 'DRAFT'].includes(inv.Status)) { already++; continue; }
      const taxed = Number(inv.TotalTax || 0) > 0 || (inv.LineItems || []).some((l: any) => l.TaxType && l.TaxType !== 'NONE');
      if (!taxed && inv.LineAmountTypes === 'NoTax') { already++; continue; }
      const gross = Number(inv.Total);
      const pays: any[] = inv.Payments || [];
      // Guard: only delete payments that match our AIMS BillPayment record
      // (amount + date). A mismatch means someone (the accountant) changed the
      // payment after we applied it — her version wins; skip and flag.
      const bpChk = await prisma.billPayment.findFirst({ where: { organizationId: ORG, billId: b.id } });
      const foreign = pays.some(p => {
        if (!bpChk) return true;
        const pd = String(p.Date).includes('Date(') ? new Date(Number(String(p.Date).match(/\d+/)![0])).toISOString().slice(0, 10) : String(p.Date).slice(0, 10);
        return Math.abs(Number(p.Amount) - Number(bpChk.amount)) > 0.01 || pd !== bpChk.paymentDate.toISOString().slice(0, 10);
      });
      if (foreign) { console.log(`  ? ${b.name}: payment differs from AIMS record — skipped for manual review`); failed++; continue; }
      for (const p of pays) { await xero('POST', `/Payments/${p.PaymentID}`, { Status: 'DELETED' }); await sleep(1100); }
      const newLines = (inv.LineItems || []).map((l: any) =>
        Number(l.LineAmount) === 0 && Number(l.UnitAmount || 0) === 0
          ? { Description: l.Description }
          : { LineItemID: l.LineItemID, Description: l.Description, Quantity: 1, UnitAmount: inv.LineAmountTypes === 'Exclusive' ? Number(l.LineAmount) + Number(l.TaxAmount || 0) : Number(l.LineAmount), AccountCode: '443', TaxType: 'NONE' });
      const up = await xero('POST', `/Invoices/${inv.InvoiceID}`, { Invoices: [{ InvoiceID: inv.InvoiceID, LineAmountTypes: 'NoTax', LineItems: newLines }] });
      const u = up.Invoices[0];
      await sleep(1100);
      if (u.HasErrors) { failed++; console.log(`  x ${b.name}: ${u.ValidationErrors?.[0]?.Message}`); continue; }
      if (Math.abs(Number(u.Total) - gross) > 0.01) console.log(`  ! ${b.name}: total changed ${gross} → ${u.Total}`);
      if (pays.length) {
        const bp = await prisma.billPayment.findFirst({ where: { organizationId: ORG, billId: b.id } });
        if (bp) {
          const code = aimsPetty.get(bp.bankAccountId) || '106-2';
          await xero('PUT', '/Payments?SummarizeErrors=false', { Payments: [{ Invoice: { InvoiceID: inv.InvoiceID }, Account: { AccountID: PETTY[code] }, Date: bp.paymentDate.toISOString().slice(0, 10), Amount: Number(bp.amount) }] });
          await sleep(1100);
        }
      }
      await prisma.document.update({ where: { id: b.id }, data: { config: { ...c, amountsAre: 'NO_TAX', taxAmount: 0, subtotal: Number(c.totalAmount || 0) } } });
      fixed++;
    } catch (e: any) { failed++; console.log(`  x ${b.name}: ${e.message.slice(0, 120)}`); }
  }
  console.log(`NoTax pass: fixed=${fixed} already-notax=${already} failed=${failed}`);
  await prisma.$disconnect();
}
main().catch(e => { console.error('FATAL', e.message.slice(0, 300)); process.exit(1); });
