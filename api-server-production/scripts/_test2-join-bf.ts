import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const readUrl = (f: string) => fs.readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL'))!.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '').trim().replace(/"$/, '');
const BF = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const UID = 'user_3FblokF1NQFDJEufF7fqPw5ERed';
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: readUrl('.env.production') } } });
  const adminRole = await p.role.findFirst({ where: { organizationId: BF, name: 'Admin' } });
  if (!adminRole) throw new Error('Biofuel Admin role not found');
  const org = await p.userOrganization.upsert({
    where: { userId_organizationId: { userId: UID, organizationId: BF } },
    create: { userId: UID, organizationId: BF, isActive: true },
    update: { isActive: true },
  });
  const role = await p.userRole.upsert({
    where: { userId_roleId_organizationId: { userId: UID, roleId: adminRole.id, organizationId: BF } },
    create: { userId: UID, roleId: adminRole.id, organizationId: BF, isActive: true },
    update: { isActive: true },
  });
  console.log('membership:', org.id, '| role assignment:', role.id, '-> Admin');
  await p.$disconnect();
})();
