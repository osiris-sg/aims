import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
(async () => {
  const ids = await prisma.operatorIdentity.findMany({ select: { channelUserId: true, organizationId: true, clerkUserId: true } });
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  const ads = await prisma.adAccountConnection.findMany({ select: { organizationId: true } });
  for (const i of ids) {
    const org = orgs.find(o => o.id === i.organizationId);
    const hasAds = ads.some(a => a.organizationId === i.organizationId);
    console.log(`${i.channelUserId.padEnd(16)} -> ${org?.name || '(none set)'}   ads connected here: ${hasAds ? 'YES' : 'no'}`);
  }
  console.log('\nad account is on:', orgs.find(o => o.id === ads[0]?.organizationId)?.name);
  await prisma.$disconnect();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
