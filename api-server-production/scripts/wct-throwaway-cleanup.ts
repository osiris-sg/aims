/**
 * WCT (S) Systems (2026-11-24, owner approved): DELETE the throwaway TEST records
 * made on prod for the "Complete job" checks, on customer "TEST Client" only:
 *
 *   run 1 (earlier agent): QO202611-0050, ORDW202611-004, DO202611037, job #21
 *   run 2 (24 Nov):        QO202611-0051, ORDW202611-005, DO202611038, job #22
 *
 * plus everything hanging off them: job lines (DeliveryItem), proof / service
 * report rows (MaintenanceServiceReport: DO_ACK, SERVICE draft, ...), job-field
 * values (CustomFieldValue of the jobs), WhatsApp group-post rows of the jobs
 * (SKIPPED / never sent), bell notifications pointing at them, run leases,
 * share / sign links, and the S3 objects that belong to them.
 *
 * Deleted directly, NOT through the app's delete (which rolls a numbering counter
 * back when the number is the latest): every number stays as a gap and the
 * script checks that no counter moved. KEPT: the Activity Log (ActionLog; one
 * "System creation" row is ADDED per deleted record), the document history
 * (AuditLog) and the TEST Client customer.
 *
 *   npx ts-node --transpile-only scripts/wct-throwaway-cleanup.ts                       # dry run (read only)
 *   npx ts-node --transpile-only scripts/wct-throwaway-cleanup.ts --apply --confirm-prod  # delete
 *
 * Reads PROD_DATABASE_URL (and the AWS keys for S3) from .env; never prints them.
 *
 * Refuses (changes nothing) when:
 *   - a listed number is missing, or there are more/fewer rows than listed;
 *   - a record is not on customer "TEST Client" of WCT (S);
 *   - a job / DO / document is linked to the listed orders but is NOT listed
 *     (something new hangs off them: list it first);
 *   - ANY JournalEntry with a non-VOID status points at these documents (the DB
 *     guard aims_doc_delete_guard forbids it; never drop the trigger: void first);
 *   - a payment, price-history row, stock unit or any other row in the database
 *     (full id-column sweep, logs excepted) still points at a record being deleted.
 *
 * S3: deletes only keys that CONTAIN the id of a record being deleted (the
 * signed-DO uploads, report photos, job photos, group-post PDFs, the generated
 * document PDFs documents/<org>/<TYPE>/<docId>_<ts>.pdf). Keys referenced by the
 * rows that do not carry such an id (the org logo / stamp on a DO's config) are
 * shared and are never deleted. S3 goes AFTER the database commit, through the
 * app's own S3Service (bucket + credentials from .env).
 */
import 'reflect-metadata';
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { S3Service } from '../src/common/services/s3.service';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const CUSTOMER_NAME = 'TEST Client';
const QUOTATIONS = ['QO202611-0050', 'QO202611-0051'];
const ORDERS = ['ORDW202611-004', 'ORDW202611-005'];
const DOS = ['DO202611037', 'DO202611038'];
// Job number -> its order (a job number is only unique per org + its order here).
const JOBS: Array<{ n: number; order: string }> = [
  { n: 21, order: 'ORDW202611-004' },
  { n: 22, order: 'ORDW202611-005' },
];
const SCRIPT = 'system:wct-throwaway-cleanup';

const apply = process.argv.includes('--apply');
const confirmProd = process.argv.includes('--confirm-prod');

