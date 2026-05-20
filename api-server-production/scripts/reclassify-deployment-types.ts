/**
 * One-off: re-evaluate every ProjectDeployment's type against the shared
 * classifier and update rows where the new classification disagrees with
 * what's stored.
 *
 * Defaults to DRY-RUN. Pass --apply to actually write (78 rows for Biofuel
 * per the dry-run preview — see scripts/inspect-deployment-types.ts for the
 * scouting report).
 *
 *   npx ts-node scripts/reclassify-deployment-types.ts             # dry-run (default)
 *   npx ts-node scripts/reclassify-deployment-types.ts --apply     # commit changes
 *   npx ts-node scripts/reclassify-deployment-types.ts --org=<uuid>
 *
 * SERVICE-type deployments are SKIPPED — SERVICE is determined elsewhere
 * (line-item isService flag at view time) and shouldn't be overwritten here.
 */
import { PrismaClient, DeploymentType } from '@prisma/client';
import { classifyDeployment } from '../src/projects/deployment-type-classifier';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DEFAULT_ORG_ID = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1'; // Biofuel
const orgArg = args.find((a) => a.startsWith('--org='));
const ORG_ID = orgArg ? orgArg.split('=')[1] : DEFAULT_ORG_ID;

function findMatchingInvoice(
  matched: string,
  invoices: Array<{ name: string | null; config: any }>,
): { name: string | null; snippet: string } | null {
  const needle = matched.toLowerCase();
  for (const inv of invoices) {
    const cfg = (inv.config ?? {}) as any;
    if (!Array.isArray(cfg.items)) continue;
    for (const item of cfg.items) {
      const desc = typeof item?.description === 'string' ? item.description : '';
      if (!desc) continue;
      if (desc.toLowerCase().includes(needle)) {
        return {
          name: inv.name,
          snippet: desc.replace(/\s+/g, ' ').slice(0, 100),
        };
      }
    }
  }
  return null;
}

async function main() {
  console.log('────────────────────────────────────────────────────');
  console.log(' Reclassify deployment types');
  console.log('  org   :', ORG_ID);
  console.log('  mode  :', APPLY ? 'APPLY (writes)' : 'DRY-RUN — pass --apply to commit');
  console.log('────────────────────────────────────────────────────');

  const deployments = await prisma.projectDeployment.findMany({
    where: { organizationId: ORG_ID },
    include: {
      project: { select: { name: true } },
      sourceDocument: { select: { type: true } },
      invoices: { select: { id: true, name: true, config: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  let unchanged = 0;
  let skippedService = 0;
  let saleToRental = 0;
  let rentalToSale = 0;
  let viaSignal = 0;
  let viaSourceDoc = 0;
  let viaCount = 0;

  for (const dep of deployments) {
    // SERVICE is determined elsewhere — never overwrite.
    if (dep.type === DeploymentType.SERVICE) {
      skippedService++;
      continue;
    }

    const descriptions: string[] = [];
    for (const inv of dep.invoices) {
      const cfg = (inv.config ?? {}) as any;
      if (!Array.isArray(cfg.items)) continue;
      for (const item of cfg.items) {
        if (typeof item?.description === 'string') {
          descriptions.push(item.description);
        }
      }
    }

    const result = classifyDeployment({
      descriptions,
      invoiceCount: dep.invoices.length,
      sourceDocType: dep.sourceDocument?.type ?? null,
    });

    if (result.type === dep.type) {
      unchanged++;
      continue;
    }

    const projHead = dep.project.name.slice(0, 40).padEnd(40);
    const desc = (dep.description ?? '').slice(0, 30).padEnd(30);
    const arrow = `${dep.type} → ${result.type}`;
    console.log(`${arrow.padEnd(16)} ${projHead} / ${desc}`);

    if (result.matched) {
      viaSignal++;
      const hit = findMatchingInvoice(result.matched, dep.invoices);
      if (hit) {
        console.log(`                  reason: matched "${result.matched}" in ${hit.name} ("${hit.snippet}…")`);
      } else {
        console.log(`                  reason: matched "${result.matched}" in invoice description`);
      }
    } else if (result.reason.startsWith('source document')) {
      viaSourceDoc++;
      console.log(`                  reason: ${result.reason}`);
    } else if (result.reason.startsWith('invoice count')) {
      viaCount++;
      console.log(`                  reason: ${result.reason}`);
    } else {
      console.log(`                  reason: ${result.reason}`);
    }

    if (result.type === 'RENTAL') saleToRental++;
    else rentalToSale++;

    if (APPLY) {
      await prisma.projectDeployment.update({
        where: { id: dep.id },
        data: {
          type: result.type === 'RENTAL' ? DeploymentType.RENTAL : DeploymentType.SALE,
        },
      });
    }
  }

  console.log('────────────────────────────────────────────────────');
  console.log(' Summary');
  console.log('  total scanned    :', deployments.length);
  console.log('  unchanged        :', unchanged);
  console.log('  SERVICE skipped  :', skippedService);
  console.log('  SALE → RENTAL    :', saleToRental);
  console.log('  RENTAL → SALE    :', rentalToSale);
  console.log('  via signal match :', viaSignal);
  console.log('  via source DO    :', viaSourceDoc);
  console.log('  via count > 1    :', viaCount);
  console.log(APPLY ? '  Writes committed.' : '  (dry-run — no writes; pass --apply to commit)');
}

main()
  .catch((e) => {
    console.error('reclassify failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
