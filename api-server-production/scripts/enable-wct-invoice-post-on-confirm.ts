/**
 * WCT group (2026-11-12, owner's go): postInvoicesOnConfirm ON for WCT (S)
 * Systems, WCT Racking, YMM Kitchen and BC Air. Draft / unconfirmed invoices
 * then post to the GL only when they leave draft. Also lists any draft invoice
 * that already has a live GL entry (the next save of it voids that entry).
 * Dry run by default.
 *
 *   DBURL=<prod> npx ts-node --transpile-only scripts/enable-wct-invoice-post-on-confirm.ts [--apply --confirm-prod] [--off]
 */
import 'dotenv/config';
import { Client } from 'pg';

const ORGS = [
  '5c700000-0000-4000-8000-5c7000000001', // WCT (S) Systems
  '5c700000-0000-4000-8000-5c7000000002', // WCT Racking
  '5c700000-0000-4000-8000-5c7000000003', // YMM Kitchen
  '5c700000-0000-4000-8000-5c7000000004', // BC Air
];
const FLAG = 'postInvoicesOnConfirm';
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
    const rows = (
      await c.query(
        `select o.id, o.name, u.features->>$2 cur,
           (select count(*)::int from "Document" d where d."organizationId" = o.id and d.type = 'INVOICE' and d.status in ('draft','unconfirmed')) drafts,
           (select count(*)::int from "Document" d where d."organizationId" = o.id and d.type = 'INVOICE' and d.status in ('draft','unconfirmed')
              and exists (select 1 from "JournalEntry" j where j."sourceDocumentId"::text = d.id::text and j.type = 'INVOICE' and j.status <> 'VOID')) drafts_posted
         from "Organization" o join "OrganizationUIConfig" u on u."organizationId" = o.id where o.id = any($1) order by o.name`,
        [ORGS, FLAG],
      )
    ).rows;
    if (rows.length !== ORGS.length) throw new Error(`Expected ${ORGS.length} WCT-group configs, found ${rows.length}`);
    for (const r of rows) console.log(`${r.name}: ${FLAG} ${r.cur ?? 'unset'} -> ${value}; draft invoices ${r.drafts} (${r.drafts_posted} with a live GL entry)`);
    if (apply) {
      await c.query(`update "OrganizationUIConfig" set features = coalesce(features, '{}'::jsonb) || jsonb_build_object($2::text, $3::boolean), "updatedAt" = now() where "organizationId" = any($1)`, [ORGS, FLAG, value]);
      const others = (await c.query(`select count(*)::int n from "OrganizationUIConfig" where not ("organizationId" = any($1)) and features->>$2 = 'true'`, [ORGS, FLAG])).rows[0].n;
      console.log(`Applied: ${FLAG} = ${value} for ${rows.length} WCT-group orgs; other orgs with it on: ${others}`);
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
