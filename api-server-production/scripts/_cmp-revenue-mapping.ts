import { PrismaClient } from '@prisma/client';

async function probe(label: string, url: string) {
  const p = new PrismaClient({ datasources: { db: { url } } });
  try {
    const org = await p.organization.findFirst({ where: { name: { contains: 'Biofuel' } }, select: { id: true, name: true } });
    if (!org) { console.log(`${label}: NO BIOFUEL ORG`); return; }
    const rev = await p.revenueItem.findMany({ where: { organizationId: org.id }, orderBy: { name: 'asc' } });
    const salesAcc = await p.asset.count({ where: { organizationId: org.id, salesAccountCode: { not: null } } });
    const rentalAcc = await p.asset.count({ where: { organizationId: org.id, rentalAccountCode: { not: null } } });
    console.log(`${label} (org ${org.id}):`);
    console.log(`  RevenueItem rows: ${rev.length}`);
    rev.forEach(r => console.log(`    - ${r.name} -> ${r.accountCode}`));
    console.log(`  Assets with salesAccountCode: ${salesAcc}, rentalAccountCode: ${rentalAcc}`);
  } finally { await p.$disconnect(); }
}

(async () => {
  const { config } = await import('dotenv');
  const devUrl = config({ path: '.env' }).parsed!.DATABASE_URL;
  const stgUrl = config({ path: '.env.staging', override: true }).parsed!.DATABASE_URL;
  const prodUrl = config({ path: '.env.production', override: true }).parsed!.DATABASE_URL;
  await probe('DEV', devUrl);
  await probe('STAGING', stgUrl);
  await probe('PROD', prodUrl);
})();
