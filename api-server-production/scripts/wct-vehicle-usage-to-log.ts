/**
 * WCT vehicle LOG BOOK (2026-11-16): convert the old usage rows (VehicleUsage,
 * the "Start usage / End usage" form) into log entries, once.
 *
 *   each usage  -> "Driver assigned" on its start date with the start mileage
 *   ended usage -> also an "Other" entry on the end date with the end mileage
 *   repair      -> a "Repair / servicing" entry, approval and unlock history kept
 *
 * Idempotent: a usage that already has entries (sourceUsageId) is skipped. The
 * usage rows are kept as they are (nothing deleted). Every created entry gets a
 * "System creation" Activity Log row, and the run writes a local log file.
 *
 *   npx ts-node --transpile-only scripts/wct-vehicle-usage-to-log.ts --env prod            # dry run
 *   npx ts-node --transpile-only scripts/wct-vehicle-usage-to-log.ts --env prod --apply    # writes
 *
 * --env dev uses DATABASE_URL (tables in schema "platform"), prod PROD_DATABASE_URL (public).
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { Client, types } from 'pg';
import { planUsageConversion } from '../src/vehicles/vehicle-rules';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const env = process.argv.find((a) => a.startsWith('--env='))?.split('=')[1] ?? (process.argv.includes('--env') ? process.argv[process.argv.indexOf('--env') + 1] : 'dev');
const apply = process.argv.includes('--apply');
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');
// Prisma stores UTC in "timestamp without time zone": read it as UTC (node-pg would read local SGT, 8h off)
// and write UTC strings back.
types.setTypeParser(1114, (v: string) => new Date(`${v.replace(' ', 'T')}Z`));
const ts = (d: Date | null | undefined) => (d ? d.toISOString().replace('T', ' ').replace('Z', '') : null);

(async () => {
  if (env !== 'dev' && env !== 'prod') throw new Error('--env dev|prod');
  const url = env === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error('database url not set');
  const S = env === 'prod' ? '"public"' : '"platform"';
  const c = new Client({ connectionString: url });
  await c.connect();
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows;
  const hasTable = (await q(`select 1 from information_schema.tables where table_schema=$1 and table_name='VehicleLogEntry'`, [S.replace(/"/g, '')])).length > 0;
  const usages = await q(
    `select u.*, v."vehicleNo" from ${S}."VehicleUsage" u join ${S}."Vehicle" v on v.id=u."vehicleId" where u."organizationId"=$1 order by v."vehicleNo", u."startDate", u."createdAt"`,
    [WCT],
  );
  const done = new Set(hasTable ? (await q(`select distinct "sourceUsageId" from ${S}."VehicleLogEntry" where "organizationId"=$1 and "sourceUsageId" is not null`, [WCT])).map((r) => r.sourceUsageId) : []);
  const plan: any[] = [];
  for (const u of usages) {
    if (done.has(u.id)) {
      console.log(`SKIP ${u.vehicleNo}: usage ${u.id} already converted`);
      continue;
    }
    for (const e of planUsageConversion(u)) plan.push({ ...e, vehicleId: u.vehicleId, vehicleNo: u.vehicleNo });
  }
  console.log(`${env.toUpperCase()}: ${usages.length} usage row(s) in WCT (S), ${done.size} already converted, ${plan.length} entr${plan.length === 1 ? 'y' : 'ies'} to create${hasTable ? '' : ' (VehicleLogEntry table not on this database yet: it comes with the deploy)'}`);
  for (const e of plan) {
    console.log(`  ${e.vehicleNo}  ${ymd(e.date)}  ${e.type.padEnd(7)} driver=${e.driverName ?? '-'}  mileage=${e.mileage ?? '-'}  ${e.description ?? ''}${e.repairApprovedAt ? `  [approved by ${e.repairApprovedBy} ${ymd(e.repairApprovedAt)}]` : ''}`);
  }
  if (!apply) {
    console.log('DRY RUN: nothing written. Re-run with --apply.');
    await c.end();
    return;
  }
  if (!hasTable) throw new Error('VehicleLogEntry does not exist on this database yet; deploy first');
  const log: any[] = [];
  await c.query('begin');
  try {
    for (const e of plan) {
      const id = randomUUID();
      await c.query(
        `insert into ${S}."VehicleLogEntry"(id, "organizationId", "vehicleId", date, type, description, mileage, amount, "driverUserId", "driverName", "repairApprovedBy", "repairApprovedById", "repairApprovedAt", "repairUnlocks", "sourceUsageId", "createdBy", "createdByName", "createdAt", "updatedAt")
         values ($1,$2,$3,$4,$5,$6,$7,null,$8,$9,$10,$11,$12,$13,$14,'system:wct-vehicle-usage-to-log','System creation',now(),now())`,
        [id, WCT, e.vehicleId, ts(e.date), e.type, e.description ?? null, e.mileage ?? null, e.driverUserId ?? null, e.driverName ?? null, e.repairApprovedBy ?? null, e.repairApprovedById ?? null, ts(e.repairApprovedAt), e.repairUnlocks ? JSON.stringify(e.repairUnlocks) : null, e.sourceUsageId],
      );
      await c.query(
        `insert into ${env === 'prod' ? '"public"' : '"platform"'}."ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
         values (gen_random_uuid(), 'SYSTEM', 'system:wct-vehicle-usage-to-log', 'System creation', $1, 'operator', 'CREATE', 'vehicles', $2, $3, 'SUCCESS')`,
        [WCT, e.vehicleId, JSON.stringify({ note: `log entry ${e.type} ${ymd(e.date)} from usage ${e.sourceUsageId}`, entryId: id })],
      );
      log.push({ id, ...e });
    }
    await c.query('commit');
  } catch (err) {
    await c.query('rollback');
    throw err;
  }
  fs.writeFileSync(`${__dirname}/wct-vehicle-usage-to-log.${env}.log.json`, JSON.stringify({ at: new Date().toISOString(), created: log }, null, 2));
  console.log(`APPLIED: ${log.length} entr${log.length === 1 ? 'y' : 'ies'} created; usage rows kept.`);
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
