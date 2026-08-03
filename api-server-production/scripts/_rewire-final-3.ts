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
  const moves: Array<[string, string]> = [['JP2607140113', 'BIPL-JPSG-INV-20260721-0036'], ['JP2607140114', 'BIPL-JPSG-INV-20260721-0036'], ['JP2607140112', 'BIPL-JPSG-INV-20260721-0038']];
  for (const [name, ref] of moves) {
    const b = await prisma.document.findFirst({ where: { organizationId: ORG, type: 'BILL', name }, select: { id: true, config: true } });
    const c: any = b!.config || {};
    await prisma.document.update({ where: { id: b!.id }, data: { config: { ...c, reference: ref } } });
    // rename in Xero too (non-monetary edit, allowed on paid bills)
    if (c.xeroBillId) {
      const up = await xero('POST', `/Invoices/${c.xeroBillId}`, { Invoices: [{ InvoiceID: c.xeroBillId, InvoiceNumber: `${name} · ${ref}` }] });
      console.log(up.Invoices[0].HasErrors ? `x ${name}: ${up.Invoices[0].ValidationErrors?.[0]?.Message}` : `${name} → ${ref} (AIMS + Xero)`);
      await sleep(1100);
    } else console.log(`${name} → ${ref} (AIMS only)`);
  }
  // listings: 0036 gets its two bills; 0038 appends the tenth
  const inv36 = await prisma.document.findFirst({ where: { organizationId: ORG, type: 'INVOICE', name: 'BIPL-JPSG-INV-20260721-0036' }, select: { id: true, config: true } });
  const c36: any = inv36!.config || {};
  if (!(c36.items || []).some((it: any) => /JP2607140113/.test(it.description || ''))) {
    const items = [...(c36.items || []), { id: Date.now(), quantity: 0, unitPrice: 0, amount: 0, description: '1. JP2607140113 — 20.00\n2. JP2607140114 — 20.00' }];
    await prisma.document.update({ where: { id: inv36!.id }, data: { config: { ...c36, items } } });
    console.log('0036 listing added (113, 114)');
  }
  const inv38 = await prisma.document.findFirst({ where: { organizationId: ORG, type: 'INVOICE', name: 'BIPL-JPSG-INV-20260721-0038' }, select: { id: true, config: true } });
  const c38: any = inv38!.config || {};
  const items38 = (c38.items || []).map((it: any) =>
    /JP26\d{8}/.test(it.description || '') && !/JP2607140112/.test(it.description)
      ? { ...it, description: it.description + '\n10. JP2607140112 — 20.00' } : it);
  await prisma.document.update({ where: { id: inv38!.id }, data: { config: { ...c38, items: items38 } } });
  console.log('0038 listing completed with JP2607140112 (10/10)');
  // 0092: annotate as fully refunded by CN-0152
  const inv92 = await prisma.document.findFirst({ where: { organizationId: ORG, type: 'INVOICE', name: 'BIPL-JPSG-INV-20260715-0092' }, select: { id: true, config: true } });
  const c92: any = inv92!.config || {};
  await prisma.document.update({ where: { id: inv92!.id }, data: { config: { ...c92, documentInfo: { ...(c92.documentInfo || {}), reference: 'FULLY REFUNDED — CN BIPL-JPSG-INV-20260721-0152 (double charged)', referenceNo: 'Refunded via CN-20260721-0152' } } } });
  console.log('0092 annotated as fully refunded');
  // tallies
  for (const ref of ['BIPL-JPSG-INV-20260721-0036', 'BIPL-JPSG-INV-20260721-0038']) {
    const bills = await prisma.document.findMany({ where: { organizationId: ORG, type: 'BILL', config: { path: ['reference'], equals: ref } }, select: { config: true } });
    const sum = bills.reduce((s, x) => s + Number((x.config as any).totalAmount || 0), 0);
    console.log(`${ref}: ${bills.length} bills $${sum.toFixed(2)}`);
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error('FATAL', e.message.slice(0, 300)); process.exit(1); });
