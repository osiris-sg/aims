// Status-model backfill (guru 2026-07-24): documents lose "draft" —
//   1. Document.status 'draft' → 'unconfirmed' (all orgs in the target env).
//   2. JournalEntry.isUnconfirmed = true for journals whose source document is
//      unconfirmed (so the JV Listing's Unconfirmed section is accurate for
//      pre-existing data).
// Dry run by default; --apply to write. --env dev|staging|prod (prod only
// with guru's approval).
//
//   npx ts-node scripts/backfill-unconfirmed-status.ts --env dev --apply

import * as path from 'path';
import * as dotenv from 'dotenv';

const args = process.argv.slice(2);
const ENV = (args[args.indexOf('--env') + 1] || 'dev') as 'dev' | 'staging' | 'prod';
const APPLY = args.includes('--apply');
const envFile = ENV === 'dev' ? '.env' : ENV === 'staging' ? '.env.staging' : '.env.production';
dotenv.config({ path: path.resolve(__dirname, '..', envFile), override: true });

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

async function main() {
  console.log(`env=${ENV} ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  const draftCount = await p.document.count({ where: { status: 'draft' } });
  console.log(`documents status draft → unconfirmed: ${draftCount}`);
  if (APPLY && draftCount) {
    await p.document.updateMany({ where: { status: 'draft' }, data: { status: 'unconfirmed' } });
  }

  // Journals of (now-)unconfirmed docs → isUnconfirmed.
  const unconfirmedDocs = await p.document.findMany({
    where: { status: { in: ['draft', 'unconfirmed'] } },
    select: { id: true },
  });
  const ids = unconfirmedDocs.map((d: any) => d.id);
  let jeCount = 0;
  const CHUNK = 5000;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    jeCount += await p.journalEntry.count({
      where: { sourceDocumentId: { in: slice }, isUnconfirmed: false, status: { not: 'VOID' } },
    });
    if (APPLY) {
      await p.journalEntry.updateMany({
        where: { sourceDocumentId: { in: slice }, isUnconfirmed: false, status: { not: 'VOID' } },
        data: { isUnconfirmed: true },
      });
    }
  }
  console.log(`journals tagged isUnconfirmed: ${jeCount}`);
  console.log(APPLY ? 'DONE' : 'dry run — re-run with --apply');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
