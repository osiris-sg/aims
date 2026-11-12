/**
 * WCT (S) Systems (2026-11-13, owner's request): DELETE the TEST leftovers that
 * cleanup-wct-test-data.ts cancelled: QO202611-0023, ORD202611-004 / -006, jobs
 * #3 #4 #5 #7 (+ items, service-report rows, photos, links, SiteClock sync
 * rows, job-field values) and DO202611012-016. Deleted directly, NOT through
 * the app's delete (which rolls a counter back when the number is the latest):
 * every number stays as a gap. Same approach as INV202611-0011.
 *
 *   DBURL=<prod> npx ts-node --transpile-only scripts/delete-wct-test-records.ts [--rehearse | --apply --confirm-prod]
 *
 * One transaction. Refuses when a live (non-VOID) journal, a payment or a price
 * history row points at these documents, when another document still refers
 * to them, or when the inventory is not exactly the TEST set. Rolls back when a
 * counter moves or JV-000006 is no longer VOID. Kept: the "TEST SiteClock"
 * customer, the Activity Log (one System row added per deleted record) and the
 * document history (AuditLog). SiteClock is not touched (its 3 jobs stay cancelled).
 * Job photo FILES stay in storage; only their rows go. --rehearse runs every
 * write and check, then ROLLS BACK.
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Client } from 'pg';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const ORDERS = ['ORD202611-004', 'ORD202611-006'];
const JOBS = [3, 4, 5, 7];
const DOCS = ['QO202611-0023', 'DO202611012', 'DO202611013', 'DO202611014', 'DO202611015', 'DO202611016'];
// QUOTATION was 24 when the owner asked; QO202611-0024 (the owner's own new test
// quotation for the kept TEST SiteClock customer, not deleted here) made it 25.
const EXPECTED = { DELIVERY_ORDER: 17, INVOICE: 12, ORDER: 7, QUOTATION: 25 };
const rehearse = process.argv.includes('--rehearse');
const apply = process.argv.includes('--apply') || rehearse;

(async () => {
  const url = process.env.DBURL || '';
  if (!url) throw new Error('Pass the database URL inline as DBURL');
  const prodHost = process.env.PROD_DATABASE_URL ? new URL(process.env.PROD_DATABASE_URL).host : '';
  if (apply && !rehearse && new URL(url).host === prodHost && !process.argv.includes('--confirm-prod')) throw new Error('Applying to prod needs --confirm-prod');
  const c = new Client({ connectionString: url });
  await c.connect();
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows;
  const n = async (sql: string, p: any[] = []) => Number((await q(sql, p))[0]?.n ?? 0);
  try {
    await c.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    const counters = async () => q(`select "documentType", "nextSerial" from "DocumentNumberFormat" where "organizationId" = $1 order by 1, id`, [WCT]);
    const before = await counters();
    for (const [t, v] of Object.entries(EXPECTED)) {
      const row = before.find((r) => r.documentType === t);
      if (!row || row.nextSerial !== v) throw new Error(`Counter ${t} is ${row?.nextSerial}, expected ${v}: refusing`);
    }

    const orders = await q(`select id, "orderNumber", status, "customerId" from "Order" where "organizationId" = $1 and "orderNumber"::text = any($2) order by 2`, [WCT, ORDERS]);
    const jobs = await q(`select id, "deliveryNumber", status::text, "orderId" from "Delivery" where "organizationId" = $1 and "deliveryNumber"::text = any($2) and "orderId"::text = any($3) order by 2`, [WCT, JOBS, orders.map((o) => o.id)]);
    const docs = await q(`select id, type, name, status::text, config from "Document" where "organizationId" = $1 and name::text = any($2) order by type, name`, [WCT, DOCS]);
    if (orders.length !== ORDERS.length || jobs.length !== JOBS.length || docs.length !== DOCS.length) throw new Error(`Inventory changed: orders ${orders.length}, jobs ${jobs.length}, docs ${docs.length}`);
    if (orders.some((o) => o.status !== 'CANCELLED') || jobs.some((j) => j.status !== 'cancelled')) throw new Error('Only the cancelled TEST orders / jobs can be deleted');
    if (docs.some((d) => d.config?.testRecord !== true || d.config?.cancelled !== true)) throw new Error('A document is not marked TEST + Cancelled: refusing');
    const testCust = (await q(`select id from "Customer" where "organizationId" = $1 and name = 'TEST SiteClock'`, [WCT]))[0]?.id;
    if (!testCust || orders.some((o) => o.customerId !== testCust)) throw new Error('An order is not for the TEST SiteClock customer: refusing');

    const orderIds = orders.map((o) => o.id);
    const jobIds = jobs.map((j) => j.id);
    const docIds = docs.map((d) => d.id);
    const itemIds = (await q(`select id from "DeliveryItem" where "deliveryId"::text = any($1)`, [jobIds])).map((r) => r.id);
    const reports = await q(`select id from "MaintenanceServiceReport" where "organizationId" = $1 and ("deliveryId"::text = any($2) or "deliveryItemId"::text = any($3) or "documentId"::text = any($4) or "invoiceDocumentId"::text = any($4))`, [WCT, jobIds, itemIds, docIds]);
    const msrIds = reports.map((r) => r.id);

    // Hard stops: ledger and anything else that still points at these records.
    const liveJe = await n(`select count(*)::int n from "JournalEntry" where "sourceDocumentId"::text = any($1) and status <> 'VOID'`, [docIds]);
    const anyJe = await n(`select count(*)::int n from "JournalEntry" where "sourceDocumentId"::text = any($1)`, [docIds]);
    const pays = await n(`select count(*)::int n from "Payment" where "documentId"::text = any($1)`, [docIds]);
    const prices = await n(`select count(*)::int n from "PriceHistory" where "documentId"::text = any($1)`, [docIds]);
    const otherDocs = await q(`select name from "Document" where "organizationId" = $1 and not (id::text = any($2)) and ("baseDocumentId"::text = any($2) or config->>'sourceDocumentId' = any($2) or config->>'orderId' = any($3))`, [WCT, docIds, orderIds]);
    const otherJobs = await n(`select count(*)::int n from "Delivery" where "organizationId" = $1 and not (id::text = any($2)) and ("orderId"::text = any($3) or "sourceQuotationId"::text = any($4) or "documentId"::text = any($4))`, [WCT, jobIds, orderIds, docIds]);
    const otherItems = await n(`select count(*)::int n from "DeliveryItem" where not ("deliveryId"::text = any($1)) and "documentId"::text = any($2)`, [jobIds, docIds]);
    const otherOrders = await n(`select count(*)::int n from "Order" where "organizationId" = $1 and not (id::text = any($2)) and ("sourceQuotationId"::text = any($3) or "invoiceDocumentId"::text = any($3))`, [WCT, orderIds, docIds]);
    const jv6 = (await q(`select status from "JournalEntry" where "organizationId" = $1 and "journalNumber" = 'JV-000006'`, [WCT]))[0]?.status;
    if (liveJe || pays || prices) throw new Error(`Refusing: live journals ${liveJe}, payments ${pays}, price history ${prices}`);
    if (otherDocs.length || otherJobs || otherItems || otherOrders) throw new Error(`Refusing: still referred to by docs [${otherDocs.map((d) => d.name).join(', ')}], jobs ${otherJobs}, job lines ${otherItems}, orders ${otherOrders}`);
    if (jv6 !== 'VOID') throw new Error(`JV-000006 is ${jv6}, not VOID: refusing`);

    // What goes with them (counts per table).
    const all = [...docIds, ...jobIds, ...orderIds, ...msrIds];
    const cnt = {
      jobItems: itemIds.length,
      serviceReports: msrIds.length,
      locationPings: await n(`select count(*)::int n from "DeliveryLocationPing" where "reportId"::text = any($1)`, [msrIds]),
      reportSignLinks: await n(`select count(*)::int n from "ServiceReportSignLink" where "reportIds" && $1::text[]`, [msrIds]),
      jobPhotos: await n(`select count(*)::int n from "JobPhoto" where "organizationId" = $1 and "deliveryId"::text = any($2)`, [WCT, jobIds]),
      siteclockSyncRows: await n(`select count(*)::int n from "DeliverySiteClockJob" where "organizationId" = $1 and "deliveryId"::text = any($2)`, [WCT, jobIds]),
      groupPosts: await n(`select count(*)::int n from "DeliveryGroupPost" where "organizationId" = $1 and ("deliveryId"::text = any($2) or "documentIds" && $3::text[])`, [WCT, jobIds, docIds]),
      runLeases: await n(`select count(*)::int n from "DeliveryOpLease" where id::text = any($1)`, [jobIds]),
      jobFieldValues: await n(`select count(*)::int n from "CustomFieldValue" where "entityId"::text = any($1)`, [jobIds]),
      deliveryShareLinks: await n(`select count(*)::int n from "DeliveryShareLink" where "deliveryId"::text = any($1) or "documentId"::text = any($2)`, [jobIds, docIds]),
      documentShareLinks: await n(`select count(*)::int n from "DocumentShareLink" where "documentId"::text = any($1)`, [docIds]),
      documentSignLinks: await n(`select count(*)::int n from "DocumentSignLink" where "documentId"::text = any($1)`, [docIds]),
      documentItems: await n(`select count(*)::int n from "DocumentItem" where "documentId"::text = any($1)`, [docIds]),
      documentEmbeddings: await n(`select count(*)::int n from "DocumentEmbedding" where "documentId"::text = any($1)`, [docIds]),
      notifications: await n(`select count(*)::int n from "Notification" where "organizationId" = $1 and "entityId"::text = any($2)`, [WCT, all]),
      shortLinks: await n(`select count(*)::int n from "ShortLink" where "organizationId" = $1 and path ilike any($2)`, [WCT, all.map((i) => `%${i}%`)]),
      // SET NULL by the database (should be 0): assignments, timeline items, transactions, deployments.
      setNull: await n(`select (select count(*) from "Assignment" where "documentId"::text = any($1)) + (select count(*) from "TimelineItem" where "documentId"::text = any($1)) + (select count(*) from "Transaction" where "documentId"::text = any($1)) + (select count(*) from "ProjectDeployment" where "sourceDocumentId"::text = any($1)) + (select count(*) from "Lead" where "quotationId"::text = any($1)) as n`, [docIds]),
      voidJournalsLeft: anyJe,
      activityLogKept: await n(`select count(*)::int n from "ActionLog" where "resourceId"::text = any($1)`, [all]),
      documentHistoryKept: await n(`select count(*)::int n from "AuditLog" where "resourceId"::text = any($1)`, [all]),
    };

    console.log('DELETE');
    for (const d of docs) console.log(`  ${d.type} ${d.name} (${d.status}, Cancelled TEST)`);
    for (const o of orders) console.log(`  Order ${o.orderNumber} (${o.status})`);
    for (const j of jobs) console.log(`  Job #${j.deliveryNumber} (${j.status})`);
    console.log('WITH');
    for (const [k, v] of Object.entries(cnt)) if (!['voidJournalsLeft', 'activityLogKept', 'documentHistoryKept', 'setNull'].includes(k)) console.log(`  ${k}: ${v}`);
    console.log(`CHECKS: live journals 0, payments 0, price history 0, other records pointing at them 0, rows the database would SET NULL ${cnt.setNull}, JV-000006 ${jv6}, void journals on these docs ${cnt.voidJournalsLeft}`);
    console.log(`KEPT: customer "TEST SiteClock", ${cnt.activityLogKept} Activity Log rows (+${docs.length + orders.length + jobs.length} System rows), ${cnt.documentHistoryKept} document-history rows, SiteClock untouched, photo files in storage`);

    if (apply) {
      const now = new Date();
      const placeholders = all;
      if (msrIds.length) {
        await c.query(`delete from "ServiceReportSignLink" where "reportIds" && $1::text[]`, [msrIds]);
        await c.query(`delete from "MaintenanceServiceReport" where id::text = any($1)`, [msrIds]); // pings cascade
      }
      await c.query(`delete from "JobPhoto" where "organizationId" = $1 and "deliveryId"::text = any($2)`, [WCT, jobIds]);
      await c.query(`delete from "DeliverySiteClockJob" where "organizationId" = $1 and "deliveryId"::text = any($2)`, [WCT, jobIds]);
      await c.query(`delete from "DeliveryGroupPost" where "organizationId" = $1 and ("deliveryId"::text = any($2) or "documentIds" && $3::text[])`, [WCT, jobIds, docIds]);
      await c.query(`delete from "DeliveryOpLease" where id::text = any($1)`, [jobIds]);
      await c.query(`delete from "CustomFieldValue" where "entityId"::text = any($1)`, [jobIds]);
      await c.query(`delete from "Notification" where "organizationId" = $1 and "entityId"::text = any($2)`, [WCT, placeholders]);
      await c.query(`delete from "ShortLink" where "organizationId" = $1 and path ilike any($2)`, [WCT, placeholders.map((i) => `%${i}%`)]);
      await c.query(`delete from "Delivery" where "organizationId" = $1 and id::text = any($2)`, [WCT, jobIds]); // items + delivery share links cascade
      await c.query(`delete from "Order" where "organizationId" = $1 and id::text = any($2)`, [WCT, orderIds]);
      await c.query(`delete from "Document" where "organizationId" = $1 and id::text = any($2)`, [WCT, docIds]); // items, embeddings, share / sign links cascade
      const log = async (resource: string, id: string, note: string) =>
        c.query(
          `insert into "ActionLog" (id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status, "createdAt")
           values ($1, 'SYSTEM', 'system:delete-wct-test-records', 'System creation', $2, 'script', 'DELETE', $3, $4, $5, 'SUCCESS', $6)`,
          [randomUUID(), WCT, resource, id, JSON.stringify({ note, numberKeptAsGap: true }), now],
        );
      for (const d of docs) await log('documents', d.id, `TEST ${d.type} ${d.name} deleted (number kept as a gap)`);
      for (const o of orders) await log('orders', o.id, `TEST order ${o.orderNumber} deleted (number kept as a gap)`);
      for (const j of jobs) await log('deliveries', j.id, `TEST job #${j.deliveryNumber} deleted`);

      const after = await counters();
      if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error('A counter moved: rolled back');
      const jv6After = (await q(`select status from "JournalEntry" where "organizationId" = $1 and "journalNumber" = 'JV-000006'`, [WCT]))[0]?.status;
      if (jv6After !== 'VOID') throw new Error('JV-000006 changed: rolled back');
      const left = await n(
        `select (select count(*) from "Document" where id::text = any($1)) + (select count(*) from "Order" where id::text = any($2)) + (select count(*) from "Delivery" where id::text = any($3)) + (select count(*) from "DeliveryItem" where id::text = any($4)) as n`,
        [docIds, orderIds, jobIds, itemIds],
      );
      if (left) throw new Error(`${left} row(s) still there: rolled back`);
      if (rehearse) {
        await c.query('ROLLBACK');
        console.log('Rehearsal passed (all rows gone inside the transaction, counters and JV-000006 unchanged); ROLLED BACK, nothing kept.');
      } else {
        await c.query('COMMIT');
        console.log('Applied.');
      }
    } else {
      await c.query('ROLLBACK');
      console.log('Dry run. Nothing was written. --rehearse to test the writes, --apply --confirm-prod to apply.');
    }
    console.log(`COUNTERS: ${before.filter((x) => x.documentType in EXPECTED).map((x) => `${x.documentType} ${x.nextSerial}`).join(', ')} (must read the same after)`);
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
