// One-off (guru 2026-09-21): the "Mr Loon & Ms. Shu Yu" referral lead was
// keyed with BOTH numbers glued into one field ("9060346990298341"), so the
// wa.me link 404'd. Split into the two real numbers using the new phones[].
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const r = await prisma.lead.update({
    where: { id: '4139f97b-b18d-4690-a9f5-03bfc11619ff' },
    data: { phone: '90603469', whatsappPhone: '90298341', phones: ['90603469', '90298341'] },
    select: { name: true, phone: true, whatsappPhone: true, phones: true },
  });
  console.log('✔ split:', JSON.stringify(r));
}
main().finally(() => prisma.$disconnect());
