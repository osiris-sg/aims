import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const t = await p.recurringInvoiceTemplate.findFirst({ where: { name: 'Recurring — BI2026070003' } });
  console.log({ name: t?.name, isActive: t?.isActive, projectDeploymentId: t?.projectDeploymentId });
  const dep = await p.projectDeployment.findUnique({ where: { id: '8b66805a-e4f6-4752-b689-ac4b0d77ee06' }, select: { status: true, offHiredDate: true } });
  console.log('deployment:', dep);
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
