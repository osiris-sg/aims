import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const readUrl = (f: string) => fs.readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL'))!.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '').trim().replace(/"$/, '');
const TEST_ORG = '7e570e60-0000-4000-8000-7e570e600001';
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: readUrl('.env.production') } } });
  const role = await p.role.findFirst({ where: { organizationId: TEST_ORG, name: 'Admin' }, include: { permissions: { select: { resource: true, action: true } } } });
  const acct = role!.permissions.filter((x) => /account|journal|report|statement/.test(x.resource));
  console.log('Admin@TestOrg perms count:', role!.permissions.length);
  console.log('accounting-ish perms:', acct.map((x) => `${x.resource}:${x.action}`).join(', ') || 'NONE');
  await p.$disconnect();
})();
