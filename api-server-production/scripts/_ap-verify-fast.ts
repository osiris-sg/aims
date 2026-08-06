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
const R = (n: number) => Math.round(n * 100) / 100;
const normName = (n: string) => (n || '').split(' · ')[0].trim();
async function main() {
  TK = await tokens();
  const xeroByNum = new Map<string, number>();
  for (let page = 1; ; page++) {
    const res = await xero('GET', `/Invoices?where=${encodeURIComponent('Type=="ACCPAY"')}&page=${page}&summaryOnly=true`);
    const invs: any[] = res.Invoices || [];
    if (!invs.length) break;
    for (const inv of invs) {
      if (['VOIDED', 'DELETED', 'DRAFT', 'SUBMITTED'].includes(inv.Status)) continue;
      const due = Number(inv.AmountDue) || 0;
      if (due <= 0.005) continue;
      xeroByNum.set(normName(inv.InvoiceNumber), R((xeroByNum.get(normName(inv.InvoiceNumber)) || 0) + due));
    }
    await sleep(1100);
  }
  const xT = R([...xeroByNum.values()].reduce((s, v) => s + v, 0));
  // AIMS side: ONE set-based query mirroring the reconciler logic
  const rows: any[] = await prisma.$queryRaw`
    SELECT name, config FROM "Document" WHERE "organizationId"=${ORG} AND type='BILL'`;
  const aims = new Map<string, number>();
  for (const r of rows) {
    const c: any = r.config || {};
    const bdate = c.billDate || c.date;
    if (bdate && new Date(bdate).getTime() > Date.now()) continue;
    let st = (c.billStatus || '').toUpperCase();
    if (!st) {
      const xs = c.xeroStatus;
      st = /^paid$/i.test(xs || '') ? 'PAID' : /voided|deleted/i.test(xs || '') ? 'VOID' : /draft|submitted/i.test(xs || '') ? 'DRAFT' : 'POSTED';
    }
    if (!['POSTED', 'PAID'].includes(st)) continue;
    const total = Number(c.totalAmount ?? c.xeroGross ?? 0);
    const paid = c.amountPaid !== undefined ? Number(c.amountPaid) : c.xeroBalance !== undefined ? R(total - Number(c.xeroBalance)) : Number(c.xeroAmountPaid ?? 0);
    const out = R(total - paid);
    if (out <= 0.005) continue;
    aims.set(normName(r.name), R((aims.get(normName(r.name)) || 0) + out));
  }
  const aT = R([...aims.values()].reduce((s, v) => s + v, 0));
  console.log(`Xero open AP $${xT} (${xeroByNum.size}) · AIMS open AP $${aT} (${aims.size}) · Δ ${R(xT - aT)}`);
  const xOnly = [...xeroByNum.entries()].filter(([n]) => !aims.has(n));
  const aOnly = [...aims.entries()].filter(([n]) => !xeroByNum.has(n));
  console.log(`Xero-only: ${xOnly.map(([n, v]) => `${n}($${v})`).join(', ') || 'none'}`);
  console.log(`AIMS-only: ${aOnly.map(([n, v]) => `${n}($${v})`).join(', ') || 'none'}`);
  await prisma.$disconnect();
}
main().catch(e => { console.error('FATAL', e.message.slice(0, 300)); process.exit(1); });
