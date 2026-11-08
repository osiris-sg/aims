/**
 * Chong Aik — bring the legacy CREDITOR LISTING into document-level AP (guru
 * 2026-11-06: "how come no AP?").
 *
 * The books import stamped every bill PAID and left Trade Creditors to the GL
 * (CL001 nets to a 903,274.94 DEBIT — 41 suppliers carry debit balances /
 * prepayments, only 9 are actually owed, 5,170.13 in all). Aged payables only
 * count bills with money still owed, so the AP page was empty.
 *
 * For each supplier the listing shows as OWED (negative Local Amount):
 *   1. re-open the supplier's newest bills whose totals add up to the balance
 *      exactly (newest-first, then a small subset search) — real references;
 *   2. any remainder becomes ONE header-only "BAL <code>" bill dated at the GL
 *      cut-off, no journal (the GL already carries CL001), kind BALANCE.
 * Debit balances are listed and skipped — AIMS has no supplier-debit row in
 * aged payables (see the report to guru).
 *
 *   npx ts-node --transpile-only scripts/import-chongaik-creditor-balances.ts --env dev|staging|prod [--dir ~/Downloads/chongaik-books] [--apply]
 */
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { randomUUID } from 'crypto';
import { stampDocumentMoney } from '../src/common/document-money';
import { clientsFor, loadEnv, type Env } from './lib/tenancy-clients';

