/**
 * WCT (S) UAT 25 Nov 2026: DELETE every record the UAT made on "TEST Client" (subjects "UAT 1125, delete"), incl. the
 * BC Air customer CT313 the GST switch round trip made again, the service reports, the DO sign-off rows and the
 * uploaded test files (signed DO image, report PDF / photo) with their StoredFile rows. Same engine and refusals as
 * wct-group-test-cleanup.ts. Dry run by default.
 *
 *   npx ts-node --transpile-only scripts/wct-uat1125-cleanup.ts                         # dry run (read only)
 *   npx ts-node --transpile-only scripts/wct-uat1125-cleanup.ts --apply --confirm-prod    # delete
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
const SCRIPT = 'system:wct-uat1125-cleanup';

type Want = { id: string; org: string; name: string; type?: string };
const RK = '5c700000-0000-4000-8000-5c7000000002';
const WITH_YOSHINOYA = false;
// Payments allowed only on these (owner: void the payment's journal and the invoice's journal, then delete).
const PAYMENT_OK = new Set<string>();
// Test customers deleted once nothing links to them (owner 25 Nov); WCT (S) "TEST Client" stays as THE throwaway customer.
const CUSTOMER_LIST: Array<[string, string | null, string]> = [[BC, 'CT313', 'TEST Client']];
// Hidden (active = false), never deleted: it syncs from SiteClock (owner 25 Nov).
const HIDE_WORKERS: Array<[string, string]> = [];
const YMM = '5c700000-0000-4000-8000-5c7000000003';
// [org, number, why]
const DOC_LIST: Array<[string, string, string]> = [
  [WCT, 'QO202611-0067', 'UAT 1125 (was QO202611-0066 / QOB202611-0004)'],
  [WCT, 'DO202611052', 'UAT 1125 (empty DO from the all-on-a-DO check)'], [WCT, 'DO202611053', 'UAT 1125 (confirmed)'], [WCT, 'DO202611054', 'UAT 1125 (signed by link)'],
  [WCT, 'INV202611-0040-1', 'UAT 1125 split part 1 (draft)'], [WCT, 'INV202611-0040-2', 'UAT 1125 split part 2 (draft)'],
];
const ORDER_LIST: Array<[string, string, string]> = [[WCT, 'ORDW202611-017', 'UAT 1125 (was ORDW202611-016 / ORDB202611-005)']];
const JOB_LIST: Array<[string, number, string]> = [
  [WCT, 16, 'UAT 1125 calendar job "UAT 1125 Calendar Shop, delete"'], [WCT, 17, 'UAT 1125 postponed record of job #18'],
];
const NOTE_LIST: Array<[string, string, string]> = [];
// The BC Air TEST Client made by the GST move test (deleted last, only when nothing else uses it).

const EXTRA_S3: string[] = [];
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
    const custRows: any[] = [];
    for (const [org, code, name] of CUSTOMER_LIST) {
      const rows = await q(`select id, "organizationId" org, name, "customerCode" code from "Customer" where "organizationId" = $1 and name = $2 and coalesce("customerCode",'') = $3`, [org, name, code ?? '']);
      if (rows.length === 1) custRows.push(rows[0]);
      else console.log(`  (customer ${ORG_NAME[org]} ${code} "${name}": found ${rows.length}, skipped)`);
    }
    const custKeep: Array<{ c: any; why: string }> = [];
    const custDelete: any[] = [];
    for (const cu of custRows) {
      const use = await q(
        `select 'Document' t, count(*)::int n from "Document" where ("listCustomerId"::text = $1 or config->>'customerId' = $1 or config#>>'{customer,id}' = $1) and not (id = any($2::uuid[]))
         union all select 'Order', count(*)::int from "Order" where "customerId"::text = $1 and not (id = any($3::uuid[]))
         union all select 'Delivery', count(*)::int from "Delivery" where "customerId"::text = $1 and not (id::text = any($4))
         union all select 'Payment', count(*)::int from "Payment" where "customerId"::text = $1 and not (id::text = any($5))`,
        [cu.id, docIds, orderIds, jobIds, payIds],
      );
      const busy = use.filter((x) => x.n > 0);
      if (busy.length) custKeep.push({ c: cu, why: busy.map((x) => `${x.t} ${x.n}`).join(', ') });
      else custDelete.push(cu);
    }
    const workerRows: any[] = [];
    for (const [org, name] of HIDE_WORKERS) workerRows.push(...(await q(`select id, "organizationId" org, name, active from "Worker" where "organizationId" = $1 and name = $2`, [org, name])));
    // DO202611026 / any listed DO: no stock moved (no unit on its lines, no deduction stamp).
    const stockDos = await q(`select d.name from "Document" d where d.id = any($1::uuid[]) and d.type::text = 'DELIVERY_ORDER' and (d.config ? 'deductedAt' or exists (select 1 from "DeliveryItem" i where i."documentId" = d.id and i."inventoryId" is not null))`, [docIds]);
    if (stockDos.length) throw new Error(`Refusing: stock moved on ${stockDos.map((x) => x.name).join(', ')}`);
    // Ledger effect of the voids: every account the voided journals touch, balance before vs after (posted only).
    const voidIds = liveJournals.map((j) => j.id);
    const effect = voidIds.length
      ? await q(`select a.id, a.code, a.name, j."organizationId" org, sum(l.debit - l.credit)::numeric(14,2) net from "JournalEntryLine" l join "JournalEntry" j on j.id = l."journalEntryId" join "ChartOfAccount" a on a.id = l."accountId"
          where j.id::text = any($1) group by a.id, a.code, a.name, j."organizationId" order by a.code`, [voidIds])
      : [];
    for (const e of effect) {
      const b = await q(`select coalesce(sum(l.debit - l.credit),0)::numeric(14,2) bal from "JournalEntryLine" l join "JournalEntry" j on j.id = l."journalEntryId" where j."organizationId" = $1 and j.status::text = 'POSTED' and l."accountId" = $2`, [e.org, e.id]);
      e.before = Number(b[0].bal);
      e.after = Math.round((e.before - Number(e.net)) * 100) / 100;
    }

    // ── full sweep: nothing else may point at what goes ──────────────────
    const deleting = new Map<string, Set<string>>([
      ['Document', new Set(docIds)], ['Order', new Set(orderIds)], ['Delivery', new Set(jobIds)], ['DeliveryItem', new Set(itemIds)],
      ['MaintenanceServiceReport', new Set(msrIds)], ['CustomFieldValue', new Set(cfvs.map((x) => x.id))], ['Notification', new Set(notes.map((x) => x.id))],
      ['CalendarNote', new Set(noteIds)], ['DeliveryGroupPost', new Set(posts.map((x) => x.id))], ['JobPhoto', new Set(jobPhotos.map((x) => x.id))], ['Payment', new Set(payIds)], ['Transaction', new Set(txns.map((x) => x.id))],
    ]);
    const targetIds = [...docIds, ...orderIds, ...jobIds, ...itemIds, ...msrIds, ...payIds, ...noteIds];
    const badPay = payments.filter((p) => !PAYMENT_OK.has(docs.find((d) => d.id === p.documentId)?.name));
    if (badPay.length) throw new Error(`Refusing: payments / allocations on these: ${badPay.map((p) => docs.find((d) => d.id === p.documentId)?.name).join(', ')}`);
    if (payments.some((p) => p.receiptId && !docIds.includes(p.receiptId))) throw new Error('Refusing: a payment belongs to a receipt that is not listed');
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
    // UAT files have random keys (org/<org>/<folder>/<uuid>): every key the deleted records reference goes, except
    // company-wide files (logo, stamp, letterhead).
    const companyWide = (k: string) => /(^|\/)(logos|stamps|letterheads?|organizations)\//i.test(k);
    for (const k of new Set([...referenced, ...listed])) (allIds.some((id) => k.includes(id)) || EXTRA_S3.includes(k) || (referenced.has(k) && !companyWide(k)) ? s3Plan : kept).push(k);
    for (const k of EXTRA_S3) if (!s3Plan.includes(k)) s3Plan.push(k);
    const storedRows = await q(`select key, "organizationId" from "StoredFile" where key = any($1)`, [s3Plan]).catch(() => [] as any[]);
    s3Plan.sort();

    // ── print ────────────────────────────────────────────────────────────
    const orgName = (o: string) => ORG_NAME[o] ?? o;
    console.log(`WCT (S) UAT 1125 cleanup: ${apply ? 'APPLY' : 'DRY RUN'}`);
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
    for (const cu of custDelete) console.log(`  Customer  ${orgName(cu.org).padEnd(7)} ${cu.code ?? ''} "${cu.name}" (test customer, nothing else links to it)`);
    for (const k of custKeep) console.log(`  KEEP customer ${orgName(k.c.org)} ${k.c.code ?? ''} "${k.c.name}": still linked (${k.why})`);
    for (const w of workerRows) console.log(`  HIDE worker ${orgName(w.org)} "${w.name}" (active ${w.active} -> false; not deleted, syncs from SiteClock)`);
    if (payments.length) for (const p of payments) console.log(`  Payment   ${p.paymentMethod} ${Number(p.amount).toFixed(2)} on ${docs.find((d) => d.id === p.documentId)?.name} (its journal voided, the row deleted: the app has no void state for a payment)`);
    if (effect.length) {
      console.log('Ledger effect of the voids (balance = debit - credit, posted journals):');
      for (const e of effect) console.log(`  ${orgName(e.org)} ${e.code} ${e.name}: before ${e.before.toFixed(2)}, after ${e.after.toFixed(2)} (change ${(-Number(e.net)).toFixed(2)})`);
    }
    console.log(`S3 objects to delete (bucket ${bucket}): ${s3Plan.length}`);
    for (const k of s3Plan) console.log(`  ${k}${listed.has(k) ? '' : '  (referenced, NOT found in S3)'}`);
    if (kept.length) console.log(`S3 keys referenced but shared (logo / stamp), KEPT: ${kept.length}`);
    console.log(`CHECKS: live journals to void ${liveJournals.length}, payments ${payments.length} , stock moved on listed DOs 0, unlisted documents / jobs hanging off them 0, other rows pointing at them 0.`);
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
    for (const cu of custDelete) {
      await c.query(`delete from "CustomerBalance" where "customerId" = $1`, [cu.id]).catch(() => undefined);
      await c.query(`delete from "Customer" where id = $1 and "organizationId" = $2`, [cu.id, cu.org]);
    }
    for (const w of workerRows) await c.query(`update "Worker" set active = false, "updatedAt" = now() where id = $1`, [w.id]);
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
    for (const cu of custDelete) await log(cu.org, 'customers', cu.id, `TEST customer ${cu.code ?? ''} "${cu.name}" deleted`);
    for (const w of workerRows) await c.query(
        `insert into "ActionLog" (id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status, "createdAt")
         values ($1, 'SYSTEM', $2, 'System creation', $3, 'script', 'UPDATE', 'workers', $4, $5, 'SUCCESS', $6)`,
        [randomUUID(), SCRIPT, w.org, w.id, JSON.stringify({ note: `test worker "${w.name}" hidden (active false)` }), now],
      );
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
