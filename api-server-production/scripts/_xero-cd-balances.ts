// List all "Customer Deposit" accounts in Biofuel's Xero with current balances
// (Trial Balance as of today).
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
  const TK = await tokens();
  const x = async (p: string) => {
    const res = await fetch(`${XERO_API}${p}`, { headers: { Authorization: `Bearer ${TK.at}`, 'Xero-Tenant-Id': TK.tid, Accept: 'application/json' } });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    return json;
  };
  const all: any = await x('/Accounts');
  const accts = (all.Accounts || []).filter((a: any) => a.Status === 'ACTIVE');
  const coded = accts.filter((a: any) => a.Code).map((a: any) => `${a.Code} ${a.Name} [${a.Type}]`).sort();
  console.log('--- coded accounts ---');
  for (const c of coded) console.log(' ', c);
  const uncoded = accts.filter((a: any) => !a.Code);
  console.log(`--- uncoded: ${uncoded.length} ---`);
  for (const a of uncoded) console.log(' ', a.Name, `[${a.Type}]`);
  const tb: any = { Reports: [] };
  const rows: any[] = [];
  const walk = (sections: any[]) => {
    for (const s of sections || []) {
      for (const r of s.Rows || []) {
        if (r.RowType === 'Row') {
          const cells = r.Cells || [];
          const label = cells[0]?.Value || '';
          if (/customer deposit/i.test(label)) {
            rows.push({ label, debit: cells[1]?.Value, credit: cells[2]?.Value, ytdDebit: cells[3]?.Value, ytdCredit: cells[4]?.Value });
          }
        }
        if (r.Rows) walk([r]);
      }
    }
  };
  walk(tb.Reports?.[0]?.Rows || []);
  console.log(`Trial Balance rows matching "customer deposit" (as of 2026-07-27): ${rows.length}`);
  for (const r of rows) console.log(' ', JSON.stringify(r));
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
