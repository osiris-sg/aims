import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const readUrl = (f: string) => fs.readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL'))!.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '').trim().replace(/"$/, '');
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: readUrl('.env.production') } } });
  const row = await p.organizationModule.findFirst({ where: { organizationId: '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1', moduleCode: 'ACCOUNTING' } });
  console.log(JSON.stringify({ enabled: row!.enabled, displayName: row!.displayName, config: row!.config }, null, 1).slice(0, 800));
  await p.$disconnect();
})();
