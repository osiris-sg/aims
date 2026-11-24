/**
 * WCT group batch 1125 (2026-11-25): DELETE the throwaway TEST records of the documents / calendar checks.
 *   WCT (S): QO202611-0060, QO202611-0061, ORDW202611-011, ORDW202611-012, DO202611043 (signed by link), DO202611044
 *            (confirmed), INV202611-0037 (draft), their jobs / proof rows / sign link, and the TEST Technician Site
 *            Visit note "TEST cal 1125, delete".
 *   BC Air:  QOB202611-0001 + QOB202611-0002 (empty drafts, no customer), the GST-moved ORDB202611-004 with
 *            QOB202611-0003, DOB202611001, INVB202611-0001-1/-2 and job #1, and customer TEST Client CT313 (made by the
 *            move; the WCT (S) TEST Client is never touched), plus the moved blank test PNG and its StoredFile row.
 * Same rules as wct-gst-move-throwaway-cleanup.ts: dry run by default; refuses on anything unlisted or not TEST
 * Client; live journals voided in place (none expected); numbers stay as gaps; Activity Log rows kept + added.
 *
 *   npx ts-node --transpile-only scripts/wct-batch1125-cleanup.ts                         # dry run (read only)
 *   npx ts-node --transpile-only scripts/wct-batch1125-cleanup.ts --apply --confirm-prod    # delete
 */
import 'reflect-metadata';
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { S3Service } from '../src/common/services/s3.service';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const BC = '5c700000-0000-4000-8000-5c7000000004';
const CUSTOMER_NAME = 'TEST Client';
const SCRIPT = 'system:wct-batch1125-cleanup';

type Want = { id: string; org: string; name: string; type?: string };
const DOCS: Want[] = [
  { id: '87fa9b3f-ad11-4cce-833f-5571fcf3e659', org: WCT, type: 'QUOTATION', name: 'QO202611-0060' },
  { id: '75770594-ca5a-4a52-8986-7540c0e5ca53', org: WCT, type: 'QUOTATION', name: 'QO202611-0061' },
  { id: '17834517-3783-42c4-a2e5-dc68d3ec64bc', org: WCT, type: 'DELIVERY_ORDER', name: 'DO202611043' },
  { id: 'a520385f-9081-49c3-9a1c-d312a40a02db', org: WCT, type: 'DELIVERY_ORDER', name: 'DO202611044' },
  { id: '744fa4bd-387c-40b7-b6ab-18f8f731c519', org: WCT, type: 'INVOICE', name: 'INV202611-0037' },
  { id: 'c77bdbcc-8d16-4fff-8e47-f0115e379bae', org: BC, type: 'QUOTATION', name: 'QOB202611-0003' },
  { id: '351357ce-389d-47e4-8c69-40a645c44415', org: BC, type: 'DELIVERY_ORDER', name: 'DOB202611001' },
  { id: '2d4d45a7-135a-491c-88bd-b417975be04f', org: BC, type: 'INVOICE', name: 'INVB202611-0001-1' },
  { id: '7086a143-9aeb-49b8-8bb0-083c261b0fd3', org: BC, type: 'INVOICE', name: 'INVB202611-0001-2' },
  // Empty BC Air drafts with no customer (the numbering check and the Non-GST check).
  { id: 'f0af0dcb-0437-43c9-bd4d-8ba4fe51e957', org: BC, type: 'QUOTATION', name: 'QOB202611-0001' },
  { id: '16092e7a-a11c-4277-bb3a-ed2c604c6a5d', org: BC, type: 'QUOTATION', name: 'QOB202611-0002' },
];
const EMPTY_DRAFTS = new Set(['f0af0dcb-0437-43c9-bd4d-8ba4fe51e957', '16092e7a-a11c-4277-bb3a-ed2c604c6a5d']);
const ORDERS: Want[] = [
  { id: '589ff71d-e8f3-44bf-9c25-54fbc0c5ade5', org: WCT, name: 'ORDW202611-011' },
  { id: '04304042-f702-40e4-8e32-1c50443f171f', org: WCT, name: 'ORDW202611-012' },
  { id: 'e95bbffa-e385-4321-913e-ba8db2ed5343', org: BC, name: 'ORDB202611-004' },
];
// The BC Air TEST Client made by the move (deleted last, only when nothing else uses it).
const NEW_CUSTOMER = { id: '882fe945-a170-4a3f-9cf8-bb539ac563b0', org: BC, code: 'CT313' };
const SUBJECT_MARK = 'TEST docs 1125';
const NOTE = { id: '2a42a39e-c5e0-4c35-849a-74a4588243ad', org: WCT, title: 'TEST cal 1125, delete' };
// The blank test PNG attached to DO202611045 (now DOB202611001); its key holds no record id, so it is listed here.
const EXTRA_S3 = ['org/5c700000-0000-4000-8000-5c7000000001/documents/signed-do/6bd18f77-06c5-4fd2-b8c2-7499d943888f.png'];

