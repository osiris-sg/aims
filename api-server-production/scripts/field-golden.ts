/**
 * Field golden run (FIELD_PLAN.md §5.3), READ ONLY everywhere:
 *   1. SiteClock's OWN code (computeMonthlyPayroll, leaveBalances from the untouched checkout at SITECLOCK_DIR,
 *      default ~/Desktop/siteclock/backend) runs as an inline `tsx -e` against SITECLOCK_RO_DATABASE_URL (Elroy sets
 *      it: a read-only user, or a local snapshot). Nothing is written into the SiteClock repo or its database.
 *   2. The AIMS port computes the same months / years from the org's shadow-imported Field rows, in memory.
 *   3. Every differing number goes to _imports/wct/parity/field-golden.<env>.csv.
 *
 *   npx ts-node scripts/field-golden.ts --env prod --org <aims org id> --siteclock-company <id> --months 2026-09,2026-10,2026-11 --years 2026
 */
process.env.TZ = 'UTC';
import 'dotenv/config';
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { Client } from 'pg';
import { compareGolden } from '../src/field/import/golden';

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : null;
};
const TABLES: Record<string, string> = {
  worker: 'Worker', fieldWorkerProfile: 'FieldWorkerProfile', fieldPayProfile: 'FieldPayProfile', fieldTimeEntry: 'FieldTimeEntry', fieldPublicHoliday: 'FieldPublicHoliday',
  fieldShiftAssignment: 'FieldShiftAssignment', fieldShiftTemplate: 'FieldShiftTemplate', fieldLeaveRequest: 'FieldLeaveRequest', fieldLeaveEntitlement: 'FieldLeaveEntitlement',
  fieldLeaveType: 'FieldLeaveType',
};

/** SiteClock's own numbers, from its own code, read only (inline script; no file is written in the SiteClock checkout). */
function siteclockNumbers(dir: string, url: string, companyId: string, months: string[], years: number[]) {
  const code = `
    import { computeMonthlyPayroll } from "./src/modules/payroll/payroll.service";
    import { leaveBalances } from "./src/lib/leave";
    import { prisma } from "./src/lib/prisma";
    (async () => {
      await prisma.$executeRawUnsafe("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
      const payroll: Record<string, any[]> = {};
      for (const m of ${JSON.stringify(months)}) payroll[m] = (await computeMonthlyPayroll(${JSON.stringify(companyId)}, m)).workers;
      const users = await prisma.user.findMany({ where: { companyId: ${JSON.stringify(companyId)}, role: { in: ["WORKER", "SUPERVISOR"] } }, select: { id: true } });
      const leave: Record<string, Record<string, any[]>> = {};
      for (const y of ${JSON.stringify(years)}) { leave[y] = {}; for (const u of users) leave[y][u.id] = await leaveBalances(u.id, ${JSON.stringify(companyId)}, y); }
      process.stdout.write(JSON.stringify({ payroll, leave }));
      await prisma.$disconnect();
    })().catch((e) => { console.error(e); process.exit(1); });`;
  const out = execFileSync('npx', ['tsx', '-e', code], { cwd: dir, env: { ...process.env, DATABASE_URL: url, TZ: 'UTC' }, maxBuffer: 256 * 1024 * 1024 }).toString();
  return JSON.parse(out.slice(out.indexOf('{')));
}

(async () => {
  const env = arg('--env') ?? 'dev';
  const org = arg('--org');
  const company = arg('--siteclock-company');
  const months = (arg('--months') ?? '').split(',').filter(Boolean);
  const years = (arg('--years') ?? '').split(',').filter(Boolean).map(Number);
  if (!org || !company || !months.length) throw new Error('need --org, --siteclock-company, --months (and optionally --years)');
  const scUrl = process.env.SITECLOCK_RO_DATABASE_URL;
  if (!scUrl) throw new Error('SITECLOCK_RO_DATABASE_URL is not set (Elroy sets it)');
  const url = env === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error(`no database url for --env ${env}`);
  const S = env === 'prod' ? '"public"' : '"platform"';
  const dir = process.env.SITECLOCK_DIR ?? join(homedir(), 'Desktop/siteclock/backend');

  const sc = siteclockNumbers(dir, scUrl, company, months, years);
  const db = new Client({ connectionString: url });
  await db.connect();
  const rows: Record<string, any[]> = {};
  try {
    await db.query('BEGIN TRANSACTION READ ONLY');
    for (const [k, t] of Object.entries(TABLES)) rows[k] = (await db.query(`select * from ${S}."${t}" where "organizationId" = $1`, [org])).rows;
    await db.query('ROLLBACK');
  } finally {
    await db.end();
  }
  const out = await compareGolden(rows, org, sc);
  console.log(`Golden ${env}: ${out.checked.payrollRows} payroll rows and ${out.checked.balances} leave balances compared, ${out.diffs.length} differences.`);
  if (out.onlyInSiteClock.length) console.log(`Only in SiteClock (not imported): ${out.onlyInSiteClock.length}`);
  if (out.onlyInAims.length) console.log(`Only in AIMS: ${out.onlyInAims.length}`);
  const dirOut = join(__dirname, '../../_imports/wct/parity');
  mkdirSync(dirOut, { recursive: true });
  const file = join(dirOut, `field-golden.${env}.csv`);
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  writeFileSync(file, ['kind,period,siteclockUserId,name,field,siteclock,aims', ...out.diffs.map((d) => [d.kind, d.period, d.siteclockUserId, d.name, d.field, d.siteclock, d.aims].map(esc).join(','))].join('\n'));
  console.log(`Differences: ${file}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
