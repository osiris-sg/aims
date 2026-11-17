/**
 * Customer UEN for the WCT group (2026-11-17, task D): turn the existing flag
 *
 *   features.enableCustomerUen  -> true
 *
 * ON for the 4 WCT group orgs (WCT (S) …0001, WCT Racking …0002, YMM …0003,
 * BC Air …0004). Every other org untouched (the update is scoped by id to these
 * four rows of OrganizationUIConfig; only that one key changes).
 *
 * With the flag on: the Locate Customer dialog shows a UEN column (and drops its
 * two hint lines), every add / edit customer form has one "UEN" field
 * (Customer.uen; the GST Reg No. field is hidden, its value kept), the Customers
 * list / customer page show UEN + Old code.
 *
 * Dry run by default; --apply writes, with one "System creation" Activity Log
 * row per changed org and a local log file. --orgs a,b limits to some of the 4.
 *
 *   npx ts-node --transpile-only scripts/wct-customer-uen-flag.ts --env prod            # dry run
 *   npx ts-node --transpile-only scripts/wct-customer-uen-flag.ts --env prod --apply
 */
import 'dotenv/config';
import * as fs from 'fs';
import { Client } from 'pg';

const GROUP = [
  '5c700000-0000-4000-8000-5c7000000001',
  '5c700000-0000-4000-8000-5c7000000002',
  '5c700000-0000-4000-8000-5c7000000003',
  '5c700000-0000-4000-8000-5c7000000004',
];
const FLAG = 'enableCustomerUen';
const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const env = arg('--env') || 'dev';
const apply = process.argv.includes('--apply');
const only = arg('--orgs')?.split(',').map((s) => s.trim()).filter(Boolean);

(async () => {
  if (env !== 'dev' && env !== 'prod') throw new Error('--env dev|prod');
  const orgs = only ? GROUP.filter((id) => only.some((o) => id === o || id.endsWith(o))) : GROUP;
  if (!orgs.length) throw new Error('--orgs matched none of the WCT group');
  const url = env === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error('database url not set');
  const S = env === 'prod' ? '"public"' : '"platform"';
  // Customers: prod is one schema; dev runs per-org tenancy (the WCT group in org_wct).
  const CS = env === 'prod' ? '"public"' : '"org_wct"';
  const c = new Client({ connectionString: url });
  await c.connect();
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows;

  console.log(`${env.toUpperCase()} features.${FLAG} -> true`);
  const plan: { id: string; uiId: string; name: string; before: unknown; features: Record<string, unknown> }[] = [];
  for (const id of orgs) {
    const org = (await q(`select name from ${S}."Organization" where id = $1`, [id]))[0];
    const ui = (await q(`select id, features from ${S}."OrganizationUIConfig" where "organizationId" = $1`, [id]))[0];
    if (!org || !ui) {
      console.log(`  ${id}: org / UI config not found, skipped`);
      continue;
    }
    const f = (ui.features || {}) as Record<string, unknown>;
    const counts = (
      await q(
        `select count(*)::int total, count(*) filter (where coalesce(uen,'') <> '')::int uen, count(*) filter (where coalesce("gstRegNo",'') <> '')::int gst
         from ${CS}."Customer" where "organizationId" = $1`,
        [id],
      ).catch(() => [{ total: '?', uen: '?', gst: '?' }])
    )[0];
    const todo = f[FLAG] !== true;
    console.log(
      `  ${org.name} (${id}): ${JSON.stringify(f[FLAG] ?? '(not set)')} -> true${todo ? '' : '  (already on)'}; customers ${counts.total}, UEN filled ${counts.uen}, GST Reg No. filled ${counts.gst}`,
    );
    if (todo) plan.push({ id, uiId: ui.id, name: org.name, before: f[FLAG] ?? null, features: f });
  }
  if (!apply) {
    console.log(`DRY RUN: ${plan.length} change(s), nothing written. Re-run with --apply.`);
    await c.end();
    return;
  }
  if (!plan.length) {
    console.log('Nothing to apply.');
    await c.end();
    return;
  }
  await c.query('begin');
  try {
    for (const p of plan) {
      await c.query(`update ${S}."OrganizationUIConfig" set features = $2 where id = $1`, [p.uiId, JSON.stringify({ ...p.features, [FLAG]: true })]);
      await c.query(
        `insert into ${S}."ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
         values (gen_random_uuid(), 'SYSTEM', 'system:wct-customer-uen-flag', 'System creation', $1, 'operator', 'UPDATE', 'organization-features', $1, $2, 'SUCCESS')`,
        [p.id, JSON.stringify({ note: `features.${FLAG}: ${JSON.stringify(p.before)} -> true (customer UEN field, WCT group)` })],
      );
    }
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  }
  fs.writeFileSync(
    `${__dirname}/wct-customer-uen-flag.${env}.log.json`,
    JSON.stringify({ at: new Date().toISOString(), flag: FLAG, applied: plan.map((p) => ({ org: p.id, name: p.name, before: p.before, after: true })) }, null, 2),
  );
  console.log(`APPLIED: ${FLAG} on for ${plan.map((p) => p.name).join(', ')}.`);
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
