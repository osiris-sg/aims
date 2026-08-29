import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const readUrl = (f: string) => fs.readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL'))!.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '').trim().replace(/"$/, '');
const BF = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const TEST_ORG = '7e570e60-0000-4000-8000-7e570e600001';
const UID = 'user_3FblokF1NQFDJEufF7fqPw5ERed';
const APPLY = process.argv.includes('--apply');
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: readUrl('.env.production') } } });
  const admin = await p.role.findFirst({ where: { organizationId: BF, name: 'Admin' } });
  console.log('Biofuel Admin allowedModules:', JSON.stringify(admin!.allowedModules));
  if (APPLY && !admin!.allowedModules.includes('ACCOUNTING')) {
    await p.role.update({ where: { id: admin!.id }, data: { allowedModules: [...admin!.allowedModules, 'ACCOUNTING'] } });
    console.log('added ACCOUNTING to Biofuel Admin role');
  }
  if (APPLY) {
    const dr = await p.userRole.deleteMany({ where: { userId: UID, organizationId: TEST_ORG } });
    const dm = await p.userOrganization.deleteMany({ where: { userId: UID, organizationId: TEST_ORG } });
    console.log(`removed from Test Org: roles=${dr.count}, membership=${dm.count}`);
  }
  await p.$disconnect();
})();
