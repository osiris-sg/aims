/**
 * Build YOURWORLD PTE. LTD.'s general ledger from its MariBank statement lines.
 *
 * Reads the PENDING BankStatementLine rows the _yourworld-import-statements.ts
 * run created (1,607 lines, Jun–Aug 2026, balance-verified to the statement),
 * classifies each, posts one JE per line (cash basis, gross — NOT
 * GST-registered, guru 2026-09-22), and marks the recon line POSTED_NEW linked
 * to its JE — so bank rec ends up fully reconciled.
 *
 * Classification (guru-reviewable buckets, see dry-run report):
 *   - Interest credits                        → IC002 Bank Interest Income
 *   - Credits from LLP/PTE entities           → SS003 Event & Roadshow Income
 *   - All other PayNow credits (ticket buyers
 *     + roadshow sub-collector sweeps)        → SS002 Ticket Sales
 *   - Cedric Yong FAST debits (UNCONFIRMED:
 *     assumed director)                       → CL100 Director's Loan
 *   - YOURWORLD self-transfers out            → CA102 Bank — Other Own Account
 *   - WISE ASIA-PACIFIC debits (destination
 *     unknown — ASK GURU)                     → CA900 Suspense
 *   - Named service companies (pest, aircon…) → EX001 / EX040
 *   - All other individual debits = ticket
 *     refunds / collected-cash returns (many
 *     mirror an equal inbound)                → CS003 Ticket Refunds & Payouts
 *
 * Dry:    npx ts-node --transpile-only scripts/_yourworld-post-ledger.ts .env
 * Apply:  ... --apply          Reset first: ... --apply --reset
 */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

const envFile = process.argv[2] || '.env';
const APPLY = process.argv.includes('--apply');
const RESET = process.argv.includes('--reset');
const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);

const BANK = 'CA101';
const ACTOR = 'maribank-import';
const STATEMENT_CLOSING = 103201.75; // Aug 2026 ending balance
const R = (n: number) => Math.round(n * 100) / 100;

type Rule = { rx: RegExp; when?: 'in' | 'out'; acct: string; label: string };
// First match wins, tested against the full statement description.
const RULES: Rule[] = [
  // ---- interest ----
  { rx: /\bInterest\b/i, when: 'in', acct: 'IC002', label: 'Bank interest' },

  // ---- director (UNCONFIRMED — repeated large FAST transfers to one person) ----
  { rx: /Cedric Yong/i, acct: 'CL100', label: "Director's loan — Cedric Yong (UNCONFIRMED role)" },

  // ---- transfers to the company's own other bank account ----
  { rx: /YOURWORLD PTE\.? ?LTD.*FAST Transfer|FAST Transfer.*YOURWORLD PTE\.? ?LTD/i, when: 'out', acct: 'CA102', label: 'Transfer to own other bank account' },

  // ---- Wise payouts — destination unknown, parked for guru ----
  { rx: /WISE ASIA-PACIFIC/i, when: 'out', acct: 'CA900', label: 'Wise transfer — purpose unknown (SUSPENSE)' },

  // ---- identifiable service providers ----
  { rx: /STRIPE PAYMENTS/i, when: 'out', acct: 'EX040', label: 'Stripe charge' },
  { rx: /ARIES AIRCON|INNOVATIVE PEST|CRAFTERS SG|SFM\b/i, when: 'out', acct: 'EX001', label: 'General expenses' },

  // ---- corporate/partner income ----
  { rx: /ALPHABETA EVENTS|CAFFEINE CONNECTION|EVERYBUDDY PTE/i, when: 'in', acct: 'SS003', label: 'Event & roadshow income (partner)' },
  { rx: /\b(PTE|LLP)\b/i, when: 'in', acct: 'SS003', label: 'Event & roadshow income (entity)' },

  // ---- catch-alls ----
  { rx: /./, when: 'in', acct: 'SS002', label: 'Ticket sales (PayNow)' },
  { rx: /./, when: 'out', acct: 'CS003', label: 'Ticket refund / payout' },
];

