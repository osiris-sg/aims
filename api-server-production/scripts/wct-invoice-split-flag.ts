/**
 * Split payment (2026-11-17): features.enableInvoiceSplit ON for
 *   WCT (S) Systems  5c700000-0000-4000-8000-5c7000000001
 *   WCT Racking      5c700000-0000-4000-8000-5c7000000002
 *   BC Air           5c700000-0000-4000-8000-5c7000000004
 * YMM Kitchen (…0003) and every other org stay off (not touched).
 *
 * The setting only shows the "Split payment" / "Undo split" buttons on a draft
 * invoice; it writes no Document, number, amount or journal. Split needs
 * postInvoicesOnConfirm on the org (checked below, never changed here).
 *
 *   npx ts-node --transpile-only scripts/wct-invoice-split-flag.ts --env prod            # dry run
 *   npx ts-node --transpile-only scripts/wct-invoice-split-flag.ts --env prod --apply    # writes + ActionLog + log json
 */
import 'dotenv/config';
import * as fs from 'fs';
import { Client } from 'pg';

const ORGS = ['5c700000-0000-4000-8000-5c7000000001', '5c700000-0000-4000-8000-5c7000000002', '5c700000-0000-4000-8000-5c7000000004'];
const KEY = 'enableInvoiceSplit';
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
    const warn = f.postInvoicesOnConfirm === true ? '' : '  (WARNING: postInvoicesOnConfirm is off, Split will refuse until it is on)';
    if (f[KEY] === true) {
      console.log(`  SKIP ${org.name}: already on${warn}`);
      continue;
    }
    console.log(`  SET  ${org.name}: ${JSON.stringify(f[KEY] ?? '(not set)')} -> true${warn}`);
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
         values (gen_random_uuid(), 'SYSTEM', 'system:wct-invoice-split-flag', 'System creation', $1, 'operator', 'UPDATE', 'organization-features', $1, $2, 'SUCCESS')`,
        [ch.org, JSON.stringify({ note: `features.${KEY}: ${JSON.stringify(ch.features[KEY] ?? null)} -> true (Split payment on draft invoices)` })],
      );
    }
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  }
  fs.writeFileSync(
    `${__dirname}/wct-invoice-split-flag.${env}.log.json`,
    JSON.stringify({ at: new Date().toISOString(), key: KEY, applied: changes.map((ch) => ({ org: ch.org, name: ch.name, from: ch.features[KEY] ?? null, to: true })) }, null, 2),
  );
  console.log(`APPLIED: ${KEY} = true on ${changes.map((ch) => ch.name).join(', ')}.`);
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
