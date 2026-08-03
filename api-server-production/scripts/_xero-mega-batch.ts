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
  const acctIdByName = (name: string) => (accts.Accounts || []).find((a: any) => a.Name === name && a.Status === 'ACTIVE')?.AccountID;
  const PETTY: Record<string, string> = {
    '106': acctIdByName('Petty Cash - Dennis'),
    '106-2': acctIdByName('Petty Cash - Eve'),
    '103': acctIdByName('Petty Cash a/c'),
  };
  const aimsPetty = new Map<string, string>(); // AIMS CoA id -> code
  for (const code of ['103', '106', '106-2']) {
    const a = await prisma.chartOfAccount.findFirst({ where: { organizationId: ORG, code }, select: { id: true } });
    if (a) aimsPetty.set(a.id, code);
  }

  const bills = await prisma.document.findMany({ where: { organizationId: ORG, type: 'BILL', name: { startsWith: 'JP26' } }, select: { id: true, name: true, config: true } });
  const targets = bills.filter(b => { const c: any = b.config || {}; return /^(BIPL-JPSG-INV|JPINV-|BI\d)/.test(c.reference || '') && c.xeroBillId; });
  console.log(`ref'd bills with xero link: ${targets.length}`);
  let edited = 0, approved = 0, repaid = 0, skippedOk = 0, failed = 0;

  for (const b of targets) {
    const c: any = b.config || {};
    const ref: string = c.reference;
    try {
      const g = await xero('GET', `/Invoices/${c.xeroBillId}`);
      const inv = g.Invoices[0];
      await sleep(1100);
      if (!inv || ['VOIDED', 'DELETED'].includes(inv.Status)) { skippedOk++; continue; }
      const wantNumber = `${b.name} · ${ref}`;
      const on443 = (inv.LineItems || []).every((l: any) => Number(l.LineAmount) === 0 || l.AccountCode === '443');
      const numberOk = inv.InvoiceNumber === wantNumber;
      const isDraft = inv.Status === 'DRAFT';
      if (on443 && numberOk && !isDraft) { skippedOk++; continue; }

      // 1. remove payments if we must edit lines on a paid bill
      const pays: any[] = inv.Payments || [];
      const mustEditLines = !on443;
      if (mustEditLines) {
        for (const p of pays) {
          await xero('POST', `/Payments/${p.PaymentID}`, { Status: 'DELETED' });
          await sleep(1100);
        }
      }
      // 2. edit lines + number (+ approve if draft)
      const newLines = (inv.LineItems || []).map((l: any) =>
        Number(l.LineAmount) === 0 && Number(l.UnitAmount || 0) === 0
          ? { Description: l.Description }
          : { LineItemID: l.LineItemID, Description: l.Description, Quantity: l.Quantity, UnitAmount: l.UnitAmount, AccountCode: '443', TaxType: l.TaxType },
      );
      const payload: any = { InvoiceID: inv.InvoiceID, InvoiceNumber: wantNumber, LineItems: newLines };
      if (isDraft) payload.Status = 'AUTHORISED';
      const up = await xero('POST', `/Invoices/${inv.InvoiceID}`, { Invoices: [payload] });
      const u = up.Invoices[0];
      await sleep(1100);
      if (u.HasErrors) { failed++; console.log(`  x ${b.name}: ${u.ValidationErrors?.[0]?.Message}`); continue; }
      edited++;
      if (isDraft) approved++;
      // 3. re-apply payment from AIMS BillPayment if we removed one (or bill was just approved and has an AIMS payment)
      if (mustEditLines && pays.length) {
        const bp = await prisma.billPayment.findFirst({ where: { organizationId: ORG, billId: b.id } });
        if (bp) {
          const code = aimsPetty.get(bp.bankAccountId) || '106-2';
          await xero('PUT', '/Payments?SummarizeErrors=false', { Payments: [{ Invoice: { InvoiceID: inv.InvoiceID }, Account: { AccountID: PETTY[code] }, Date: bp.paymentDate.toISOString().slice(0, 10), Amount: Number(bp.amount) }] });
          repaid++;
          await sleep(1100);
        }
      }
    } catch (e: any) { failed++; console.log(`  x ${b.name}: ${e.message.slice(0, 140)}`); }
  }
  console.log(`bills: edited=${edited} (approved ${approved} drafts) repaid=${repaid} already-ok=${skippedOk} failed=${failed}`);

  // ── invoice 0708-0089: move credit 105 Contra → 443 ──
  const d89 = await prisma.document.findFirst({ where: { organizationId: ORG, type: 'INVOICE', name: 'BIPL-JPSG-INV-20260708-0089' }, select: { config: true } });
  const c89: any = d89!.config || {};
  const g89 = await xero('GET', `/Invoices/${c89.xeroInvoiceId}`);
  const i89 = g89.Invoices[0];
  await sleep(1100);
  const pay89: any[] = [];
  for (const p of i89.Payments || []) {
    const pg = await xero('GET', `/Payments/${p.PaymentID}`);
    pay89.push(pg.Payments[0]);
    await sleep(1100);
    await xero('POST', `/Payments/${p.PaymentID}`, { Status: 'DELETED' });
    await sleep(1100);
  }
  const l89 = (i89.LineItems || []).map((l: any) =>
    Number(l.LineAmount) > 0 ? { LineItemID: l.LineItemID, Description: l.Description, Quantity: l.Quantity, UnitAmount: l.UnitAmount, AccountCode: '443', TaxType: l.TaxType } : { Description: l.Description });
  const up89 = await xero('POST', `/Invoices/${i89.InvoiceID}`, { Invoices: [{ InvoiceID: i89.InvoiceID, LineItems: l89 }] });
  console.log(up89.Invoices[0].HasErrors ? `x 0089 edit: ${up89.Invoices[0].ValidationErrors?.[0]?.Message}` : '0089 line → 443 ✓');
  await sleep(1100);
  for (const p of pay89) {
    await xero('PUT', '/Payments?SummarizeErrors=false', { Payments: [{ Invoice: { InvoiceID: i89.InvoiceID }, Account: { AccountID: p.Account?.AccountID }, Date: (p.Date.match(/\d+/) ? new Date(Number(p.Date.match(/\d+/)[0])).toISOString().slice(0, 10) : p.Date), Amount: Number(p.Amount) }] });
    console.log(`0089 payment re-applied ($${p.Amount} → ${p.Account?.Name || p.Account?.AccountID})`);
    await sleep(1100);
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error('FATAL', e.message.slice(0, 400)); process.exit(1); });
