/**
 * Build Osiris Technology's general ledger from the Aspire data.
 *
 *   1. Every issued sales invoice   → Dr CA001 Trade Receivables / Cr revenue
 *   2. Every bank transaction       → Dr/Cr CA101 Aspire — SGD + its contra
 *
 * Payments to individuals are NOT classified — guru is reviewing them one by
 * one (2026-08-18), so they park in CA900 Suspense and the P&L is understated
 * in expenses (i.e. profit overstated) by that balance until they're moved.
 *
 * Sources (deduped by Aspire transaction ID — the two exports overlap 11 days):
 *   ~/Downloads/osiris_technol_sgd_20260803130444.pdf   604 txns → 31 Jul 2026
 *   ~/Downloads/osiris_technol_sgd_20260818035530.csv    34 new  → 17 Aug 2026
 *
 * Dry:    npx ts-node --transpile-only scripts/_osiris-post-ledger.ts .env.production
 * Apply:  ... --apply          Reset first: ... --apply --reset
 */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

const envFile = process.argv[2] || '.env.production';
const APPLY = process.argv.includes('--apply');
const RESET = process.argv.includes('--reset');
const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);

const ORG = 'd068f159-e45a-4da8-beaf-62e903f44141';
const SCRATCH = '/private/tmp/claude-501/-Users-guru-Documents-GitHub-aims/d7f521e6-33f7-4c8a-a142-5ca2a1753301/scratchpad';
const BANK = 'CA101';
const AR = 'CA001';
const SUSPENSE = 'CA900';
const R = (n: number) => Math.round(n * 100) / 100;

// ─────────────────────────────────────────────────────────────────────────────
// Counterparty → account. First match wins. `hold: true` = park in suspense.
// ─────────────────────────────────────────────────────────────────────────────
type Rule = { rx: RegExp; acct: string; label: string; hold?: boolean; customer?: boolean };
const RULES: Rule[] = [
  // ---- customer receipts / refunds to customers: settle AR ----
  { rx: /BIOFUEL INDUSTRIES|ASIA DEAL HUB|AUTOPACK|HIKARI AUTOMATION|CAPPITECH|vendify|SINGAPORE MANAGEMENT UNIV|TAN LING-PING|NEPSEEDS|NGEE ANN POLYTECHNIC(?!.*Pollinate)/i, acct: AR, label: 'Customer receipt', customer: true },
  { rx: /^Paynow/i, acct: AR, label: 'Customer receipt (PayNow)', customer: true },

  // ---- owner / related-party money: held for review with the rest of the people ----
  { rx: /KUMARAGURU S\/O SANMUGAM|^Kumaraguru|^Guru\b/i, acct: SUSPENSE, label: 'Director — Kumaraguru', hold: true },
  { rx: /LWIN MAUNG MAUNG THAW|^lwin\b/i, acct: SUSPENSE, label: 'Related party — Lwin', hold: true },

  // ---- statutory / payroll ----
  { rx: /CENTRAL PROVIDENT FUND/i, acct: 'EX012', label: 'CPF contributions' },

  // ---- incubator ----
  { rx: /Pollinate|Ngee Ann Poly/i, acct: 'EX100', label: 'Incubator / programme fees' },

  // ---- cloud hosting ----
  { rx: /NEON\.TECH|VERCEL|RENDER\.COM|AMAZON WEB SERVICES|DIGITALOCEAN|CLOUDFLARE|Google CLOUD|GOOGLE\*CLOUD|RAILWAY|UPSTASH|MONGODBCLOUD|REPLIT|NGROK/i, acct: 'CS004', label: 'Hosting & infrastructure' },

  // ---- software subscriptions ----
  { rx: /CLAUDE\.AI|ANTHROPIC|OPENAI|CURSOR|BITWARDEN|RESEND|CLERK\.COM|TWILIO|ZOOM|CANVA|WIX\.COM|NAME-CHEAP|GODADDY|LIVECHATAI|LOOKA|Anydesk|Google Workspace|GOOGLE\*GSUITE|Google GSUITE|Google One|GOOGLE \*Play|GOOGLE \*SERVICES|PADDLE|JIJI\.SG|201926326E|WORLDWIDE COMPUTER SOLUTIONS/i, acct: 'EX020', label: 'Software subscriptions' },

  // ---- hardware / components ----
  { rx: /WAVESHARE|MOUSER|dfrobot|AMAZON MAR|Element14|RS Components|CYTRON|DYNACORE/i, acct: 'CS002', label: 'Hardware & components' },
  { rx: /AFTERSHOCK/i, acct: 'FA010', label: 'Computer equipment (capitalised)' },

  // ---- telco ----
  { rx: /CIRCLES\.LIFE|SIMBATELECOM/i, acct: 'EX203', label: 'Telephone & mobile' },

  // ---- bank charges ----
  { rx: /Aspire FT Pte\.? Ltd\.?$|Aspire FT Pte\. Ltd\./i, acct: 'EX040', label: 'Bank charges' },

  // ---- other income ----
  { rx: /Aspire.*(Referral|Cashback)/i, acct: 'IC001', label: 'Cashback / referral income' },

  // ---- subcontract ----
  { rx: /DTMATRIX/i, acct: 'CS003', label: 'Subcontractor' },

  // ---- sundry ----
  { rx: /NTUC FP|LES AMIS/i, acct: 'EX120', label: 'Staff welfare' },
  // Google card holds + their release — net zero, but both sides must post or
  // the bank account misses the 2.00 and stops tying to the statement.
  { rx: /GOOGLE \*TEMPORARY HOLD/i, acct: 'EX020', label: 'Software subscriptions (card hold)' },
];

