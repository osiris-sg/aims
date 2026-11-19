/**
 * Put ONE imported order on the 2026-11-19 billing rule (Elroy's go per order): sets linkedDocuments.imported.
 * partBilledRule = true, re-reads its status (Part billed below the quotation total), one ActionLog row, log file.
 * DRY RUN BY DEFAULT.
 *   npx ts-node --transpile-only scripts/wct-imported-mark-order.ts --env prod --order ORD-Q-014154 [--apply --confirm-prod]
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { creditOfImportedInvoice, importedCompletionOf, importedMarkerOf, importedOrderStatus, isImportedOrder } from '../src/orders/imported-orders';
import { remainingForOrder } from '../src/orders/imported-remaining';
import { grossOf } from '../src/common/document-money';

const argv = process.argv.slice(2);
const one = (k: string, d?: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const ENV = one('--env', 'dev')!;
const ORDER = one('--order');
const APPLY = argv.includes('--apply');
const ORGS = ['5c700000-0000-4000-8000-5c7000000001', '5c700000-0000-4000-8000-5c7000000004'];

(async () => {
  if (!ORDER) throw new Error('--order ORD-Q-…');
  if (APPLY && ENV === 'prod' && !argv.includes('--confirm-prod')) throw new Error('prod --apply needs --confirm-prod');
  const c = new Client({ connectionString: ENV === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL });
  await c.connect();
  if (!APPLY) await c.query('SET default_transaction_read_only = on');
  const o = (await c.query(`select id::text id, "organizationId"::text org, "orderNumber", status, "linkedDocuments", "sourceQuotationId"::text q from "Order" where "orderNumber" = $1 and "organizationId"::text = any($2)`, [ORDER, ORGS])).rows[0];
  if (!o || !isImportedOrder(o)) throw new Error(`${ORDER}: not an imported order`);
  const m: any = importedMarkerOf(o) || {};
  const refs: any[] = Array.isArray(o.linkedDocuments?.invoice) ? o.linkedDocuments.invoice : [];
  const docs = refs.length ? (await c.query(`select id::text id, name, status::text status, config from "Document" where id = any($1::uuid[])`, [refs.map((r) => r.id)])).rows : [];
  const qo = o.q ? (await c.query(`select id::text id, name, config from "Document" where id = $1::uuid`, [o.q])).rows[0] : null;
  const quoteTotal = m.quoteTotal != null ? Number(m.quoteTotal) : qo ? grossOf(qo.config) : null;
  const st = importedOrderStatus(docs.map((d: any) => ({ ...d, credit: Number(m.credits?.[d.id]) || creditOfImportedInvoice(d.config) })), quoteTotal, { completed: importedCompletionOf(o), partBilledRule: true });
  const rem = remainingForOrder({ marker: m, invoiceDocs: docs, quotation: qo ? { name: qo.name, config: qo.config } : null, quoteTotal: st.quoteTotal, billed: st.billed });
  console.log(`${ENV.toUpperCase()} ${APPLY ? 'APPLY' : 'DRY RUN'}: ${o.orderNumber} (${qo?.name}, ${qo?.config?.customerName})`);
  console.log(`  status ${o.status} -> ${st.status} (${st.label}) · billed ${st.billed} of ${st.quoteTotal} (${st.billedPct}%) · mark already set: ${m.partBilledRule === true}`);
  console.log(`  left to bill ${rem.remainingGross} · ${rem.progress ? `${rem.progress.billed} of ${rem.progress.quoted}` : ''} · ${rem.matched ? 'per line' : 'one line'}: ${rem.lines.filter((l) => l.priced).map((l) => `${l.quantity} x ${l.description.split('\n')[0]} @ ${l.unitPrice}`).join('; ')}`);
  if (APPLY) {
    const ld = o.linkedDocuments || {};
    await c.query('BEGIN');
    await c.query(`update "Order" set "linkedDocuments" = $2::jsonb, status = $3, "updatedAt" = now() where id = $1::uuid`, [o.id, JSON.stringify({ ...ld, imported: { ...ld.imported, partBilledRule: true } }), st.status]);
    await c.query(
      `insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
       values (gen_random_uuid(), 'SYSTEM', 'system:wct-imported-mark-order', 'System creation', $1, 'operator', 'UPDATE', 'order', $2, $3, 'SUCCESS')`,
      [o.org, o.id, JSON.stringify({ note: `Imported order ${o.orderNumber} on the Part billed rule (Elroy 19 Nov): ${o.status} -> ${st.status}, billed ${st.billed} of ${st.quoteTotal}` })],
    );
    await c.query('COMMIT');
    const f = path.join(process.env.HOME || '', `Desktop/aims/_imports/wct/logs/wct-imported-mark-order.${ORDER}.${ENV}.log.json`);
    fs.writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), order: o.orderNumber, id: o.id, before: { status: o.status, partBilledRule: m.partBilledRule ?? null }, after: { status: st.status, partBilledRule: true } }, null, 1));
    console.log(`  written; log ${f}`);
  }
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
