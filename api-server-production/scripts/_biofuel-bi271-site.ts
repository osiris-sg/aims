/**
 * Biofuel draft invoice BI202611271 follows DO202611110 to Lentor Garden (project 64f44511).
 * Changes ONLY: Document.projectId, config.projectName, config.documentInfo.projectName, config.deliveryTo.
 * Customer, lines, amounts, number and dates untouched. Draft only, no journal.
 *
 *   PROD_DATABASE_URL=… TZ=UTC npx ts-node --transpile-only scripts/_biofuel-bi271-site.ts               # dry run
 *   … --apply --expect=<invoice updatedAt from the dry run>                                             # needs Elroy's go
 */
import 'dotenv/config';
import * as fs from 'fs';
import { Client } from 'pg';

const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const INV_ID = '27aaf525-739b-49b4-9af7-f2998175db7d';
const DO_ID = '49e971e7-5bea-420f-a1f0-0bb6c0e2a0d3';
const OLD_PROJ = '3a23ad61-7bc7-4109-8cb4-67bf6d7e0eca';
const NEW_PROJ = '64f44511-f5b0-4d61-8f89-b04be9590703';
const OLD_SITE = 'HDB Woodlands N9C10'; // stored with two non-breaking spaces
const SITE = 'Lentor Garden';
const REASON = 'Elroy go, request from Arun 21 Nov (follows DO202611110)';
const ACTOR = 'system:biofuel-bi271-site';
const LOGDIR = '/Users/elroylee/Desktop/aims-agents/logs/biofuel';
const APPLY = process.argv.includes('--apply');
const EXPECT = (process.argv.find((a) => a.startsWith('--expect=')) || '').slice(9);
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');

function must(cond: any, msg: string) {
  if (!cond) throw new Error(`ABORT: ${msg}`);
}

async function main() {
  const c = new Client({ connectionString: process.env.PROD_DATABASE_URL });
  await c.connect();
  const log: any = { mode: APPLY ? 'apply' : 'dry-run', at: new Date().toISOString(), reason: REASON, changes: [] };
  try {
    await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
    const inv = (await c.query(`select id,"organizationId",type,name,status,"projectId","updatedAt",config from "Document" where id=$1${APPLY ? ' for update' : ''}`, [INV_ID])).rows[0];
    const proj = (await c.query(`select "organizationId",name,"customerId" from "Project" where id=$1`, [NEW_PROJ])).rows[0];
    const doRow = (await c.query(`select "organizationId","projectId",config->>'deliveryTo' dto from "Document" where id=$1`, [DO_ID])).rows[0];
    must(inv?.organizationId === ORG && inv.type === 'INVOICE' && inv.name === 'BI202611271', 'invoice identity');
    must(proj?.organizationId === ORG && proj.name === 'Lentor Garden' && proj.customerId === inv.config.customerId, 'project identity / customer');
    must(doRow?.organizationId === ORG && doRow.projectId === NEW_PROJ && doRow.dto === SITE, 'DO202611110 not yet on Lentor Garden');
    must(inv.status === 'unconfirmed', `invoice is ${inv.status}, not a draft`);
    must(inv.config.sourceDocumentId === DO_ID, 'invoice not from DO202611110');
    const je = (await c.query(`select "journalNumber",status from "JournalEntry" where "organizationId"=$1 and "sourceDocumentId"::text=$2`, [ORG, INV_ID])).rows;
    must(je.length === 0, 'invoice has a journal; stop');
    log.invUpdatedAt = new Date(inv.updatedAt).toISOString();
    if (APPLY) must(EXPECT && EXPECT === log.invUpdatedAt, `invoice changed since the dry run (now ${log.invUpdatedAt}, expected ${EXPECT})`);
    must(inv.projectId === OLD_PROJ && inv.config.deliveryTo === OLD_SITE && inv.config.projectName === OLD_SITE, 'invoice project/site already changed');

    const cfg = inv.config;
    const next = JSON.parse(JSON.stringify(cfg));
    const set = (path: string, val: any) => {
      const parts = path.split('.');
      let o = next;
      for (const p of parts.slice(0, -1)) o = o[p];
      const old = o[parts[parts.length - 1]];
      if (JSON.stringify(old) === JSON.stringify(val)) return;
      o[parts[parts.length - 1]] = val;
      log.changes.push({ table: 'Document', id: INV_ID, organizationId: ORG, field: `config.${path}`, old, new: val });
    };
    set('deliveryTo', SITE);
    set('projectName', 'Lentor Garden');
    if (next.documentInfo && 'projectName' in next.documentInfo) set('documentInfo.projectName', 'Lentor Garden');
    log.changes.push({ table: 'Document', id: INV_ID, organizationId: ORG, field: 'projectId', old: inv.projectId, new: NEW_PROJ });
    for (const k of ['items', 'customer', 'customerId', 'date', 'nettTotal', 'subTotal', 'gstAmount']) must(JSON.stringify(next[k]) === JSON.stringify(cfg[k]), `${k} would change`);
    log.context = { status: inv.status, journals: je, lines: (cfg.items || []).map((i: any) => `${i.description} x${i.quantity} @ ${i.unitPrice}`), total: cfg.nettTotal };

    if (APPLY) {
      const u = await c.query(`update "Document" set config=$1::jsonb,"projectId"=$2,"updatedAt"=now() where id=$3 and "organizationId"=$4 and status='unconfirmed'`, [JSON.stringify(next), NEW_PROJ, INV_ID, ORG]);
      must(u.rowCount === 1, `row count ${u.rowCount}`);
      const changes = log.changes.map((x: any) => ({ field: x.field, from: x.old, to: x.new }));
      await c.query(
        `insert into "ActionLog"(id,"actorType","actorId","actorName","organizationId",channel,action,resource,"resourceId",details,status,"createdAt") values (gen_random_uuid()::text,'SYSTEM',$1,'System creation',$2,'cron','UPDATE','documents',$3,$4::jsonb,'SUCCESS',now())`,
        [ACTOR, ORG, INV_ID, JSON.stringify({ note: `BI202611271 project/Delivery To -> Lentor Garden: ${REASON}`, changes })],
      );
      await c.query(
        `insert into "AuditLog"(id,"userId","userName",action,resource,"resourceId","resourceName","organizationId",details,status,"createdAt") values (gen_random_uuid()::text,$1,'System creation','EDITED','document',$2,'BI202611271',$3,$4::jsonb,'SUCCESS',now())`,
        [ACTOR, INV_ID, ORG, JSON.stringify({ detail: `Project and Delivery To HDB Woodlands N9C10 -> Lentor Garden (${REASON}). Customer, lines and amounts unchanged.`, changes })],
      );
      await c.query('COMMIT');
      log.committed = true;
    } else await c.query('ROLLBACK');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    log.error = (e as Error).message;
    throw e;
  } finally {
    const out = `${LOGDIR}/2026-11-21-bi271-${log.mode}-${stamp}.json`;
    fs.writeFileSync(out, JSON.stringify(log, null, 1));
    console.log('log:', out);
    await c.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
