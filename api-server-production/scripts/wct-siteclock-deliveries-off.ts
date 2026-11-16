/**
 * Park the SiteClock Delivery flow for WCT (S) (2026-11-16, Elroy): WCT (S)
 * ONLY (5c700000-0000-4000-8000-5c7000000001), every other org untouched.
 *
 *   features.enableSiteClockDeliveries  true -> false
 *
 * What it does NOT touch: enableManualOrderFlow (stays on), enableSiteClockLink
 * and the SiteClock connection (the jobs calendar keeps reading SiteClock's
 * jobs through the connection), and no SiteClock call is made.
 *
 * Dry run by default (prints the diff + the facts that show the effect); --apply
 * writes, with one "System creation" Activity Log row and a local log file.
 *
 *   npx ts-node --transpile-only scripts/wct-siteclock-deliveries-off.ts --env prod            # dry run
 *   npx ts-node --transpile-only scripts/wct-siteclock-deliveries-off.ts --env prod --apply
 */
import 'dotenv/config';
import * as fs from 'fs';
import { Client } from 'pg';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const FLAG = 'enableSiteClockDeliveries';
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
  const org = (await q(`select name from ${S}."Organization" where id = $1`, [WCT]))[0];
  const ui = (await q(`select id, features from ${S}."OrganizationUIConfig" where "organizationId" = $1`, [WCT]))[0];
  if (!org || !ui) throw new Error('WCT (S) org / UI config not found');
  const f = (ui.features || {}) as Record<string, unknown>;
  const conn = (await q(`select enabled from ${S}."SiteClockConnection" where "organizationId" = $1`, [WCT]))[0];
  const links = (await q(`select count(*)::int n from ${S}."DeliverySiteClockJob" where "organizationId" = $1`, [WCT]))[0].n;

  console.log(`${env.toUpperCase()} ${org.name} (${WCT}):`);
  console.log(`  features.${FLAG}: ${JSON.stringify(f[FLAG] ?? '(not set)')} -> false${f[FLAG] === false || f[FLAG] === undefined ? '  (already off: nothing to do)' : ''}`);
  console.log('  unchanged:');
  console.log(`    enableManualOrderFlow = ${JSON.stringify(f.enableManualOrderFlow)}, enableWctOrders = ${JSON.stringify(f.enableWctOrders)} (manual flow: no job sync to SiteClock either way)`);
  console.log(`    enableSiteClockLink = ${JSON.stringify(f.enableSiteClockLink)}, SiteClock connection enabled = ${conn ? conn.enabled : '(none)'} (the calendar keeps showing SiteClock's jobs)`);
  console.log(`    AIMS jobs linked to SiteClock jobs: ${links}`);
  const todo = f[FLAG] === true;
  if (!apply) {
    console.log(`DRY RUN: ${todo ? 1 : 0} change, nothing written. Re-run with --apply.`);
    await c.end();
    return;
  }
  if (!todo) {
    console.log('Nothing to apply.');
    await c.end();
    return;
  }
  await c.query('begin');
  try {
    await c.query(`update ${S}."OrganizationUIConfig" set features = $2 where id = $1`, [ui.id, JSON.stringify({ ...f, [FLAG]: false })]);
    await c.query(
      `insert into ${S}."ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
       values (gen_random_uuid(), 'SYSTEM', 'system:wct-siteclock-deliveries-off', 'System creation', $1, 'operator', 'UPDATE', 'organization-features', $1, $2, 'SUCCESS')`,
      [WCT, JSON.stringify({ note: `features.${FLAG}: true -> false (park SiteClock Delivery flow; manual flow stays; Elroy 16 Nov)` })],
    );
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  }
  fs.writeFileSync(`${__dirname}/wct-siteclock-deliveries-off.${env}.log.json`, JSON.stringify({ at: new Date().toISOString(), org: WCT, applied: { [FLAG]: [true, false] } }, null, 2));
  console.log(`APPLIED: ${FLAG} off for ${org.name}.`);
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
