import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const readUrl = (f: string) => fs.readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL'))!.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '').trim().replace(/"$/, '');
const UID = 'user_3FblokF1NQFDJEufF7fqPw5ERed';
(async () => {
  for (const [env, file] of [['prod', '.env.production'], ['dev', '.env']] as const) {
    const p = new PrismaClient({ datasources: { db: { url: readUrl(file) } } });
    const m = await p.userOrganization.findMany({ where: { userId: UID }, include: { organization: { select: { name: true } } } });
    const r = await p.userRole.findMany({ where: { userId: UID }, include: { role: { select: { name: true, allowedModules: true } }, organization: { select: { name: true } } } });
    console.log(`== ${env}: memberships: ${m.map((x) => `${x.organization.name}(active=${x.isActive})`).join(', ') || 'NONE'}`);
    for (const x of r) console.log(`   role "${x.role.name}" @ ${x.organization.name} | allowedModules: [${x.role.allowedModules.join(', ') || 'ALL'}]`);
    if (!r.length) console.log('   no roles anywhere');
    await p.$disconnect();
  }
})();
