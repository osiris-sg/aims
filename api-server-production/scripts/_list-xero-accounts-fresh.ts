/** READ-ONLY: pull current Xero CoA, show recently added / JP-related accounts. */
import { createScriptPrisma, BIOFUEL_ORG_ID } from './xero-migration/_common';
import * as fs from 'fs';
const prisma = createScriptPrisma();
const XERO_API = 'https://api.xero.com/api.xro/2.0';
async function tokens() {
  const conn = await prisma.xeroConnection.findUnique({ where: { organizationId: BIOFUEL_ORG_ID } });
  if (!conn) throw new Error('no conn');
  if (conn.accessTokenExpiresAt.getTime() - Date.now() > 5 * 60 * 1000) return { at: conn.accessToken, tid: conn.tenantId };
  const envTxt = fs.readFileSync('.env', 'utf8');
  const basic = Buffer.from(`${envTxt.match(/^XERO_CLIENT_ID="?([^"\n]+)"?/m)?.[1]}:${envTxt.match(/^XERO_CLIENT_SECRET="?([^"\n]+)"?/m)?.[1]}`).toString('base64');
  const res = await fetch('https://identity.xero.com/connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refreshToken }) });
  if (!res.ok) throw new Error(`refresh ${res.status}`);
  const t: any = await res.json();
  const upd = await prisma.xeroConnection.update({ where: { organizationId: BIOFUEL_ORG_ID }, data: { accessToken: t.access_token, refreshToken: t.refresh_token, accessTokenExpiresAt: new Date(Date.now() + t.expires_in * 1000), refreshTokenExpiresAt: new Date(Date.now() + 60 * 864e5) } });
  return { at: upd.accessToken, tid: upd.tenantId };
}
async function main() {
  const tk = await tokens();
  const res = await fetch(`${XERO_API}/Accounts`, { headers: { Authorization: `Bearer ${tk.at}`, 'Xero-Tenant-Id': tk.tid, Accept: 'application/json' } });
  const body: any = await res.json();
  const accts: any[] = body.Accounts || [];
  // JP / pass / recharge related, plus recently updated
  const interesting = accts.filter(a =>
    /jp|pass|recharge|recovery|disburse/i.test(a.Name || '') || /jp|pass/i.test(a.Description || ''));
  console.log('JP/pass/recharge-related accounts in Xero:');
  for (const a of interesting) console.log(`  [${a.Code || '-'}] ${a.Name}  type=${a.Type} tax=${a.TaxType} status=${a.Status} updated=${a.UpdatedDateUTC}`);
  // most recently updated 12 accounts overall
  const recent = [...accts].sort((x, y) => {
    const dx = +(String(x.UpdatedDateUTC).match(/\d+/)?.[0] || 0);
    const dy = +(String(y.UpdatedDateUTC).match(/\d+/)?.[0] || 0);
    return dy - dx;
  }).slice(0, 12);
  console.log('\n12 most recently updated accounts:');
  for (const a of recent) {
    const ts = +(String(a.UpdatedDateUTC).match(/\d+/)?.[0] || 0);
    console.log(`  ${new Date(ts).toISOString().slice(0, 16)}  [${a.Code || '-'}] ${a.Name}  type=${a.Type} tax=${a.TaxType}`);
  }
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
