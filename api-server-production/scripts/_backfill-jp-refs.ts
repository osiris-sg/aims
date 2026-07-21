/** Extract the Biofuel recharge-invoice number (BIPL-JPSG-INV-…) from each
 *  JP bill's email metadata → set it as the bill reference in AIMS AND on the
 *  corresponding Xero draft. */
import { PrismaClient, Prisma } from '@prisma/client';
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
  const cid = envTxt.match(/^XERO_CLIENT_ID="?([^"\n]+)"?/m)?.[1];
  const csec = envTxt.match(/^XERO_CLIENT_SECRET="?([^"\n]+)"?/m)?.[1];
  const basic = Buffer.from(`${cid}:${csec}`).toString('base64');
  const res = await fetch('https://identity.xero.com/connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refreshToken }) });
  if (!res.ok) throw new Error(`refresh ${res.status}`);
  const t: any = await res.json();
  const upd = await prisma.xeroConnection.update({ where: { organizationId: ORG }, data: { accessToken: t.access_token, refreshToken: t.refresh_token, accessTokenExpiresAt: new Date(Date.now() + t.expires_in * 1000), refreshTokenExpiresAt: new Date(Date.now() + 60 * 864e5) } });
  return { at: upd.accessToken, tid: upd.tenantId };
}
async function main() {
  const bills = await prisma.document.findMany({ where: { organizationId: ORG, type: 'BILL', name: { startsWith: 'JP26' } }, select: { id: true, name: true, config: true } });
  const linked: Array<{ id: string; name: string; c: any; ref: string }> = [];
  for (const b of bills) {
    const c: any = b.config || {};
    const subject: string = c.inboundMeta?.subject || '';
    const mm = subject.match(/(BIPL-JPSG-INV-[\d-]+)/);
    if (mm) linked.push({ id: b.id, name: b.name!, c, ref: mm[1] });
  }
  console.log(`JP bills with recharge-invoice linkage in email meta: ${linked.length} / ${bills.length}`);

  // 1) AIMS side
  let aimsSet = 0;
  for (const l of linked) {
    if (l.c.reference === l.ref) continue;
    await prisma.document.update({ where: { id: l.id }, data: { config: { ...l.c, reference: l.ref } as unknown as Prisma.InputJsonValue } });
    aimsSet++;
  }
  console.log(`AIMS references set: ${aimsSet}`);

  // 2) Xero side — batch update drafts' Reference by InvoiceID
  const tk = await tokens();
  const withXero = linked.filter(l => l.c.xeroBillId);
  let xeroSet = 0, failed = 0;
  for (let i = 0; i < withXero.length; i += 40) {
    const chunk = withXero.slice(i, i + 40);
    const payload = { Invoices: chunk.map(l => ({ InvoiceID: l.c.xeroBillId, Reference: l.ref })) };
    const res = await fetch(`${XERO_API}/Invoices?SummarizeErrors=false`, { method: 'POST', headers: { Authorization: `Bearer ${tk.at}`, 'Xero-Tenant-Id': tk.tid, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) { failed += chunk.length; console.log(`  ✗ batch @${i}: ${res.status} ${JSON.stringify(body).slice(0, 150)}`); }
    else for (const inv of body.Invoices || []) { if (inv.HasErrors) { failed++; console.log(`  ✗ ${inv.InvoiceNumber}: ${inv.ValidationErrors?.[0]?.Message}`); } else xeroSet++; }
    await sleep(1500);
  }
  console.log(`Xero references set: ${xeroSet} failed: ${failed} (no-xero-link: ${linked.length - withXero.length})`);
}
main().catch(e => { console.error('FATAL', e?.message || e); process.exit(1); }).finally(() => prisma.$disconnect());
