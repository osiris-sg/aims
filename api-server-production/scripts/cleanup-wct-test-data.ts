/**
 * WCT (S) Systems (2026-11-12, owner's request): clear the TEST data of the
 * SiteClock phone test (ORD202611-004, jobs #3 #4 #5, DO202611012/013/014) and
 * of the manual-flow test (ORD202611-006, job #7, DO202611016, QO202611-0023),
 * plus the blank DO202611015 (owner's decision).
 * Owner's rules: cancel / void, delete only what has no number and no ledger
 * impact, never touch a counter (numbers stay as gaps), keep the customer
 * "TEST SiteClock". Dry run by default; --apply runs ONE transaction.
 *
 *   DBURL=<prod> npx ts-node --transpile-only scripts/cleanup-wct-test-data.ts [--apply --confirm-prod | --rehearse]
 *
 * --rehearse runs every write and guard of --apply, then ROLLS BACK.
 *
 * Run the SiteClock side first (its 3 jobs cancelled there): WCT is on the
 * manual order flow, so AIMS no longer pushes job changes to SiteClock.
 *
 * Kept and marked: orders (status CANCELLED), jobs (status cancelled, TEST
 * note, the claim:TEST-NO-INVOICE marker stays), DOs (Cancelled tag + TEST
 * reference), the quotation (Cancelled + TEST), the signed quotation link.
 * Removed (no number, no ledger): the jobs' service-report rows (none has a
 * number) with their location pings, bell notifications, failed WhatsApp
 * outbox rows, skipped group posts. Revoked: open DO share links.
 * Soft-deleted: the 2 job photos (files kept). SiteClock sync rows marked
 * CANCELLED so nothing is pushed again. A System Activity Log row per record.
 * Refuses if any journal on these documents is not VOID, if any payment
 * exists, or if a counter moves.
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Client } from 'pg';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const ORDERS = ['ORD202611-004', 'ORD202611-006'];
const JOBS = [3, 4, 5, 7];
const DOS = ['DO202611012', 'DO202611013', 'DO202611014', 'DO202611016'];
const QUOTES = ['QO202611-0023'];
// A blank DO (no lines, no customer) opened in the editor and never filled: tagged Cancelled, number kept.
const EXTRA_DOS = ['DO202611015'];
const TEST = 'TEST record (test data, cleared 2026-11-12)';
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
  try {
    await c.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    const counters = async () => q(`select "documentType", "nextSerial" from "DocumentNumberFormat" where "organizationId" = $1 order by 1, id`, [WCT]);
    const before = await counters();

    const orders = await q(`select id, "orderNumber", status, notes, "statusDates" from "Order" where "organizationId" = $1 and "orderNumber" = any($2) order by 2`, [WCT, ORDERS]);
    const jobs = await q(`select id, "deliveryNumber", status::text, notes, "orderInvoiceId" from "Delivery" where "organizationId" = $1 and "deliveryNumber" = any($2) and "orderId" = any($3) order by 2`, [WCT, JOBS, orders.map((o) => o.id)]);
    const docs = await q(`select id, type, name, status::text, config from "Document" where "organizationId" = $1 and name = any($2) order by type, name`, [WCT, [...DOS, ...QUOTES, ...EXTRA_DOS]]);
    if (orders.length !== ORDERS.length || jobs.length !== JOBS.length || docs.length !== DOS.length + QUOTES.length + EXTRA_DOS.length) {
      throw new Error(`Inventory changed: orders ${orders.length}, jobs ${jobs.length}, docs ${docs.length}`);
    }
    const jobIds = jobs.map((j) => j.id);
    const docIds = docs.map((d) => d.id);
    // The jobs' DOs must be exactly these documents.
    const linked = (await q(`select distinct d.name from "DeliveryItem" i join "Document" d on d.id::text = i."documentId"::text where i."deliveryId" = any($1)`, [jobIds])).map((r) => r.name).sort();
    if (JSON.stringify(linked) !== JSON.stringify([...DOS].sort())) throw new Error(`The jobs' DOs are ${linked.join(', ')}`);

    const journals = await q(`select "journalNumber", status from "JournalEntry" where "organizationId" = $1 and "sourceDocumentId"::text = any($2)`, [WCT, docIds]);
    const voidedInv = await q(`select "journalNumber", status, reference from "JournalEntry" where "organizationId" = $1 and "voidedBy" = 'script:cleanup-wct-test-order'`, [WCT]);
    const payments = (await q(`select count(*)::int n from "Payment" where "documentId"::text = any($1)`, [docIds]))[0].n;
    if (journals.some((j) => j.status !== 'VOID')) throw new Error('A journal on these documents is not VOID: refusing');
    if (payments) throw new Error('A payment exists on these documents: refusing');

    const reports = await q(`select id, kind::text, status::text, "reportNumber", (select count(*)::int from "DeliveryLocationPing" p where p."reportId" = r.id) pings from "MaintenanceServiceReport" r where "organizationId" = $1 and "deliveryId" = any($2)`, [WCT, jobIds]);
    if (reports.some((r) => r.reportNumber != null)) throw new Error('A service report has a number: refusing to delete it');
    const photos = await q(`select id, tag from "JobPhoto" where "organizationId" = $1 and "deliveryId" = any($2) and "deletedAt" is null`, [WCT, jobIds]);
    const scRows = await q(`select id, "externalRef", "lastPushedStatus", "syncState" from "DeliverySiteClockJob" where "organizationId" = $1 and "deliveryId" = any($2)`, [WCT, jobIds]);
    const msrIds = reports.map((r) => r.id);
    const allIds = [...docIds, ...jobIds, ...orders.map((o) => o.id), ...msrIds];
    const bells = await q(`select kind, count(*)::int n from "Notification" where "organizationId" = $1 and "entityId"::text = any($2) group by 1`, [WCT, allIds]);
    const names = [...DOS, ...QUOTES, ...ORDERS];
    const outbox = await q(`select id from "WhatsAppOutbox" where "organizationId" = $1 and status = 'FAILED' and (text ilike any($2) or "linkUrl" ilike any($3))`, [WCT, names.map((n) => `%${n}%`), allIds.map((i) => `%${i}%`)]);
    const posts = await q(`select id, status from "DeliveryGroupPost" where "organizationId" = $1 and "deliveryId" = any($2)`, [WCT, jobIds]);
    const shares = await q(`select l.id, d.name from "DocumentShareLink" l join "Document" d on d.id = l."documentId" where l."documentId"::text = any($1) and l."revokedAt" is null`, [docIds]);
    const deliveryShares = await q(`select id from "DeliveryShareLink" where ("documentId"::text = any($1) or "deliveryId"::text = any($2)) and "revokedAt" is null`, [docIds, jobIds]);
    const signs = await q(`select l.id, d.name, l."signedAt" is not null signed from "DocumentSignLink" l join "Document" d on d.id = l."documentId" where l."documentId"::text = any($1)`, [docIds]);
    const openSigns = signs.filter((s) => !s.signed);

    console.log('ORDERS');
    for (const o of orders) console.log(`  ${o.orderNumber}: ${o.status} -> CANCELLED${String(o.notes ?? '').startsWith('TEST') ? '' : ' (+ TEST note)'}`);
    console.log('JOBS (cancelled jobs are hidden from the jobs calendar unless "Show cancelled"; the Deliveries list shows them as Cancelled)');
    for (const j of jobs) console.log(`  #${j.deliveryNumber}: ${j.status} -> cancelled${String(j.notes ?? '').startsWith('TEST') ? '' : ' (+ TEST note)'}; invoice marker ${j.orderInvoiceId ?? 'none'} kept`);
    console.log('DOCUMENTS (kept, numbers kept)');
    for (const d of docs) console.log(`  ${d.type} ${d.name} (${d.status}): ${d.config?.cancelled ? 'already Cancelled' : '-> Cancelled tag'}; reference -> ${d.config?.referenceNo && String(d.config.referenceNo).startsWith('TEST') ? d.config.referenceNo : 'TEST'}`);
    console.log(`SERVICE REPORTS: delete ${reports.length} rows, none numbered (${reports.map((r) => `${r.kind}/${r.status}`).join(', ')}), with ${reports.reduce((s, r) => s + r.pings, 0)} location pings`);
    console.log(`JOB PHOTOS: soft-delete ${photos.length} (${photos.map((p) => p.tag).join(', ')}); files kept`);
    console.log(`SITECLOCK SYNC ROWS: ${scRows.length} -> lastPushedStatus CANCELLED (${scRows.map((r) => r.lastPushedStatus).join(', ')})`);
    console.log(`NOTIFICATIONS: delete ${bells.reduce((s, b) => s + b.n, 0)} (${bells.map((b) => `${b.kind} ${b.n}`).join(', ')})`);
    console.log(`WHATSAPP OUTBOX: delete ${outbox.length} FAILED rows (never delivered)`);
    console.log(`GROUP POSTS: delete ${posts.length} (${posts.map((p) => p.status).join(', ')})`);
    console.log(`LINKS: revoke ${shares.length} DO share link(s) (${shares.map((s) => s.name).join(', ')}), ${deliveryShares.length} delivery share link(s), ${openSigns.length} open sign link(s); ${signs.length - openSigns.length} already signed (kept)`);
    console.log(`GL: ${journals.length} journal(s) on these documents (${journals.map((j) => `${j.journalNumber} ${j.status}`).join(', ') || 'none'}); the removed draft INV202611-0011's journal: ${voidedInv.map((j) => `${j.journalNumber} ${j.status}`).join(', ') || 'none'}; payments ${payments}. Nothing is posted or deleted in the GL.`);
    console.log(`CUSTOMER "TEST SiteClock": kept.`);

    if (apply) {
      const now = new Date();
      const iso = now.toISOString();
      for (const o of orders) {
        const dates = { ...(o.statusDates ?? {}), CANCELLED: (o.statusDates ?? {}).CANCELLED ?? iso };
        const notes = String(o.notes ?? '').startsWith('TEST') ? o.notes : `${TEST}. ${o.notes ?? ''}`.trim();
        await c.query(`update "Order" set status = 'CANCELLED', "statusDates" = $2::jsonb, notes = $3, "updatedAt" = $4 where id = $1`, [o.id, JSON.stringify(dates), notes, now]);
      }
      for (const j of jobs) {
        const notes = String(j.notes ?? '').startsWith('TEST') ? j.notes : `${TEST}. ${j.notes ?? ''}`.trim();
        await c.query(`update "Delivery" set status = 'cancelled', notes = $2, "updatedAt" = $3 where id = $1`, [j.id, notes, now]);
      }
      for (const d of docs) {
        const ref = d.config?.referenceNo && String(d.config.referenceNo).startsWith('TEST') ? d.config.referenceNo : 'TEST';
        const extra: Record<string, unknown> = { referenceNo: ref, testRecord: true };
        if (!d.config?.cancelled) Object.assign(extra, { cancelled: true, cancelledAt: iso, cancelledReason: TEST });
        await c.query(`update "Document" set config = config || $2::jsonb, "updatedAt" = $3 where id = $1`, [d.id, JSON.stringify(extra), now]);
      }
      if (msrIds.length) {
        await c.query(`delete from "DeliveryLocationPing" where "reportId" = any($1)`, [msrIds]);
        await c.query(`delete from "MaintenanceServiceReport" where id = any($1) and "reportNumber" is null`, [msrIds]);
      }
      if (photos.length) await c.query(`update "JobPhoto" set "deletedAt" = $2, "deletedBy" = 'script', "deletedByName" = 'System (TEST cleanup)' where id = any($1)`, [photos.map((p) => p.id), now]);
      if (scRows.length) await c.query(`update "DeliverySiteClockJob" set "lastPushedStatus" = 'CANCELLED', "syncState" = 'SYNCED', "updatedAt" = $2 where id = any($1)`, [scRows.map((r) => r.id), now]);
      await c.query(`delete from "Notification" where "organizationId" = $1 and "entityId"::text = any($2)`, [WCT, allIds]);
      if (outbox.length) await c.query(`delete from "WhatsAppOutbox" where id = any($1)`, [outbox.map((r) => r.id)]);
      if (posts.length) await c.query(`delete from "DeliveryGroupPost" where id = any($1)`, [posts.map((r) => r.id)]);
      if (shares.length) await c.query(`update "DocumentShareLink" set "revokedAt" = $2 where id = any($1)`, [shares.map((s) => s.id), now]);
      if (deliveryShares.length) await c.query(`update "DeliveryShareLink" set "revokedAt" = $2 where id = any($1)`, [deliveryShares.map((s) => s.id), now]);
      if (openSigns.length) await c.query(`update "DocumentSignLink" set "revokedAt" = $2 where id = any($1)`, [openSigns.map((s) => s.id), now]);
      const log = async (resource: string, id: string, note: string) =>
        c.query(
          `insert into "ActionLog" (id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status, "createdAt")
           values ($1, 'SYSTEM', 'system:cleanup-wct-test-data', 'System creation', $2, 'script', 'CLEANUP', $3, $4, $5, 'SUCCESS', $6)`,
          [randomUUID(), WCT, resource, id, JSON.stringify({ note }), now],
        );
      for (const o of orders) await log('orders', o.id, `order ${o.orderNumber} cancelled (TEST)`);
      for (const j of jobs) await log('deliveries', j.id, `job #${j.deliveryNumber} cancelled (TEST)`);
      for (const d of docs) await log('documents', d.id, `${d.name} marked Cancelled (TEST)`);

      const after = await counters();
      if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error('A counter moved: rolled back');
      const live = await q(`select count(*)::int n from "JournalEntry" where "organizationId" = $1 and "sourceDocumentId"::text = any($2) and status <> 'VOID'`, [WCT, docIds]);
      if (live[0].n) throw new Error('A live journal appeared: rolled back');
      if (rehearse) {
        const left = await q(`select (select count(*)::int from "MaintenanceServiceReport" where id = any($1)) reports, (select count(*)::int from "Delivery" where id = any($2) and status <> 'cancelled') live_jobs`, [msrIds, jobIds]);
        await c.query('ROLLBACK');
        console.log(`Rehearsal passed (reports left ${left[0].reports}, jobs not cancelled ${left[0].live_jobs}); ROLLED BACK, nothing kept.`);
      } else {
        await c.query('COMMIT');
        console.log('Applied.');
      }
    } else {
      await c.query('ROLLBACK');
      console.log('Dry run. Nothing was written. Pass --apply --confirm-prod to apply.');
    }
    console.log(`COUNTERS (unchanged by this script): ${before.map((x) => `${x.documentType} ${x.nextSerial}`).join(', ')}`);
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
