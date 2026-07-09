import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const t = await p.recurringInvoiceTemplate.findFirst({ where: { name: 'Recurring — BI2026070003' } });
  if (!t) { console.log('template missing'); return; }
  const proj = await p.project.create({
    data: { name: 'RECURRING OFF-HIRE TEST (scratch)', organizationId: ORG, customerId: t.customerId, status: 'ongoing' },
  });
  const dep = await p.projectDeployment.create({
    data: { organizationId: ORG, projectId: proj.id, deploymentNumber: 1, type: 'RENTAL', monthlyRate: 500, deployedDate: new Date('2026-07-07T00:00:00+08:00'), status: 'ACTIVE', description: 'scratch deployment for off-hire test' },
  });
  await p.recurringInvoiceTemplate.update({ where: { id: t.id }, data: { projectId: proj.id, projectDeploymentId: dep.id, isActive: true } });
  console.log('projectId:', proj.id);
  console.log('deploymentId:', dep.id);
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
