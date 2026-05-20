/**
 * One-off: migrate legacy MaintenanceServiceReport rows that used the
 * description-prefix convention to the new `kind` discriminator.
 *
 * Rules:
 *   - description starts with "DO Acknowledgement" → kind = DO_ACK,
 *     description rewritten to drop the prefix + " — " separator.
 *   - everything else stays kind = SERVICE (the schema default).
 *
 * Examples:
 *   "DO Acknowledgement (DO DO202510-003) — equipment received on site"
 *     → kind=DO_ACK, description="equipment received on site"
 *   "DO Acknowledgement (DO X)"  (no trailing notes)
 *     → kind=DO_ACK, description=""  (UI shows kind chip + asset context)
 *
 * Defaults to DRY-RUN. Pass --apply to write.
 *
 *   npx ts-node scripts/backfill-msr-kind.ts             # dry-run
 *   npx ts-node scripts/backfill-msr-kind.ts --apply     # commit changes
 *   npx ts-node scripts/backfill-msr-kind.ts --org=<uuid> [--apply]
 */
import { PrismaClient, MaintenanceReportKind } from '@prisma/client';

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const orgArg = args.find((a) => a.startsWith('--org='));
const ORG_FILTER = orgArg ? orgArg.split('=')[1] : null;

// Matches "DO Acknowledgement (DO X) — " or "DO Acknowledgement (DO X)" (no notes).
const PREFIX_RE = /^DO Acknowledgement\s*\([^)]*\)\s*(?:—\s*)?/;

async function main() {
  console.log('────────────────────────────────────────────────────');
  console.log(' Backfill MSR.kind from description prefix');
  console.log('  org    :', ORG_FILTER ?? '(all)');
  console.log('  mode   :', APPLY ? 'APPLY (writes)' : 'DRY-RUN — pass --apply to commit');
  console.log('────────────────────────────────────────────────────');

  const where: any = {
    description: { startsWith: 'DO Acknowledgement' },
    kind: MaintenanceReportKind.SERVICE, // skip rows already migrated
  };
  if (ORG_FILTER) where.organizationId = ORG_FILTER;

  const candidates = await prisma.maintenanceServiceReport.findMany({
    where,
    select: { id: true, description: true, organizationId: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${candidates.length} row(s) to migrate.`);
  if (candidates.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  let migrated = 0;
  for (const row of candidates) {
    const stripped = row.description.replace(PREFIX_RE, '').trim();
    const fitsPattern = stripped !== row.description;
    if (!fitsPattern) {
      // description started with "DO Acknowledgement" but didn't match the
      // full pattern (unexpected shape) — flag and skip.
      console.warn(`  ⚠️  unexpected shape, skipped: ${row.id}  "${row.description.slice(0, 80)}…"`);
      continue;
    }

    console.log(
      `  ${row.id.slice(0, 8)}…  "${row.description.slice(0, 60)}…"  →  kind=DO_ACK, desc="${stripped.slice(0, 60)}"`,
    );

    if (APPLY) {
      await prisma.maintenanceServiceReport.update({
        where: { id: row.id },
        data: {
          kind: MaintenanceReportKind.DO_ACK,
          description: stripped,
        },
      });
    }
    migrated++;
  }

  console.log('────────────────────────────────────────────────────');
  console.log(' Summary');
  console.log('  candidates : ', candidates.length);
  console.log('  migrated   : ', migrated);
  console.log(APPLY ? '  Writes committed.' : '  (dry-run — no writes; pass --apply to commit)');
}

main()
  .catch((e) => {
    console.error('backfill-msr-kind failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
