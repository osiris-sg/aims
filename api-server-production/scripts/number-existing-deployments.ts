/**
 * One-time numbering pass: assign deploymentNumber to existing
 * ProjectDeployment rows, in createdAt-asc order per project.
 *
 * Idempotent — re-running on already-numbered rows is a no-op.
 * Refuses on prod URLs.
 *
 * Run from api-server-production/:
 *   npx ts-node scripts/number-existing-deployments.ts
 */
import { PrismaClient } from '@prisma/client';

function describeDatabaseUrl(rawUrl: string | undefined): { display: string; isProd: boolean } {
  if (!rawUrl) return { display: '(unset)', isProd: false };
  let host = '(unparseable)';
  let dbName = '(unparseable)';
  try {
    const u = new URL(rawUrl);
    host = u.hostname;
    dbName = u.pathname.replace(/^\//, '') || '(none)';
  } catch {
    // fall through
  }
  const lower = rawUrl.toLowerCase();
  const isProd = lower.includes('prod') || lower.includes('production');
  return { display: `${host}/${dbName}`, isProd };
}

async function main() {
  const { display, isProd } = describeDatabaseUrl(process.env.DATABASE_URL);
  if (isProd) {
    console.error(`REFUSING: DATABASE_URL points at ${display} which contains "prod"/"production". Exiting.`);
    process.exit(1);
  }
  console.log(`Numbering deployments on host ${display}`);

  const prisma = new PrismaClient();
  try {
    const projects = await prisma.project.findMany({
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
    console.log(`Found ${projects.length} projects`);

    let totalProjectsTouched = 0;
    let totalDeploymentsNumbered = 0;
    let projectsAlreadyComplete = 0;

    for (const project of projects) {
      const deployments = await prisma.projectDeployment.findMany({
        where: { projectId: project.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, deploymentNumber: true },
      });

      if (deployments.length === 0) continue;

      const numbered = deployments.filter((d) => typeof d.deploymentNumber === 'number');
      const unnumbered = deployments.filter((d) => d.deploymentNumber == null);

      if (unnumbered.length === 0) {
        projectsAlreadyComplete++;
        continue;
      }

      // Start numbering from MAX(existing) + 1 if any are already numbered;
      // otherwise from 1. Keeps existing numbers stable.
      const maxExisting = numbered.reduce(
        (m, d) => (typeof d.deploymentNumber === 'number' && d.deploymentNumber > m ? d.deploymentNumber : m),
        0,
      );
      let next = maxExisting + 1;

      for (const d of unnumbered) {
        await prisma.projectDeployment.update({
          where: { id: d.id },
          data: { deploymentNumber: next },
        });
        next++;
        totalDeploymentsNumbered++;
      }

      totalProjectsTouched++;
      console.log(
        `Project "${project.name}" (id=${project.id}) — numbered ${unnumbered.length} deployments (now 1..${next - 1})`,
      );
    }

    console.log('');
    console.log('Summary:');
    console.log(`  projects scanned          : ${projects.length}`);
    console.log(`  projects already complete : ${projectsAlreadyComplete}`);
    console.log(`  projects updated          : ${totalProjectsTouched}`);
    console.log(`  deployments numbered      : ${totalDeploymentsNumbered}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('numbering pass failed:', err);
  process.exit(1);
});
