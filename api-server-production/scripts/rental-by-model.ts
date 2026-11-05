/**
 * How much of each equipment MODEL was billed as rental in a period?
 * (guru 2026-11-05: "the amount of LION 375 being rented out in Oct", then the
 * whole LION family at once.)
 *
 * READ-ONLY — it issues nothing but SELECTs.
 *
 * WHY THIS IS NOT A COLUMN. Biofuel's rental invoices are written in BLOCKS: a
 * 0-amount descriptor line naming the equipment —
 *     "1). Rental of one unit Micro-Grid System
 *      Brand: BIOFUEL   Model: LION375   S/No.: MG20250111"
 * — followed by the priced line that carries the money —
 *     "1a). Rental for the period from 01/10/2026 - 31/10/2026".
 * The money is on a line that never names the model. So each amount is
 * attributed to the model named ON its own line when there is one, and
 * otherwise to the last model named above it: how a person reads the invoice.
 * Model names are compared with spaces and hyphens stripped, so "LION 375",
 * "LION-375" and "LION375" are one model.
 *
 * RENTAL ONLY. A LION line can just as easily be a SALE: on dev, model lines
 * carrying account 217 "Sales of Micro-Grid System" came to $16.6m against
 * $2.5m of account 214 "Rental of Micro-Grid System". Counting both answers a
 * different question than the one asked, so only lines posting to a GL account
 * whose name says Rental are counted. Lines on any other account, and lines
 * with no account at all, are reported underneath so nothing disappears
 * silently. --accounts=214,213 names the accounts explicitly instead;
 * --all-accounts counts every line whatever it posts to.
 *
 * Only ISSUED invoices count — paid, pending_payment, confirmed, partially_paid,
 * overdue. Drafts and unconfirmed rows are listed separately rather than
 * silently added: on dev a single 209k draft was five times the month's real
 * rental, and a total that moves when someone saves a draft is not a figure to
 * report. --include-drafts folds them in.
 *
 * Usage (dev):
 *   TENANCY_MODE= npx ts-node --transpile-only scripts/rental-by-model.ts \
 *     --models=LION375,LION500,LION250,LION125,LION135 \
 *     --from=2026-10-01 --to=2026-11-01 --schema=org_biofuel
 *
 * Usage (prod — schema is public):
 *   ./node_modules/.bin/dotenv -e .env.production -- \
 *     npx ts-node --transpile-only scripts/rental-by-model.ts \
 *     --models=LION375,LION500,LION250,LION125,LION135 \
 *     --from=2026-10-01 --to=2026-11-01 --schema=public
 *
 * Add --detail to list every invoice line under each model.
 */
import { createScriptPrisma } from './xero-migration/_common';
const prisma = createScriptPrisma();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d);

const SCHEMA = arg('schema', 'org_biofuel');
const FROM = new Date(`${arg('from', '2026-10-01')}T00:00:00Z`);
const TO = new Date(`${arg('to', '2026-11-01')}T00:00:00Z`);
const DETAIL = process.argv.includes('--detail');
const INCLUDE_DRAFTS = process.argv.includes('--include-drafts');

/** "LION 375" / "lion-375" / "LION375" all key as LION375. */
const norm = (v: string) => v.toUpperCase().replace(/[\s\-_]/g, '');
const TARGETS = (arg('models') || arg('model') || 'LION375').split(',').map((t) => t.trim()).filter(Boolean);
const KEYS = TARGETS.map(norm);

const ACCOUNTS = arg('accounts') ? new Set(arg('accounts').split(',').map((a) => a.trim())) : null;
const ALL_ACCOUNTS = process.argv.includes('--all-accounts');

const SERIAL = /S\/No\.?:\s*([A-Z0-9\-]+)/i;
const m = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ISSUED = new Set(['paid', 'pending_payment', 'confirmed', 'partially_paid', 'overdue']);

/** Which target does this line name, if any? Matches the model wherever it
 *  appears — inside "Model: X" or written plainly in the description. */
function targetIn(desc: string): string | null {
  const flat = norm(desc);
  let best: string | null = null;
  let at = Infinity;
  for (const k of KEYS) {
    const i = flat.indexOf(k);
    // A longer key wins a tie so LION500 is never read as LION5.
    if (i >= 0 && (i < at || (i === at && best && k.length > best.length))) { at = i; best = k; }
  }
  return best;
}