const KEYISH = /^(?:dev\/)?[a-z0-9-]+\/[^\s"']+\.(?:pdf|png|jpe?g|webp|heic|gif)$/i;

function collectStrings(v: any, out: string[] = []): string[] {
  if (v == null) return out;
  if (typeof v === 'string') {
    if (!v.startsWith('data:') && KEYISH.test(v.replace(/^https?:\/\/[^/]+\//, ''))) out.push(v.replace(/^https?:\/\/[^/]+\//, '').split('?')[0]);
    return out;
  }
  if (Array.isArray(v)) v.forEach((x) => collectStrings(x, out));
  else if (typeof v === 'object') Object.values(v).forEach((x) => collectStrings(x, out));
  return out;
}

(async () => {
  const url = process.env.PROD_DATABASE_URL || '';
  if (!url) throw new Error('PROD_DATABASE_URL is not set in .env');
  if (apply && !confirmProd) throw new Error('Deleting on prod needs --apply --confirm-prod');
  const c = new Client({ connectionString: url });
  await c.connect();
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows;
  const n = async (sql: string, p: any[] = []) => Number((await q(sql, p))[0]?.n ?? 0);
  let committed = false;
  const s3Plan: string[] = [];
  const s3Kept: string[] = [];
  try {
    await c.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');

    // ── inventory ────────────────────────────────────────────────────────
    const cust = await q(`select id from "Customer" where "organizationId" = $1 and name = $2`, [WCT, CUSTOMER_NAME]);
    if (cust.length !== 1) throw new Error(`Expected exactly one "${CUSTOMER_NAME}" customer in WCT (S), found ${cust.length}`);
    const custId: string = cust[0].id;

    const docs = await q(
      `select id, type, name, status::text, "listCustomerId", config->>'customerId' "cfgCustomer", config->>'orderId' "orderId", attachments, config
         from "Document" where "organizationId" = $1 and name = any($2) order by type, name`,
      [WCT, [...QUOTATIONS, ...DOS]],
    );
    const orders = await q(
      `select id, "orderNumber", status, "customerId", "sourceQuotationId", "invoiceDocumentId", attachments
         from "Order" where "organizationId" = $1 and "orderNumber" = any($2) order by 2`,
      [WCT, ORDERS],
    );
    if (docs.length !== QUOTATIONS.length + DOS.length) throw new Error(`Documents: found ${docs.map((d) => d.name).join(', ')}; expected ${[...QUOTATIONS, ...DOS].join(', ')}`);
    if (orders.length !== ORDERS.length) throw new Error(`Orders: found ${orders.map((o) => o.orderNumber).join(', ')}; expected ${ORDERS.join(', ')}`);
    const orderByNo = new Map<string, any>(orders.map((o) => [o.orderNumber, o]));
    const jobs: any[] = [];
    for (const j of JOBS) {
      const rows = await q(
        `select id, "deliveryNumber", status::text, "orderId", "customerId", "documentId", "sourceQuotationId", "completionPhotos", "orderInvoiceId"
           from "Delivery" where "organizationId" = $1 and "deliveryNumber" = $2 and "orderId" = $3`,
        [WCT, j.n, orderByNo.get(j.order)!.id],
      );
      if (rows.length !== 1) throw new Error(`Job #${j.n} on ${j.order}: found ${rows.length} rows`);
      jobs.push({ ...rows[0], orderNumber: j.order });
    }

    // Everything on the listed orders must be listed (nothing new hangs off them).
    const orderIds = orders.map((o) => o.id);
    const docIds = docs.map((d) => d.id);
    const jobIds = jobs.map((j) => j.id);
    const extraJobs = await q(`select "deliveryNumber" from "Delivery" where "organizationId" = $1 and ("orderId" = any($2::uuid[]) or "sourceQuotationId" = any($3::uuid[]) or "documentId" = any($3::uuid[])) and not (id = any($4::uuid[]))`, [WCT, orderIds, docIds, jobIds]);
    const extraDocs = await q(`select type, name from "Document" where "organizationId" = $1 and (config->>'orderId' = any($2) or config->>'sourceDocumentId' = any($3) or "baseDocumentId" = any($3::uuid[])) and not (id = any($3::uuid[]))`, [WCT, orderIds, docIds]);
    const extraOrders = await q(`select "orderNumber" from "Order" where "organizationId" = $1 and ("sourceQuotationId" = any($2::uuid[]) or "invoiceDocumentId" = any($2::uuid[])) and not (id = any($3::uuid[]))`, [WCT, docIds, orderIds]);
    if (extraJobs.length || extraDocs.length || extraOrders.length || orders.some((o) => o.invoiceDocumentId) || jobs.some((j) => j.orderInvoiceId))
      throw new Error(`Refusing: unlisted records hang off these: jobs [${extraJobs.map((r) => '#' + r.deliveryNumber).join(', ')}], docs [${extraDocs.map((r) => `${r.type} ${r.name}`).join(', ')}], orders [${extraOrders.map((r) => r.orderNumber).join(', ')}], order invoice ${orders.map((o) => o.invoiceDocumentId).filter(Boolean).join(', ') || '-'}`);

    // Customer: every record on TEST Client.
    const badCust = [
      ...docs.filter((d) => d.listCustomerId !== custId && d.cfgCustomer !== custId).map((d) => d.name),
      ...orders.filter((o) => o.customerId !== custId).map((o) => o.orderNumber),
      ...jobs.filter((j) => j.customerId !== custId).map((j) => `job #${j.deliveryNumber}`),
    ];
    if (badCust.length) throw new Error(`Refusing: not on customer "${CUSTOMER_NAME}": ${badCust.join(', ')}`);
    // The DOs must belong to the listed orders; the orders to the listed quotations.
    for (const d of docs.filter((x) => x.type === 'DELIVERY_ORDER')) if (!orderIds.includes(d.orderId)) throw new Error(`Refusing: ${d.name} is not on a listed order`);
    for (const o of orders) if (!docIds.includes(o.sourceQuotationId)) throw new Error(`Refusing: ${o.orderNumber} comes from an unlisted quotation`);

    // Children.
    const items = await q(`select id, "deliveryId", "documentId", "inventoryId", "assetId", description from "DeliveryItem" where "deliveryId" = any($1::uuid[]) or "documentId" = any($2::uuid[])`, [jobIds, docIds]);
    const foreignItems = items.filter((i) => !jobIds.includes(i.deliveryId));
    if (foreignItems.length) throw new Error(`Refusing: ${foreignItems.length} line(s) of other jobs point at these DOs`);
    if (items.some((i) => i.inventoryId)) throw new Error('Refusing: a job line holds a stock unit (inventory would need releasing first)');
    const itemIds = items.map((i) => i.id);
    const msrs = await q(
      `select id, kind::text, status::text, "reportNumber", "deliveryId", "documentId", photos, signature, "serviceData"
         from "MaintenanceServiceReport" where "organizationId" = $1 and ("deliveryId" = any($2::uuid[]) or "deliveryItemId" = any($3::uuid[]) or "documentId" = any($4::uuid[]) or "invoiceDocumentId" = any($4::uuid[]))`,
      [WCT, jobIds, itemIds, docIds],
    );
    const msrIds = msrs.map((m) => m.id);
    const cfvs = await q(`select id, "entityId", "entityType" from "CustomFieldValue" where "entityId"::text = any($1)`, [[...jobIds, ...docIds, ...orderIds]]);
    const allIds: string[] = [...docIds, ...orderIds, ...jobIds, ...msrIds];
    const notes = await q(
      `select id, "entityId", "linkUrl" from "Notification" where "organizationId" = $1 and ("entityId"::text = any($2) or "linkUrl" ilike any($3))`,
      [WCT, allIds, allIds.map((i) => `%${i}%`)],
    );
    const posts = await q(`select id, status, "pdfKeys", "photoKeys" from "DeliveryGroupPost" where "organizationId" = $1 and ("deliveryId"::text = any($2) or "documentIds"::text[] && $3::text[])`, [WCT, jobIds, docIds]);
        const sentPosts = posts.filter((p) => p.status === 'SENT');
    const jobPhotos = await q(`select id, "fileKey", "thumbKey" from "JobPhoto" where "organizationId" = $1 and "deliveryId"::text = any($2)`, [WCT, jobIds]);
    const counts: Record<string, number> = {
      DeliveryOpLease: await n(`select count(*)::int n from "DeliveryOpLease" where id::text = any($1)`, [jobIds]),
      DeliverySiteClockJob: await n(`select count(*)::int n from "DeliverySiteClockJob" where "organizationId" = $1 and "deliveryId"::text = any($2)`, [WCT, jobIds]),
      DeliveryShareLink: await n(`select count(*)::int n from "DeliveryShareLink" where "deliveryId" = any($1::uuid[]) or "documentId" = any($2::uuid[])`, [jobIds, docIds]),
      DocumentShareLink: await n(`select count(*)::int n from "DocumentShareLink" where "documentId" = any($1::uuid[])`, [docIds]),
      DocumentSignLink: await n(`select count(*)::int n from "DocumentSignLink" where "documentId" = any($1::uuid[])`, [docIds]),
      ServiceReportSignLink: await n(`select count(*)::int n from "ServiceReportSignLink" where "reportIds"::text[] && $1::text[]`, [msrIds]),
      DeliveryLocationPing: await n(`select count(*)::int n from "DeliveryLocationPing" where "reportId"::text = any($1)`, [msrIds]),
      DocumentItem: await n(`select count(*)::int n from "DocumentItem" where "documentId" = any($1::uuid[])`, [docIds]),
      DocumentEmbedding: await n(`select count(*)::int n from "DocumentEmbedding" where "documentId" = any($1::uuid[])`, [docIds]),
    };

    // ── hard stops: ledger + money ───────────────────────────────────────
    const journals = await q(`select "journalNumber", status::text, type::text, "sourceDocumentId" from "JournalEntry" where "sourceDocumentId"::text = any($1)`, [docIds]);
    const liveJournals = journals.filter((j) => j.status !== 'VOID');
    if (liveJournals.length) throw new Error(`STOP: live journal(s) on these documents: ${liveJournals.map((j) => `${j.journalNumber} (${j.status})`).join(', ')}. Void them in the app first; never drop aims_doc_delete_guard.`);
    const pays = await n(`select count(*)::int n from "Payment" where "documentId" = any($1::uuid[])`, [docIds]);
    const prices = await n(`select count(*)::int n from "PriceHistory" where "documentId" = any($1::uuid[])`, [docIds]);
    if (pays || prices) throw new Error(`STOP: payments ${pays}, price history ${prices} on these documents`);

    // ── full sweep: nothing else in the database may point at what goes ──
    const deleting = new Map<string, Set<string>>([
      ['Document', new Set(docIds)], ['Order', new Set(orderIds)], ['Delivery', new Set(jobIds)], ['DeliveryItem', new Set(itemIds)],
      ['MaintenanceServiceReport', new Set(msrIds)], ['CustomFieldValue', new Set(cfvs.map((x) => x.id))], ['Notification', new Set(notes.map((x) => x.id))],
      ['DeliveryGroupPost', new Set(posts.map((x) => x.id))], ['JobPhoto', new Set(jobPhotos.map((x) => x.id))],
    ]);
    const targetIds = [...docIds, ...orderIds, ...jobIds, ...itemIds, ...msrIds];
    const cols = await q(
      `select table_name t, column_name col, udt_name u from information_schema.columns
        where table_schema = 'public' and (column_name ilike '%id' or column_name ilike '%ids')
          and (data_type in ('uuid','text','character varying') or udt_name in ('_text','_uuid'))
          and table_name not in ('ActionLog','AuditLog')`,
    );
    // Rows the plan already deletes or the database cascades / sets null with them.
    const cascades = new Set(['DeliveryOpLease.id', 'DeliverySiteClockJob.deliveryId', 'DeliveryShareLink.deliveryId', 'DeliveryShareLink.documentId', 'DocumentShareLink.documentId', 'DocumentSignLink.documentId', 'ServiceReportSignLink.reportIds', 'DeliveryLocationPing.reportId', 'DocumentItem.documentId', 'DocumentEmbedding.documentId', 'JournalEntry.sourceDocumentId']);
    const strays: string[] = [];
    for (const x of cols) {
      if (cascades.has(`${x.t}.${x.col}`)) continue;
      const arr = String(x.u).startsWith('_');
      const own = deleting.get(x.t);
      const rowId = `coalesce(to_jsonb(r)->>'id', r.ctid::text)`;
      await c.query('SAVEPOINT sweep');
      const rows = await q(
        arr ? `select ${rowId} id from "${x.t}" r where r."${x.col}"::text[] && $1::text[]` : `select ${rowId} id from "${x.t}" r where r."${x.col}"::text = any($1)`,
        [targetIds],
      ).catch(async (e: any) => {
        await c.query('ROLLBACK TO SAVEPOINT sweep');
        return [{ id: `SWEEP ERROR ${e?.message}` }];
      });
      await c.query('RELEASE SAVEPOINT sweep');
      const left = rows.filter((r) => !own?.has(r.id));
      if (left.length) strays.push(`${x.t}.${x.col}: ${left.length} row(s) [${left.slice(0, 5).map((r) => r.id).join(', ')}]`);
    }
    if (strays.length) throw new Error(`Refusing: other rows still point at these records:\n  ${strays.join('\n  ')}`);

    // ── S3 plan ──────────────────────────────────────────────────────────
    const owned = (k: string) => allIds.some((id) => k.includes(id)) || posts.some((p) => k.includes(p.id)) || jobPhotos.some((p) => k === p.fileKey || k === p.thumbKey);
    const referenced = new Set<string>();
    for (const d of docs) collectStrings([d.attachments, d.config]).forEach((k) => referenced.add(k));
    for (const o of orders) collectStrings(o.attachments).forEach((k) => referenced.add(k));
    for (const j of jobs) collectStrings(j.completionPhotos).forEach((k) => referenced.add(k));
    for (const m of msrs) collectStrings([m.photos, m.signature, m.serviceData]).forEach((k) => referenced.add(k));
    for (const p of posts) collectStrings([p.pdfKeys, p.photoKeys]).forEach((k) => referenced.add(k));
    for (const p of jobPhotos) [p.fileKey, p.thumbKey].filter(Boolean).forEach((k) => referenced.add(k));
    const s3 = new S3Service({ get: (k: string, d?: any) => process.env[k] ?? d } as any);
    const client = (s3 as any).s3Client;
    const bucket = (s3 as any).bucketName as string;
    const listed = new Set<string>();
    const prefixes = [
      ...docs.map((d) => `documents/${WCT}/${d.type}/${d.id}_`), // generated PDFs (S3Service.uploadPdf)
      ...docs.map((d) => `documents/${d.id}/`), // DO signed-do uploads, document attachments
      ...jobs.map((j) => `deliveries/${j.id}/`), // job signed-do uploads
      ...orders.map((o) => `orders/${o.id}/`), // order attachments
      ...jobs.flatMap((j) => [`job-photos/${WCT}/${j.id}/`, `dev/job-photos/${WCT}/${j.id}/`]),
      ...posts.map((p) => `delivery-posts/${WCT}/${p.id}/`),
      ...msrs.map((m) => `maintenance-reports/${m.id}/`),
    ];
    for (const prefix of prefixes) {
      let token: string | undefined;
      do {
        const out: any = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
        for (const o of out.Contents || []) listed.add(o.Key);
        token = out.IsTruncated ? out.NextContinuationToken : undefined;
      } while (token);
    }
    for (const k of new Set([...referenced, ...listed])) (owned(k) ? s3Plan : s3Kept).push(k);
    s3Plan.sort();

    // ── print ────────────────────────────────────────────────────────────
    console.log(`WCT (S) throwaway cleanup: customer "${CUSTOMER_NAME}" (${custId}) — ${apply ? 'APPLY' : 'DRY RUN'}`);
    console.log('DELETE rows (table, id, number):');
    for (const d of docs) console.log(`  Document                  ${d.id}  ${d.type} ${d.name} (${d.status})`);
    for (const o of orders) console.log(`  Order                     ${o.id}  ${o.orderNumber} (${o.status})`);
    for (const j of jobs) console.log(`  Delivery (job)            ${j.id}  job #${j.deliveryNumber} on ${j.orderNumber} (${j.status})`);
    for (const i of items) console.log(`  DeliveryItem              ${i.id}  line of job #${jobs.find((j) => j.id === i.deliveryId)?.deliveryNumber} "${i.description ?? ''}" (DO ${docs.find((d) => d.id === i.documentId)?.name ?? '-'})`);
    for (const m of msrs) console.log(`  MaintenanceServiceReport  ${m.id}  ${m.kind} ${m.status}${m.reportNumber ? ' ' + m.reportNumber : ''} (job #${jobs.find((j) => j.id === m.deliveryId)?.deliveryNumber ?? '-'}, DO ${docs.find((d) => d.id === m.documentId)?.name ?? '-'})`);
    for (const v of cfvs) console.log(`  CustomFieldValue          ${v.id}  ${v.entityType} job #${jobs.find((j) => j.id === v.entityId)?.deliveryNumber ?? v.entityId}`);
    for (const p of posts) console.log(`  DeliveryGroupPost         ${p.id}  ${p.status} (never sent)`);
    for (const p of jobPhotos) console.log(`  JobPhoto                  ${p.id}`);
    for (const x of notes) console.log(`  Notification              ${x.id}  -> ${x.linkUrl ?? x.entityId}`);
    console.log('WITH (database cascades): ' + Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', '));
    console.log(`S3 objects to delete (bucket ${bucket}): ${s3Plan.length}`);
    for (const k of s3Plan) console.log(`  ${k}${listed.has(k) ? '' : '  (referenced by a row, NOT found in S3)'}`);
    if (s3Kept.length) {
      console.log(`S3 keys referenced but shared (org logo / stamp etc.), KEPT: ${s3Kept.length}`);
      for (const k of s3Kept) console.log(`  ${k}`);
    }
    console.log(`CHECKS: journals on these docs ${journals.length} (live 0), payments 0, price history 0, stock units 0, sent group posts ${sentPosts.length}, other rows pointing at them 0`);
    const kept = await n(`select count(*)::int n from "ActionLog" where "resourceId"::text = any($1)`, [allIds]);
    const hist = await n(`select count(*)::int n from "AuditLog" where "resourceId"::text = any($1)`, [allIds]);
    console.log(`KEPT: customer "${CUSTOMER_NAME}", ${kept} Activity Log rows (+${docs.length + orders.length + jobs.length} System rows on apply), ${hist} document-history rows; numbers stay as gaps`);

    const counters = async () => q(`select "documentType", "nextSerial" from "DocumentNumberFormat" where "organizationId" = $1 order by 1, id`, [WCT]);
    const before = await counters();

    if (!apply) {
      await c.query('ROLLBACK');
      console.log('Dry run: nothing written, nothing deleted in S3. --apply --confirm-prod to delete.');
      return;
    }

    // ── apply: one transaction, then S3 ──────────────────────────────────
    if (msrIds.length) {
      await c.query(`delete from "ServiceReportSignLink" where "reportIds"::text[] && $1::text[]`, [msrIds]);
      await c.query(`delete from "MaintenanceServiceReport" where id = any($1::uuid[])`, [msrIds]); // pings cascade
    }
    await c.query(`delete from "JobPhoto" where "organizationId" = $1 and "deliveryId"::text = any($2)`, [WCT, jobIds]);
    await c.query(`delete from "DeliverySiteClockJob" where "organizationId" = $1 and "deliveryId"::text = any($2)`, [WCT, jobIds]);
    await c.query(`delete from "DeliveryGroupPost" where id::text = any($1)`, [posts.map((p) => p.id)]);
    await c.query(`delete from "DeliveryOpLease" where id::text = any($1)`, [jobIds]);
    await c.query(`delete from "CustomFieldValue" where id::text = any($1)`, [cfvs.map((v) => v.id)]);
    await c.query(`delete from "Notification" where id::text = any($1)`, [notes.map((x) => x.id)]);
    await c.query(`delete from "Delivery" where "organizationId" = $1 and id = any($2::uuid[])`, [WCT, jobIds]); // items + delivery share links cascade
    await c.query(`delete from "Order" where "organizationId" = $1 and id = any($2::uuid[])`, [WCT, orderIds]);
    await c.query(`delete from "Document" where "organizationId" = $1 and id = any($2::uuid[])`, [WCT, docIds]); // items, embeddings, share / sign links cascade
    const now = new Date();
    const log = (resource: string, id: string, note: string) =>
      c.query(
        `insert into "ActionLog" (id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status, "createdAt")
         values ($1, 'SYSTEM', $2, 'System creation', $3, 'script', 'DELETE', $4, $5, $6, 'SUCCESS', $7)`,
        [randomUUID(), SCRIPT, WCT, resource, id, JSON.stringify({ note, numberKeptAsGap: true, s3Keys: s3Plan.filter((k) => k.includes(id)) }), now],
      );
    for (const d of docs) await log('documents', d.id, `TEST throwaway ${d.type} ${d.name} deleted (number kept as a gap)`);
    for (const o of orders) await log('orders', o.id, `TEST throwaway order ${o.orderNumber} deleted (number kept as a gap)`);
    for (const j of jobs) await log('deliveries', j.id, `TEST throwaway job #${j.deliveryNumber} deleted`);
    const after = await counters();
    if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error('A numbering counter moved: rolled back');
    const left = await n(
      `select (select count(*) from "Document" where id = any($1::uuid[])) + (select count(*) from "Order" where id = any($2::uuid[])) + (select count(*) from "Delivery" where id = any($3::uuid[])) + (select count(*) from "DeliveryItem" where id = any($4::uuid[])) + (select count(*) from "MaintenanceServiceReport" where id = any($5::uuid[])) as n`,
      [docIds, orderIds, jobIds, itemIds, msrIds],
    );
    if (left) throw new Error(`${left} row(s) still there: rolled back`);
    await c.query('COMMIT');
    committed = true;
    console.log('Database: committed.');
    let ok = 0;
    for (const k of s3Plan) {
      try {
        await s3.deleteFile(k);
        ok++;
      } catch (e: any) {
        console.log(`  S3 delete failed for ${k}: ${e?.message}`);
      }
    }
    console.log(`S3: deleted ${ok} of ${s3Plan.length}.`);
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
