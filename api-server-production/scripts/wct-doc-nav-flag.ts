/**
 * WCT doc navigation (2026-11-17): features.enableWctDocNav ON for the WCT group
 *   WCT (S) Systems  5c700000-0000-4000-8000-5c7000000001
 *   WCT Racking      5c700000-0000-4000-8000-5c7000000002
 *   YMM Kitchen      5c700000-0000-4000-8000-5c7000000003
 *   BC Air           5c700000-0000-4000-8000-5c7000000004
 * Every other org stays off (not touched).
 *
 * The setting is portal-only: Back buttons go to the previous page in the app
 * (else the parent list) and one "Send" menu replaces "Send for signature" /
 * "Send Email". It writes no Document, number, amount or journal.
 *
 *   npx ts-node --transpile-only scripts/wct-doc-nav-flag.ts --env prod            # dry run (default)
 *   npx ts-node --transpile-only scripts/wct-doc-nav-flag.ts --env prod --apply    # writes + ActionLog + log json
 */
import 'dotenv/config';
import * as fs from 'fs';
import { Client } from 'pg';

const ORGS = [
  '5c700000-0000-4000-8000-5c7000000001',
  '5c700000-0000-4000-8000-5c7000000002',
  '5c700000-0000-4000-8000-5c7000000003',
  '5c700000-0000-4000-8000-5c7000000004',
];
const KEY = 'enableWctDocNav';
const env = process.argv.includes('--env') ? process.argv[process.argv.indexOf('--env') + 1] : 'dev';
const apply = process.argv.includes('--apply');

(async () => {
  if (env !== 'dev' && env !== 'prod') throw new Error('--env dev|prod');
  const url = env === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error('database url not set');
  const S = env === 'prod' ? '"public"' : '"platform"';
  const c = new Client({ connectionString: url });
  await c.connect();
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows;
  const changes: Array<{ uiId: string; org: string; name: string; features: Record<string, unknown> }> = [];
  console.log(`${env.toUpperCase()} features.${KEY}:`);
  for (const id of ORGS) {
    const org = (await q(`select name from ${S}."Organization" where id = $1`, [id]))[0];
    const ui = (await q(`select id, features from ${S}."OrganizationUIConfig" where "organizationId" = $1`, [id]))[0];
    if (!org || !ui) {
      console.log(`  MISS ${id}: org / UI config not found`);
      continue;
    }
    const f = (ui.features || {}) as Record<string, unknown>;
    if (f[KEY] === true) {
      console.log(`  SKIP ${org.name}: already on`);
      continue;
    }
    console.log(`  SET  ${org.name}: ${JSON.stringify(f[KEY] ?? '(not set)')} -> true`);
    changes.push({ uiId: ui.id, org: id, name: org.name, features: f });
  }
  if (!apply || !changes.length) {
    console.log(changes.length ? `DRY RUN: ${changes.length} change(s), nothing written. Re-run with --apply.` : 'Nothing to apply.');
    await c.end();
    return;
  }
  await c.query('begin');
  try {
    for (const ch of changes) {
      await c.query(`update ${S}."OrganizationUIConfig" set features = $2 where id = $1`, [ch.uiId, JSON.stringify({ ...ch.features, [KEY]: true })]);
      await c.query(
        `insert into ${S}."ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
         values (gen_random_uuid(), 'SYSTEM', 'system:wct-doc-nav-flag', 'System creation', $1, 'operator', 'UPDATE', 'organization-features', $1, $2, 'SUCCESS')`,
        [ch.org, JSON.stringify({ note: `features.${KEY}: ${JSON.stringify(ch.features[KEY] ?? null)} -> true (in-app Back + Send menu)` })],
      );
    }
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  }
  fs.writeFileSync(
    `${__dirname}/wct-doc-nav-flag.${env}.log.json`,
    JSON.stringify({ at: new Date().toISOString(), key: KEY, applied: changes.map((ch) => ({ org: ch.org, name: ch.name, from: ch.features[KEY] ?? null, to: true })) }, null, 2),
  );
  console.log(`APPLIED: ${KEY} = true on ${changes.map((ch) => ch.name).join(', ')}.`);
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
