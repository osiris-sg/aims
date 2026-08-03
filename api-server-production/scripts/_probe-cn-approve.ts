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
  const g = await xero('GET', '/CreditNotes/30b0ee43-5279-4877-93ba-8f4967aa79f5');
  const cn = g.CreditNotes[0];
  console.log(`status=${cn.Status} total=${cn.Total} date=${cn.DateString} contact=${cn.Contact?.Name}`);
  (cn.LineItems || []).forEach((l: any) => console.log(`  line: qty=${l.Quantity} unit=${l.UnitAmount} amt=${l.LineAmount} acct=${l.AccountCode || "NONE"} tax=${l.TaxType || "-"} "${(l.Description || '').slice(0, 50)}"`));
  // try approve with full lines (fill missing account codes)
  const lines = (cn.LineItems || []).map((l: any) =>
    Number(l.LineAmount) > 0
      ? { LineItemID: l.LineItemID, Description: l.Description, Quantity: l.Quantity || 1, UnitAmount: l.UnitAmount || l.LineAmount, AccountCode: l.AccountCode || '443', TaxType: l.TaxType || 'NONE' }
      : { Description: l.Description });
  try {
    const res = await xero('POST', `/CreditNotes/${cn.CreditNoteID}`, { CreditNotes: [{ CreditNoteID: cn.CreditNoteID, Status: 'AUTHORISED', LineItems: lines }] });
    const r = res.CreditNotes[0];
    console.log(r.HasErrors ? `still failing: ${JSON.stringify(r.ValidationErrors).slice(0, 300)}` : `approved ✓ (${r.Status})`);
  } catch (e: any) {
    const m = e.message.match(/"Message":"([^"]+)"/g);
    console.log('ERR:', m ? m.slice(0, 4).join(" | ") : e.message.slice(0, 400));
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error('FATAL', e.message.slice(0, 400)); process.exit(1); });
