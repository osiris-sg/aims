/**
 * WCT: delete EVERY quotation and invoice and everything hanging off them
 * (all WCT quotations / invoices on prod are test data, owner 2026-11-02).
 *
 * The chain is found from the data, not listed by hand: the quotations and
 * invoices of WCT; the orders made from them; the jobs (deliveries) made from
 * the quotations / orders / invoices or carrying their DOs; those jobs' DOs;
 * the field and service reports on the jobs and documents; payments on the
 * invoices (RESTRICT) and the journals of every target document / payment;
 * credit notes pointing at the invoices; guest share / sign links, WhatsApp
 * group posts, short links, job photos, custom field values, the SiteClock
 * link rows and the bell notifications pointing at any of it.
 *
 * DRY RUN by default (READ ONLY transaction; SiteClock is only read):
 *   DBURL=<prod url, inline> SC_KEY_FILE=~/siteclock-wct-api-key.txt \
 *   NODE_PATH=$PWD/node_modules node scripts/purge-wct-quotes-invoices.js [--rehearse | --apply --confirm-prod]
 *
 * --rehearse: every DELETE in one transaction, each row count checked against
 *   the dry run, then ROLLBACK (nothing kept, SiteClock untouched).
 * --apply --confirm-prod: the same, cancels the SiteClock jobs that can be
 *   cancelled, then COMMIT. A count mismatch or a failed cancel rolls the
 *   whole database part back.
 *
 * Never touched: DocumentNumberFormat and every counter (number gaps are
 * fine), customers (the 3,969 imported ones and any other), ActionLog /
 * AuditLog history, S3 files. Other WCT documents (PO, receipts, …) are
 * reported, not deleted. The apply adds one ActionLog row.
 */
const fs = require('fs');
const os = require('os');
const { Client, types } = require('pg');

// Prisma writes DateTime as UTC into "timestamp without time zone": read it as UTC.
types.setTypeParser(1114, (v) => new Date(`${v.replace(' ', 'T')}Z`));

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const MODE = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--rehearse') ? 'rehearse' : 'dry';
if (MODE === 'apply' && !process.argv.includes('--confirm-prod')) {
  console.error('--apply needs --confirm-prod');
  process.exit(1);
}
const JOB = 'system:wct-quotes-invoices-purge';

let problems = 0;
const out = (s = '') => console.log(s);
const stop = (why) => {
  problems++;
  out(`  !! STOP: ${why}`);
};
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '-');
const money = (v) => (v === null || v === undefined || v === '' ? '-' : Number(v).toFixed(2));
const uniq = (a) => [...new Set(a.filter(Boolean))];

