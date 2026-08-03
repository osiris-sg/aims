// Bank-rec visibility backfill (guru 2026-08-03):
//  A. Link backfilled BillPayments (AP) to their JV-XERO ACCPAYPAYMENT
//     journals — by reference, else unique amount+date match.
//  B. Create customer Payment rows (AR) from Xero ACCREC payments (idempotent
//     on Payment.xeroId), linked to the AIMS invoice + the JV-XERO
//     ACCRECPAYMENT journal the same way.
// No journals are created — Xero GL imports already carry them.
// Usage: npx ts-node scripts/backfill-payment-journal-links.ts --env dev --apply
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
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const XERO_API = 'https://api.xero.com/api.xro/2.0';
const DAY = 24 * 3600 * 1000;

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
  // ---------- shared: JV-XERO payment journals with bank lines ----------
  const jes = await target.journalEntry.findMany({
    where: { organizationId: ORG, type: 'PAYMENT', journalNumber: { startsWith: 'JV-XERO' }, status: { not: 'VOID' } },
    select: { id: true, reference: true, entryDate: true, description: true, lines: { select: { debit: true, credit: true } } },
  });
  console.log(`[${ENV}] JV-XERO payment journals: ${jes.length}`);
  const byRef = new Map<string, string[]>();
  const byKey = new Map<string, string[]>();
  for (const j of jes) {
    if (j.reference) byRef.set(j.reference, [...(byRef.get(j.reference) || []), j.id]);
    // amount seen on any line; side inferred from description (ACCREC = money in → bank debit)
    const isAR = /ACCRECPAYMENT/i.test(j.description || '');
    const amts = new Set<number>();
    for (const l of j.lines) {
      const a = isAR ? l.debit : l.credit;
      if (a > 0) amts.add(Math.round(a * 100) / 100);
    }
    for (const a of amts) {
      const key = `${isAR ? 'AR' : 'AP'}|${j.entryDate.toISOString().slice(0, 10)}|${a.toFixed(2)}`;
      byKey.set(key, [...(byKey.get(key) || []), j.id]);
    }
  }
  const used = new Set<string>(); // one journal → one payment

  const linkJournal = (side: 'AR' | 'AP', reference: string | null, date: Date, amount: number): string | null => {
    if (reference && byRef.has(reference)) {
      const cands = byRef.get(reference)!.filter((id) => !used.has(id));
      if (cands.length === 1) return cands[0];
    }
    const key = `${side}|${date.toISOString().slice(0, 10)}|${(Math.round(amount * 100) / 100).toFixed(2)}`;
    const cands = (byKey.get(key) || []).filter((id) => !used.has(id));
    return cands.length === 1 ? cands[0] : null;
  };

  // ---------- A. link BillPayments ----------
  const bps = await target.billPayment.findMany({ where: { organizationId: ORG, journalEntryId: null, xeroId: { not: null } } });
  let apLinked = 0;
  for (const bp of bps) {
    const jid = linkJournal('AP', bp.reference, bp.paymentDate, bp.amount);
    if (!jid) continue;
    used.add(jid);
    apLinked++;
    if (APPLY) await target.billPayment.update({ where: { id: bp.id }, data: { journalEntryId: jid } });
  }
  console.log(`A. BillPayments: ${bps.length} unlinked → ${APPLY ? 'linked' : 'would link'} ${apLinked}`);

  // ---------- B. customer Payments from Xero ACCREC payments ----------
  const invoices: any[] = await target.$queryRawUnsafe(
    `SELECT id, name, config->>'xeroInvoiceId' AS xid, config->>'customerId' AS cust
       FROM "Document" WHERE "organizationId" = $1 AND config->>'xeroInvoiceId' IS NOT NULL AND type IN ('INVOICE','CREDIT_NOTE')`, ORG);
  const invByXeroId = new Map(invoices.map((i) => [i.xid, i]));
  console.log(`B. AIMS invoices with xeroInvoiceId: ${invByXeroId.size}`);
  const existing = new Set(((await target.payment.findMany({ where: { organizationId: ORG, xeroId: { not: null } }, select: { xeroId: true } })) as any[]).map((p) => p.xeroId));
  // Some invoice configs carry stale customer ids (resync artifacts) — the FK
  // would reject them, so validate against the live Customer table.
  const validCust = new Set((await target.customer.findMany({ where: { organizationId: ORG }, select: { id: true } })).map((c) => c.id));

  const TK = await tokens();
  let page = 1, created = 0, linkedAR = 0, skipped = 0, scanned = 0;
  for (;;) {
    const res = await fetch(`${XERO_API}/Payments?page=${page}`, { headers: { Authorization: `Bearer ${TK.at}`, 'Xero-Tenant-Id': TK.tid, Accept: 'application/json' } });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
    const pays: any[] = json.Payments || [];
    scanned += pays.length;
    for (const p of pays) {
      if (existing.has(p.PaymentID)) continue;
      if (String(p.Status || '').toUpperCase() === 'DELETED') continue;
      if (!/^ACCRECPAYMENT$/i.test(p.PaymentType || '')) continue;
      const inv = p.Invoice?.InvoiceID ? invByXeroId.get(p.Invoice.InvoiceID) : null;
      if (!inv || !inv.cust || !validCust.has(inv.cust)) { skipped++; continue; }
      const date = p.Date?.match(/\d+/) ? new Date(Number(p.Date.match(/\d+/)![0])) : new Date();
      const amount = Number(p.Amount) || 0;
      const jid = linkJournal('AR', p.Reference || null, date, amount);
      if (jid) { used.add(jid); linkedAR++; }
      if (APPLY) {
        await target.payment.create({
          data: {
            organizationId: ORG, customerId: inv.cust, documentId: inv.id,
            amount, paymentDate: date, paymentMethod: 'transfer',
            reference: p.Reference || null, notes: 'Imported from Xero',
            xeroId: p.PaymentID, journalEntryId: jid, createdBy: 'xero-backfill',
          } as any,
        });
      }
      existing.add(p.PaymentID);
      created++;
    }
    if (pays.length < 100) break;
    page++;
  }
  console.log(`B. scanned=${scanned} ${APPLY ? 'created' : 'would create'}=${created} (journal-linked ${linkedAR}) skipped(no AIMS invoice)=${skipped}`);
  if (!APPLY) console.log('dry-run — pass --apply');
}
main().catch((e) => { console.error(e.message || e); process.exit(1); }).finally(async () => { await target.$disconnect(); if (prodDb !== target) await prodDb.$disconnect(); });
