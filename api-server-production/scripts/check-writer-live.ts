import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  for (let i = 0; i < 3; i++) {
    const d = await p.document.findFirst({ where: { organizationId: ORG }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } });
    console.log('now=', new Date().toISOString(), 'latest doc write=', d?.updatedAt.toISOString());
    if (i < 2) await new Promise((r) => setTimeout(r, 8000));
  }
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
