import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const t1 = await prisma.documentTemplate.findUnique({ where: { id: 'cc6d0035-993f-403f-8dd6-582ce8b10b0b' }, select: { id: true, type: true, name: true } });
  const t2 = await prisma.documentTemplate.findUnique({ where: { id: 'daa7a601-60f2-48da-9e3a-737ee6bf6987' }, select: { id: true, type: true, name: true } });
  console.log('Invoice template:', t1 ? `${t1.name} (${t1.type})` : 'MISSING');
  console.log('Bill template:', t2 ? `${t2.name} (${t2.type})` : 'MISSING');
}
main().finally(() => prisma.$disconnect());
