import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const doc = await p.document.findFirst({
    where: { organizationId: ORG, name: 'BI202602001' },
    select: { name: true, type: true, status: true, projectId: true, projectDeploymentId: true, baseDocumentId: true, config: true },
  });
  const c: any = doc?.config || {};
  console.log('name:', doc?.name, '| status:', doc?.status, '| projectId:', doc?.projectId, '| deploymentId:', doc?.projectDeploymentId);
  console.log('customer:', JSON.stringify(c.customer ?? { id: c.customerId, name: c.customerName }));
  console.log('documentInfo:', JSON.stringify(c.documentInfo)?.slice(0, 400));
  console.log('totals:', JSON.stringify({ subTotal: c.subTotal, gstAmount: c.gstAmount, nettTotal: c.nettTotal }));
  console.log('items:', JSON.stringify(c.items, null, 2)?.slice(0, 1200));
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
