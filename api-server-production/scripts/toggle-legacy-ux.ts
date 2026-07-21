import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
async function main() {
  const cfg = await p.organizationUIConfig.findFirst({ where: { organizationId: ORG } });
  if (!cfg) { console.log('no ui config row'); return; }
  const features: any = { ...((cfg.features as any) || {}), enableLegacyAccountingUx: true };
  await p.organizationUIConfig.update({ where: { id: cfg.id }, data: { features } });
  console.log('enableLegacyAccountingUx = true for Biofuel dev');
}
main().catch((e) => console.error(e.message)).finally(() => p.$disconnect());
