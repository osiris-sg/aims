import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const readUrl = (f: string) => fs.readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL'))!.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '').trim().replace(/"$/, '');
const BF = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: readUrl('.env.production') } } });
  const rows = await p.organizationModule.findMany({ where: { organizationId: BF, moduleCode: { in: ['DELIVERIES', 'CUSTOMER_INFORMATION'] } } });
  for (const r of rows) console.log(r.moduleCode, '| enabled', r.enabled, '| displayName', r.displayName, '| icon', r.icon, '| config', JSON.stringify(r.config));
  const bad = rows.find((r) => r.moduleCode === 'DELIVERIES' && !r.displayName && !r.icon && !r.config);
  if (bad) {
    await p.organizationModule.delete({ where: { id: bad.id } });
    console.log('deleted the bare DELIVERIES row — catalog default (truck icon, /portal/deliveries) takes over');
  } else {
    console.log('no bare DELIVERIES row found');
  }
  await p.$disconnect();
})();
