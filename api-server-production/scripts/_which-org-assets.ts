import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const readUrl = (f: string) => fs.readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL'))!.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '').trim().replace(/"$/, '');
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: readUrl('.env.production') } } });
  const rows = await p.organizationModule.findMany({ where: { moduleCode: { in: ['ASSETS', 'DOCUMENTS', 'AUDIT'] }, enabled: true }, include: { organization: { select: { name: true } } } });
  const byOrg: Record<string, string[]> = {};
  for (const r of rows) (byOrg[r.organization.name] ||= []).push(r.moduleCode);
  console.log(JSON.stringify(byOrg, null, 1));
  await p.$disconnect();
})();
