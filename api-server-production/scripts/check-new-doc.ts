import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const d = await p.document.findUnique({ where: { id: '0d33b9a1-cf0a-4e3b-a4ca-8ad56bb382eb' }, select: { id: true, name: true, organizationId: true, status: true, createdAt: true } });
  console.log('doc:', JSON.stringify(d));
  if (d) {
    const org = await p.organization.findUnique({ where: { id: d.organizationId }, select: { name: true } });
    console.log('org:', org?.name);
  }
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
