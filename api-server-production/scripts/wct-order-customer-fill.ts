/**
 * Orders with no customer (2026-11-17, ORD202611-013 shows Customer "-").
 *
 * Cause: an order takes its customer from the quotation at the moment the
 * quotation is confirmed / signed. QO202611-0030 was confirmed with no
 * customer (17 Nov 06:14:25 UTC) and the customer was picked 13 minutes
 * later; the order never follows later quotation edits, so Order.customerId
 * stayed empty.
 *
 * This fills Order.customerId ONLY where it is empty and the order's source
 * quotation names a customer (config.customerId) that exists in the same org.
 * Never overwrites. WCT group orgs only. Orders whose quotation has no
 * customer either (e.g. ORD202611-014 / QO202611-0031) are listed, not guessed.
 *
 *   npx ts-node --transpile-only scripts/wct-order-customer-fill.ts --env prod            # dry run
 *   npx ts-node --transpile-only scripts/wct-order-customer-fill.ts --env prod --apply    # writes + ActionLog + log json
 *   (--env dev reads the "wct" tenancy schema; --schema <name> to change it)
 */
import 'dotenv/config';
import * as fs from 'fs';
import { Client } from 'pg';

const ORGS = ['5c700000-0000-4000-8000-5c7000000001', '5c700000-0000-4000-8000-5c7000000002', '5c700000-0000-4000-8000-5c7000000003', '5c700000-0000-4000-8000-5c7000000004'];
const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const env = arg('--env') ?? 'dev';
const apply = process.argv.includes('--apply');

(async () => {
  if (env !== 'dev' && env !== 'prod') throw new Error('--env dev|prod');
  const url = env === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error('database url not set');
  const S = env === 'prod' ? '"public"' : `"${arg('--schema') ?? 'wct'}"`;
  const P = env === 'prod' ? '"public"' : '"platform"';
  const c = new Client({ connectionString: url });
  await c.connect();
  const rows = (
    await c.query(
      `select o.id, o."orderNumber", o."organizationId"::text org, q.name qname, q.config->>'customerId' qcid, q.config->>'customerName' qcname,
              cu.id::text cust_id, cu.name cust_name
         from ${S}."Order" o
         left join ${S}."Document" q on q.id::text = o."sourceQuotationId"::text
         left join ${S}."Customer" cu on cu.id::text = q.config->>'customerId' and cu."organizationId"::text = o."organizationId"::text
        where o."customerId" is null and o."organizationId"::text = any($1)
        order by o."createdAt"`,
      [ORGS],
    )
  ).rows;
  const fill = rows.filter((r) => r.cust_id);
  const skip = rows.filter((r) => !r.cust_id);
  console.log(`${env.toUpperCase()} orders with no customer (WCT group): ${rows.length}`);
  for (const r of fill) console.log(`  FILL ${r.orderNumber}: customer ${r.cust_name} (${r.cust_id}) from ${r.qname}`);
  for (const r of skip) console.log(`  SKIP ${r.orderNumber}: ${r.qname ?? 'no quotation'} ${r.qcid ? `names customer ${r.qcid} not found in the org` : 'has no customer'}; left empty`);
  if (!apply || !fill.length) {
    console.log(fill.length ? `DRY RUN: ${fill.length} change(s), nothing written. Re-run with --apply.` : 'Nothing to apply.');
    await c.end();
    return;
  }
  await c.query('begin');
  try {
    for (const r of fill) {
      const res = await c.query(`update ${S}."Order" set "customerId" = $2 where id = $1 and "customerId" is null`, [r.id, r.cust_id]);
      if (res.rowCount !== 1) throw new Error(`${r.orderNumber} changed meanwhile; nothing written`);
      await c.query(
        `insert into ${P}."ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
         values (gen_random_uuid(), 'SYSTEM', 'system:wct-order-customer-fill', 'System creation', $1, 'operator', 'UPDATE', 'orders', $2, $3, 'SUCCESS')`,
        [r.org, r.id, JSON.stringify({ note: `${r.orderNumber}: customer (empty) -> ${r.cust_name} from quotation ${r.qname}` })],
      );
    }
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  }
  fs.writeFileSync(
    `${__dirname}/wct-order-customer-fill.${env}.log.json`,
    JSON.stringify({ at: new Date().toISOString(), applied: fill.map((r) => ({ order: r.orderNumber, id: r.id, from: null, to: r.cust_id, customer: r.cust_name, quotation: r.qname })) }, null, 2),
  );
  console.log(`APPLIED: ${fill.length} order(s).`);
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
