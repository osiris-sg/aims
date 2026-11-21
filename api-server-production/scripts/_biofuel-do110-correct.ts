/**
 * Biofuel DO202611110 (run #114) site correction: Woodlands -> Lentor Garden.
 * Request from Arun (WhatsApp, 21 Nov 15:19), checked against the rider's DO_START GPS.
 * Same approach as DO202611107 (_biofuel-do107-correct.ts).
 *
 *   PROD_DATABASE_URL=… TZ=UTC npx ts-node --transpile-only scripts/_biofuel-do110-correct.ts      # dry run (default, no writes)
 *   … --apply --expect=<DO updatedAt> --expect-run=<run updatedAt>                                  # needs Elroy's go
 *   … --render-only                                                                                  # (after apply) corrected copy only
 *
 * Changes ONLY: the DO's project + Delivery To + project name, the run's project + site address, and
 * the pump's rental (ProjectDeployment + its Assignment) moved to the same Lentor Garden project.
 * Customer stays Qingjian International (CQ005), which already owns that Lentor Garden project.
 * Never touches lines, quantities, number, signatures, dates, the group-post PDF or the draft invoice.
 */
import 'dotenv/config';
import * as fs from 'fs';
import { Client } from 'pg';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { PdfGeneratorService } from '../src/common/services/pdf-generator.service';

const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1';
const DO_ID = '49e971e7-5bea-420f-a1f0-0bb6c0e2a0d3';
const RUN_ID = 'dfea3646-e062-4a6f-97ba-98aa80a76e59';
const INV_ID = '27aaf525-739b-49b4-9af7-f2998175db7d';
const DEP_ID = '0b8b933f-6a54-4ac9-b494-cb3f1fdb87f5';
const ASSIGN_ID = 'c194eee9-114a-4587-9a0f-1f223c8ff312';
const CQ005 = '6b5e0c40-e554-4a5d-a80d-06f5592c70d8';
const OLD_PROJ = '3a23ad61-7bc7-4109-8cb4-67bf6d7e0eca'; // HDB Woodlands N9C10
const NEW_PROJ = '64f44511-f5b0-4d61-8f89-b04be9590703'; // Lentor Garden (CQ005)
const OLD_SITE = 'HDB\u00a0Woodlands\u00a0N9C10'; // stored with two non-breaking spaces
const SITE = 'Lentor Garden';
const REASON = 'Elroy go, request from Arun 21 Nov';
const ACTOR = 'system:biofuel-do110-correct';
const PORTAL = 'https://app.ai-ms.io';
const LOGDIR = '/Users/elroylee/Desktop/aims-agents/logs/biofuel';
const DO_SHEET = '[data-print-paper][data-print-sheet="do"]';
const GROUP_PDF = 'delivery-posts/52e90ba8-bfbd-48b0-bb76-4f9667bf74f1/ec3e660b-14da-463f-a79d-ee054510ceec/DO202611110-signed.pdf';

const APPLY = process.argv.includes('--apply');
const RENDER_ONLY = process.argv.includes('--render-only');
const arg = (n: string) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const EXPECT = arg('expect');
const EXPECT_RUN = arg('expect-run');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');

type Change = { table: string; id: string; organizationId: string; field: string; old: any; new: any };
function must(cond: any, msg: string) {
  if (!cond) throw new Error(`ABORT: ${msg}`);
}

async function render(c: Client): Promise<{ buffer: Buffer } | null> {
  const r = await c.query(
    `select l.token from "DocumentShareLink" l join "Document" d on d.id=l."documentId"
      where l."documentId"=$1 and d."organizationId"=$2 and l."revokedAt" is null and l.token like 'vo\\_%' order by l."createdAt" desc limit 1`,
    [DO_ID, ORG],
  );
  if (!r.rows[0]) return null;
  const buffer = await new PdfGeneratorService().generatePdfFromUrl(`${PORTAL}/guest/do/${r.rows[0].token}`, {
    timeZone: 'Asia/Singapore',
    waitForSelector: DO_SHEET,
    fitToPage: { selector: DO_SHEET, bandMm: 285 },
    timeoutMs: 90_000,
  });
  return { buffer };
}

