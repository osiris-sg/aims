// Push BI202607107 to Biofuel's Xero as an ACCREC DRAFT, mirroring the
// deleted invoice the client had made there (line account 821, TaxType NONE),
// then stamp xeroInvoiceId back on the AIMS doc.
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const APPLY = process.argv.includes('--apply');
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const DOC_ID = 'b6af81e9-283d-4530-9ce2-3e0cc1fc878e';
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
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
    return json;
  };

  const a821: any = await x('GET', `/Accounts?where=${encodeURIComponent('Code=="821"')}`);
  console.log('Xero 821:', (a821.Accounts || []).map((a: any) => `${a.Code} ${a.Name} [${a.Type}/${a.TaxType}]`).join() || 'NOT FOUND');
  if (!(a821.Accounts || []).length) throw new Error('821 missing in Xero');

  const doc = await prisma.document.findUnique({ where: { id: DOC_ID }, select: { name: true, config: true } });
  const c: any = doc!.config;
  const payload = {
    Invoices: [{
      Type: 'ACCREC',
      Contact: { ContactID: '24837310-fa81-4673-9ccc-c5c469ca9fdd' },
      Date: c.date,
      DueDate: c.dueDate || c.date,
      InvoiceNumber: doc!.name,
      Status: 'DRAFT',
      LineAmountTypes: 'Exclusive',
      LineItems: [{
        Description: c.items[0].description,
        Quantity: 1,
        UnitAmount: 100000,
        AccountCode: '821',
        TaxType: 'NONE',
      }],
    }],
  };
  console.log('payload:', JSON.stringify(payload));
  if (!APPLY) { console.log('dry-run — pass --apply'); return; }
  const res: any = await x('PUT', '/Invoices', payload);
  const inv = res.Invoices?.[0];
  console.log('CREATED:', JSON.stringify({ id: inv?.InvoiceID, num: inv?.InvoiceNumber, status: inv?.Status, total: inv?.Total }));
  await prisma.document.update({
    where: { id: DOC_ID },
    data: { config: { ...c, xeroInvoiceId: inv?.InvoiceID, xeroStatus: String(inv?.Status || 'DRAFT'), xeroSyncedAt: new Date().toISOString(), xeroSyncedBy: 'claude-script' } as any },
  });
  console.log('stamped xeroInvoiceId on AIMS doc');
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
