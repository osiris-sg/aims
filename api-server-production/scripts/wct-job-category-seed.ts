/**
 * Job category (WCT group, 2026-11-17): seed the list
 *   Service order (default) · Delivery · Others
 *   ("Site visit" dropped 2026-11-24: it is a calendar Note type now; orgs already seeded keep their list)
 * as the job_category job field (CustomField entityType 'Delivery', fieldType
 * 'select', required, defaultValue 'Service order') for the 4 WCT group orgs:
 * WCT (S) …0001, WCT Racking …0002, YMM Kitchen …0003, BC Air …0004.
 * No other org is read or written. No job is touched (blank reads as
 * "Service order"; no backfill). Flags are not changed: an org sees the
 * category once it has this field AND enableJobFields (YMM has it off).
 *
 * Fill only: an org that already has a job_category field (active or not) is
 * left as it is and reported.
 *
 * Dry run by default; --apply writes, one "System creation" Activity Log row
 * per field + a local log file.
 *
 *   npx ts-node --transpile-only scripts/wct-job-category-seed.ts --env prod            # dry run
 *   npx ts-node --transpile-only scripts/wct-job-category-seed.ts --env prod --apply
 */
import 'dotenv/config';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { Client } from 'pg';

const ORGS = ['5c700000-0000-4000-8000-5c7000000001', '5c700000-0000-4000-8000-5c7000000002', '5c700000-0000-4000-8000-5c7000000003', '5c700000-0000-4000-8000-5c7000000004'];
const CATEGORIES = ['Service order', 'Delivery', 'Others'];
const FIELD = 'job_category';
const env = process.argv.includes('--env') ? process.argv[process.argv.indexOf('--env') + 1] : 'dev';
const apply = process.argv.includes('--apply');

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
  console.log(`${env.toUpperCase()} ${apply ? '*** APPLY ***' : 'DRY RUN'}: job category ${JSON.stringify(CATEGORIES)} (default "${CATEGORIES[0]}")`);
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
    const ui = (await q(`select features from ${P}."OrganizationUIConfig" where "organizationId"::text = $1`, [id]))[0];
    const jf = ((ui?.features || {}) as Record<string, unknown>).enableJobFields === true;
    const have = (await q(`select id, "isActive", options from ${S}."CustomField" where "organizationId"::text = $1 and "entityType" = 'Delivery' and "fieldName" = $2`, [id, FIELD]))[0];
    const jobs = (await q(`select count(*)::int n from ${S}."Delivery" where "organizationId"::text = $1`, [id]))[0]?.n ?? 0;
    const tail = `(enableJobFields ${jf ? 'on' : 'OFF: not shown until it is on'}; ${jobs} existing job(s) read as "${CATEGORIES[0]}")`;
    if (have) {
      console.log(`  ${org.name}: keep, job_category already there${have.isActive ? '' : ' but INACTIVE (left as is)'}: ${JSON.stringify(have.options)}`);
      continue;
    }
    todo++;
    console.log(`  ${org.name}: ${apply ? 'WRITE ' : 'create'} Job category ${tail}`);
    if (!apply) continue;
    const fieldId = randomUUID();
    await c.query('begin');
    try {
      const top = (await q(`select coalesce(max("sortOrder"), 0)::int s from ${S}."CustomField" where "organizationId"::text = $1 and "entityType" = 'Delivery'`, [id]))[0].s;
      await c.query(
        `insert into ${S}."CustomField"(id, "organizationId", "entityType", "fieldName", "displayLabel", "fieldType", required, options, "defaultValue", "sortOrder", "isActive", "showInList", "showInForm", display, "createdAt", "updatedAt")
         values ($1, $2, 'Delivery', $3, 'Job category', 'select', true, $4, $5, $6, true, false, true, $7, now(), now())`,
        [fieldId, id, FIELD, JSON.stringify(CATEGORIES.map((v) => ({ value: v, label: v }))), CATEGORIES[0], top + 1, JSON.stringify({ showOnCalendar: false })],
      );
      await c.query(
        `insert into ${P}."ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
         values (gen_random_uuid(), 'SYSTEM', 'system:wct-job-category-seed', 'System creation', $1, 'operator', 'CREATE', 'CustomField', $2, $3, 'SUCCESS')`,
        [id, fieldId, JSON.stringify({ fieldName: FIELD, label: 'Job category', options: CATEGORIES, defaultValue: CATEGORIES[0] })],
      );
      await c.query('commit');
    } catch (e) {
      await c.query('rollback');
      throw e;
    }
    done.push({ org: id, name: org.name, fieldId });
  }
  if (!apply) {
    console.log(`DRY RUN: ${todo} field(s) to create, nothing written. Re-run with --apply.`);
  } else {
    fs.writeFileSync(`${__dirname}/wct-job-category-seed.${env}.log.json`, JSON.stringify({ at: new Date().toISOString(), categories: CATEGORIES, created: done }, null, 2));
    console.log(`APPLIED: ${done.length} field(s) created.`);
  }
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
