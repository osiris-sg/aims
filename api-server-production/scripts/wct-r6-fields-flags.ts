/**
 * WCT group round 6 (2026-11-18): three per-org settings ON for the 4 group orgs
 * (WCT (S) n=1, WCT Racking n=2, YMM Kitchen n=3, BC Air n=4; ids 5c700000-0000-4000-8000-5c700000000n). No other org is read or written.
 *
 *   features.enableDocRemarks         invoice + DO "Remarks" box in the editor + on the print
 *   features.enableQuotationCategory  quotation "Category" + Settings > Quotation categories (no list is seeded)
 *   features.enableSalesReport        Sales > Sales report
 *
 * Only these keys are written (jsonb merge, the rest of the features JSON is left as it is); a key already
 * true is skipped; a key set to anything else is reported and left alone. The dry run also prints, read-only,
 * what the settings will show: quotations with a salesperson per org, and AIMS-made invoices / DOs that already
 * carry config.remarks on a stock layout (those would start printing their remarks; imported ones never change).
 *
 *   npx ts-node --transpile-only scripts/wct-r6-fields-flags.ts --env prod            # dry run (default)
 *   npx ts-node --transpile-only scripts/wct-r6-fields-flags.ts --env prod --apply    # writes + ActionLog + log json
 */
import 'dotenv/config';
import * as fs from 'fs';
import { Client, types } from 'pg';

types.setTypeParser(1114, (s: string) => s);

const ALL_ORGS = [
  '5c700000-0000-4000-8000-5c7000000001',
  '5c700000-0000-4000-8000-5c7000000002',
  '5c700000-0000-4000-8000-5c7000000003',
  '5c700000-0000-4000-8000-5c7000000004',
];

// --exclude <orgId>[,<orgId>]: leave these group orgs out (e.g. YMM).
const EXCLUDE = new Set((process.argv.includes('--exclude') ? process.argv[process.argv.indexOf('--exclude') + 1] : '').split(',').filter(Boolean));
const ORGS = ALL_ORGS.filter((id) => !EXCLUDE.has(id));
const KEYS = ['enableDocRemarks', 'enableQuotationCategory', 'enableSalesReport'];
const SCRIPT = 'wct-r6-fields-flags';
const env = process.argv.includes('--env') ? process.argv[process.argv.indexOf('--env') + 1] : 'dev';
const apply = process.argv.includes('--apply');

(async () => {
  if (env !== 'dev' && env !== 'prod') throw new Error('--env dev|prod');
  const url = env === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error('database url not set');
  const S = env === 'prod' ? '"public"' : '"platform"';
  const D = env === 'prod' ? '"public"' : null; // documents: prod shared schema; dev is per-org (counts skipped)
  const c = new Client({ connectionString: url });
  await c.connect();
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows;

  const plan: Array<{ org: string; name: string; uiId: string; set: Record<string, true>; from: Record<string, unknown> }> = [];
  console.log(`${apply ? 'APPLY' : 'DRY RUN'} on ${env.toUpperCase()}`);
  for (const id of ORGS) {
    const org = (await q(`select name from ${S}."Organization" where id = $1`, [id]))[0];
    const ui = (await q(`select id, features from ${S}."OrganizationUIConfig" where "organizationId" = $1`, [id]))[0];
    if (!org || !ui) {
      console.log(`  ${id}: org or UI config not found, skipped`);
      continue;
    }
    const f = (ui.features || {}) as Record<string, unknown>;
    const set: Record<string, true> = {};
    const from: Record<string, unknown> = {};
    console.log(`  ${org.name} (${id})`);
    for (const k of KEYS) {
      const cur = f[k];
      if (cur === true) console.log(`    SKIP ${k}: already true`);
      else if (cur !== undefined && cur !== null && cur !== false) console.log(`    SKIP ${k}: set to ${JSON.stringify(cur)}, left as it is`);
      else {
        console.log(`    SET  ${k}: ${JSON.stringify(cur ?? '(not set)')} -> true`);
        set[k] = true;
        from[k] = cur ?? null;
      }
    }
    if (D) {
      const sp = (
        await q(
          `select count(*)::int n,
                  count(*) filter (where coalesce(nullif(config->>'salesPerson',''), nullif(config->'documentInfo'->>'salesPerson','')) is not null)::int with_sp,
                  count(*) filter (where config ? 'erpImport')::int imported,
                  count(*) filter (where config ? 'erpImport' and coalesce(nullif(config->>'salesPerson',''), nullif(config->'documentInfo'->>'salesPerson','')) is not null)::int imported_sp,
                  count(*) filter (where coalesce(config->>'quotationCategory','') <> '')::int with_cat
             from ${D}."Document" where "organizationId" = $1 and type in ('QUOTATION','QO','QO1','QO2','QT')`,
          [id],
        )
      )[0];
      console.log(`    quotations: ${sp.n} (imported ${sp.imported}); with a salesperson ${sp.with_sp} (imported ${sp.imported_sp}, AIMS ${sp.with_sp - sp.imported_sp}); with a category ${sp.with_cat}`);
      const rem = await q(
        `select d.type, coalesce(t."styleConfig"->>'layout','standard') layout, count(*)::int n
           from ${D}."Document" d left join ${D}."DocumentTemplate" t on t.id::text = d."documentTemplateId"::text
          where d."organizationId" = $1 and d.type in ('INVOICE','TI','TI2','DELIVERY_ORDER','DO')
            and not (d.config ? 'erpImport') and btrim(coalesce(d.config->>'remarks','')) <> ''
          group by 1,2 order by 1,2`,
        [id],
      );
      if (!rem.length) console.log('    AIMS-made invoices / DOs with remarks already typed: none');
      for (const r of rem) console.log(`    AIMS-made ${r.type} with remarks, template layout ${r.layout}: ${r.n} (${r.layout === 'standard' ? 'would start printing them' : 'already printed'})`);
    }
    if (Object.keys(set).length) plan.push({ org: id, name: org.name, uiId: ui.id, set, from });
  }

  const changes = plan.reduce((s, p) => s + Object.keys(p.set).length, 0);
  if (!apply || !changes) {
    console.log(changes ? `DRY RUN: ${changes} change(s) on ${plan.length} org(s), nothing written. Re-run with --apply.` : 'Nothing to apply.');
    await c.end();
    return;
  }
  await c.query('begin');
  try {
    for (const p of plan) {
      await c.query(`update ${S}."OrganizationUIConfig" set features = coalesce(features, '{}'::jsonb) || $2::jsonb where id = $1`, [p.uiId, JSON.stringify(p.set)]);
      await c.query(
        `insert into ${S}."ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
         values (gen_random_uuid(), 'SYSTEM', $3, 'System creation', $1, 'operator', 'UPDATE', 'organization-features', $1, $2, 'SUCCESS')`,
        [p.org, JSON.stringify({ note: `WCT round 6: ${Object.keys(p.set).join(', ')} -> true`, from: p.from }), `system:${SCRIPT}`],
      );
    }
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  }
  fs.writeFileSync(`${__dirname}/${SCRIPT}.${env}.log.json`, JSON.stringify({ at: new Date().toISOString(), applied: plan.map((p) => ({ org: p.org, name: p.name, set: p.set, from: p.from })) }, null, 2));
  console.log(`APPLIED: ${changes} change(s) on ${plan.length} org(s). Log: scripts/${SCRIPT}.${env}.log.json`);
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
