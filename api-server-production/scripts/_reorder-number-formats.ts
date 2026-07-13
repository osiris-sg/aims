import { PrismaClient } from '@prisma/client';

async function run(label: string, url: string) {
  const p = new PrismaClient({ datasources: { db: { url } } });
  try {
    const org = await p.organization.findFirst({ where: { name: { contains: 'Biofuel' } } });
    if (!org) { console.log(`${label}: no Biofuel org`); return; }
    const formats = await p.documentNumberFormat.findMany({
      where: { organizationId: org.id },
      orderBy: [{ documentType: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const byType = new Map<string, typeof formats>();
    formats.forEach((f) => byType.set(f.documentType, [...(byType.get(f.documentType) || []), f]));
    for (const [type, list] of Array.from(byType.entries())) {
      // Rental/Sales first, everything else keeps its relative order after it.
      const sorted = [...list].sort((a, b) => {
        const aR = /rental\s*\/?\s*sales/i.test(a.label) ? 0 : 1;
        const bR = /rental\s*\/?\s*sales/i.test(b.label) ? 0 : 1;
        return aR - bR;
      });
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].sortOrder !== i) {
          await p.documentNumberFormat.update({ where: { id: sorted[i].id }, data: { sortOrder: i } });
        }
      }
      console.log(`${label} ${type}: ${sorted.map((f, i) => `${i}:${f.label}`).join(", ")}`);
    }
  } finally { await p.$disconnect(); }
}

(async () => {
  const { config } = await import('dotenv');
  const devUrl = config({ path: '.env' }).parsed!.DATABASE_URL;
  const stgUrl = config({ path: '.env.staging', override: true }).parsed!.DATABASE_URL;
  await run('DEV', devUrl);
  await run('STAGING', stgUrl);
})();
