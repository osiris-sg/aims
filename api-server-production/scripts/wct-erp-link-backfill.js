#!/usr/bin/env node
/**
 * WCT ERP link backfill (2026-11-23, Elroy): imported ERP DOs that sit on no order are linked to their order using
 * the ERP's own data only, never guessing:
 *  1. the DO's ERP quotation number (erpImport.quotationNo, read from the ERP contract / print) -> that quotation in
 *     AIMS (WCT (S) or BC Air) -> the order made from it;
 *  2. else an ERP invoice that names the DO (erpImport.invoices) -> the order that holds that invoice.
 * No order is ever made here (the orders top-up and wct-erp-dos.js make orders); a DO with no match is listed as
 * unlinkable. A DO the office unlinked in the app (imported.unlinked) is never linked back. Run AFTER the catch-up's
 * orders top-up, so quotations that just got an order are found. Invoices are linked by the orders top-up
 * (wct-imported-orders.ts), which applies the same ERP-link rules to every imported invoice.
 *
 *   node scripts/wct-erp-link-backfill.js --env prod                      dry run (read-only)
 *   node scripts/wct-erp-link-backfill.js --env prod --apply --confirm-prod  (only after the owner's APPLY)
 * Re-runnable: a linked DO is not picked again.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Client } = require('pg');
const { withDoLinks } = require('./wct-erp-dos');

const argv = process.argv.slice(2);
const one = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const ENV = one('--env', 'dev');
const APPLY = argv.includes('--apply');
const ORGS = { '5c700000-0000-4000-8000-5c7000000001': 'WCT (S)', '5c700000-0000-4000-8000-5c7000000004': 'BC Air' };
const LOGS = path.join(os.homedir(), 'Desktop/aims/_imports/wct/logs');

function dbUrl() {
  const key = ENV === 'prod' ? 'PROD_DATABASE_URL' : 'DATABASE_URL';
  if (process.env[key]) return process.env[key];
  const line = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n').find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`${key} not set`);
  return line.slice(key.length + 1).trim().replace(/^"|"$/g, '');
}

/** "Q-014922", "-014922", "014922", "Q-014922-R1" -> "14922" (the ERP quotation number), else "". */
const quoteKey = (s) => {
  const m = String(s ?? '').match(/^\s*Q?-?0*(\d{1,6})(?:-R\d+)?\s*$/i);
  return m ? m[1] : '';
};

