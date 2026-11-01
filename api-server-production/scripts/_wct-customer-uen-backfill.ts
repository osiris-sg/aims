/**
 * WCT customer import follow-up (2026-11): fill Customer.uen + Customer.externalRef
 * for the imported customers from <imports>/wct-customer-mapping.csv (written by
 * import-wct-customers.ts --apply). externalRef = the DP Info DebtorCode(s)
 * ("228+229" for a merged customer); uen = the first real UEN of its rows.
 * Empty slots only: a value already there is never overwritten. WCT org only.
 * DRY RUN by default (read-only).
 *
 *   TENANCY_MODE= DATABASE_URL=<prod> npx ts-node --transpile-only scripts/_wct-customer-uen-backfill.ts <mapping.csv>
 *   … --apply --confirm-prod        # after the owner's go; one Activity Log row per customer
 *
 * Needs the columns first: scripts/_wct-customer-uen-columns.ts.
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { Client } from 'pg';
import { parseCsv } from '../src/customers/wct-import/wct-debtor-clean';

const WCT_ORG = '5c700000-0000-4000-8000-5c7000000001';
const ACTOR = 'system:wct-customer-uen-backfill';
const BATCH = 500;
const has = (f: string) => process.argv.includes(`--${f}`);
const mappingPath = process.argv.slice(2).find((a) => !a.startsWith('--'));

interface Want {
  id: string;
  code: string;
  debtorCodes: string[];
  uens: string[];
}

(async () => {
  if (!mappingPath || !fs.existsSync(mappingPath)) throw new Error('usage: _wct-customer-uen-backfill.ts <wct-customer-mapping.csv> [--apply --confirm-prod]');
  const url = process.env.DATABASE_URL || '';
  if (!url) throw new Error('DATABASE_URL is not set');
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  if (has('apply') && !local && !has('confirm-prod')) throw new Error('--apply on a non-local DB needs --confirm-prod');

  const [header, ...rows] = parseCsv(fs.readFileSync(mappingPath, 'utf8'));
  const col = (n: string) => {
    const i = header.indexOf(n);
    if (i < 0) throw new Error(`mapping CSV has no ${n} column`);
    return i;
  };
  const [iCode, iStatus, iCust, iId, iUen, iUenStatus] = ['DebtorCode', 'Status', 'CustomerCode', 'CustomerId', 'UEN', 'UENStatus'].map(col);
  const wants = new Map<string, Want>();
  for (const r of rows) {
    if (r[iStatus] !== 'created' && r[iStatus] !== 'merged') continue;
    if (!r[iId]) throw new Error(`row ${r[iCode]} has no CustomerId: is this the apply mapping (not the dry-run one)?`);
    const w = wants.get(r[iId]) ?? { id: r[iId], code: r[iCust], debtorCodes: [], uens: [] };
    w.debtorCodes.push(r[iCode]);
    if (r[iUenStatus] === 'ok' && r[iUen] && !w.uens.includes(r[iUen])) w.uens.push(r[iUen]);
    wants.set(r[iId], w);
  }

  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const cols = (await c.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'Customer' and column_name in ('uen','externalRef')`)).rows.length;
    if (cols < 2 && has('apply')) throw new Error('Customer.uen / externalRef missing: run _wct-customer-uen-columns.ts first');
    const sel = cols === 2 ? `uen, "externalRef"` : `null::text as uen, null::text as "externalRef"`;
    const db = new Map<string, { code: string; org: string; uen: string | null; externalRef: string | null }>();
    for (const r of (await c.query(`select id, "customerCode" as code, "organizationId" as org, ${sel} from public."Customer" where id = any($1::uuid[])`, [[...wants.keys()]])).rows) db.set(r.id, r);

    const blank = (v: string | null) => v == null || v.trim() === '';
    const plan: { id: string; code: string; uen: string | null; externalRef: string | null }[] = [];
    const problems: string[] = [];
    let keptUen = 0;
    let keptRef = 0;
    for (const w of wants.values()) {
      const cur = db.get(w.id);
      if (!cur) {
        problems.push(`${w.code} ${w.id}: not found`);
        continue;
      }
      if (cur.org !== WCT_ORG || cur.code !== w.code) {
        problems.push(`${w.code} ${w.id}: org/code mismatch (db ${cur.code}) — skipped`);
        continue;
      }
      if (w.uens.length > 1) problems.push(`${w.code} (Debtor ${w.debtorCodes.join('+')}): ${w.uens.length} different UENs, using the first`);
      const ref = w.debtorCodes.join('+');
      const uen = w.uens[0] ?? null;
      const setUen = uen && blank(cur.uen) ? uen : null;
      const setRef = blank(cur.externalRef) ? ref : null;
      if (uen && !blank(cur.uen) && cur.uen !== uen) {
        keptUen++;
        problems.push(`${w.code}: uen already "${cur.uen}" — kept`);
      }
      if (!blank(cur.externalRef) && cur.externalRef !== ref) {
        keptRef++;
        problems.push(`${w.code}: externalRef already "${cur.externalRef}" — kept`);
      }
      if (setUen || setRef) plan.push({ id: w.id, code: w.code, uen: setUen, externalRef: setRef });
    }
    console.log(
      JSON.stringify(
        {
          columnsPresent: cols === 2,
          mappedCustomers: wants.size,
          foundInDb: db.size,
          toUpdate: plan.length,
          setUen: plan.filter((p) => p.uen).length,
          setExternalRef: plan.filter((p) => p.externalRef).length,
          mergedRefs: plan.filter((p) => p.externalRef?.includes('+')).length,
          existingValuesKept: { uen: keptUen, externalRef: keptRef },
          problems: problems.length,
        },
        null,
        2,
      ),
    );
    for (const p of problems.slice(0, 30)) console.log('  ', p);
    for (const p of plan.slice(0, 5)) console.log('  sample', p.code, '→ uen', p.uen ?? '(unchanged)', '| externalRef', p.externalRef ?? '(unchanged)');
    if (!has('apply')) return console.log('\n-- dry run; pass --apply --confirm-prod to write');

    for (let i = 0; i < plan.length; i += BATCH) {
      const b = plan.slice(i, i + BATCH);
      await c.query('BEGIN');
      try {
        const res = await c.query(
          `update public."Customer" c set
             uen = case when c.uen is null or c.uen = '' then coalesce(v.uen, c.uen) else c.uen end,
             "externalRef" = case when c."externalRef" is null or c."externalRef" = '' then coalesce(v.ref, c."externalRef") else c."externalRef" end,
             "updatedAt" = now()
           from unnest($1::uuid[], $2::text[], $3::text[]) as v(id, uen, ref)
           where c.id = v.id and c."organizationId" = $4`,
          [b.map((p) => p.id), b.map((p) => p.uen), b.map((p) => p.externalRef), WCT_ORG],
        );
        if (res.rowCount !== b.length) throw new Error(`batch ${i / BATCH + 1}: updated ${res.rowCount} of ${b.length}, rolled back`);
        await c.query(
          `insert into public."ActionLog" (id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status, "createdAt")
           select v.lid, 'SYSTEM', $2, 'System creation', $3, 'operator', 'UPDATE', 'Customer', v.id, v.details::jsonb, 'SUCCESS', now()
           from unnest($1::text[], $4::text[], $5::text[]) as v(lid, id, details)`,
          [
            b.map(() => randomUUID()),
            ACTOR,
            WCT_ORG,
            b.map((p) => p.id),
            b.map((p) =>
              JSON.stringify({ customerCode: p.code, set: { ...(p.uen ? { uen: p.uen } : {}), ...(p.externalRef ? { externalRef: p.externalRef } : {}) }, source: 'wct-customer-mapping.csv' }),
            ),
          ],
        );
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
      console.log(`WRITE batch ${i / BATCH + 1}: ${b.length} customers (+ActionLog)`);
    }
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
