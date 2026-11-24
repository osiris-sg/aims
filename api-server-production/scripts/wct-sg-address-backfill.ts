/**
 * Singapore in addresses, existing data (WCT group, 2026-11-24). An address that ends in a 6-digit postal code and
 * names no country gets "Singapore" before the code (common/sg-address.ts withSingapore, the same rule the print and
 * the calendar use). Scope: Customer.address and Delivery.siteAddress (jobs) of the WCT group orgs. Documents are
 * NOT touched (finalized documents never change; their print already shows Singapore).
 *
 *   npx ts-node --transpile-only scripts/wct-sg-address-backfill.ts                       # DRY RUN (default)
 *   npx ts-node --transpile-only scripts/wct-sg-address-backfill.ts --apply --confirm-prod # writes + log
 *
 * Reads PROD_DATABASE_URL from .env (never printed). Each changed row is logged (old / new) to
 * scripts/wct-sg-address-backfill.log.json on apply, so it can be put back.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { withSingapore } from '../src/common/sg-address';

const ORGS: Record<string, string> = {
  '5c700000-0000-4000-8000-5c7000000001': 'WCT (S)',
  '5c700000-0000-4000-8000-5c7000000002': 'WCT Racking',
  '5c700000-0000-4000-8000-5c7000000003': 'YMM',
  '5c700000-0000-4000-8000-5c7000000004': 'BC Air',
};
const APPLY = process.argv.includes('--apply');
const CONFIRM = process.argv.includes('--confirm-prod');

function prodUrl(): string {
  const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('PROD_DATABASE_URL='));
  if (!line) throw new Error('PROD_DATABASE_URL missing in .env');
  return line.slice('PROD_DATABASE_URL='.length).trim().replace(/^"|"$/g, '');
}

type Change = { table: 'Customer' | 'Delivery'; id: string; org: string; label: string; from: string; to: string };

(async () => {
  if (APPLY && !CONFIRM) throw new Error('--apply needs --confirm-prod');
  const c = new Client({ connectionString: prodUrl() });
  await c.connect();
  const ids = Object.keys(ORGS);
  const changes: Change[] = [];
  const scanned = { Customer: 0, Delivery: 0 };
  const cust = await c.query(`SELECT id, "organizationId" AS org, name, address FROM "Customer" WHERE "organizationId" = ANY($1) AND address IS NOT NULL AND btrim(address) <> ''`, [ids]);
  for (const r of cust.rows) {
    scanned.Customer++;
    const to = withSingapore(r.address);
    if (to !== r.address) changes.push({ table: 'Customer', id: r.id, org: r.org, label: r.name, from: r.address, to });
  }
  const jobs = await c.query(
    `SELECT id, "organizationId" AS org, "deliveryNumber" AS no, "siteAddress" AS address FROM "Delivery" WHERE "organizationId" = ANY($1) AND "siteAddress" IS NOT NULL AND btrim("siteAddress") <> ''`,
    [ids],
  );
  for (const r of jobs.rows) {
    scanned.Delivery++;
    const to = withSingapore(r.address);
    if (to !== r.address) changes.push({ table: 'Delivery', id: r.id, org: r.org, label: `job #${r.no}`, from: r.address, to });
  }

  console.log(`WCT group Singapore address backfill: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Scanned: ${scanned.Customer} customer addresses, ${scanned.Delivery} job addresses`);
  for (const t of ['Customer', 'Delivery'] as const) {
    for (const org of ids) {
      const n = changes.filter((x) => x.table === t && x.org === org).length;
      console.log(`  ${t.padEnd(8)} ${ORGS[org].padEnd(12)} to change: ${n}`);
    }
  }
  console.log('Samples (up to 8 per table):');
  for (const t of ['Customer', 'Delivery'] as const) {
    for (const x of changes.filter((y) => y.table === t).slice(0, 8)) {
      console.log(`  ${t} ${ORGS[x.org]} ${x.label}: "${x.from.replace(/\n/g, ' / ')}" -> "${x.to.replace(/\n/g, ' / ')}"`);
    }
  }

  if (!APPLY) {
    console.log('Dry run: nothing written. --apply --confirm-prod to write.');
    await c.end();
    return;
  }
  await c.query('BEGIN');
  try {
    for (const x of changes) {
      const sql =
        x.table === 'Customer'
          ? `UPDATE "Customer" SET address = $2, "updatedAt" = now() WHERE id = $1 AND address = $3`
          : `UPDATE "Delivery" SET "siteAddress" = $2, "updatedAt" = now() WHERE id = $1 AND "siteAddress" = $3`;
      const r = await c.query(sql, [x.id, x.to, x.from]);
      if (r.rowCount !== 1) throw new Error(`${x.table} ${x.id} changed since the read; nothing written`);
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  }
  const log = path.join(__dirname, 'wct-sg-address-backfill.log.json');
  fs.writeFileSync(log, JSON.stringify({ at: new Date().toISOString(), changes }, null, 2));
  console.log(`Written: ${changes.length} rows. Log: ${log}`);
  await c.end();
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