(async () => {
  if (APPLY && ENV === 'prod' && !argv.includes('--confirm-prod')) throw new Error('prod --apply needs --confirm-prod');
  const c = new Client({ connectionString: dbUrl() });
  await c.connect();
  await c.query(APPLY ? 'BEGIN' : 'BEGIN TRANSACTION READ ONLY');
  const orgIds = Object.keys(ORGS);
  try {
    const orders = (
      await c.query(
        `SELECT o.id::text AS id, o."organizationId"::text AS org, o."orderNumber", o.status, o."sourceQuotationId"::text AS "sourceQuotationId", o."invoiceDocumentId"::text AS "invoiceDocumentId", o."linkedDocuments"
           FROM "Order" o WHERE o."organizationId" = ANY($1)`,
        [orgIds],
      )
    ).rows;
    const heldIds = new Set();
    for (const o of orders) {
      if (o.sourceQuotationId) heldIds.add(o.sourceQuotationId);
      if (o.invoiceDocumentId) heldIds.add(o.invoiceDocumentId);
      for (const k of ['quotation', 'invoice', 'do', 'creditNote']) for (const x of Array.isArray(o.linkedDocuments?.[k]) ? o.linkedDocuments[k] : []) if (x?.id) heldIds.add(x.id);
    }
    const dos = (
      await c.query(
        `SELECT d.id::text AS id, d."organizationId"::text AS org, d.name, d."documentTemplateId" AS tpl, d.config->>'date' AS date, d.config->'erpImport' AS erp, d.config->>'customerName' AS customer
           FROM "Document" d
          WHERE d."organizationId" = ANY($1) AND d.type = 'DELIVERY_ORDER' AND d.config->'erpImport'->>'source' = 'wct-erp' AND d.config->>'orderId' IS NULL`,
        [orgIds],
      )
    ).rows.filter((d) => !heldIds.has(d.id));
    const quotes = (await c.query(`SELECT d.id::text AS id, d."organizationId"::text AS org, d.name FROM "Document" d WHERE d."organizationId" = ANY($1) AND d.type = 'QUOTATION'`, [orgIds])).rows;
    const quoteByKey = new Map();
    for (const q of quotes) {
      const k = quoteKey(q.name);
      if (k) quoteByKey.set(k, [...(quoteByKey.get(k) || []), q]);
    }
    const invoices = (await c.query(`SELECT d.id::text AS id, d.name FROM "Document" d WHERE d."organizationId" = ANY($1) AND d.type = 'INVOICE'`, [orgIds])).rows;
    const invoiceByName = new Map(invoices.map((i) => [i.name, i]));
    const orderOfQuote = new Map(orders.filter((o) => o.sourceQuotationId).map((o) => [o.sourceQuotationId, o]));
    const orderOfDoc = new Map();
    for (const o of orders) for (const k of ['invoice']) for (const x of Array.isArray(o.linkedDocuments?.[k]) ? o.linkedDocuments[k] : []) if (x?.id) orderOfDoc.set(x.id, o);
    for (const o of orders) if (o.invoiceDocumentId) orderOfDoc.set(o.invoiceDocumentId, o);

    const plan = [];
    const unlinkable = [];
    for (const d of dos) {
      const unlinkedHere = (o) => (Array.isArray(o.linkedDocuments?.imported?.unlinked) ? o.linkedDocuments.imported.unlinked : []).some((x) => (typeof x === 'string' ? x : x?.id) === d.id);
      const qk = quoteKey(d.erp?.quotationNo);
      const qs = qk ? quoteByKey.get(qk) || [] : [];
      let order = null;
      let how = '';
      if (qs.length === 1 && orderOfQuote.get(qs[0].id)) {
        order = orderOfQuote.get(qs[0].id);
        how = `ERP quotation ${d.erp.quotationNo}`;
      } else {
        const viaInv = (Array.isArray(d.erp?.invoices) ? d.erp.invoices : String(d.erp?.invoices || '').split(/[\s,]+/))
          .map((n) => invoiceByName.get(String(n || '').trim()))
          .filter(Boolean)
          .map((i) => orderOfDoc.get(i.id))
          .filter(Boolean);
        const uniq = [...new Map(viaInv.map((o) => [o.id, o])).values()];
        if (uniq.length === 1) {
          order = uniq[0];
          how = `ERP invoice ${d.erp.invoices}`;
        }
      }
      const why = !qk && !d.erp?.invoices ? 'no quotation or invoice in the ERP' : qs.length > 1 ? `quotation ${d.erp.quotationNo} twice in AIMS` : qs.length === 1 ? `quotation ${qs[0].name} has no order (yet)` : qk ? `quotation ${d.erp.quotationNo} not in AIMS` : `invoice ${d.erp.invoices} not on an order`;
      if (order && order.status !== 'CANCELLED' && !unlinkedHere(order)) plan.push({ d, order, how });
      else unlinkable.push({ org: ORGS[d.org], do: d.name, date: d.date, customer: d.customer, quotation: d.erp?.quotationNo || '', invoices: d.erp?.invoices || '', why: order ? (order.status === 'CANCELLED' ? `order ${order.orderNumber} is cancelled` : `unlinked by the office from ${order.orderNumber}`) : why });
    }
    console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} (${ENV}): imported ERP DOs on no order: ${dos.length}`);
    console.log(`  to link: ${plan.length}`);
    for (const p of plan) console.log(`    ${ORGS[p.d.org]} ${p.d.name} -> ${p.order.orderNumber} (${p.how})`);
    console.log(`  unlinkable from ERP data (listed, not linked): ${unlinkable.length}`);
    for (const u of unlinkable) console.log(`    ${u.org} ${u.do} ${u.date || ''} ${u.customer || ''}: ${u.why}`);
    if (APPLY) {
      const log = { at: new Date().toISOString(), env: ENV, linked: [] };
      for (const p of plan) {
        const fresh = (await c.query(`SELECT "linkedDocuments" FROM "Order" WHERE id = $1 FOR UPDATE`, [p.order.id])).rows[0];
        const entry = { id: p.d.id, name: p.d.name, templateId: p.d.tpl, imported: true, erpStatus: 'Issued', done: p.d.erp?.done !== false, date: p.d.date };
        await c.query(`UPDATE "Order" SET "linkedDocuments" = $2, "updatedAt" = now() WHERE id = $1`, [p.order.id, withDoLinks(fresh?.linkedDocuments, [entry])]);
        log.linked.push({ do: p.d.name, doId: p.d.id, order: p.order.orderNumber, orderId: p.order.id, how: p.how });
      }
      await c.query('COMMIT');
      fs.mkdirSync(LOGS, { recursive: true });
      const file = path.join(LOGS, `wct-erp-link-backfill.${ENV}.${log.at.replace(/[:.]/g, '-')}.log.json`);
      fs.writeFileSync(file, JSON.stringify({ ...log, unlinkable }, null, 1));
      console.log(`applied: ${log.linked.length} DOs linked · log ${file}`);
    } else {
      await c.query('ROLLBACK');
    }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
