import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const readUrl = (f: string) => fs.readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL'))!.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '').trim().replace(/"$/, '');
const BF = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const APPLY = process.argv.includes('--apply');
(async () => {
  const prod = new PrismaClient({ datasources: { db: { url: readUrl('.env.production') } } });
  const prodSel = await prod.organizationActiveTemplate.findMany({ where: { organizationId: BF } });
  const prodCount = await prod.document.count({ where: { organizationId: BF } });
  const prodNames = new Set((await prod.document.findMany({ where: { organizationId: BF }, select: { name: true } })).map((d) => d.name).filter(Boolean));
  console.log('prod docs:', prodCount, '| active-template selections:', prodSel.map((s) => `${s.type}=${s.templateId.slice(0, 8)}`).join(' '));
  for (const [env, file] of [['staging', '.env.staging'], ['dev', '.env']] as const) {
    const t = new PrismaClient({ datasources: { db: { url: readUrl(file) } } });
    const names = new Set((await t.document.findMany({ where: { organizationId: BF }, select: { name: true } })).map((d) => d.name).filter(Boolean));
    let missing = 0;
    prodNames.forEach((n) => { if (!names.has(n)) missing++; });
    const tpl = await t.documentTemplate.findFirst({ where: { name: { contains: 'Monthly Rental Rates' } }, select: { id: true, name: true } });
    console.log(`${env}: prod names missing here: ${missing} | rental template: ${tpl ? tpl.name : 'MISSING'}`);
    if (APPLY) {
      for (const s of prodSel) {
        const tplExists = await t.documentTemplate.findUnique({ where: { id: s.templateId }, select: { id: true } });
        if (!tplExists) { console.log(`  skip selection ${s.type} — template ${s.templateId.slice(0, 8)} not in ${env}`); continue; }
        const ex = await t.organizationActiveTemplate.findFirst({ where: { organizationId: BF, type: s.type, templateId: s.templateId } });
        if (ex) { if (ex.isPrimary !== s.isPrimary) await t.organizationActiveTemplate.update({ where: { id: ex.id }, data: { isPrimary: s.isPrimary } }); }
        else await t.organizationActiveTemplate.create({ data: { organizationId: BF, type: s.type, templateId: s.templateId, isPrimary: s.isPrimary } });
      }
      const after = await t.organizationActiveTemplate.findMany({ where: { organizationId: BF } });
      console.log(`  selections now: ${after.map((s) => `${s.type}=${s.templateId.slice(0, 8)}`).join(' ')}`);
    }
    await t.$disconnect();
  }
  await prod.$disconnect();
})();
