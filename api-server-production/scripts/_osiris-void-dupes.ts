/**
 * guru 2026-08-18:
 *   TI2202608-003 (3,198.00) — DELETE. Duplicate of TI2202608-002 for July 2026;
 *     never confirmed, never posted to the ledger, SIDS qty wrong (22 vs 20).
 *   TI2202607-003 (6,863.40) — VOID. Every one of its 18 lines is contained in
 *     TI2202607-006, which Biofuel paid on 5 Aug. Its journal is reversed the
 *     way JournalService.void() does it (original → VOID + a POSTED reversing
 *     entry), then the document is removed so it stops sitting in AR.
 *
 * Both documents are backed up to ~/Downloads before anything is deleted.
 *
 * Dry:    npx ts-node --transpile-only scripts/_osiris-void-dupes.ts .env.production
 * Apply:  ... --apply
 */
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import ws = require('ws');
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;

const envFile = process.argv[2] || '.env.production';
const APPLY = process.argv.includes('--apply');
const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)!;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: new URL(m[1]).toString() }) } as any);

const ORG = 'd068f159-e45a-4da8-beaf-62e903f44141';
const DELETE_ONLY = 'TI2202608-003';
const VOID_DOC = 'TI2202607-003';

async function nextJournalNumber(): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ maxseq: number | null }>>(
    `SELECT MAX(CAST(SUBSTRING("journalNumber" FROM 4) AS INTEGER)) AS maxseq
       FROM "JournalEntry" WHERE "organizationId" = $1 AND "journalNumber" ~ '^JV-[0-9]+$'`,
    ORG,
  );
  return `JV-${String((rows?.[0]?.maxseq ?? 0) + 1).padStart(6, '0')}`;
}

async function main() {
  console.log(`==== ${envFile} ${APPLY ? '(APPLY)' : '(DRY RUN)'} ====\n`);

  const docs = await prisma.document.findMany({ where: { organizationId: ORG, name: { in: [DELETE_ONLY, VOID_DOC] } } });
  const dup = docs.find((d: any) => d.name === DELETE_ONLY);
  const vd = docs.find((d: any) => d.name === VOID_DOC);

  console.log(`DELETE  ${DELETE_ONLY}  ${dup ? `${(dup.config as any).nettTotal} [${dup.status}]` : 'NOT FOUND'}`);
  console.log(`VOID    ${VOID_DOC}  ${vd ? `${(vd.config as any).nettTotal} [${vd.status}]` : 'NOT FOUND'}`);

  // journals raised for the voided invoice
  const jes = await prisma.journalEntry.findMany({
    where: { organizationId: ORG, reference: VOID_DOC, status: 'POSTED' },
    include: { lines: { include: { account: { select: { code: true, name: true } } } } },
  });
  console.log(`\njournal entries to reverse: ${jes.length}`);
  for (const je of jes as any[]) {
    console.log(`  ${je.journalNumber}  ${je.entryDate.toISOString().slice(0, 10)}  ${je.description}`);
    je.lines.forEach((l: any) => console.log(`     ${l.account.code} ${String(l.account.name).slice(0, 30).padEnd(30)} Dr ${l.debit.toFixed(2).padStart(10)}  Cr ${l.credit.toFixed(2).padStart(10)}`));
  }

  if (!APPLY) { console.log('\n(dry run — nothing written; re-run with --apply)'); return; }

  const backup = path.join(os.homedir(), 'Downloads', 'osiris-voided-invoices-backup.json');
  fs.writeFileSync(backup, JSON.stringify({ deleted: dup ?? null, voided: vd ?? null, journals: jes }, null, 1));
  console.log(`\nbacked up → ${backup}`);

  // ---- 1. duplicate July invoice: plain delete (nothing posted for it) ----
  if (dup) {
    await prisma.document.delete({ where: { id: dup.id } });
    console.log(`deleted ${DELETE_ONLY}`);
  }

  // ---- 2. superseded hardware invoice: void + reverse, then remove ----
  for (const je of jes as any[]) {
    await prisma.$transaction(async (tx: any) => {
      await tx.journalEntry.update({ where: { id: je.id }, data: { status: 'VOID', voidedAt: new Date(), voidedBy: 'aspire-import' } });
      const num = await nextJournalNumber();
      await tx.journalEntry.create({
        data: {
          organizationId: ORG,
          journalNumber: num,
          entryDate: new Date(),
          type: 'ADJUSTMENT',
          status: 'POSTED',
          reference: `Reversal of ${je.journalNumber}`,
          description: `Reversing ${je.journalNumber} — ${VOID_DOC} superseded by TI2202607-006 (paid 5 Aug 2026)`.slice(0, 190),
          totalDebit: je.totalCredit,
          totalCredit: je.totalDebit,
          currency: je.currency,
          postedAt: new Date(),
          postedBy: 'aspire-import',
          reversesEntryId: je.id,
          createdBy: 'aspire-import',
          lines: {
            create: je.lines.map((l: any, i: number) => ({
              accountId: l.accountId,
              lineNumber: i + 1,
              description: `Reversal: ${l.description ?? ''}`.trim().slice(0, 190),
              debit: l.credit,
              credit: l.debit,
            })),
          },
        },
      });
      console.log(`  voided ${je.journalNumber}, posted reversal ${num}`);
    });
  }
  if (vd) {
    await prisma.document.delete({ where: { id: vd.id } });
    console.log(`deleted ${VOID_DOC} (ledger trail kept via the void + reversal)`);
  }
}

main().catch((e) => console.error(e)).finally(() => prisma.$disconnect());
