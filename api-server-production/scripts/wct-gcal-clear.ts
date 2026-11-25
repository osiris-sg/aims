/**
 * WCT group Google Calendar import, STEP 2 (owner 2026-11-25): CLEAR the group calendar before the import.
 * DELETES every job (Delivery) and every calendar note (CalendarNote) of WCT (S), BC Air, Racking and YMM, with what
 * hangs off a job, and every repeating series (CalendarSeries + exceptions) of those orgs: job lines (DeliveryItem), proof rows (DO_START / DO_ACK / DO_INSTALL reports and their sign links),
 * job field values (CustomFieldValue: calendar style, category, job fields, gcal import ids), job notifications,
 * share links, op leases and unsent group posts.
 *
 * KEPT, never touched: quotations, orders, DOs, invoices and every other Document, service reports (kind SERVICE: the
 * database sets their job pointer to null), payments, journals, customers, workers, public holidays (FieldPublicHoliday),
 * job photos and files in S3, SiteClock sync rows (DeliverySiteClockJob) and attendance rows (FieldJob): listed only.
 * Numbering counters are checked unchanged. One "System creation" Activity Log row per org with the counts.
 *
 *   npx ts-node --transpile-only scripts/wct-gcal-clear.ts                         # dry run (read only)
 *   npx ts-node --transpile-only scripts/wct-gcal-clear.ts --apply --confirm-prod    # delete
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Client, defaults as pgDefaults } from 'pg';

// Prisma timestamps are UTC without a zone: send Dates as UTC (node-pg would send Singapore time).
(pgDefaults as any).parseInputDatesAsUTC = true;

const ORGS: Record<string, string> = {
  '5c700000-0000-4000-8000-5c7000000001': 'WCT (S)',
  '5c700000-0000-4000-8000-5c7000000002': 'Racking',
  '5c700000-0000-4000-8000-5c7000000003': 'YMM',
  '5c700000-0000-4000-8000-5c7000000004': 'BC Air',
};
const ORG_IDS = Object.keys(ORGS);
const SCRIPT = 'system:wct-gcal-clear';
const PROOF_KINDS = ['DO_START', 'DO_ACK', 'DO_INSTALL'];

const apply = process.argv.includes('--apply');
const confirmProd = process.argv.includes('--confirm-prod');

(async () => {
  const url = process.env.PROD_DATABASE_URL || '';
  if (!url) throw new Error('PROD_DATABASE_URL is not set in .env');
  if (apply && !confirmProd) throw new Error('Deleting on prod needs --apply --confirm-prod');
  const c = new Client({ connectionString: url });
  await c.connect();
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows;
  let committed = false;
  try {
    await c.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    const jobs = await q(
      `select d.id::text id, d."organizationId" org, d."deliveryNumber" n, d.status::text status, d."scheduledFor" at, d."orderId"::text "orderId", cu.name cust, d."siteAddress" site
         from "Delivery" d left join "Customer" cu on cu.id = d."customerId" where d."organizationId" = any($1) order by d."organizationId", d."deliveryNumber"`,
      [ORG_IDS],
    );
    const jobIds = jobs.map((j) => j.id);
    const notes = await q(`select id, "organizationId" org, type, title, "startDate" s, "endDate" e from "CalendarNote" where "organizationId" = any($1) order by "organizationId", "startDate"`, [ORG_IDS]);
    const noteIds = notes.map((n) => n.id);
    // Repeating jobs / notes (2026-11-25): their series and exceptions go with the jobs and notes they draw from.
    const seriesRows = await q(`select id from "CalendarSeries" where "organizationId" = any($1)`, [ORG_IDS]).catch(() => [] as any[]);
    const seriesExc = await q(`select id from "CalendarSeriesException" where "organizationId" = any($1)`, [ORG_IDS]).catch(() => [] as any[]);
    const items = await q(`select id::text id, "inventoryId" inv from "DeliveryItem" where "deliveryId"::text = any($1)`, [jobIds]);
    if (items.some((i) => i.inv)) throw new Error(`Refusing: ${items.filter((i) => i.inv).length} job line(s) hold a stock unit`);
    const reports = await q(`select id::text id, kind::text kind from "MaintenanceServiceReport" where "deliveryId"::text = any($1)`, [jobIds]);
    const proofIds = reports.filter((r) => PROOF_KINDS.includes(r.kind)).map((r) => r.id);
    const serviceKept = reports.length - proofIds.length;
    const signLinks = proofIds.length ? await q(`select id, "reportIds" from "ServiceReportSignLink" where "reportIds"::text[] && $1::text[]`, [proofIds]) : [];
    // A sign link that also covers a kept service report would lose it: refuse.
    for (const s of signLinks) if ((s.reportIds as string[]).some((r) => !proofIds.includes(r))) throw new Error(`Refusing: sign link ${s.id} also covers a kept report`);
    const cfvs = await q(`select id from "CustomFieldValue" where "entityId" = any($1)`, [[...jobIds, ...noteIds]]);
    const notifs = jobIds.length
      ? await q(`select n.id from "Notification" n where n."organizationId" = any($2) and (n."entityId" = any($1) or exists (select 1 from unnest($1::text[]) x where n."linkUrl" like '%' || x || '%'))`, [[...jobIds, ...proofIds], ORG_IDS])
      : [];
    const posts = await q(`select id::text id, status from "DeliveryGroupPost" where "deliveryId"::text = any($1)`, [jobIds]);
    const postsDel = posts.filter((p) => p.status !== 'SENT');
    const shareLinks = await q(`select id from "DeliveryShareLink" where "deliveryId"::text = any($1)`, [jobIds]);
    const leases = await q(`select id from "DeliveryOpLease" where id::text = any($1)`, [jobIds]).catch(() => [] as any[]);
    const pings = proofIds.length ? await q(`select id::text id from "DeliveryLocationPing" where "reportId"::text = any($1)`, [proofIds]) : [];
    const scJobs = await q(`select id, "workerId", "siteclockJobId", "lastPushedStatus" from "DeliverySiteClockJob" where "deliveryId" = any($1)`, [jobIds]);
    const fieldJobs = await q(`select id from "FieldJob" where "deliveryId" = any($1)`, [jobIds]);
    const photos = await q(`select id from "JobPhoto" where "deliveryId" = any($1)`, [jobIds]);

    // Full sweep: every other *id column that points at a job / note / proof row, so nothing is missed silently.
    const deleting = new Map<string, Set<string>>([
      ['Delivery', new Set(jobIds)], ['CalendarNote', new Set(noteIds)], ['DeliveryItem', new Set(items.map((i) => i.id))],
      ['MaintenanceServiceReport', new Set(proofIds)], ['CustomFieldValue', new Set(cfvs.map((x) => x.id))], ['Notification', new Set(notifs.map((x) => x.id))],
      ['DeliveryGroupPost', new Set(postsDel.map((x) => x.id))], ['DeliveryShareLink', new Set(shareLinks.map((x) => x.id))], ['DeliveryOpLease', new Set(leases.map((x) => x.id))],
      ['ServiceReportSignLink', new Set(signLinks.map((x) => x.id))], ['DeliveryLocationPing', new Set(pings.map((x) => x.id))],
      ['CalendarSeries', new Set(seriesRows.map((x) => x.id))], ['CalendarSeriesException', new Set(seriesExc.map((x) => x.id))],
    ]);
    // Kept on purpose (listed): the service reports' job pointer is set to null by the database; history rows.
    const keptOk = new Set(['MaintenanceServiceReport.deliveryId', 'DeliverySiteClockJob.deliveryId', 'FieldJob.deliveryId', 'JobPhoto.deliveryId', 'DeliveryGroupPost.deliveryId', 'DeliveryLocationPing.deliveryId', 'Delivery.id']);
    const cols = await q(
      `select table_name t, column_name col, udt_name u from information_schema.columns
        where table_schema = 'public' and (column_name ilike '%id' or column_name ilike '%ids')
          and (data_type in ('uuid','text','character varying') or udt_name in ('_text','_uuid'))
          and table_name not in ('ActionLog','AuditLog')`,
    );
    const targetIds = [...jobIds, ...noteIds, ...proofIds];
    const strays: string[] = [];
    const keptRefs: string[] = [];
    for (const x of cols) {
      if (x.col === 'id' || x.col === 'organizationId') continue;
      const arr = String(x.u).startsWith('_');
      const own = deleting.get(x.t);
      await c.query('SAVEPOINT sweep');
      const rows = await q(
        arr ? `select coalesce(to_jsonb(r)->>'id', r.ctid::text) id from "${x.t}" r where r."${x.col}"::text[] && $1::text[]` : `select coalesce(to_jsonb(r)->>'id', r.ctid::text) id from "${x.t}" r where r."${x.col}"::text = any($1)`,
        [targetIds],
      ).catch(async (e: any) => {
        await c.query('ROLLBACK TO SAVEPOINT sweep');
        return [{ id: `SWEEP ERROR ${e?.message}` }];
      });
      await c.query('RELEASE SAVEPOINT sweep');
      const left = rows.filter((r) => !own?.has(r.id));
      if (!left.length) continue;
      const line = `${x.t}.${x.col}: ${left.length} row(s)`;
      (keptOk.has(`${x.t}.${x.col}`) ? keptRefs : strays).push(line);
    }
    if (strays.length) throw new Error(`Refusing: other rows still point at jobs / notes:\n  ${strays.join('\n  ')}`);

    const counters = async () => q(`select "organizationId", "documentType", "nextSerial" from "DocumentNumberFormat" where "organizationId" = any($1) order by 1, 2, id`, [ORG_IDS]);
    // Guard (owner 2026-11-25): no quotation / order / DO / invoice / service report / customer may go.
    const kept = async () =>
      (await q(
        `select (select count(*) from "Document" where "organizationId" = any($1))::int docs, (select count(*) from "Order" where "organizationId" = any($1))::int orders,
                (select count(*) from "Customer" where "organizationId" = any($1))::int customers, (select count(*) from "MaintenanceServiceReport" where "organizationId" = any($1) and kind::text = 'SERVICE')::int reports,
                (select count(*) from "FieldPublicHoliday" where "organizationId" = any($1))::int holidays`,
        [ORG_IDS],
      ))[0];
    const keptBefore = await kept();
    const before = await counters();

    // ── print ──
    console.log(`WCT group calendar CLEAR: ${apply ? 'APPLY' : 'DRY RUN'}  (${new Date().toISOString()})`);
    console.log('Per company:');
    for (const org of ORG_IDS) {
      const js = jobs.filter((j) => j.org === org);
      const ns = notes.filter((n) => n.org === org);
      const st: Record<string, number> = {};
      js.forEach((j) => (st[j.status] = (st[j.status] || 0) + 1));
      const nt: Record<string, number> = {};
      ns.forEach((n) => (nt[n.type] = (nt[n.type] || 0) + 1));
      console.log(`  ${ORGS[org].padEnd(8)} jobs ${String(js.length).padStart(5)} (${Object.entries(st).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}; on an order ${js.filter((j) => j.orderId).length})   notes ${String(ns.length).padStart(4)} (${Object.entries(nt).map(([k, v]) => `${k} ${v}`).join(', ') || '-'})`);
    }
    console.log(`Repeating series ${seriesRows.length}, series exceptions ${seriesExc.length}`);
    console.log(`With the jobs: job lines ${items.length}, proof rows ${proofIds.length}, proof sign links ${signLinks.length}, proof location pings ${pings.length}, field values ${cfvs.length}, notifications ${notifs.length}, share links ${shareLinks.length}, op leases ${leases.length}, unsent group posts ${postsDel.length}`);
    console.log(`KEPT: service reports on these jobs ${serviceKept} (job pointer set to null), sent group posts ${posts.length - postsDel.length}, job photos ${photos.length}, SiteClock sync rows ${scJobs.length} (${scJobs.filter((s) => s.siteclockJobId && s.workerId).length} live in SiteClock: NOT cancelled there), attendance rows ${fieldJobs.length}`);
    if (keptRefs.length) console.log(`  kept rows that point at a deleted job: ${keptRefs.join('; ')}`);
    console.log('Samples (first 8 per company):');
    for (const org of ORG_IDS) {
      for (const j of jobs.filter((x) => x.org === org).slice(0, 8))
        console.log(`  ${ORGS[org].padEnd(8)} job #${j.n} ${j.status} ${j.at ? new Date(j.at).toISOString().slice(0, 16) : '-'} | ${String(j.cust ?? '-').slice(0, 30)} | ${String(j.site ?? '').slice(0, 40)}`);
      for (const n of notes.filter((x) => x.org === org).slice(0, 4)) console.log(`  ${ORGS[org].padEnd(8)} note ${n.type} ${n.s}..${n.e} | ${String(n.title).slice(0, 60)}`);
    }

    console.log(`GUARD: documents (quotations, DOs, invoices...) ${keptBefore.docs}, orders ${keptBefore.orders}, customers ${keptBefore.customers}, service reports ${keptBefore.reports}, public holidays ${keptBefore.holidays}: none of them is deleted (the script has no delete on those tables; checked again after the deletes, before commit).`);
    if (!apply) {
      await c.query('ROLLBACK');
      console.log('Dry run: nothing written. --apply --confirm-prod to delete.');
      return;
    }

    if (signLinks.length) await c.query(`delete from "ServiceReportSignLink" where id::text = any($1)`, [signLinks.map((s) => String(s.id))]);
    if (pings.length) await c.query(`delete from "DeliveryLocationPing" where id::text = any($1)`, [pings.map((x) => x.id)]);
    if (proofIds.length) await c.query(`delete from "MaintenanceServiceReport" where id::text = any($1)`, [proofIds]);
    await c.query(`delete from "DeliveryGroupPost" where id::text = any($1)`, [postsDel.map((p) => p.id)]);
    await c.query(`delete from "DeliveryOpLease" where id::text = any($1)`, [jobIds]).catch(() => undefined);
    await c.query(`delete from "DeliveryShareLink" where "deliveryId"::text = any($1)`, [jobIds]);
    await c.query(`delete from "CustomFieldValue" where id = any($1)`, [cfvs.map((v) => v.id)]);
    await c.query(`delete from "Notification" where id = any($1)`, [notifs.map((x) => x.id)]);
    await c.query(`delete from "DeliveryItem" where "deliveryId"::text = any($1)`, [jobIds]);
    if (seriesExc.length) await c.query(`delete from "CalendarSeriesException" where "organizationId" = any($1)`, [ORG_IDS]);
    if (seriesRows.length) await c.query(`delete from "CalendarSeries" where "organizationId" = any($1)`, [ORG_IDS]);
    const dj = await c.query(`delete from "Delivery" where id::text = any($1) and "organizationId" = any($2)`, [jobIds, ORG_IDS]);
    const dn = await c.query(`delete from "CalendarNote" where id = any($1) and "organizationId" = any($2)`, [noteIds, ORG_IDS]);
    if (dj.rowCount !== jobIds.length || dn.rowCount !== noteIds.length) throw new Error('Row count changed while deleting: rolled back');
    const now = new Date();
    for (const org of ORG_IDS) {
      await c.query(
        `insert into "ActionLog" (id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status, "createdAt")
         values ($1, 'SYSTEM', $2, 'System creation', $3, 'script', 'DELETE', 'deliveries', null, $4, 'SUCCESS', $5)`,
        [randomUUID(), SCRIPT, org, JSON.stringify({ note: 'Calendar cleared before the Google Calendar import', jobs: jobs.filter((j) => j.org === org).length, notes: notes.filter((n) => n.org === org).length }), now],
      );
    }
    const after = await counters();
    if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error('A numbering counter moved: rolled back');
    const keptAfter = await kept();
    if (JSON.stringify(keptAfter) !== JSON.stringify(keptBefore)) throw new Error(`Refusing: documents / orders / customers / service reports / holidays changed (${JSON.stringify(keptBefore)} -> ${JSON.stringify(keptAfter)}): rolled back`);
    await c.query('COMMIT');
    committed = true;
    console.log(`Database: committed. Deleted jobs ${dj.rowCount}, notes ${dn.rowCount}.`);
  } catch (e) {
    if (!committed) await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
