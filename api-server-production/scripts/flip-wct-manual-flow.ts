/**
 * FLIP (2026-11-12, owner's go): enableManualOrderFlow ON for WCT (S) Systems
 * ONLY. The flow needs enableWctOrders (checked, not changed). Dry run by default.
 *
 *   DBURL=<prod> npx ts-node --transpile-only scripts/flip-wct-manual-flow.ts [--apply --confirm-prod] [--off]
 *
 * --off turns it back off (the order flow then returns to the field app / SiteClock).
 */
import 'dotenv/config';
import { Client } from 'pg';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const apply = process.argv.includes('--apply');
const value = !process.argv.includes('--off');

(async () => {
  const url = process.env.DBURL || '';
  if (!url) throw new Error('Pass the database URL inline as DBURL');
  const prodHost = process.env.PROD_DATABASE_URL ? new URL(process.env.PROD_DATABASE_URL).host : '';
  if (apply && new URL(url).host === prodHost && !process.argv.includes('--confirm-prod')) throw new Error('Applying to prod needs --confirm-prod');
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const row = (await c.query(`select o.name, u.features from "OrganizationUIConfig" u join "Organization" o on o.id = u."organizationId" where u."organizationId" = $1`, [WCT])).rows[0];
    if (!row) throw new Error('WCT config not found');
    const f = row.features || {};
    console.log(`${row.name}: enableManualOrderFlow ${f.enableManualOrderFlow ?? 'unset'} -> ${value}; enableWctOrders ${f.enableWctOrders}; enableSiteClockLink ${f.enableSiteClockLink}; enableSiteClockDeliveries ${f.enableSiteClockDeliveries}`);
    if (value && f.enableWctOrders !== true) throw new Error('enableWctOrders is not on: the manual flow would have no effect');
    if (apply) {
      await c.query(`update "OrganizationUIConfig" set features = coalesce(features, '{}'::jsonb) || jsonb_build_object('enableManualOrderFlow', $2::boolean), "updatedAt" = now() where "organizationId" = $1`, [WCT, value]);
      const after = (await c.query(`select features->>'enableManualOrderFlow' v from "OrganizationUIConfig" where "organizationId" = $1`, [WCT])).rows[0].v;
      const others = (await c.query(`select count(*)::int n from "OrganizationUIConfig" where "organizationId" <> $1 and features->>'enableManualOrderFlow' = 'true'`, [WCT])).rows[0].n;
      console.log(`Applied: WCT enableManualOrderFlow = ${after}; other orgs with it on: ${others}`);
    } else {
      console.log('Dry run. Pass --apply --confirm-prod to change it.');
    }
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
