/**
 * The 2026-11-19 Part billed mark for imported orders that are missing it (WCT (S), BC Air; Elroy 2026-11-23).
 * DRY RUN BY DEFAULT (read-only transaction).
 *
 * About 300 imported orders (made after 19 Nov by the catch-ups and the DO-only step) were created without
 * linkedDocuments.imported.partBilledRule, so they still read by the 18 Nov rule (Paid once every invoice is settled,
 * even below the quotation total). This gives them the mark and the status the order page then shows, by the same
 * rule as scripts/wct-imported-part-billed.ts used on the other ~8,700:
 *   Part billed = billed < quotation total; and a part-billed order whose last billing invoice is over 12 months
 *   old (or, with none, whose quotation is over 18 months old) is marked complete ("Imported, assumed closed").
 * Status comes from the same inputs as the order page (loadImportedOrderInputs: linked + cross-company invoices,
 * AIMS DOs). Writes only with --apply (prod also --confirm-prod): the mark, the status, the auto-complete mark,
 * one ActionLog row per order. Invoices, quotations and books are never written.
 *
 *   npx ts-node --transpile-only scripts/wct-part-billed-mark.ts --env prod
 *   npx ts-node --transpile-only scripts/wct-part-billed-mark.ts --env prod --apply --confirm-prod
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PrismaClient } from '@prisma/client';
import {
  IMPORTED_AUTO_COMPLETE_REASON,
  creditOfImportedInvoice,
  importedCompletionOf,
  importedInvoiceMoney,
  importedMarkerOf,
  importedStatusFrom,
  isCountedInvoice,
  isImportedOrder,
  loadImportedOrderInputs,
  usesPartBilledRule,
} from '../src/orders/imported-orders';

const ORGS: Record<string, string> = { '5c700000-0000-4000-8000-5c7000000001': 'WCT (S)', '5c700000-0000-4000-8000-5c7000000004': 'BC Air' };
const argv = process.argv.slice(2);
const one = (k: string, d?: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const ENV = one('--env', 'dev')!;
const APPLY = argv.includes('--apply');
const TODAY = one('--today', new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10))!;
const OUT = one('--out', path.join(os.homedir(), 'Desktop/aims/_imports/wct/logs'))!;
const JOB = 'wct-part-billed-mark';
const money = (n: number) => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthsBetween = (from: string, to: string) => {
  const a = new Date(`${from.slice(0, 10)}T00:00:00Z`), b = new Date(`${to}T00:00:00Z`);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
};
const LABEL: Record<string, string> = { PAID: 'Paid', INVOICED: 'Invoiced', PART_BILLED: 'Part billed', COMPLETED: 'Complete', DO_COMPLETED: 'DO completed', DO_DRAFT: 'DO draft' };
const lab = (s: string) => LABEL[s] ?? s;

function dbUrl(): string {
  const key = ENV === 'prod' ? 'PROD_DATABASE_URL' : 'DATABASE_URL';
  if (process.env[key]) return process.env[key]!;
  const line = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n').find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`${key} not set`);
  return line.slice(key.length + 1).trim().replace(/^"|"$/g, '');
}

(async () => {
  if (!['dev', 'prod'].includes(ENV)) throw new Error('--env dev|prod');
  if (APPLY && ENV === 'prod' && !argv.includes('--confirm-prod')) throw new Error('prod --apply needs --confirm-prod');
  const prisma: any = new PrismaClient({ datasources: { db: { url: dbUrl() } } });
  const L: string[] = [];
  const say = (s = '') => {
    L.push(s);
    console.log(s);
  };
  const at = new Date().toISOString();
  say(`${ENV.toUpperCase()} Part billed mark for imported orders missing it · ${APPLY ? 'APPLY' : 'DRY RUN'} · today ${TODAY}`);
  const rows: any[] = [];
  try {
    for (const [org, orgName] of Object.entries(ORGS)) {
      const orders = (
        await prisma.order.findMany({ where: { organizationId: org, orderNumber: { startsWith: 'ORD-Q-' } }, select: { id: true, orderNumber: true, status: true, sourceQuotationId: true, linkedDocuments: true } })
      ).filter((o: any) => isImportedOrder(o) && !usesPartBilledRule(o));
      const inputs = await loadImportedOrderInputs(prisma, org, orders, {});
      const qIds = [...new Set(orders.map((o: any) => o.sourceQuotationId).filter(Boolean))];
      const qDate = new Map<string, string>();
      for (const d of qIds.length ? await prisma.document.findMany({ where: { organizationId: org, id: { in: qIds } }, select: { id: true, config: true } }) : []) qDate.set(d.id, String((d as any).config?.date || ''));
      for (const o of orders) {
        const inp = inputs.get(o.id)!;
        const m: any = importedMarkerOf(o) || {};
        const marked = { ...o, linkedDocuments: { ...(o.linkedDocuments as any), imported: { ...m, partBilledRule: true } } };
        const st = importedStatusFrom(marked, inp);
        const credit = (d: any) => Number(m.credits?.[d.id]) || creditOfImportedInvoice(d.config);
        const billing = inp.invoiceDocs.filter((d: any) => isCountedInvoice(d) && importedInvoiceMoney(d, credit(d)).net >= 0.005);
        const lastInvoice = billing.map((d: any) => String(d.config?.date || '').slice(0, 10)).filter(Boolean).sort().pop() || null;
        const quoteDate = (o.sourceQuotationId && qDate.get(o.sourceQuotationId)?.slice(0, 10)) || null;
        let next = st.status as string;
        let auto = false;
        if (!importedCompletionOf(o) && st.status === 'PART_BILLED' && ((lastInvoice && monthsBetween(lastInvoice, TODAY) >= 12) || (!lastInvoice && quoteDate && monthsBetween(quoteDate, TODAY) >= 18))) {
          next = 'COMPLETED';
          auto = true;
        }
        rows.push({ org, orgName, o, next, auto, st, lastInvoice, quoteDate, doOnly: m.doOnly === true });
      }
    }
    for (const [org, orgName] of Object.entries(ORGS)) {
      const r = rows.filter((x) => x.org === org);
      const ch: Record<string, number> = {};
      for (const x of r) if (x.next !== x.o.status) ch[`${lab(x.o.status)} > ${lab(x.next)}${x.auto ? ' (assumed closed)' : ''}`] = (ch[`${lab(x.o.status)} > ${lab(x.next)}${x.auto ? ' (assumed closed)' : ''}`] || 0) + 1;
      say('');
      say(`${orgName}: ${r.length} orders get the mark (DO-only ${r.filter((x) => x.doOnly).length}) · status changes ${r.filter((x) => x.next !== x.o.status).length} · unchanged ${r.filter((x) => x.next === x.o.status).length}`);
      for (const [k, v] of Object.entries(ch).sort()) say(`  ${k}: ${v}`);
    }
    const changed = rows.filter((x) => x.next !== x.o.status);
    say('');
    say(`Total: ${rows.length} orders get the mark · ${changed.length} change status`);
    say('Samples (org | order | quotation total | billed | before > after | last invoice):');
    const must = ['ORD-Q-001494', 'ORD-Q-002009'];
    const samples = [...rows.filter((x) => must.includes(x.o.orderNumber)), ...changed.filter((x) => !must.includes(x.o.orderNumber)).filter((_, i) => i % Math.max(1, Math.floor(changed.length / 10)) === 0)].slice(0, 12);
    for (const x of samples) say(`  ${x.orgName} | ${x.o.orderNumber} | ${money(x.st.quoteTotal ?? 0)} | ${money(x.st.billed)} | ${lab(x.o.status)} > ${lab(x.next)}${x.auto ? ' (assumed closed)' : ''} | ${x.lastInvoice ?? '-'}`);
    fs.mkdirSync(OUT, { recursive: true });
    const cell = (v: unknown) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const csv = path.join(OUT, `wct-part-billed-mark.${ENV}.${APPLY ? 'apply' : 'dryrun'}.${at.replace(/[:.]/g, '-')}.csv`);
    fs.writeFileSync(csv, ['org,order,quotation_total,billed,status_before,status_after,assumed_closed,last_invoice,quotation_date,do_only', ...rows.map((x) => [x.orgName, x.o.orderNumber, x.st.quoteTotal ?? '', x.st.billed, x.o.status, x.next, x.auto, x.lastInvoice ?? '', x.quoteDate ?? '', x.doOnly].map(cell).join(','))].join('\n') + '\n');
    say(`orders list: ${csv}`);
    if (APPLY) {
      for (let i = 0; i < rows.length; i += 100) {
        await prisma.$transaction(async (tx: any) => {
          for (const x of rows.slice(i, i + 100)) {
            const ld: any = x.o.linkedDocuments || {};
            const nextLd = { ...ld, imported: { ...ld.imported, partBilledRule: true, ...(x.auto ? { completed: { at, by: null, byName: null, reason: IMPORTED_AUTO_COMPLETE_REASON, auto: true } } : {}) } };
            await tx.order.update({ where: { id: x.o.id }, data: { status: x.next, linkedDocuments: nextLd } });
            await tx.actionLog.create({
              data: {
                actorType: 'SYSTEM',
                actorId: JOB,
                actorName: 'System creation',
                organizationId: x.org,
                channel: 'operator',
                action: 'UPDATE',
                resource: 'order',
                resourceId: x.o.id,
                status: 'SUCCESS',
                details: { note: `Part billed rule (2026-11-19) applied to ${x.o.orderNumber}: ${lab(x.o.status)} > ${lab(x.next)}${x.auto ? ` (${IMPORTED_AUTO_COMPLETE_REASON})` : ''}`, billed: x.st.billed, quoteTotal: x.st.quoteTotal },
              },
            });
          }
        });
      }
      const log = path.join(OUT, `wct-part-billed-mark.${ENV}.${at.replace(/[:.]/g, '-')}.log.json`);
      fs.writeFileSync(log, JSON.stringify(rows.map((x) => ({ id: x.o.id, org: x.orgName, order: x.o.orderNumber, before: x.o.status, after: x.next, auto: x.auto })), null, 1));
      say(`APPLIED: ${rows.length} orders · log ${log}`);
    }
    fs.writeFileSync(path.join(OUT, `wct-part-billed-mark.${ENV}.${APPLY ? 'apply' : 'dryrun'}.txt`), L.join('\n') + '\n');
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
