/**
 * Job category (WCT group, 2026-11-18): add "Meeting" and "Collect cheque" to
 * the job_category list (CustomField entityType 'Delivery', made by
 * scripts/wct-job-category-seed.ts) of the 4 WCT group orgs:
 * WCT (S) …0001, WCT Racking …0002, YMM Kitchen …0003, BC Air …0004.
 * On the calendar (enableCalendarStyle) their jobs read "(M) …" and "(CC) …";
 * "Site visit" reads "(SV) …".
 *
 * Fill only: appended at the end of each list, a name already there (any
 * case) is kept; the order and the default are unchanged; no job is touched.
 * An org without the field is reported and skipped. No other org is read or
 * written. Dry run by default; --apply writes, one "System creation" Activity
 * Log row per field + a local log file.
 *
 *   npx ts-node --transpile-only scripts/wct-job-category-add.ts --env prod            # dry run
 *   npx ts-node --transpile-only scripts/wct-job-category-add.ts --env prod --apply
 */
import 'dotenv/config';
import * as fs from 'fs';
import { Client } from 'pg';

const ORGS = ['5c700000-0000-4000-8000-5c7000000001', '5c700000-0000-4000-8000-5c7000000002', '5c700000-0000-4000-8000-5c7000000003', '5c700000-0000-4000-8000-5c7000000004'];
const ADD = ['Meeting', 'Collect cheque'];
const FIELD = 'job_category';
const env = process.argv.includes('--env') ? process.argv[process.argv.indexOf('--env') + 1] : 'dev';
const apply = process.argv.includes('--apply');

const names = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.map((v: any) => String(typeof v === 'object' && v ? v.label ?? v.value ?? '' : v ?? '').trim()).filter(Boolean) : [];

(async () => {
  if (env !== 'dev' && env !== 'prod') throw new Error('--env dev|prod');
  const url = env === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error('database url not set');
  // Prod: one "public" schema. Dev: platform tables in "platform", org data in the org's own schema (OrgTenant).
  const P = env === 'prod' ? '"public"' : '"platform"';
  const c = new Client({ connectionString: url });
  await c.connect();
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows;
  const done: any[] = [];
  let todo = 0;
  console.log(`${env.toUpperCase()} ${apply ? '*** APPLY ***' : 'DRY RUN'}: job category add ${JSON.stringify(ADD)}`);
  for (const id of ORGS) {
    const org = (await q(`select name from ${P}."Organization" where id::text = $1`, [id]))[0];
    if (!org) {
      console.log(`  ${id}: org not found, skipped`);
      continue;
    }
    let S = '"public"';
    if (env === 'dev') {
      const t = (await q(`select "schemaName" from platform."OrgTenant" where "organizationId"::text = $1 and status = 'ACTIVE'`, [id]))[0];
      if (!t) {
        console.log(`  ${org.name}: no org schema on dev, skipped`);
        continue;
      }
      S = `"${t.schemaName}"`;
    }
    const f = (await q(`select id, options, "defaultValue", "isActive" from ${S}."CustomField" where "organizationId"::text = $1 and "entityType" = 'Delivery' and "fieldName" = $2`, [id, FIELD]))[0];
    if (!f) {
      console.log(`  ${org.name}: no job_category field, skipped`);
      continue;
    }
    const cur = names(f.options);
    const lower = new Set(cur.map((n) => n.toLowerCase()));
    const add = ADD.filter((n) => !lower.has(n.toLowerCase()));
    if (!add.length) {
      console.log(`  ${org.name}: keep, already has ${ADD.join(' + ')}: ${JSON.stringify(cur)}`);
      continue;
    }
    const next = [...cur, ...add];
    todo++;
    console.log(`  ${org.name}: ${apply ? 'WRITE ' : ''}${JSON.stringify(cur)} -> ${JSON.stringify(next)} (default "${f.defaultValue}" kept${f.isActive ? '' : '; field INACTIVE'})`);
    if (!apply) continue;
    await c.query('begin');
    try {
      await c.query(`update ${S}."CustomField" set options = $2::jsonb, "updatedAt" = now() where id = $1`, [f.id, JSON.stringify(next.map((v) => ({ value: v, label: v })))]);
      await c.query(
        `insert into ${P}."ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
         values (gen_random_uuid(), 'SYSTEM', 'system:wct-job-category-add', 'System creation', $1, 'operator', 'UPDATE', 'CustomField', $2, $3, 'SUCCESS')`,
        [id, f.id, JSON.stringify({ fieldName: FIELD, before: cur, after: next })],
      );
      await c.query('commit');
    } catch (e) {
      await c.query('rollback');
      throw e;
    }
    done.push({ org: id, name: org.name, fieldId: f.id, before: cur, after: next });
  }
  if (!apply) console.log(`DRY RUN: ${todo} list(s) to extend, nothing written. Re-run with --apply.`);
  else {
    fs.writeFileSync(`${__dirname}/wct-job-category-add.${env}.log.json`, JSON.stringify({ at: new Date().toISOString(), added: ADD, done }, null, 2));
    console.log(`APPLIED: ${done.length} list(s) extended.`);
  }
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
