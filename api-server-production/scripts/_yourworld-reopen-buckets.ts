/**
 * Reopen YOURWORLD's three "unknown" buckets for the owner review session.
 *
 * Deletes the maribank-import JEs whose contra account is CL100 (Cedric Yong),
 * CA102 (self-transfers) or CA900 (Wise suspense) and flips their bank-rec
 * lines back to PENDING, stamping the old bucket as the line's *suggestion*
 * (suggestedAccountId + reason) so the "Post as new" dialog on
 * /portal/accounting/bank-reconciliation opens pre-filled — the owner just
 * confirms or picks a different account per line.
 *
 * Everything else (ticket sales, refunds, interest, expenses) stays posted.
 *
 * Dry:    npx ts-node --transpile-only scripts/_yourworld-reopen-buckets.ts .env
 * Apply:  ... --apply
 */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

const envFile = process.argv[2] || '.env';
const APPLY = process.argv.includes('--apply');
const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);

const BUCKETS: Record<string, string> = {
  CL100: 'Repeated FAST transfers to Cedric Yong — confirm: director loan/drawings?',
  CA102: 'Transfer to another YOURWORLD-owned bank account — confirm which account',
  CA900: 'Wise transfer — confirm what was paid for',
};

async function main() {
  console.log(`==== ${envFile} ${APPLY ? '(APPLY)' : '(DRY RUN)'} ====\n`);
  const org = await prisma.organization.findFirst({ where: { name: { contains: 'YOURWORLD', mode: 'insensitive' } } });
  if (!org) throw new Error('YOURWORLD org missing');
  const accts = await prisma.chartOfAccount.findMany({ where: { organizationId: org.id, code: { in: Object.keys(BUCKETS) } } });
  const byId = new Map(accts.map((a: any) => [a.id, a]));

  // maribank-import JEs that touch one of the bucket accounts
  const jes = await prisma.journalEntry.findMany({
    where: {
      organizationId: org.id,
      postedBy: 'maribank-import',
      lines: { some: { accountId: { in: accts.map((a: any) => a.id) } } },
    },
    include: { lines: true },
  });
  const perBucket = new Map<string, { n: number; amt: number }>();
  for (const je of jes) {
    const bl = je.lines.find((l: any) => byId.has(l.accountId))!;
    const code = (byId.get(bl.accountId) as any).code;
    const b = perBucket.get(code) || { n: 0, amt: 0 };
    b.n++; b.amt += bl.debit - bl.credit;
    perBucket.set(code, b);
  }
  for (const [code, b] of perBucket) console.log(`${code}: ${b.n} JEs, net ${b.amt.toFixed(2)}`);
  console.log(`total JEs to delete + lines to reopen: ${jes.length}`);
  if (!APPLY) { console.log('\n(dry run — nothing written; re-run with --apply)'); return; }

  let reopened = 0;
  for (const je of jes) {
    const bucketLine = je.lines.find((l: any) => byId.has(l.accountId))!;
    const acct = byId.get(bucketLine.accountId) as any;
    await prisma.bankStatementLine.updateMany({
      where: { organizationId: org.id, postedJournalEntryId: je.id },
      data: {
        status: 'PENDING',
        matchedJournalLineId: null,
        matchedAt: null,
        matchedBy: null,
        postedJournalEntryId: null,
        suggestedAccountId: acct.id,
        suggestionConfidence: 0.5,
        suggestionReason: BUCKETS[acct.code],
      },
    });
    await prisma.journalEntry.delete({ where: { id: je.id } });
    reopened++;
  }
  console.log(`reopened ${reopened} lines, deleted ${reopened} JEs`);

  const pending = await prisma.bankStatementLine.count({ where: { organizationId: org.id, status: 'PENDING' } });
  const gl = await prisma.journalEntryLine.aggregate({
    where: { journalEntry: { organizationId: org.id, status: 'POSTED' }, account: { code: 'CA101' } },
    _sum: { debit: true, credit: true },
  });
  console.log(`now PENDING: ${pending}; GL CA101 = ${((gl._sum.debit ?? 0) - (gl._sum.credit ?? 0)).toFixed(2)} (statement 103201.75 — gap = the pending lines)`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