(async () => {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, name, status, config FROM "${SCHEMA}"."Document" WHERE type = 'INVOICE'`);

  // Which accounts count as rental: by name, so a new rental account is picked
  // up without editing this script.
  const coa: any[] = await prisma.$queryRawUnsafe(
    `SELECT code, name FROM "${SCHEMA}"."ChartOfAccount"`);
  const accountName = new Map<string, string>(coa.map((a: any) => [String(a.code), String(a.name)]));
  const isRental = (code: string | null) => {
    if (ALL_ACCOUNTS) return true;
    if (!code) return false;
    if (ACCOUNTS) return ACCOUNTS.has(code);
    return /rental/i.test(accountName.get(code) ?? '');
  };

  type Acc = { net: number; tax: number; serials: Set<string>; lines: string[]; invoices: Set<string> };
  const acc = new Map<string, Acc>(KEYS.map((k) => [k, { net: 0, tax: 0, serials: new Set(), lines: [], invoices: new Set() }]));
  const pending: string[] = [];
  const otherAccounts = new Map<string, { n: number; amt: number }>();
  let voided = 0, scanned = 0;

  for (const r of rows) {
    const c: any = r.config || {};
    const d = c.date ? new Date(c.date) : null;
    if (!d || isNaN(+d) || d < FROM || d >= TO) continue;
    scanned++;
    const isVoid = c.voided === true || String(c.xeroStatus).toUpperCase() === 'VOIDED' || String(r.status).toLowerCase() === 'void';
    const issued = ISSUED.has(String(r.status).toLowerCase());

    let current: string | null = null, serial: string | null = null;
    for (const it of c.items || []) {
      const desc = String(it.description || '');
      const named = targetIn(desc);
      if (named) { current = named; const s = SERIAL.exec(desc); serial = s ? s[1] : serial; }
      else if (/Model:/i.test(desc)) { current = null; serial = null; }  // a different model starts here

      const amt = Number(it.amount) || 0;
      if (amt === 0) continue;                        // descriptor line, no money
      const key = named || current;
      if (!key) continue;

      if (isVoid) { voided++; continue; }

      // Rental only — a sale of the same model is a different question.
      const code = it.accountCode == null ? null : String(it.accountCode);
      if (!isRental(code)) {
        const label = code ? `${code}  ${accountName.get(code) ?? '(not in chart)'}` : '(no account on the line)';
        const e = otherAccounts.get(label) || { n: 0, amt: 0 };
        e.n++; e.amt += amt; otherAccounts.set(label, e);
        continue;
      }

      const line = `    ${String(r.name).padEnd(14)} ${d.toISOString().slice(0, 10)}  ${String(c.customer?.name ?? '(no customer)').slice(0, 30).padEnd(30)} ${m(amt).padStart(12)}  ${serial ?? ''}`;
      if (!issued && !INCLUDE_DRAFTS) { pending.push(`${line}  [${r.status}]`); continue; }
      const a = acc.get(key)!;
      a.net += amt; a.tax += Number(it.taxAmount) || 0;
      a.invoices.add(r.name);
      if (serial) a.serials.add(serial);
      a.lines.push(line);
    }
  }

  console.log(`\nRental billed ${FROM.toISOString().slice(0, 10)} → ${TO.toISOString().slice(0, 10)}   [schema ${SCHEMA}]`);
  console.log(`${scanned} invoice(s) dated in this period${voided ? `, ${voided} voided line(s) excluded` : ''}\n`);
  console.log(`  ${'Model'.padEnd(12)}${'Invoices'.padStart(10)}${'Units'.padStart(8)}${'Rental (ex GST)'.padStart(18)}${'GST'.padStart(14)}${'Total'.padStart(16)}`);
  console.log(`  ${'-'.repeat(76)}`);
  let tN = 0, tT = 0, tU = 0;
  for (const [i, k] of KEYS.entries()) {
    const a = acc.get(k)!;
    tN += a.net; tT += a.tax; tU += a.serials.size;
    console.log(`  ${TARGETS[i].padEnd(12)}${String(a.invoices.size).padStart(10)}${String(a.serials.size).padStart(8)}${m(a.net).padStart(18)}${m(a.tax).padStart(14)}${m(a.net + a.tax).padStart(16)}`);
  }
  console.log(`  ${'-'.repeat(76)}`);
  console.log(`  ${'TOTAL'.padEnd(12)}${''.padStart(10)}${String(tU).padStart(8)}${m(tN).padStart(18)}${m(tT).padStart(14)}${m(tN + tT).padStart(16)}\n`);

  for (const [i, k] of KEYS.entries()) {
    const a = acc.get(k)!;
    if (!a.serials.size) continue;
    console.log(`  ${TARGETS[i]} units billed (${a.serials.size}): ${Array.from(a.serials).sort().join(', ')}`);
  }
  if (DETAIL) for (const [i, k] of KEYS.entries()) {
    const a = acc.get(k)!;
    if (!a.lines.length) continue;
    console.log(`\n  ${TARGETS[i]} — ${a.lines.length} line(s):`);
    for (const l of a.lines) console.log(l);
  }
  if (otherAccounts.size) {
    console.log(`\n  NOT RENTAL — ${TARGETS.join('/')} lines in this period posting elsewhere:`);
    for (const [label, e] of [...otherAccounts.entries()].sort((a, b) => b[1].amt - a[1].amt))
      console.log(`    ${label.padEnd(50)} ${String(e.n).padStart(4)} line(s)  ${m(e.amt).padStart(14)}`);
    console.log('    (--all-accounts counts these too; --accounts=214,213 names accounts explicitly.)');
  }
  if (pending.length) {
    console.log(`\n  NOT COUNTED — ${pending.length} line(s) on draft/unconfirmed invoices:`);
    for (const p of pending) console.log(p);
    console.log('  (--include-drafts folds these into the totals.)');
  }
  console.log('');
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
