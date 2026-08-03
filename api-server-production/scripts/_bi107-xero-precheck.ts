import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
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
  const doc = await prisma.document.findUnique({ where: { id: 'b6af81e9-283d-4530-9ce2-3e0cc1fc878e' }, select: { name: true, config: true } });
  const c: any = doc!.config;
  console.log('doc:', doc!.name, '| date:', c.date, '| due:', c.dueDate, '| ref:', c.referenceNo, '| gst%:', c.gstPercent, '| items:', JSON.stringify(c.items));
  const cust = await prisma.customer.findUnique({ where: { id: '63890785-bc63-4bf1-9965-33ee22f25507' }, select: { name: true, xeroId: true } });
  console.log('prod customer xeroId:', JSON.stringify(cust));
  const TK = await tokens();
  const x = async (p: string) => (await fetch(`${XERO_API}${p}`, { headers: { Authorization: `Bearer ${TK.at}`, 'Xero-Tenant-Id': TK.tid, Accept: 'application/json' } })).json();

  const inv: any = await x(`/Invoices?InvoiceNumbers=${doc!.name}`);
  for (const i of inv.Invoices || []) {
    console.log('XERO INV:', JSON.stringify({ id: i.InvoiceID, num: i.InvoiceNumber, type: i.Type, status: i.Status, contact: i.Contact?.Name, date: i.DateString, total: i.Total, lineAmountTypes: i.LineAmountTypes }));
    const full: any = await x(`/Invoices/${i.InvoiceID}`);
    for (const l of full.Invoices?.[0]?.LineItems || []) console.log('  line:', JSON.stringify({ desc: l.Description, qty: l.Quantity, unit: l.UnitAmount, acct: l.AccountCode, tax: l.TaxType }));
  }
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