async function main() {
  const c = new Client({ connectionString: process.env.PROD_DATABASE_URL });
  await c.connect();
  const log: any = { mode: APPLY ? 'apply' : RENDER_ONLY ? 'render-only' : 'dry-run', at: new Date().toISOString(), reason: REASON, changes: [] as Change[] };
  try {
    if (!RENDER_ONLY) {
      await c.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
      const lock = APPLY ? ' for update' : '';
      const doc = (await c.query(`select id,"organizationId",type,name,status,"projectId","projectDeploymentId","updatedAt",config,attachments from "Document" where id=$1${lock}`, [DO_ID])).rows[0];
      const run = (await c.query(`select id,"organizationId","deliveryNumber",status,"customerId","projectId","siteAddress","notes","documentId","updatedAt" from "Delivery" where id=$1${lock}`, [RUN_ID])).rows[0];
      const newProj = (await c.query(`select id,"organizationId",name,"customerId",address from "Project" where id=$1`, [NEW_PROJ])).rows[0];
      const oldProj = (await c.query(`select id,"organizationId",name,"customerId" from "Project" where id=$1`, [OLD_PROJ])).rows[0];
      const dep = (await c.query(`select id,"organizationId","projectId","deploymentNumber",type,status,description,"deployedDate" from "ProjectDeployment" where id=$1${lock}`, [DEP_ID])).rows[0];
      const asg = (await c.query(`select a.id,p."organizationId",a."projectId",a."projectDeploymentId",a."inventoryId",a."assetId",a."documentId",a."endDate" from "Assignment" a join "Project" p on p.id=a."projectId" where a.id=$1${APPLY ? ' for update of a' : ''}`, [ASSIGN_ID])).rows[0];

      for (const [n, r] of Object.entries({ doc, run, newProj, oldProj, dep, asg })) must(r && r.organizationId === ORG, `${n} missing or not Biofuel`);
      must(doc.name === 'DO202611110' && doc.type === 'DELIVERY_ORDER', 'DO identity');
      must(run.deliveryNumber === 114 && run.status === 'completed', 'run identity');
      must(newProj.name === 'Lentor Garden' && newProj.customerId === CQ005, 'Lentor Garden project identity / customer');
      must(oldProj.name === OLD_SITE, 'Woodlands project identity');
      log.doUpdatedAt = new Date(doc.updatedAt).toISOString();
      log.runUpdatedAt = new Date(run.updatedAt).toISOString();
      if (APPLY) {
        must(EXPECT && EXPECT === log.doUpdatedAt, `DO changed since the dry run (now ${log.doUpdatedAt}, expected ${EXPECT})`);
        must(EXPECT_RUN && EXPECT_RUN === log.runUpdatedAt, `run changed since the dry run (now ${log.runUpdatedAt}, expected ${EXPECT_RUN})`);
      }
      const cfg = doc.config;
      must(cfg.customerId === CQ005 && run.customerId === CQ005, 'customer is no longer CQ005');
      must(doc.projectId === OLD_PROJ && run.projectId === OLD_PROJ, 'DO/run project moved');
      must(run.siteAddress === OLD_SITE && cfg.deliveryTo === OLD_SITE, 'site / Delivery To changed');
      must(dep.projectId === OLD_PROJ && dep.status === 'ACTIVE' && asg.projectId === OLD_PROJ && asg.projectDeploymentId === DEP_ID && !asg.endDate, 'rental moved or closed');
      must(!asg.inventoryId && !asg.assetId, 'rental carries a unit; stop');
      const clash = (await c.query(`select id from "ProjectDeployment" where "projectId"=$1 and "deploymentNumber"=$2`, [NEW_PROJ, dep.deploymentNumber])).rows;
      must(clash.length === 0, `Lentor Garden already has deployment #${dep.deploymentNumber}`);
      const recurring = (await c.query(`select id from "RecurringInvoiceTemplate" where "projectDeploymentId"=$1`, [DEP_ID])).rows;
      must(recurring.length === 0, 'recurring invoice linked to the rental; stop');

      const next = JSON.parse(JSON.stringify(cfg));
      const set = (path: string, val: any) => {
        const parts = path.split('.');
        let o = next;
        for (const p of parts.slice(0, -1)) o = o[p];
        const old = o[parts[parts.length - 1]];
        if (JSON.stringify(old) === JSON.stringify(val)) return;
        o[parts[parts.length - 1]] = val;
        log.changes.push({ table: 'Document', id: DO_ID, organizationId: doc.organizationId, field: `config.${path}`, old, new: val });
      };
      set('deliveryTo', SITE);
      set('projectName', 'Lentor Garden');
      if (next.documentInfo && 'projectName' in next.documentInfo) set('documentInfo.projectName', 'Lentor Garden');
      must(JSON.stringify(next.items) === JSON.stringify(cfg.items), 'lines would change');
      must(JSON.stringify(next.customer) === JSON.stringify(cfg.customer) && next.date === cfg.date, 'customer/date would change');
      log.changes.push(
        { table: 'Document', id: DO_ID, organizationId: ORG, field: 'projectId', old: doc.projectId, new: NEW_PROJ },
        { table: 'Delivery', id: RUN_ID, organizationId: ORG, field: 'projectId', old: run.projectId, new: NEW_PROJ },
        { table: 'Delivery', id: RUN_ID, organizationId: ORG, field: 'siteAddress', old: run.siteAddress, new: SITE },
        { table: 'ProjectDeployment', id: DEP_ID, organizationId: ORG, field: 'projectId', old: dep.projectId, new: NEW_PROJ },
        { table: 'Assignment', id: ASSIGN_ID, organizationId: ORG, field: 'projectId', old: asg.projectId, new: NEW_PROJ },
      );

      const inv = (await c.query(`select id,"organizationId",name,status,"projectId","updatedAt",config from "Document" where id=$1`, [INV_ID])).rows[0];
      must(inv?.organizationId === ORG && inv.name === 'BI202611271', 'invoice identity');
      log.context = {
        doBefore: { status: doc.status, projectDeploymentId: doc.projectDeploymentId, attachments: doc.attachments, lines: (cfg.items || []).map((i: any) => `${i.description} x${i.quantity}`) },
        runNotesKept: run.notes,
        signatures: (await c.query(`select id,"organizationId",kind,"signedByName","signedAt",latitude,longitude from "MaintenanceServiceReport" where "deliveryId"=$1 order by "createdAt"`, [RUN_ID])).rows,
        groupPost: (await c.query(`select id,"organizationId",status,"pdfKeys" from "DeliveryGroupPost" where "deliveryId"=$1`, [RUN_ID])).rows,
        rental: { dep, asg },
        oldProjectAfter: (await c.query(`select (select count(*) from "Delivery" where "projectId"=$1)::int-1 runs,(select count(*) from "Document" where "projectId"=$1)::int-1 docs,(select count(*) from "ProjectDeployment" where "projectId"=$1)::int-1 deps`, [OLD_PROJ])).rows[0],
        invoiceImpactOnly: {
          name: inv.name, status: inv.status, projectId: inv.projectId, projectName: inv.config.projectName, deliveryTo: inv.config.deliveryTo,
          total: inv.config.nettTotal, journals: (await c.query(`select "journalNumber",status from "JournalEntry" where "organizationId"=$1 and "sourceDocumentId"::text=$2`, [ORG, INV_ID])).rows,
        },
      };

      if (APPLY) {
        const u = [
          await c.query(`update "Document" set config=$1::jsonb,"projectId"=$2,"updatedAt"=now() where id=$3 and "organizationId"=$4`, [JSON.stringify(next), NEW_PROJ, DO_ID, ORG]),
          await c.query(`update "Delivery" set "projectId"=$1,"siteAddress"=$2,"updatedAt"=now() where id=$3 and "organizationId"=$4`, [NEW_PROJ, SITE, RUN_ID, ORG]),
          await c.query(`update "ProjectDeployment" set "projectId"=$1,"updatedAt"=now() where id=$2 and "organizationId"=$3 and "projectId"=$4`, [NEW_PROJ, DEP_ID, ORG, OLD_PROJ]),
          await c.query(`update "Assignment" set "projectId"=$1 where id=$2 and "projectId"=$3`, [NEW_PROJ, ASSIGN_ID, OLD_PROJ]),
        ];
        must(u.every((r) => r.rowCount === 1), `row counts ${u.map((r) => r.rowCount).join('/')}`);
        const changes = log.changes.map((x: Change) => ({ table: x.table, id: x.id, field: x.field, from: x.old, to: x.new }));
        for (const [resource, rid] of [['documents', DO_ID], ['deliveries', RUN_ID], ['projects', DEP_ID]] as const) {
          await c.query(
            `insert into "ActionLog"(id,"actorType","actorId","actorName","organizationId",channel,action,resource,"resourceId",details,status,"createdAt") values (gen_random_uuid()::text,'SYSTEM',$1,'System creation',$2,'cron','UPDATE',$3,$4,$5::jsonb,'SUCCESS',now())`,
            [ACTOR, ORG, resource, rid, JSON.stringify({ note: `DO202611110 / run #114 site corrected to Lentor Garden: ${REASON}`, changes: changes.filter((x: any) => x.id === rid || (rid === DEP_ID && x.id === ASSIGN_ID)) })],
          );
        }
        await c.query(
          `insert into "AuditLog"(id,"userId","userName",action,resource,"resourceId","resourceName","organizationId",details,status,"createdAt") values (gen_random_uuid()::text,$1,'System creation','EDITED','document',$2,'DO202611110',$3,$4::jsonb,'SUCCESS',now())`,
          [ACTOR, DO_ID, ORG, JSON.stringify({ detail: `Corrected after signing (${REASON}): project and Delivery To ${OLD_SITE} -> Lentor Garden. Customer, lines, quantities, number, signatures and dates unchanged.`, changes })],
        );
        await c.query('COMMIT');
        log.committed = true;
      } else await c.query('ROLLBACK');
    }

    if (APPLY || RENDER_ONLY) {
      const r = await render(c);
      must(r, 'no view-only link on the DO; not creating one from a script');
      const key = `signed-docs/${ORG}/${DO_ID}/DO202611110-signed-corrected-${stamp}.pdf`;
      const s3 = new S3Client({
        region: process.env.AWS_REGION || 'ap-southeast-1',
        credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID!, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY! },
      });
      await s3.send(new PutObjectCommand({ Bucket: process.env.RESOURCE_BUCKET || 'aims-osiris', Key: key, Body: r!.buffer, ContentType: 'application/pdf' }));
      fs.writeFileSync(`${LOGDIR}/DO202611110-signed-corrected-${stamp}.pdf`, r!.buffer);
      await c.query('BEGIN');
      const d = (await c.query(`select attachments from "Document" where id=$1 and "organizationId"=$2 for update`, [DO_ID, ORG])).rows[0];
      must(d, 'DO vanished');
      const att = Array.isArray(d.attachments) ? d.attachments : [];
      const entry = { label: 'Signed DO (corrected)', fileKey: key, fileName: 'DO202611110 signed (corrected).pdf', mimeType: 'application/pdf', uploadedAt: new Date().toISOString(), uploadedBy: ACTOR };
      await c.query(`update "Document" set attachments=$1::jsonb where id=$2 and "organizationId"=$3`, [JSON.stringify([...att, entry]), DO_ID, ORG]);
      await c.query(
        `insert into "ActionLog"(id,"actorType","actorId","actorName","organizationId",channel,action,resource,"resourceId",details,status,"createdAt") values (gen_random_uuid()::text,'SYSTEM',$1,'System creation',$2,'cron','RENDER','documents',$3,$4::jsonb,'SUCCESS',now())`,
        [ACTOR, ORG, DO_ID, JSON.stringify({ note: `Signed DO (corrected) attached: ${REASON}. Group-post PDF kept unchanged.`, fileKey: key, keptGroupPostPdf: GROUP_PDF })],
      );
      await c.query('COMMIT');
      log.corrected = { key, bytes: r!.buffer.length, attachment: entry };
    } else {
      const r = await render(c).catch((e: any) => ({ error: e.message }) as any);
      if (r && r.buffer) {
        const f = `${LOGDIR}/DO202611110-dryrun-current-${stamp}.pdf`;
        fs.writeFileSync(f, r.buffer);
        log.dryRender = { localFile: f, bytes: r.buffer.length, viewOnlyLinkExists: true };
      } else log.dryRender = r ?? { viewOnlyLinkExists: false };
    }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    log.error = (e as Error).message;
    throw e;
  } finally {
    const out = `${LOGDIR}/2026-11-21-do110-${log.mode}-${stamp}.json`;
    fs.writeFileSync(out, JSON.stringify(log, null, 1));
    console.log('log:', out);
    await c.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
