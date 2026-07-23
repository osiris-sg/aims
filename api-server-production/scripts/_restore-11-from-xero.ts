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
  const docs = await prisma.document.findMany({
    where: { organizationId: ORG, name: { startsWith: 'BIPL-JPSG-INV' }, type: 'INVOICE' },
    select: { id: true, name: true, config: true },
  });
  // the ones still wrongly coded: have xeroInvoiceId AND SV025/443 stamps AND disposal lines
  const targets = docs.filter(d => {
    const c: any = d.config || {};
    return c.xeroInvoiceId && (c.items || []).some((it: any) => /soil|disposal|tonne|transport/i.test(it.description || '') && (it.accountCode === '443' || it.itemCode));
  });
  console.log(`to restore from Xero truth: ${targets.length}`);
  for (const d of targets) {
    const c: any = d.config || {};
    const g = await xero('GET', `/Invoices/${c.xeroInvoiceId}`);
    const inv = g?.Invoices?.[0];
    if (!inv) { console.log(`  x ${d.name}: not found in Xero`); continue; }
    const xlines: any[] = inv.LineItems || [];
    const items = (c.items || []).map((it: any, i: number) => {
      const { itemCode, isService, ...rest } = it;
      return { ...rest, accountCode: xlines[i]?.AccountCode ?? xlines[0]?.AccountCode ?? null };
    });
    await prisma.document.update({
      where: { id: d.id },
      data: { config: { ...c, items,
        gstAmount: Number(inv.TotalTax) || 0,
        subTotal: Number(inv.SubTotal) || 0,
        xeroStatus: inv.Status,
        documentInfo: { ...(c.documentInfo || {}), taxApplicable: Number(inv.TotalTax) > 0 ? 'Y' : 'N', gstPercent: Number(inv.TotalTax) > 0 ? 9 : 0 } } },
    });
    console.log(`  ok ${d.name}: ${inv.Status} · net ${inv.SubTotal} + GST ${inv.TotalTax} · acct ${xlines[0]?.AccountCode}`);
    await sleep(1100);
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
