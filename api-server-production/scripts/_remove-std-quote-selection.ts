import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const readUrl = (f: string) => fs.readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL'))!.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '').trim().replace(/"$/, '');
const BF = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const APPLY = process.argv.includes('--apply');
(async () => {
  const prod = new PrismaClient({ datasources: { db: { url: readUrl('.env.production') } } });
  const prodQuoteSel = new Set((await prod.organizationActiveTemplate.findMany({ where: { organizationId: BF, type: 'QUOTATION' } })).map((s) => s.templateId));
  console.log('prod QUOTATION selections:', [...prodQuoteSel]);
  for (const [env, file] of [['staging', '.env.staging'], ['dev', '.env']] as const) {
    const t = new PrismaClient({ datasources: { db: { url: readUrl(file) } } });
    const sel = await t.organizationActiveTemplate.findMany({ where: { organizationId: BF, type: 'QUOTATION' } });
    for (const s of sel) {
      const tpl = await t.documentTemplate.findUnique({ where: { id: s.templateId }, select: { name: true } });
      const extra = !prodQuoteSel.has(s.templateId);
      console.log(`${env}: ${s.templateId.slice(0, 8)} "${tpl?.name}" ${extra ? '<-- NOT in prod, remove' : 'ok'}`);
      if (APPLY && extra) {
        await t.organizationActiveTemplate.delete({ where: { id: s.id } });
        console.log('   removed');
      }
    }
    await t.$disconnect();
  }
  await prod.$disconnect();
})();
