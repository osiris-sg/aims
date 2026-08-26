import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const readUrl = (f: string) => fs.readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL'))!.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '').trim().replace(/"$/, '');
(async () => {
  for (const [env, file] of [['dev', '.env'], ['prod', '.env.production']] as const) {
    const p = new PrismaClient({ datasources: { db: { url: readUrl(file) } } });
    const orgs = await p.organization.findMany({ where: { name: { contains: 'tanglin', mode: 'insensitive' } }, select: { id: true, name: true } });
    const custs = await p.customer.findMany({ where: { name: { contains: 'tanglin', mode: 'insensitive' } }, select: { id: true, name: true, customerCode: true, organizationId: true } });
    console.log(`== ${env}: orgs`, orgs, '| customers', custs);
    await p.$disconnect();
  }
})();
