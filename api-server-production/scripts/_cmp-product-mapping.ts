import { PrismaClient } from '@prisma/client';

async function fetchMap(url: string) {
  const p = new PrismaClient({ datasources: { db: { url } } });
  try {
    const org = await p.organization.findFirst({ where: { name: { contains: 'Biofuel' } } });
    const assets = await p.asset.findMany({
      where: { organizationId: org!.id, OR: [{ salesAccountCode: { not: null } }, { rentalAccountCode: { not: null } }] },
      select: { name: true, salesAccountCode: true, rentalAccountCode: true },
      orderBy: { name: 'asc' },
    });
    const m = new Map<string, string>();
    assets.forEach(a => m.set(a.name, `sales=${a.salesAccountCode ?? '-'} rental=${a.rentalAccountCode ?? '-'}`));
    return m;
  } finally { await p.$disconnect(); }
}

(async () => {
  const { config } = await import('dotenv');
  const devUrl = config({ path: '.env' }).parsed!.DATABASE_URL;
  const prodUrl = config({ path: '.env.production', override: true }).parsed!.DATABASE_URL;
  const [dev, prod] = await Promise.all([fetchMap(devUrl), fetchMap(prodUrl)]);
  const all = Array.from(new Set([...Array.from(dev.keys()), ...Array.from(prod.keys())])).sort();
  console.log('PRODUCT'.padEnd(45), '| DEV'.padEnd(28), '| PROD');
  for (const name of all) {
    const d = dev.get(name) ?? 'NOT MAPPED';
    const pr = prod.get(name) ?? 'NOT MAPPED';
    const mark = d === pr ? '  ' : '❌';
    console.log(mark, name.slice(0, 43).padEnd(43), '|', d.padEnd(26), '|', pr);
  }
  console.log(`\nTotal mapped: dev=${dev.size} prod=${prod.size}, differing/missing rows marked ❌`);
})();
