/**
 * BC Air orders show the WCT (S) invoices billed against their quotation (2026-11-23, Elroy; WCT group only).
 * Nothing moves: the link is stored on the BC Air order only (linkedDocuments.crossOrgInvoice, entries
 * { id, orgId, orgName, name, linked }), the invoices stay in WCT (S) with their books and AR. Billed / Left to bill
 * on the order count them (imported-orders.ts loadImportedOrderInputs). Links come from the ERP's own invoice ->
 * quotation links (the catch-up's not-linked list, "quotation is in another org (BC Air)"); the never-link list
 * (scripts/wct-erp-never-link.json) is honoured. A quotation with no BC Air order is listed, nothing is made.
 *
 *   npx ts-node --transpile-only scripts/wct-bcair-cross-invoices.ts --env prod [--not-linked <csv>]           dry run
 *   npx ts-node --transpile-only scripts/wct-bcair-cross-invoices.ts --env prod --apply --confirm-prod          (owner APPLY)
 * Re-runnable: an invoice already on the order's cross list is not added again.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { importedStatusFrom, loadImportedOrderInputs, crossOrgInvoiceRefsOf } from '../src/orders/imported-orders';

const argv = process.argv.slice(2);
const one = (k: string, d?: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const ENV = one('--env', 'dev')!;
const APPLY = argv.includes('--apply');
const WCT = '5c700000-0000-4000-8000-5c7000000001';
const BC = '5c700000-0000-4000-8000-5c7000000004';
const PULL = path.join(os.homedir(), 'Desktop/aims/_imports/wct/erp-catchup/2026-11-23');
const NOT_LINKED = one('--not-linked', path.join(PULL, 'orders-neverlink-dry/not-linked.csv'))!;
const OUT = one('--out', path.join(PULL, APPLY ? 'cross-invoices-apply' : 'cross-invoices-dry'))!;
const money = (n: number) => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function dbUrl(): string {
  const key = ENV === 'prod' ? 'PROD_DATABASE_URL' : 'DATABASE_URL';
  if (process.env[key]) return process.env[key]!;
  const line = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n').find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`${key} not set`);
  return line.slice(key.length + 1).trim().replace(/^"|"$/g, '');
}
function readCsv(file: string): Record<string, string>[] {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [h, ...b] = rows.filter((r) => r.length > 1);
  return b.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
}
const cell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const writeCsv = (file: string, cols: string[], rows: any[]) => fs.writeFileSync(file, '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n');
const qKey = (s: unknown) => { const m = String(s ?? '').match(/(\d{1,6})(?!.*\d)/); return m ? String(Number(m[1])) : ''; };

(async () => {
  if (APPLY && ENV === 'prod' && !argv.includes('--confirm-prod')) throw new Error('prod --apply needs --confirm-prod');
  const c = new Client({ connectionString: dbUrl() });
  await c.connect();
  await c.query(APPLY ? 'BEGIN' : 'BEGIN TRANSACTION READ ONLY');
  const prisma: any = new PrismaClient({ datasources: { db: { url: dbUrl() } } });
  try {
    const never = new Set<string>((JSON.parse(fs.readFileSync(path.join(__dirname, 'wct-erp-never-link.json'), 'utf8')).invoices || []).map((x: any) => String(x.invoice)));
    const rows = readCsv(NOT_LINKED).filter((r) => r.org === 'WCT (S)' && r.why === 'quotation is in another org' && r['other org'] === 'BC Air' && !never.has(r.invoice));
    const inv = (await c.query(
      `SELECT d.id::text id, d.name, d.config->>'date' date, coalesce(d.config->>'totalWithTax', d.config->>'nettTotal')::numeric total FROM "Document" d WHERE d."organizationId" = $1 AND d.type = 'INVOICE' AND d.name = ANY($2)`,
      [WCT, rows.map((r) => r.invoice)],
    )).rows;
    const invByName = new Map(inv.map((d: any) => [d.name, d]));
    const orders = (await c.query(
      `SELECT o.id::text id, o."orderNumber", o.status, o."sourceQuotationId"::text "sourceQuotationId", o."linkedDocuments", q.name quote
         FROM "Order" o LEFT JOIN "Document" q ON q.id = o."sourceQuotationId" WHERE o."organizationId" = $1 AND o.status <> 'CANCELLED'`,
      [BC],
    )).rows;
    const byKey = new Map<string, any[]>();
    for (const o of orders) { const k = qKey(o.quote); if (k) byKey.set(k, [...(byKey.get(k) || []), o]); }
    const wctName = (await c.query(`SELECT name FROM "Organization" WHERE id = $1`, [WCT])).rows[0]?.name?.replace(/ Systems Pte Ltd$/i, '') || 'WCT (S)';

    const plan = new Map<string, { order: any; add: any[] }>();
    const noOrder: any[] = [], several: any[] = [];
    for (const r of rows) {
      const d = invByName.get(r.invoice);
      if (!d) continue;
      const os2 = byKey.get(String(Number(r['quotation key']))) || [];
      if (!os2.length) { noOrder.push({ invoice: r.invoice, quotation: r['quotation key'], total: Number(d.total || 0) }); continue; }
      if (os2.length > 1) { several.push({ invoice: r.invoice, quotation: r['quotation key'], orders: os2.map((o) => o.orderNumber).join(' ') }); continue; }
      const o = os2[0];
      if (crossOrgInvoiceRefsOf(o).some((x) => x.id === d.id)) continue;
      const p = plan.get(o.id) || { order: o, add: [] };
      p.add.push(d);
      plan.set(o.id, p);
    }
    // Billed / status before and after, with the same inputs the order page reads.
    const at = new Date().toISOString();
    const changes: any[] = [];
    const list = [...plan.values()];
    for (let i = 0; i < list.length; i += 200) {
      const chunk = list.slice(i, i + 200);
      const before = await loadImportedOrderInputs(prisma, BC, chunk.map((p) => ({ id: p.order.id, sourceQuotationId: p.order.sourceQuotationId, linkedDocuments: p.order.linkedDocuments })), { lean: false });
      const nextLd = new Map(chunk.map((p) => [p.order.id, { ...(p.order.linkedDocuments || {}), crossOrgInvoice: [...crossOrgInvoiceRefsOf(p.order), ...p.add.map((d) => ({ id: d.id, orgId: WCT, orgName: wctName, name: d.name, linked: { at, by: null, byName: 'ERP link (cross-company)' } }))] }]));
      const after = await loadImportedOrderInputs(prisma, BC, chunk.map((p) => ({ id: p.order.id, sourceQuotationId: p.order.sourceQuotationId, linkedDocuments: nextLd.get(p.order.id) })), { lean: false });
      for (const p of chunk) {
        const b = importedStatusFrom(p.order, before.get(p.order.id)!);
        const a = importedStatusFrom({ linkedDocuments: nextLd.get(p.order.id) }, after.get(p.order.id)!);
        changes.push({ orderId: p.order.id, order: p.order.orderNumber, quote: p.order.quote, invoices: p.add.map((d) => d.name).join(' '), added: p.add.length, addedTotal: p.add.reduce((t, d) => t + Number(d.total || 0), 0), statusBefore: p.order.status, statusAfter: a.status, labelAfter: a.label, billedBefore: b.billed, billedAfter: a.billed, quoteTotal: a.quoteTotal, ld: nextLd.get(p.order.id) });
      }
    }
    const L: string[] = [];
    const say = (s = '') => { L.push(s); console.log(s); };
    say(`BC Air orders: WCT (S) invoices billed against their quotation · ${ENV.toUpperCase()} ${APPLY ? 'APPLY' : 'DRY RUN'} · ${at}`);
    say(`WCT (S) invoices on BC Air quotations (ERP links, never-link list excluded): ${rows.length}`);
    say(`BC Air orders that get links: ${changes.length} · invoices linked ${changes.reduce((t, x) => t + x.added, 0)} · total S$${money(changes.reduce((t, x) => t + x.addedTotal, 0))}`);
    const moves: Record<string, number> = {};
    for (const x of changes) if (x.statusBefore !== x.statusAfter) moves[`${x.statusBefore} -> ${x.statusAfter}`] = (moves[`${x.statusBefore} -> ${x.statusAfter}`] || 0) + 1;
    say(`Status changes from the counted invoices: ${Object.entries(moves).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'} · unchanged ${changes.filter((x) => x.statusBefore === x.statusAfter).length}`);
    say(`Not linked: quotation has no BC Air order ${noOrder.length} (S$${money(noOrder.reduce((t, x) => t + x.total, 0))}), several BC Air orders for the quotation ${several.length}`);
    say('Books / AR: unchanged in both companies (only the BC Air order\'s link list and status are written).');
    say('\nSamples (order | quotation | WCT (S) invoices | billed before -> after | quotation total | status):');
    for (const x of changes.filter((_, i) => i % Math.max(1, Math.floor(changes.length / 12)) === 0).slice(0, 12)) say(`  ${x.order} | ${x.quote} | ${x.invoices} | ${money(x.billedBefore)} -> ${money(x.billedAfter)} | ${money(x.quoteTotal)} | ${x.statusBefore} -> ${x.statusAfter}`);
    fs.mkdirSync(OUT, { recursive: true });
    writeCsv(path.join(OUT, 'orders.csv'), ['order', 'quote', 'invoices', 'added', 'addedTotal', 'statusBefore', 'statusAfter', 'billedBefore', 'billedAfter', 'quoteTotal'], changes);
    writeCsv(path.join(OUT, 'no-bcair-order.csv'), ['invoice', 'quotation', 'total'], noOrder);
    writeCsv(path.join(OUT, 'several-orders.csv'), ['invoice', 'quotation', 'orders'], several);
    if (APPLY) {
      for (const x of changes) {
        await c.query(`UPDATE "Order" SET "linkedDocuments" = $2, status = $3, "updatedAt" = now() WHERE id = $1 AND "organizationId" = $4`, [x.orderId, x.ld, x.statusAfter, BC]);
        await c.query(
          `INSERT INTO "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
           VALUES (gen_random_uuid(), 'SYSTEM', 'wct-bcair-cross-invoices', 'System creation', $1, 'operator', 'LINK', 'order', $2, $3, 'SUCCESS')`,
          [BC, x.orderId, JSON.stringify({ note: `WCT (S) invoices shown on ${x.order} (read only, not moved): ${x.invoices}`, statusBefore: x.statusBefore, statusAfter: x.statusAfter })],
        );
      }
      await c.query('COMMIT');
      fs.writeFileSync(path.join(OUT, `apply.${at.replace(/[:.]/g, '-')}.log.json`), JSON.stringify(changes.map(({ ld, ...x }) => x), null, 1));
      say(`APPLIED: ${changes.length} BC Air orders linked · log in ${OUT}`);
    } else await c.query('ROLLBACK');
    fs.writeFileSync(path.join(OUT, 'report.txt'), L.join('\n') + '\n');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
