/**
 * WCT (S) Systems (2026-11-13, owner's request): DELETE the owner's TEST runs for
 * the "TEST SiteClock" customer: QO202611-0024 / -0025, ORD202611-007 / -008,
 * DO202611017 / DO202611020, job #7 and Service Report #1 (+ job lines, photos,
 * share / sign links, SiteClock sync rows, notifications). Same approach as
 * delete-wct-test-records.ts: deleted directly, NOT through the app's delete, so
 * every document / order number stays as a gap (counters must not move).
 *
 *   DBURL=<prod> npx ts-node --transpile-only scripts/delete-wct-test-siteclock-runs.ts [--rehearse | --apply --confirm-prod] [--soft-report]
 *
 * Found by customer, then checked against the owner's list: refuses when the
 * TEST SiteClock records are not exactly that set. One transaction. Refuses when
 * a live (non-VOID) journal, a payment or a price history row points at these
 * documents, when anything else still refers to them, or when a stock unit is
 * held by them. Invoices: none exist (the list's invoices step has nothing to do).
 * Job and report numbers have no counter (next = highest + 1), so deleting job #7
 * and report #1 frees those numbers; --soft-report hides report #1 the app's way
 * (serviceData.deletedAt) instead, which keeps its number as a gap.
 * Kept: the customer, the Activity Log (+1 System row per record), AuditLog.
 * --rehearse runs every write and check, then ROLLS BACK.
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Client } from 'pg';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const CUSTOMER = 'TEST SiteClock';
const ORDERS = ['ORD202611-007', 'ORD202611-008'];
const DOCS = ['DO202611017', 'DO202611020', 'QO202611-0024', 'QO202611-0025'];
const JOBS = [7];
const REPORTS = [1];
const EXPECTED = { DELIVERY_ORDER: 21, INVOICE: 12, ORDER: 9, QUOTATION: 26 };
const rehearse = process.argv.includes('--rehearse');
const apply = process.argv.includes('--apply') || rehearse;
const softReport = process.argv.includes('--soft-report');
const same = (a: any[], b: any[]) => JSON.stringify([...a].map(String).sort()) === JSON.stringify([...b].map(String).sort());

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
    const custs = await q(`select id from "Customer" where "organizationId" = $1 and name = $2`, [WCT, CUSTOMER]);
    if (custs.length !== 1) throw new Error(`Expected one "${CUSTOMER}" customer, found ${custs.length}`);
    const cid = custs[0].id;

    // Everything for the TEST customer, then compared with the owner's list.
    const orders = await q(`select id, "orderNumber", status from "Order" where "organizationId" = $1 and "customerId" = $2 order by 2`, [WCT, cid]);
    const orderIds = orders.map((o) => o.id);
    const docs = await q(
      `select id, type, name, status::text from "Document" where "organizationId" = $1 and (config::text ilike $2 or config::text ilike $3 or config->>'orderId' = any($4)) order by type, name`,
      [WCT, `%${cid}%`, `%${CUSTOMER}%`, orderIds],
    );
    const docIds = docs.map((d) => d.id);
    const jobs = await q(
      `select id, "deliveryNumber", status::text from "Delivery" where "organizationId" = $1 and ("customerId" = $2 or "orderId"::text = any($3) or "sourceQuotationId"::text = any($4)) order by 2`,
      [WCT, cid, orderIds, docIds],
    );
    const jobIds = jobs.map((j) => j.id);
    const itemIds = (await q(`select id from "DeliveryItem" where "deliveryId"::text = any($1)`, [jobIds])).map((r) => r.id);
    const reports = await q(
      `select id, "reportNumber" from "MaintenanceServiceReport" where "organizationId" = $1 and ("deliveryId"::text = any($2) or "deliveryItemId"::text = any($3) or "documentId"::text = any($4) or "invoiceDocumentId"::text = any($4) or "serviceData"->>'customerId' = $5 or "serviceData"->>'customerName' = $6) order by 2`,
      [WCT, jobIds, itemIds, docIds, cid, CUSTOMER],
    );
    const msrIds = reports.map((r) => r.id);
    if (!same(orders.map((o) => o.orderNumber), ORDERS) || !same(docs.map((d) => d.name), DOCS) || !same(jobs.map((j) => j.deliveryNumber), JOBS) || !same(reports.map((r) => r.reportNumber), REPORTS))
      throw new Error(`Not the owner's list: orders [${orders.map((o) => o.orderNumber)}], docs [${docs.map((d) => d.name)}], jobs [${jobs.map((j) => j.deliveryNumber)}], reports [${reports.map((r) => r.reportNumber)}]`);

    // Hard stops.
    const liveJe = await n(`select count(*)::int n from "JournalEntry" where "sourceDocumentId"::text = any($1) and status <> 'VOID'`, [docIds]);
    const anyJe = await n(`select count(*)::int n from "JournalEntry" where "sourceDocumentId"::text = any($1)`, [docIds]);
    const pays = await n(`select count(*)::int n from "Payment" where "documentId"::text = any($1)`, [docIds]);
    const prices = await n(`select count(*)::int n from "PriceHistory" where "documentId"::text = any($1)`, [docIds]);
    const otherDocs = await q(`select name from "Document" where "organizationId" = $1 and not (id::text = any($2)) and ("baseDocumentId"::text = any($2) or config->>'sourceDocumentId' = any($2) or config->>'orderId' = any($3) or config->>'orderInvoiceId' = any($2))`, [WCT, docIds, orderIds]);
    const otherJobs = await n(`select count(*)::int n from "Delivery" where "organizationId" = $1 and not (id::text = any($2)) and ("orderId"::text = any($3) or "sourceQuotationId"::text = any($4) or "documentId"::text = any($4))`, [WCT, jobIds, orderIds, docIds]);
    const otherItems = await n(`select count(*)::int n from "DeliveryItem" where not ("deliveryId"::text = any($1)) and "documentId"::text = any($2)`, [jobIds, docIds]);
    const otherOrders = await n(`select count(*)::int n from "Order" where "organizationId" = $1 and not (id::text = any($2)) and ("sourceQuotationId"::text = any($3) or "invoiceDocumentId"::text = any($3))`, [WCT, orderIds, docIds]);
    const otherReports = await n(`select count(*)::int n from "MaintenanceServiceReport" where "organizationId" = $1 and not (id::text = any($2)) and ("documentId"::text = any($3) or "invoiceDocumentId"::text = any($3) or "deliveryId"::text = any($4))`, [WCT, msrIds, docIds, jobIds]);
    const heldUnits = await q(
      `select i.sku, i.status::text from "Inventory" i where i.id in (select "inventoryId" from "DeliveryItem" where "deliveryId"::text = any($1) and "inventoryId" is not null union select "inventoryId" from "DocumentItem" where "documentId"::text = any($2) and "inventoryId" is not null)`,
      [jobIds, docIds],
    );
    if (liveJe || pays || prices) throw new Error(`Refusing: live journals ${liveJe}, payments ${pays}, price history ${prices}`);
    if (otherDocs.length || otherJobs || otherItems || otherOrders || otherReports) throw new Error(`Refusing: still referred to by docs [${otherDocs.map((d) => d.name).join(', ')}], jobs ${otherJobs}, job lines ${otherItems}, orders ${otherOrders}, reports ${otherReports}`);
    if (heldUnits.some((u) => !['instock', 'available'].includes(String(u.status).toLowerCase()))) throw new Error(`Refusing: stock units held by these records: ${heldUnits.map((u) => `${u.sku} ${u.status}`).join(', ')}`);

    const hardMsr = softReport ? [] : msrIds;
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
      setNull: await n(`select (select count(*) from "Assignment" where "documentId"::text = any($1)) + (select count(*) from "TimelineItem" where "documentId"::text = any($1)) + (select count(*) from "Transaction" where "documentId"::text = any($1)) + (select count(*) from "ProjectDeployment" where "sourceDocumentId"::text = any($1)) + (select count(*) from "Lead" where "quotationId"::text = any($1)) as n`, [docIds]),
      activityLogKept: await n(`select count(*)::int n from "ActionLog" where "resourceId"::text = any($1)`, [all]),
      documentHistoryKept: await n(`select count(*)::int n from "AuditLog" where "resourceId"::text = any($1)`, [all]),
    };

    console.log(apply ? (rehearse ? 'REHEARSE (rolled back)' : 'APPLY') : 'DRY-RUN');
    console.log('DELETE');
    for (const d of docs) console.log(`  ${d.type} ${d.name} (${d.status})`);
    for (const o of orders) console.log(`  Order ${o.orderNumber} (${o.status})`);
    for (const j of jobs) console.log(`  Job #${j.deliveryNumber} (${j.status})`);
    for (const r of reports) console.log(`  Service Report #${r.reportNumber} (${softReport ? 'hidden the app way, number kept as a gap' : 'row deleted'})`);
    console.log('  Invoices: none exist for TEST SiteClock');
    console.log('WITH');
    for (const [k, v] of Object.entries(cnt)) if (!['activityLogKept', 'documentHistoryKept', 'setNull'].includes(k)) console.log(`  ${k}: ${v}`);
    console.log(`CHECKS: journals on these docs ${anyJe} (live 0), payments 0, price history 0, other records pointing at them 0, stock units held 0 (${heldUnits.length} linked, all in stock), rows the database would SET NULL ${cnt.setNull}`);
    console.log(`COUNTERS: ${before.filter((r) => r.documentType in EXPECTED).map((r) => `${r.documentType} ${r.nextSerial}`).join(', ')} (must not move)`);
    console.log(`KEPT: customer "${CUSTOMER}", ${cnt.activityLogKept} Activity Log rows (+${all.length} System rows), ${cnt.documentHistoryKept} document-history rows, photo files in storage`);

    if (apply) {
      const now = new Date();
      if (msrIds.length) await c.query(`delete from "ServiceReportSignLink" where "reportIds" && $1::text[]`, [msrIds]);
      if (hardMsr.length) await c.query(`delete from "MaintenanceServiceReport" where id::text = any($1)`, [hardMsr]); // pings cascade
      if (softReport && msrIds.length)
        await c.query(`update "MaintenanceServiceReport" set "serviceData" = coalesce("serviceData", '{}'::jsonb) || jsonb_build_object('deletedAt', $2::text, 'deletedBy', 'system:delete-wct-test-siteclock-runs') where id::text = any($1)`, [msrIds, now.toISOString()]);
      await c.query(`delete from "JobPhoto" where "organizationId" = $1 and "deliveryId"::text = any($2)`, [WCT, jobIds]);
      await c.query(`delete from "DeliverySiteClockJob" where "organizationId" = $1 and "deliveryId"::text = any($2)`, [WCT, jobIds]);
      await c.query(`delete from "DeliveryGroupPost" where "organizationId" = $1 and ("deliveryId"::text = any($2) or "documentIds" && $3::text[])`, [WCT, jobIds, docIds]);
      await c.query(`delete from "DeliveryOpLease" where id::text = any($1)`, [jobIds]);
      await c.query(`delete from "CustomFieldValue" where "entityId"::text = any($1)`, [jobIds]);
      await c.query(`delete from "Notification" where "organizationId" = $1 and "entityId"::text = any($2)`, [WCT, all]);
      await c.query(`delete from "ShortLink" where "organizationId" = $1 and path ilike any($2)`, [WCT, all.map((i) => `%${i}%`)]);
      await c.query(`delete from "Delivery" where "organizationId" = $1 and id::text = any($2)`, [WCT, jobIds]); // items, pings, delivery share links cascade
      await c.query(`delete from "Order" where "organizationId" = $1 and id::text = any($2)`, [WCT, orderIds]);
      await c.query(`delete from "Document" where "organizationId" = $1 and id::text = any($2)`, [WCT, docIds]); // items, embeddings, share / sign links cascade
      const log = async (resource: string, id: string, note: string) =>
        c.query(
          `insert into "ActionLog" (id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status, "createdAt")
           values ($1, 'SYSTEM', 'system:delete-wct-test-siteclock-runs', 'System creation', $2, 'script', 'DELETE', $3, $4, $5, 'SUCCESS', $6)`,
          [randomUUID(), WCT, resource, id, JSON.stringify({ note, numberKeptAsGap: true }), now],
        );
      for (const d of docs) await log('documents', d.id, `TEST ${d.type} ${d.name} deleted (number kept as a gap)`);
      for (const o of orders) await log('orders', o.id, `TEST order ${o.orderNumber} deleted (number kept as a gap)`);
      for (const j of jobs) await log('deliveries', j.id, `TEST job #${j.deliveryNumber} deleted`);
      for (const r of reports) await log('maintenance-reports', r.id, `TEST Service Report #${r.reportNumber} ${softReport ? 'deleted (hidden, number kept as a gap)' : 'deleted'}`);

      const after = await counters();
      if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error('A counter moved: rolled back');
      const left = await n(
        `select (select count(*) from "Document" where id::text = any($1)) + (select count(*) from "Order" where id::text = any($2)) + (select count(*) from "Delivery" where id::text = any($3)) + (select count(*) from "DeliveryItem" where id::text = any($4)) + (select count(*) from "MaintenanceServiceReport" where id::text = any($5)) as n`,
        [docIds, orderIds, jobIds, itemIds, hardMsr],
      );
      if (left) throw new Error(`${left} rows still there: rolled back`);
      const visible = await n(`select count(*)::int n from "MaintenanceServiceReport" where id::text = any($1) and "serviceData"->>'deletedAt' is null`, [msrIds]);
      if (visible) throw new Error('Report still visible: rolled back');
      console.log(`AFTER: counters unchanged; next job #${(await n(`select coalesce(max("deliveryNumber"),0)+1 n from "Delivery" where "organizationId" = $1`, [WCT]))}, next report #${(await n(`select coalesce(max("reportNumber"),0)+1 n from "MaintenanceServiceReport" where "organizationId" = $1`, [WCT]))}`);
      await c.query(rehearse ? 'ROLLBACK' : 'COMMIT');
      console.log(rehearse ? 'Rehearsal OK, rolled back' : 'Committed');
    } else await c.query('ROLLBACK');
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
