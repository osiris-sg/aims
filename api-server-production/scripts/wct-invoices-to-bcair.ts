/**
 * Move imported WCT (S) invoices that belong to a BC Air quotation into BC Air, onto that quotation's imported order
 * (Elroy 19 Nov: I-015299 -> ORD-Q-013548; the 35 real-amount invoices of wct-invoices-to-bcair-quotations.csv).
 *
 * Moves only what can move cleanly. REFUSED (listed, nothing written) when the invoice has a WCT (S) journal that is
 * not void (its ERP / ABSS history is in WCT (S)'s ledger), a payment, a credit note, sits on a WCT (S) order, or BC Air
 * already has an invoice naming it in its reference (the real BC Air invoice for the job: moving would bill it twice).
 * A move: organization, BC Air's INVOICE template, the BC Air quotation's customer, BC Air's company block and GST no.,
 * config.movedFrom (before-image in the log), search embeddings; the invoice goes onto the order's invoice list
 * (linkSources: moved-from-wct) and the order's status is re-read. No amount, status or journal changes.
 * DRY RUN BY DEFAULT (read-only). One ActionLog row in each org per invoice; log JSON with before-images; --rollback.
 *   npx ts-node -r tsconfig-paths/register --transpile-only scripts/wct-invoices-to-bcair.ts --env prod --invoices I-015299=Q-013548 [--apply --confirm-prod]
 *   npx ts-node -r tsconfig-paths/register --transpile-only scripts/wct-invoices-to-bcair.ts --env prod --csv ~/Desktop/aims-agents/imports/wct-invoices-to-bcair-quotations.csv
 *   ... --rollback <log.json> [--apply --confirm-prod]
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '/Users/elroylee/Desktop/aims/api-server-production/.env' });
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { refreshOrderStatus } from '../src/orders/wct-orders';

const WCT = '5c700000-0000-4000-8000-5c7000000001';
const BC = '5c700000-0000-4000-8000-5c7000000004';
const argv = process.argv.slice(2);
const one = (k: string, d?: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const ENV = one('--env', 'dev')!;
const APPLY = argv.includes('--apply');
const ROLLBACK = one('--rollback');
const LOG_DIR = '/Users/elroylee/Desktop/aims/_imports/wct/logs';

function csvRows(file: string): Array<Record<string, string>> {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; } else f += ch;
  }
  if (f !== '' || row.length) { row.push(f.replace(/\r$/, '')); rows.push(row); }
  const [h, ...b] = rows.filter((r) => r.length > 1);
  return b.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
}

(async () => {
  if (APPLY && ENV === 'prod' && !argv.includes('--confirm-prod')) throw new Error('prod --apply needs --confirm-prod');
  const prisma = new PrismaClient({ datasources: { db: { url: ENV === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL } } });
  const q = (sql: string, ...p: any[]) => prisma.$queryRawUnsafe<any[]>(sql, ...p);
  console.log(`${ENV.toUpperCase()} ${APPLY ? 'APPLY' : 'DRY RUN'}${ROLLBACK ? ' ROLLBACK' : ''}: WCT (S) invoices to BC Air`);

  if (ROLLBACK) {
    const log = JSON.parse(fs.readFileSync(ROLLBACK, 'utf8'));
    for (const m of log.moved) {
      console.log(`  back: ${m.name} -> WCT (S), off ${m.order}`);
      if (!APPLY) continue;
      await prisma.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe(`update "Document" set "organizationId" = $2, "documentTemplateId" = $3, "listCustomerId" = $4, config = $5::jsonb, "updatedAt" = now() where id = $1::uuid and "organizationId" = $6`, m.id, WCT, m.before.templateId, m.before.listCustomerId, JSON.stringify(m.before.config), BC);
        await tx.$executeRawUnsafe(`update "DocumentEmbedding" set "organizationId" = $2 where "documentId"::text = $1`, m.id, WCT);
        await tx.$executeRawUnsafe(`update "Order" set "linkedDocuments" = $2::jsonb, "updatedAt" = now() where id = $1::uuid`, m.orderId, JSON.stringify(m.orderBefore));
        for (const org of [WCT, BC]) await tx.$executeRawUnsafe(`insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status) values (gen_random_uuid(), 'SYSTEM', 'system:wct-invoices-to-bcair', 'System creation', $1, 'operator', 'UPDATE', 'document', $2, $3::jsonb, 'SUCCESS')`, org, m.id, JSON.stringify({ note: `Rolled back: invoice ${m.name} back to WCT (S), off ${m.order}` }));
      });
      await refreshOrderStatus(prisma, BC, m.orderId);
    }
    await prisma.$disconnect();
    return;
  }

  // What to move: --invoices I-1=Q-2,... or the CSV (ERP total not 1.00 / 0.00, column "BC Air quotation key").
  const wanted: Array<{ inv: string; quote: string }> = [];
  for (const pair of String(one('--invoices', '')).split(',').filter(Boolean)) {
    const [inv, quote] = pair.split('=');
    wanted.push({ inv: inv.trim(), quote: quote.trim() });
  }
  if (one('--csv')) {
    for (const r of csvRows(one('--csv')!)) {
      if (['1.00', '0.00', '1', '0', ''].includes(String(r['ERP total']).trim())) continue;
      wanted.push({ inv: r.invoice, quote: `Q-${String(r['BC Air quotation key']).trim().padStart(6, '0')}` });
    }
  }
  if (!wanted.length) throw new Error('--invoices I-x=Q-y,... or --csv <file>');

  const tmpl = (await q(`select t.id::text id from "OrganizationActiveTemplate" a join "DocumentTemplate" t on t.id = a."templateId" where a."organizationId"::text = $1 and a.type = 'INVOICE' order by a."isPrimary" desc limit 1`, BC))[0]
    ?? (await q(`select id::text from "DocumentTemplate" where "organizationId" = $1 and type = 'INVOICE' order by "isDefault" desc, "isActive" desc, "createdAt" desc limit 1`, BC))[0];
  if (!tmpl) throw new Error('BC Air has no INVOICE template');
  const bcOrg = (await q(`select name, address, "phoneNumber", "registrationNumber" from "Organization" where id = $1`, BC))[0];
  const plans: any[] = [];
  for (const w of wanted) {
    const d = (await q(`select id::text, name, status::text status, "documentTemplateId"::text "templateId", "listCustomerId", config from "Document" where "organizationId" = $1 and type = 'INVOICE' and name = $2`, WCT, w.inv))[0];
    const why: string[] = [];
    if (!d) { plans.push({ ...w, why: ['not an invoice in WCT (S)'] }); continue; }
    if (!d.config?.erpImport) why.push('not imported');
    const jes = Number((await q(`select count(*)::int n from "JournalEntry" where "organizationId" = $1 and "sourceDocumentId"::text = $2 and status <> 'VOID'`, WCT, d.id))[0].n);
    if (jes) why.push(`${jes} WCT (S) journal(s) (its ledger history stays in WCT (S))`);
    const pays = Number((await q(`select count(*)::int n from "Payment" where "documentId"::text = $1`, d.id))[0].n);
    if (pays) why.push(`${pays} payment(s)`);
    const cns = Number((await q(`select count(*)::int n from "Document" where type in ('CREDIT_NOTE','CN') and config->>'sourceDocumentId' = $1`, d.id))[0].n);
    if (cns) why.push(`${cns} credit note(s)`);
    const onOrder = (await q(`select "orderNumber" from "Order" where "organizationId" = $1 and ("invoiceDocumentId"::text = $2 or "linkedDocuments"::text like '%' || $2 || '%')`, WCT, d.id)).map((o: any) => o.orderNumber);
    if (onOrder.length) why.push(`on WCT (S) order ${onOrder.join(', ')}`);
    const twin = (await q(`select name, config->>'totalWithTax' tot from "Document" where "organizationId" = $1 and type = 'INVOICE' and (config->>'referenceNo' = $2 or config->>'reference' = $2)`, BC, d.name)).map((t: any) => `${t.name} ($${t.tot})`);
    if (twin.length) why.push(`BC Air already has ${twin.join(', ')} for this job`);
    const quote = (await q(`select id::text, name, config->>'customerId' "customerId" from "Document" where "organizationId" = $1 and type = 'QUOTATION' and name = $2`, BC, w.quote))[0];
    if (!quote) why.push(`quotation ${w.quote} not in BC Air`);
    const order = quote ? (await q(`select id::text, "orderNumber", "linkedDocuments" from "Order" where "organizationId" = $1 and "sourceQuotationId"::text = $2`, BC, quote.id))[0] : null;
    if (quote && !order) why.push(`no BC Air order for ${w.quote}`);
    const cust = quote?.customerId ? (await q(`select id::text, name, "customerCode" code from "Customer" where "organizationId" = $1 and id::text = $2`, BC, quote.customerId))[0] : null;
    if (quote && !cust) why.push(`${w.quote} has no BC Air customer`);
    plans.push({ ...w, d, quote, order, cust, why, owed: Number(d.config?.outstandingBalance ?? 0), total: Number(d.config?.totalWithTax ?? 0) });
  }
  const ok = plans.filter((p) => !p.why.length);
  const held = plans.filter((p) => p.why.length);
  for (const p of ok) console.log(`  MOVE ${p.inv} $${p.total} (owed $${p.owed}) -> BC Air ${p.order.orderNumber}, customer ${p.cust.code} ${p.cust.name}`);
  for (const p of held) console.log(`  HOLD ${p.inv}${p.total ? ` $${p.total}` : ''}: ${p.why.join('; ')}`);
  console.log(`  ${ok.length} to move, ${held.length} held`);
  if (!APPLY || !ok.length) {
    await prisma.$disconnect();
    return;
  }

  const log: any = { at: new Date().toISOString(), env: ENV, moved: [] };
  const now = new Date().toISOString();
  for (const p of ok) {
    const ld: any = p.order.linkedDocuments || {};
    const imp: any = ld.imported || {};
    const nextLd = {
      ...ld,
      invoice: [...(Array.isArray(ld.invoice) ? ld.invoice : []), { id: p.d.id, name: p.d.name, total: p.total, templateId: tmpl.id }],
      imported: { ...imp, linkSources: { ...(imp.linkSources || {}), [p.d.id]: 'moved-from-wct' } },
    };
    const patch = {
      customerId: p.cust.id,
      customerName: p.cust.name,
      customerCode: p.cust.code ?? '',
      company: { name: bcOrg.name, address: bcOrg.address ?? '', phoneNumber: bcOrg.phoneNumber ?? '' },
      gstRegNo: bcOrg.registrationNumber ?? '',
      movedFrom: { organizationId: WCT, wctCustomerId: p.d.config?.customerId ?? null, wctTemplateId: p.d.templateId, at: now, by: 'script', reason: `belongs to BC Air quotation ${p.quote.name} (Elroy 19 Nov)` },
    };
    await prisma.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe(`update "Document" set "organizationId" = $2, "documentTemplateId" = $3, "listCustomerId" = $4, config = config || $5::jsonb, "updatedAt" = now() where id = $1::uuid and "organizationId" = $6 and type = 'INVOICE'`, p.d.id, BC, tmpl.id, p.cust.id, JSON.stringify(patch), WCT);
      await tx.$executeRawUnsafe(`update "DocumentEmbedding" set "organizationId" = $2, "customerId" = $3 where "documentId"::text = $1`, p.d.id, BC, p.cust.id);
      await tx.$executeRawUnsafe(`update "Order" set "linkedDocuments" = $2::jsonb, "updatedAt" = now() where id = $1::uuid and "organizationId" = $3`, p.order.id, JSON.stringify(nextLd), BC);
      const note = `Invoice ${p.d.name} ($${p.total}, owed $${p.owed}) moved from WCT (S) to BC Air onto ${p.order.orderNumber} (quotation ${p.quote.name}); Elroy 19 Nov`;
      for (const org of [WCT, BC]) await tx.$executeRawUnsafe(`insert into "ActionLog"(id, "actorType", "actorId", "actorName", "organizationId", channel, action, resource, "resourceId", details, status) values (gen_random_uuid(), 'SYSTEM', 'system:wct-invoices-to-bcair', 'System creation', $1, 'operator', 'UPDATE', 'document', $2, $3::jsonb, 'SUCCESS')`, org, p.d.id, JSON.stringify({ note }));
    });
    const status = await refreshOrderStatus(prisma, BC, p.order.id);
    console.log(`  moved ${p.inv} onto ${p.order.orderNumber}: status ${status}`);
    log.moved.push({ id: p.d.id, name: p.d.name, order: p.order.orderNumber, orderId: p.order.id, before: { templateId: p.d.templateId, listCustomerId: p.d.listCustomerId, config: p.d.config }, orderBefore: p.order.linkedDocuments, statusAfter: status });
  }
  const f = path.join(LOG_DIR, `wct-invoices-to-bcair.${ENV}.${now.replace(/[:.]/g, '-')}.log.json`);
  fs.writeFileSync(f, JSON.stringify(log, null, 1));
  console.log(`  log ${f}`);
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
