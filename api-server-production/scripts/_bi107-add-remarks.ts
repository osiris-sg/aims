// Add the UOB remittance remark (from the client's deleted original) to the
// BI202607107 Xero draft as a description-only line.
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const INVOICE_ID = 'e9ab8c5e-e219-413a-b410-99d6783f8c6f';
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
  const res = await fetch(`${XERO_API}/Invoices/${INVOICE_ID}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TK.at}`, 'Xero-Tenant-Id': TK.tid, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Invoices: [{
        InvoiceID: INVOICE_ID,
        LineItems: [
          { Description: 'Advance payment for soil disposal services', Quantity: 1, UnitAmount: 100000, AccountCode: '662', TaxType: 'NONE' },
          { Description: 'REMARKS:\nKINDLY REMIT THE PAYMENT TO OUR UOB ACCOUNT.' },
        ],
      }],
    }),
  });
  const json: any = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  const inv = json.Invoices?.[0];
  console.log('updated:', JSON.stringify({ num: inv?.InvoiceNumber, status: inv?.Status, total: inv?.Total, lines: (inv?.LineItems || []).map((l: any) => ({ desc: (l.Description || '').slice(0, 40), acct: l.AccountCode })) }));
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
