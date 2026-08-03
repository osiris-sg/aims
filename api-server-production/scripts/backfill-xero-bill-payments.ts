// Backfill AIMS BillPayment rows from Xero ACCPAY payments (guru 2026-08-01:
// P/V listing must reflect Xero-side payments). Idempotent on
// BillPayment.xeroId; journalEntryId stays NULL (payment journals already
// came through the Xero GL import). Uses the PROD-stored Xero connection for
// API tokens (dev/prod share one tenant; dev's stored token is usually stale)
// while writing to the --env DB.
//
// Usage: npx ts-node scripts/backfill-xero-bill-payments.ts --env dev --apply
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

const args = process.argv.slice(2);
const ENV = (args[args.indexOf('--env') + 1] || 'dev') as 'dev' | 'staging' | 'prod';
const APPLY = args.includes('--apply');
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1'; // Biofuel (same id all envs)
const XERO_API = 'https://api.xero.com/api.xro/2.0';

const dbUrl = (file: string) => new URL(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)![1]).toString();
const envFile = ENV === 'dev' ? '.env' : ENV === 'staging' ? '.env.staging' : '.env.production';
const target = new PrismaClient({ adapter: new PrismaNeon({ connectionString: dbUrl(envFile) }) } as any);
const prodDb = ENV === 'prod' ? target : new PrismaClient({ adapter: new PrismaNeon({ connectionString: dbUrl('.env.production') }) } as any);

async function tokens() {
  const conn = await prodDb.xeroConnection.findUnique({ where: { organizationId: ORG } });
  if (!conn) throw new Error('no prod Xero connection');
  if (conn.accessTokenExpiresAt.getTime() - Date.now() > 5 * 60 * 1000) return { at: conn.accessToken, tid: conn.tenantId };
  const envTxt = fs.readFileSync(path.resolve(__dirname, '..', '.env.production'), 'utf8');
  const basic = Buffer.from(`${envTxt.match(/^XERO_CLIENT_ID="?([^"\n]+)"?/m)?.[1]}:${envTxt.match(/^XERO_CLIENT_SECRET="?([^"\n]+)"?/m)?.[1]}`).toString('base64');
  const res = await fetch('https://identity.xero.com/connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refreshToken }) });
  if (!res.ok) throw new Error(`refresh ${res.status}`);
  const t: any = await res.json();
  const upd = await prodDb.xeroConnection.update({ where: { organizationId: ORG }, data: { accessToken: t.access_token, refreshToken: t.refresh_token, accessTokenExpiresAt: new Date(Date.now() + t.expires_in * 1000), refreshTokenExpiresAt: new Date(Date.now() + 60 * 864e5) } });
  return { at: upd.accessToken, tid: upd.tenantId };
}

async function main() {
  const TK = await tokens();
  const bills = await target.document.findMany({ where: { organizationId: ORG, type: 'BILL' }, select: { id: true, name: true, config: true } });
  const billByXeroId = new Map<string, any>();
  for (const b of bills) {
    const c: any = b.config || {};
    if (c.xeroBillId) billByXeroId.set(c.xeroBillId, { id: b.id, name: b.name, supplierId: c.supplierId });
  }
  console.log(`[${ENV}] Biofuel bills with xeroBillId: ${billByXeroId.size}/${bills.length}`);
  const accounts = await target.chartOfAccount.findMany({ where: { organizationId: ORG }, select: { id: true, xeroId: true, code: true } });
  const acctByXeroId = new Map(accounts.filter((a) => a.xeroId).map((a) => [a.xeroId as string, a]));
  const acctByCode = new Map(accounts.map((a) => [a.code, a]));
  const existing = new Set((await target.billPayment.findMany({ where: { organizationId: ORG, xeroId: { not: null } }, select: { xeroId: true } })).map((p) => p.xeroId as string));

  let page = 1, scanned = 0, created = 0, skippedNoBill = 0, deleted = 0;
  for (;;) {
    const res = await fetch(`${XERO_API}/Payments?page=${page}`, { headers: { Authorization: `Bearer ${TK.at}`, 'Xero-Tenant-Id': TK.tid, Accept: 'application/json' } });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
    const pays: any[] = json.Payments || [];
    scanned += pays.length;
    for (const p of pays) {
      if (existing.has(p.PaymentID)) continue;
      if (String(p.Status || '').toUpperCase() === 'DELETED') { deleted++; continue; }
      const bill = p.Invoice?.InvoiceID ? billByXeroId.get(p.Invoice.InvoiceID) : null;
      if (!bill || !bill.supplierId) { skippedNoBill++; continue; }
      const bank =
        (p.Account?.AccountID && acctByXeroId.get(p.Account.AccountID)) ||
        (p.Account?.Code && acctByCode.get(p.Account.Code)) ||
        null;
      const date = p.Date?.match(/\d+/) ? new Date(Number(p.Date.match(/\d+/)![0])) : new Date();
      if (APPLY) {
        await target.billPayment.create({
          data: {
            organizationId: ORG, billId: bill.id, supplierId: bill.supplierId,
            amount: Number(p.Amount) || 0, paymentDate: date, paymentMethod: 'transfer',
            reference: p.Reference || null, bankAccountId: bank?.id || '', journalEntryId: null,
            xeroId: p.PaymentID, notes: 'Imported from Xero', createdBy: 'xero-backfill',
          },
        });
      }
      existing.add(p.PaymentID);
      created++;
      if (created <= 10) console.log(`  + ${bill.name} ${date.toISOString().slice(0, 10)} $${p.Amount} bank=${bank?.code || '?'}`);
    }
    if (pays.length < 100) break;
    page++;
  }
  console.log(`scanned=${scanned} ${APPLY ? 'created' : 'would create'}=${created} skipped(no AIMS bill / AR side)=${skippedNoBill} deleted=${deleted}`);
  if (!APPLY) console.log('dry-run — pass --apply');
}
main().catch((e) => { console.error(e.message || e); process.exit(1); }).finally(async () => { await target.$disconnect(); if (prodDb !== target) await prodDb.$disconnect(); });
