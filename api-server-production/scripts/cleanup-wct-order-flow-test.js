/**
 * WCT order-flow test data cleanup (ORD202611-001 end-to-end test, 2026-11-01)
 * — DRY RUN ONLY. Prints every row it would delete / cancel and every row
 * linked to them, inside a READ ONLY transaction. SiteClock is only read
 * (GET). There is no apply mode in this script: the apply is a separate step
 * after the owner's approval.
 *
 *   DBURL=<prod url, inline> SC_KEY_FILE=<env-style file with SITECLOCK_API_KEY=> \
 *   NODE_PATH=$PWD/node_modules node scripts/cleanup-wct-order-flow-test.js
 *
 * Rules: DocumentNumberFormat / counters are never touched (number gaps are
 * fine). ActionLog and AuditLog rows are KEPT (the activity history); the apply
 * adds one ActionLog row for the cleanup.
 */
const fs = require('fs');
const { Client } = require('pg');

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const OSIRIS = 'osiris-platform';
const T = {
  order: 'd827157e-ce7b-4abb-8829-c2cc2db0df92', // ORD202611-001
  quotation: '30f446a0-df0e-4949-b0b9-8e488003d902', // QO202611-0016
  invoice: 'c00fb53c-b269-458b-a2af-2c9f2e2d456c', // INV202611-0008
  payment: '1359afad-a19c-4f8b-8a1e-ebd88bcdc40a', // SGD 218 cash
  deliveries: {
    9: 'ce158a58-1a72-422e-869a-8d581df35aae',
    10: '59bc9d0d-a2b3-4d7f-8bae-0f1e1bd20bd9',
    11: '38696ae5-20b9-46ff-a77e-1ec26aa05fa2',
  },
  dos: { DO202610007: 'd307af53-d11d-468e-a99e-fdf1d801a952', DO202611008: '2c72d539-b2ea-454a-89a8-bf67082879f9', DO202611009: '3b8d41d0-29bc-435f-b123-40f52fa88011' },
  customer: 'bac8c939-a180-4933-97e8-5a1931ef3e8a', // CT001 "TEST SiteClock"
  osirisQuote: '9b1b49bc-3661-4138-862f-31b3ccfcd49e', // QO1202610-001 in osiris-platform (template 1f8c565f…)
};
const deliveryIds = Object.values(T.deliveries);
const doIds = Object.values(T.dos);
const docIds = [T.quotation, T.invoice, ...doIds];

let problems = 0;
const out = (s = '') => console.log(s);
const stop = (why) => {
  problems++;
  out(`  !! STOP: ${why}`);
};

