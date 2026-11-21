/**
 * Field golden parity (FIELD_PLAN.md §5.3), READ ONLY: loads one org's Field rows (the SiteClock shadow import),
 * recomputes every closed day in WINDOW with the AIMS engine in memory (src/field/import/parity.ts) and lists every
 * field that differs from SiteClock's stored numbers. Nothing is written to any database.
 *
 *   npx ts-node scripts/field-parity.ts --env prod --org <aims org id> --from 2026-08-21 --to 2026-11-20
 * Output: a summary, and _imports/wct/parity/field-parity.<env>.<from>_<to>.csv with every mismatch.
 */
process.env.TZ = 'UTC';
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { runParity } from '../src/field/import/parity';

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : null;
};
const TABLES: Record<string, string> = {
  fieldSite: 'FieldSite', fieldSettings: 'FieldSettings', fieldWorkerProfile: 'FieldWorkerProfile', fieldOvertimeRule: 'FieldOvertimeRule',
  fieldBreakRule: 'FieldBreakRule', fieldShiftTemplate: 'FieldShiftTemplate', fieldShiftAssignment: 'FieldShiftAssignment', fieldJob: 'FieldJob',
  fieldJobCrew: 'FieldJobCrew', fieldPunch: 'FieldPunch', fieldTimeEntry: 'FieldTimeEntry', fieldTeamStint: 'FieldTeamStint',
};

(async () => {
  const env = arg('--env') ?? 'dev';
  const org = arg('--org');
  const from = arg('--from');
  const to = arg('--to');
  if (!org || !from || !to) throw new Error('need --org, --from, --to');
  const url = env === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error(`no database url for --env ${env}`);
  const S = env === 'prod' ? '"public"' : '"platform"';
  const db = new Client({ connectionString: url });
  await db.connect();
  const rows: Record<string, any[]> = {};
  try {
    await db.query('BEGIN TRANSACTION READ ONLY');
    for (const [key, table] of Object.entries(TABLES)) rows[key] = (await db.query(`select * from ${S}."${table}" where "organizationId" = $1`, [org])).rows;
    // Linked orgs' jobs (workedFor): their FieldJob rows, read too.
    const other = (await db.query(`select * from ${S}."FieldJob" where "organizationId" <> $1 and id in (select "jobId" from ${S}."FieldPunch" where "organizationId" = $1 and "jobId" is not null)`, [org])).rows;
    rows.fieldJob.push(...other);
    await db.query('ROLLBACK');
  } finally {
    await db.end();
  }
  const out = await runParity(rows, { from, to });
  console.log(`Parity ${env} org ${org}, ${from} to ${to}: ${out.checked} closed days checked, ${out.entriesWithMismatch} with a difference.`);
  console.table(out.byField);
  const dir = join(__dirname, '../../_imports/wct/parity');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `field-parity.${env}.${from}_${to}.csv`);
  const esc = (v: unknown) => `"${String(v instanceof Date ? v.toISOString() : v && typeof v === 'object' ? JSON.stringify(v) : v ?? '').replace(/"/g, '""')}"`;
  writeFileSync(file, ['entryId,siteclockId,workerId,workDate,field,siteclock,aims', ...out.mismatches.map((m) => [m.entryId, m.siteclockId, m.workerId, m.workDate, m.field, m.siteclock, m.aims].map(esc).join(','))].join('\n'));
  console.log(`Mismatches: ${file}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
