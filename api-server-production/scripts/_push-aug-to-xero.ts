// Push the generated August recurring invoices to Biofuel's Xero as ACCREC
// DRAFTs (guru 2026-08-11: "those that have no issues we can add to xero").
//
//  • Pushes BI2026080118–BI2026080187 EXCEPT the HOLD list (open accountant
//    questions: BI2026080139).
//  • Convention copied from the accountant's own August rentals (BI202608007):
//    Date 01/08/2026, DueDate 31/08/2026 — AIMS config.date/dueDate are
//    updated to match on --apply so both systems agree.
//  • Contact = customer.xeroId; AccountCode = the priced line of the
//    template's July source invoice; TaxType = the org's 9%-revenue rate
//    resolved live from /TaxRates.
//  • Idempotent: docs already stamped with xeroInvoiceId are skipped.
// Dry-run by default (no Xero calls except on --apply); --apply to write.
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '..', '.env.production'), override: true });
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const APPLY = process.argv.includes('--apply');
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const XERO_API = 'https://api.xero.com/api.xro/2.0';
const HOLD = new Set(['BI2026080139']); // CCDC 8th mth — confirm with accountant first
const DATE = '2026-08-01';
const DUE = '2026-08-31';

async function tokens() {
  const conn = await p.xeroConnection.findUniqueOrThrow({ where: { organizationId: ORG } });
  if (conn.accessTokenExpiresAt.getTime() - Date.now() > 5 * 60 * 1000) return { at: conn.accessToken, tid: conn.tenantId };
  const envTxt = fs.readFileSync(path.resolve(__dirname, '..', '.env.production'), 'utf8');
  const basic = Buffer.from(`${envTxt.match(/^XERO_CLIENT_ID="?([^"\n]+)"?/m)?.[1]}:${envTxt.match(/^XERO_CLIENT_SECRET="?([^"\n]+)"?/m)?.[1]}`).toString('base64');
  const res = await fetch('https://identity.xero.com/connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: conn.refreshToken }) });
  if (!res.ok) throw new Error(`xero token refresh ${res.status}`);
  const t: any = await res.json();
  const upd = await p.xeroConnection.update({ where: { organizationId: ORG }, data: { accessToken: t.access_token, refreshToken: t.refresh_token, accessTokenExpiresAt: new Date(Date.now() + t.expires_in * 1000), refreshTokenExpiresAt: new Date(Date.now() + 60 * 864e5) } });
  return { at: upd.accessToken, tid: upd.tenantId };
}

async function main() {
  const gen = await p.document.findMany({
    where: { organizationId: ORG, type: 'INVOICE', name: { gte: 'BI2026080118', lte: 'BI2026080187' } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, config: true },
  });
  const tpls = await p.recurringInvoiceTemplate.findMany({ where: { organizationId: ORG }, select: { lastRunDocumentId: true, sourceDocumentId: true } });
  const custs = new Map((await p.customer.findMany({ where: { organizationId: ORG }, select: { id: true, name: true, xeroId: true } })).map((c) => [c.id, c]));
  const srcAcct = new Map<string, string>();
  for (const t of tpls) {
    if (!t.lastRunDocumentId || !t.sourceDocumentId) continue;
    const src = await p.document.findUnique({ where: { id: t.sourceDocumentId }, select: { config: true } });
    const acct = ((src?.config as any)?.items || []).find((i: any) => Number(i.unitPrice) > 0)?.accountCode;
    if (acct) srcAcct.set(t.lastRunDocumentId, String(acct));
  }

  type Row = { doc: any; contactId: string; acct: string; item: any };
  const rows: Row[] = [];
  for (const d of gen) {
    const c: any = d.config;
    if (HOLD.has(d.name!)) { console.log(`HOLD  ${d.name} — accountant question`); continue; }
    if (c.xeroInvoiceId) { console.log(`SKIP  ${d.name} — already in Xero (${c.xeroInvoiceId})`); continue; }
    const cust = custs.get(c.customerId);
    const acct = srcAcct.get(d.id);
    if (!cust?.xeroId || !acct) { console.log(`ERR   ${d.name} — missing ${!cust?.xeroId ? 'xero contact' : 'account code'}`); continue; }
    const item = (c.items || []).find((i: any) => Number(i.unitPrice) > 0) || c.items?.[0];
    rows.push({ doc: d, contactId: cust.xeroId, acct, item });
    console.log(`PUSH  ${d.name} | ${cust.name.slice(0, 30)} | acct ${acct} | ${Number(item.quantity)} × ${Number(item.unitPrice)} = ${c.subTotal} net`);
  }
  console.log(`\n${rows.length} to push, date ${DATE} due ${DUE}`);
  if (!APPLY) { console.log('dry-run — pass --apply'); return; }

  const TK = await tokens();
  const x = async (method: string, pth: string, body?: any) => {
    const res = await fetch(`${XERO_API}${pth}`, { method, headers: { Authorization: `Bearer ${TK.at}`, 'Xero-Tenant-Id': TK.tid, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`xero ${method} ${pth} → ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
    return json;
  };

  // 9% standard-rated revenue tax type, resolved live
  const trs: any = await x('GET', '/TaxRates');
  const tr = (trs.TaxRates || []).find((r: any) => r.CanApplyToRevenue && Math.abs(Number(r.EffectiveRate) - 9) < 0.001 && r.Status === 'ACTIVE');
  if (!tr) throw new Error('no active 9% revenue tax rate found in Xero');
  console.log(`TaxType: ${tr.TaxType} (${tr.Name})`);

  for (let i = 0; i < rows.length; i += 35) {
    const batch = rows.slice(i, i + 35);
    const payload = {
      Invoices: batch.map((r) => ({
        Type: 'ACCREC',
        Contact: { ContactID: r.contactId },
        Date: DATE,
        DueDate: DUE,
        InvoiceNumber: r.doc.name,
        Reference: (r.doc.config as any).reference || undefined,
        Status: 'DRAFT',
        LineAmountTypes: 'Exclusive',
        LineItems: [{
          Description: r.item.description,
          Quantity: Number(r.item.quantity) || 1,
          UnitAmount: Number(r.item.unitPrice) || 0,
          AccountCode: r.acct,
          TaxType: tr.TaxType,
        }],
      })),
    };
    const res: any = await x('PUT', '/Invoices?SummarizeErrors=false', payload);
    for (let j = 0; j < (res.Invoices || []).length; j++) {
      const inv = res.Invoices[j];
      const r = batch[j];
      if (inv.HasErrors || (inv.ValidationErrors || []).length) {
        console.log(`XEROERR ${r.doc.name}: ${(inv.ValidationErrors || []).map((e: any) => e.Message).join('; ')}`);
        continue;
      }
      const c: any = r.doc.config;
      await p.document.update({
        where: { id: r.doc.id },
        data: {
          config: {
            ...c,
            date: DATE, dueDate: DUE,
            xeroInvoiceId: inv.InvoiceID, xeroStatus: String(inv.Status || 'DRAFT'),
            xeroSyncedAt: new Date().toISOString(), xeroSyncedBy: 'claude-script:aug-recurring-push',
          } as any,
        },
      });
      console.log(`OK    ${r.doc.name} → ${inv.InvoiceID} (${inv.Status}, total ${inv.Total})`);
    }
  }
  console.log('\ndone');
}
main().catch((e) => { console.error(e.message || e); process.exit(1); }).finally(() => p.$disconnect());
