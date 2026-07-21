/** Move the recharge ref into Xero's visible Reference box (= API
 *  InvoiceNumber on bills): "JPxxxx · BIPL-JPSG-INV-xxxx", and restore the
 *  original clean line descriptions. */
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
  if (!res.ok) throw new Error(`refresh ${res.status}`);
  const t: any = await res.json();
  const upd = await prisma.xeroConnection.update({ where: { organizationId: ORG }, data: { accessToken: t.access_token, refreshToken: t.refresh_token, accessTokenExpiresAt: new Date(Date.now() + t.expires_in * 1000), refreshTokenExpiresAt: new Date(Date.now() + 60 * 864e5) } });
  return { at: upd.accessToken, tid: upd.tenantId };
}
async function main() {
  const bills = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, name, config FROM "Document"
     WHERE "organizationId" = $1 AND type = 'BILL' AND name LIKE 'JP26%'
       AND config->>'reference' LIKE 'BIPL-JPSG-INV%' AND config->>'xeroBillId' IS NOT NULL`, ORG);
  console.log(`bills: ${bills.length}`);
  const tk = await tokens();
  let ok = 0, failed = 0;
  for (let i = 0; i < bills.length; i += 40) {
    const chunk = bills.slice(i, i + 40);
    const payload = {
      Invoices: chunk.map((b: any) => {
        const c = b.config;
        return {
          InvoiceID: c.xeroBillId,
          InvoiceNumber: `${b.name} · ${c.reference}`,
          LineItems: (c.lines || []).map((li: any) => ({
            Description: li.description, // original, clean
            Quantity: li.quantity || 1,
            UnitAmount: li.unitPrice ?? li.amount,
            AccountCode: '442',
            TaxType: 'NONE',
          })),
        };
      }),
    };
    const res = await fetch(`${XERO_API}/Invoices?SummarizeErrors=false`, { method: 'POST', headers: { Authorization: `Bearer ${tk.at}`, 'Xero-Tenant-Id': tk.tid, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) { failed += chunk.length; console.log(`  ✗ batch @${i}: ${res.status} ${JSON.stringify(body).slice(0, 150)}`); }
    else for (const inv of body.Invoices || []) { if (inv.HasErrors) { failed++; console.log(`  ✗ ${inv.InvoiceNumber}: ${inv.ValidationErrors?.[0]?.Message}`); } else ok++; }
    await sleep(1500);
  }
  console.log(`updated: ${ok} failed: ${failed}`);
}
main().catch(e => { console.error('FATAL', e?.message || e); process.exit(1); }).finally(() => prisma.$disconnect());
