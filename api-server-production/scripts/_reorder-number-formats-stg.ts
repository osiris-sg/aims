import { PrismaClient } from '@prisma/client';

(async () => {
  const { config } = await import('dotenv');
  const url = config({ path: '.env.staging', override: true }).parsed!.DATABASE_URL;
  const p = new PrismaClient({ datasources: { db: { url } } });
  for (let i = 0; i < 5; i++) {
    try { await p.$queryRaw`SELECT 1`; break; } catch (e) { if (i === 4) throw e; await new Promise(r => setTimeout(r, 4000)); }
  }
  const org = await p.organization.findFirst({ where: { name: { contains: 'Biofuel' } } });
  if (!org) { console.log('no Biofuel org'); process.exit(1); }
  const formats = await p.documentNumberFormat.findMany({
    where: { organizationId: org.id },
    orderBy: [{ documentType: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  const byType = new Map<string, typeof formats>();
  formats.forEach((f) => byType.set(f.documentType, [...(byType.get(f.documentType) || []), f]));
  for (const [type, list] of Array.from(byType.entries())) {
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
    console.log(`STAGING ${type}: ${sorted.map((f, i) => `${i}:${f.label}`).join(', ')}`);
  }
  await p.$disconnect();
})();
