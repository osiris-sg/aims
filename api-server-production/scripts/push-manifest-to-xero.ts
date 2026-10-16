/**
 * AIMS → Xero push for the 2026-10-15 two-way sync (guru).
 *
 * Pushes every unlinked AIMS document as a Xero DRAFT, EXCEPT the categories
 * guru held back:
 *   - October rentals, identified BY NUMBER RANGE  (BI202610*)   — his call
 *   - JP pass BILLS                                (JP#######)
 *   - JP pass CHARGES on the sales side — matched on the LINE TEXT
 *     ("Jurong Port Pass Application"), NOT the BIPL-JPSG prefix, because that
 *     same prefix also carries the Jurong Port soil-disposal invoices, which
 *     are real revenue and must still go across.
 *   - zero-value shells, the 2023 "testing" record and the 2021 back charge
 *
 * DRAFT deliberately: a Xero draft posts no journal, so this cannot recreate
 * the AIMS-native + Xero-imported double-posting that had to be cleaned up on
 * the AR side. The accountant approves in Xero.
 *
 * Runs on the SECOND Xero app (_xero2-tokens.json) — the main connection's
 * daily quota was spent by the GL wipe-and-reload.
 *
 *   npx ts-node --transpile-only scripts/push-manifest-to-xero.ts [--apply] [--only=NAME]
 *
 * Dry-run by default. Idempotent: anything already in Xero under the same
 * number is skipped, so a re-run cannot duplicate.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');

neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: fs.readFileSync('.env.production', 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }),
} as any);

const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const API = 'https://api.xero.com/api.xro/2.0';
const APPLY = process.argv.includes('--apply');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
const R = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Xero renders descriptions as PLAIN TEXT; raw editor HTML shows up literally.
const ENT: Record<string, string> = { amp: '&', nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#160': ' ' };
const toText = (h: any) => String(h ?? '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li|tr)>/gi, '').replace(/<(div|p|li|tr)\b[^>]*>/gi, '\n')
  .replace(/<[^>]+>/g, '').replace(/&(#?\w+);/g, (m, k) => ENT[k.toLowerCase()] ?? m)
  .replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// config.referenceNo is CANONICAL; the rest are legacy writers.
const refOf = (c: any) => String(c?.documentInfo?.referenceNo || c?.referenceNo || c?.documentInfo?.reference || c?.reference || c?.xeroReference || '').slice(0, 255);
const grossOf = (c: any) => Number(c?.totalWithTax ?? c?.nettTotal ?? c?.xeroGross ?? c?.totalAmount ?? 0);
const lineText = (c: any) => (c?.items || []).map((i: any) => toText(i.description)).join(' | ');
const isJpPass = (c: any) => /jurong\s*port\s*pass|pass application/i.test(lineText(c));

// ── app2 tokens ───────────────────────────────────────────────────────────
const TF = __dirname + '/_xero2-tokens.json';
let TK: { at: string; tid: string };
async function tokens() {
  const t = JSON.parse(fs.readFileSync(TF, 'utf8'));
  if (t.expiresAt - Date.now() > 5 * 60 * 1000) return { at: t.accessToken, tid: t.tenantId };
  const basic = Buffer.from(`${t.clientId}:${t.clientSecret}`).toString('base64');
  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refreshToken }),
  });
  if (!res.ok) throw new Error(`app2 refresh ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const n: any = await res.json();
  fs.writeFileSync(TF, JSON.stringify({ ...t, accessToken: n.access_token, refreshToken: n.refresh_token, expiresAt: Date.now() + n.expires_in * 1000 }, null, 2));
  return { at: n.access_token, tid: t.tenantId };
}
async function xero(method: string, path: string, body?: any): Promise<any> {
  for (let i = 0; i < 6; i++) {
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${TK.at}`, 'Xero-Tenant-Id': TK.tid, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch { await sleep((i + 1) * 10000); continue; }
    if (res.status === 401) { TK = await tokens(); continue; }
    if (res.status === 429) {
      const w = parseInt(res.headers.get('Retry-After') || '60', 10);
      if (w > 600) throw new Error(`DAILY_CAP: Xero says wait ${w}s — stop and resume tomorrow`);
      console.log(`  ⏸ rate limit, ${w}s`); await sleep(w * 1000); continue;
    }
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Surface Xero's actual ValidationErrors — the echoed document is long
      // and pushes the real reason past any sane truncation.
      const el = j?.Elements?.[0];
      const errs = [
        ...(el?.ValidationErrors || []).map((v: any) => v.Message),
        ...((el?.LineItems || []).flatMap((li: any) => (li.ValidationErrors || []).map((v: any) => v.Message))),
      ];
      throw new Error(`${res.status}: ${errs.length ? errs.join(' | ') : JSON.stringify(j).slice(0, 300)}`);
    }
    return j;
  }
  throw new Error('gave up after retries');
}

(async () => {
  console.log(`AIMS → Xero (app2, DRAFT)   ${APPLY ? '*** APPLY ***' : 'DRY RUN'}\n`);
  TK = await tokens();

  const accts = await xero('GET', '/Accounts');
  const validCodes = new Set((accts.Accounts || []).filter((a: any) => a.Status === 'ACTIVE').map((a: any) => a.Code).filter(Boolean));

  const [custs, sups, coa] = await Promise.all([
    prisma.customer.findMany({ where: { organizationId: ORG }, select: { id: true, name: true, xeroId: true } }),
    prisma.supplier.findMany({ where: { organizationId: ORG }, select: { id: true, name: true, xeroId: true } }),
    prisma.chartOfAccount.findMany({ where: { organizationId: ORG }, select: { id: true, code: true } }),
  ]);
  const custById = new Map(custs.map((c: any) => [c.id, c]));
  const supById = new Map(sups.map((s: any) => [s.id, s]));
  const codeById = new Map(coa.map((a: any) => [a.id, a.code]));

  const docs = await prisma.document.findMany({
    where: { organizationId: ORG, type: { in: ['INVOICE', 'TI', 'TI2', 'BILL', 'CREDIT_NOTE'] } },
    select: { id: true, name: true, type: true, status: true, config: true },
    orderBy: { name: 'asc' },
  });

  const held: Record<string, string[]> = { oct: [], jpBill: [], jpPass: [], zero: [], junk: [], linked: [] };
  const blocked: Array<[string, string]> = [];
  const queue: any[] = [];

  for (const d of docs) {
    const c: any = d.config || {};
    const name = d.name || '';
    if (ONLY && name !== ONLY) continue;
    if (c.xeroInvoiceId || c.xeroBillId || c.xeroCreditNoteId) { held.linked.push(name); continue; }
    if (/^BI202610/.test(name)) { held.oct.push(name); continue; }
    if (d.type === 'BILL' && /^JP[0-9]/.test(name)) { held.jpBill.push(name); continue; }
    if (isJpPass(c)) { held.jpPass.push(name); continue; }
    if (name === 'INV-017' || name === 'JV2112-01') { held.junk.push(name); continue; }
    const gross = grossOf(c);
    if (Math.abs(gross) <= 0.005) { held.zero.push(name); continue; }

    // ── fitness checks: refuse to send a document that would land as junk ──
    const problems: string[] = [];
    // A placeholder number would become the Xero invoice number verbatim.
    if (/x{3,}/i.test(name)) problems.push('placeholder number — fix the document number first');
    const isBill = d.type === 'BILL';
    // A CREDIT_NOTE is NOT an invoice: sent to /Invoices as ACCREC it would
    // post a CHARGE to the customer instead of a credit. It goes to
    // /CreditNotes as ACCRECCREDIT / ACCPAYCREDIT.
    const isCredit = d.type === 'CREDIT_NOTE';
    const onSupplierSide = isBill || (isCredit && !!c.supplierId);
    const party = onSupplierSide ? (c.supplierId ? supById.get(c.supplierId) : null) : (c.customerId ? custById.get(c.customerId) : null);
    if (!party) problems.push(`no ${onSupplierSide ? 'supplier' : 'customer'} linked`);
    else if (!(party as any).xeroId) problems.push(`${onSupplierSide ? 'supplier' : 'customer'} "${(party as any).name}" has no Xero contact`);
    const date = String(c.date || c.billDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push(`bad date "${c.date ?? c.billDate ?? ''}"`);
    else if (date > '2027-01-01') problems.push(`date ${date} is in the future`);
    const items: any[] = Array.isArray(c.items) && c.items.length ? c.items : [];
    if (!items.length) problems.push('no line items');
    if (problems.length) { blocked.push([name, problems.join('; ')]); continue; }

    queue.push({ doc: d, config: c, name, gross, date, party, isBill, isCredit, items });
  }

  // Idempotency: what already exists in Xero under these numbers?
  const existing = new Set<string>();
  if (queue.length) {
    const nums = queue.filter((q) => !q.isCredit).map((q) => q.name);
    for (let i = 0; i < nums.length; i += 40) {
      const where = nums.slice(i, i + 40).map((n) => `InvoiceNumber=="${n.replace(/"/g, '')}"`).join(' OR ');
      const r = await xero('GET', `/Invoices?where=${encodeURIComponent(where)}`);
      for (const inv of r.Invoices || []) existing.add(inv.InvoiceNumber);
    }
    if (queue.some((q) => q.isCredit)) {
      const r = await xero('GET', '/CreditNotes');
      for (const cn of r.CreditNotes || []) if (cn.CreditNoteNumber) existing.add(cn.CreditNoteNumber);
    }
  }

  let pushed = 0, skipped = 0, failed = 0;
  console.log('TO PUSH');
  for (const q of queue) {
    if (existing.has(q.name)) { skipped++; console.log(`  ↷ ${q.name.padEnd(30)} already in Xero`); continue; }

    const taxAmt = R(q.config.gstAmount ?? q.config.taxAmount ?? 0);
    const noTax = taxAmt === 0;
    const lines = q.items.map((it: any) => {
      const amount = R(it.amount ?? (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0));
      const code = it.accountCode || (it.accountId ? codeById.get(it.accountId) : undefined);
      const L: any = { Description: toText(it.description) || '.', LineAmount: amount, TaxType: noTax ? 'NONE' : 'TAX001' };
      // qty 0/blank prints bare, matching the AIMS document.
      // Xero enforces LineAmount == Quantity x UnitAmount and rejects the whole
      // document otherwise. In AIMS the AMOUNT is authoritative (it carries
      // agreed prices and rounding the unit rate cannot express — e.g.
      // ID202603-028 at 65,400 against 1 x 60,000, and cent-level rounding on
      // the soil tonnage invoices). So when the two disagree, send the amount
      // bare rather than let Xero recompute a different figure.
      const qty = Number(it.quantity) || 0;
      const unit = Number(it.unitPrice) || 0;
      // Only send qty/unit when their product lands EXACTLY on a cent.
      // Xero does decimal arithmetic; JS does binary. 403.71 x 17.5 is exactly
      // 7064.925, which Xero rounds UP to 7064.93 while JS computes
      // 7064.9249999... and rounds DOWN to 7064.92 — the two then disagree and
      // Xero rejects the whole document. A fractional-cent product can never be
      // expressed as qty x unit the same way in both systems, so in that case
      // send the authoritative AIMS amount bare and let Xero take it as given.
      const cents = qty * unit * 100;
      const exactCent = Math.abs(cents - Math.round(cents)) < 1e-6;
      if (qty > 0 && exactCent && R(qty * unit) === amount) { L.Quantity = qty; L.UnitAmount = unit; }
      if (code && validCodes.has(String(code))) L.AccountCode = String(code);
      return L;
    });

    const payload: any = {
      Type: q.isCredit ? (q.config.supplierId ? 'ACCPAYCREDIT' : 'ACCRECCREDIT') : q.isBill ? 'ACCPAY' : 'ACCREC',
      Contact: { ContactID: (q.party as any).xeroId },
      Date: q.date,
      ...(q.isCredit ? {} : { DueDate: String(q.config.dueDate || q.date).slice(0, 10) }),
      ...(q.isCredit ? { CreditNoteNumber: q.name } : { InvoiceNumber: q.name }),
      Reference: refOf(q.config),
      LineAmountTypes: noTax ? 'NoTax' : (String(q.config.taxApplicable || '').toUpperCase() === 'I' ? 'Inclusive' : 'Exclusive'),
      Status: 'DRAFT',
      LineItems: lines,
    };

    console.log(`  → ${q.name.padEnd(30)} ${(q.isCredit ? 'CN' : q.isBill ? 'BILL' : 'INV').padEnd(5)} ${q.date} ${String(R(q.gross)).padStart(12)}  ${(q.party as any).name.slice(0, 26)}`);
    if (!APPLY) continue;
    try {
      const res = q.isCredit
        ? await xero('POST', '/CreditNotes', { CreditNotes: [payload] })
        : await xero('POST', '/Invoices', { Invoices: [payload] });
      const inv = q.isCredit ? (res.CreditNotes || [])[0] : (res.Invoices || [])[0];
      const xid = q.isCredit ? inv?.CreditNoteID : inv?.InvoiceID;
      if (!xid) throw new Error('Xero returned no id');
      const key = q.isCredit ? 'xeroCreditNoteId' : q.isBill ? 'xeroBillId' : 'xeroInvoiceId';
      await prisma.document.update({
        where: { id: q.doc.id },
        data: { config: { ...q.config, [key]: xid, xeroInvoiceNumber: inv.InvoiceNumber ?? inv.CreditNoteNumber, xeroStatus: inv.Status, xeroSyncedAt: new Date().toISOString(), xeroSyncedBy: 'push-manifest-2026-10-15' } as any },
      });
      pushed++;
      await sleep(400);
    } catch (e: any) {
      failed++;
      console.log(`     ✗ ${String(e.message).slice(0, 900)}`);
      if (String(e.message).startsWith('DAILY_CAP')) break;
    }
  }

  console.log(`\nRESULT  pushed ${pushed}   already there ${skipped}   failed ${failed}   blocked ${blocked.length}`);
  if (blocked.length) {
    console.log('\nBLOCKED — not fit to send, left untouched:');
    blocked.forEach(([n, why]) => console.log(`  ✗ ${n.padEnd(30)} ${why}`));
  }
  console.log('\nHELD BACK');
  console.log(`  Oct rentals BI202610*        ${held.oct.length}`);
  console.log(`  JP pass bills                ${held.jpBill.length}`);
  console.log(`  JP pass charges (invoices)   ${held.jpPass.length}`);
  console.log(`  zero-value shells            ${held.zero.length}`);
  console.log(`  test / 2021 back charge      ${held.junk.length}`);
  console.log(`  already linked to Xero       ${held.linked.length}`);
  if (!APPLY) console.log('\nDRY RUN — re-run with --apply to push.');
})()
  .catch((e) => { console.error('❌', e.message || e); process.exit(1); })
  .finally(() => prisma.$disconnect());
