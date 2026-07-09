import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const orgs = await p.organization.findMany({ select: { id: true, name: true } });
  for (const o of orgs) {
    const c = await p.chartOfAccount.count({ where: { organizationId: o.id } });
    console.log(`${c.toString().padStart(4)} accounts | ${o.id} | ${o.name}`);
  }
}
main().finally(() => p.$disconnect());
