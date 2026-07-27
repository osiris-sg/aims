// One-off: turn on enableGuideAssistant for the Osiris demo org (dev DB).
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.findFirst({
    where: { name: { contains: 'Osiris Technology', mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (!org) throw new Error('Osiris org not found');

  const cfg = await prisma.organizationUIConfig.findFirst({ where: { organizationId: org.id } });
  if (!cfg) throw new Error(`No OrganizationUIConfig row for ${org.name}`);
  const features = { ...((cfg.features as any) || {}), enableGuideAssistant: true };
  await prisma.organizationUIConfig.update({ where: { id: cfg.id }, data: { features } });
  console.log(`enableGuideAssistant=true for ${org.name} (${org.id})`);
}

main().finally(() => prisma.$disconnect());
