/**
 * Stamp review notes (Project.description) on the five completed CIEL
 * projects backfilled from Drive, so they show on the dashboard "Project
 * notes" card for the owner to check. Idempotent — overwrites description
 * only when it is empty or was written by this script family.
 *
 *   npx dotenv -e .env.production -- npx ts-node --transpile-only scripts/_set-backfill-notes.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const CIEL = '09e55c23-e031-4254-8152-a373597b2cb3';

const NOTES: Array<{ nameStartsWith: string; note: string }> = [
  {
    nameStartsWith: 'Dion — Blk 532B',
    note: 'Backfilled from Drive (CI26-011, completed). Check: Daco invoices DINV-2606-013 and DINV-2606-014 ($171 each) look like stale duplicates on the costing sheet — left as pending costs, not counted in the totals.',
  },
  {
    nameStartsWith: 'Ramya — Blk 241B',
    note: 'Backfilled from Drive (CI25-081, completed). Check: the costing sheet has an unlabelled −$4,000 adjustment (kept as an "Adjustment" cost row) and a $20,000 Carpentry row with no date or invoice.',
  },
  {
    nameStartsWith: 'Isabelle — Blk 95B',
    note: 'Backfilled from Drive (CI25-112, completed). Check: the Carpentry cost date was typed "1502/2026" on the sheet — read as 15/02/2026.',
  },
  {
    nameStartsWith: 'Bryan Lee — Piccadilly',
    note: 'Backfilled from Drive (CI25-121, completed). Check: project closed at a loss of $364; the sheet nets the −$182 commission against Ramya\'s payable. The HomePay milestone payments have no dates on the sheet.',
  },
  {
    nameStartsWith: "Bryan's 二哥",
    note: 'Backfilled from Drive (CI25-104, completed). Check: the single 100% payment of $3,888 is dated 3 Nov 2025, before the contract date of 14 Nov 2025 on the sheet.',
  },
];

async function main() {
  for (const n of NOTES) {
    const pj = await prisma.project.findFirst({
      where: { organizationId: CIEL, name: { startsWith: n.nameStartsWith } },
      select: { id: true, name: true, description: true },
    });
    if (!pj) {
      console.log(`?? not found: ${n.nameStartsWith}`);
      continue;
    }
    if (pj.description && !pj.description.startsWith('Backfilled from Drive')) {
      console.log(`↷ ${pj.name} — has a hand-written description, left alone`);
      continue;
    }
    await prisma.project.update({ where: { id: pj.id }, data: { description: n.note } });
    console.log(`✔ ${pj.name}`);
  }
}

main()
  .catch((e) => { console.error('❌', e.message || e); process.exit(1); })
  .finally(() => prisma.$disconnect());
