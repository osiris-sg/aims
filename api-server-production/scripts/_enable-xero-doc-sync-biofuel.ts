/** Enable the enableXeroDocSync feature flag for Biofuel (dev). */
import { createScriptPrisma, BIOFUEL_ORG_ID } from './xero-migration/_common';
const prisma = createScriptPrisma();
async function main() {
  const cfg = await prisma.organizationUIConfig.findFirst({ where: { organizationId: BIOFUEL_ORG_ID } });
  if (!cfg) {
    await prisma.organizationUIConfig.create({
      data: { organizationId: BIOFUEL_ORG_ID, features: { enableXeroDocSync: true } as any },
    });
    console.log('✓ created UI config with enableXeroDocSync=true');
    return;
  }
  const features = { ...((cfg.features as any) || {}), enableXeroDocSync: true };
  await prisma.organizationUIConfig.update({ where: { id: cfg.id }, data: { features } });
  console.log('✓ enableXeroDocSync=true for Biofuel');
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
