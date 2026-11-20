/**
 * Biofuel MG20260162 off-hire (Keller, deployment #1 on "Kim Heng Limited, 48 Penjuru Rd").
 * Reason: Elroy go 20 Nov: MG20260162 back from Keller, needed for #113.
 *
 * Mirrors the app's own return path exactly, in ONE transaction:
 *  - unit rental -> instock, guarded on status=rental     (deliveries.service.ts collectReturnUnit, the inventory.updateMany)
 *  - last-unit guard: no other open unit on the deployment (deliveries.service.ts offHireDeploymentOnReturn)
 *  - projects.offHireDeployment(dep, org, date) -> updateDeployment: status OFF_HIRED + offHiredDate,
 *    deactivate linked recurring templates, close open assignments at the same instant (projects.service.ts updateDeployment)
 *
 *   PROD_DATABASE_URL=… TZ=UTC npx ts-node --transpile-only scripts/_biofuel-mg162-offhire.ts --date=YYYY-MM-DD           # dry run
 *   … --date=YYYY-MM-DD --apply
 * The off-hire instant is 12:00 SGT on --date (or now, if that is still in the future).
 */
import * as fs from 'fs';
import { Client } from 'pg';

const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const UNIT = '03198fee-65d6-40a8-b2c6-85536fb7eb6d';
const DEP = '0431a255-d6a0-43e7-9ba7-996f298f05e7';
const REASON = 'Elroy go 20 Nov: real Keller rental, unit physically back (MG20260162 needed for #113), off-hire 19 Nov 12:00 SGT';
const ACTOR = 'system:biofuel-mg162-offhire';
const LOGDIR = '/Users/elroylee/Desktop/aims-agents/logs/biofuel';
const APPLY = process.argv.includes('--apply');
const DATE = (process.argv.find((a) => a.startsWith('--date=')) || '').slice(7);

function must(c: any, m: string) {
  if (!c) throw new Error('ABORT: ' + m);
}

