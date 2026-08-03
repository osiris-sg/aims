// Give Biofuel's uncoded Xero "Customer Deposit-*" accounts numeric codes in
// the Xero 3-digit style: block 640-661 in AIMS CD-series order (CD003→640 …
// CD022→659), then Ee hup 660 / Lam Hwa 661 (Xero-only), and recode
// CD023 → 662. Also writes confirmed XeroAccountMapping rows (CDxxx → 6xx)
// in AIMS prod so app syncs translate codes.
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const APPLY = process.argv.includes('--apply');
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
const norm = (s: string) => s.toLowerCase().replace(/customer deposit-/, '').replace(/\s+/g, ' ').trim();
async function main() {
  const TK = await tokens();
  const x = async (method: string, p: string, body?: any) => {
    const res = await fetch(`${XERO_API}${p}`, { method, headers: { Authorization: `Bearer ${TK.at}`, 'Xero-Tenant-Id': TK.tid, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
    return json;
  };

  // AIMS CD series ordering comes from DEV (prod AIMS only has CD023) — the
  // 640+ sequence mirrors CD003..CD022 so the two series correspond 1:1.
  const devUrl = fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)![1];
  const dev = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(devUrl).toString() }) } as any);
  const aims = await dev.chartOfAccount.findMany({
    where: { organizationId: ORG, code: { startsWith: 'CD0' }, NOT: { code: 'CD000' } },
    orderBy: { code: 'asc' }, select: { id: true, code: true, name: true },
  });
  await dev.$disconnect();
  // Xero deposit accounts.
  const all: any = await x('GET', '/Accounts');
  const xeroDeps = (all.Accounts || []).filter((a: any) => a.Status === 'ACTIVE' && /^customer deposit-/i.test(a.Name));
  const xeroByNorm = new Map<string, any>(xeroDeps.map((a: any) => [norm(a.Name), a] as [string, any]));

  const plan: Array<{ xero: any; newCode: string; aimsCode?: string; aimsId?: string }> = [];
  let next = 640;
  for (const a of aims) {
    if (a.code === 'CD023') continue; // handled last (already coded in Xero)
    const an = norm(a.name);
    let key: string | null = xeroByNorm.has(an) ? an : null;
    if (!key) {
      for (const k of xeroByNorm.keys()) {
        if (k.startsWith(an) || an.startsWith(k)) { key = k; break; }
      }
    }
    if (!key) { console.log(`  ! no Xero match for ${a.code} ${a.name}`); continue; }
    const xa = xeroByNorm.get(key);
    plan.push({ xero: xa, newCode: String(next++), aimsCode: a.code, aimsId: a.id });
    xeroByNorm.delete(key);
  }
  // Xero-only deposit accounts (no AIMS CD row): Ee hup, Lam Hwa, SKV short-name etc.
  for (const [, xa] of xeroByNorm) {
    if (xa.Code === 'CD023') continue;
    plan.push({ xero: xa, newCode: String(next++) });
  }
  const cd023 = (all.Accounts || []).find((a: any) => a.Code === 'CD023');
  if (cd023) plan.push({ xero: cd023, newCode: String(next++), aimsCode: 'CD023' });

  for (const p2 of plan) console.log(`  ${p2.newCode} ← ${p2.xero.Code || '(uncoded)'} ${p2.xero.Name} ${p2.aimsCode ? `[AIMS ${p2.aimsCode}]` : '[Xero-only]'}`);
  if (!APPLY) { console.log('dry-run — pass --apply'); return; }

  for (const p2 of plan) {
    await x('POST', `/Accounts/${p2.xero.AccountID}`, { AccountID: p2.xero.AccountID, Code: p2.newCode });
    if (p2.aimsCode) {
      const existing = await prisma.xeroAccountMapping.findFirst({ where: { organizationId: ORG, aimsAccountCode: p2.aimsCode } });
      if (existing) {
        await prisma.xeroAccountMapping.update({ where: { id: existing.id }, data: { xeroAccountId: p2.xero.AccountID, xeroAccountCode: p2.newCode, xeroAccountName: p2.xero.Name, source: 'MANUAL', confirmedAt: new Date() } });
      } else {
        const prodAcct = await prisma.chartOfAccount.findFirst({ where: { organizationId: ORG, code: p2.aimsCode }, select: { id: true } });
        await prisma.xeroAccountMapping.create({ data: { organizationId: ORG, aimsAccountId: prodAcct?.id ?? null, aimsAccountCode: p2.aimsCode, xeroAccountId: p2.xero.AccountID, xeroAccountCode: p2.newCode, xeroAccountName: p2.xero.Name, xeroAccountType: p2.xero.Type, source: 'MANUAL', reason: 'CD-series numeric coding (guru 2026-07-27)', confirmedAt: new Date() } });
      }
    }
    console.log(`  ✓ ${p2.newCode} ${p2.xero.Name}`);
  }
  console.log('done');
}
main().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
