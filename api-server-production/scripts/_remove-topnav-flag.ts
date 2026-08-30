import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const cfg = await p.organizationUIConfig.findUnique({ where: { organizationId: 'osiris-platform' } });
  if (cfg?.features && (cfg.features as any).enableTopNav !== undefined) {
    const f: any = { ...(cfg.features as any) };
    delete f.enableTopNav;
    await p.organizationUIConfig.update({ where: { organizationId: 'osiris-platform' }, data: { features: f } });
    console.log('stale flag removed from dev');
  } else console.log('nothing to clean');
  await p.$disconnect();
})();
