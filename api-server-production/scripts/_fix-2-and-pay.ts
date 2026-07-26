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
  const accts = await xero('GET', '/Accounts');
  const eveId = (accts.Accounts || []).find((a: any) => a.Name === 'Petty Cash - Eve')?.AccountID;
  const denId = (accts.Accounts || []).find((a: any) => a.Name === 'Petty Cash - Dennis')?.AccountID;
  for (const name of ['JP2604300061', 'JP2604290118']) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type: 'BILL', name }, select: { id: true, config: true } });
    const c: any = d!.config || {};
    const total = Number(c.totalAmount);
    const g = await xero('GET', `/Invoices/${c.xeroBillId}`);
    const inv = g.Invoices[0];
    const lines: any[] = inv.LineItems || [];
    // put the full corrected amount on the first priced line
    const newLines = lines.map((l: any, i: number) =>
      i === 0
        ? { LineItemID: l.LineItemID, Description: l.Description, Quantity: 1, UnitAmount: total, AccountCode: l.AccountCode, TaxType: l.TaxType }
        : Number(l.LineAmount) > 0
          ? { LineItemID: l.LineItemID, Description: l.Description, Quantity: 0, UnitAmount: 0, AccountCode: l.AccountCode, TaxType: l.TaxType }
          : { Description: l.Description },
    );
    await sleep(1100);
    const up = await xero('POST', `/Invoices/${c.xeroBillId}`, { Invoices: [{ InvoiceID: c.xeroBillId, LineItems: newLines }] });
    const u = up.Invoices[0];
    if (u.HasErrors) { console.log(`x ${name} amount fix: ${u.ValidationErrors?.[0]?.Message}`); continue; }
    console.log(`${name}: Xero total corrected ${inv.Total} -> ${u.Total}`);
    await sleep(1100);
    const pay: any[] = await prisma.$queryRaw`
      SELECT bp.amount, bp."paymentDate"::date AS pdate, bp.reference AS petty
      FROM "BillPayment" bp WHERE bp."organizationId"=${ORG} AND bp."billId"=${d!.id} LIMIT 1`;
    const p = pay[0];
    const res = await xero('PUT', '/Payments?SummarizeErrors=false', { Payments: [{ Invoice: { InvoiceID: c.xeroBillId }, Account: { AccountID: p.petty === 'Petty Cash - Eve' ? eveId : denId }, Date: new Date(p.pdate).toISOString().slice(0, 10), Amount: Number(p.amount) }] });
    const r = (res.Payments || [])[0];
    if (r?.ValidationErrors?.length) { console.log(`x ${name} pay: ${r.ValidationErrors[0].Message}`); continue; }
    await prisma.document.update({ where: { id: d!.id }, data: { config: { ...c, xeroStatus: 'PAID', xeroBalance: 0, xeroAmountPaid: Number(p.amount), xeroPaymentId: r.PaymentID } } });
    console.log(`${name}: paid $${p.amount} from ${p.petty} on ${new Date(p.pdate).toISOString().slice(0, 10)}`);
    await sleep(1100);
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error('FATAL', e.message.slice(0, 300)); process.exit(1); });
