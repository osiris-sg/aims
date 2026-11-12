/**
 * WCT group (2026-11-12): hide the old "Permit required" / "Permit approved"
 * job fields; PTW replaced them. isActive = false only: the field rows and every
 * saved value stay (the jobs that used them keep their data), so it can be
 * switched back. WCT group orgs only. Dry run by default.
 *
 *   DBURL=<prod> npx ts-node --transpile-only scripts/hide-wct-permit-job-fields.ts [--apply --confirm-prod]
 */
import 'dotenv/config';
import { Client } from 'pg';

const ORGS = [
  '5c700000-0000-4000-8000-5c7000000001', // WCT (S) Systems
  '5c700000-0000-4000-8000-5c7000000002', // WCT Racking
  '5c700000-0000-4000-8000-5c7000000003', // YMM Kitchen
  '5c700000-0000-4000-8000-5c7000000004', // BC Air
];
const FIELDS = ['permit_required', 'permit_approved'];
const apply = process.argv.includes('--apply');

(async () => {
  const url = process.env.DBURL || '';
  if (!url) throw new Error('Pass the database URL inline as DBURL');
  const prodHost = process.env.PROD_DATABASE_URL ? new URL(process.env.PROD_DATABASE_URL).host : '';
  if (apply && new URL(url).host === prodHost && !process.argv.includes('--confirm-prod')) throw new Error('Applying to prod needs --confirm-prod');
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const rows = (
      await c.query(
        `select f.id, o.name org, f."fieldName", f."displayLabel", f."isActive",
           (select count(*)::int from "CustomFieldValue" v where v."customFieldId" = f.id) vals,
           (select count(*)::int from "CustomFieldValue" v where v."customFieldId" = f.id and v.value::text not in ('null','false','""')) set_vals
         from "CustomField" f join "Organization" o on o.id = f."organizationId"
         where f."organizationId" = any($1) and f."entityType" = 'Delivery' and f."fieldName" = any($2) order by 2, 3`,
        [ORGS, FIELDS],
      )
    ).rows;
    for (const r of rows) {
      console.log(`${r.org}: ${r.displayLabel} (${r.fieldName}) active ${r.isActive} -> false; saved values ${r.vals} (${r.set_vals} non-empty, kept)`);
    }
    if (apply) {
      await c.query(`update "CustomField" set "isActive" = false, "updatedAt" = now() where id = any($1::text[])`, [rows.map((r) => r.id)]);
      console.log(`Applied: ${rows.length} fields hidden.`);
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
