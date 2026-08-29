import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const readUrl = (f: string) => fs.readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL'))!.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '').trim().replace(/"$/, '');
const BF = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: readUrl('.env.production') } } });
  const users = await p.user.findMany({ where: { OR: [{ email: { contains: 'test2', mode: 'insensitive' } }, { name: { contains: 'test2', mode: 'insensitive' } }] }, select: { id: true, email: true, name: true } });
  console.log('matching users:', JSON.stringify(users));
  for (const u of users) {
    const membership = await p.userOrganization.findFirst({ where: { userId: u.id, organizationId: BF } });
    const roles = await p.userRole.findMany({ where: { userId: u.id, role: { organizationId: BF } }, include: { role: { select: { name: true, allowedModules: true } } } });
    console.log(`\nuser ${u.email}: BF membership=${membership ? 'YES' : 'NO'}`);
    for (const r of roles) console.log(`  role "${r.role.name}" allowedModules: [${r.role.allowedModules.join(', ') || 'ALL (empty)'}]`);
    if (!roles.length) console.log('  (no roles in Biofuel)');
  }
  const mods = await p.organizationModule.findMany({ where: { organizationId: BF }, select: { moduleCode: true, enabled: true } });
  console.log('\nBiofuel org module rows:', mods.map((m) => `${m.moduleCode}${m.enabled ? '' : '(OFF)'}`).join(', '));
  await p.$disconnect();
})();
