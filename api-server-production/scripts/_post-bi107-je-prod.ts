// Replicate dev's unconfirmed JE for invoice BI202607107 into PROD (guru
// 2026-07-27: saves post to GL immediately as unconfirmed — the prod copy of
// the invoice must match). Maps accounts by code, next prod JV number.
import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
const APPLY = process.argv.includes('--apply');
const BIOFUEL = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const DOC_ID = 'b6af81e9-283d-4530-9ce2-3e0cc1fc878e';

async function main() {
  dotenv.config({ path: path.resolve(__dirname, '..', '.env'), override: true });
  const dev = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  const je = await dev.journalEntry.findFirst({
    where: { organizationId: BIOFUEL, sourceDocumentId: DOC_ID, status: 'POSTED' },
    include: { lines: { include: { account: { select: { code: true, name: true } } }, orderBy: { lineNumber: 'asc' } } },
  });
  await dev.$disconnect();
  if (!je) throw new Error('no POSTED dev JE found');

  dotenv.config({ path: path.resolve(__dirname, '..', '.env.production'), override: true });
  const prod = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

  const dupe = await prod.journalEntry.findFirst({ where: { organizationId: BIOFUEL, sourceDocumentId: DOC_ID, status: { not: 'VOID' } } });
  if (dupe) throw new Error(`prod already has JE ${dupe.journalNumber} for this doc`);

  // Map accounts by code.
  const lineData: any[] = [];
  for (const l of je.lines) {
    const acc = await prod.chartOfAccount.findFirst({
      where: { organizationId: BIOFUEL, code: l.account!.code },
      select: { id: true, code: true, name: true },
    });
    if (!acc) throw new Error(`prod missing account ${l.account!.code} ${l.account!.name}`);
    lineData.push({ accountId: acc.id, lineNumber: l.lineNumber, description: l.description, debit: l.debit, credit: l.credit });
    console.log(`  line ${l.lineNumber}: ${acc.code} ${acc.name} D${l.debit} C${l.credit}`);
  }

  // Next JV number in prod — same canonical-max query as
  // journal.service.nextJournalNumber (ignores JV-XERO-* style suffixes).
  const rows = await prod.$queryRawUnsafe<Array<{ maxseq: number | null }>>(
    `SELECT MAX(CAST(SUBSTRING("journalNumber" FROM 4) AS BIGINT)) AS maxseq
       FROM "JournalEntry"
      WHERE "organizationId" = $1 AND "journalNumber" ~ '^JV-[0-9]+$'`,
    BIOFUEL,
  );
  const journalNumber = `JV-${String(Number(rows?.[0]?.maxseq ?? 0) + 1).padStart(6, '0')}`;
  console.log(`prod journalNumber: ${journalNumber} (canonical max: ${rows?.[0]?.maxseq}), ref=${je.reference}, type=${je.type}`);
  if (!APPLY) { console.log('dry-run — pass --apply'); await prod.$disconnect(); return; }

  const created = await prod.journalEntry.create({
    data: {
      organizationId: BIOFUEL,
      journalNumber,
      entryDate: je.entryDate,
      type: je.type,
      status: 'POSTED',
      isUnconfirmed: true,
      reference: je.reference,
      description: je.description,
      totalDebit: je.totalDebit,
      totalCredit: je.totalCredit,
      currency: je.currency,
      sourceDocumentId: DOC_ID,
      postedAt: je.postedAt ?? new Date(),
      postedBy: je.postedBy,
      createdBy: je.createdBy,
      lines: { create: lineData },
    },
    select: { id: true, journalNumber: true },
  });
  console.log('CREATED prod JE:', JSON.stringify(created));
  await prod.$disconnect();
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
