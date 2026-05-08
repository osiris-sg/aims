/**
 * Phase 6 — merge duplicate projects.
 *
 * Default mode: DRY RUN (prints plan, no writes).
 * Pass --execute to actually merge.
 *
 * Algorithm:
 *   - Group projects by normalized name (org-wide).
 *   - For each cluster (>1 project), pick canonical:
 *       primary score = assignments + documents + deployments
 *       tiebreaker 1 = has non-null customerId
 *       tiebreaker 2 = oldest createdAt
 *   - Resulting customerId on canonical = its existing customerId, or
 *       the first non-null customerId among absorbed projects.
 *   - Reassign Assignment, Document, ProjectDeployment from absorbed → canonical.
 *   - If both canonical and any absorbed have deployments, renumber AFTER move
 *     to fan out collisions: absorbed deployments get new numbers
 *     starting at MAX(canonical existing) + 1.
 *   - Delete absorbed Project rows.
 *   - Each cluster wrapped in prisma.$transaction.
 *
 * Refuses on prod URLs. Run from api-server-production/.
 */
import { PrismaClient } from '@prisma/client';

const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1'; // Biofuel
const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');

const LEAD_PREFIXES = ['hdb ', 'the ', 'mr ', 'mrs '];
const ROMAN = new Set(['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x']);
const PHASE_RE = /^phase$/i;

function normalizeProjectName(raw: string | null | undefined): string {
  if (!raw) return '';
  let n = raw.toLowerCase().trim();
  for (const p of LEAD_PREFIXES) {
    while (n.startsWith(p)) n = n.slice(p.length).trimStart();
  }
  n = n.replace(/[-_/&,]+/g, ' ');
  n = n.replace(/\s+/g, ' ').trim();
  let tokens = n.split(' ');
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    const isCcNum = /^cc\d+$/i.test(last);
    const isRoman = ROMAN.has(last);
    // "Phase 2" pair: drop both. Pure standalone digits are NOT stripped —
    // "Lane 3" vs "Lane 4" are different physical addresses (verified via
    // ImportInvoice.projectLocation diff).
    if (
      tokens.length >= 2 &&
      PHASE_RE.test(tokens[tokens.length - 2]) &&
      /^\d+$/.test(last)
    ) {
      tokens.pop();
      tokens.pop();
      continue;
    }
    if (isCcNum || isRoman) {
      tokens.pop();
      continue;
    }
    break;
  }
  if (tokens.length > 0) {
    const last = tokens[tokens.length - 1];
    if (last.length >= 4 && last.endsWith('s')) {
      tokens[tokens.length - 1] = last.slice(0, -1);
    }
  }
  return tokens.join(' ');
}

