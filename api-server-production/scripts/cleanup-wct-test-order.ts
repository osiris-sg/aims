/**
 * WCT (S) Systems (2026-11-12): clean up the test run made on prod through the
 * office "Complete job": quotation QO202611-0023, order ORD202611-006, job #7 /
 * DO202611016, its draft service report and the draft invoice INV202611-0011.
 * Owner's rule: mark TEST, void / remove the draft invoice the proper way, keep
 * every number as a gap, never touch a numbering counter. Dry run by default;
 * --apply runs ONE transaction.
 *
 *   DBURL=<prod> npx ts-node --transpile-only scripts/cleanup-wct-test-order.ts [--apply --confirm-prod]
 *
 * What --apply does:
 *  - Invoice INV202611-0011: its journal is voided IN PLACE (status VOID,
 *    voidedAt / voidedBy, exactly what JournalService.void does: no reversal),
 *    every pointer to the invoice is cleared (job, order, service report), the
 *    bell notifications about it are removed, then the invoice row is deleted.
 *    The app's own delete is NOT used because it rolls the INVOICE counter back
 *    when the deleted number is the latest (it is): this keeps 0011 as a gap.
 *  - Job #7: status cancelled with a TEST note, so the order never bills it again.
 *  - DO DO202611016: kept, marked cancelled (the DO "Cancelled" tag) and TEST.
 *  - Quotation QO202611-0023, order ORD202611-006, the draft service report:
 *    kept, marked TEST (reference / notes / description).
 *  - One "System" Activity Log row per record.
 * The DB guards stay on: the invoice can only be deleted once its journal is VOID.
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Client } from 'pg';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const NAMES = { quote: 'QO202611-0023', order: 'ORD202611-006', job: 7, do: 'DO202611016', invoice: 'INV202611-0011' };
const TEST = 'TEST record (prod test of the manual order flow, 2026-11-12)';
const apply = process.argv.includes('--apply');

(async () => {
  const url = process.env.DBURL || '';
  if (!url) throw new Error('Pass the database URL inline as DBURL');
  const prodHost = process.env.PROD_DATABASE_URL ? new URL(process.env.PROD_DATABASE_URL).host : '';
  if (apply && new URL(url).host === prodHost && !process.argv.includes('--confirm-prod')) throw new Error('Applying to prod needs --confirm-prod');
  const c = new Client({ connectionString: url });
  await c.connect();
  const one = async (sql: string, p: any[]) => (await c.query(sql, p)).rows[0];
  try {
    await c.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    const quote = await one(`select id, name, status, config from "Document" where "organizationId"=$1 and type='QUOTATION' and name=$2`, [WCT, NAMES.quote]);
    const order = await one(`select id, "orderNumber", status, notes, "invoiceDocumentId" from "Order" where "organizationId"=$1 and "orderNumber"=$2`, [WCT, NAMES.order]);
    const job = order && (await one(`select id, "deliveryNumber", status, notes, "orderInvoiceId" from "Delivery" where "organizationId"=$1 and "orderId"::text=$2 and "deliveryNumber"=$3`, [WCT, order.id, NAMES.job]));
    const dOrder = await one(`select id, name, status, config from "Document" where "organizationId"=$1 and type='DELIVERY_ORDER' and name=$2`, [WCT, NAMES.do]);
    const inv = await one(`select id, name, status, config from "Document" where "organizationId"=$1 and type='INVOICE' and name=$2`, [WCT, NAMES.invoice]);
    if (!quote || !order || !job || !dOrder || !inv) throw new Error(`Not found: ${JSON.stringify({ quote: !!quote, order: !!order, job: !!job, do: !!dOrder, inv: !!inv })}`);
    if (inv.status !== 'unconfirmed' && inv.status !== 'draft') throw new Error(`Refusing: the invoice is ${inv.status}, not a draft`);
    const paid = Number(inv.config?.paidToDate ?? 0);
    if (paid) throw new Error('Refusing: the invoice has a payment');
    const journals = (await c.query(`select id, type, status from "JournalEntry" where "organizationId"=$1 and "sourceDocumentId"::text=$2`, [WCT, inv.id])).rows;
    const reports = (await c.query(`select id, kind, status, "reportNumber", "invoiceDocumentId"::text inv from "MaintenanceServiceReport" where "organizationId"=$1 and "deliveryId"::text=$2`, [WCT, job.id])).rows;
    const bells = (await one(`select count(*)::int n from "Notification" where "organizationId"=$1 and "entityId"=$2`, [WCT, inv.id])).n;
    const counters = (await c.query(`select "documentType", "nextSerial" from "DocumentNumberFormat" where "organizationId"=$1 and "isActive" and "documentType" in ('INVOICE','QUOTATION','ORDER','DELIVERY_ORDER') order by 1`, [WCT])).rows;

    console.log(`Invoice ${inv.name} (${inv.status}): void ${journals.filter((j) => j.status !== 'VOID').length} journal(s) in place [${journals.map((j) => `${j.type} ${j.status}`).join(', ')}], clear its links (job #${job.deliveryNumber}, order ${order.orderNumber}${reports.some((r) => r.inv === inv.id) ? ', 1 service report' : ''}), remove ${bells} bell notification(s), then delete the row. Number kept as a gap; no counter change.`);
    console.log(`Job #${job.deliveryNumber} (${job.status}): -> cancelled, note "${TEST}" (so the order never bills it again).`);
    console.log(`DO ${dOrder.name} (${dOrder.status}): kept, marked cancelled + TEST (reference).`);
    console.log(`Quotation ${quote.name} (${quote.status}): kept, reference -> "TEST${quote.config?.referenceNo ? ' · ' + quote.config.referenceNo : ''}".`);
    console.log(`Order ${order.orderNumber} (${order.status}): kept, notes start with TEST, invoice link cleared.`);
    console.log(`Service reports on job #${job.deliveryNumber}: ${reports.map((r) => `${r.kind} ${r.status}${r.reportNumber ? ' #' + r.reportNumber : ''}`).join(', ')}; the SERVICE draft is kept and marked TEST.`);
    console.log(`Counters now: ${counters.map((x) => `${x.documentType} next ${x.nextSerial}`).join(', ')} (unchanged by this script).`);

    if (apply) {
      const now = new Date();
      const by = 'script:cleanup-wct-test-order';
      await c.query(`update "JournalEntry" set status='VOID', "voidedAt"=$2, "voidedBy"=$3 where "organizationId"=$4 and "sourceDocumentId"::text=$1 and status <> 'VOID'`, [inv.id, now, by, WCT]);
      await c.query(`update "Delivery" set "orderInvoiceId"=null, status='cancelled', notes=$2, "updatedAt"=$3 where id::text=$1`, [job.id, `${TEST}. ${job.notes ?? ''}`.trim(), now]);
      await c.query(`update "Order" set "invoiceDocumentId"=null, notes=$2, "updatedAt"=$3 where id::text=$1`, [order.id, `${TEST}. ${order.notes ?? ''}`.trim(), now]);
      await c.query(`update "MaintenanceServiceReport" set "invoiceDocumentId"=null where "invoiceDocumentId"::text=$1`, [inv.id]);
      await c.query(`update "MaintenanceServiceReport" set description=$2, "serviceData" = coalesce("serviceData",'{}'::jsonb) || jsonb_build_object('testRecord', true), "updatedAt"=$3 where "deliveryId"::text=$1 and kind='SERVICE'`, [job.id, TEST, now]);
      await c.query(`delete from "Notification" where "organizationId"=$1 and "entityId"=$2`, [WCT, inv.id]);
      await c.query(`delete from "Document" where id::text=$1 and "organizationId"=$2 and type='INVOICE'`, [inv.id, WCT]);
      const ref = (cur?: string) => `TEST${cur ? ' · ' + cur : ''}`;
      await c.query(
        `update "Document" set config = config || jsonb_build_object('referenceNo', $2::text, 'testRecord', true), "updatedAt"=$3 where id::text=$1`,
        [quote.id, ref(quote.config?.referenceNo), now],
      );
      await c.query(
        `update "Document" set config = config || jsonb_build_object('referenceNo', $2::text, 'testRecord', true, 'cancelled', true, 'cancelledAt', $3::text, 'cancelledReason', $4::text), "updatedAt"=$5 where id::text=$1`,
        [dOrder.id, ref(dOrder.config?.referenceNo), now.toISOString(), TEST, now],
      );
      for (const [resource, id, what] of [
        ['documents', inv.id, `draft invoice ${inv.name} removed (journal voided, number kept as a gap)`],
        ['deliveries', job.id, `job #${job.deliveryNumber} cancelled as TEST`],
        ['documents', dOrder.id, `DO ${dOrder.name} marked cancelled TEST`],
        ['documents', quote.id, `quotation ${quote.name} marked TEST`],
        ['orders', order.id, `order ${order.orderNumber} marked TEST`],
      ]) {
        await c.query(
          `insert into "ActionLog" (id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status, "createdAt")
           values ($1, 'SYSTEM', 'system:cleanup-wct-test-order', 'System creation', $2, 'script', 'CLEANUP', $3, $4, $5, 'SUCCESS', $6)`,
          [randomUUID(), WCT, resource, id, JSON.stringify({ note: what }), now],
        );
      }
      const after = (await c.query(`select "documentType", "nextSerial" from "DocumentNumberFormat" where "organizationId"=$1 and "isActive" and "documentType" in ('INVOICE','QUOTATION','ORDER','DELIVERY_ORDER') order by 1`, [WCT])).rows;
      if (JSON.stringify(after) !== JSON.stringify(counters)) throw new Error('A counter changed: rolled back');
      await c.query('COMMIT');
      console.log('Applied.');
    } else {
      await c.query('ROLLBACK');
      console.log('Dry run. Nothing was written. Pass --apply --confirm-prod to apply.');
    }
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