const apply = process.argv.includes('--apply');
const confirmProd = process.argv.includes('--confirm-prod');
const KEYISH = /^(?:dev\/)?[a-z0-9-]+\/[^\s"']+\.(?:pdf|png|jpe?g|webp|heic|gif)$/i;
function collectStrings(v: any, out: string[] = []): string[] {
  if (v == null) return out;
  if (typeof v === 'string') {
    const k = v.replace(/^https?:\/\/[^/]+\//, '').split('?')[0];
    if (!v.startsWith('data:') && KEYISH.test(k)) out.push(k);
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
  let committed = false;
  const s3Plan: string[] = [];
  try {
    await c.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');

    // ── the TEST Client of each company ──────────────────────────────────
    const custOf = new Map<string, string>();
    for (const org of [WCT, BC]) {
      const rows = await q(`select id from "Customer" where "organizationId" = $1 and name = $2`, [org, CUSTOMER_NAME]);
      if (rows.length !== 1) throw new Error(`Expected one "${CUSTOMER_NAME}" in ${org}, found ${rows.length}`);
      custOf.set(org, rows[0].id);
    }
    if (custOf.get(BC) !== NEW_CUSTOMER.id) throw new Error('BC Air TEST Client is not the one the move created');

    // ── listed rows, exactly as listed ───────────────────────────────────
    const docIds = DOCS.map((d) => d.id);
    const docs = await q(`select id, "organizationId" org, type::text, name, status::text, "listCustomerId", config->>'customerId' "cfgCustomer", config, attachments from "Document" where id = any($1::uuid[])`, [docIds]);
    for (const w of DOCS) {
      const d = docs.find((x) => x.id === w.id);
      if (!d) throw new Error(`Missing ${w.name} (${w.id})`);
      if (d.org !== w.org || d.name !== w.name || (w.type && d.type !== w.type)) throw new Error(`Refusing: ${w.id} is now ${d.type} ${d.name} in ${d.org} (expected ${w.type} ${w.name} in ${w.org})`);
      const cust = d.config?.customerId || d.config?.customer?.id || d.listCustomerId;
      if (EMPTY_DRAFTS.has(d.id)) {
        const lines = Array.isArray(d.config?.items) ? d.config.items.length : 0;
        if (cust || lines || !['draft', 'unconfirmed'].includes(d.status) || d.config?.orderId) throw new Error(`Refusing: ${d.name} is no longer an empty draft with no customer`);
        continue;
      }
      if (cust !== custOf.get(d.org)) throw new Error(`Refusing: ${d.name} is not on "${CUSTOMER_NAME}"`);
      const subject = String(d.config?.subject ?? d.config?.documentInfo?.subject ?? '');
      if (d.type !== 'DELIVERY_ORDER' && !subject.includes(SUBJECT_MARK)) throw new Error(`Refusing: ${d.name} does not carry the subject "${SUBJECT_MARK}" (has "${subject}")`);
    }
    const orderIds = ORDERS.map((o) => o.id);
    const orders = await q(`select id, "organizationId" org, "orderNumber", "customerId", attachments from "Order" where id = any($1::uuid[])`, [orderIds]);
    for (const w of ORDERS) {
      const o = orders.find((x) => x.id === w.id);
      if (!o || o.org !== w.org || o.orderNumber !== w.name) throw new Error(`Refusing: order ${w.name} is missing or changed`);
      if (o.customerId !== custOf.get(o.org)) throw new Error(`Refusing: ${o.orderNumber} is not on "${CUSTOMER_NAME}"`);
    }
    // Jobs: every job on the listed orders / DOs (found, not listed), each on the TEST Client of its company.
    const jobs = await q(`select id, "organizationId" org, "deliveryNumber", "orderId", "customerId", "siteAddress", "completionPhotos", status::text from "Delivery" where "orderId"::text = any($1) or "documentId"::text = any($2) or "orderInvoiceId"::text = any($2) or id in (select "deliveryId" from "DeliveryItem" where "documentId"::text = any($2))`, [orderIds, docIds]);
    for (const j of jobs) if (j.customerId && j.customerId !== custOf.get(j.org)) throw new Error(`Refusing: job #${j.deliveryNumber} is not on "${CUSTOMER_NAME}"`);
    const jobIds = jobs.map((j) => j.id);
    const noteRows = await q(`select id, "organizationId" org, title from "CalendarNote" where id = $1`, [NOTE.id]);
    if (noteRows.length !== 1 || noteRows[0].org !== NOTE.org || noteRows[0].title !== NOTE.title) throw new Error('Refusing: the TEST note is missing or changed');

    // ── nothing unlisted hangs off them ──────────────────────────────────
    const extraDocs = await q(`select type, name from "Document" where (config->>'orderId' = any($1) or config->>'sourceDocumentId' = any($2) or "baseDocumentId" = any($2::uuid[])) and not (id = any($2::uuid[]))`, [orderIds, docIds]);
    const extraJobs = await q(`select "deliveryNumber" from "Delivery" where ("orderId"::text = any($1) or "documentId"::text = any($2) or "orderInvoiceId"::text = any($3)) and not (id::text = any($4))`, [orderIds, docIds, docIds, jobIds]);
    if (extraDocs.length || extraJobs.length) throw new Error(`Refusing: unlisted records hang off these: docs [${extraDocs.map((r) => `${r.type} ${r.name}`).join(', ')}], jobs [${extraJobs.map((r) => '#' + r.deliveryNumber).join(', ')}]`);

    // ── children ─────────────────────────────────────────────────────────
    const items = await q(`select id, "deliveryId", "documentId", "inventoryId" from "DeliveryItem" where "deliveryId"::text = any($1) or "documentId"::text = any($2)`, [jobIds, docIds]);
    if (items.some((i) => i.inventoryId)) throw new Error('Refusing: a job line holds a stock unit');
    if (items.some((i) => !jobIds.includes(i.deliveryId))) throw new Error('Refusing: lines of other jobs point at these documents');
    const itemIds = items.map((i) => i.id);
    const msrs = await q(`select id, photos, signature, "serviceData" from "MaintenanceServiceReport" where "deliveryId"::text = any($1) or "documentId"::text = any($2) or "invoiceDocumentId"::text = any($2) or "serviceData"->>'orderId' = any($3)`, [jobIds, docIds, orderIds]);
    const msrIds = msrs.map((m) => m.id);
    const cfvs = await q(`select id from "CustomFieldValue" where "entityId"::text = any($1)`, [[...jobIds, ...docIds, ...orderIds]]);
    const allIds = [...docIds, ...orderIds, ...jobIds, ...msrIds];
    const notes = await q(`select id from "Notification" where "entityId"::text = any($1) or "linkUrl" ilike any($2)`, [allIds, allIds.map((i) => `%${i}%`)]);
    const jobPhotos = await q(`select id, "fileKey", "thumbKey" from "JobPhoto" where "deliveryId"::text = any($1)`, [jobIds]);
    const posts = await q(`select id, status from "DeliveryGroupPost" where "deliveryId"::text = any($1) or "documentIds"::text[] && $2::text[]`, [jobIds, docIds]);
    if (posts.some((p) => p.status === 'SENT')) throw new Error('Refusing: a group post about these was sent');
    const payments = await q(`select id, "documentId", amount, "paymentMethod", "receiptId" from "Payment" where "documentId"::text = any($1) or "receiptId"::text = any($1)`, [docIds]);
    const payIds = payments.map((p) => p.id);
    const txns = await q(`select id from "Transaction" where "documentId"::text = any($1) or "paymentId"::text = any($2)`, [docIds, payIds]);
    const journals = await q(`select id, "journalNumber", type, status, "sourceDocumentId", "sourcePaymentId", "organizationId" org from "JournalEntry" where "sourceDocumentId"::text = any($1) or "sourcePaymentId"::text = any($2)`, [docIds, payIds]);
    // Only journals of the listed documents / payments, in their own company.
    for (const j of journals) {
      const d = docs.find((x) => x.id === j.sourceDocumentId);
      if (d && d.org !== j.org) throw new Error(`Refusing: journal ${j.journalNumber} is in another company than ${d.name}`);
    }
    const liveJournals = journals.filter((j) => j.status !== 'VOID');
    const custUse = await q(
      `select 'Document' t, count(*)::int n from "Document" where ("listCustomerId" = $1 or config->>'customerId' = $1 or config#>>'{customer,id}' = $1) and not (id = any($2::uuid[]))
       union all select 'Order', count(*)::int from "Order" where "customerId"::text = $1 and not (id = any($3::uuid[]))
       union all select 'Delivery', count(*)::int from "Delivery" where "customerId"::text = $1 and not (id::text = any($4))`,
      [NEW_CUSTOMER.id, docIds, orderIds, jobIds],
    );
    const custBusy = custUse.filter((r) => r.n > 0);
    const deleteCustomer = custBusy.length === 0;

    // ── full sweep: nothing else may point at what goes ──────────────────
    const deleting = new Map<string, Set<string>>([
      ['Document', new Set(docIds)], ['Order', new Set(orderIds)], ['Delivery', new Set(jobIds)], ['DeliveryItem', new Set(itemIds)],
      ['MaintenanceServiceReport', new Set(msrIds)], ['CustomFieldValue', new Set(cfvs.map((x) => x.id))], ['Notification', new Set(notes.map((x) => x.id))],
      ['CalendarNote', new Set([NOTE.id])], ['DeliveryGroupPost', new Set(posts.map((x) => x.id))], ['JobPhoto', new Set(jobPhotos.map((x) => x.id))], ['Payment', new Set(payIds)], ['Transaction', new Set(txns.map((x) => x.id))],
    ]);
    const targetIds = [...docIds, ...orderIds, ...jobIds, ...itemIds, ...msrIds, ...payIds, NOTE.id];
    const cols = await q(
      `select table_name t, column_name col, udt_name u from information_schema.columns
        where table_schema = 'public' and (column_name ilike '%id' or column_name ilike '%ids')
          and (data_type in ('uuid','text','character varying') or udt_name in ('_text','_uuid'))
          and table_name not in ('ActionLog','AuditLog')`,
    );
    // Deleted with them, cascaded by the database, or kept on purpose (VOID journals stay as the audit trail).
    const allowed = new Set(['DeliveryOpLease.id', 'DeliverySiteClockJob.deliveryId', 'DeliveryShareLink.deliveryId', 'DeliveryShareLink.documentId', 'DocumentShareLink.documentId', 'DocumentSignLink.documentId', 'ServiceReportSignLink.reportIds', 'DeliveryLocationPing.reportId', 'DocumentItem.documentId', 'DocumentEmbedding.documentId', 'JournalEntry.sourceDocumentId', 'JournalEntry.sourcePaymentId', 'JournalEntryLine.journalEntryId']);
    const strays: string[] = [];
    for (const x of cols) {
      if (allowed.has(`${x.t}.${x.col}`)) continue;
      const arr = String(x.u).startsWith('_');
      const own = deleting.get(x.t);
      const rowId = `coalesce(to_jsonb(r)->>'id', r.ctid::text)`;
      await c.query('SAVEPOINT sweep');
      const rows = await q(arr ? `select ${rowId} id from "${x.t}" r where r."${x.col}"::text[] && $1::text[]` : `select ${rowId} id from "${x.t}" r where r."${x.col}"::text = any($1)`, [targetIds]).catch(async (e: any) => {
        await c.query('ROLLBACK TO SAVEPOINT sweep');
        return [{ id: `SWEEP ERROR ${e?.message}` }];
      });
      await c.query('RELEASE SAVEPOINT sweep');
      const left = rows.filter((r) => !own?.has(r.id) && !(x.t === 'Payment' && payIds.includes(r.id)));
      if (left.length) strays.push(`${x.t}.${x.col}: ${left.length} row(s) [${left.slice(0, 5).map((r) => r.id).join(', ')}]`);
    }
    if (strays.length) throw new Error(`Refusing: other rows still point at these records:\n  ${strays.join('\n  ')}`);

    // ── S3 plan ──────────────────────────────────────────────────────────
    const referenced = new Set<string>();
    for (const d of docs) collectStrings([d.attachments, d.config]).forEach((k) => referenced.add(k));
    for (const o of orders) collectStrings(o.attachments).forEach((k) => referenced.add(k));
    for (const j of jobs) collectStrings(j.completionPhotos).forEach((k) => referenced.add(k));
    for (const m of msrs) collectStrings([m.photos, m.signature, m.serviceData]).forEach((k) => referenced.add(k));
    for (const p of jobPhotos) [p.fileKey, p.thumbKey].filter(Boolean).forEach((k) => referenced.add(k));
    const s3 = new S3Service({ get: (k: string, d?: any) => process.env[k] ?? d } as any);
    const client = (s3 as any).s3Client;
    const bucket = (s3 as any).bucketName as string;
    const listed = new Set<string>();
    const prefixes = [
      ...docs.flatMap((d) => [`documents/${d.org}/${d.type}/${d.id}_`, `documents/${d.id}/`, `org/${d.org}/documents/${d.id}`]),
      ...jobs.flatMap((j) => [`deliveries/${j.id}/`, `job-photos/${j.org}/${j.id}/`]),
      ...orders.map((o) => `orders/${o.id}/`),
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
    const kept: string[] = [];
    for (const k of new Set([...referenced, ...listed])) (allIds.some((id) => k.includes(id)) || EXTRA_S3.includes(k) ? s3Plan : kept).push(k);
    for (const k of EXTRA_S3) if (!s3Plan.includes(k)) s3Plan.push(k);
    const storedRows = await q(`select key, "organizationId" from "StoredFile" where key = any($1)`, [s3Plan]).catch(() => [] as any[]);
    s3Plan.sort();

    // ── print ────────────────────────────────────────────────────────────
    const orgName = (o: string) => (o === WCT ? 'WCT (S)' : 'BC Air');
    console.log(`Batch 1125 throwaway cleanup, customer "${CUSTOMER_NAME}": ${apply ? 'APPLY' : 'DRY RUN'}`);
    console.log('VOID journals (in place, the app\'s void; rows kept):');
    for (const j of journals) console.log(`  ${j.journalNumber}  ${j.type} ${j.status}${j.status === 'VOID' ? ' (already void)' : ''}  ${orgName(j.org)}  ${docs.find((d) => d.id === j.sourceDocumentId)?.name ?? ''}${j.sourcePaymentId ? ' payment ' + j.sourcePaymentId : ''}`);
    console.log('DELETE rows:');
    for (const p of payments) console.log(`  Payment                   ${p.id}  ${p.paymentMethod} ${Number(p.amount).toFixed(2)} on ${docs.find((d) => d.id === p.documentId)?.name}`);
    for (const t of txns) console.log(`  Transaction               ${t.id}`);
    for (const d of docs) console.log(`  Document                  ${d.id}  ${orgName(d.org)} ${d.type} ${d.name} (${d.status})`);
    for (const o of orders) console.log(`  Order                     ${o.id}  ${orgName(o.org)} ${o.orderNumber}`);
    for (const j of jobs) console.log(`  Delivery (job)            ${j.id}  ${orgName(j.org)} job #${j.deliveryNumber} (${j.status}, ${j.siteAddress ?? ''})`);
    for (const i of items) console.log(`  DeliveryItem              ${i.id}`);
    for (const m of msrs) console.log(`  MaintenanceServiceReport  ${m.id}`);
    for (const v of cfvs) console.log(`  CustomFieldValue          ${v.id}`);
    for (const p of posts) console.log(`  DeliveryGroupPost         ${p.id} (${p.status})`);
    for (const p of jobPhotos) console.log(`  JobPhoto                  ${p.id}`);
    for (const x of notes) console.log(`  Notification              ${x.id}`);
    console.log(`  CalendarNote              ${NOTE.id}  WCT (S) Technician Site Visit "${NOTE.title}"`);
    for (const r0 of storedRows) console.log(`  StoredFile                ${r0.key}`);
    console.log(deleteCustomer ? `  Customer                  ${NEW_CUSTOMER.id}  BC Air ${CUSTOMER_NAME} ${NEW_CUSTOMER.code} (made by the move)` : `KEEP BC Air ${CUSTOMER_NAME} ${NEW_CUSTOMER.code}: still used by ${custBusy.map((r) => `${r.t} ${r.n}`).join(', ')}`);
    console.log(`S3 objects to delete (bucket ${bucket}): ${s3Plan.length}`);
    for (const k of s3Plan) console.log(`  ${k}${listed.has(k) ? '' : '  (referenced, NOT found in S3)'}`);
    if (kept.length) console.log(`S3 keys referenced but shared (logo / stamp), KEPT: ${kept.length}`);
    console.log(`CHECKS: live journals to void ${liveJournals.length}, payments ${payments.length}, other rows pointing at them 0, WCT (S) TEST Client untouched`);
    const counters = async () => q(`select "organizationId", "documentType", "nextSerial" from "DocumentNumberFormat" where "organizationId" = any($1) order by 1, 2, id`, [[WCT, BC]]);
    const before = await counters();

    if (!apply) {
      await c.query('ROLLBACK');
      console.log('Dry run: nothing written, nothing deleted in S3. --apply --confirm-prod to delete.');
      return;
    }

    // ── apply: one transaction, then S3 ──────────────────────────────────
    const now = new Date();
    for (const j of liveJournals) await c.query(`update "JournalEntry" set status = 'VOID', "voidedAt" = $2, "voidedBy" = $3 where id = $1`, [j.id, now, SCRIPT]);
    await c.query(`delete from "Transaction" where id::text = any($1)`, [txns.map((t) => t.id)]);
    await c.query(`delete from "Payment" where id::text = any($1)`, [payIds]);
    if (msrIds.length) {
      await c.query(`delete from "ServiceReportSignLink" where "reportIds"::text[] && $1::text[]`, [msrIds]);
      await c.query(`delete from "MaintenanceServiceReport" where id::text = any($1)`, [msrIds]);
    }
    await c.query(`delete from "JobPhoto" where "deliveryId"::text = any($1)`, [jobIds]);
    await c.query(`delete from "DeliverySiteClockJob" where "deliveryId"::text = any($1)`, [jobIds]);
    await c.query(`delete from "DeliveryGroupPost" where id::text = any($1)`, [posts.map((p) => p.id)]);
    await c.query(`delete from "DeliveryOpLease" where id::text = any($1)`, [jobIds]);
    await c.query(`delete from "CustomFieldValue" where id::text = any($1)`, [cfvs.map((v) => v.id)]);
    await c.query(`delete from "Notification" where id::text = any($1)`, [notes.map((x) => x.id)]);
    await c.query(`delete from "Delivery" where id::text = any($1)`, [jobIds]);
    await c.query(`delete from "CalendarNote" where id = $1 and "organizationId" = $2`, [NOTE.id, NOTE.org]);
    if (storedRows.length) await c.query(`delete from "StoredFile" where key = any($1)`, [storedRows.map((x: any) => x.key)]);
    await c.query(`delete from "Order" where id::text = any($1)`, [orderIds]);
    await c.query(`delete from "Document" where id::text = any($1)`, [docIds]);
    if (deleteCustomer) {
      await c.query(`delete from "CustomerBalance" where "customerId" = $1`, [NEW_CUSTOMER.id]);
      await c.query(`delete from "Customer" where id = $1 and "organizationId" = $2`, [NEW_CUSTOMER.id, NEW_CUSTOMER.org]);
    }
    const log = (org: string, resource: string, id: string, note: string) =>
      c.query(
        `insert into "ActionLog" (id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status, "createdAt")
         values ($1, 'SYSTEM', $2, 'System creation', $3, 'script', 'DELETE', $4, $5, $6, 'SUCCESS', $7)`,
        [randomUUID(), SCRIPT, org, resource, id, JSON.stringify({ note, numberKeptAsGap: true }), now],
      );
    for (const d of docs) await log(d.org, 'documents', d.id, `TEST throwaway ${d.type} ${d.name} deleted (number kept as a gap)`);
    for (const o of orders) await log(o.org, 'orders', o.id, `TEST throwaway order ${o.orderNumber} deleted (number kept as a gap)`);
    for (const j of jobs) await log(j.org, 'deliveries', j.id, `TEST throwaway job #${j.deliveryNumber} deleted`);
    for (const j of liveJournals) await log(j.org, 'journal', j.id, `TEST throwaway journal ${j.journalNumber} voided`);
    if (deleteCustomer) await log(BC, 'customers', NEW_CUSTOMER.id, `TEST throwaway customer ${NEW_CUSTOMER.code} deleted`);
    await log(NOTE.org, 'calendar-notes', NOTE.id, `TEST throwaway note "${NOTE.title}" deleted`);
    const after = await counters();
    if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error('A numbering counter moved: rolled back');
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
