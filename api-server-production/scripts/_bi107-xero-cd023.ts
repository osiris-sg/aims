// Create CD023 in Biofuel's Xero (CURRENT asset — BANK-type deposit accounts
// can't be used on invoice lines) and repoint draft BI202607107's line from
// 821 Unearned Revenue to CD023.
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const APPLY = process.argv.includes('--apply');
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const INVOICE_ID = 'e9ab8c5e-e219-413a-b410-99d6783f8c6f';
const NAME = 'Customer Deposit-Sin Hua Civil Engineering & Construction Pte Ltd';
const XERO_API = 'https://api.xero.com/api.xro/2.0';
const m = fs.readFileSync('.env.production', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);
async function tokens() {
  const conn = await prisma.xeroConnection.findUnique({ where: { organizationId: ORG } });
  if (!conn) throw new Error('no conn');
  if (conn.accessTokenExpiresAt.getTime() - Date.now() > 5 * 60 * 1000) return { at: conn.accessToken, tid: conn.tenantId };
  const envTxt = fs.readFileSync('.env.production', 'utf8');
  const basic = Buffer.from(`${envTxt.match(/^XERO_CLIENT_ID="?([^"\n]+)"?/m)?.[1]}:${envTxt.match(/^XERO_CLIENT_SECRET="?([^"\n]+)"?/m)?.[1]}`).toString('base64');
  const res = await fetch('https://identity.xero.com/connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refreshToken }) });
  if (!res.ok) throw new Error(`refresh ${res.status}`);
  const t: any = await res.json();
  const upd = await prisma.xeroConnection.update({ where: { organizationId: ORG }, data: { accessToken: t.access_token, refreshToken: t.refresh_token, accessTokenExpiresAt: new Date(Date.now() + t.expires_in * 1000), refreshTokenExpiresAt: new Date(Date.now() + 60 * 864e5) } });
  return { at: upd.accessToken, tid: upd.tenantId };
}
async function main() {
  const TK = await tokens();
  const x = async (method: string, p: string, body?: any) => {
    const res = await fetch(`${XERO_API}${p}`, { method, headers: { Authorization: `Bearer ${TK.at}`, 'Xero-Tenant-Id': TK.tid, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
    return json;
  };

  const existing: any = await x('GET', `/Accounts?where=${encodeURIComponent('Code=="CD023"')}`);
  let acct = existing.Accounts?.[0];
  console.log('Xero CD023:', acct ? `${acct.Code} ${acct.Name} [${acct.Type}]` : 'none yet');
  if (!APPLY) { console.log('dry-run — would create CD023 (CURRENT/NONE) + repoint invoice line'); return; }

  if (!acct) {
    const created: any = await x('PUT', '/Accounts', { Code: 'CD023', Name: NAME, Type: 'CURRENT', TaxType: 'NONE', Description: 'Customer deposit — Sin Hua (created from AIMS)' });
    acct = created.Accounts?.[0];
    console.log('CREATED Xero account:', JSON.stringify({ id: acct?.AccountID, code: acct?.Code, type: acct?.Type }));
    // Stamp xeroId on the AIMS prod CoA row for pull-sync consistency.
    await prisma.chartOfAccount.updateMany({ where: { organizationId: ORG, code: 'CD023' }, data: { xeroId: acct?.AccountID, xeroLastSyncAt: new Date() } });
    console.log('stamped xeroId on AIMS CD023');
  }

  const upd: any = await x('POST', `/Invoices/${INVOICE_ID}`, {
    Invoices: [{ InvoiceID: INVOICE_ID, LineItems: [{ Description: 'Advance payment for soil disposal services', Quantity: 1, UnitAmount: 100000, AccountCode: 'CD023', TaxType: 'NONE' }] }],
  });
  const inv = upd.Invoices?.[0];
  console.log('invoice updated:', JSON.stringify({ num: inv?.InvoiceNumber, status: inv?.Status, total: inv?.Total, line: inv?.LineItems?.[0]?.AccountCode }));
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
