/**
 * Import YOURWORLD's MariBank statements (Mar–Aug 2026) into bank recon.
 *
 * Creates one BankStatementImport (+ BankStatementLine rows) per monthly PDF
 * against the CA101 MariBank — SGD account, matching the shape the bank-rec
 * CSV import path writes (signed amount: positive = money in, status READY,
 * lines PENDING). Idempotent: skips a month whose filename already has an
 * import row for the org.
 *
 * Txn JSON comes from the session parser (parse_maribank.py) which verified
 * every row against the statement's running balance and ending balance.
 *
 * Dry:    npx ts-node --transpile-only scripts/_yourworld-import-statements.ts .env <txns.json>
 * Apply:  ... --apply
 */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

const args = process.argv.slice(2).filter((a) => a !== '--apply');
const envFile = args[0] || '.env';
const jsonPath = args[1];
const APPLY = process.argv.includes('--apply');
if (!jsonPath) { console.error('usage: ... <envfile> <txns.json> [--apply]'); process.exit(1); }
const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);

// statement period per month (account opened 23 Mar 2026)
const PERIODS: Record<string, [string, string]> = {
  Mar: ['2026-03-23', '2026-03-31'],
  Apr: ['2026-04-01', '2026-04-30'],
  May: ['2026-05-01', '2026-05-31'],
  Jun: ['2026-06-01', '2026-06-30'],
  Jul: ['2026-07-01', '2026-07-31'],
  Aug: ['2026-08-01', '2026-08-31'],
};

async function main() {
  console.log(`==== ${envFile} ${APPLY ? '(APPLY)' : '(DRY RUN)'} ====`);
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  const org = await prisma.organization.findFirst({ where: { name: { contains: 'YOURWORLD', mode: 'insensitive' } } });
  if (!org) throw new Error('YOURWORLD org not found — run _yourworld-setup.ts first');
  const bank = await prisma.chartOfAccount.findFirst({ where: { organizationId: org.id, code: 'CA101' } });
  if (!bank) throw new Error('CA101 MariBank account not found');
  console.log(`Org ${org.name} [${org.id}], bank account CA101 ${bank.name} [${bank.id}]`);

  for (const mon of Object.keys(PERIODS)) {
    const st = data[mon];
    if (!st) { console.log(`${mon}: not in JSON, skipping`); continue; }
    const filename = st.file.replace(/\.txt$/, '.pdf');
    const existing = await prisma.bankStatementImport.findFirst({
      where: { organizationId: org.id, bankAccountId: bank.id, filename },
    });
    if (existing) { console.log(`${mon}: already imported (${existing.id}), skipping`); continue; }
    console.log(`${mon}: ${st.count} lines, in ${st.in} out ${st.out}, ending ${st.ending} (${filename})`);
    if (!APPLY) continue;

    const imp = await prisma.bankStatementImport.create({
      data: {
        organizationId: org.id,
        bankAccountId: bank.id,
        source: 'PDF',
        filename,
        periodStart: new Date(PERIODS[mon][0]),
        periodEnd: new Date(PERIODS[mon][1]),
        endingBalance: st.ending,
        status: 'READY',
        createdBy: 'maribank-import',
        notes: `MariBank Business e-Statement ${mon} 2026 (acct 293 186 789), parsed + balance-verified`,
      },
    });
    const rows = st.txns.map((t: any) => ({
      importId: imp.id,
      organizationId: org.id,
      bankAccountId: bank.id,
      date: new Date(t.date),
      description: t.description,
      amount: t.amount,
      runningBalance: t.balance,
      status: 'PENDING',
    }));
    for (let i = 0; i < rows.length; i += 500) {
      await prisma.bankStatementLine.createMany({ data: rows.slice(i, i + 500) });
    }
    console.log(`  → import ${imp.id}, ${rows.length} lines`);
  }

  // verify
  if (APPLY) {
    const total = await prisma.bankStatementLine.count({ where: { organizationId: org.id, bankAccountId: bank.id } });
    const sum = await prisma.bankStatementLine.aggregate({
      where: { organizationId: org.id, bankAccountId: bank.id }, _sum: { amount: true },
    });
    console.log(`\nVERIFY: ${total} lines, net movement ${sum._sum.amount?.toFixed(2)} (statement closing should be 103201.75)`);
  }
  console.log('DONE');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
