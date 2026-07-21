/**
 * Port the AIMS top-up layer to Xero via API (guru-approved).
 *
 * For every JV-AWX journal in dev AIMS:
 *   top-up      → BankTransfer  Customer Deposit-X → Airwallex (gross, settled date)
 *                 + SpendMoney  Airwallex → Airwallex Fees (fee, Reference AWX:<ftx>)
 *   failed fee  → SpendMoney    Airwallex → Airwallex Fees (0.50, Reference AWX:<ftx>)
 *   sweep       → BankTransfer  Airwallex → United Overseas Bank
 *
 * Accounts: reuses Xero's existing "Customer Deposit-Lam Hwa" / "-SKV" bank
 * accounts (accountant's naming); creates missing deposit bank accounts for
 * the other funded customers. Idempotent: transfers matched by
 * (date,amount,from,to); spend monies by Reference.
 */
import { createScriptPrisma, BIOFUEL_ORG_ID } from './xero-migration/_common';
import * as fs from 'fs';
const prisma = createScriptPrisma();
const XERO_API = 'https://api.xero.com/api.xro/2.0';
const SP = '/private/tmp/claude-501/-Users-guru-Documents-GitHub-aims/6e733d78-df86-4e60-8e0d-938d4a93fe47/scratchpad';
const R = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const DRY = process.argv.includes('--dry');

// AIMS full-name → Xero existing short-name bank accounts
const NAME_ALIAS: Record<string, string> = {
  'Customer Deposit-LAM HWA ENGINEERING & TRADING PTE LTD': 'Customer Deposit-Lam Hwa',
  'Customer Deposit-SKV CONSTRUCTION & TRANSPORT PTE LTD': 'Customer Deposit-SKV',
};

