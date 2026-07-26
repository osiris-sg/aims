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
  // Xero account ids for the petty cash accounts (Eve has no code)
  const accts = await xero('GET', '/Accounts');
  const acctId = (name: string) => (accts.Accounts || []).find((a: any) => a.Name === name && a.Status === 'ACTIVE')?.AccountID;
  const PETTY: Record<string, string> = { 'Petty Cash - Dennis': acctId('Petty Cash - Dennis'), 'Petty Cash - Eve': acctId('Petty Cash - Eve') };
  console.log('accounts:', JSON.stringify(PETTY));
  if (!PETTY['Petty Cash - Dennis'] || !PETTY['Petty Cash - Eve']) throw new Error('petty cash account missing in Xero');

  // AIMS payments to mirror
  const pays: any[] = await prisma.$queryRaw`
    SELECT bp.id AS pay_id, bp.amount, bp."paymentDate"::date AS pdate, bp.reference AS petty, d.id AS doc_id, d.name, d.config
    FROM "BillPayment" bp JOIN "Document" d ON d.id::text = bp."billId"
    WHERE bp."organizationId"=${ORG} AND bp."createdBy"='jp-pass-payment-script'`;
  const targets = pays.filter(p => p.config?.xeroBillId);
  console.log(`payments to mirror: ${targets.length} (of ${pays.length})`);

  // 1. approve drafts in batches
  const toApprove = targets.filter(p => p.config.xeroStatus === 'DRAFT');
  let approved = 0, aFailed = 0;
  for (let i = 0; i < toApprove.length; i += 40) {
    const chunk = toApprove.slice(i, i + 40);
    const res = await xero('POST', '/Invoices?SummarizeErrors=false', { Invoices: chunk.map(p => ({ InvoiceID: p.config.xeroBillId, Status: 'AUTHORISED' })) });
    for (const inv of res.Invoices || []) {
      if (inv.HasErrors) { aFailed++; console.log(`  x approve ${inv.InvoiceNumber}: ${inv.ValidationErrors?.[0]?.Message}`); } else approved++;
    }
    await sleep(1100);
  }
  console.log(`approved: ${approved} failed: ${aFailed} (already authorised: ${targets.length - toApprove.length})`);

  // 2. apply payments in batches
  let paid = 0, pFailed = 0;
  for (let i = 0; i < targets.length; i += 40) {
    const chunk = targets.slice(i, i + 40);
    const res = await xero('PUT', '/Payments?SummarizeErrors=false', {
      Payments: chunk.map(p => ({
        Invoice: { InvoiceID: p.config.xeroBillId },
        Account: { AccountID: PETTY[p.petty] || PETTY['Petty Cash - Dennis'] },
        Date: new Date(p.pdate).toISOString().slice(0, 10),
        Amount: Number(p.amount),
      })),
    });
    for (let j = 0; j < (res.Payments || []).length; j++) {
      const pay = res.Payments[j];
      if (pay.HasValidationErrors || pay.ValidationErrors?.length) {
        pFailed++; console.log(`  x pay ${chunk[j]?.name}: ${pay.ValidationErrors?.[0]?.Message}`);
        continue;
      }
      paid++;
      const p = chunk[j];
      await prisma.document.update({ where: { id: p.doc_id }, data: { config: { ...p.config, xeroStatus: 'PAID', xeroBalance: 0, xeroAmountPaid: Number(p.amount), xeroPaymentId: pay.PaymentID } } });
    }
    await sleep(1100);
  }
  console.log(`DONE payments applied: ${paid} failed: ${pFailed}`);
  await prisma.$disconnect();
}
main().catch(e => { console.error('FATAL', e.message.slice(0, 400)); process.exit(1); });