(async () => {
  const c = new Client({ connectionString: process.env.DBURL });
  await c.connect();
  await c.query(MODE === 'dry' ? 'BEGIN READ ONLY' : 'BEGIN');
  if (MODE !== 'dry') await c.query(`SET LOCAL idle_in_transaction_session_timeout = '15min'`);
  const q = async (sql, p = []) => {
    await c.query('SAVEPOINT s');
    try {
      const r = (await c.query(sql, p)).rows;
      await c.query('RELEASE SAVEPOINT s');
      return r;
    } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT s');
      throw new Error(`${e.message} in: ${sql.slice(0, 140)}`);
    }
  };
  const tryQ = (sql, p) => q(sql, p).catch(() => null);
  const one = async (sql, p) => (await q(sql, p))[0] ?? null;

  out(`WCT QUOTATIONS + INVOICES PURGE: ${MODE === 'dry' ? 'DRY RUN (read only; nothing is written)' : MODE === 'rehearse' ? 'REHEARSAL (deletes, then ROLLBACK)' : 'APPLY'}`);
  out(`run at ${new Date().toISOString()}`);
  const org = await one(`select id,name from "Organization" where id=$1`, [WCT]);
  out(`org: ${org?.name} (${WCT})`);
  if (!org) stop('WCT organisation not found');

  // ── 1. the chain, from the data ──
  const docCols = `id,type,name,status,"organizationId","createdAt", coalesce(config->>'referenceNo', config->'documentInfo'->>'referenceNo', config->>'reference', '') ref,
    coalesce(config->'customer'->>'name', config->>'customerName', config->'documentInfo'->>'customerName', '') cust,
    coalesce(config->>'totalWithTax', config->>'nettTotal', config->>'total') total, config->>'sourceDocumentId' src, "baseDocumentId"`;
  const quotes = await q(`select ${docCols} from "Document" where "organizationId"=$1 and type='QUOTATION' order by name`, [WCT]);
  const invoices = await q(`select ${docCols} from "Document" where "organizationId"=$1 and type='INVOICE' order by name`, [WCT]);
  const qIds = quotes.map((d) => d.id);
  // Self-test of the per-org abort (dry run only): one other org's document id slipped into the plan.
  if (process.env.PURGE_SELFTEST_FOREIGN_DOC) {
    if (MODE !== 'dry') throw new Error('PURGE_SELFTEST_FOREIGN_DOC is for the dry run only');
    qIds.push(process.env.PURGE_SELFTEST_FOREIGN_DOC);
    out(`  SELF-TEST: added a foreign document id to the quotations (expect an OTHER ORG abort)`);
  }
  const invIds = invoices.map((d) => d.id);
  const orders = await q(
    `select id,"orderNumber",status,"sourceQuotationId","invoiceDocumentId" from "Order" where "organizationId"=$1 and ("sourceQuotationId"::text = any($2::text[]) or "invoiceDocumentId"::text = any($3::text[]))`,
    [WCT, qIds, invIds],
  );
  const orderIds = orders.map((o) => o.id);
  const allOrders = await q(`select id,"orderNumber" from "Order" where "organizationId"=$1`, [WCT]);
  // DOs made from the quotations (config.sourceDocumentId) seed the job search too.
  const doFromQuote = await q(`select id from "Document" where "organizationId"=$1 and type in ('DELIVERY_ORDER','DO') and (config->>'sourceDocumentId' = any($2::text[]) or "baseDocumentId"::text = any($2::text[]))`, [WCT, qIds]);
  const seedDocs = uniq([...qIds, ...invIds, ...doFromQuote.map((d) => d.id)]);
  const dels = await q(
    `select d.id,d."deliveryNumber",d.status,d."isDraft",d."scheduledFor",d."sourceQuotationId",d."orderInvoiceId",d."orderId",d."createdAt",(select name from "Customer" where id=d."customerId") cust
       from "Delivery" d where d."organizationId"=$1 and (d."sourceQuotationId"::text = any($2::text[]) or d."orderInvoiceId"::text = any($3::text[]) or d."orderId"::text = any($4::text[])
         or d."documentId"::text = any($5::text[]) or exists (select 1 from "DeliveryItem" i where i."deliveryId"=d.id and i."documentId"::text = any($5::text[])))
       order by d."deliveryNumber"`,
    [WCT, qIds, invIds, orderIds, seedDocs],
  );
  const delIds = dels.map((d) => d.id);
  const items = delIds.length ? await q(`select id,"deliveryId","documentId","inventoryId" from "DeliveryItem" where "deliveryId"::text = any($1::text[])`, [delIds]) : [];
  const dos = await q(
    `select ${docCols} from "Document" where "organizationId"=$1 and type in ('DELIVERY_ORDER','DO') and (id::text = any($2::text[]) or config->>'sourceDocumentId' = any($3::text[]) or "baseDocumentId"::text = any($3::text[])) order by name`,
    [WCT, uniq(items.map((i) => i.documentId)), qIds],
  );
  const doIds = dos.map((d) => d.id);
  // Credit / debit notes against the invoices.
  const notesDocs = await q(
    `select ${docCols} from "Document" where "organizationId"=$1 and type in ('CREDIT_NOTE','CN','DEBIT_NOTE','DN') and (config->>'sourceDocumentId' = any($2::text[]) or config->>'invoiceId' = any($2::text[]) or "baseDocumentId"::text = any($2::text[]))`,
    [WCT, invIds],
  );
  const cnIds = notesDocs.map((d) => d.id);
  // Other WCT documents the owner named for deletion too (2026-11-02: the test PO).
  const EXTRA = [['PO', 'PO202610-0001']];
  const extraDocs = [];
  for (const [type, nm] of EXTRA) {
    const rows = await q(`select ${docCols} from "Document" where "organizationId"=$1 and type=$2 and name=$3`, [WCT, type, nm]);
    if (rows.length !== 1) stop(`${type} ${nm}: found ${rows.length} in WCT, expected 1`);
    extraDocs.push(...rows);
  }
  const extraIds = extraDocs.map((d) => d.id);
  const docIds = uniq([...qIds, ...invIds, ...doIds, ...cnIds, ...extraIds]);
  const allDocs = [...quotes, ...invoices, ...dos, ...notesDocs, ...extraDocs];
  const name = new Map(allDocs.map((d) => [d.id, d.name]));
  if (allDocs.some((d) => d.organizationId !== WCT)) stop('a target document is not WCT’s');

  out('\n== 1. Quotations');
  for (const d of quotes) out(`  ${d.name.padEnd(15)} ${day(d.createdAt)}  ${d.status.padEnd(12)} total ${money(d.total).padStart(9)}  ${d.cust || '-'}  ref "${d.ref}"`);
  out(`  ${quotes.length} quotations`);
  out('\n== 2. Invoices');
  for (const d of invoices) out(`  ${d.name.padEnd(15)} ${day(d.createdAt)}  ${d.status.padEnd(12)} total ${money(d.total).padStart(9)}  ${d.cust || '-'}  ref "${d.ref}"  from ${name.get(d.src) ?? (d.src ? d.src.slice(0, 8) : '-')}`);
  out(`  ${invoices.length} invoices`);
  out('\n== 3. Hanging off them');
  out(`  Orders: ${orders.length ? orders.map((o) => `${o.orderNumber} (${o.status})`).join(', ') : 'none'}  (WCT has ${allOrders.length} order(s) in total)`);
  out(`  Jobs (deliveries): ${dels.length}`);
  for (const d of dels) {
    const docsOf = uniq(items.filter((i) => i.deliveryId === d.id).map((i) => name.get(i.documentId) ?? (i.documentId ? i.documentId.slice(0, 8) : null)));
    out(`    #${String(d.deliveryNumber).padEnd(3)} ${d.status.padEnd(12)}${d.isDraft ? ' draft' : ''} ${day(d.scheduledFor ?? d.createdAt)}  ${d.cust ?? '-'}  from ${name.get(d.sourceQuotationId) ?? '-'}  DO ${docsOf.join(', ') || '-'}  ${items.filter((i) => i.deliveryId === d.id).length} lines`);
  }
  if (items.some((i) => i.inventoryId)) stop('a job has a stock unit bound (stock moved): needs a stock reversal, not a delete');
  out(`  Delivery orders: ${dos.map((d) => `${d.name} (${d.status})`).join(', ') || 'none'}`);
  out(`  Credit / debit notes: ${notesDocs.map((d) => d.name).join(', ') || 'none'}`);
  out(`  Also deleted at the owner's request: ${extraDocs.map((d) => `${d.type} ${d.name} (${day(d.createdAt)}, ${d.status})`).join(', ') || 'none'}`);

  const msrs = await q(
    `select id,"reportNumber",kind,status,"deliveryId","documentId","invoiceDocumentId","organizationId" from "MaintenanceServiceReport"
      where "deliveryId"::text = any($1::text[]) or "documentId"::text = any($2::text[]) or "invoiceDocumentId"::text = any($2::text[])`,
    [delIds, docIds],
  );
  const msrIds = msrs.map((m) => m.id);
  if (msrs.some((m) => m.organizationId !== WCT)) stop('a report is not WCT’s');
  const byKind = {};
  for (const m of msrs) byKind[`${m.kind} ${m.status}`] = (byKind[`${m.kind} ${m.status}`] || 0) + 1;
  out(`  Service / field reports: ${msrs.length}  ${JSON.stringify(byKind)}${msrs.some((m) => m.reportNumber) ? `  numbered: ${msrs.filter((m) => m.reportNumber).map((m) => `#${m.reportNumber}`).join(' ')}` : ''}`);
  const pings = msrIds.length ? Number((await one(`select count(*)::int n from "DeliveryLocationPing" where "reportId"::text = any($1::text[])`, [msrIds])).n) : 0;

  const payments = await q(`select id,amount,"paymentMethod",notes,"documentId" from "Payment" where "documentId"::text = any($1::text[])`, [docIds]);
  const payIds = payments.map((p) => p.id);
  out(`  Payments: ${payments.length ? payments.map((p) => `${money(p.amount)} ${p.paymentMethod} on ${name.get(p.documentId)}`).join(', ') : 'none'}`);
  const lock = await one(`select "lockedThroughDate" from "AccountingSetting" where "organizationId"=$1`, [WCT]).catch(() => null);
  const jes = await q(
    `select e.id,e."journalNumber",e.type,e.status,e."entryDate",e."totalDebit",e."sourceDocumentId",e."sourcePaymentId",
       (select json_agg(json_build_object('a', a.code || ' ' || a.name, 'dr', l.debit, 'cr', l.credit) order by l."lineNumber") from "JournalEntryLine" l left join "ChartOfAccount" a on a.id=l."accountId" where l."journalEntryId"=e.id) lines
     from "JournalEntry" e where e."organizationId"=$1 and (e."sourceDocumentId"::text = any($2::text[]) or e."sourcePaymentId"::text = any($3::text[])
       or e."reversesEntryId" in (select id from "JournalEntry" where "sourceDocumentId"::text = any($2::text[])))
     order by e."journalNumber"`,
    [WCT, docIds, payIds],
  );
  const jeIds = jes.map((e) => e.id);
  out(`  Journals: ${jes.length}`);
  for (const e of jes) {
    out(`    ${e.journalNumber} ${e.type} ${e.status} ${day(e.entryDate)} ${money(e.totalDebit)} from ${name.get(e.sourceDocumentId) ?? e.sourceDocumentId}`);
    for (const l of e.lines || []) out(`        ${(l.a || '?').padEnd(36)} Dr ${money(l.dr).padStart(9)}  Cr ${money(l.cr).padStart(9)}`);
    if (lock?.lockedThroughDate && new Date(e.entryDate) <= new Date(lock.lockedThroughDate)) stop(`${e.journalNumber} is inside the locked period (through ${day(lock.lockedThroughDate)}): it can only be voided`);
  }
  const allJes = await q(`select "journalNumber",type,status,"sourceDocumentId" from "JournalEntry" where "organizationId"=$1 and not (id::text = any($2::text[]))`, [WCT, jeIds]);
  out(`  Other WCT journals (not touched): ${allJes.length ? allJes.map((e) => `${e.journalNumber} ${e.type} ${e.status}`).join(', ') : 'none'}`);
  const jeLines = jeIds.length ? Number((await one(`select count(*)::int n from "JournalEntryLine" where "journalEntryId"::text = any($1::text[])`, [jeIds])).n) : 0;
  const jeRefs = jeIds.length ? await q(`select "journalNumber" from "JournalEntry" where "reversesEntryId"::text = any($1::text[]) and not (id::text = any($1::text[]))`, [jeIds]) : [];
  if (jeRefs.length) stop(`other journals reverse these: ${jeRefs.map((r) => r.journalNumber).join(', ')}`);
  const txns = (await tryQ(`select id from "Transaction" where "documentId"::text = any($1::text[]) or "paymentId"::text = any($2::text[])`, [docIds, payIds])) ?? [];
  const priceHist = Number((await tryQ(`select count(*)::int n from "PriceHistory" where "documentId"::text = any($1::text[])`, [docIds]))?.[0]?.n ?? 0);
  if (priceHist) stop(`${priceHist} PriceHistory rows point at these documents (RESTRICT): not in the plan`);

  // Links, posts, photos, field values, notifications.
  const docShare = await q(`select id,"documentId","revokedAt" from "DocumentShareLink" where "documentId"::text = any($1::text[])`, [docIds]);
  const docSign = await q(`select id,"documentId","signedAt","revokedAt" from "DocumentSignLink" where "documentId"::text = any($1::text[])`, [docIds]);
  const delShare = await q(`select id,"deliveryId","documentId" from "DeliveryShareLink" where "deliveryId"::text = any($1::text[]) or "documentId"::text = any($2::text[])`, [delIds, docIds]);
  const srLinks = msrIds.length ? await q(`select id,"reportIds" from "ServiceReportSignLink" where "organizationId"=$1 and "reportIds" && $2::text[]`, [WCT, msrIds]) : [];
  if (srLinks.some((l) => (l.reportIds || []).some((r) => !msrIds.includes(r)))) stop('a service-report sign link also covers reports outside the purge');
  const posts = delIds.length ? await q(`select id,status from "DeliveryGroupPost" where "deliveryId"::text = any($1::text[])`, [delIds]) : [];
  const allPosts = await q(`select count(*)::int n from "DeliveryGroupPost" where "organizationId"=$1`, [WCT]);
  const photos = delIds.length ? await q(`select id,tag,"deletedAt" from "JobPhoto" where "organizationId"=$1 and "deliveryId"::text = any($2::text[])`, [WCT, delIds]) : [];
  const cfv = delIds.length ? await q(`select id from "CustomFieldValue" where "entityId"::text = any($1::text[])`, [delIds]) : [];
  const scRows = delIds.length ? await q(`select id,"deliveryId","externalRef","siteclockJobId","workerName","lastPushedStatus" from "DeliverySiteClockJob" where "organizationId"=$1 and "deliveryId"::text = any($2::text[])`, [WCT, delIds]) : [];
  const targetIds = uniq([...docIds, ...delIds, ...orderIds, ...msrIds, ...payIds]);
  const shortLinks = (await tryQ(`select id,path from "ShortLink" where "organizationId"=$1 and exists (select 1 from unnest($2::text[]) t where "ShortLink".path like '%' || t || '%')`, [WCT, targetIds])) ?? [];
  const notifs = await q(`select id,kind,"entityType" from "Notification" where "organizationId"=$1 and "entityId" = any($2::text[])`, [WCT, targetIds]);
  const allNotifs = await q(`select count(*)::int n from "Notification" where "organizationId"=$1`, [WCT]);
  out(`  Guest links: ${docShare.length} DO/doc share, ${docSign.length} quotation sign, ${delShare.length} delivery share, ${srLinks.length} service-report sign, ${shortLinks.length} short links`);
  out(`  WhatsApp group posts: ${posts.length} (WCT has ${allPosts[0].n})   Job photos: ${photos.length}   Custom field values: ${cfv.length}`);
  out(`  Notifications pointing at these: ${notifs.length} (WCT has ${allNotifs[0].n})`);
  if (txns.length) out(`  Customer ledger rows (Transaction): ${txns.length}`);

  // SiteClock: link rows, and SiteClock itself for every job (a job may exist without a link row).
  out('\n== 4. SiteClock');
  out(`  AIMS link rows (DeliverySiteClockJob): ${scRows.length}`);
  const sc = [];
  const siteclockSide = [];
  const conn = await one(`select "baseUrl",enabled from "SiteClockConnection" where "organizationId"=$1`, [WCT]);
  const keyFile = (process.env.SC_KEY_FILE || '').replace(/^~/, os.homedir());
  const raw = keyFile && fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8') : '';
  const key = (raw.match(/^SITECLOCK_API_KEY=(.+)$/m)?.[1] ?? (raw.includes('=') ? '' : raw)).trim(); // never printed
  if (!conn || !key) out('  SiteClock not read (no connection or no SC_KEY_FILE)');
  else {
    const refs = uniq([...scRows.map((s) => s.externalRef), ...delIds.map((id) => `aims-delivery:${id}`)]);
    for (const ref of refs) {
      const d = dels.find((x) => ref.includes(x.id));
      const r = await fetch(`${conn.baseUrl.replace(/\/$/, '')}/v1/jobs/by-ref/${encodeURIComponent(ref)}`, { headers: { Authorization: `Bearer ${key}` } }).catch((e) => ({ status: 0, json: async () => ({ error: e.message }) }));
      const body = await r.json().catch(() => null);
      const j = body?.job;
      if (r.status === 404 || !j) {
        if (r.status !== 404) stop(`SiteClock lookup for #${d?.deliveryNumber} failed (HTTP ${r.status})`);
        continue;
      }
      out(`  #${d?.deliveryNumber}: SiteClock job ${j.id} status ${j.status}`);
      if (j.status === 'COMPLETED') siteclockSide.push(`#${d?.deliveryNumber}: SiteClock job ${j.id} "${j.title ?? ''}" COMPLETED`);
      else if (j.status !== 'CANCELLED') sc.push({ ref, label: `#${d?.deliveryNumber}` });
    }
    out(`  SiteClock jobs found: ${sc.length + siteclockSide.length} (to cancel via /v1: ${sc.length}; completed, to delete on the SiteClock side: ${siteclockSide.length})`);
  }

  // ── 5. every id-like column in the database, for every target id ──
  out('\n== 5. Reference sweep (every uuid/text column named *id / *Id / *ids, all tables)');
  const label = new Map([
    ...allDocs.map((d) => [d.id, d.name]),
    ...dels.map((d) => [d.id, `job #${d.deliveryNumber}`]),
    ...orders.map((o) => [o.id, o.orderNumber]),
    ...payments.map((p) => [p.id, `payment on ${name.get(p.documentId)}`]),
    ...jes.map((e) => [e.id, e.journalNumber]),
    ...msrs.map((m) => [m.id, `report ${m.kind}`]),
  ]);
  const handled = /^(ActionLog\.resourceId|AuditLog\.resourceId|Notification\.entityId|CustomFieldValue\.entityId|DeliveryGroupPost\.(deliveryId|documentIds)|ServiceReportSignLink\.reportIds|DeliverySiteClockJob\.deliveryId|JobPhoto\.deliveryId|DeliveryItem\.(id|deliveryId|documentId)|DeliveryLocationPing\.reportId|MaintenanceServiceReport\.(id|deliveryId|documentId|invoiceDocumentId)|Delivery\.(id|orderId|orderInvoiceId|sourceQuotationId|documentId)|Document\.(id|baseDocumentId)|DocumentShareLink\.documentId|DocumentSignLink\.documentId|DeliveryShareLink\.(deliveryId|documentId)|DocumentItem\.documentId|DocumentEmbedding\.documentId|Order\.(id|invoiceDocumentId|sourceQuotationId)|Payment\.(id|documentId)|JournalEntry\.(id|sourceDocumentId|sourcePaymentId)|JournalEntryLine\.journalEntryId|Transaction\.(documentId|paymentId))$/;
  const cols = await q(`select table_name t, column_name col, data_type dt from information_schema.columns where table_schema='public' and data_type in ('uuid','text','ARRAY') and (column_name ilike '%id' or column_name ilike '%ids') and table_name not like '\\_%'`);
  const idList = [...label.keys()];
  const unhandled = [];
  let scanned = 0;
  const covered = new Map();
  for (const { t, col, dt } of cols) {
    const rows =
      dt === 'ARRAY'
        ? await tryQ(`select x::text v, count(*)::int n from "${t}", unnest("${col}") x where x::text = any($1::text[]) group by 1`, [idList])
        : await tryQ(`select "${col}"::text v, count(*)::int n from "${t}" where "${col}"::text = any($1::text[]) group by 1`, [idList]);
    if (rows) scanned++;
    else out(`  (could not read ${t}.${col})`);
    for (const r of rows || []) {
      const line = `${t}.${col} -> ${label.get(r.v)}: ${r.n}`;
      if (handled.test(`${t}.${col}`)) {
        covered.set(`${t}.${col}`, (covered.get(`${t}.${col}`) || 0) + r.n);
        continue;
      }
      unhandled.push(line);
      out(`  ${line}   <- NOT IN THE PLAN`);
    }
  }
  // Ids inside another document's config (e.g. a document copied from a target).
  const jsonRefs = await q(
    `select name,type from "Document" where "organizationId"=$1 and not (id::text = any($2::text[])) and exists (select 1 from unnest($2::text[]) t where "Document".config::text like '%' || t || '%')`,
    [WCT, docIds],
  );
  for (const d of jsonRefs) {
    unhandled.push(`${d.type} ${d.name} config mentions a target`);
    out(`  ${d.type} ${d.name}: its config mentions a target document   <- NOT IN THE PLAN`);
  }
  for (const [k, n] of [...covered].sort()) out(`  ${k.padEnd(44)} ${String(n).padStart(4)}${/^(ActionLog|AuditLog)\./.test(k) ? '  (history, kept)' : ''}`);
  if (unhandled.length) stop(`${unhandled.length} reference(s) outside the plan`);
  else out(`  ${scanned} of ${cols.length} columns scanned; every reference found is covered by the plan (or is kept history: ActionLog / AuditLog)`);

  // ── 6. other WCT documents and records (REPORT ONLY) ──
  out('\n== 6. Other WCT documents (report only, NOT touched)');
  const others = await q(`select ${docCols} from "Document" where "organizationId"=$1 and not (id::text = any($2::text[])) order by type,name`, [WCT, docIds]);
  for (const d of others) out(`  ${d.type.padEnd(14)} ${d.name.padEnd(15)} ${day(d.createdAt)} ${d.status} total ${money(d.total)} ${d.cust || '-'} ref "${d.ref}"`);
  if (!others.length) out('  none');
  const otherJobs = await q(`select "deliveryNumber",status,"createdAt" from "Delivery" where "organizationId"=$1 and not (id::text = any($2::text[]))`, [WCT, delIds]);
  out(`  Other jobs: ${otherJobs.length ? otherJobs.map((d) => `#${d.deliveryNumber} ${d.status}`).join(', ') : 'none'}`);
  const otherMsr = await q(`select kind,status,count(*)::int n from "MaintenanceServiceReport" where "organizationId"=$1 and not (id::text = any($2::text[])) group by 1,2`, [WCT, msrIds]);
  out(`  Other reports: ${otherMsr.length ? JSON.stringify(otherMsr) : 'none'}`);
  const custs = await one(`select count(*)::int n, count(*) filter (where "externalRef" is not null)::int imported from "Customer" where "organizationId"=$1`, [WCT]);
  const local = await q(`select "customerCode",name,"createdAt" from "Customer" where "organizationId"=$1 and "externalRef" is null`, [WCT]);
  out(`  Customers: ${custs.n} (${custs.imported} imported) + not imported: ${local.map((x) => `${x.customerCode} "${x.name}" (${day(x.createdAt)})`).join(', ') || 'none'}  -> all KEPT`);

  // ── 7. numbering after the delete (nothing is changed) ──
  out('\n== 7. Numbering (DocumentNumberFormat; NOT changed)');
  const fmts = await q(`select "documentType",label,pattern,"nextSerial","resetPolicy","lastResetKey","isActive" from "DocumentNumberFormat" where "organizationId"=$1 order by "documentType","sortOrder"`, [WCT]);
  for (const f of fmts) out(`  ${f.documentType.padEnd(16)} ${String(f.pattern).padEnd(28)} nextSerial=${f.nextSerial} reset=${f.resetPolicy} lastResetKey=${f.lastResetKey ?? '-'}${f.isActive ? '' : ' (inactive)'}`);
  const acct = await one(`select "nextNumbers","numberPrefixes" from "AccountingSetting" where "organizationId"=$1`, [WCT]).catch(() => null);
  if (acct) out(`  AccountingSetting.nextNumbers: ${JSON.stringify(acct.nextNumbers)}`);

  // ── 8. the plan ──
  // Every step: [label, delete sql, params, expected rows, per-org count sql].
  // Each DELETE is itself limited to WCT (directly, or through its parent row
  // for tables without an organizationId), and the per-org count proves that
  // every row of the plan is WCT's before anything runs: one row of another
  // org aborts the whole run.
  const W = WCT;
  const viaDoc = (col = '"documentId"') => `(select "organizationId" from "Document" d where d.id = t.${col})`;
  const viaDel = `(select "organizationId" from "Delivery" d where d.id = t."deliveryId")`;
  const ids = (rows) => rows.map((r) => r.id);
  const ops = [
    ['JournalEntryLine (of the journals)', `delete from "JournalEntryLine" t where t."journalEntryId"::text = any($1::text[]) and t."journalEntryId" in (select id from "JournalEntry" where "organizationId"=$2)`, [jeIds, W], jeLines,
      `select (select "organizationId" from "JournalEntry" e where e.id = t."journalEntryId") org, count(*)::int n from "JournalEntryLine" t where t."journalEntryId"::text = any($1::text[]) group by 1`, [jeIds]],
    ['JournalEntry', `delete from "JournalEntry" where "organizationId"=$2 and id::text = any($1::text[])`, [jeIds, W], jes.length, `select "organizationId" org, count(*)::int n from "JournalEntry" where id::text = any($1::text[]) group by 1`, [jeIds]],
    ['Transaction (customer ledger)', `delete from "Transaction" where "organizationId"=$2 and id::text = any($1::text[])`, [ids(txns), W], txns.length, `select "organizationId" org, count(*)::int n from "Transaction" where id::text = any($1::text[]) group by 1`, [ids(txns)]],
    ['Payment', `delete from "Payment" where "organizationId"=$2 and id::text = any($1::text[])`, [payIds, W], payments.length, `select "organizationId" org, count(*)::int n from "Payment" where id::text = any($1::text[]) group by 1`, [payIds]],
    ['CustomFieldValue', `delete from "CustomFieldValue" t where id::text = any($1::text[]) and t."entityId" in (select id from "Delivery" where "organizationId"=$2)`, [ids(cfv), W], cfv.length,
      `select (select "organizationId" from "Delivery" d where d.id::text = t."entityId"::text) org, count(*)::int n from "CustomFieldValue" t where id::text = any($1::text[]) group by 1`, [ids(cfv)]],
    ['DeliveryGroupPost', `delete from "DeliveryGroupPost" where "organizationId"=$2 and id::text = any($1::text[])`, [ids(posts), W], posts.length, `select "organizationId" org, count(*)::int n from "DeliveryGroupPost" where id::text = any($1::text[]) group by 1`, [ids(posts)]],
    ['JobPhoto (rows; S3 files kept)', `delete from "JobPhoto" where "organizationId"=$2 and id::text = any($1::text[])`, [ids(photos), W], photos.length, `select "organizationId" org, count(*)::int n from "JobPhoto" where id::text = any($1::text[]) group by 1`, [ids(photos)]],
    ['DeliverySiteClockJob', `delete from "DeliverySiteClockJob" where "organizationId"=$2 and id::text = any($1::text[])`, [ids(scRows), W], scRows.length, `select "organizationId" org, count(*)::int n from "DeliverySiteClockJob" where id::text = any($1::text[]) group by 1`, [ids(scRows)]],
    ['ServiceReportSignLink', `delete from "ServiceReportSignLink" where "organizationId"=$2 and id::text = any($1::text[])`, [ids(srLinks), W], srLinks.length, `select "organizationId" org, count(*)::int n from "ServiceReportSignLink" where id::text = any($1::text[]) group by 1`, [ids(srLinks)]],
    ['ShortLink', `delete from "ShortLink" where "organizationId"=$2 and id::text = any($1::text[])`, [ids(shortLinks), W], shortLinks.length, `select "organizationId" org, count(*)::int n from "ShortLink" where id::text = any($1::text[]) group by 1`, [ids(shortLinks)]],
    ['DeliveryLocationPing (under the reports)', `delete from "DeliveryLocationPing" t where t."reportId"::text = any($1::text[]) and t."reportId" in (select id from "MaintenanceServiceReport" where "organizationId"=$2)`, [msrIds, W], pings,
      `select (select "organizationId" from "MaintenanceServiceReport" m where m.id = t."reportId") org, count(*)::int n from "DeliveryLocationPing" t where t."reportId"::text = any($1::text[]) group by 1`, [msrIds]],
    ['MaintenanceServiceReport', `delete from "MaintenanceServiceReport" where "organizationId"=$2 and id::text = any($1::text[])`, [msrIds, W], msrs.length, `select "organizationId" org, count(*)::int n from "MaintenanceServiceReport" where id::text = any($1::text[]) group by 1`, [msrIds]],
    ['DeliveryShareLink', `delete from "DeliveryShareLink" t where id::text = any($1::text[]) and coalesce(${viaDel}, ${viaDoc()}) = $2`, [ids(delShare), W], delShare.length,
      `select coalesce(${viaDel}, ${viaDoc()}) org, count(*)::int n from "DeliveryShareLink" t where id::text = any($1::text[]) group by 1`, [ids(delShare)]],
    ['DeliveryItem (of the jobs)', `delete from "DeliveryItem" t where t."deliveryId"::text = any($1::text[]) and ${viaDel} = $2`, [delIds, W], items.length,
      `select ${viaDel} org, count(*)::int n from "DeliveryItem" t where t."deliveryId"::text = any($1::text[]) group by 1`, [delIds]],
    ['Delivery (jobs)', `delete from "Delivery" where "organizationId"=$2 and id::text = any($1::text[])`, [delIds, W], dels.length, `select "organizationId" org, count(*)::int n from "Delivery" where id::text = any($1::text[]) group by 1`, [delIds]],
    ['Notification', `delete from "Notification" where "organizationId"=$2 and id::text = any($1::text[])`, [ids(notifs), W], notifs.length, `select "organizationId" org, count(*)::int n from "Notification" where id::text = any($1::text[]) group by 1`, [ids(notifs)]],
    ['Order', `delete from "Order" where "organizationId"=$2 and id::text = any($1::text[])`, [orderIds, W], orders.length, `select "organizationId" org, count(*)::int n from "Order" where id::text = any($1::text[]) group by 1`, [orderIds]],
    ['DocumentShareLink', `delete from "DocumentShareLink" t where id::text = any($1::text[]) and ${viaDoc()} = $2`, [ids(docShare), W], docShare.length,
      `select ${viaDoc()} org, count(*)::int n from "DocumentShareLink" t where id::text = any($1::text[]) group by 1`, [ids(docShare)]],
    ['DocumentSignLink', `delete from "DocumentSignLink" t where id::text = any($1::text[]) and ${viaDoc()} = $2`, [ids(docSign), W], docSign.length,
      `select ${viaDoc()} org, count(*)::int n from "DocumentSignLink" t where id::text = any($1::text[]) group by 1`, [ids(docSign)]],
    ['Document CREDIT/DEBIT NOTE', `delete from "Document" where "organizationId"=$2 and id::text = any($1::text[])`, [cnIds, W], cnIds.length, `select "organizationId" org, count(*)::int n from "Document" where id::text = any($1::text[]) group by 1`, [cnIds]],
    ['Document INVOICE', `delete from "Document" where "organizationId"=$2 and type='INVOICE' and id::text = any($1::text[])`, [invIds, W], invIds.length, `select "organizationId" org, count(*)::int n from "Document" where id::text = any($1::text[]) group by 1`, [invIds]],
    ['Document DELIVERY_ORDER', `delete from "Document" where "organizationId"=$2 and type in ('DELIVERY_ORDER','DO') and id::text = any($1::text[])`, [doIds, W], doIds.length, `select "organizationId" org, count(*)::int n from "Document" where id::text = any($1::text[]) group by 1`, [doIds]],
    ['Document QUOTATION', `delete from "Document" where "organizationId"=$2 and type='QUOTATION' and id::text = any($1::text[])`, [qIds, W], qIds.length, `select "organizationId" org, count(*)::int n from "Document" where id::text = any($1::text[]) group by 1`, [qIds]],
    ['Document PO (named by the owner)', `delete from "Document" where "organizationId"=$2 and type='PO' and id::text = any($1::text[])`, [extraIds, W], extraIds.length, `select "organizationId" org, count(*)::int n from "Document" where id::text = any($1::text[]) group by 1`, [extraIds]],
    // Cascades with their documents: counted so the proof covers them too.
    ['DocumentItem (cascade with the documents)', null, null, null, `select ${viaDoc()} org, count(*)::int n from "DocumentItem" t where t."documentId"::text = any($1::text[]) group by 1`, [docIds]],
    ['DocumentEmbedding (cascade with the documents)', null, null, null, `select ${viaDoc()} org, count(*)::int n from "DocumentEmbedding" t where t."documentId"::text = any($1::text[]) group by 1`, [docIds]],
  ];

  // ── per-org proof: every row in the plan is WCT's ──
  const orgName = new Map((await q(`select id,name from "Organization"`)).map((o) => [o.id, o.name]));
  const proveOrgs = async (heading) => {
    out(heading);
    out(`  ${'step'.padEnd(46)} ${'WCT'.padStart(5)} ${'other org'.padStart(10)}  ${'expected'.padStart(8)}`);
    let wctTotal = 0;
    let otherTotal = 0;
    for (const op of ops) {
      const [l, , , expected, sql, p] = op;
      const rows = (await tryQ(sql, p)) ?? [{ org: 'UNREADABLE', n: -1 }];
      const wct = rows.filter((r) => r.org === WCT).reduce((s, r) => s + r.n, 0);
      const other = rows.filter((r) => r.org !== WCT);
      const otherN = other.reduce((s, r) => s + Math.abs(r.n), 0);
      wctTotal += wct;
      otherTotal += otherN;
      if (expected === null) op[3] = wct; // cascades: what the delete takes with it
      out(`  ${l.padEnd(46)} ${String(wct).padStart(5)} ${String(otherN).padStart(10)}  ${String(op[3]).padStart(8)}${otherN ? `   <- OTHER ORG: ${other.map((r) => `${orgName.get(r.org) ?? r.org ?? '(no org)'} ${r.n}`).join(', ')}` : ''}`);
      if (otherN) stop(`${l}: ${otherN} row(s) not WCT's`);
      if (expected !== null && wct !== expected) stop(`${l}: ${wct} WCT rows, the plan has ${expected}`);
    }
    out(`  ${'TOTAL'.padEnd(46)} ${String(wctTotal).padStart(5)} ${String(otherTotal).padStart(10)}   -> ${otherTotal ? 'NOT 100% WCT: abort' : '100% WCT'}`);
    return otherTotal;
  };
  await proveOrgs('\n== 8. Per-org proof (every row the plan deletes, counted by organisation)');
  out('\n== 9. Plan (one transaction, children first)');
  let i = 0;
  for (const [l, sql, , n] of ops) if (n && sql) out(`  ${++i}. DELETE ${l.padEnd(42)} ${n}`);
  out(`  ${++i}. (cascades: DocumentItem / DocumentEmbedding with their documents)`);
  for (const p of sc) out(`  ${++i}. SiteClock: POST /v1/jobs/by-ref/<ref>/cancel for ${p.label} (soft cancel)`);
  out(`  ${++i}. INSERT ActionLog: one SYSTEM row "${JOB}"`);
  out('  KEPT: customers, DocumentNumberFormat + counters, ActionLog / AuditLog history, S3 files, other WCT documents (section 6).');
  out('\n== NEEDS DELETING ON THE SITECLOCK SIDE (the API cannot)');
  out(siteclockSide.length ? siteclockSide.map((x) => `  ${x}`).join('\n') : '  none');

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

  out(`\n== ${MODE === 'rehearse' ? 'REHEARSAL' : 'APPLY'}`);
  // Prove it again inside the write transaction, right before the deletes.
  if (await proveOrgs('  re-check inside the transaction:')) {
    await c.query('ROLLBACK');
    out('\nNOT 100% WCT: refusing. ROLLBACK: nothing written.');
    await c.end();
    process.exit(1);
  }
  if (problems) {
    await c.query('ROLLBACK');
    out(`\n${problems} PROBLEM(S) in the re-check: ROLLBACK, nothing written.`);
    await c.end();
    process.exit(1);
  }
  const done = [];
  try {
    for (const [l, sql, params, expected] of ops) {
      if (!expected || !sql) continue;
      const r = await c.query(sql, params);
      done.push([l, r.rowCount]);
      out(`  ${l.padEnd(44)} deleted ${String(r.rowCount).padStart(4)}  (dry run: ${expected})${r.rowCount === expected ? '' : '   <- MISMATCH'}`);
      if (r.rowCount !== expected) throw new Error(`${l}: deleted ${r.rowCount}, expected ${expected}`);
    }
    const left = await one(
      `select (select count(*) from "Document" where "organizationId"=$1 and (type in ('QUOTATION','INVOICE') or id::text = any($2::text[])))::int qi, (select count(*) from "Document" where id::text = any($2::text[]))::int docs,
              (select count(*) from "Delivery" where id::text = any($3::text[]))::int jobs, (select count(*) from "JournalEntry" where id::text = any($4::text[]))::int jes`,
      [WCT, docIds, delIds, jeIds],
    );
    out(`  left: WCT quotations+invoices ${left.qi}, target documents ${left.docs}, jobs ${left.jobs}, journals ${left.jes}`);
    if (left.qi || left.docs || left.jobs || left.jes) throw new Error('rows still there after the deletes');
    await c.query(
      `insert into "ActionLog" (id,"actorType","actorId","actorName","organizationId",channel,action,resource,details,status,"createdAt") values ($1,'SYSTEM',$2,'System creation',$3,'operator','DELETE','WctQuotesInvoicesPurge',$4::jsonb,'SUCCESS',now())`,
      [require('crypto').randomUUID(), JOB, WCT, JSON.stringify({ quotations: quotes.map((d) => d.name), invoices: invoices.map((d) => d.name), alsoDeleted: extraDocs.map((d) => d.name), dos: dos.map((d) => d.name), jobs: dels.map((d) => d.deliveryNumber), journals: jes.map((e) => e.journalNumber), deleted: Object.fromEntries(done), siteclockCancelled: sc.map((p) => p.label), siteclockSide })],
    );
    out(`  ActionLog: 1 row (${JOB})`);
    if (MODE === 'rehearse') {
      await c.query('ROLLBACK');
      out('\nREHEARSAL OK: every count matched. ROLLBACK: nothing kept, SiteClock untouched.');
      await c.end();
      return;
    }
    for (const p of sc) {
      const r = await fetch(`${conn.baseUrl.replace(/\/$/, '')}/v1/jobs/by-ref/${encodeURIComponent(p.ref)}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'AIMS test data cleanup' }),
      });
      const body = await r.json().catch(() => null);
      out(`  SiteClock cancel ${p.label}: HTTP ${r.status} status=${body?.job?.status ?? body?.error ?? '?'}`);
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
