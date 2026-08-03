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
  const targets = [
    ['INVOICE', 'BIPL-JPSG-INV-20260729-0179', 'xeroInvoiceId'],
    ['BILL', 'JP2607290103', 'xeroBillId'],
    ['BILL', 'JP2607290104', 'xeroBillId'],
  ] as const;
  for (const [type, name, key] of targets) {
    const d = await prisma.document.findFirst({ where: { organizationId: ORG, type, name }, select: { id: true, config: true } });
    const c: any = d!.config || {};
    const up = await xero('POST', `/Invoices/${c[key]}`, { Invoices: [{ InvoiceID: c[key], Status: 'AUTHORISED' }] });
    const u = up.Invoices[0];
    if (u.HasErrors) { console.log(`x ${name}: ${u.ValidationErrors?.[0]?.Message}`); continue; }
    await prisma.document.update({ where: { id: d!.id }, data: { config: { ...c, xeroStatus: 'AUTHORISED' } } });
    console.log(`${name} → AUTHORISED`);
    await sleep(1100);
  }
  // verify 443 stayed zero in Xero via TB identity
  const r = await xero('GET', '/Reports/TrialBalance');
  const rows = r.Reports?.[0]?.Rows || [];
  const walk = (rs: any[]): any[] => rs.flatMap((x: any) => [x, ...(x.Rows ? walk(x.Rows) : [])]);
  for (const row of walk(rows)) {
    const cells = row.Cells || [];
    if (/\(443\)/.test(cells[0]?.Value || '')) console.log('TB 443 FYTD:', cells.map((c: any) => c.Value).join(' | '));
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error('FATAL', e.message.slice(0, 300)); process.exit(1); });
