/**
 * Build U2CAN COMBAT PTE LTD's general ledger from its Aspire SGD statement.
 *
 * Source: ~/Downloads/export-transaction-file/u2can_combat_p_sgd_20260915104905.pdf
 *   411 txns, 15 Sep 2025 → 16 Sep 2026, opening 0.00, in 87,305.48,
 *   out 85,838.85, closing 1,466.63 — parsed + balance-reconciled to the cent.
 *
 * Evidence behind the big classifications (receipt zip attachments):
 *   - GLORY MARINE HOLDINGS = landlord of 139 Jalan Besar #02-01. Tenancy
 *     22 Dec 2025 – 21 Dec 2027, $3,600/mo + 9% GST = $3,924/mo.
 *     First payment 11,124.00 = 7,200 rental deposit (2 mo) + 3,924 first month.
 *     Later payments = 3,924 rent + excess as landlord utility recharges.
 *   - RUXING RENOVATION invoice AA-CN1210 $5,530 (2,030 deposit + 3,500) =
 *     gym fit-out → capitalised FA010.
 *   - Individuals (Tam, Kawsar, Hanurdeen, …) invoice U2CAN via signed payment
 *     vouchers (Rubann, Finance Manager) → coach/instructor fees CS002.
 *   - RUBANN/RUBXXX = director; in/out flows → CL100 Director's Loan.
 *
 * Dry:    npx ts-node --transpile-only scripts/_u2can-post-ledger.ts .env
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

const SCRATCH = '/private/tmp/claude-501/-Users-guru-Documents-GitHub-aims/4eee881a-85a5-4ed2-9537-30c67bb06d5a/scratchpad';
const BANK = 'CA101';
const R = (n: number) => Math.round(n * 100) / 100;
const MONTHLY_RENT = 3924.0; // $3,600 + 9% GST per tenancy agreement
const DEPOSIT = 7200.0; // 2 months, refundable — asset not expense

type Rule = { rx: RegExp; acct: string; label: string };
// First match wins. Matched against "counterparty — description".
const RULES: Rule[] = [
  // ---- renovation / premises ----
  { rx: /RUXING RENOVATION/i, acct: 'FA010', label: 'Renovation & fit-out (Ruxing AA-CN1210)' },
  { rx: /139JB.*waterproofing/i, acct: 'FA010', label: 'Waterproofing contribution received' },

  // ---- income ----
  { rx: /^STRIPE PAYMENTS SINGAPORE/i, acct: 'SS003', label: 'Stripe payout' },
  { rx: /^CLASSPASS/i, acct: 'SS004', label: 'ClassPass payout' },
  { rx: /^Paynow/i, acct: 'SS002', label: 'Member fee (PayNow)' },
  { rx: /Aspire FT Referral/i, acct: 'IC001', label: 'Cashback / referral income' },

  // ---- director ----
  { rx: /^RUBANN\b|^RUBXXX\b/i, acct: 'CL100', label: "Director's loan — Rubann" },

  // ---- software & subscriptions ----
  { rx: /XERO |XERO PRE-AUTH|GOOGLE\*WORKSPACE|Google Workspace|ANTHROPIC|OPENAI|BITWARDEN|ONLINE QR GENERATOR/i, acct: 'EX020', label: 'Software & subscriptions' },

  // ---- venue hire (GetSpaces incl. its GETTECH card holds) ----
  { rx: /GETSPACES|TEMP HOLD - GETTECH/i, acct: 'EX080', label: 'External venue hire' },

  // ---- affiliation ----
  { rx: /SINGAPORE BOXING FEDERATION|hockey federation/i, acct: 'EX090', label: 'Affiliation & competition fees' },

  // ---- repairs & maintenance ----
  { rx: /STARCOOL AIR-CON/i, acct: 'EX100', label: 'Aircon servicing' },

  // ---- printing & signage ----
  { rx: /MULTI PRINTS N SIGNS/i, acct: 'EX110', label: 'Signage' },

  // ---- staff welfare ----
  { rx: /L\. ?K\. ?MAJU|LES AMIS/i, acct: 'EX120', label: 'Staff welfare' },

  // ---- equipment, supplies, consumables ----
  // VINALEX = soap/air-freshener consumables (guru 2026-09-15)
  { rx: /VINALEX|TAOBAO|SHOPEE|TikTok Shop|SPEEDWAY E-COMMERCE|MUSTAFA|KRISHNA HARDWARE|3F HARDWARE|TROSEAL|LATERALCO|PUSHPA TRADING|SANLIGHT|360 BATHWARE|O PLUS SG|HWXYZ|INNOCREATION/i, acct: 'EX060', label: 'Gym equipment & supplies' },
  // reimbursements to people who bought gym equipment (guru 2026-09-15)
  { rx: /^(Natalie soh|Ganesan|Dorothy|Hoe cherh inn)\b/i, acct: 'EX060', label: 'Gym equipment reimbursement' },

  // ---- coaches / instructors (payment vouchers signed by Finance Manager) ----
  { rx: /^(Tam|SANJANA CAROL|AHMED KAWSAR|Hanurdeen|MOHAXXX HANURXXXX BIX HAMXX|KHARSXXX KUMXX|Anderson|KO LIANG YU RUSSEL|DARMAN BALASUBRAMANIAM|GADDIEL PRADEEP|SATHISH|SATHIAVARMAN|S DHINXXX KUMXX|Joseph|jl|Nirmal)\b/i, acct: 'CS002', label: 'Coaching & instructor fees' },
];

type Line = { code: string; debit: number; credit: number; desc: string };
type Entry = { date: Date; ref: string; desc: string; lines: Line[] };

async function main() {
  console.log(`==== ${envFile} ${APPLY ? '(APPLY)' : '(DRY RUN)'}${RESET ? ' [RESET]' : ''} ====\n`);

  const org = await prisma.organization.findFirst({ where: { name: { contains: 'U2CAN', mode: 'insensitive' } } });
  if (!org) { console.log('ABORT — U2CAN org missing. Run _u2can-setup.ts first.'); return; }
  const ORG = org.id;
  console.log(`Org: ${org.name} [${ORG}]`);

  const accounts = await prisma.chartOfAccount.findMany({ where: { organizationId: ORG }, select: { id: true, code: true, name: true } });
  const byCode = new Map(accounts.map((a: any) => [a.code, a]));
  for (const need of [BANK, 'CA200', 'CL100', 'SS002', 'SS003', 'SS004', 'CS002', 'EX030', 'EX031', 'FA010', 'IC001']) {
    if (!byCode.has(need)) { console.log(`ABORT — account ${need} missing. Run _u2can-setup.ts --apply first.`); return; }
  }

  const MO: any = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const raw = JSON.parse(fs.readFileSync(`${SCRATCH}/u2can_txns.json`, 'utf8'));
  const txns = raw.map((t: any) => {
    const [d, mo, y] = t.date.split(' ');
    const ref = (t.description.match(/ID: (\S+)/) || [])[1] || `row-${t.n}`;
    const cp = t.counterparty.replace(/\s+\d{6,}\w*$/, '').replace(/\s+N\/A$/, '').replace(/\s+/g, ' ').trim();
    return {
      n: t.n,
      date: new Date(Date.UTC(+y, MO[mo], +d)),
      cp,
      desc: t.description.replace(/\s*ID: \S+\s*$/, '').trim(),
      debit: parseFloat(t.debit),
      credit: parseFloat(t.credit),
      ref,
    };
  }).sort((a: any, b: any) => a.date.getTime() - b.date.getTime() || a.n - b.n);
  console.log(`bank transactions: ${txns.length}`);

  const entries: Entry[] = [];
  const unclassified: any[] = [];
  for (const t of txns) {
    const amt = R(t.credit - t.debit); // + inflow, - outflow
    if (Math.abs(amt) < 0.005) continue;
    const abs = Math.abs(amt);
    const text = `${t.cp} — ${t.desc}`;
    const short = `${t.cp}${t.desc && !/^(In|Out)bound transfer$/.test(t.desc) ? ` — ${t.desc}` : ''}`.slice(0, 180);

    // Glory Marine (landlord): split deposit / rent / utility recharge
    if (/GLORY MARINE/i.test(t.cp)) {
      const lines: Line[] = [];
      let rest = abs;
      if (abs >= DEPOSIT + MONTHLY_RENT - 0.005 && !entries.some((e) => e.lines.some((l) => l.code === 'CA200'))) {
        lines.push({ code: 'CA200', debit: DEPOSIT, credit: 0, desc: 'Rental deposit 139 Jalan Besar #02-01 (2 months)' });
        rest = R(rest - DEPOSIT);
      }
      // a payment smaller than one month's rent is a pure utilities top-up
      if (rest >= MONTHLY_RENT - 0.005) { lines.push({ code: 'EX030', debit: MONTHLY_RENT, credit: 0, desc: 'Rent — 139 Jalan Besar #02-01 ($3,600 + 9% GST)' }); rest = R(rest - MONTHLY_RENT); }
      if (rest > 0.005) lines.push({ code: 'EX031', debit: rest, credit: 0, desc: 'Utilities recharged by landlord' });
      lines.push({ code: BANK, debit: 0, credit: abs, desc: short });
      entries.push({ date: t.date, ref: t.ref, desc: `Glory Marine Holdings (landlord): ${short}`.slice(0, 190), lines });
      continue;
    }

    const rule = RULES.find((r) => r.rx.test(t.cp) || r.rx.test(text));
    let acct = rule?.acct ?? '';
    let label = rule?.label ?? '';
    if (!acct) { unclassified.push(t); acct = 'CA900'; label = 'UNCLASSIFIED — suspense'; }
    const lines: Line[] =
      amt > 0
        ? [{ code: BANK, debit: abs, credit: 0, desc: short }, { code: acct, debit: 0, credit: abs, desc: short }]
        : [{ code: acct, debit: abs, credit: 0, desc: short }, { code: BANK, debit: 0, credit: abs, desc: short }];
    entries.push({ date: t.date, ref: t.ref, desc: `${label}: ${short}`.slice(0, 190), lines });
  }

  // ---- report ----
  const bucket = new Map<string, { n: number; dr: number; cr: number }>();
  for (const e of entries) for (const l of e.lines) {
    const b = bucket.get(l.code) || { n: 0, dr: 0, cr: 0 };
    b.n++; b.dr = R(b.dr + l.debit); b.cr = R(b.cr + l.credit);
    bucket.set(l.code, b);
  }
  console.log(`\njournal entries to post: ${entries.length}\n`);
  console.log(`${'acct'.padEnd(7)} ${'name'.padEnd(34)} ${'lines'.padStart(6)} ${'debits'.padStart(13)} ${'credits'.padStart(13)} ${'balance'.padStart(13)}`);
  console.log('-'.repeat(92));
  let td = 0, tc = 0;
  for (const [code, b] of [...bucket.entries()].sort()) {
    td = R(td + b.dr); tc = R(tc + b.cr);
    console.log(`${code.padEnd(7)} ${String((byCode.get(code) as any)?.name || '?').slice(0, 34).padEnd(34)} ${String(b.n).padStart(6)} ${b.dr.toFixed(2).padStart(13)} ${b.cr.toFixed(2).padStart(13)} ${(b.dr - b.cr).toFixed(2).padStart(13)}`);
  }
  console.log('-'.repeat(92));
  console.log(`${'TOTAL'.padEnd(42)} ${'' .padStart(6)} ${td.toFixed(2).padStart(13)} ${tc.toFixed(2).padStart(13)} ${(td - tc).toFixed(2).padStart(13)}`);
  console.log(`double-entry check: ${Math.abs(td - tc) < 0.005 ? '✓ BALANCED' : '✗ OUT BY ' + (td - tc).toFixed(2)}`);
  const bankB = bucket.get(BANK)!;
  console.log(`bank check: CA101 balance ${(bankB.dr - bankB.cr).toFixed(2)} vs statement closing 1466.63 ${Math.abs(bankB.dr - bankB.cr - 1466.63) < 0.005 ? '✓' : '✗'}`);

  if (unclassified.length) {
    console.log(`\n!! UNCLASSIFIED — parked in CA900 suspense (${unclassified.length}):`);
    for (const t of unclassified) console.log(`   ${t.date.toISOString().slice(0, 10)} ${(t.credit - t.debit).toFixed(2).padStart(11)}  ${t.cp.slice(0, 52)}`);
  }

  if (!APPLY) { console.log('\n(dry run — nothing written; re-run with --apply)'); return; }

  if (RESET) {
    const del = await prisma.journalEntry.deleteMany({ where: { organizationId: ORG } });
    console.log(`\nreset: deleted ${del.count} existing journal entries`);
  }
  const existing = await prisma.journalEntry.count({ where: { organizationId: ORG } });
  if (existing > 0) { console.log(`\nABORT — ${existing} journal entries already exist. Re-run with --reset to rebuild.`); return; }

  let seq = 0;
  for (const e of entries) {
    seq++;
    const total = R(e.lines.reduce((s, l) => s + l.debit, 0));
    await prisma.journalEntry.create({
      data: {
        organizationId: ORG,
        journalNumber: `JV-${String(seq).padStart(6, '0')}`,
        entryDate: e.date,
        type: 'MANUAL',
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
