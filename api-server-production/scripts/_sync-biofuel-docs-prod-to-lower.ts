// Sync Biofuel documents PROD -> staging + dev (additive upsert, no deletes).
// Usage: npx ts-node scripts/_sync-biofuel-docs-prod-to-lower.ts [--apply]
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const readUrl = (file: string) => {
  const line = fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL'));
  if (!line) throw new Error(`no DATABASE_URL in ${file}`);
  return line.replace(/^DATABASE_URL=/, '').replace(/^"|"$/g, '').trim().replace(/"$/, '');
};

const BF = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const APPLY = process.argv.includes('--apply');

(async () => {
  const prod = new PrismaClient({ datasources: { db: { url: readUrl('.env.production') } } });
  const prodDocs = await prod.document.findMany({ where: { organizationId: BF } });
  const prodTplIds = [...new Set(prodDocs.map((d) => d.documentTemplateId).filter(Boolean))];
  const prodTpls = await prod.documentTemplate.findMany({ where: { id: { in: prodTplIds } } });
  console.log(`prod: ${prodDocs.length} docs, referencing ${prodTplIds.length} templates`);

  for (const [env, file] of [['staging', '.env.staging'], ['dev', '.env']] as const) {
    const t = new PrismaClient({ datasources: { db: { url: readUrl(file) } } });
    try {
      const existing = await t.document.findMany({ where: { organizationId: BF }, select: { id: true, updatedAt: true, name: true, documentTemplateId: true } });
      const byId = new Map(existing.map((d) => [d.id, d]));
      const nameKey = (d: any) => `${d.name}|${d.documentTemplateId}`;
      const byNameTpl = new Map(existing.map((d) => [nameKey(d), d.id]));

      const tplHave = new Set((await t.documentTemplate.findMany({ where: { id: { in: prodTplIds } }, select: { id: true } })).map((x) => x.id));
      const tplMissing = prodTpls.filter((x) => !tplHave.has(x.id));

      const projHave = new Set((await t.project.findMany({ select: { id: true } })).map((x) => x.id));
      const depHave = new Set((await t.projectDeployment.findMany({ select: { id: true } })).map((x) => x.id));

      const toCreate: any[] = [];
      const toUpdate: any[] = [];
      const conflicts: any[] = [];
      for (const d of prodDocs) {
        const ex = byId.get(d.id);
        if (ex) {
          if (ex.updatedAt.getTime() !== d.updatedAt.getTime()) toUpdate.push(d);
        } else {
          const clash = d.name != null && byNameTpl.get(nameKey(d));
          if (clash) conflicts.push({ prodId: d.id, name: d.name, clashesWith: clash });
          else toCreate.push(d);
        }
      }
      const nulledProj = prodDocs.filter((d) => d.projectId && !projHave.has(d.projectId)).length;
      const nulledDep = prodDocs.filter((d) => d.projectDeploymentId && !depHave.has(d.projectDeploymentId)).length;

      console.log(`\n=== ${env}: existing ${existing.length} | create ${toCreate.length} | update ${toUpdate.length} | name-conflicts ${conflicts.length} | missing templates ${tplMissing.length} | null projectRef ${nulledProj} | null deploymentRef ${nulledDep}`);
      if (conflicts.length) console.log('  conflicts:', conflicts.slice(0, 10));
      if (tplMissing.length) console.log('  missing templates:', tplMissing.map((x) => `${x.name} (${x.type})`));

      if (APPLY) {
        // 1. Missing templates first (docs' template ids are plain strings, but the editor needs them).
        for (const tpl of tplMissing) await t.documentTemplate.create({ data: tpl as any });
        // 2. Create missing docs — baseDocumentId nulled in pass one (self-FK), restored in pass two.
        const clean = (d: any) => {
          const { id, createdAt, updatedAt, ...rest } = d;
          return {
            ...rest,
            id, createdAt, updatedAt,
            projectId: d.projectId && projHave.has(d.projectId) ? d.projectId : null,
            projectDeploymentId: d.projectDeploymentId && depHave.has(d.projectDeploymentId) ? d.projectDeploymentId : null,
            baseDocumentId: null,
          };
        };
        for (let i = 0; i < toCreate.length; i += 200) {
          await t.document.createMany({ data: toCreate.slice(i, i + 200).map(clean), skipDuplicates: true });
          process.stdout.write(`  created ${Math.min(i + 200, toCreate.length)}/${toCreate.length}\r`);
        }
        console.log();
        // 3. Restore baseDocumentId links that resolve in the target.
        const allIds = new Set([...byId.keys(), ...prodDocs.map((d) => d.id)]);
        const rebase = prodDocs.filter((d) => d.baseDocumentId && allIds.has(d.baseDocumentId));
        for (const d of rebase) {
          await t.document.updateMany({ where: { id: d.id }, data: { baseDocumentId: d.baseDocumentId } }).catch(() => null);
        }
        // 4. Update drifted docs to prod content.
        let up = 0;
        for (const d of toUpdate) {
          const { id, createdAt, ...rest } = clean(d);
          await t.document.update({ where: { id: d.id }, data: { ...rest, baseDocumentId: d.baseDocumentId && allIds.has(d.baseDocumentId) ? d.baseDocumentId : null } }).catch((e: any) => console.log('  update failed', d.id, e.message?.slice(0, 120)));
          up++;
          if (up % 100 === 0) process.stdout.write(`  updated ${up}/${toUpdate.length}\r`);
        }
        console.log(`  applied: +${toCreate.length} created, ~${toUpdate.length} updated, ${conflicts.length} skipped (name conflicts)`);
      }
    } finally {
      await t.$disconnect();
    }
  }
  await prod.$disconnect();
})();
