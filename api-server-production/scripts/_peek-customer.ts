import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
(async () => {
  const c = await prisma.customer.findUnique({
    where: { id: process.argv[2] },
    select: { id: true, name: true, customerCode: true, address: true, email: true, phone: true },
  });
  console.log(c ? JSON.stringify(c, null, 2) : 'not found');
  await prisma.$disconnect();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