async function tokens() {
  const conn = await prisma.xeroConnection.findUnique({ where: { organizationId: BIOFUEL_ORG_ID } });
  if (!conn) throw new Error('no XeroConnection');
  if (conn.accessTokenExpiresAt.getTime() - Date.now() > 5 * 60 * 1000) return { at: conn.accessToken, tid: conn.tenantId };
  const envTxt = fs.readFileSync('.env', 'utf8');
  const cid = envTxt.match(/^XERO_CLIENT_ID="?([^"\n]+)"?/m)?.[1] || process.env.XERO_CLIENT_ID;
  const csec = envTxt.match(/^XERO_CLIENT_SECRET="?([^"\n]+)"?/m)?.[1] || process.env.XERO_CLIENT_SECRET;
  const basic = Buffer.from(`${cid}:${csec}`).toString('base64');
  const res = await fetch('https://identity.xero.com/connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refreshToken }) });
  if (!res.ok) throw new Error(`refresh ${res.status}: ${await res.text()}`);
  const t: any = await res.json();
  const upd = await prisma.xeroConnection.update({ where: { organizationId: BIOFUEL_ORG_ID }, data: { accessToken: t.access_token, refreshToken: t.refresh_token, accessTokenExpiresAt: new Date(Date.now() + t.expires_in * 1000), refreshTokenExpiresAt: new Date(Date.now() + 60 * 864e5) } });
  return { at: upd.accessToken, tid: upd.tenantId };
}
let TK: { at: string; tid: string };
async function xero(method: string, path: string, body?: any) {
  for (let i = 0; i < 6; i++) {
    let res: Response;
    try {
      res = await fetch(`${XERO_API}${path}`, { method, headers: { Authorization: `Bearer ${TK.at}`, 'Xero-Tenant-Id': TK.tid, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch { await sleep((i + 1) * 15000); continue; }
    if (res.status === 401) { TK = await tokens(); continue; }
    if (res.status === 429) { const w = parseInt(res.headers.get('Retry-After') || '60', 10); console.log(`  ⏸ 429 ${w}s`); await sleep(w * 1000); continue; }
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
    return json;
  }
  throw new Error(`gave up: ${path}`);
}

async function main() {
  TK = await tokens();
  console.log(DRY ? '=== DRY RUN ===' : '=== LIVE PORT ===');

  // ---- 1. Xero accounts inventory ----
  const acctRes = await xero('GET', '/Accounts');
  const xeroAccts = new Map<string, any>((acctRes.Accounts || []).map((a: any) => [a.Name, a]));
  const bankNums = new Set((acctRes.Accounts || []).filter((a: any) => a.BankAccountNumber).map((a: any) => a.BankAccountNumber));
  const airwallex = xeroAccts.get('Airwallex');
  const uob = [...xeroAccts.values()].find((a: any) => /united overseas/i.test(a.Name) && a.Type === 'BANK');
  const feesAcct = xeroAccts.get('Airwallex Fees');
  if (!airwallex || !uob) throw new Error(`missing Xero accounts: airwallex=${!!airwallex} uob=${!!uob}`);
  if (!feesAcct) throw new Error('Airwallex Fees account missing in Xero');
  console.log(`Xero: Airwallex=${airwallex.AccountID.slice(0, 8)} UOB=${uob.AccountID.slice(0, 8)} Fees=${feesAcct.AccountID.slice(0, 8)} (code ${feesAcct.Code || '-'})`);

  // ---- 2. AIMS funded deposit accounts → ensure Xero bank accounts ----
  const aimsDeps = await prisma.chartOfAccount.findMany({ where: { organizationId: BIOFUEL_ORG_ID, name: { startsWith: 'Customer Deposit-' } }, select: { id: true, name: true } });
  const funded: Array<{ aimsId: string; aimsName: string; xeroName: string }> = [];
  for (const d of aimsDeps) {
    const g = await prisma.journalEntryLine.aggregate({ where: { accountId: d.id, journalEntry: { organizationId: BIOFUEL_ORG_ID, status: 'POSTED' } }, _sum: { debit: true, credit: true } });
    if (Math.abs((g._sum.credit || 0) - (g._sum.debit || 0)) < 0.005 && !(g._sum.credit || 0)) continue;
    funded.push({ aimsId: d.id, aimsName: d.name, xeroName: (NAME_ALIAS[d.name] || d.name).trim() });
  }
  console.log(`funded deposit accounts to mirror: ${funded.length}`);
  let nextNum = 3;
  const xeroDepId = new Map<string, string>(); // aims name -> xero AccountID
  for (const f of funded) {
    let acct = xeroAccts.get(f.xeroName);
    if (!acct) {
      let num: string;
      do { num = String(nextNum++).padStart(8, '0'); } while (bankNums.has(num));
      if (DRY) { console.log(`  [dry] would create bank account "${f.xeroName}" (#${num})`); continue; }
      const created = await xero('PUT', '/Accounts', { Name: f.xeroName.slice(0, 150), Type: 'BANK', BankAccountNumber: num, BankAccountType: 'BANK', CurrencyCode: 'SGD' });
      acct = created.Accounts?.[0];
      bankNums.add(num);
      xeroAccts.set(f.xeroName, acct);
      console.log(`  + Xero bank account "${f.xeroName}" (#${num})`);
      await sleep(1100);
    }
    xeroDepId.set(f.aimsName, acct.AccountID);
  }

  // ---- 3. Existing Xero transfers & spend monies (idempotency) ----
  const existingTransfers = new Set<string>();
  const tr = await xero('GET', '/BankTransfers');
  for (const t of tr.BankTransfers || []) {
    const d = (t.Date || '').match(/\d+/)?.[0];
    const day = d ? new Date(+d).toISOString().slice(0, 10) : '';
    existingTransfers.add(`${day}|${R(+t.Amount)}|${t.FromBankAccount?.AccountID}|${t.ToBankAccount?.AccountID}`);
  }
  const existingSpendRefs = new Set<string>();
  for (let page = 1; ; page++) {
    const bt = await xero('GET', `/BankTransactions?where=${encodeURIComponent('Type=="SPEND"')}&page=${page}`);
    const list = bt.BankTransactions || [];
    for (const b of list) if (b.Reference?.startsWith('AWX:')) existingSpendRefs.add(b.Reference);
    if (list.length < 100) break;
    await sleep(1100);
  }
  console.log(`existing in Xero: transfers=${existingTransfers.size} AWX spend refs=${existingSpendRefs.size}`);

  // ---- 4. Replay AWX journals ----
  const txns: any[] = JSON.parse(fs.readFileSync(`${SP}/airwallex-txns.json`, 'utf8'));
  const mapping: Record<string, { customerName: string }> = JSON.parse(fs.readFileSync('scripts/airwallex-topup-mapping.json', 'utf8'));
  const settled = txns.filter(t => t.status === 'Settled');
  let transfers = 0, spends = 0, skipped = 0, failed = 0;
  const spendBatch: any[] = [];

  for (const t of settled) {
    const day = (t.settled || t.created).slice(0, 10);
    if (t.type === 'Payout') {
      const key = `${day}|${R(-t.net)}|${airwallex.AccountID}|${uob.AccountID}`;
      if (existingTransfers.has(key)) { skipped++; continue; }
      if (DRY) { console.log(`  [dry] transfer Airwallex→UOB ${R(-t.net)} ${day}`); continue; }
      await xero('PUT', '/BankTransfers', { BankTransfers: [{ FromBankAccount: { AccountID: airwallex.AccountID }, ToBankAccount: { AccountID: uob.AccountID }, Amount: R(-t.net), Date: day }] });
      transfers++;
      await sleep(1100);
    } else if (t.amount === 0) {
      if (existingSpendRefs.has(`AWX:${t.ftxId}`)) { skipped++; continue; }
      spendBatch.push({ ref: `AWX:${t.ftxId}`, date: day, amount: R(t.fee), desc: `Airwallex PayNow failed-attempt fee (${mapping[t.baseTopupId]?.customerName || 'unknown'})` });
    } else {
      const cust = mapping[t.baseTopupId]?.customerName;
      const aimsName = `Customer Deposit-${cust}`;
      const depId = xeroDepId.get(aimsName);
      if (!depId) { failed++; console.log(`  ✗ no Xero account for ${aimsName}`); continue; }
      const key = `${day}|${R(t.amount)}|${depId}|${airwallex.AccountID}`;
      if (!existingTransfers.has(key)) {
        if (DRY) console.log(`  [dry] transfer ${cust} → Airwallex ${R(t.amount)} ${day}`);
        else {
          await xero('PUT', '/BankTransfers', { BankTransfers: [{ FromBankAccount: { AccountID: depId }, ToBankAccount: { AccountID: airwallex.AccountID }, Amount: R(t.amount), Date: day }] });
          transfers++;
          await sleep(1100);
        }
      } else skipped++;
      if (t.fee > 0 && !existingSpendRefs.has(`AWX:${t.ftxId}`)) {
        spendBatch.push({ ref: `AWX:${t.ftxId}`, date: day, amount: R(t.fee), desc: `Airwallex PayNow fee (1% + $0.50) on $${t.amount.toFixed(2)} top-up — ${cust}` });
      }
    }
  }

  // fee spend monies in batches of 40
  for (let i = 0; i < spendBatch.length; i += 40) {
    const chunk = spendBatch.slice(i, i + 40);
    if (DRY) { console.log(`  [dry] ${chunk.length} spend monies`); continue; }
    const payload = {
      BankTransactions: chunk.map(s => ({
        Type: 'SPEND',
        Contact: { Name: 'Airwallex' },
        BankAccount: { AccountID: airwallex.AccountID },
        Date: s.date, Reference: s.ref, LineAmountTypes: 'NoTax',
        LineItems: [{ Description: s.desc, Quantity: 1, UnitAmount: s.amount, AccountCode: feesAcct.Code, TaxType: 'NONE' }],
      })),
    };
    const res = await xero('PUT', '/BankTransactions?SummarizeErrors=false', payload);
    for (const b of res.BankTransactions || []) {
      if (b.HasErrors) { failed++; console.log(`  ✗ spend ${b.Reference}: ${b.ValidationErrors?.[0]?.Message}`); }
      else spends++;
    }
    await sleep(1500);
  }
  console.log(`\nDONE: transfers=${transfers} spends=${spends} skipped(existing)=${skipped} failed=${failed}`);
}
main().catch(e => { console.error('FATAL', e?.message || e); process.exit(1); }).finally(() => prisma.$disconnect());