const args = process.argv.slice(2);
const argVal = (k: string, d?: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const ENV = (argVal('--env', 'dev') || 'dev') as Env;
const APPLY = args.includes('--apply');
const DIR = argVal('--dir', path.join(process.env.HOME || '', 'Downloads', 'chongaik-books'))!;
const ORG_ID = 'ca100000-0000-4000-8000-ca1000000001';
const CUTOFF = '2026-05-31'; // last GL date in the export; the listing's total equals CL001 there
const SOURCE = 'chongaik-creditor-listing';
const ACTOR = 'legacy-import';
const R = (n: number) => Math.round(n * 100) / 100;
const s = (v: any) => (v == null ? '' : String(v).trim());

loadEnv(ENV);
const { plat, org, disconnect } = clientsFor(ENV, 'org_chongaik');

type Row = { code: string; name: string; amount: number };
function readListing(): Row[] {
  const f = path.join(DIR, 'CREDITOR_LISTING.xlsx');
  if (!fs.existsSync(f)) throw new Error(`missing ${f}`);
  const wb = XLSX.readFile(f);
  const raw: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  const out: Row[] = [];
  for (const r of raw) {
    const c = r.filter((x) => x != null && s(x) !== '');
    if (c.length < 3 || typeof c[2] !== 'number' || s(c[0]) === 'Iden' || s(c[0]).toUpperCase() === 'TOTAL') continue;
    out.push({ code: s(c[0]).toUpperCase(), name: s(c[1]), amount: R(c[2]) });
  }
  return out;
}

// The supplier's NEWEST bills, taken in order, must add up to the balance
// exactly — the natural "last N invoices still unpaid" shape. Anything else
// (a subset-sum over older bills) is a guess, not evidence → balance bill.
function pickBills(bills: any[], target: number): any[] | null {
  let acc = 0; const greedy: any[] = [];
  for (const b of bills) { if (acc >= target - 0.005) break; acc = R(acc + b.total); greedy.push(b); }
  return Math.abs(acc - target) < 0.01 ? greedy : null;
}

(async () => {
  const listing = readListing();
  const owed = listing.filter((r) => r.amount < 0);
  const debit = listing.filter((r) => r.amount > 0);
  console.log(`${ENV} · ${APPLY ? '*** APPLY ***' : 'dry run'} · listing ${listing.length} suppliers, total ${R(listing.reduce((t, r) => t + r.amount, 0)).toLocaleString()}`);
  console.log(`  owed (→ AP): ${owed.length} suppliers, ${R(-owed.reduce((t, r) => t + r.amount, 0)).toLocaleString()} · debit balances (skipped): ${debit.length} suppliers, ${R(debit.reduce((t, r) => t + r.amount, 0)).toLocaleString()}`);

  const sups = await org.supplier.findMany({ where: { organizationId: ORG_ID }, select: { id: true, supplierCode: true, name: true } });
  const byCode = new Map<string, any>(sups.map((x: any) => [s(x.supplierCode).toUpperCase(), x]));
  const allBills = await org.document.findMany({ where: { organizationId: ORG_ID, type: 'BILL' }, select: { id: true, name: true, status: true, config: true, documentTemplateId: true } });
  const tplId = allBills[0]?.documentTemplateId;
  if (!tplId) throw new Error('no BILL template on this org');

  let reopened = 0, reopenedAmt = 0, created = 0, createdAmt = 0;
  for (const r of owed) {
    const sp = byCode.get(r.code);
    if (!sp) { console.log(`  ${r.code} ${r.name}: supplier not in AIMS — skipped`); continue; }
    const target = R(-r.amount);
    // Self-correcting: undo what an earlier run of THIS script did for the
    // supplier (re-opened bills back to PAID, balance bill removed), then pick
    // again from a clean slate.
    const ours = allBills.filter((b: any) => b.config?.supplierId === sp.id && b.config?.legacyReopened === SOURCE);
    const ourBal = allBills.filter((b: any) => b.config?.legacyKey === `CREDITOR|${r.code}`);
    if (APPLY) {
      for (const b of ours) {
        const total = R(Number((b.config as any).totalAmount || 0));
        const { legacyReopened, ...rest } = b.config as any;
        await org.document.update({ where: { id: b.id }, data: { status: 'paid', config: stampDocumentMoney({ ...rest, amountPaid: total, billStatus: 'PAID' }, { gross: total, paid: total, outstanding: 0 }) } });
        (b.config as any).outstandingBalance = 0; delete (b.config as any).legacyReopened;
      }
      if (ourBal.length) { await org.document.deleteMany({ where: { id: { in: ourBal.map((b: any) => b.id) } } }); for (const b of ourBal) allBills.splice(allBills.indexOf(b), 1); }
    }
    const mine = allBills
      .filter((b: any) => b.config?.supplierId === sp.id && b.config?.kind !== 'BALANCE' && b.config?.kind !== 'SPR') // returns reduce AP, never re-opened
      .map((b: any) => ({ id: b.id, name: b.name, date: String(b.config.date || '').slice(0, 10), total: R(Number(b.config.totalAmount || 0)), outstanding: R(Number(b.config.outstandingBalance ?? 0)), config: b.config }))
      .sort((a, b) => b.date.localeCompare(a.date));
    const picked = pickBills(mine.filter((b) => APPLY || b.outstanding <= 0.005 || b.config?.legacyReopened === SOURCE), target);
    if (picked) {
      console.log(`  ${r.code} ${r.name.slice(0, 32).padEnd(32)} owed ${target.toFixed(2).padStart(9)} → re-open ${picked.length} bill(s): ${picked.map((b) => `${b.name} ${b.total}`).join(', ')}`);
      reopened += picked.length; reopenedAmt = R(reopenedAmt + target);
      if (APPLY) for (const b of picked) {
        const config = stampDocumentMoney({ ...b.config, amountPaid: 0, billStatus: 'POSTED', legacyReopened: SOURCE }, { gross: b.total, paid: 0, outstanding: b.total });
        await org.document.update({ where: { id: b.id }, data: { status: 'confirmed', config } });
      }
    } else {
      console.log(`  ${r.code} ${r.name.slice(0, 32).padEnd(32)} owed ${target.toFixed(2).padStart(9)} → no exact bill match (${mine.length} bills) → BAL ${r.code} balance bill`);
      created++; createdAmt = R(createdAmt + target);
      if (APPLY) {
        let config: any = {
          legacyKey: `CREDITOR|${r.code}`, legacyImported: true, importSource: SOURCE, kind: 'BALANCE',
          supplierId: sp.id, supplier: { id: sp.id, name: sp.name },
          billDate: `${CUTOFF}T00:00:00.000Z`, date: `${CUTOFF}T00:00:00.000Z`, dueDate: null,
          reference: `BAL ${r.code}`, referenceNo: `BAL ${r.code}`, description: `Legacy creditor balance as at ${CUTOFF} (creditor listing)`, currency: 'SGD',
          subtotal: target, taxAmount: 0, totalAmount: target, amountPaid: 0, amountsAre: 'NO_TAX',
          documentInfo: { taxCode: null, gstPercent: 0, absorbTax: false, currency: 'SGD' },
          lines: [], items: [], billStatus: 'POSTED',
          inboundChannel: 'IMPORT', inboundMeta: { source: SOURCE, balanceOnly: true },
          journalEntryId: null, postedAt: `${CUTOFF}T00:00:00.000Z`,
        };
        config = stampDocumentMoney(config, { gross: target, paid: 0, outstanding: target });
        await org.document.create({ data: { id: randomUUID(), organizationId: ORG_ID, documentTemplateId: tplId, type: 'BILL', name: `BAL ${r.code}`, status: 'confirmed', config, createdAt: new Date(`${CUTOFF}T00:00:00.000Z`) } as any });
      }
    }
  }
  // ── Debit balances — "the legacy way, just like Biofuel" (guru 2026-11-08).
  // Each supplier the listing shows IN DEBIT gets one header-only AP CREDIT
  // NOTE (the Xero ACCPAYCREDIT shape Biofuel's books carry: type CREDIT_NOTE,
  // config.subtype 'AP') dated at the cut-off, no journal — the GL already
  // carries CL001. Supplier statements and the document trail then show the
  // credit; aged payables (open bills only) stays unchanged, same as Biofuel.
  const allCns = await org.document.findMany({ where: { organizationId: ORG_ID, type: 'CREDIT_NOTE' }, select: { id: true, name: true, config: true } });
  const cnTpl = (await plat.documentTemplate.findFirst({ where: { type: 'CREDIT_NOTE' }, select: { id: true } }))?.id || tplId;
  let cnCreated = 0, cnAmt = 0;
  for (const r of debit) {
    const sp = byCode.get(r.code);
    if (!sp) { console.log(`  ${r.code} ${r.name}: supplier not in AIMS — debit balance skipped`); continue; }
    const amount = R(r.amount);
    const key = `CREDITOR-DR|${r.code}`;
    const ours = allCns.filter((d: any) => d.config?.legacyKey === key);
    if (APPLY && ours.length) await org.document.deleteMany({ where: { id: { in: ours.map((d: any) => d.id) } } });
    console.log(`  ${r.code} ${r.name.slice(0, 32).padEnd(32)} in debit ${amount.toFixed(2).padStart(9)} → AP credit note BAL-DR ${r.code}`);
    cnCreated++; cnAmt = R(cnAmt + amount);
    if (APPLY) {
      let config: any = {
        legacyKey: key, legacyImported: true, importSource: SOURCE, kind: 'BALANCE', subtype: 'AP',
        supplierId: sp.id, supplier: { id: sp.id, name: sp.name }, supplierName: sp.name,
        date: `${CUTOFF}T00:00:00.000Z`, dueDate: null,
        reference: `BAL-DR ${r.code}`, referenceNo: `BAL-DR ${r.code}`,
        description: `Legacy creditor DEBIT balance as at ${CUTOFF} (creditor listing) — supplier credit carried forward`, currency: 'SGD',
        subtotal: amount, taxAmount: 0, totalAmount: amount, amountsAre: 'NO_TAX',
        documentInfo: { taxCode: null, gstPercent: 0, absorbTax: false, currency: 'SGD' },
        lines: [], items: [],
        inboundChannel: 'IMPORT', inboundMeta: { source: SOURCE, balanceOnly: true },
        journalEntryId: null, postedAt: `${CUTOFF}T00:00:00.000Z`,
      };
      config = stampDocumentMoney(config, { gross: amount, paid: 0, outstanding: amount });
      await org.document.create({ data: { id: randomUUID(), organizationId: ORG_ID, documentTemplateId: cnTpl, type: 'CREDIT_NOTE', name: `BAL-DR ${r.code}`, status: 'confirmed', config, createdAt: new Date(`${CUTOFF}T00:00:00.000Z`) } as any });
    }
  }

  console.log(`\n  ${APPLY ? 'done' : 'would do'}: re-open ${reopened} bills (${reopenedAmt.toLocaleString()}) + create ${created} balance bills (${createdAmt.toLocaleString()}) → AP ${R(reopenedAmt + createdAmt).toLocaleString()}`);
  console.log(`  + ${cnCreated} supplier-credit notes (AP subtype, ${cnAmt.toLocaleString()}) for the debit balances — shown on supplier statements, not in aged payables (same as Biofuel)`);
  await disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
