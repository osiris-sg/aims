import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const leads = await prisma.lead.findMany({
    where: { OR: [{ name: { contains: 'Loon', mode: 'insensitive' } }, { phone: { contains: '9060346990298341' } }] },
    select: { id: true, name: true, phone: true, whatsappPhone: true, phones: true, source: true, status: true, assignedToName: true, organizationId: true },
  });
  console.log(JSON.stringify(leads, null, 2));
}
main().finally(() => prisma.$disconnect());