(async () => {
  const c = new Client({ connectionString: process.env.DBURL });
  await c.connect();
  await c.query('BEGIN READ ONLY');
  const q = async (sql, p = []) => {
    await c.query('SAVEPOINT s');
    try {
      const r = (await c.query(sql, p)).rows;
      await c.query('RELEASE SAVEPOINT s');
      return r;
    } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT s');
      throw new Error(`${e.message} in: ${sql.slice(0, 120)}`);
    }
  };
  const one = async (sql, p) => (await q(sql, p))[0] ?? null;
  const n = async (sql, p) => Number((await one(sql, p))?.n ?? 0);
  const plan = [];
  const del = (table, where, rows, why) => plan.push({ op: 'DELETE', table, where, rows, why });

  out('WCT ORDER-FLOW TEST CLEANUP — DRY RUN (read only; nothing is written)');
  out(`run at ${new Date().toISOString()}`);

  // ── 0. identities: every target must be what the request says ──
  out('\n== 0. Targets');
  const order = await one(`select id,"orderNumber",status,"organizationId","sourceQuotationId","invoiceDocumentId","customerId" from "Order" where id=$1`, [T.order]);
  out(`  Order ${order?.orderNumber} status=${order?.status} org=${order?.organizationId === WCT ? 'WCT' : order?.organizationId}`);
  if (!order || order.organizationId !== WCT || order.orderNumber !== 'ORD202611-001' || order.sourceQuotationId !== T.quotation) stop('order is not ORD202611-001 of WCT from QO202611-0016');
  const docs = await q(`select id,name,type,status,"organizationId", config->>'referenceNo' ref, config->'items' items, config->>'nettTotal' nett from "Document" where id::text = any($1::text[])`, [docIds]);
  const byId = new Map(docs.map((d) => [d.id, d]));
  const expect = { [T.quotation]: ['QO202611-0016', 'QUOTATION'], [T.invoice]: ['INV202611-0008', 'INVOICE'], ...Object.fromEntries(Object.entries(T.dos).map(([name, id]) => [id, [name, 'DELIVERY_ORDER']])) };
  for (const [id, [name, type]] of Object.entries(expect)) {
    const d = byId.get(id);
    out(`  ${type.padEnd(14)} ${d?.name ?? '(missing)'} status=${d?.status} ${d?.nett ? `nett=${d.nett}` : ''}${d?.ref ? ` ref="${d.ref}"` : ''}`);
    if (!d || d.organizationId !== WCT || d.name !== name || d.type !== type) stop(`${name} is not a WCT ${type}`);
  }
  if (byId.get(T.quotation)?.ref !== 'TEST order flow') stop('the quotation reference is not "TEST order flow"');
  const dels = await q(`select id,"deliveryNumber",status,"isDraft","orderId","organizationId","customerId" from "Delivery" where id::text = any($1::text[]) order by "deliveryNumber"`, [deliveryIds]);
  for (const d of dels) out(`  Delivery #${d.deliveryNumber} status=${d.status}${d.orderId ? ' (job of ORD202611-001)' : ' (no order)'}`);
  for (const [no, id] of Object.entries(T.deliveries)) {
    const d = dels.find((x) => x.id === id);
    if (!d || d.organizationId !== WCT || String(d.deliveryNumber) !== no) stop(`delivery #${no} is not WCT's`);
  }
  const pay = await one(`select id,amount,"paymentMethod",notes,"documentId","organizationId" from "Payment" where id=$1`, [T.payment]);
  out(`  Payment ${pay?.amount} ${pay?.paymentMethod} note="${pay?.notes}"`);
  if (!pay || pay.organizationId !== WCT || pay.documentId !== T.invoice || !/TEST payment/i.test(pay.notes || '')) stop('the payment is not the SGD 218 TEST payment on INV202611-0008');
  const msrs = await q(`select id,"reportNumber",kind,status,"deliveryId","organizationId" from "MaintenanceServiceReport" where "deliveryId"::text = any($1::text[]) order by kind,"reportNumber"`, [deliveryIds]);
  out(`  Service / proof reports on #9 #10 #11: ${msrs.map((m) => `${m.kind}${m.reportNumber ? ` #${m.reportNumber}` : ''} (${m.status})`).join(', ')}`);
  if (!msrs.some((m) => m.reportNumber === 5) || !msrs.some((m) => m.reportNumber === 6)) stop('service reports #5 and #6 are not on these jobs');
  if (msrs.some((m) => m.organizationId !== WCT)) stop('a report is not WCT’s');

  // ── 1. accounting: journals of the invoice and the payment ──
  out('\n== 1. Ledger');
  const lock = await one(`select "lockedThroughDate" from "AccountingSetting" where "organizationId"=$1`, [WCT]).catch(() => null);
  out(`  WCT books locked through: ${lock?.lockedThroughDate ? new Date(lock.lockedThroughDate).toISOString().slice(0, 10) : 'not locked'}`);
  const jes = await q(
    `select e.id,e."journalNumber",e.type,e.status,e."entryDate",e."totalDebit",e."sourceDocumentId",e."sourcePaymentId",
       (select json_agg(json_build_object('account', a.code || ' ' || a.name, 'dr', l.debit, 'cr', l.credit) order by l.debit desc) from "JournalEntryLine" l left join "ChartOfAccount" a on a.id=l."accountId" where l."journalEntryId"=e.id) lines
     from "JournalEntry" e where e."organizationId"=$1 and (e."sourceDocumentId"::text = any($2::text[]) or e."sourcePaymentId"=$3 or e."reversesEntryId" in (select id from "JournalEntry" where "sourceDocumentId"::text = any($2::text[])))
     order by e."journalNumber"`,
    [WCT, docIds, T.payment],
  ).catch(async (e) => {
    out(`  (line detail unavailable: ${e.message})`);
    return q(`select id,"journalNumber",type,status,"entryDate","totalDebit","sourceDocumentId","sourcePaymentId" from "JournalEntry" where "organizationId"=$1 and ("sourceDocumentId"::text = any($2::text[]) or "sourcePaymentId"=$3)`, [WCT, docIds, T.payment]);
  });
  for (const e of jes) {
    out(`  ${e.journalNumber} ${e.type} ${e.status} ${new Date(e.entryDate).toISOString().slice(0, 10)} total ${e.totalDebit}${e.sourcePaymentId ? ' (the payment)' : ''}`);
    for (const l of e.lines || []) out(`      ${String(l.account).padEnd(40)} Dr ${l.dr}  Cr ${l.cr}`);
    if (lock?.lockedThroughDate && new Date(e.entryDate) <= new Date(lock.lockedThroughDate)) stop(`${e.journalNumber} is inside the locked period: void instead of delete`);
  }
  const jeIds = jes.map((e) => e.id);
  const jeLines = jeIds.length ? await n(`select count(*)::int n from "JournalEntryLine" where "journalEntryId"::text = any($1::text[])`, [jeIds]) : 0;
  const jeRefs = jeIds.length ? await q(`select id,"journalNumber" from "JournalEntry" where "reversesEntryId"::text = any($1::text[]) and not (id::text = any($1::text[]))`, [jeIds]) : [];
  if (jeRefs.length) stop(`other journals reverse these: ${jeRefs.map((r) => r.journalNumber).join(', ')}`);
  const txns = await q(`select id,"transactionType",debit,credit,"documentId","paymentId" from "Transaction" where "organizationId"=$1 and ("documentId"::text = any($2::text[]) or "paymentId"=$3 or "customerId"=$4)`, [WCT, docIds, T.payment, T.customer]).catch((e) => [{ err: e.message }]);
  out(`  Customer-ledger Transaction rows: ${txns.length}${txns.length ? ` ${JSON.stringify(txns)}` : ''}`);
  if (txns.some((t) => t.err)) stop('could not read Transaction');
  const bal = await q(`select * from "CustomerBalance" where "customerId"=$1`, [T.customer]).catch(() => []);
  out(`  CustomerBalance rows for CT001: ${bal.length}`);

  del('JournalEntry (+ JournalEntryLine cascade)', `id in (${jes.map((e) => e.journalNumber).join(', ')})`, `${jes.length} entries, ${jeLines} lines`, 'test postings of INV202611-0008 and its test payment; the invoice cannot be deleted while a non-VOID journal points at it (aims_doc_delete_guard)');
  del('Payment', `id = ${T.payment}`, 1, 'SGD 218 TEST cash payment (Payment → Document is RESTRICT, so it goes before the invoice)');
  if (txns.length && !txns[0].err) del('Transaction', 'rows above', txns.length, 'customer ledger rows of the test invoice/payment');

  // ── 2. jobs and their children ──
  out('\n== 2. Jobs #9 #10 #11');
  const items = await q(`select "deliveryId",id,description,"documentId" from "DeliveryItem" where "deliveryId"::text = any($1::text[])`, [deliveryIds]);
  const pings = msrs.length ? await n(`select count(*)::int n from "DeliveryLocationPing" where "reportId"::text = any($1::text[])`, [msrs.map((m) => m.id)]) : 0;
  const posts = await q(`select id,"deliveryId",status from "DeliveryGroupPost" where "deliveryId"::text = any($1::text[])`, [deliveryIds]);
  const cfv = await q(`select v.id,v."entityId",f."displayLabel" as name,v.value from "CustomFieldValue" v left join "CustomField" f on f.id=v."customFieldId" where v."entityId"::text = any($1::text[])`, [deliveryIds]);
  const scRows = await q(`select id,"deliveryId","workerName","siteclockJobId","externalRef","syncState","lastPushedStatus","syncedDoNumber" from "DeliverySiteClockJob" where "deliveryId"::text = any($1::text[])`, [deliveryIds]);
  const dsl = await q(`select id,"documentId","deliveryId" from "DeliveryShareLink" where "deliveryId"::text = any($1::text[]) or "documentId"::text = any($2::text[])`, [deliveryIds, docIds]);
  out(`  DeliveryItem: ${items.length} (cascade with the jobs)`);
  out(`  MaintenanceServiceReport: ${msrs.length} (FK is SET NULL, so deleted explicitly), DeliveryLocationPing under them: ${pings} (cascade)`);
  out(`  DeliveryGroupPost: ${posts.length} ${posts.map((p) => p.status).join(',')}`);
  out(`  CustomFieldValue (job fields): ${cfv.map((v) => `${v.name}=${JSON.stringify(v.value)}`).join(', ') || 0}`);
  out(`  DeliveryShareLink (guest/driver links): ${dsl.length}`);
  out(`  DeliverySiteClockJob: ${scRows.map((s) => `#${dels.find((d) => d.id === s.deliveryId)?.deliveryNumber} → ${s.siteclockJobId} ${s.lastPushedStatus} (${s.workerName}, ${s.syncedDoNumber})`).join('; ')}`);
  if (!scRows.some((s) => s.deliveryId === T.deliveries[10])) out('  (#10 has no SiteClock job row: it was never pushed to SiteClock)');
  del('CustomFieldValue', 'entityId in jobs #10 #11', cfv.length, 'the jobs’ Permit required / Permit approved values');
  del('DeliveryGroupPost', 'deliveryId in jobs', posts.length, 'WhatsApp group-post queue rows (status SKIPPED)');
  del('DeliverySiteClockJob', 'deliveryId in jobs', scRows.length, 'AIMS’s link rows to the SiteClock jobs (after the SiteClock step below)');
  del('MaintenanceServiceReport (+ DeliveryLocationPing cascade)', 'deliveryId in jobs', `${msrs.length} reports (#5, #6 + ${msrs.length - 2} proof/draft), ${pings} pings`, 'service reports #5 #6 and the DO_START / DO_ACK proof rows');
  del('Delivery (+ DeliveryItem, DeliveryShareLink cascade)', 'jobs #9 #10 #11', `${dels.length} jobs, ${items.length} items, ${dsl.length} links`, 'the test jobs');

  // ── 3. documents ──
  out('\n== 3. Documents');
  const docShare = await q(`select id,"documentId","revokedAt" from "DocumentShareLink" where "documentId"::text = any($1::text[])`, [docIds]);
  const docSign = await q(`select id,"documentId","signedAt" from "DocumentSignLink" where "documentId"::text = any($1::text[])`, [docIds]);
  const docItems = await n(`select count(*)::int n from "DocumentItem" where "documentId"::text = any($1::text[])`, [docIds]);
  const embeds = await n(`select count(*)::int n from "DocumentEmbedding" where "documentId"::text = any($1::text[])`, [docIds]).catch(() => 0);
  const priceHist = await n(`select count(*)::int n from "PriceHistory" where "documentId"::text = any($1::text[])`, [docIds]).catch(() => 0);
  const notes = await q(`select "entityId", count(*)::int n from "Notification" where "organizationId"=$1 and "entityId" = any($2::text[]) group by 1`, [WCT, [...docIds, ...deliveryIds, T.order]]);
  out(`  DocumentShareLink (guest DO links): ${docShare.length} (on ${docShare.map((s) => docs.find((d) => d.id === s.documentId)?.name).join(', ')}; cascade)`);
  out(`  DocumentSignLink: ${docSign.length}, DocumentItem: ${docItems}, DocumentEmbedding: ${embeds}, PriceHistory: ${priceHist}`);
  out(`  Notification (bell) rows: ${notes.reduce((s, x) => s + x.n, 0)}`);
  if (priceHist) stop('PriceHistory rows point at these documents (RESTRICT)');
  // Any OTHER document whose config mentions one of the targets (JSON links have no FK).
  const allIds = [...docIds, ...deliveryIds, T.order, T.payment];
  const jsonRefs = await q(`select id,name,type,"organizationId" from "Document" where not (id::text = any($1::text[])) and (${allIds.map((_, i) => `config::text like '%' || $${i + 2} || '%'`).join(' or ')})`, [docIds, ...allIds]);
  out(`  Other documents whose config mentions a target: ${jsonRefs.length ? jsonRefs.map((d) => `${d.name} (${d.type})`).join(', ') : 'none'}`);
  if (jsonRefs.length) stop('another document refers to a target');
  del('Notification', 'entityId in targets', notes.reduce((s, x) => s + x.n, 0), 'bell rows pointing at the deleted documents');
  del('Document INVOICE', 'INV202611-0008', 1, 'after its journals and payment');
  del('Document DELIVERY_ORDER (+ DocumentShareLink cascade)', 'DO202611008, DO202611009, DO202610007', `3 DOs, ${docShare.length} guest links`, 'the jobs’ DOs');
  del('Document QUOTATION', 'QO202611-0016', 1, 'the test quotation');
  del('Order', 'ORD202611-001', 1, 'the test order');

  // ── 4. the test customer, only if nothing else uses it ──
  out('\n== 4. Customer CT001 "TEST SiteClock"');
  const cust = await one(`select id,name,"customerCode","organizationId" from "Customer" where id=$1`, [T.customer]);
  out(`  ${cust?.customerCode} ${cust?.name}`);
  if (!cust || cust.organizationId !== WCT || cust.customerCode !== 'CT001') stop('customer is not WCT CT001');
  const custUse = {
    deliveries: await n(`select count(*)::int n from "Delivery" where "customerId"=$1 and not (id::text = any($2::text[]))`, [T.customer, deliveryIds]),
    orders: await n(`select count(*)::int n from "Order" where "customerId"=$1 and id<>$2`, [T.customer, T.order]),
    payments: await n(`select count(*)::int n from "Payment" where "customerId"=$1 and id<>$2`, [T.customer, T.payment]),
    projects: await n(`select count(*)::int n from "Project" where "customerId"=$1`, [T.customer]),
    documents: await n(`select count(*)::int n from "Document" where "organizationId"=$1 and not (id::text = any($3::text[])) and (config->>'customerId'=$2 or config->'customer'->>'id'=$2)`, [WCT, T.customer, docIds]),
    contracts: await n(`select count(*)::int n from "Contract" where "customerId"=$1`, [T.customer]).catch(() => 0),
    siteOffices: await n(`select count(*)::int n from "SiteOffice" where "customerId"=$1`, [T.customer]).catch(() => 0),
    tradeOrders: await n(`select count(*)::int n from "TradeOrder" where "customerId"=$1`, [T.customer]).catch(() => 0),
    shipments: await n(`select count(*)::int n from "Shipment" where "customerId"=$1`, [T.customer]).catch(() => 0),
  };
  const contacts = await q(`select id,name from "CustomerContact" where "customerId"=$1`, [T.customer]).catch(() => []);
  out(`  still used outside the test rows: ${JSON.stringify(custUse)}`);
  out(`  CustomerContact (cascade): ${contacts.length}${contacts.length ? ` ${contacts.map((x) => x.name).join(', ')}` : ''}`);
  const custFree = Object.values(custUse).every((v) => v === 0);
  if (custFree) del('Customer (+ CustomerContact cascade)', 'CT001 TEST SiteClock', `1 customer, ${contacts.length} contacts`, 'nothing else references it');
  else out('  → KEPT: something else still references it');

  // ── 5. osiris-platform blank quotation ──
  out('\n== 5. osiris-platform QO1202610-001');
  const oq = await one(`select id,name,type,status,"organizationId","documentTemplateId","projectId","createdAt","updatedAt", config from "Document" where id=$1`, [T.osirisQuote]);
  const oc = oq?.config || {};
  const blank = !!oq && oq.organizationId === OSIRIS && (!Array.isArray(oc.items) || !oc.items.length) && !oc.customerId && !oc.customer && !oc.customerName && !oq.projectId;
  out(`  ${oq?.name} ${oq?.type} status=${oq?.status} org=${oq?.organizationId} created ${oq?.createdAt?.toISOString?.()} updated ${oq?.updatedAt?.toISOString?.()}`);
  out(`  config keys: ${Object.keys(oc).join(', ')}; documentInfo: ${JSON.stringify(oc.documentInfo)}`);
  const oqRefs = [];
  for (const { t, col } of await q(`select table_name t, column_name col from information_schema.columns where table_schema='public' and data_type in ('uuid','text') and (column_name ilike '%documentid' or column_name in ('resourceId','entityId','baseDocumentId'))`)) {
    const k = await n(`select count(*)::int n from "${t}" where "${col}"::text=$1`, [T.osirisQuote]).catch(() => 0);
    if (k && !(t === 'Document' && col === 'id')) oqRefs.push(`${t}.${col}: ${k}`);
  }
  const oqJe = await n(`select count(*)::int n from "JournalEntry" where "sourceDocumentId"=$1`, [T.osirisQuote]);
  const oqJson = await n(`select count(*)::int n from "Document" where id<>$1 and config::text like '%' || $1 || '%'`, [T.osirisQuote]);
  out(`  references: ${oqRefs.join(', ') || 'none'}; journals: ${oqJe}; other documents mentioning it: ${oqJson}`);
  const oqLog = await q(`select action,method,path,"createdAt" from "ActionLog" where "resourceId"=$1 order by "createdAt" desc limit 3`, [T.osirisQuote]);
  out(`  latest activity: ${oqLog.map((l) => `${l.action} ${l.method} ${l.path} ${l.createdAt.toISOString()}`).join(' | ') || 'none'}`);
  const oqUsed = oqRefs.some((r) => !/^(ActionLog|AuditLog)\./.test(r)) || oqJe > 0 || oqJson > 0;
  if (!blank) stop('the osiris-platform quotation is not blank');
  else if (oqUsed) out('  → KEPT: something references it');
  else del('Document QUOTATION (osiris-platform)', 'QO1202610-001 9b1b49bc…', 1, 'blank (no lines, no customer, no project) and unused');

  // ── 6. SiteClock (read only here: GET) ──
  out('\n== 6. SiteClock jobs (production SiteClock, WCT company)');
  const conn = await one(`select "baseUrl",enabled,"siteclockCompanyId" from "SiteClockConnection" where "organizationId"=$1`, [WCT]);
  const keyFile = (process.env.SC_KEY_FILE || '').replace(/^~/, process.env.HOME);
  // The key file is env-style (SITECLOCK_API_KEY=…); a bare key works too. Never printed.
  const raw = keyFile && fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8') : '';
  const key = (raw.match(/^SITECLOCK_API_KEY=(.+)$/m)?.[1] ?? (raw.includes('=') ? '' : raw)).trim();
  out(`  connection: ${conn?.baseUrl} enabled=${conn?.enabled}`);
  for (const s of scRows) {
    const no = dels.find((d) => d.id === s.deliveryId)?.deliveryNumber;
    if (!key || !conn?.baseUrl) {
      out(`  #${no}: SiteClock not read (no key file)`);
      continue;
    }
    const r = await fetch(`${conn.baseUrl.replace(/\/$/, '')}/v1/jobs/by-ref/${encodeURIComponent(s.externalRef)}`, { headers: { Authorization: `Bearer ${key}` } });
    const body = await r.json().catch(() => null);
    const j = body?.job;
    out(`  #${no}: HTTP ${r.status} job ${j?.id ?? s.siteclockJobId} "${j?.title ?? ''}" status=${j?.status ?? '?'} start=${j?.startAt ?? j?.scheduledStart ?? '?'} crew=${(j?.crew || []).map((x) => x?.user?.name ?? x?.name).join(',')}`);
    if (j?.status === 'COMPLETED') {
      out(`      → CANNOT be removed through the /v1 API: DELETE /v1/jobs/by-ref is a soft CANCEL and refuses a COMPLETED job (409 JOB_CLOSED). It stays on SiteClock as a completed job; removing it needs SiteClock-side admin action.`);
      plan.push({ op: 'NONE', table: 'SiteClock job', where: `${j.id} (#${no})`, rows: 0, why: 'completed: the API refuses to cancel it; needs a SiteClock-side delete' });
    } else if (j && j.status !== 'CANCELLED') {
      plan.push({ op: 'CANCEL', table: 'SiteClock job', where: `DELETE /v1/jobs/by-ref/${s.externalRef} {notify:false}`, rows: 1, why: `#${no} ${j.status}: soft cancel, gone from every SiteClock screen (SiteClock keeps it for history)` });
    } else out('      → already cancelled or missing; nothing to do');
  }

  // ── 7. every id-like column in the database, for every target id ──
  out('\n== 7. Reference sweep (every uuid/text column named *id / *Id / *ids, all tables)');
  const ids = new Map([
    ...docIds.map((id) => [id, byId.get(id)?.name ?? id]),
    ...dels.map((d) => [d.id, `delivery #${d.deliveryNumber}`]),
    [T.order, 'ORD202611-001'],
    [T.payment, 'payment'],
    [T.customer, 'customer CT001'],
    [T.osirisQuote, 'osiris QO1202610-001'],
    ...jes.map((e) => [e.id, e.journalNumber]),
    ...msrs.map((m) => [m.id, `report ${m.kind}${m.reportNumber ? ` #${m.reportNumber}` : ''}`]),
  ]);
  // Where each reference is handled by the plan (deleted with its row, or a cascade / SET NULL / kept history).
  const handled = /^(ActionLog\.resourceId|AuditLog\.resourceId|Notification\.entityId|CustomFieldValue\.entityId|DeliveryGroupPost\.deliveryId|DeliverySiteClockJob\.deliveryId|DeliveryItem\.(deliveryId|documentId)|MaintenanceServiceReport\.(id|deliveryId|documentId|invoiceDocumentId)|Delivery\.(id|orderId|orderInvoiceId|sourceQuotationId|customerId)|Document\.(id|documentTemplateId)|DocumentShareLink\.documentId|Order\.(id|invoiceDocumentId|sourceQuotationId|customerId)|Payment\.(id|documentId|customerId)|JournalEntry\.(id|sourceDocumentId|sourcePaymentId)|JournalEntryLine\.journalEntryId|Customer\.id|DocumentTemplate\.id)$/;
  const cols = await q(`select table_name t, column_name col from information_schema.columns where table_schema='public' and data_type in ('uuid','text') and (column_name ilike '%id' or column_name ilike '%ids') and table_name not like '\\_%'`);
  const idList = [...ids.keys()];
  const unhandled = [];
  for (const { t, col } of cols) {
    let rows = [];
    try {
      rows = await q(`select "${col}"::text v, count(*)::int n from "${t}" where "${col}"::text = any($1::text[]) group by 1`, [idList]);
    } catch {
      continue;
    }
    for (const r of rows) {
      const line = `${t}.${col} → ${ids.get(r.v)}: ${r.n}`;
      if (handled.test(`${t}.${col}`)) out(`  ${line}`);
      else {
        unhandled.push(line);
        out(`  ${line}   <- NOT IN THE PLAN`);
      }
    }
  }
  if (unhandled.length) stop(`${unhandled.length} reference(s) outside the plan`);

  // ── plan ──
  out('\n== PLAN (in this order, one transaction for the database part; nothing done by this run)');
  const sc = plan.filter((p) => p.table === 'SiteClock job');
  const db = plan.filter((p) => p.table !== 'SiteClock job');
  let i = 0;
  for (const p of sc) out(`  ${++i}. ${p.op.padEnd(6)} ${p.table}: ${p.where}  [${p.why}]`);
  for (const p of db) out(`  ${++i}. ${p.op.padEnd(6)} ${p.table}: ${p.where} → ${p.rows}  [${p.why}]`);
  out(`  ${++i}. INSERT ActionLog: one SYSTEM row "system:wct-order-flow-test-cleanup" listing what was removed`);
  out('  KEPT: ActionLog + AuditLog history rows of these records; DocumentNumberFormat and all counters (gaps: ORD202611-001, QO202611-0016, DO202610007/8/9, INV202611-0008, JV-000005/6/7); S3 files (photos, signatures, PDFs).');
  out(`\n${problems ? `${problems} PROBLEM(S): fix before any apply` : 'No problems found.'} DRY RUN: nothing was written.`);
  await c.query('ROLLBACK');
  await c.end();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
