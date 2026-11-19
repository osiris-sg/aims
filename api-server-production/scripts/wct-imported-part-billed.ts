/**
 * Imported orders that are not fully billed (WCT group, 2026-11-19, Elroy). DRY RUN BY DEFAULT (read-only session).
 *
 * Every imported order (WCT (S), BC Air) gets its status by the 2026-11-19 rule (src/orders/imported-orders.ts):
 *   Part billed = billed < quotation total ($0 quotations never); Invoiced = billed in full, something unpaid;
 *   Paid = billed in full and every invoice paid. An order already marked complete (by a person) keeps it.
 * Age default for a PART BILLED order: its last billing invoice is older than 12 months, or it has none and its
 * quotation is older than 18 months -> marked complete automatically ("Imported, assumed closed"); otherwise it
 * stays Part billed (open, "Create invoice" on its page).
 * Remaining per line (src/orders/imported-remaining.ts); lines with qty > 1 billed less than quoted are flagged.
 *
 * Writes (only with --apply; prod also needs --confirm-prod): Order.status, and for auto-completed orders the
 * completion mark on linkedDocuments.imported (+ one ActionLog row each, system:wct-imported-part-billed). The
 * quotations and invoices are never written. Log of every write: _imports/wct/logs/.
 *
 *   npx ts-node --transpile-only scripts/wct-imported-part-billed.ts --env prod
 *   npx ts-node --transpile-only scripts/wct-imported-part-billed.ts --env prod --apply --confirm-prod
 * Options: --today YYYY-MM-DD (default: today in Singapore), --summary <file>.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { Client, types } from 'pg';
import { IMPORTED_AUTO_COMPLETE_REASON, creditOfImportedInvoice, importedCompletionOf, importedInvoiceMoney, importedMarkerOf, importedDosOf, importedOrderStatus, isCountedInvoice, isImportedOrder } from '../src/orders/imported-orders';
import { firstLine, remainingForOrder } from '../src/orders/imported-remaining';
import { grossOf } from '../src/common/document-money';

types.setTypeParser(1114, (s: string) => s);
const ORGS: Record<string, string> = { '5c700000-0000-4000-8000-5c7000000001': 'WCT (S)', '5c700000-0000-4000-8000-5c7000000004': 'BC Air' };
const argv = process.argv.slice(2);
const one = (k: string, d?: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const ENV = one('--env', 'dev')!;
const APPLY = argv.includes('--apply');
const TODAY = one('--today', new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10))!;
const SUMMARY = one('--summary', path.join(process.env.HOME || '', 'Desktop/aims-agents/imports/part-billed-summary.txt'))!;
const JOB = 'system:wct-imported-part-billed';
const money = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthsBetween = (from: string, to: string) => {
  const a = new Date(`${from.slice(0, 10)}T00:00:00Z`), b = new Date(`${to}T00:00:00Z`);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
};
const bucket = (m: number) => (m < 6 ? '0-6' : m < 12 ? '6-12' : m < 24 ? '12-24' : '24+');

(async () => {
  if (!['dev', 'prod'].includes(ENV)) throw new Error('--env dev|prod');
  if (APPLY && ENV === 'prod' && !argv.includes('--confirm-prod')) throw new Error('prod --apply needs --confirm-prod');
  const url = ENV === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error('database url not set');
  const c = new Client({ connectionString: url });
  await c.connect();
  if (!APPLY) await c.query('SET default_transaction_read_only = on');
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows;
  const lines: string[] = [];
  const say = (s = '') => {
    lines.push(s);
    console.log(s);
  };
  const log: any = { env: ENV, mode: APPLY ? 'APPLY' : 'DRY RUN', at: new Date().toISOString(), today: TODAY, writes: [] };

  say(`${ENV.toUpperCase()} imported orders, part billed ${log.mode} (today ${TODAY})`);
  const all: any[] = [];
  for (const [org, orgName] of Object.entries(ORGS)) {
    const orders = (await q(`select id::text id, "orderNumber", status, "linkedDocuments", "sourceQuotationId"::text "sourceQuotationId" from "Order" where "organizationId" = $1 and "orderNumber" like 'ORD-Q-%'`, [org])).filter((o) => isImportedOrder(o));
    const invIds = [...new Set(orders.flatMap((o) => (Array.isArray(o.linkedDocuments?.invoice) ? o.linkedDocuments.invoice.map((r: any) => r?.id).filter(Boolean) : [])))];
    const qIds = [...new Set(orders.map((o) => o.sourceQuotationId).filter(Boolean))];
    const docs = new Map<string, any>();
    for (let i = 0; i < invIds.length; i += 2000) for (const d of await q(`select id::text id, name, status::text status, config from "Document" where id = any($1::uuid[])`, [invIds.slice(i, i + 2000)])) docs.set(d.id, d);
    const quotes = new Map<string, any>();
    for (let i = 0; i < qIds.length; i += 2000) for (const d of await q(`select id::text id, name, config from "Document" where id = any($1::uuid[])`, [qIds.slice(i, i + 2000)])) quotes.set(d.id, d);
    for (const o of orders) {
      const m: any = importedMarkerOf(o) || {};
      const refs: any[] = Array.isArray(o.linkedDocuments?.invoice) ? o.linkedDocuments.invoice : [];
      const invDocs = refs.map((r) => docs.get(r.id)).filter(Boolean);
      const qo = o.sourceQuotationId ? quotes.get(o.sourceQuotationId) : null;
      const quoteTotal = m.quoteTotal != null && Number.isFinite(Number(m.quoteTotal)) ? Number(m.quoteTotal) : qo ? grossOf(qo.config) : null;
      const credit = (d: any) => Number(m.credits?.[d.id]) || creditOfImportedInvoice(d.config);
      const manual = importedCompletionOf(o);
      // An order made from an ERP DO before any invoice keeps its DO status (DO draft / DO completed, invoice pending).
      const st = importedOrderStatus(invDocs.map((d) => ({ ...d, credit: credit(d) })), quoteTotal, { completed: manual, partBilledRule: true, dos: importedDosOf(o) });
      const billing = invDocs.filter((d) => isCountedInvoice(d) && importedInvoiceMoney(d, credit(d)).net >= 0.005);
      const lastInvoice = billing.map((d) => String(d.config?.date || '')).filter(Boolean).sort().pop() || null;
      const quoteDate = String(qo?.config?.date || '') || null;
      let next = st.status as string;
      let auto = false;
      if (!manual && st.status === 'PART_BILLED') {
        if ((lastInvoice && monthsBetween(lastInvoice, TODAY) >= 12) || (!lastInvoice && quoteDate && monthsBetween(quoteDate, TODAY) >= 18)) {
          next = 'COMPLETED';
          auto = true;
        }
      }
      const rem = st.status === 'PART_BILLED' ? remainingForOrder({ marker: m, invoiceDocs: invDocs, quotation: qo ? { name: qo.name, config: qo.config } : null, quoteTotal: st.quoteTotal, billed: st.billed }) : null;
      const ageFrom = lastInvoice || quoteDate || TODAY;
      all.push({ org, orgName, o, st, next, auto, manual: !!manual, rem, lastInvoice, quoteDate, age: monthsBetween(ageFrom, TODAY), customer: qo?.config?.customerName || '', quotation: qo?.name || m.quotationNo || '' });
    }
  }

  const count = (rows: any[], f: (r: any) => string) => rows.reduce((acc: Record<string, number>, r) => ((acc[f(r)] = (acc[f(r)] ?? 0) + 1), acc), {});
  const fmt = (o: Record<string, number>) => Object.entries(o).sort().map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
  for (const [org, orgName] of Object.entries(ORGS)) {
    const rows = all.filter((r) => r.org === org);
    const part = rows.filter((r) => r.st.status === 'PART_BILLED');
    const open = part.filter((r) => !r.auto), auto = part.filter((r) => r.auto);
    const sum = (rs: any[]) => rs.reduce((t, r) => t + (r.rem?.remainingGross ?? 0), 0);
    say('');
    say(`${orgName}: ${rows.length} imported orders`);
    say(`  status now (stored): ${fmt(count(rows, (r) => r.o.status))}`);
    say(`  status after:        ${fmt(count(rows, (r) => r.next))}`);
    say(`  changes: ${fmt(count(rows.filter((r) => r.next !== r.o.status), (r) => `${r.o.status} -> ${r.next}${r.auto ? ' (auto)' : ''}`))}`);
    say(`  part billed by rule B: ${part.length} · open (stay Part billed) ${open.length} · auto-completed ("${IMPORTED_AUTO_COMPLETE_REASON}") ${auto.length} · already marked complete by a person ${rows.filter((r) => r.manual).length}`);
    say(`  part billed by age of the last invoice (or the quotation when none), months: ${['0-6', '6-12', '12-24', '24+'].map((b) => `${b}: ${part.filter((r) => bucket(r.age) === b).length} (open ${open.filter((r) => bucket(r.age) === b).length})`).join(' · ')}`);
    say(`  remaining value (quotation total - billed, GST incl.): open S$ ${money(sum(open))} · auto-completed S$ ${money(sum(auto))} · all part billed S$ ${money(sum(part))}`);
    say(`  lines matched per quotation line: ${part.filter((r) => r.rem?.matched).length} · one-line fallback: ${part.filter((r) => r.rem && !r.rem.matched).length} (${fmt(count(part.filter((r) => r.rem && !r.rem.matched), (r) => String(r.rem.reason).replace(/\(.*\)/, '(...)')))})`);
    say(`  orders with a qty > 1 line billed less than quoted: ${part.filter((r) => r.rem?.partQtyLines?.length).length}`);
    say(`  no invoice billing anything: ${part.filter((r) => !r.lastInvoice).length} (quotation over 18 months: ${part.filter((r) => !r.lastInvoice && r.auto).length})`);
  }
  const part = all.filter((r) => r.st.status === 'PART_BILLED');
  say('');
  say('20 samples (open first): org | order | customer | quotation total | billed | left | last invoice | age (months) | decision | lines');
  const pick = [...part.filter((r) => !r.auto).sort((a, b) => a.age - b.age), ...part.filter((r) => r.auto).sort((a, b) => a.age - b.age)];
  const step = Math.max(1, Math.floor(pick.length / 20));
  const target = all.find((r) => r.o.orderNumber === 'ORD-Q-014154');
  const samples = [...(target ? [target] : []), ...pick.filter((_, i) => i % step === 0).filter((r) => r !== target)].slice(0, 20);
  for (const r of samples) {
    const left = r.rem?.lines?.filter((l: any) => l.priced).map((l: any) => `${l.quantity} x ${firstLine(l.description).slice(0, 40)} @ ${money(l.unitPrice)}`).join('; ') || '';
    say(`  ${r.orgName} | ${r.o.orderNumber} | ${String(r.customer).slice(0, 30)} | ${money(r.st.quoteTotal ?? 0)} | ${money(r.st.billed)} | ${money(r.rem?.remainingGross ?? 0)} | ${r.lastInvoice ?? '-'} | ${r.age} | ${r.auto ? 'auto-complete' : 'Part billed (open)'}${r.rem?.progress ? ` | ${r.rem.progress.billed} of ${r.rem.progress.quoted}` : ''} | ${r.rem?.matched ? left : `one line: ${left}`}`);
  }

  // Every part-billed order, for review (the qty > 1 lines billed less than quoted are listed per order).
  const cell = (v: unknown) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const csvRows = part.map((r) => [r.orgName, r.o.orderNumber, r.quotation, r.customer, r.st.quoteTotal ?? '', r.st.billed, r.rem?.remainingGross ?? '', r.lastInvoice ?? '', r.quoteDate ?? '', r.age, r.auto ? 'auto-complete' : 'Part billed (open)', r.rem?.matched ? 'per line' : 'one line', r.rem?.progress ? `${r.rem.progress.billed} of ${r.rem.progress.quoted}` : '', (r.rem?.partQtyLines ?? []).map((l: any) => `${l.billed} of ${l.quoted}: ${l.description.slice(0, 60)}`).join(' | ')].map(cell).join(','));
  const csvFile = SUMMARY.replace(/-summary(\.dryrun)?\.txt$/, '').replace(/\.txt$/, '') + '-orders.csv';
  fs.writeFileSync(csvFile, ['org,order,quotation,customer,quotation_total,billed,left_to_bill,last_invoice,quotation_date,age_months,decision,remaining_lines,billed_qty,qty_lines_billed_less_than_quoted', ...csvRows].join('\n') + '\n');
  say(`orders list: ${csvFile}`);

  // Writes.
  // Every imported order gets the 2026-11-19 mark (partBilledRule), so the app reads it by the same rule from now on.
  const todo = all.filter((r) => r.next !== r.o.status || r.auto || importedMarkerOf(r.o)?.partBilledRule !== true);
  say('');
  say(`${APPLY ? 'writing' : 'would write'}: ${todo.length} order(s) (status ${todo.filter((r) => r.next !== r.o.status).length}, auto-complete marks ${todo.filter((r) => r.auto).length})`);
  if (APPLY && todo.length) {
    const at = new Date().toISOString();
    for (let i = 0; i < todo.length; i += 200) {
      await c.query('BEGIN');
      try {
        for (const r of todo.slice(i, i + 200)) {
          const ld = r.o.linkedDocuments || {};
          const nextLd = { ...ld, imported: { ...ld.imported, partBilledRule: true, ...(r.auto ? { completed: { at, by: null, byName: null, reason: IMPORTED_AUTO_COMPLETE_REASON, auto: true } } : {}) } };
          await c.query(`update "Order" set status = $2, "linkedDocuments" = $3::jsonb, "updatedAt" = now() where id = $1::uuid`, [r.o.id, r.next, JSON.stringify(nextLd)]);
          if (r.auto) {
            await c.query(
              `insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
               values (gen_random_uuid(), 'SYSTEM', $1, 'System creation', $2, 'operator', 'COMPLETE', 'order', $3, $4, 'SUCCESS')`,
              [JOB, r.org, r.o.id, JSON.stringify({ note: `Imported order ${r.o.orderNumber} marked complete: ${IMPORTED_AUTO_COMPLETE_REASON} (last invoice ${r.lastInvoice ?? 'none'}, quotation ${r.quoteDate ?? '?'}, billed ${r.st.billed} of ${r.st.quoteTotal})` })],
            );
          }
          log.writes.push({ id: r.o.id, org: r.org, orderNumber: r.o.orderNumber, before: r.o.status, after: r.next, auto: r.auto, lastInvoice: r.lastInvoice, remaining: r.rem?.remainingGross ?? null });
        }
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }
    const f = path.join(process.env.HOME || '', `Desktop/aims/_imports/wct/logs/wct-imported-part-billed.${ENV}.${at.replace(/[:.]/g, '-')}.log.json`);
    fs.writeFileSync(f, JSON.stringify(log, null, 1));
    say(`log: ${f}`);
  }
  fs.mkdirSync(path.dirname(SUMMARY), { recursive: true });
  fs.writeFileSync(SUMMARY.replace(/\.txt$/, APPLY ? '.txt' : '.dryrun.txt'), lines.join('\n') + '\n');
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
