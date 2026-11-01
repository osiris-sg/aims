/**
 * WCT order-flow test data cleanup — run 1 (ORD202611-001, 1 Nov) and run 2
 * (ORD202611-002 retest, 2 Nov).
 *
 * DRY RUN by default: prints every row it would delete / cancel and every row
 * linked to them, inside a READ ONLY transaction; SiteClock is only read (GET).
 *
 *   DBURL=<prod url, inline> SC_KEY_FILE=<env-style file with SITECLOCK_API_KEY=> \
 *   NODE_PATH=$PWD/node_modules node scripts/cleanup-wct-order-flow-test.js [--rehearse | --apply --confirm-prod]
 *
 * --rehearse: runs every DELETE in one transaction, checks each row count
 *   against the dry run, prints the counts, then ROLLBACK (nothing kept;
 *   SiteClock untouched).
 * --apply --confirm-prod: the same, then cancels the SiteClock job(s) that
 *   can be cancelled (POST /v1/jobs/by-ref/<ref>/cancel) and COMMITs. Any count
 *   mismatch or a failed SiteClock cancel rolls the whole database part back.
 *
 * Rules: DocumentNumberFormat / counters are never touched (number gaps are
 * fine). ActionLog and AuditLog rows are KEPT (the activity history); the apply
 * adds one ActionLog row for the cleanup.
 */
const fs = require('fs');
const { Client, types } = require('pg');

// Prisma stores DateTime as UTC in "timestamp without time zone"; node-pg would
// read those as the machine's LOCAL time (SGT here) and print them 8 h early —
// a 1 Nov payment date showed as 2026-10-31. Read them as UTC, like the app.
types.setTypeParser(1114, (v) => new Date(`${v.replace(' ', 'T')}Z`));

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const MODE = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--rehearse') ? 'rehearse' : 'dry';
if (MODE === 'apply' && !process.argv.includes('--confirm-prod')) {
  console.error('--apply needs --confirm-prod');
  process.exit(1);
}
const OSIRIS = 'osiris-platform';
// Each run: its order, quotation (and the reference the test typed), invoice,
// TEST payment (note pattern), jobs, DOs and the service report numbers.
const RUNS = [
  {
    label: 'run 1 (1 Nov)',
    order: ['d827157e-ce7b-4abb-8829-c2cc2db0df92', 'ORD202611-001'],
    quotation: ['30f446a0-df0e-4949-b0b9-8e488003d902', 'QO202611-0016', 'TEST order flow'],
    invoice: ['c00fb53c-b269-458b-a2af-2c9f2e2d456c', 'INV202611-0008'],
    payment: ['1359afad-a19c-4f8b-8a1e-ebd88bcdc40a', 218, /TEST payment/i],
    deliveries: { 9: 'ce158a58-1a72-422e-869a-8d581df35aae', 10: '59bc9d0d-a2b3-4d7f-8bae-0f1e1bd20bd9', 11: '38696ae5-20b9-46ff-a77e-1ec26aa05fa2' },
    dos: { DO202610007: 'd307af53-d11d-468e-a99e-fdf1d801a952', DO202611008: '2c72d539-b2ea-454a-89a8-bf67082879f9', DO202611009: '3b8d41d0-29bc-435f-b123-40f52fa88011' },
    reports: [5, 6],
  },
  {
    label: 'run 2 (2 Nov retest)',
    order: ['a3a4c8ea-14cd-4450-81bf-e389dfde5a9f', 'ORD202611-002'],
    quotation: ['40649e7b-fc13-448e-9e00-e00dc3176c4f', 'QO202611-0017', 'TEST order flow retest'],
    invoice: ['3b2661e3-a6ce-4911-b50a-1769c5e0e518', 'INV202611-0009'],
    payment: ['d902b42b-76b7-4297-a85b-77e830cebe7a', 109, /TEST payment, order flow retest/i],
    deliveries: { 12: 'a8a76db1-ae44-4ba8-a1ea-cf40b3f14734', 13: 'ee671dd7-0e24-4dab-b928-d48e2f507056' },
    dos: { DO202611010: '5f991f5b-af38-4101-b88d-5ea0375fe4dd', DO202611011: 'f2ffaacc-48a9-4572-99d8-5a2ae9aef062' },
    reports: [7, 8],
  },
];
const T = {
  customer: 'bac8c939-a180-4933-97e8-5a1931ef3e8a', // CT001 "TEST SiteClock"
  osirisQuote: '9b1b49bc-3661-4138-862f-31b3ccfcd49e', // QO1202610-001 in osiris-platform (template 1f8c565f…)
  // Delivery #11's SiteClock job: completed, so the /v1 API cannot cancel it.
  siteclockSideDelete: 11,
};
const orderIds = RUNS.map((r) => r.order[0]);
const paymentIds = RUNS.map((r) => r.payment[0]);
const invoiceIds = RUNS.map((r) => r.invoice[0]);
const deliveryNo = Object.fromEntries(RUNS.flatMap((r) => Object.entries(r.deliveries)));
const deliveryIds = Object.values(deliveryNo);
const doIds = RUNS.flatMap((r) => Object.values(r.dos));
const docIds = RUNS.flatMap((r) => [r.quotation[0], r.invoice[0], ...Object.values(r.dos)]);
const jobsLabel = Object.keys(deliveryNo).map((n) => `#${n}`).join(' ');