async function main() {
  must(/^\d{4}-\d{2}-\d{2}$/.test(DATE), 'pass --date=YYYY-MM-DD');
  const noon = new Date(`${DATE}T12:00:00+08:00`);
  const at = noon.getTime() > Date.now() ? new Date() : noon; // today: now, not a future noon
  must(at.getTime() >= new Date('2026-09-04T03:08:27Z').getTime() && at.getTime() <= Date.now(), 'date must be between the 4 Sep delivery and now');
  const c = new Client({ connectionString: process.env.PROD_DATABASE_URL });
  await c.connect();
  const log: any = { mode: APPLY ? 'apply' : 'dry-run', at: new Date().toISOString(), reason: REASON, offHiredAt: at.toISOString(), changes: [] };
  try {
    await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
    const lk = APPLY ? ' for update' : '';
    const unit = (await c.query(`select id,"organizationId",sku,status from "Inventory" where id=$1${lk}`, [UNIT])).rows[0];
    const dep = (await c.query(`select id,"organizationId","deploymentNumber",status,"offHiredDate","projectId" from "ProjectDeployment" where id=$1${lk}`, [DEP])).rows[0];
    must(unit?.organizationId === ORG && unit.sku === 'MG20260162' && unit.status === 'rental', `unit not as expected: ${JSON.stringify(unit)}`);
    must(dep?.organizationId === ORG && dep.status === 'ACTIVE' && dep.offHiredDate === null, `deployment not as expected: ${JSON.stringify(dep)}`);
    const open = (await c.query(`select a.id,a."inventoryId",a."startDate",p."organizationId" from "Assignment" a join "Project" p on p.id=a."projectId" where a."projectDeploymentId"=$1 and a."endDate" is null${APPLY ? ' for update of a' : ''}`, [DEP])).rows;
    must(open.every((a: any) => a.organizationId === ORG), 'assignment outside Biofuel');
    // Last-unit guard, as offHireDeploymentOnReturn: no OTHER unit on this deployment still out.
    const others = open.filter((a: any) => a.inventoryId !== UNIT);
    must(others.length === 0, `other open assignments on the deployment: ${others.map((a: any) => a.id).join(',')}`);
    must(open.length === 1, `expected 1 open assignment, got ${open.length}`);
    const templates = (await c.query(`select id,"organizationId",name from "RecurringInvoiceTemplate" where "projectDeploymentId"::text=$1 and "isActive"=true`, [DEP])).rows;

    log.changes.push(
      { table: 'Inventory', id: UNIT, organizationId: unit.organizationId, field: 'status', old: 'rental', new: 'instock' },
      { table: 'ProjectDeployment', id: DEP, organizationId: dep.organizationId, field: 'status', old: dep.status, new: 'OFF_HIRED' },
      { table: 'ProjectDeployment', id: DEP, organizationId: dep.organizationId, field: 'offHiredDate', old: null, new: at.toISOString() },
      ...open.map((a: any) => ({ table: 'Assignment', id: a.id, organizationId: a.organizationId, field: 'endDate', old: null, new: at.toISOString(), startDate: a.startDate })),
      ...templates.map((t: any) => ({ table: 'RecurringInvoiceTemplate', id: t.id, organizationId: t.organizationId, field: 'isActive', old: true, new: false, name: t.name })),
    );
    log.recurringTemplatesLinked = templates.length;

    if (APPLY) {
      const u1 = await c.query(`update "Inventory" set status='instock',"updatedAt"=now() where id=$1 and "organizationId"=$2 and status='rental'`, [UNIT, ORG]);
      const u2 = await c.query(`update "ProjectDeployment" set status='OFF_HIRED',"offHiredDate"=$1,"updatedAt"=now() where id=$2 and "organizationId"=$3 and status='ACTIVE'`, [at, DEP, ORG]);
      const u3 = templates.length ? await c.query(`update "RecurringInvoiceTemplate" set "isActive"=false,"updatedAt"=now() where id=any($1::uuid[]) and "organizationId"=$2`, [templates.map((t: any) => t.id), ORG]) : { rowCount: 0 };
      const u4 = await c.query(`update "Assignment" set "endDate"=$1 where "projectDeploymentId"=$2 and "endDate" is null`, [at, DEP]);
      must(u1.rowCount === 1 && u2.rowCount === 1 && u3.rowCount === templates.length && u4.rowCount === 1, `row counts ${u1.rowCount}/${u2.rowCount}/${u3.rowCount}/${u4.rowCount}`);
      const changes = log.changes.map((x: any) => ({ table: x.table, id: x.id, field: x.field, from: x.old, to: x.new }));
      for (const [resource, rid] of [['inventories', UNIT], ['projects', DEP]] as const) {
        await c.query(
          `insert into "ActionLog"(id,"actorType","actorId","actorName","organizationId",channel,action,resource,"resourceId",details,status,"createdAt") values (gen_random_uuid()::text,'SYSTEM',$1,'System creation',$2,'cron',$3,$4,$5,$6::jsonb,'SUCCESS',now())`,
          [ACTOR, ORG, resource === 'projects' ? 'OFF_HIRE' : 'UPDATE', resource, rid, JSON.stringify({ note: `MG20260162 off-hired ${DATE} (deployment #1, Kim Heng Limited, 48 Penjuru Rd, Keller): ${REASON}`, changes })],
        );
      }
      await c.query('COMMIT');
      log.committed = true;
    } else await c.query('ROLLBACK');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    log.error = (e as Error).message;
    throw e;
  } finally {
    const f = `${LOGDIR}/2026-11-20-mg162-offhire-${log.mode}-${Date.now()}.json`;
    fs.writeFileSync(f, JSON.stringify(log, null, 1));
    console.log('log:', f);
    for (const x of log.changes) console.log(`${x.table} ${x.organizationId?.slice(0, 8)} ${x.id.slice(0, 8)} ${x.field}: ${JSON.stringify(x.old)} -> ${JSON.stringify(x.new)}`);
    console.log('recurring templates linked:', log.recurringTemplatesLinked, log.error ? 'ERROR ' + log.error : '');
    await c.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
