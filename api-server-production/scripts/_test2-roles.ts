import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const readUrl = (f: string) => fs.readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL'))!.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '').trim().replace(/"$/, '');
const BF = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const UID = 'user_3FblokF1NQFDJEufF7fqPw5ERed';
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: readUrl('.env.production') } } });
  const membership = await p.userOrganization.findFirst({ where: { userId: UID, organizationId: BF } });
  console.log('BF membership:', membership ? `YES (active=${membership.isActive})` : 'NO');
  const roles = await p.userRole.findMany({ where: { userId: UID, organizationId: BF }, include: { role: { select: { name: true, allowedModules: true } } } });
  for (const r of roles) console.log(`role "${r.role.name}" (active=${r.isActive}) allowedModules: [${r.role.allowedModules.join(', ') || 'ALL'}]`);
  if (!roles.length) console.log('NO roles in Biofuel');
  const mods = await p.organizationModule.findMany({ where: { organizationId: BF } });
  console.log('\norg module rows:', mods.map((m) => `${m.moduleCode}${m.enabled ? '' : '(OFF)'}`).sort().join(', '));
  await p.$disconnect();
})();
