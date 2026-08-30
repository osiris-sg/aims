import { PrismaClient } from '@prisma/client';
const p = new PrismaClient(); // dev .env
(async () => {
  const org = await p.organization.findFirst({ where: { name: 'osiris-platform' } });
  const cfg = await p.organizationUIConfig.findUnique({ where: { organizationId: org!.id } });
  const features = { ...((cfg?.features as any) || {}), enableTopNav: true };
  if (cfg) await p.organizationUIConfig.update({ where: { organizationId: org!.id }, data: { features } });
  else await p.organizationUIConfig.create({ data: { organizationId: org!.id, features } as any });
  console.log('enableTopNav ON for', org!.name, org!.id);
  await p.$disconnect();
})();
