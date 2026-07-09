import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const [projects, deployments, assignments] = await Promise.all([
    p.project.count({ where: { organizationId: ORG } }),
    p.projectDeployment.count({ where: { organizationId: ORG } }),
    p.assignment.count({ where: { project: { organizationId: ORG } } }),
  ]);
  const docsWithProject = await p.document.count({ where: { organizationId: ORG, projectId: { not: null } } });
  const docsWithDeployment = await p.document.count({ where: { organizationId: ORG, projectDeploymentId: { not: null } } });
  console.log({ projects, deployments, assignments, docsWithProject, docsWithDeployment });

  const byTypeStatus = await p.projectDeployment.groupBy({ by: ['type', 'status'], where: { organizationId: ORG }, _count: true });
  console.log('deployments by type/status:', byTypeStatus);

  // One rich example: an ACTIVE RENTAL deployment with assignments + linked docs
  const dep = await p.projectDeployment.findFirst({
    where: { organizationId: ORG, status: 'ACTIVE', type: 'RENTAL', monthlyRate: { not: null } },
    include: {
      project: { select: { projectNumber: true, name: true, customerId: true, status: true } },
      assignments: { include: { asset: { select: { name: true } }, inventory: { select: { sku: true, asset: { select: { name: true } } } } } },
      invoices: { select: { name: true, type: true, status: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 8 },
      sourceDocument: { select: { name: true, type: true } },
    },
  });
  if (dep) {
    console.log('\nEXAMPLE DEPLOYMENT:', JSON.stringify({
      deploymentNumber: dep.deploymentNumber, type: dep.type, status: dep.status,
      monthlyRate: dep.monthlyRate, deployedDate: dep.deployedDate, offHiredDate: dep.offHiredDate,
      project: dep.project, sourceDocument: dep.sourceDocument,
      assignments: dep.assignments.map((a: any) => ({ asset: a.asset?.name, inventorySku: a.inventory?.sku, invAsset: a.inventory?.asset?.name, qty: a.quantity, start: a.startDate, end: a.endDate })),
      linkedDocs: dep.invoices,
    }, null, 2));
  } else console.log('no active rental deployment with rate found');
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
