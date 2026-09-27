import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
(async () => {
  const rows = await prisma.whatsAppConnection.findMany({
    select: { organizationId: true, phoneNumberId: true, displayPhoneNumber: true, verifiedName: true, status: true, pin: true, mode: true, operatorEnabled: true, isPrimary: true, connectedAt: true },
  });
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  for (const r of rows) {
    console.log(`${r.displayPhoneNumber} (${r.verifiedName})  ${r.status}`);
    console.log(`   org: ${orgs.find(o=>o.id===r.organizationId)?.name}`);
    console.log(`   phoneNumberId: ${r.phoneNumberId}`);
    console.log(`   pin: ${r.pin ? 'set (registered via Cloud API)' : 'NULL -> coexistence (register was skipped)'}`);
    console.log(`   mode: ${r.mode}  operatorEnabled: ${r.operatorEnabled}  primary: ${r.isPrimary}\n`);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