// Anything that looks like a person (a bare name, no company suffix) is held.
const PERSONISH = /^(Chan Yi Xuan|Elroy Lee|Jeremy Chua|Johnny|Lim Shu Wu|BRIAN TONG|SOBTI GARVIT|LAU WEI BIN|Tai Kin Leong|TAI KIN LEONG|Heimen Hoy|HEIMEN HOY|Dardae|PRADHEEP|Kai Sheng|Tint Lwin|alphashu|deniselum|Shane|JG Jenny|GWYNETH|LEX |Nyan|Kaung)/i;

function classify(cp: string): { acct: string; label: string; hold: boolean; customer: boolean } {
  for (const r of RULES) {
    if (r.rx.test(cp)) return { acct: r.acct, label: r.label, hold: !!r.hold, customer: !!r.customer };
  }
  if (PERSONISH.test(cp.trim())) return { acct: SUSPENSE, label: 'Payment to individual', hold: true, customer: false };
  return { acct: '', label: 'UNCLASSIFIED', hold: false, customer: false };
}

// Revenue account by what the invoice is for.
function revenueAccount(desc: string): string {
  const d = desc.toLowerCase();
  if (/maintenance|maintain|support/.test(d)) return 'SS002';
  if (/software|staging ground|development|licence|license|subscription|website|web/.test(d)) return 'SS003';
  if (/sd card|raspberry|cable|monitor|adapter|camera|router|display|pc|hardware|socket|plug|injector|kit/.test(d)) return 'SS004';
  return 'SS005';
}

type Line = { code: string; debit: number; credit: number; desc: string };
type Entry = { date: Date; type: string; ref: string; desc: string; lines: Line[] };

