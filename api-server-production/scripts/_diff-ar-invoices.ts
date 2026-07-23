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
async function main() {
  TK = await tokens();
  const asof = new Date().getTime();
  const xeroByNum = new Map<string, { due: number; status: string }>();
  for (let page = 1; ; page++) {
    const res = await xero('GET', `/Invoices?where=${encodeURIComponent('Type=="ACCREC"')}&page=${page}&summaryOnly=true`);
    const invs: any[] = res.Invoices || [];
    if (!invs.length) break;
    for (const inv of invs) {
      if (['VOIDED', 'DELETED', 'DRAFT', 'SUBMITTED'].includes(inv.Status)) continue;
      if (inv.DateString && new Date(inv.DateString).getTime() > asof) continue;
      const due = Number(inv.AmountDue) || 0;
      if (due <= 0.005) continue;
      xeroByNum.set(inv.InvoiceNumber, { due, status: inv.Status });
    }
    await sleep(1100);
  }
  const invoices = await prisma.document.findMany({ where: { organizationId: ORG, type: 'INVOICE' }, select: { name: true, config: true } });
  const aimsOpen: Array<{ name: string; owed: number }> = [];
  for (const inv of invoices) {
    const c: any = inv.config || {};
    if (c.voided) continue;
    if (['DRAFT', 'SUBMITTED'].includes((c.xeroStatus || '').toUpperCase())) continue;
    if (c.date && new Date(c.date).getTime() > asof) continue;
    const owed = Number(c.xeroBalance ?? 0);
    if (owed <= 0.005) continue;
    aimsOpen.push({ name: inv.name, owed });
  }
  const xT = R([...xeroByNum.values()].reduce((s, v) => s + v.due, 0));
  const aT = R(aimsOpen.reduce((s, v) => s + v.owed, 0));
  console.log(`Xero open AR $${xT} (${xeroByNum.size}) · AIMS open AR $${aT} (${aimsOpen.length}) · Δ ${R(xT - aT)}`);
  const aimsByName = new Map(aimsOpen.map(a => [a.name, a]));
  const xeroOnly = [...xeroByNum.entries()].filter(([n]) => !aimsByName.has(n));
  const aimsOnly = aimsOpen.filter(a => !xeroByNum.has(a.name));
  const both = aimsOpen.filter(a => xeroByNum.has(a.name) && Math.abs(xeroByNum.get(a.name)!.due - a.owed) > 0.01);
  console.log(`Xero-open not in AIMS (${xeroOnly.length}):`); xeroOnly.slice(0, 10).forEach(([n, v]) => console.log(`  ${n.padEnd(30)} $${v.due} ${v.status}`));
  console.log(`AIMS-open not in Xero (${aimsOnly.length}):`); aimsOnly.slice(0, 10).forEach(a => console.log(`  ${a.name.padEnd(30)} $${a.owed}`));
  console.log(`amount mismatches (${both.length}):`); both.slice(0, 10).forEach(a => console.log(`  ${a.name.padEnd(30)} aims=$${a.owed} xero=$${xeroByNum.get(a.name)!.due}`));
  await prisma.$disconnect();
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