async function main() {
  console.log(`==== ${envFile} ${APPLY ? '(APPLY)' : '(DRY RUN)'}${RESET ? ' [RESET]' : ''} ====\n`);

  const org = await prisma.organization.findFirst({ where: { name: { contains: 'YOURWORLD', mode: 'insensitive' } } });
  if (!org) { console.log('ABORT — YOURWORLD org missing. Run _yourworld-setup.ts first.'); return; }
  const ORG = org.id;
  console.log(`Org: ${org.name} [${ORG}]`);

  const accounts = await prisma.chartOfAccount.findMany({ where: { organizationId: ORG }, select: { id: true, code: true, name: true } });
  const byCode = new Map(accounts.map((a: any) => [a.code, a]));
  for (const need of [BANK, 'CA102', 'CA900', 'CL100', 'SS002', 'SS003', 'IC002', 'CS003', 'EX001', 'EX040']) {
    if (!byCode.has(need)) { console.log(`ABORT — account ${need} missing. Re-run _yourworld-setup.ts --apply.`); return; }
  }
  const bankAcct = byCode.get(BANK) as any;

  const lines = await prisma.bankStatementLine.findMany({
    where: { organizationId: ORG, bankAccountId: bankAcct.id },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
  console.log(`statement lines: ${lines.length} (${lines.filter((l: any) => l.status === 'PENDING').length} pending)`);

  // classify
  const plan: { line: any; acct: string; label: string }[] = [];
  for (const l of lines) {
    const dir = l.amount > 0 ? 'in' : 'out';
    const rule = RULES.find((r) => (!r.when || r.when === dir) && r.rx.test(l.description))!;
    plan.push({ line: l, acct: rule.acct, label: rule.label });
  }

  // ---- report ----
  const bucket = new Map<string, { n: number; dr: number; cr: number }>();
  const add = (code: string, dr: number, cr: number) => {
    const b = bucket.get(code) || { n: 0, dr: 0, cr: 0 };
    b.n++; b.dr = R(b.dr + dr); b.cr = R(b.cr + cr);
    bucket.set(code, b);
  };
  for (const p of plan) {
    const abs = Math.abs(p.line.amount);
    if (p.line.amount > 0) { add(BANK, abs, 0); add(p.acct, 0, abs); }
    else { add(p.acct, abs, 0); add(BANK, 0, abs); }
  }
  console.log(`\njournal entries to post: ${plan.length}\n`);
  console.log(`${'acct'.padEnd(7)} ${'name'.padEnd(38)} ${'lines'.padStart(6)} ${'debits'.padStart(13)} ${'credits'.padStart(13)} ${'balance'.padStart(13)}`);
  console.log('-'.repeat(96));
  let td = 0, tc = 0;
  for (const [code, b] of [...bucket.entries()].sort()) {
    td = R(td + b.dr); tc = R(tc + b.cr);
    console.log(`${code.padEnd(7)} ${String((byCode.get(code) as any)?.name || '?').slice(0, 38).padEnd(38)} ${String(b.n).padStart(6)} ${b.dr.toFixed(2).padStart(13)} ${b.cr.toFixed(2).padStart(13)} ${(b.dr - b.cr).toFixed(2).padStart(13)}`);
  }
  console.log('-'.repeat(96));
  console.log(`${'TOTAL'.padEnd(46)} ${''.padStart(6)} ${td.toFixed(2).padStart(13)} ${tc.toFixed(2).padStart(13)} ${(td - tc).toFixed(2).padStart(13)}`);
  console.log(`double-entry check: ${Math.abs(td - tc) < 0.005 ? '✓ BALANCED' : '✗ OUT BY ' + (td - tc).toFixed(2)}`);
  const bb = bucket.get(BANK)!;
  console.log(`bank check: ${BANK} balance ${(bb.dr - bb.cr).toFixed(2)} vs statement closing ${STATEMENT_CLOSING} ${Math.abs(bb.dr - bb.cr - STATEMENT_CLOSING) < 0.005 ? '✓' : '✗'}`);

  if (!APPLY) { console.log('\n(dry run — nothing written; re-run with --apply)'); return; }

  if (RESET) {
    const del = await prisma.journalEntry.deleteMany({ where: { organizationId: ORG } });
    await prisma.bankStatementLine.updateMany({
      where: { organizationId: ORG },
      data: { status: 'PENDING', matchedJournalLineId: null, matchedAt: null, matchedBy: null, postedJournalEntryId: null },
    });
    console.log(`\nreset: deleted ${del.count} JEs, lines back to PENDING`);
  }
  const existing = await prisma.journalEntry.count({ where: { organizationId: ORG } });
  if (existing > 0) { console.log(`\nABORT — ${existing} JEs already exist. Re-run with --reset to rebuild.`); return; }
  const nonPending = plan.filter((p) => p.line.status !== 'PENDING').length;
  if (nonPending > 0) { console.log(`\nABORT — ${nonPending} lines are not PENDING. Use --reset.`); return; }

  let seq = 0, done = 0;
  const CHUNK = 20;
  const jobs = plan.map((p) => { seq++; return { ...p, num: `JV-${String(seq).padStart(6, '0')}` }; });
  for (let i = 0; i < jobs.length; i += CHUNK) {
    await Promise.all(jobs.slice(i, i + CHUNK).map(async (j) => {
      const abs = R(Math.abs(j.line.amount));
      const desc = `${j.label}: ${j.line.description}`.slice(0, 190);
      const jeLines = j.line.amount > 0
        ? [
            { accountId: bankAcct.id, lineNumber: 1, debit: abs, credit: 0, description: j.line.description.slice(0, 190) },
            { accountId: (byCode.get(j.acct) as any).id, lineNumber: 2, debit: 0, credit: abs, description: j.line.description.slice(0, 190) },
          ]
        : [
            { accountId: (byCode.get(j.acct) as any).id, lineNumber: 1, debit: abs, credit: 0, description: j.line.description.slice(0, 190) },
            { accountId: bankAcct.id, lineNumber: 2, debit: 0, credit: abs, description: j.line.description.slice(0, 190) },
          ];
      const je = await prisma.journalEntry.create({
        data: {
          organizationId: ORG,
          journalNumber: j.num,
          entryDate: j.line.date,
          type: 'MANUAL',
          status: 'POSTED',
          description: desc,
          totalDebit: abs,
          totalCredit: abs,
          currency: 'SGD',
          postedAt: new Date(),
          postedBy: ACTOR,
          createdBy: ACTOR,
          lines: { create: jeLines },
        },
        include: { lines: true },
      });
      const bankJeLine = je.lines.find((l: any) => l.accountId === bankAcct.id);
      await prisma.bankStatementLine.update({
        where: { id: j.line.id },
        data: {
          status: 'POSTED_NEW',
          matchedJournalLineId: bankJeLine?.id ?? null,
          matchedAt: new Date(),
          matchedBy: ACTOR,
          postedJournalEntryId: je.id,
        },
      });
    }));
    done = Math.min(i + CHUNK, jobs.length);
    if (done % 200 < CHUNK) console.log(`  posted ${done}/${jobs.length}…`);
  }
  console.log(`\nposted ${jobs.length} journal entries; all statement lines POSTED_NEW`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