async function main() {
  console.log(`==== ${envFile} ${APPLY ? '(APPLY)' : '(DRY RUN)'}${RESET ? ' [RESET]' : ''} ====\n`);

  const accounts = await prisma.chartOfAccount.findMany({ where: { organizationId: ORG }, select: { id: true, code: true, name: true } });
  const byCode = new Map(accounts.map((a: any) => [a.code, a]));
  for (const need of [BANK, AR, SUSPENSE, 'SS001', 'SS002', 'SS003', 'SS004', 'SS005', 'IC001', 'CL020']) {
    if (!byCode.has(need)) { console.log(`ABORT — account ${need} is missing. Seed the chart of accounts first.`); return; }
  }

  // ── 1. bank transactions, deduped ──────────────────────────────────────────
  const pdf = JSON.parse(fs.readFileSync(`${SCRATCH}/aspire_txns.json`, 'utf8'));
  const MO: any = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const txns: Array<{ date: Date; cp: string; amount: number; ref: string; desc: string }> = pdf.map((t: any) => {
    const [d, mo, y] = t.date.split(' ');
    return { date: new Date(Date.UTC(+y, MO[mo], +d)), cp: t.counterparty.replace(/\s+/g, ' ').trim(), amount: t.amount, ref: t.ref, desc: t.description || '' };
  });
  const seen = new Set(txns.map((t) => t.ref));

  const csvText = fs.readFileSync(`${SCRATCH}/aug_stmt.csv`, 'utf8');
  const rows = csvText.split(/\r?\n/).filter((l) => l.trim());
  const hdr = rows[0].split('","').map((h) => h.replace(/"/g, ''));
  const col = (name: string) => hdr.indexOf(name);
  let added = 0;
  for (const line of rows.slice(1)) {
    const c = line.replace(/^"|"$/g, '').split('","');
    const id = c[col('Transaction ID')];
    if (!id || seen.has(id)) continue;
    txns.push({
      date: new Date(c[col('Timestamp')].slice(0, 10) + 'T00:00:00.000Z'),
      cp: c[col('Counterparty')].replace(/\s+/g, ' ').trim(),
      amount: R(parseFloat(c[col('Amount (SGD)')].replace(/,/g, ''))),
      ref: id,
      desc: c[col('Reference')] || c[col('Category')] || '',
    });
    seen.add(id); added++;
  }
  txns.sort((a, b) => a.date.getTime() - b.date.getTime());
  console.log(`bank transactions: ${pdf.length} from PDF + ${added} new from CSV = ${txns.length}`);

  const entries: Entry[] = [];
  const unclassified: typeof txns = [];
  for (const t of txns) {
    const c = classify(t.cp);
    if (!c.acct) { unclassified.push(t); continue; }
    const abs = Math.abs(t.amount);
    if (abs < 0.005) continue;
    const desc = `${t.cp}${t.desc ? ` — ${t.desc}` : ''}`.slice(0, 190);
    const lines: Line[] = t.amount > 0
      ? [{ code: BANK, debit: abs, credit: 0, desc }, { code: c.acct, debit: 0, credit: abs, desc }]
      : [{ code: c.acct, debit: abs, credit: 0, desc }, { code: BANK, debit: 0, credit: abs, desc }];
    entries.push({ date: t.date, type: 'MANUAL', ref: t.ref, desc: `${c.label}: ${desc}`.slice(0, 190), lines });
  }

  // ── 2. sales invoices ──────────────────────────────────────────────────────
  // Item text scraped from each Aspire invoice PDF, keyed by invoice number.
  const invoiceItems: Record<string, string> = JSON.parse(fs.readFileSync(`${SCRATCH}/invoice_items.json`, 'utf8'));
  const invCsv = fs.readFileSync(`${SCRATCH}/new_invoices.csv`, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const ih = invCsv[0].split('","').map((h) => h.replace(/"/g, ''));
  const ic = (n: string) => ih.indexOf(n);
  // AIMS holds these two already (Aspire numbers them TI2202607-004 / -005) —
  // post them once, from the AIMS side.
  const ASPIRE_SKIP = new Set(['TI2202607-004', 'TI2202607-005']);
  let invCount = 0, invTotal = 0;
  for (const line of invCsv.slice(1)) {
    const c = line.replace(/^"|"$/g, '').split('","');
    const no = c[ic('Invoice No')];
    const status = c[ic('Status')];
    if (status === 'Draft' || ASPIRE_SKIP.has(no)) continue;
    const amt = R(parseFloat((c[ic('Invoice Amount')] || '0').replace(/,/g, '')));
    if (!(amt > 0)) continue;
    const date = new Date(c[ic('Invoice Date')] + 'T00:00:00.000Z');
    const cust = c[ic('Customer')];
    // Classify off the invoice's own line items (pulled from its PDF), not the
    // invoice number — otherwise everything lands in one catch-all revenue line.
    const rev = revenueAccount(invoiceItems[no] || `${no} ${cust}`);
    const desc = `Invoice ${no} — ${cust}`.slice(0, 190);
    entries.push({ date, type: 'INVOICE', ref: no, desc, lines: [
      { code: AR, debit: amt, credit: 0, desc }, { code: rev, debit: 0, credit: amt, desc },
    ]});
    invCount++; invTotal += amt;
  }

  // AIMS-born invoices (exclude test data, the superseded one, and the unconfirmed duplicate)
  const AIMS_SKIP = new Set(['TI2202605-001', 'TI2202607-003', 'TI2202608-003']);
  const aimsDocs = await prisma.document.findMany({ where: { organizationId: ORG, type: 'INVOICE' }, orderBy: { name: 'asc' } });
  for (const d of aimsDocs as any[]) {
    if (AIMS_SKIP.has(d.name)) continue;
    const cfg: any = d.config || {};
    const amt = R(cfg.nettTotal || 0);
    if (!(amt > 0)) continue;
    const items = (cfg.items || []).map((i: any) => i.description || '').join(' ');
    const rev = revenueAccount(items || cfg.referenceNo || '');
    const desc = `Invoice ${d.name} — ${cfg.customerName || 'n/a'}`.slice(0, 190);
    entries.push({ date: new Date(`${cfg.date}T00:00:00.000Z`), type: 'INVOICE', ref: d.name, desc, lines: [
      { code: AR, debit: amt, credit: 0, desc }, { code: rev, debit: 0, credit: amt, desc },
    ]});
    invCount++; invTotal += amt;
  }
  console.log(`sales invoices:    ${invCount}  totalling ${invTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);

  // ── report ────────────────────────────────────────────────────────────────
  const bucket = new Map<string, { n: number; dr: number; cr: number }>();
  for (const e of entries) for (const l of e.lines) {
    const b = bucket.get(l.code) || { n: 0, dr: 0, cr: 0 };
    b.n++; b.dr = R(b.dr + l.debit); b.cr = R(b.cr + l.credit);
    bucket.set(l.code, b);
  }
  console.log(`\njournal entries to post: ${entries.length}\n`);
  console.log(`${'acct'.padEnd(7)} ${'name'.padEnd(34)} ${'lines'.padStart(6)} ${'debits'.padStart(14)} ${'credits'.padStart(14)} ${'balance'.padStart(14)}`);
  console.log('-'.repeat(94));
  let td = 0, tc = 0;
  for (const [code, b] of [...bucket.entries()].sort()) {
    td = R(td + b.dr); tc = R(tc + b.cr);
    console.log(`${code.padEnd(7)} ${String((byCode.get(code) as any)?.name || '?').slice(0, 34).padEnd(34)} ${String(b.n).padStart(6)} ${b.dr.toFixed(2).padStart(14)} ${b.cr.toFixed(2).padStart(14)} ${(b.dr - b.cr).toFixed(2).padStart(14)}`);
  }
  console.log('-'.repeat(94));
  console.log(`${'TOTAL'.padEnd(42)} ${String([...bucket.values()].reduce((s, b) => s + b.n, 0)).padStart(6)} ${td.toFixed(2).padStart(14)} ${tc.toFixed(2).padStart(14)} ${(td - tc).toFixed(2).padStart(14)}`);
  console.log(`\ndouble-entry check: ${Math.abs(td - tc) < 0.005 ? '✓ BALANCED' : '✗ OUT BY ' + (td - tc).toFixed(2)}`);

  if (unclassified.length) {
    console.log(`\n!! UNCLASSIFIED — not posted (${unclassified.length}):`);
    for (const t of unclassified) console.log(`   ${t.date.toISOString().slice(0, 10)} ${t.amount.toFixed(2).padStart(11)}  ${t.cp.slice(0, 52)}`);
  }

  if (!APPLY) { console.log('\n(dry run — nothing written; re-run with --apply)'); return; }

  // ── write ─────────────────────────────────────────────────────────────────
  if (RESET) {
    const del = await prisma.journalEntry.deleteMany({ where: { organizationId: ORG } });
    console.log(`\nreset: deleted ${del.count} existing journal entries`);
  }
  const existing = await prisma.journalEntry.count({ where: { organizationId: ORG } });
  if (existing > 0) { console.log(`\nABORT — ${existing} journal entries already exist. Re-run with --reset to rebuild.`); return; }

  entries.sort((a, b) => a.date.getTime() - b.date.getTime());
  let seq = 0;
  for (const e of entries) {
    seq++;
    const total = R(e.lines.reduce((s, l) => s + l.debit, 0));
    await prisma.journalEntry.create({
      data: {
        organizationId: ORG,
        journalNumber: `JV-${String(seq).padStart(6, '0')}`,
        entryDate: e.date,
        type: e.type,
        status: 'POSTED',
        reference: e.ref?.slice(0, 60) || null,
        description: e.desc,
        totalDebit: total,
        totalCredit: total,
        currency: 'SGD',
        postedAt: new Date(),
        postedBy: 'aspire-import',
        createdBy: 'aspire-import',
        lines: {
          create: e.lines.map((l, i) => ({
            accountId: (byCode.get(l.code) as any).id,
            lineNumber: i + 1,
            description: l.desc,
            debit: l.debit,
            credit: l.credit,
          })),
        },
      },
    });
    if (seq % 100 === 0) console.log(`  posted ${seq}/${entries.length}…`);
  }
  console.log(`\nposted ${seq} journal entries`);
}

main().catch((e) => console.error(e)).finally(() => prisma.$disconnect());
