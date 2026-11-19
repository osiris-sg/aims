/**
 * Native WCT orders whose quotation (or one of its DOs) already has an AIMS invoice that is NOT on the order
 * (ORD202611-011 / I-015271, 19 Nov). Links the invoice on the ORDER only (linkedDocuments.invoice, and
 * invoiceDocumentId when the order has none); the invoice itself is never written. The status is re-derived by
 * the app's own refreshOrderStatus inside the same transaction. One ActionLog row per order, log file on apply.
 * DRY RUN BY DEFAULT (the same transaction, rolled back).
 *   npx ts-node --transpile-only scripts/wct-link-quote-invoices.ts --env prod [--order ORD202611-011] [--apply --confirm-prod]
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '/Users/elroylee/Desktop/aims/api-server-production/.env' });
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { refreshOrderStatus, orderInvoiceIdsOf } from '../src/orders/wct-orders';
import { isImportedOrder } from '../src/orders/imported-orders';
import { withSplitPartIds, invoiceSplitOf } from '../src/documents/invoice-split';
import { grossOf } from '../src/common/document-money';

const argv = process.argv.slice(2);
const one = (k: string, d?: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const ENV = one('--env', 'dev')!;
const ONLY = one('--order');
const APPLY = argv.includes('--apply');
const ORGS: Record<string, string> = {
  '5c700000-0000-4000-8000-5c7000000001': 'WCT (S)',
  '5c700000-0000-4000-8000-5c7000000002': 'Racking',
  '5c700000-0000-4000-8000-5c7000000003': 'YMM',
  '5c700000-0000-4000-8000-5c7000000004': 'BC Air',
};
const INVOICE_TYPES = ['INVOICE', 'TAX_INVOICE', 'INV'];
const DO_TYPES = ['DELIVERY_ORDER', 'DO'];
const dead = (c: any) => c?.voided === true || c?.cancelled === true;
class Rollback extends Error {}

(async () => {
  if (APPLY && ENV === 'prod' && !argv.includes('--confirm-prod')) throw new Error('prod --apply needs --confirm-prod');
  const url = ENV === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const orgIds = Object.keys(ORGS);

  const orders = await prisma.order.findMany({
    where: { organizationId: { in: orgIds }, ...(ONLY ? { orderNumber: ONLY } : {}) },
    select: { id: true, orderNumber: true, organizationId: true, customerId: true, sourceQuotationId: true, status: true, statusDates: true, linkedDocuments: true, invoiceDocumentId: true },
    orderBy: { orderNumber: 'asc' },
  });
  // Every invoice any order of the group holds (to keep one order per invoice).
  const allOrders = ONLY ? await prisma.order.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true, orderNumber: true, linkedDocuments: true, invoiceDocumentId: true } }) : orders;
  const allJobs = await prisma.delivery.findMany({ where: { organizationId: { in: orgIds }, orderId: { not: null } }, select: { id: true, orderId: true, orderInvoiceId: true, status: true, verificationState: true, items: { select: { documentId: true } } } });
  const holders = new Map<string, Set<string>>();
  const hold = (inv: string | null | undefined, ord: string) => {
    if (!inv || String(inv).startsWith('claim:')) return;
    if (!holders.has(inv)) holders.set(inv, new Set());
    holders.get(inv)!.add(ord);
  };
  const numberOf = new Map(allOrders.map((o) => [o.id, o.orderNumber]));
  for (const o of allOrders) for (const i of orderInvoiceIdsOf(o)) hold(i, o.orderNumber);
  for (const j of allJobs) hold(j.orderInvoiceId, numberOf.get(j.orderId!) ?? j.orderId!);
  const groupDos = await prisma.document.findMany({ where: { organizationId: { in: orgIds }, type: { in: DO_TYPES } }, select: { id: true, name: true, status: true, config: true } });
  for (const d of groupDos) {
    const c: any = d.config || {};
    if (c.orderId && c.orderInvoiceId) hold(c.orderInvoiceId, numberOf.get(c.orderId) ?? c.orderId);
  }

  const found: any[] = [];
  let native = 0;
  for (const o of orders) {
    if (isImportedOrder(o) || o.status === 'CANCELLED') continue;
    native++;
    const jobs = allJobs.filter((j) => j.orderId === o.id);
    const jobDoIds = new Set(jobs.flatMap((j) => j.items.map((i) => i.documentId)).filter(Boolean) as string[]);
    const dos = groupDos.filter((d: any) => d.config?.orderId === o.id || jobDoIds.has(d.id));
    const known = new Set<string>([...orderInvoiceIdsOf(o), ...jobs.map((j) => j.orderInvoiceId).filter((v): v is string => !!v && !v.startsWith('claim:')), ...dos.map((d: any) => d.config?.orderInvoiceId).filter(Boolean)]);
    const knownRows = known.size ? await prisma.document.findMany({ where: { id: { in: [...known] } }, select: { id: true, config: true } }) : [];
    for (const id of withSplitPartIds([...known], knownRows as any)) known.add(id);
    const srcIds = [o.sourceQuotationId, ...dos.map((d) => d.id)].filter(Boolean) as string[];
    const cands = await prisma.document.findMany({
      where: {
        organizationId: o.organizationId,
        type: { in: INVOICE_TYPES },
        OR: [...srcIds.map((id) => ({ config: { path: ['sourceDocumentId'], equals: id } })), { config: { path: ['orderId'], equals: o.id } }],
      },
      select: { id: true, name: true, status: true, type: true, createdAt: true, config: true },
      orderBy: { createdAt: 'asc' },
    });
    const missing = cands.filter((d) => !known.has(d.id));
    if (!missing.length) continue;
    const q = o.sourceQuotationId ? await prisma.document.findFirst({ where: { id: o.sourceQuotationId }, select: { name: true, config: true } }) : null;
    for (const d of missing) {
      const c: any = d.config || {};
      const others = [...(holders.get(d.id) ?? [])].filter((n) => n !== o.orderNumber);
      const custOk = (c.customerId ?? c.customer?.id ?? null) === o.customerId;
      const split = invoiceSplitOf(c);
      const reasons: string[] = [];
      if (dead(c)) reasons.push('invoice voided / cancelled');
      if (others.length) reasons.push(`already on ${others.join(', ')}`);
      if (!custOk) reasons.push('another customer');
      if (split && split.groupId !== d.id) reasons.push('a split part (its original decides)');
      if (missing.filter((m) => !dead(m.config)).length > 1) reasons.push('more than one unlinked invoice on this order');
      if (known.size) reasons.push('the order already has an invoice');
      found.push({ o, d, q, srcType: c.sourceDocumentType || (c.orderId === o.id ? 'order' : ''), srcNo: c.sourceDocumentNumber || '', gross: grossOf(c), hold: reasons });
    }
  }

  console.log(`${ENV.toUpperCase()} ${APPLY ? 'APPLY' : 'DRY RUN'}: ${native} native orders checked (WCT group), ${found.length} unlinked invoice(s) found`);
  const log: any[] = [];
  for (const f of found) {
    const { o, d } = f;
    const head = `${ORGS[o.organizationId]} ${o.orderNumber} (${f.q?.name ?? 'no quotation'}, ${f.q?.config?.customerName ?? ''}) status ${o.status}: ${d.name} ${d.status} ${f.gross ?? ''} made from ${f.srcType} ${f.srcNo} on ${d.createdAt.toISOString().slice(0, 10)}`;
    if (f.hold.length) {
      console.log(`  HOLD ${head} · ${f.hold.join('; ')}`);
      continue;
    }
    let after: string | null = null;
    let ldAfter: any = null;
    try {
      await prisma.$transaction(
        async (tx: any) => {
          await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `order-invoice:${o.id}`);
          const fresh = await tx.order.findFirst({ where: { id: o.id }, select: { linkedDocuments: true, invoiceDocumentId: true, status: true } });
          if (JSON.stringify(fresh.linkedDocuments) !== JSON.stringify(o.linkedDocuments) || fresh.invoiceDocumentId !== o.invoiceDocumentId) throw new Error('the order changed since the scan; re-run');
          const ld: any = (fresh.linkedDocuments as any) || { po: [], do: [], invoice: [], salesOrder: [] };
          const entry = { id: d.id, name: d.name, jobIds: [], linkedBy: 'System (link existing invoice, Elroy 19 Nov)', linkedAt: new Date().toISOString() };
          ldAfter = { ...ld, invoice: [...(Array.isArray(ld.invoice) ? ld.invoice : []), entry] };
          await tx.order.update({ where: { id: o.id }, data: { linkedDocuments: ldAfter, ...(fresh.invoiceDocumentId ? {} : { invoiceDocumentId: d.id }) } });
          after = await refreshOrderStatus(tx, o.organizationId, o.id);
          if (!after) throw new Error('status refresh failed');
          if (!APPLY) throw new Rollback();
          await tx.$executeRawUnsafe(
            `insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status)
             values (gen_random_uuid(), 'SYSTEM', 'system:wct-link-quote-invoices', 'System creation', $1, 'operator', 'UPDATE', 'order', $2, $3::jsonb, 'SUCCESS')`,
            o.organizationId,
            o.id,
            JSON.stringify({ note: `Linked existing invoice ${d.name} to order ${o.orderNumber} (made from ${f.srcType} ${f.srcNo}, not on the order; Elroy 19 Nov): status ${o.status} -> ${after}`, invoiceId: d.id, invoiceName: d.name }),
          );
        },
        { timeout: 30_000, maxWait: 10_000 },
      );
    } catch (e: any) {
      if (!(e instanceof Rollback)) {
        console.log(`  FAILED ${head} · ${e.message}`);
        continue;
      }
    }
    console.log(`  ${APPLY ? 'LINKED' : 'WOULD LINK'} ${head} -> status ${after}${o.invoiceDocumentId ? '' : ' (order invoice set)'}`);
    log.push({ order: o.orderNumber, orderId: o.id, org: ORGS[o.organizationId], invoice: d.name, invoiceId: d.id, before: { status: o.status, linkedDocuments: o.linkedDocuments, invoiceDocumentId: o.invoiceDocumentId }, after: { status: after, linkedDocuments: ldAfter, invoiceDocumentId: o.invoiceDocumentId ?? d.id } });
  }
  if (APPLY && log.length) {
    const f = path.join(process.env.HOME || '', `Desktop/aims/_imports/wct/logs/wct-link-quote-invoices.${ENV}.${new Date().toISOString().replace(/[:.]/g, '-')}.log.json`);
    fs.writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), linked: log }, null, 1));
    console.log(`  log ${f}`);
  }
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
