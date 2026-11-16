/**
 * BC Air invoice + DO on the WCT layout (2026-11-16, Elroy): BC Air ONLY
 * (5c700000-0000-4000-8000-5c7000000004); WCT, Racking, YMM and every other org untouched.
 *
 *   features.wctDocumentBrand  (not set) -> 'BCAIR'
 *
 * The setting changes how BC Air's invoices and DOs are DRAWN (wct-brand.ts):
 * no Document row, number, amount, status or journal is written by it, and this
 * script writes only the one feature key. The dry run also lists, read-only,
 * which existing BC Air invoices / DOs would print in the new look when someone
 * opens or re-prints them: AIMS-made ones with a stock template. Imported
 * (ABSS / ERP, config.erpImport) ones always keep the stock look.
 *
 *   npx ts-node --transpile-only scripts/wct-bcair-doc-brand.ts --env prod            # dry run
 *   npx ts-node --transpile-only scripts/wct-bcair-doc-brand.ts --env prod --apply
 */
import 'dotenv/config';
import * as fs from 'fs';
import { Client } from 'pg';

const BCAIR = '5c700000-0000-4000-8000-5c7000000004';
const KEY = 'wctDocumentBrand';
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
  const org = (await q(`select name from ${S}."Organization" where id = $1`, [BCAIR]))[0];
  const ui = (await q(`select id, features from ${S}."OrganizationUIConfig" where "organizationId" = $1`, [BCAIR]))[0];
  if (!org || !ui) throw new Error('BC Air org / UI config not found');
  const f = (ui.features || {}) as Record<string, unknown>;

  console.log(`${env.toUpperCase()} ${org.name} (${BCAIR}):`);
  const skip = f[KEY] === 'BCAIR' ? 'already set' : f[KEY] !== undefined && f[KEY] !== null ? 'set to something else: left as it is' : null;
  console.log(`  ${skip ? 'SKIP' : 'SET '} features.${KEY}: ${JSON.stringify(f[KEY] ?? '(not set)')} -> "BCAIR"${skip ? `  (${skip})` : ''}`);
  const docs = await q(
    `select d.type, (t.id is null) no_tpl, coalesce(t."styleConfig"->>'layout','standard') layout, d.status, (d.config->'erpImport') is not null erp, count(*)::int n
       from ${S}."Document" d left join ${S}."DocumentTemplate" t on t.id::text = d."documentTemplateId"::text
      where d."organizationId" = $1 and d.type in ('INVOICE','TI','TI2','DELIVERY_ORDER','DO')
      group by 1,2,3,4,5 order by 1,2,3,4`,
    [BCAIR],
  );
  console.log('  existing BC Air invoices / DOs (read-only; the setting changes no row):');
  for (const r of docs) {
    const prints = r.erp ? 'unchanged look (imported)' : !r.no_tpl && r.layout === 'standard' ? 'new look when (re)printed' : 'unchanged look';
    console.log(`    ${r.type.padEnd(15)} ${String(r.n).padStart(5)}  status ${String(r.status).padEnd(10)} ${r.erp ? 'imported' : 'AIMS    '} ${r.no_tpl ? 'no template' : `template layout ${r.layout}`}: ${prints}`);
  }
  if (!apply || skip) {
    console.log(skip ? 'Nothing to apply.' : 'DRY RUN: 1 change, nothing written. Re-run with --apply.');
    await c.end();
    return;
  }
  await c.query('begin');
  try {
    await c.query(`update ${S}."OrganizationUIConfig" set features = $2 where id = $1`, [ui.id, JSON.stringify({ ...f, [KEY]: 'BCAIR' })]);
    await c.query(
      `insert into ${S}."ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
       values (gen_random_uuid(), 'SYSTEM', 'system:wct-bcair-doc-brand', 'System creation', $1, 'operator', 'UPDATE', 'organization-features', $1, $2, 'SUCCESS')`,
      [BCAIR, JSON.stringify({ note: `features.${KEY}: (not set) -> "BCAIR" (BC Air invoice + DO on the WCT layout; Elroy 16 Nov)` })],
    );
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  }
  fs.writeFileSync(`${__dirname}/wct-bcair-doc-brand.${env}.log.json`, JSON.stringify({ at: new Date().toISOString(), org: BCAIR, applied: { [KEY]: [null, 'BCAIR'] } }, null, 2));
  console.log(`APPLIED: ${KEY} = BCAIR on ${org.name}.`);
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
