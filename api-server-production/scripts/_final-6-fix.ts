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
const XT2_FILE = __dirname + '/_xero2-tokens.json';
async function tokens() {
  const t = JSON.parse(fs.readFileSync(XT2_FILE, 'utf8'));
  if (t.expiresAt - Date.now() > 5 * 60 * 1000) return { at: t.accessToken, tid: t.tenantId };
  const basic = Buffer.from(`${t.clientId}:${t.clientSecret}`).toString('base64');
  const res = await fetch('https://identity.xero.com/connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refreshToken }) });
  if (!res.ok) throw new Error(`app2 refresh ${res.status}: ${await res.text()}`);
  const n = await res.json();
  const upd = { ...t, accessToken: n.access_token, refreshToken: n.refresh_token, expiresAt: Date.now() + n.expires_in * 1000 };
  fs.writeFileSync(XT2_FILE, JSON.stringify(upd, null, 2));
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
  // 1. three old GB rows: Xero twins are PAID — mirror amountPaid so they stop counting as open
  for (const name of ['GB2600018887', 'GB2600019915', 'GB2600017103']) {
    const b = await prisma.document.findFirst({ where: { organizationId: ORG, type: 'BILL', name }, select: { id: true, config: true } });
    const c: any = b!.config || {};
    await prisma.document.update({ where: { id: b!.id }, data: { config: { ...c, amountPaid: Number(c.totalAmount || 0) } } });
    console.log(`${name}: amountPaid mirrored (${c.totalAmount})`);
  }
  // 2. JP2604300017: AIMS says paid (Dennis, per BillPayment) but Xero shows $6 open — re-apply
  const b17 = await prisma.document.findFirst({ where: { organizationId: ORG, type: 'BILL', name: 'JP2604300017' }, select: { id: true, config: true } });
  const c17: any = b17!.config || {};
  const bps: any[] = await prisma.$queryRaw`SELECT amount, "paymentDate", reference FROM "BillPayment" WHERE "organizationId"=${ORG} AND "billId"=${b17!.id} LIMIT 1`;
  const bp = bps[0] ? { amount: bps[0].amount, paymentDate: new Date(bps[0].paymentDate), reference: bps[0].reference } : null;
  if (bp && c17.xeroBillId) {
    const accts = await xero('GET', '/Accounts');
    const acct = (accts.Accounts || []).find((a: any) => a.Name === (bp.reference?.includes('Eve') ? 'Petty Cash - Eve' : 'Petty Cash - Dennis'))?.AccountID;
    const pr = await xero('PUT', '/Payments?SummarizeErrors=false', { Payments: [{ Invoice: { InvoiceID: c17.xeroBillId }, Account: { AccountID: acct }, Date: bp.paymentDate.toISOString().slice(0, 10), Amount: Number(bp.amount) }] });
    const r = pr.Payments?.[0];
    console.log(r?.ValidationErrors?.length ? `x JP2604300017: ${r.ValidationErrors[0].Message}` : `JP2604300017: $${bp.amount} payment re-applied in Xero`);
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error('FATAL', e.message.slice(0, 800)); process.exit(1); });