function describeDb(rawUrl: string | undefined): { display: string; isProd: boolean } {
  if (!rawUrl) return { display: '(unset)', isProd: false };
  let host = '?', dbName = '?';
  try {
    const u = new URL(rawUrl);
    host = u.hostname;
    dbName = u.pathname.replace(/^\//, '') || '?';
  } catch {}
  const lower = rawUrl.toLowerCase();
  return { display: `${host}/${dbName}`, isProd: lower.includes('prod') || lower.includes('production') };
}

const prisma = new PrismaClient();

interface ProjectRow {
  id: string;
  name: string;
  customerId: string | null;
  customerName: string | null;
  createdAt: Date;
  assignments: number;
  documents: number;
  deployments: number;
  normalized: string;
}

function pickCanonical(arr: ProjectRow[]): ProjectRow {
  return [...arr].sort((a, b) => {
    const sa = a.assignments + a.documents + a.deployments;
    const sb = b.assignments + b.documents + b.deployments;
    if (sb !== sa) return sb - sa;
    const ca = a.customerId ? 1 : 0;
    const cb = b.customerId ? 1 : 0;
    if (cb !== ca) return cb - ca;
    return a.createdAt.getTime() - b.createdAt.getTime();
  })[0];
}

async function main() {
  const { display, isProd } = describeDb(process.env.DATABASE_URL);
  if (isProd) {
    console.error(`REFUSING: DATABASE_URL points at ${display} (looks prod-ish). Exiting.`);
    process.exit(1);
  }
  console.log(`Phase 6 merge — host ${display} — mode=${EXECUTE ? 'EXECUTE (writes)' : 'DRY RUN (no writes)'}`);
  console.log('');

  const raw = await prisma.project.findMany({
    where: { organizationId: ORG },
    include: {
      customer: { select: { id: true, name: true } },
      siteOffice: { select: { customer: { select: { id: true, name: true } } } },
      _count: { select: { assignments: true, documents: true, deployments: true } },
    },
  });
  const projects: ProjectRow[] = raw.map((p) => {
    const customer = p.customer ?? p.siteOffice?.customer ?? null;
    return {
      id: p.id,
      name: p.name,
      customerId: customer?.id ?? null,
      customerName: customer?.name ?? null,
      createdAt: p.createdAt,
      assignments: p._count.assignments,
      documents: p._count.documents,
      deployments: p._count.deployments,
      normalized: normalizeProjectName(p.name),
    };
  });

  // Cluster by normalized name only (per user direction — auto-merge cross-customer).
  const clusters = new Map<string, ProjectRow[]>();
  for (const p of projects) {
    if (!p.normalized) continue;
    const arr = clusters.get(p.normalized) ?? [];
    arr.push(p);
    clusters.set(p.normalized, arr);
  }
  const dupClusters = [...clusters.entries()].filter(([, arr]) => arr.length > 1);
  dupClusters.sort((a, b) => b[1].length - a[1].length);

  let totalProjectsToDelete = 0;
  let totalAssignmentsToReassign = 0;
  let totalDocumentsToReassign = 0;
  let totalDeploymentsToReassign = 0;

  console.log(`================ Merge plan ================`);
  console.log(`Found ${dupClusters.length} duplicate clusters (>1 project per normalized name):`);
  console.log('');

  for (const [norm, arr] of dupClusters) {
    const canonical = pickCanonical(arr);
    const absorbed = arr.filter((p) => p.id !== canonical.id);

    const customerSrcId =
      canonical.customerId ??
      absorbed.map((p) => p.customerId).find((id) => !!id) ??
      null;
    const customerSrcName =
      canonical.customerName ??
      absorbed.map((p) => p.customerName).find((n) => !!n) ??
      null;
    const willPatchCustomer = !canonical.customerId && customerSrcId !== null;

    const reassignA = absorbed.reduce((s, p) => s + p.assignments, 0);
    const reassignD = absorbed.reduce((s, p) => s + p.documents, 0);
    const reassignDep = absorbed.reduce((s, p) => s + p.deployments, 0);
    const renumberNeeded = canonical.deployments > 0 && reassignDep > 0;

    totalProjectsToDelete += absorbed.length;
    totalAssignmentsToReassign += reassignA;
    totalDocumentsToReassign += reassignD;
    totalDeploymentsToReassign += reassignDep;

    console.log(`Cluster "${norm}" — ${arr.length} projects`);
    console.log(`  CANONICAL : id=${canonical.id}  name="${canonical.name}"`);
    console.log(`              customer=${canonical.customerName ?? '(null)'} (id=${canonical.customerId ?? '(null)'})`);
    console.log(`              counts: assignments=${canonical.assignments} documents=${canonical.documents} deployments=${canonical.deployments}`);
    if (willPatchCustomer) {
      console.log(`  CUSTOMER PATCH: canonical.customerId is null → will set to "${customerSrcName}" (${customerSrcId})`);
    } else {
      console.log(`  CUSTOMER PATCH: none — canonical already has customerId=${canonical.customerId ?? '(null)'}`);
    }
    for (const a of absorbed) {
      console.log(`  ABSORB    : id=${a.id}  name="${a.name}"  customer=${a.customerName ?? '(null)'}  ` +
        `a=${a.assignments} d=${a.documents} dep=${a.deployments}`);
    }
    console.log(`  Reassigning: assignments=${reassignA}  documents=${reassignD}  deployments=${reassignDep}`);
    console.log(`  Deployment renumber on canonical: ${renumberNeeded ? 'YES' : 'no'}`);
    console.log('');
  }

  console.log(`================ Totals ================`);
  console.log(`  Clusters to merge          : ${dupClusters.length}`);
  console.log(`  Projects to delete         : ${totalProjectsToDelete}`);
  console.log(`  Assignments to reassign    : ${totalAssignmentsToReassign}`);
  console.log(`  Documents to reassign      : ${totalDocumentsToReassign}`);
  console.log(`  Deployments to reassign    : ${totalDeploymentsToReassign}`);
  console.log('');

  if (!EXECUTE) {
    console.log('DRY RUN — pass --execute to actually merge.');
    await prisma.$disconnect();
    return;
  }

  // -------- EXECUTE PATH --------
  console.log('================ Executing merges ================');
  for (const [norm, arr] of dupClusters) {
    const canonical = pickCanonical(arr);
    const absorbed = arr.filter((p) => p.id !== canonical.id);
    const customerSrcId =
      canonical.customerId ??
      absorbed.map((p) => p.customerId).find((id) => !!id) ??
      null;
    const willPatchCustomer = !canonical.customerId && customerSrcId !== null;

    console.log(`\nMerging "${norm}" → keep ${canonical.id} (${canonical.name})`);

    await prisma.$transaction(async (tx) => {
      const absorbedIds = absorbed.map((p) => p.id);

      // 0. Detect and drop colliding inventory-mode Assignments.
      //    The unique constraint @@unique([projectId, inventoryId]) means we
      //    can't reassign an absorbed Assignment to the canonical if the
      //    canonical already has an Assignment for the same inventoryId.
      //    Drop the absorbed one — the canonical's existing reference stands.
      //    The absorbed Document still merges onto the canonical, so
      //    navigation Document→Project stays intact even without the
      //    Assignment row. (Mirrors what importSingleInvoice's idempotency
      //    check at :540-548 would have done if the project hadn't been
      //    split in the first place.)
      const canonicalInvAssignments = await tx.assignment.findMany({
        where: { projectId: canonical.id, inventoryId: { not: null } },
        select: { inventoryId: true },
      });
      const canonicalInventoryIds = new Set(
        canonicalInvAssignments.map((a) => a.inventoryId).filter((x): x is string => !!x),
      );
      let droppedInventoryCollisions = 0;
      if (canonicalInventoryIds.size > 0) {
        const collidingAbsorbed = await tx.assignment.findMany({
          where: {
            projectId: { in: absorbedIds },
            inventoryId: { in: [...canonicalInventoryIds] },
          },
          select: { id: true, inventoryId: true, documentId: true, projectId: true },
        });
        for (const c of collidingAbsorbed) {
          // Find the canonical's existing Assignment for the same inventoryId
          // so the audit log shows both source documents.
          const canonRow = await tx.assignment.findFirst({
            where: { projectId: canonical.id, inventoryId: c.inventoryId },
            select: { id: true, documentId: true },
          });
          console.log(
            `  DROP COLLIDING ASSIGNMENT: id=${c.id}  inventoryId=${c.inventoryId}  ` +
              `absorbedDocumentId=${c.documentId ?? '?'}  canonicalDocumentId=${canonRow?.documentId ?? '?'}`,
          );
          await tx.assignment.delete({ where: { id: c.id } });
          droppedInventoryCollisions++;
        }
      }
      if (droppedInventoryCollisions > 0) {
        console.log(`  dropped colliding inventory assignments: ${droppedInventoryCollisions}`);
      }

      // Same-shape check for asset-mode collisions on (projectId, assetId, documentId).
      const canonicalAssetRows = await tx.assignment.findMany({
        where: { projectId: canonical.id, assetId: { not: null } },
        select: { assetId: true, documentId: true },
      });
      const canonAssetKeys = new Set(
        canonicalAssetRows.map((a) => `${a.assetId}|${a.documentId ?? '_'}`),
      );
      let droppedAssetCollisions = 0;
      if (canonAssetKeys.size > 0) {
        const absorbedAssetRows = await tx.assignment.findMany({
          where: { projectId: { in: absorbedIds }, assetId: { not: null } },
          select: { id: true, assetId: true, documentId: true },
        });
        for (const a of absorbedAssetRows) {
          const k = `${a.assetId}|${a.documentId ?? '_'}`;
          if (canonAssetKeys.has(k)) {
            console.log(
              `  DROP COLLIDING ASSET-MODE ASSIGNMENT: id=${a.id}  assetId=${a.assetId}  documentId=${a.documentId ?? '?'}`,
            );
            await tx.assignment.delete({ where: { id: a.id } });
            droppedAssetCollisions++;
          }
        }
      }
      if (droppedAssetCollisions > 0) {
        console.log(`  dropped colliding asset-mode assignments: ${droppedAssetCollisions}`);
      }

      // 1. Reassign Assignments
      const aResult = await tx.assignment.updateMany({
        where: { projectId: { in: absorbedIds } },
        data: { projectId: canonical.id },
      });
      console.log(`  reassigned assignments     : ${aResult.count}`);

      // 2. Reassign Documents
      const dResult = await tx.document.updateMany({
        where: { projectId: { in: absorbedIds } },
        data: { projectId: canonical.id },
      });
      console.log(`  reassigned documents       : ${dResult.count}`);

      // 3. Reassign ProjectDeployments. Need to renumber to avoid
      //    (projectId, deploymentNumber) unique conflicts.
      //    Strategy: stage incoming deployments as NULL deploymentNumber first,
      //    then assign fresh numbers starting at MAX(canonical-existing) + 1.
      const incomingCount = await tx.projectDeployment.count({
        where: { projectId: { in: absorbedIds } },
      });
      if (incomingCount > 0) {
        // Step a: null-out their numbers (avoids unique conflict during reparent)
        await tx.projectDeployment.updateMany({
          where: { projectId: { in: absorbedIds } },
          data: { deploymentNumber: null },
        });
        // Step b: reparent
        const depResult = await tx.projectDeployment.updateMany({
          where: { projectId: { in: absorbedIds } },
          data: { projectId: canonical.id },
        });
        console.log(`  reassigned deployments     : ${depResult.count} (numbers nulled, will be reassigned by numbering script)`);
      } else {
        console.log(`  reassigned deployments     : 0`);
      }

      // 4. Patch canonical customerId if null and absorbed has one
      if (willPatchCustomer && customerSrcId) {
        await tx.project.update({
          where: { id: canonical.id },
          data: { customerId: customerSrcId },
        });
        console.log(`  patched canonical customer : set to ${customerSrcId}`);
      }

      // 5. Delete absorbed Project rows
      const dropResult = await tx.project.deleteMany({
        where: { id: { in: absorbedIds } },
      });
      console.log(`  deleted absorbed projects  : ${dropResult.count}`);
    });
  }
  console.log('\nAll cluster transactions committed.');
  console.log('Run: npm run number-existing-deployments  to renumber the canonicals cleanly.');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('merge failed:', e);
  await prisma.$disconnect();
  process.exit(1);
});
