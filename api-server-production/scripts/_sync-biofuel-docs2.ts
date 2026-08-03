// Biofuel doc sync prod -> lower envs, matched by document NAME (number).
// Usage: npx ts-node scripts/_sync-biofuel-docs2.ts [--apply]
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const readUrl = (file: string) => {
  const line = fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL'));
  return line!.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '').trim().replace(/"$/, '');
};
const BF = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const APPLY = process.argv.includes('--apply');

(async () => {
  const prod = new PrismaClient({ datasources: { db: { url: readUrl('.env.production') } } });
  const prodDocs = await prod.document.findMany({ where: { organizationId: BF } });
  const prodTplIds = [...new Set(prodDocs.map((d) => d.documentTemplateId).filter(Boolean))];
  const prodTpls = await prod.documentTemplate.findMany({ where: { id: { in: prodTplIds } } });

  for (const [env, file] of [['staging', '.env.staging'], ['dev', '.env']] as const) {
    const t = new PrismaClient({ datasources: { db: { url: readUrl(file) } } });
    try {
      const existing = await t.document.findMany({ where: { organizationId: BF }, select: { id: true, name: true } });
      const haveNames = new Set(existing.filter((d) => d.name).map((d) => d.name));
      const haveIds = new Set(existing.map((d) => d.id));

      const tplHave = new Set((await t.documentTemplate.findMany({ where: { id: { in: prodTplIds } }, select: { id: true } })).map((x) => x.id));
      const tplMissing = prodTpls.filter((x) => !tplHave.has(x.id));
      const projHave = new Set((await t.project.findMany({ select: { id: true } })).map((x) => x.id));
      const depHave = new Set((await t.projectDeployment.findMany({ select: { id: true } })).map((x) => x.id));

      // Missing = prod doc whose number is absent in target (or nameless draft absent by id).
      const missing = prodDocs.filter((d) => (d.name ? !haveNames.has(d.name) : !haveIds.has(d.id)));
      const byType: Record<string, number> = {};
      for (const d of missing) byType[d.type] = (byType[d.type] || 0) + 1;
      console.log(`\n=== ${env}: prod-only docs ${missing.length}`, byType, `| missing templates ${tplMissing.length}`);

      if (APPLY) {
        for (const tpl of tplMissing) await t.documentTemplate.create({ data: tpl as any });
        const clean = (d: any) => ({
          ...d,
          projectId: d.projectId && projHave.has(d.projectId) ? d.projectId : null,
          projectDeploymentId: d.projectDeploymentId && depHave.has(d.projectDeploymentId) ? d.projectDeploymentId : null,
          baseDocumentId: null,
        });
        let created = 0, failed = 0;
        for (let i = 0; i < missing.length; i += 200) {
          const chunk = missing.slice(i, i + 200).map(clean);
          try {
            const r = await t.document.createMany({ data: chunk, skipDuplicates: true });
            created += r.count;
          } catch (e: any) {
            for (const d of chunk) {
              try { await t.document.create({ data: d }); created++; }
              catch (e2: any) { failed++; console.log('  fail', d.name, e2.message?.slice(0, 100)); }
            }
          }
          process.stdout.write(`  ${Math.min(i + 200, missing.length)}/${missing.length}\r`);
        }
        // Restore base-revision links that resolve now.
        const nowIds = new Set([...haveIds, ...missing.map((d) => d.id)]);
        const rebase = missing.filter((d) => d.baseDocumentId && nowIds.has(d.baseDocumentId));
        for (const d of rebase) await t.document.updateMany({ where: { id: d.id }, data: { baseDocumentId: d.baseDocumentId } }).catch(() => null);
        console.log(`\n  applied: templates +${tplMissing.length}, docs +${created}, failed ${failed}`);
      }
    } finally {
      await t.$disconnect();
    }
  }
  await prod.$disconnect();
})();
