/**
 * Backfill Biofuel projects + deployments from ImportInvoice rows.
 *
 * Logic:
 *   1. Pull every ImportInvoice for Biofuel that has a non-empty projectName.
 *   2. Normalise project names → group rows per canonical project.
 *   3. For each project group, find-or-create a Project (matched on
 *      normalised name).
 *   4. Within a project, group rows by doNumber → find-or-create a
 *      ProjectDeployment. Use the matching DO Document as sourceDocumentId.
 *   5. For every invoice in the group, link the existing Document
 *      (matched by Document.name = invoiceNumber) to the deployment via
 *      `projectDeploymentId` and `projectId`.
 *
 * Idempotent — safe to re-run.
 *
 * Flags:
 *   --dry-run            print what would change, write nothing
 *   --org=<uuid>         override the default Biofuel org id
 *
 * Run:
 *   npx ts-node scripts/backfill-biofuel-deployments.ts --dry-run
 *   npx ts-node scripts/backfill-biofuel-deployments.ts
 */
import {
  PrismaClient,
  Prisma,
  DeploymentType,
  DeploymentStatus,
} from '@prisma/client';

const DEFAULT_ORG_ID = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1'; // Biofuel
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ORG_ID = (args.find((a) => a.startsWith('--org=')) ?? `--org=${DEFAULT_ORG_ID}`).split('=')[1];

const prisma = new PrismaClient();

function normaliseProjectName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let n = raw.toLowerCase().trim();
  // collapse common separators
  n = n.replace(/[\s\-_/&]+/g, ' ');
  // strip frequent prefixes
  n = n.replace(/^hdb\s+/, '');
  n = n.replace(/^the\s+/, '');
  // normalise project shorthand
  n = n.replace(/\bcc\s*7\s+cc\s*8\b/, 'cc7 cc8');
  n = n.replace(/\brvr\b/, 'river');
  n = n.replace(/\bpks\b/, 'peaks');
  return n.trim();
}

function safeParseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Detect "Off-Hired on 12/12/2025" or similar
function detectOffHire(refs: string[]): Date | null {
  const re = /off[\s-]*hired?\s*(?:on)?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i;
  for (const r of refs) {
    const m = r.match(re);
    if (m) {
      const day = +m[1];
      const month = +m[2] - 1;
      const yearRaw = +m[3];
      const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

interface DeploymentBucket {
  doNumber: string;
  rows: Array<{
    invoiceNumber: string;
    date: Date | null;
    gross: number;
    reference: string;
  }>;
}

interface ProjectBucket {
  key: string;
  displayName: string;
  customerNames: Set<string>;
  siteOfficeNames: Set<string>;
  byDo: Map<string, DeploymentBucket>;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? '(unset)';
  let host = '(unparseable)';
  try {
    host = new URL(dbUrl).hostname;
  } catch {
    /* ignore */
  }
  console.log('────────────────────────────────────────────────────');
  console.log('Backfill Biofuel projects + deployments');
  console.log('  org      :', ORG_ID);
  console.log('  database :', host);
  console.log('  mode     :', DRY_RUN ? 'DRY RUN (no writes)' : 'WRITE');
  console.log('────────────────────────────────────────────────────');

  // 1. Source rows
  const rows = await prisma.importInvoice.findMany({
    where: {
      organizationId: ORG_ID,
      projectName: { not: null },
    },
    orderBy: { date: 'asc' },
  });
  console.log(`Loaded ${rows.length} ImportInvoice rows with projectName.`);

  // 2. Group → projects → deployments
  const projects = new Map<string, ProjectBucket>();
  let skippedNoKey = 0;

  for (const row of rows) {
    const key = normaliseProjectName(row.projectName);
    if (!key) {
      skippedNoKey++;
      continue;
    }
    let proj = projects.get(key);
    if (!proj) {
      proj = {
        key,
        displayName: row.projectName!.trim(),
        customerNames: new Set(),
        siteOfficeNames: new Set(),
        byDo: new Map(),
      };
      projects.set(key, proj);
    }
    if (row.customer) proj.customerNames.add(row.customer.trim());
    if (row.siteOfficeName) proj.siteOfficeNames.add(row.siteOfficeName.trim());

    const doNum = (row.doNumber ?? '').trim() || `_NO_DO_${row.invoiceNumber}`;
    let bucket = proj.byDo.get(doNum);
    if (!bucket) {
      bucket = { doNumber: doNum, rows: [] };
      proj.byDo.set(doNum, bucket);
    }
    bucket.rows.push({
      invoiceNumber: row.invoiceNumber,
      date: safeParseDate(row.date) ?? null,
      gross: row.gross ?? 0,
      reference: row.invoiceNumber, // used for off-hire detection (Excel ref encodes it)
    });
  }

  console.log(
    `Grouped into ${projects.size} projects (${skippedNoKey} rows skipped — no project name).`,
  );

  let createdProjects = 0;
  let linkedProjects = 0;
  let createdDeployments = 0;
  let linkedDeployments = 0;
  let linkedDocuments = 0;
  let unmatchedDocuments = 0;

  for (const [, proj] of projects) {
    // 3. Find or create Project
    const existingProjects = await prisma.project.findMany({
      where: { organizationId: ORG_ID },
      select: { id: true, name: true, customerId: true },
    });
    const match = existingProjects.find(
      (p) => normaliseProjectName(p.name) === proj.key,
    );

    // Resolve customer (best effort — match by name within org)
    let customerId: string | null = match?.customerId ?? null;
    if (!customerId && proj.customerNames.size > 0) {
      const candidate = [...proj.customerNames][0];
      const cust = await prisma.customer.findFirst({
        where: {
          organizationId: ORG_ID,
          name: { equals: candidate, mode: Prisma.QueryMode.insensitive },
        },
        select: { id: true },
      });
      if (cust) customerId = cust.id;
    }

    let projectId: string;
    if (match) {
      projectId = match.id;
      linkedProjects++;
      console.log(`• Project (existing): "${proj.displayName}" (${match.id})`);
      // Patch customerId if missing on existing project but resolvable now
      if (!match.customerId && customerId && !DRY_RUN) {
        await prisma.project.update({
          where: { id: match.id },
          data: { customerId },
        });
      }
    } else {
      console.log(`+ Project (new):      "${proj.displayName}"`);
      if (DRY_RUN) {
        projectId = `(dry-run)`;
      } else {
        const created = await prisma.project.create({
          data: {
            name: proj.displayName,
            organizationId: ORG_ID,
            customerId: customerId ?? undefined,
            description: proj.siteOfficeNames.size
              ? `Site: ${[...proj.siteOfficeNames].join(' / ')}`
              : undefined,
          },
        });
        projectId = created.id;
      }
      createdProjects++;
    }

    // 4. Per DO → deployment
    for (const [doNum, bucket] of proj.byDo) {
      // Try to find the source DO Document — biofuel DO numbers look like DO202310-010
      let sourceDocumentId: string | null = null;
      if (!doNum.startsWith('_NO_DO_')) {
        const doDoc = await prisma.document.findFirst({
          where: {
            organizationId: ORG_ID,
            type: { in: ['DELIVERY_ORDER', 'DO'] },
            name: { contains: doNum, mode: Prisma.QueryMode.insensitive },
          },
          select: { id: true },
        });
        if (doDoc) sourceDocumentId = doDoc.id;
      }

      // Determine deployment shape from the rows
      const grosses = bucket.rows.map((r) => r.gross);
      const isRecurring = bucket.rows.length > 1;
      const monthlyRate = isRecurring ? median(grosses) : null;
      const deployedDate =
        bucket.rows
          .map((r) => r.date)
          .filter((d): d is Date => !!d)
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      const offHiredDate = detectOffHire(bucket.rows.map((r) => r.reference));
      const status: DeploymentStatus = offHiredDate
        ? DeploymentStatus.OFF_HIRED
        : DeploymentStatus.ACTIVE;
      const type: DeploymentType = isRecurring
        ? DeploymentType.RENTAL
        : DeploymentType.SALE;

      const description = doNum.startsWith('_NO_DO_')
        ? `One-off (${bucket.rows.length} doc${bucket.rows.length > 1 ? 's' : ''})`
        : `${doNum}${isRecurring ? ` (×${bucket.rows.length} mths)` : ''}`;

      // Find existing deployment for this (project, doNumber) — match on description prefix
      let deploymentId: string;
      if (DRY_RUN || projectId === '(dry-run)') {
        deploymentId = '(dry-run)';
        createdDeployments++;
        console.log(
          `  + Deployment: ${doNum.padEnd(22)} ${type} ${status} rate=${monthlyRate ?? '-'} invoices=${bucket.rows.length}`,
        );
      } else {
        const existingDep = await prisma.projectDeployment.findFirst({
          where: {
            projectId,
            organizationId: ORG_ID,
            // poor-man's idempotency key: description starts with the DO number
            description: { startsWith: doNum.startsWith('_NO_DO_') ? `One-off` : doNum },
          },
          select: { id: true },
        });
        if (existingDep) {
          deploymentId = existingDep.id;
          linkedDeployments++;
        } else {
          const created = await prisma.projectDeployment.create({
            data: {
              projectId,
              organizationId: ORG_ID,
              type,
              status,
              description,
              monthlyRate: monthlyRate ?? undefined,
              currency: 'SGD',
              deployedDate: deployedDate ?? undefined,
              offHiredDate: offHiredDate ?? undefined,
              sourceDocumentId: sourceDocumentId ?? undefined,
            },
          });
          deploymentId = created.id;
          createdDeployments++;
          console.log(
            `  + Deployment: ${doNum.padEnd(22)} ${type} ${status} rate=${monthlyRate ?? '-'} invoices=${bucket.rows.length}`,
          );
        }
      }

      // 5. Link each invoice Document
      for (const inv of bucket.rows) {
        const doc = await prisma.document.findFirst({
          where: {
            organizationId: ORG_ID,
            name: { contains: inv.invoiceNumber, mode: Prisma.QueryMode.insensitive },
          },
          select: { id: true, projectDeploymentId: true, projectId: true },
        });
        if (!doc) {
          unmatchedDocuments++;
          continue;
        }
        if (doc.projectDeploymentId === deploymentId && doc.projectId === projectId) {
          continue; // already linked
        }
        if (DRY_RUN) {
          linkedDocuments++;
          continue;
        }
        await prisma.document.update({
          where: { id: doc.id },
          data: {
            projectDeploymentId: deploymentId,
            projectId,
          },
        });
        linkedDocuments++;
      }
    }
  }

  console.log('────────────────────────────────────────────────────');
  console.log('Summary');
  console.log('  projects created   :', createdProjects);
  console.log('  projects matched   :', linkedProjects);
  console.log('  deployments created:', createdDeployments);
  console.log('  deployments matched:', linkedDeployments);
  console.log('  documents linked   :', linkedDocuments);
  console.log('  documents unmatched:', unmatchedDocuments);
  console.log(DRY_RUN ? '(dry-run — no writes performed)' : 'Writes committed.');
}

main()
  .catch((e) => {
    console.error('Backfill failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
