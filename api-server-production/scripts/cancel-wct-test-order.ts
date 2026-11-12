/**
 * WCT (S) Systems (2026-11-12, owner's instruction): order ORD202611-006 (the
 * prod test of the manual order flow, already marked TEST) -> status CANCELLED,
 * dated in statusDates. Nothing else changes. The manual-flow status refresh
 * leaves a CANCELLED order alone. Dry run by default.
 *
 *   DBURL=<prod> npx ts-node --transpile-only scripts/cancel-wct-test-order.ts [--apply --confirm-prod]
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Client } from 'pg';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const ORDER = 'ORD202611-006';
const apply = process.argv.includes('--apply');

(async () => {
  const url = process.env.DBURL || '';
  if (!url) throw new Error('Pass the database URL inline as DBURL');
  const prodHost = process.env.PROD_DATABASE_URL ? new URL(process.env.PROD_DATABASE_URL).host : '';
  if (apply && new URL(url).host === prodHost && !process.argv.includes('--confirm-prod')) throw new Error('Applying to prod needs --confirm-prod');
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const o = (await c.query(`select id, status, notes, "statusDates" from "Order" where "organizationId" = $1 and "orderNumber" = $2`, [WCT, ORDER])).rows[0];
    if (!o) throw new Error(`${ORDER} not found`);
    if (!String(o.notes ?? '').startsWith('TEST')) throw new Error(`${ORDER} is not marked TEST: refusing`);
    console.log(`${ORDER}: status ${o.status} -> CANCELLED (notes "${String(o.notes).slice(0, 60)}")`);
    if (apply) {
      const now = new Date();
      const dates = { ...(o.statusDates ?? {}), CANCELLED: (o.statusDates ?? {}).CANCELLED ?? now.toISOString() };
      await c.query('BEGIN');
      await c.query(`update "Order" set status = 'CANCELLED', "statusDates" = $2::jsonb, "updatedAt" = $3 where id = $1`, [o.id, JSON.stringify(dates), now]);
      await c.query(
        `insert into "ActionLog" (id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status, "createdAt")
         values ($1, 'SYSTEM', 'system:cancel-wct-test-order', 'System creation', $2, 'script', 'CANCEL', 'orders', $3, $4, 'SUCCESS', $5)`,
        [randomUUID(), WCT, o.id, JSON.stringify({ note: `order ${ORDER} cancelled (TEST record)` }), now],
      );
      await c.query('COMMIT');
      console.log('Applied.');
    } else {
      console.log('Dry run. Pass --apply --confirm-prod to change it.');
    }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
