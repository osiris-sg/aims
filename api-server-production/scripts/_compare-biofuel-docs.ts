import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const readUrl = (file: string) => {
  const line = fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL'));
  if (!line) throw new Error(`no DATABASE_URL in ${file}`);
  return line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '').trim().replace(/"$/, '');
};

const BF = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';

(async () => {
  for (const [env, file] of [['dev', '.env'], ['staging', '.env.staging'], ['prod', '.env.production']] as const) {
    const url = readUrl(file);
    const p = new PrismaClient({ datasources: { db: { url } } });
    try {
      const org = await p.organization.findUnique({ where: { id: BF }, select: { name: true } });
      const byType = await p.document.groupBy({
        by: ['type'],
        where: { organizationId: BF },
        _count: { _all: true },
      });
      const total = byType.reduce((s, r) => s + r._count._all, 0);
      const latest = await p.document.findFirst({ where: { organizationId: BF }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, name: true } });
      console.log(`\n=== ${env} (${url.match(/ep-[a-z-]+/)?.[0]}) org=${org?.name || 'MISSING'}`);
      console.log('total docs:', total, '| latest:', latest?.createdAt?.toISOString(), latest?.name);
      for (const r of byType.sort((a, b) => a.type.localeCompare(b.type))) console.log('  ', r.type.padEnd(22), r._count._all);
    } catch (e: any) {
      console.log(`\n=== ${env}: ERROR`, e.message?.slice(0, 200));
    } finally {
      await p.$disconnect();
    }
  }
})();
