/**
 * WCT group (2026-11-25, owner: "clean up ALL test data"): DELETE the test records of WCT (S), BC Air, Racking and
 * YMM listed below (by number, resolved and checked at run time). Jobs, lines, proof rows, job fields, notifications
 * and sign links hanging off the listed records are found and deleted with them. Real customers are kept; test
 * customers are kept too (listed only) except BC Air CT313, made by a GST move test.
 * Refuses (changes nothing) when: a listed number is missing or ambiguous; a payment / allocation is on any of them;
 * an unlisted document / job hangs off a listed record; any other row still points at them (full id sweep).
 * Live journals (none expected) are VOIDED in place the app's way. Numbers stay as gaps; Activity Log rows kept, one
 * "System creation" DELETE row added per record.
 *
 *   npx ts-node --transpile-only scripts/wct-group-test-cleanup.ts                         # dry run (read only)
 *   npx ts-node --transpile-only scripts/wct-group-test-cleanup.ts --apply --confirm-prod    # delete
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
const SCRIPT = 'system:wct-group-test-cleanup';

type Want = { id: string; org: string; name: string; type?: string };
const RK = '5c700000-0000-4000-8000-5c7000000002';
const YMM = '5c700000-0000-4000-8000-5c7000000003';
// [org, number, why]
const DOC_LIST: Array<[string, string, string]> = [
  // TEST Client (WCT (S))
  [WCT, 'QO202611-0037', 'TEST Client'], [WCT, 'QO202611-0038', 'TEST Client'], [WCT, 'QO202611-0039', 'TEST Client'],
  [WCT, 'DO202611029', 'TEST Client'], [WCT, 'DO202611030', 'TEST Client'], [WCT, 'INV202611-0022', 'TEST Client'], [WCT, 'INV202611-0023', 'TEST Client'],
  [WCT, 'QO202611-0060', 'TEST Client, batch 1125'], [WCT, 'QO202611-0061', 'TEST Client, batch 1125'], [WCT, 'DO202611043', 'TEST Client, batch 1125'],
  [WCT, 'DO202611044', 'TEST Client, batch 1125'], [WCT, 'INV202611-0037', 'TEST Client, batch 1125'],
  // Owner's tests on Xiao Noodles (the customer stays)
  [WCT, 'QO202611-0059', 'owner test (Xiao Noodles), subject "Test Subject"'], [WCT, 'DO202611042', 'owner test (Xiao Noodles), "Test Loc"'],
  [WCT, 'INV202611-0036-1', 'owner test (Xiao Noodles)'], [WCT, 'INV202611-0036-2', 'owner test (Xiao Noodles)'], [WCT, 'INV202611-0036-3', 'owner test (Xiao Noodles)'],
  // Subject "test subject" on Yoshinoya (the customer stays) and the DO made from it
  [WCT, 'QO202611-0022', 'subject "test subject" (Yoshinoya)'], [WCT, 'DO202611019', 'DO of QO202611-0022 (Yoshinoya)'],
  // BC Air
  [BC, 'QO1202611-001', 'owner test, empty BC Air quotation'], [BC, 'QOB202611-0001', 'numbering check, empty'], [BC, 'QOB202611-0002', 'Non-GST check, empty'],
  [BC, 'QOB202611-0003', 'TEST Client, GST move'], [BC, 'DOB202611001', 'TEST Client, GST move'], [BC, 'INVB202611-0001-1', 'TEST Client, GST move'], [BC, 'INVB202611-0001-2', 'TEST Client, GST move'],
];
const ORDER_LIST: Array<[string, string, string]> = [
  [WCT, 'ORD202611-017', 'TEST Client'], [WCT, 'ORD202611-018', 'TEST Client'], [WCT, 'ORDW202611-010', 'owner test (Xiao Noodles)'],
  [WCT, 'ORDW202611-011', 'TEST Client, batch 1125'], [WCT, 'ORDW202611-012', 'TEST Client, batch 1125'], [WCT, 'ORD202611-005', 'order of QO202611-0022 "test subject"'],
  [BC, 'ORDB202611-004', 'TEST Client, GST move'],
];
// Jobs listed on their own (jobs on the listed orders / documents are found automatically). [org, number, why]
const JOB_LIST: Array<[string, number, string]> = [
  [WCT, 8, 'TEST Client, remarks "Test Remarks"'], [WCT, 9, 'TEST Client, remarks "Test Remark"'],
  [WCT, 21, 'M1 Shop test job, "Elroy" test worker, "+2PT"'], [WCT, 22, 'M1 Shop test job, "Elroy" test worker, "+2PT"'],
];
const NOTE_LIST: Array<[string, string, string]> = [
  [WCT, 'TEST cal 1125, delete', 'title'], [WCT, 'Hello Title', 'staff "TEST STAFF", remarks "Test remarks"'],
];
// The BC Air TEST Client made by the GST move test (deleted last, only when nothing else uses it).
const NEW_CUSTOMER = { id: '882fe945-a170-4a3f-9cf8-bb539ac563b0', org: BC, code: 'CT313' };
const EXTRA_S3 = ['org/5c700000-0000-4000-8000-5c7000000001/documents/signed-do/6bd18f77-06c5-4fd2-b8c2-7499d943888f.png'];
const ORG_NAME: Record<string, string> = { [WCT]: 'WCT (S)', [BC]: 'BC Air', [RK]: 'Racking', [YMM]: 'YMM' };

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

    // ── resolve the listed numbers ───────────────────────────────────────
    const DOCS: Want[] = [];
    const why = new Map<string, string>();
    for (const [org, name, w] of DOC_LIST) {
      const rows = await q(`select id, type::text from "Document" where "organizationId" = $1 and name = $2`, [org, name]);
      if (rows.length !== 1) throw new Error(`Refusing: ${ORG_NAME[org]} ${name}: found ${rows.length}`);
      DOCS.push({ id: rows[0].id, org, name, type: rows[0].type });
      why.set(rows[0].id, w);
    }
    const ORDERS: Want[] = [];
    for (const [org, name, w] of ORDER_LIST) {
      const rows = await q(`select id from "Order" where "organizationId" = $1 and "orderNumber" = $2`, [org, name]);
      if (rows.length !== 1) throw new Error(`Refusing: ${ORG_NAME[org]} order ${name}: found ${rows.length}`);
      ORDERS.push({ id: rows[0].id, org, name });
      why.set(rows[0].id, w);
    }
    const docIds = DOCS.map((d) => d.id);
    const docs = await q(`select id, "organizationId" org, type::text, name, status::text, config, attachments, "createdAt"::date dt,
        coalesce(config#>>'{customer,name}', config->>'customerName', '') cust, coalesce(nullif(config->>'subject',''), config#>>'{documentInfo,subject}', '') subj
        from "Document" where id = any($1::uuid[])`, [docIds]);
    const orderIds = ORDERS.map((o) => o.id);
    const orders = await q(`select o.id, o."organizationId" org, o."orderNumber", o."customerId", o.attachments, cu.name cust from "Order" o left join "Customer" cu on cu.id = o."customerId" where o.id = any($1::uuid[])`, [orderIds]);
    const listedJobIds: string[] = [];
    for (const [org, n, w] of JOB_LIST) {
      const rows = await q(`select id from "Delivery" where "organizationId" = $1 and "deliveryNumber" = $2`, [org, n]);
      if (rows.length !== 1) throw new Error(`Refusing: ${ORG_NAME[org]} job #${n}: found ${rows.length}`);
      listedJobIds.push(rows[0].id);
      why.set(rows[0].id, w);
    }
    const jobs = await q(`select d.id, d."organizationId" org, d."deliveryNumber", d."orderId", d."customerId", d."siteAddress", d."completionPhotos", d.status::text, cu.name cust from "Delivery" d left join "Customer" cu on cu.id = d."customerId"
        where d.id::text = any($3) or d."orderId"::text = any($1) or d."documentId"::text = any($2) or d."orderInvoiceId"::text = any($2) or d.id in (select "deliveryId" from "DeliveryItem" where "documentId"::text = any($2))`, [orderIds, docIds, listedJobIds]);
    const jobIds = jobs.map((j) => j.id);
    const noteRows: any[] = [];
    for (const [org, title, w] of NOTE_LIST) {
      const rows = await q(`select id, "organizationId" org, title, type::text from "CalendarNote" where "organizationId" = $1 and title = $2`, [org, title]);
      if (rows.length !== 1) throw new Error(`Refusing: note "${title}": found ${rows.length}`);
      noteRows.push({ ...rows[0], why: w });
    }
    const noteIds = noteRows.map((n) => n.id);

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
      ['CalendarNote', new Set(noteIds)], ['DeliveryGroupPost', new Set(posts.map((x) => x.id))], ['JobPhoto', new Set(jobPhotos.map((x) => x.id))], ['Payment', new Set(payIds)], ['Transaction', new Set(txns.map((x) => x.id))],
    ]);
    const targetIds = [...docIds, ...orderIds, ...jobIds, ...itemIds, ...msrIds, ...payIds, ...noteIds];
    if (payments.length) throw new Error(`Refusing: payments / allocations on these: ${payments.map((p) => docs.find((d) => d.id === p.documentId)?.name).join(', ')}`);
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
    const orgName = (o: string) => ORG_NAME[o] ?? o;
    console.log(`WCT group test-data cleanup: ${apply ? 'APPLY' : 'DRY RUN'}`);
    console.log('VOID journals (in place, the app\'s void; rows kept):');
    for (const j of journals) console.log(`  ${j.journalNumber}  ${j.type} ${j.status}${j.status === 'VOID' ? ' (already void)' : ''}  ${orgName(j.org)}  ${docs.find((d) => d.id === j.sourceDocumentId)?.name ?? ''}${j.sourcePaymentId ? ' payment ' + j.sourcePaymentId : ''}`);
    console.log('DELETE rows:');
    for (const p of payments) console.log(`  Payment                   ${p.id}  ${p.paymentMethod} ${Number(p.amount).toFixed(2)} on ${docs.find((d) => d.id === p.documentId)?.name}`);
    for (const t of txns) console.log(`  Transaction               ${t.id}`);
    for (const d of [...docs].sort((a, b) => (orgName(a.org) + a.type + a.name).localeCompare(orgName(b.org) + b.type + b.name)))
      console.log(`  Document  ${orgName(d.org).padEnd(7)} ${d.type.padEnd(14)} ${d.name.padEnd(18)} ${String(d.status).padEnd(19)} ${String(d.dt?.toISOString?.() ?? '').slice(0, 10)} | ${String(d.cust || '-').slice(0, 24).padEnd(24)} | ${String(d.subj).slice(0, 34).padEnd(34)} | ${why.get(d.id)}`);
    for (const o of orders) console.log(`  Order     ${orgName(o.org).padEnd(7)} ${o.orderNumber.padEnd(18)} | ${o.cust ?? '-'} | ${why.get(o.id)}`);
    for (const j of jobs) console.log(`  Job       ${orgName(j.org).padEnd(7)} #${j.deliveryNumber} (${j.status}) | ${j.cust ?? '-'} | ${j.siteAddress ?? ''} | ${why.get(j.id) ?? 'on a listed order / document'}`);
    for (const n of noteRows) console.log(`  Note      ${orgName(n.org).padEnd(7)} ${n.type} "${n.title}" | ${n.why}`);
    console.log(`  With them: job lines ${items.length}, proof / service report rows ${msrs.length}, job field values ${cfvs.length}, group posts ${posts.length}, job photos ${jobPhotos.length}, notifications ${notes.length}`);
    for (const r0 of storedRows) console.log(`  StoredFile                ${r0.key}`);
    console.log(deleteCustomer ? `  Customer                  ${NEW_CUSTOMER.id}  BC Air ${CUSTOMER_NAME} ${NEW_CUSTOMER.code} (made by the move)` : `KEEP BC Air ${CUSTOMER_NAME} ${NEW_CUSTOMER.code}: still used by ${custBusy.map((r) => `${r.t} ${r.n}`).join(', ')}`);
    console.log(`S3 objects to delete (bucket ${bucket}): ${s3Plan.length}`);
    for (const k of s3Plan) console.log(`  ${k}${listed.has(k) ? '' : '  (referenced, NOT found in S3)'}`);
    if (kept.length) console.log(`S3 keys referenced but shared (logo / stamp), KEPT: ${kept.length}`);
    console.log(`CHECKS: live journals to void ${liveJournals.length}, payments 0, unlisted documents / jobs hanging off them 0, other rows pointing at them 0. Customers kept (only CT313 goes).`);
    const counters = async () => q(`select "organizationId", "documentType", "nextSerial" from "DocumentNumberFormat" where "organizationId" = any($1) order by 1, 2, id`, [[WCT, BC, RK, YMM]]);
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
    await c.query(`delete from "CalendarNote" where id::text = any($1)`, [noteIds]);
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
    for (const n of noteRows) await log(n.org, 'calendar-notes', n.id, `TEST note "${n.title}" deleted`);
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