let problems = 0;
const out = (s = '') => console.log(s);
const stop = (why) => {
  problems++;
  out(`  !! STOP: ${why}`);
};

(async () => {
  const c = new Client({ connectionString: process.env.DBURL });
  await c.connect();
  await c.query(MODE === 'dry' ? 'BEGIN READ ONLY' : 'BEGIN');
  // Long sweep on a slow link: don't let the session's idle timeout kill it.
  if (MODE !== 'dry') await c.query(`SET LOCAL idle_in_transaction_session_timeout = '15min'`);
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

  out(`WCT ORDER-FLOW TEST CLEANUP — ${MODE === 'dry' ? 'DRY RUN (read only; nothing is written)' : MODE === 'rehearse' ? 'REHEARSAL (deletes, then ROLLBACK)' : 'APPLY'}`);
  out(`run at ${new Date().toISOString()}`);

  // ── 0. identities: every target must be what the request says ──
  out('\n== 0. Targets');
  const docs = await q(`select id,name,type,status,"organizationId", config->>'referenceNo' ref, config->'items' items, config->>'nettTotal' nett from "Document" where id::text = any($1::text[])`, [docIds]);
  const byId = new Map(docs.map((d) => [d.id, d]));
  const dels = await q(`select id,"deliveryNumber",status,"isDraft","orderId","organizationId","customerId" from "Delivery" where id::text = any($1::text[]) order by "deliveryNumber"`, [deliveryIds]);
  const msrs = await q(`select id,"reportNumber",kind,status,"deliveryId","organizationId" from "MaintenanceServiceReport" where "deliveryId"::text = any($1::text[]) order by kind,"reportNumber"`, [deliveryIds]);
  for (const run of RUNS) {
    out(`  -- ${run.label}`);
    const order = await one(`select id,"orderNumber",status,"organizationId","sourceQuotationId","invoiceDocumentId","customerId" from "Order" where id=$1`, [run.order[0]]);
    out(`  Order ${order?.orderNumber} status=${order?.status} org=${order?.organizationId === WCT ? 'WCT' : order?.organizationId}`);
    if (!order || order.organizationId !== WCT || order.orderNumber !== run.order[1] || order.sourceQuotationId !== run.quotation[0]) stop(`order is not ${run.order[1]} of WCT from ${run.quotation[1]}`);
    const expect = { [run.quotation[0]]: [run.quotation[1], 'QUOTATION'], [run.invoice[0]]: [run.invoice[1], 'INVOICE'], ...Object.fromEntries(Object.entries(run.dos).map(([name, id]) => [id, [name, 'DELIVERY_ORDER']])) };
    for (const [id, [name, type]] of Object.entries(expect)) {
      const d = byId.get(id);
      out(`  ${type.padEnd(14)} ${d?.name ?? '(missing)'} status=${d?.status} ${d?.nett ? `nett=${d.nett}` : ''}${d?.ref ? ` ref="${d.ref}"` : ''}`);
      if (!d || d.organizationId !== WCT || d.name !== name || d.type !== type) stop(`${name} is not a WCT ${type}`);
    }
    if (byId.get(run.quotation[0])?.ref !== run.quotation[2]) stop(`the quotation reference is not "${run.quotation[2]}"`);
    for (const [no, id] of Object.entries(run.deliveries)) {
      const d = dels.find((x) => x.id === id);
      out(`  Delivery #${d?.deliveryNumber} status=${d?.status}${d?.orderId === run.order[0] ? ` (job of ${run.order[1]})` : d?.orderId ? ' (job of ANOTHER order)' : ' (no order)'}`);
      if (!d || d.organizationId !== WCT || String(d.deliveryNumber) !== no) stop(`delivery #${no} is not WCT's`);
    }
    const pay = await one(`select id,amount,"paymentMethod",notes,"documentId","organizationId","createdAt" from "Payment" where id=$1`, [run.payment[0]]);
    out(`  Payment ${pay?.amount} ${pay?.paymentMethod} note="${pay?.notes}" created ${pay?.createdAt?.toISOString?.()}`);
    if (!pay || pay.organizationId !== WCT || pay.documentId !== run.invoice[0] || Number(pay.amount) !== run.payment[1] || !run.payment[2].test(pay.notes || '')) stop(`the payment is not the SGD ${run.payment[1]} TEST payment on ${run.invoice[1]}`);
    const otherPays = await q(`select id,amount,notes from "Payment" where "documentId"=$1 and id<>$2`, [run.invoice[0], run.payment[0]]);
    if (otherPays.length) stop(`${run.invoice[1]} has other payments: ${JSON.stringify(otherPays)}`);
    const mine = msrs.filter((m) => Object.values(run.deliveries).includes(m.deliveryId));
    out(`  Service / proof reports on ${Object.keys(run.deliveries).map((n) => `#${n}`).join(' ')}: ${mine.map((m) => `${m.kind}${m.reportNumber ? ` #${m.reportNumber}` : ''} (${m.status})`).join(', ')}`);
    for (const no of run.reports) if (!mine.some((m) => m.reportNumber === no)) stop(`service report #${no} is not on these jobs`);
  }
  if (msrs.some((m) => m.organizationId !== WCT)) stop('a report is not WCT’s');
  const serviceNos = msrs.filter((m) => m.reportNumber).map((m) => `#${m.reportNumber}`).join(' ');

  // ── 1. accounting: journals of the invoices and the payments ──
  out('\n== 1. Ledger');
  const lock = await one(`select "lockedThroughDate" from "AccountingSetting" where "organizationId"=$1`, [WCT]).catch(() => null);
  out(`  WCT books locked through: ${lock?.lockedThroughDate ? new Date(lock.lockedThroughDate).toISOString().slice(0, 10) : 'not locked'}`);
  const jes = await q(
    `select e.id,e."journalNumber",e.type,e.status,e."entryDate",e."totalDebit",e."sourceDocumentId",e."sourcePaymentId",
       (select json_agg(json_build_object('account', a.code || ' ' || a.name, 'dr', l.debit, 'cr', l.credit) order by l.debit desc) from "JournalEntryLine" l left join "ChartOfAccount" a on a.id=l."accountId" where l."journalEntryId"=e.id) lines
     from "JournalEntry" e where e."organizationId"=$1 and (e."sourceDocumentId"::text = any($2::text[]) or e."sourcePaymentId"::text = any($3::text[]) or e."reversesEntryId" in (select id from "JournalEntry" where "sourceDocumentId"::text = any($2::text[])))
     order by e."journalNumber"`,
    [WCT, docIds, paymentIds],
  ).catch(async (e) => {
    out(`  (line detail unavailable: ${e.message})`);
    return q(`select id,"journalNumber",type,status,"entryDate","totalDebit","sourceDocumentId","sourcePaymentId" from "JournalEntry" where "organizationId"=$1 and ("sourceDocumentId"::text = any($2::text[]) or "sourcePaymentId"::text = any($3::text[]))`, [WCT, docIds, paymentIds]);
  });
  for (const e of jes) {
    const src = e.sourcePaymentId ? `payment of ${RUNS.find((r) => r.payment[0] === e.sourcePaymentId)?.invoice[1]}` : byId.get(e.sourceDocumentId)?.name ?? e.sourceDocumentId;
    out(`  ${e.journalNumber} ${e.type} ${e.status} ${new Date(e.entryDate).toISOString().slice(0, 10)} total ${e.totalDebit} (${src})`);
    for (const l of e.lines || []) out(`      ${String(l.account).padEnd(40)} Dr ${l.dr}  Cr ${l.cr}`);
    if (lock?.lockedThroughDate && new Date(e.entryDate) <= new Date(lock.lockedThroughDate)) stop(`${e.journalNumber} is inside the locked period: void instead of delete`);
  }
  const jeIds = jes.map((e) => e.id);
  const jeLines = jeIds.length ? await n(`select count(*)::int n from "JournalEntryLine" where "journalEntryId"::text = any($1::text[])`, [jeIds]) : 0;
  const jeRefs = jeIds.length ? await q(`select id,"journalNumber" from "JournalEntry" where "reversesEntryId"::text = any($1::text[]) and not (id::text = any($1::text[]))`, [jeIds]) : [];
  if (jeRefs.length) stop(`other journals reverse these: ${jeRefs.map((r) => r.journalNumber).join(', ')}`);
  const txns = await q(`select id,"transactionType",debit,credit,"documentId","paymentId" from "Transaction" where "organizationId"=$1 and ("documentId"::text = any($2::text[]) or "paymentId"::text = any($3::text[]) or "customerId"=$4)`, [WCT, docIds, paymentIds, T.customer]).catch((e) => [{ err: e.message }]);
  out(`  Customer-ledger Transaction rows: ${txns.length}${txns.length ? ` ${JSON.stringify(txns)}` : ''}`);
  if (txns.some((t) => t.err)) stop('could not read Transaction');
  const bal = await q(`select * from "CustomerBalance" where "customerId"=$1`, [T.customer]).catch(() => []);
  out(`  CustomerBalance rows for CT001: ${bal.length}`);

  del('JournalEntry (+ JournalEntryLine cascade)', `id in (${jes.map((e) => e.journalNumber).join(', ')})`, `${jes.length} entries, ${jeLines} lines`, `test postings of ${RUNS.map((r) => r.invoice[1]).join(' / ')} and their test payments; an invoice cannot be deleted while a non-VOID journal points at it (aims_doc_delete_guard)`);
  del('Payment', RUNS.map((r) => `SGD ${r.payment[1]} on ${r.invoice[1]}`).join(', '), paymentIds.length, 'the TEST cash payments (Payment → Document is RESTRICT, so they go before the invoices)');
  if (txns.length && !txns[0].err) del('Transaction', 'rows above', txns.length, 'customer ledger rows of the test invoice/payment');

  // ── 2. jobs and their children ──
  out(`\n== 2. Jobs ${jobsLabel}`);
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
  for (const no of Object.keys(deliveryNo)) if (!scRows.some((s) => s.deliveryId === deliveryNo[no])) out(`  #${no}: no SiteClock job row (never pushed to SiteClock)`);
  // Service-report guest sign links: reportIds is a plain array (no FK).
  const msrIds = msrs.map((m) => m.id);
  const srLinks = msrIds.length ? await q(`select id,"reportIds","signedAt","revokedAt" from "ServiceReportSignLink" where "organizationId"=$1 and "reportIds" && $2::text[]`, [WCT, msrIds]) : [];
  const srMixed = srLinks.filter((l) => l.reportIds.some((r) => !msrIds.includes(r)));
  out(`  ServiceReportSignLink (guest service-report links): ${srLinks.length}${srMixed.length ? ` (${srMixed.length} also cover OTHER reports)` : ''}`);
  if (srMixed.length) stop('a service-report guest link also covers reports outside the test');
  // WhatsApp push short links (/go/<token>): path holds the record id (no FK).
  const allTargetIds = [...docIds, ...deliveryIds, ...orderIds, ...msrIds];
  const shortLinks = await q(`select id,path from "ShortLink" where "organizationId"=$1 and (${allTargetIds.map((_, i) => `path like '%' || $${i + 2} || '%'`).join(' or ')})`, [WCT, ...allTargetIds]);
  out(`  ShortLink (WhatsApp /go/ links to these records): ${shortLinks.length}`);
  del('CustomFieldValue', `entityId in jobs ${jobsLabel}`, cfv.length, 'the jobs’ Permit required / Permit approved values');
  del('DeliveryGroupPost', 'deliveryId in jobs', posts.length, 'WhatsApp group-post queue rows (status SKIPPED)');
  del('DeliverySiteClockJob', 'deliveryId in jobs', scRows.length, 'AIMS’s link rows to the SiteClock jobs (after the SiteClock step below)');
  del('ServiceReportSignLink', 'reportIds all within the test reports', srLinks.length, 'guest sign links of the test service reports');
  del('ShortLink', 'path points at a test record', shortLinks.length, 'WhatsApp /go/ links to the deleted records');
  const nService = msrs.filter((m) => m.reportNumber).length;
  del('MaintenanceServiceReport (+ DeliveryLocationPing cascade)', 'deliveryId in jobs', `${msrs.length} reports (${serviceNos} + ${msrs.length - nService} proof/draft), ${pings} pings`, `service reports ${serviceNos} and the DO_START / DO_ACK proof rows`);
  del('Delivery (+ DeliveryItem, DeliveryShareLink cascade)', `jobs ${jobsLabel}`, `${dels.length} jobs, ${items.length} items, ${dsl.length} links`, 'the test jobs');

  // ── 3. documents ──
  out('\n== 3. Documents');
  const docShare = await q(`select id,"documentId","revokedAt" from "DocumentShareLink" where "documentId"::text = any($1::text[])`, [docIds]);
  const docSign = await q(`select id,"documentId","signedAt" from "DocumentSignLink" where "documentId"::text = any($1::text[])`, [docIds]);
  const docItems = await n(`select count(*)::int n from "DocumentItem" where "documentId"::text = any($1::text[])`, [docIds]);
  const embeds = await n(`select count(*)::int n from "DocumentEmbedding" where "documentId"::text = any($1::text[])`, [docIds]).catch(() => 0);
  const priceHist = await n(`select count(*)::int n from "PriceHistory" where "documentId"::text = any($1::text[])`, [docIds]).catch(() => 0);
  const notes = await q(`select "entityId", count(*)::int n from "Notification" where "organizationId"=$1 and "entityId" = any($2::text[]) group by 1`, [WCT, [...docIds, ...deliveryIds, ...orderIds, ...msrs.map((m) => m.id), ...paymentIds]]);
  out(`  DocumentShareLink (guest DO links): ${docShare.length} (on ${docShare.map((s) => docs.find((d) => d.id === s.documentId)?.name).join(', ')}; cascade)`);
  out(`  DocumentSignLink: ${docSign.length}, DocumentItem: ${docItems}, DocumentEmbedding: ${embeds}, PriceHistory: ${priceHist}`);
  out(`  Notification (bell) rows: ${notes.reduce((s, x) => s + x.n, 0)}`);
  if (priceHist) stop('PriceHistory rows point at these documents (RESTRICT)');
  // Any OTHER document whose config mentions one of the targets (JSON links have no FK).
  const allIds = [...docIds, ...deliveryIds, ...orderIds, ...paymentIds];
  const jsonRefs = await q(`select id,name,type,"organizationId" from "Document" where not (id::text = any($1::text[])) and (${allIds.map((_, i) => `config::text like '%' || $${i + 2} || '%'`).join(' or ')})`, [docIds, ...allIds]);
  out(`  Other documents whose config mentions a target: ${jsonRefs.length ? jsonRefs.map((d) => `${d.name} (${d.type})`).join(', ') : 'none'}`);
  if (jsonRefs.length) stop('another document refers to a target');
  del('Notification', 'entityId in targets', notes.reduce((s, x) => s + x.n, 0), 'bell rows pointing at the deleted documents');
  del('Document INVOICE', RUNS.map((r) => r.invoice[1]).join(', '), invoiceIds.length, 'after their journals and payments');
  del('Document DELIVERY_ORDER (+ DocumentShareLink cascade)', RUNS.flatMap((r) => Object.keys(r.dos)).join(', '), `${doIds.length} DOs, ${docShare.length} guest links`, 'the jobs’ DOs');
  del('Document QUOTATION', RUNS.map((r) => r.quotation[1]).join(', '), RUNS.length, 'the test quotations');
  del('Order', RUNS.map((r) => r.order[1]).join(', '), RUNS.length, 'the test orders');

  // ── 4. the test customer, only if nothing else uses it ──
  out('\n== 4. Customer CT001 "TEST SiteClock"');
  const cust = await one(`select id,name,"customerCode","organizationId" from "Customer" where id=$1`, [T.customer]);
  out(`  ${cust?.customerCode} ${cust?.name}`);
  if (!cust || cust.organizationId !== WCT || cust.customerCode !== 'CT001') stop('customer is not WCT CT001');
  const custUse = {
    deliveries: await n(`select count(*)::int n from "Delivery" where "customerId"=$1 and not (id::text = any($2::text[]))`, [T.customer, deliveryIds]),
    orders: await n(`select count(*)::int n from "Order" where "customerId"=$1 and not (id::text = any($2::text[]))`, [T.customer, orderIds]),
    payments: await n(`select count(*)::int n from "Payment" where "customerId"=$1 and not (id::text = any($2::text[]))`, [T.customer, paymentIds]),
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
  const siteclockSide = [];
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
      siteclockSide.push(`#${no}: SiteClock job ${j.id} "${j.title ?? ''}" status ${j.status}, start ${j.startAt ?? j.scheduledStart ?? '?'}, crew ${(j.crew || []).map((x) => x?.user?.name ?? x?.name).join(',') || `${s.workerName ?? '?'} (AIMS assignment)`}`);
    } else if (j && j.status !== 'CANCELLED') {
      plan.push({ op: 'CANCEL', table: 'SiteClock job', where: `POST /v1/jobs/by-ref/${s.externalRef}/cancel`, ref: s.externalRef, rows: 1, why: `#${no} ${j.status}: soft cancel, gone from every SiteClock screen (SiteClock keeps it for history)` });
    } else out('      → already cancelled or missing; nothing to do');
  }

  // ── 7. every id-like column in the database, for every target id ──
  out('\n== 7. Reference sweep (every uuid/text column named *id / *Id / *ids, all tables)');
  const ids = new Map([
    ...docIds.map((id) => [id, byId.get(id)?.name ?? id]),
    ...dels.map((d) => [d.id, `delivery #${d.deliveryNumber}`]),
    ...RUNS.map((r) => [r.order[0], r.order[1]]),
    ...RUNS.map((r) => [r.payment[0], `payment on ${r.invoice[1]}`]),
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

  // ── 8. other test-like records (REPORT ONLY: never in the plan) ──
  out('\n== 8. Other test-like records in WCT (report only, NOT touched)');
  const tl = (rows, f) => (rows.length ? rows.map(f).join('\n    ') : 'none');
  const tDocs = await q(
    `select name,type,status,"createdAt", coalesce(config->>'referenceNo', config->'documentInfo'->>'referenceNo', '') ref from "Document"
     where "organizationId"=$1 and not (id::text = any($2::text[])) and (name ilike '%test%' or config->>'referenceNo' ilike '%test%' or config->'documentInfo'->>'referenceNo' ilike '%test%' or config->>'customerId'=$3 or config->'customer'->>'id'=$3)
     order by "createdAt"`,
    [WCT, docIds, T.customer],
  );
  out(`  Documents (name / reference mentions "test", or customer CT001): ${tDocs.length}\n    ${tl(tDocs, (d) => `${d.name} ${d.type} ${d.status} ref="${d.ref}" ${d.createdAt.toISOString().slice(0, 10)}`)}`);
  const tDels = await q(`select "deliveryNumber",status,"customerId"=$3 ct001,"createdAt" from "Delivery" where "organizationId"=$1 and not (id::text = any($2::text[])) and ("customerId"=$3 or notes ilike '%test%') order by "deliveryNumber"`, [WCT, deliveryIds, T.customer]).catch((e) => [{ err: e.message }]);
  out(`  Deliveries (customer CT001 or notes mention "test"): ${tDels.length}\n    ${tl(tDels, (d) => (d.err ? d.err : `#${d.deliveryNumber} ${d.status}${d.ct001 ? ' CT001' : ''} ${d.createdAt.toISOString().slice(0, 10)}`))}`);
  const tPays = await q(`select amount,"paymentMethod",notes,"createdAt" from "Payment" where "organizationId"=$1 and not (id::text = any($2::text[])) and (notes ilike '%test%' or "customerId"=$3)`, [WCT, paymentIds, T.customer]);
  out(`  Payments (note mentions "test", or customer CT001): ${tPays.length}\n    ${tl(tPays, (x) => `${x.amount} ${x.paymentMethod} "${x.notes}" ${x.createdAt.toISOString().slice(0, 10)}`)}`);
  const tOrders = await q(`select "orderNumber",status,"createdAt" from "Order" where "organizationId"=$1 and not (id::text = any($2::text[]))`, [WCT, orderIds]);
  out(`  Other WCT orders: ${tOrders.length}\n    ${tl(tOrders, (o) => `${o.orderNumber} ${o.status} ${o.createdAt.toISOString().slice(0, 10)}`)}`);
  const tCust = await q(`select "customerCode",name,"externalRef" from "Customer" where "organizationId"=$1 and id<>$2 and name ~* '\\mtest\\M'`, [WCT, T.customer]);
  out(`  Customers named "test" (the DP Info import is never touched): ${tCust.length}\n    ${tl(tCust, (x) => `${x.customerCode} ${x.name}${x.externalRef ? ` (imported, debtor ${x.externalRef})` : ''}`)}`);
  const tMsr = await q(`select "reportNumber",kind,status,"deliveryId" is null orphan,"createdAt" from "MaintenanceServiceReport" where "organizationId"=$1 and not ("deliveryId"::text = any($2::text[])) and "deliveryId" is null and kind='SERVICE' order by "createdAt"`, [WCT, deliveryIds]).catch(() => []);
  out(`  Service reports with no job: ${tMsr.length}\n    ${tl(tMsr, (m) => `#${m.reportNumber} ${m.status} ${m.createdAt.toISOString().slice(0, 10)}`)}`);

  // ── plan ──
  out('\n== PLAN (in this order, one transaction for the database part; nothing done by this run)');
  const sc = plan.filter((p) => p.table === 'SiteClock job');
  const db = plan.filter((p) => p.table !== 'SiteClock job');
  let i = 0;
  for (const p of sc) out(`  ${++i}. ${p.op.padEnd(6)} ${p.table}: ${p.where}  [${p.why}]`);
  if (!sc.length) out('  (no SiteClock job to cancel through the API)');
  for (const p of db) out(`  ${++i}. ${p.op.padEnd(6)} ${p.table}: ${p.where} → ${p.rows}  [${p.why}]`);
  out(`  ${++i}. INSERT ActionLog: one SYSTEM row "system:wct-order-flow-test-cleanup" listing what was removed`);
  out(`  KEPT: ActionLog + AuditLog history rows of these records; DocumentNumberFormat and all counters (gaps: ${RUNS.flatMap((r) => [r.order[1], r.quotation[1], ...Object.keys(r.dos), r.invoice[1]]).join(', ')}, ${jes.map((e) => e.journalNumber).join(', ')}); S3 files (photos, signatures, PDFs); the imported WCT customers.`);
  out('\n== NEEDS DELETING ON THE SITECLOCK SIDE (the AIMS API cannot do it)');
  out(siteclockSide.length ? siteclockSide.map((x) => `  ${x}`).join('\n') : `  #${T.siteclockSideDelete}: SiteClock not read (no key file); its job is completed and can only be removed in SiteClock`);
  if (MODE === 'dry') {
    out(`\n${problems ? `${problems} PROBLEM(S): fix before any apply` : 'No problems found.'} DRY RUN: nothing was written.`);
    await c.query('ROLLBACK');
    await c.end();
    return;
  }
  if (problems) {
    out(`\n${problems} PROBLEM(S): refusing to ${MODE}. Nothing written.`);
    await c.query('ROLLBACK');
    await c.end();
    process.exit(1);
  }

  // ── apply / rehearse: one transaction, every count checked ──
  out(`\n== ${MODE === 'rehearse' ? 'REHEARSAL' : 'APPLY'}: deletes in one transaction (orders before their documents)`);
  const msrIdsAll = msrs.map((m) => m.id);
  const quoteIds = RUNS.map((r) => r.quotation[0]);
  const noteIds = [...docIds, ...deliveryIds, ...orderIds, ...msrIdsAll, ...paymentIds];
  const ops = [
    ['JournalEntryLine (of the entries below)', `delete from "JournalEntryLine" where "journalEntryId"::text = any($1::text[])`, [jeIds], jeLines],
    ['JournalEntry', `delete from "JournalEntry" where "organizationId"=$2 and id::text = any($1::text[])`, [jeIds, WCT], jes.length],
    ['Payment', `delete from "Payment" where "organizationId"=$2 and id::text = any($1::text[])`, [paymentIds, WCT], paymentIds.length],
    ['CustomFieldValue', `delete from "CustomFieldValue" where id::text = any($1::text[])`, [cfv.map((v) => v.id)], cfv.length],
    ['DeliveryGroupPost', `delete from "DeliveryGroupPost" where id::text = any($1::text[])`, [posts.map((p) => p.id)], posts.length],
    ['DeliverySiteClockJob', `delete from "DeliverySiteClockJob" where id::text = any($1::text[])`, [scRows.map((r) => r.id)], scRows.length],
    ['ServiceReportSignLink', `delete from "ServiceReportSignLink" where id::text = any($1::text[])`, [srLinks.map((l) => l.id)], srLinks.length],
    ['ShortLink', `delete from "ShortLink" where id::text = any($1::text[])`, [shortLinks.map((l) => l.id)], shortLinks.length],
    ['DeliveryLocationPing (under the reports)', `delete from "DeliveryLocationPing" where "reportId"::text = any($1::text[])`, [msrIdsAll], pings],
    ['MaintenanceServiceReport', `delete from "MaintenanceServiceReport" where "organizationId"=$2 and id::text = any($1::text[])`, [msrIdsAll, WCT], msrs.length],
    ['DeliveryItem (of the jobs)', `delete from "DeliveryItem" where "deliveryId"::text = any($1::text[])`, [deliveryIds], items.length],
    ['DeliveryShareLink (of the jobs)', `delete from "DeliveryShareLink" where id::text = any($1::text[])`, [dsl.map((l) => l.id)], dsl.length],
    ['Delivery', `delete from "Delivery" where "organizationId"=$2 and id::text = any($1::text[])`, [deliveryIds, WCT], dels.length],
    ['Notification', `delete from "Notification" where "organizationId"=$2 and "entityId" = any($1::text[])`, [noteIds, WCT], notes.reduce((t, x) => t + x.n, 0)],
    ['Order', `delete from "Order" where "organizationId"=$2 and id::text = any($1::text[])`, [orderIds, WCT], orderIds.length],
    ['Document INVOICE', `delete from "Document" where "organizationId"=$2 and type='INVOICE' and id::text = any($1::text[])`, [invoiceIds, WCT], invoiceIds.length],
    ['DocumentShareLink (of the DOs)', `delete from "DocumentShareLink" where id::text = any($1::text[])`, [docShare.map((l) => l.id)], docShare.length],
    ['Document DELIVERY_ORDER', `delete from "Document" where "organizationId"=$2 and type='DELIVERY_ORDER' and id::text = any($1::text[])`, [doIds, WCT], doIds.length],
    ['Document QUOTATION', `delete from "Document" where "organizationId"=$2 and type='QUOTATION' and id::text = any($1::text[])`, [quoteIds, WCT], quoteIds.length],
  ];
  if (custFree) {
    ops.push(['CustomerContact (of CT001)', `delete from "CustomerContact" where "customerId"=$1`, [T.customer], contacts.length]);
    ops.push(['Customer CT001', `delete from "Customer" where "organizationId"=$2 and id=$1 and "customerCode"='CT001'`, [T.customer, WCT], 1]);
  }
  if (plan.some((p) => p.table.startsWith('Document QUOTATION (osiris-platform)'))) ops.push(['Document QUOTATION (osiris QO1202610-001)', `delete from "Document" where "organizationId"=$2 and id=$1`, [T.osirisQuote, OSIRIS], 1]);
  const done = [];
  try {
    for (const [label, sql, params, expected] of ops) {
      const r = await c.query(sql, params);
      done.push([label, r.rowCount, expected]);
      out(`  ${label.padEnd(46)} deleted ${String(r.rowCount).padStart(3)}  (dry run: ${expected})${r.rowCount === expected ? '' : '   <- MISMATCH'}`);
      if (r.rowCount !== expected) throw new Error(`${label}: deleted ${r.rowCount}, expected ${expected}`);
    }
    const left = await one(
      `select (select count(*) from "Document" where id::text = any($1::text[]))::int docs, (select count(*) from "Delivery" where id::text = any($2::text[]))::int jobs,
              (select count(*) from "JournalEntry" where id::text = any($3::text[]))::int jes, (select count(*) from "Order" where id::text = any($4::text[]))::int orders`,
      [docIds, deliveryIds, jeIds, orderIds],
    );
    out(`  left after the deletes: documents ${left.docs}, jobs ${left.jobs}, journals ${left.jes}, orders ${left.orders}`);
    if (left.docs || left.jobs || left.jes || left.orders) throw new Error('rows still there after the deletes');
    await c.query(
      `insert into "ActionLog" (id,"actorType","actorId","actorName","organizationId",channel,action,resource,details,status,"createdAt") values ($1,'SYSTEM','system:wct-order-flow-test-cleanup','System creation',$2,'operator','DELETE','OrderFlowTestData',$3::jsonb,'SUCCESS',now())`,
      [require('crypto').randomUUID(), WCT, JSON.stringify({ runs: RUNS.map((r) => r.order[1]), deleted: Object.fromEntries(done.map(([l, k]) => [l, k])), siteclockCancelled: sc.map((p) => p.ref), siteclockSide })],
    );
    out('  ActionLog: 1 row (system:wct-order-flow-test-cleanup)');
    if (MODE === 'rehearse') {
      await c.query('ROLLBACK');
      out('\nREHEARSAL OK: every count matched. ROLLBACK: nothing kept, SiteClock untouched.');
      await c.end();
      return;
    }
    // SiteClock cancel before COMMIT: a failure rolls the database part back.
    for (const p of sc) {
      const r = await fetch(`${conn.baseUrl.replace(/\/$/, '')}/v1/jobs/by-ref/${encodeURIComponent(p.ref)}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'AIMS test data cleanup' }),
      });
      const body = await r.json().catch(() => null);
      out(`  SiteClock cancel ${p.where}: HTTP ${r.status} status=${body?.job?.status ?? body?.error ?? '?'}`);
      if (!r.ok) throw new Error(`SiteClock cancel failed (HTTP ${r.status})`);
    }
    await c.query('COMMIT');
    out('\nAPPLIED: committed.');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    out(`\n!! ${e.message}. ROLLBACK: nothing written.`);
    await c.end();
    process.exit(1);
  }
  await c.end();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
