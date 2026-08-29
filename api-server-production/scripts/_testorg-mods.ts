import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const readUrl = (f: string) => fs.readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL'))!.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '').trim().replace(/"$/, '');
const TEST_ORG = '7e570e60-0000-4000-8000-7e570e600001';
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: readUrl('.env.production') } } });
  const mods = await p.organizationModule.findMany({ where: { organizationId: TEST_ORG } });
  console.log('Test Org module rows:');
  for (const m of mods.sort((a, b) => a.moduleCode.localeCompare(b.moduleCode))) console.log(`  ${m.moduleCode}: ${m.enabled ? 'enabled' : 'OFF'}`);
  await p.$disconnect();
})();
