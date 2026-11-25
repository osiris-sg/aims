/**
 * Round BZ (Sankyo Tateyama pricing, from Take): prod data for #24 — dry run by default.
 *  1. Sankyo Tateyama's 6063 product (Clients › Products): price basis "Fixed unit price (all-in)" 3,750.00 USD/MT
 *     (only while it has no price mode).
 *  2. #24-1 net weight 50.04 → 50.0395 MT: the B/L's 50,039.5 KGS at its own precision (round BY stored it rounded
 *     to 3 dp; needs the round BZ schema = Decimal(14,4) live first). Only while it is still 50.04.
 *  3. A NEW SG→JP INVOICE & PACKING LIST DRAFT on #24-1 at the fixed price (ADH20261125, 2026-11-25): header = ADH's own
 *     typed blocks of ADH20261120-SKT (clean shipper block, BATAM), one item 50.0395 MT × 3,750.00 = US$187,648.12.
 *     The two FINAL SG→JP invoices (ADH20261120-SKT, ADH20261125) are never touched. Skipped if a fixed-price draft exists.
 *  4. #24-1 step 7 CIF (costs.cifUsd) 170,690.23 → 187,648.12: the stored value is ADH20261120-SKT's formula total
 *     (50.0395 × 3,411.11), filled on its finalize — only while it still equals that amount.
 * --apply --confirm-prod writes, one ActionLog row (system:bz-24-sankyo), log scripts/_bz-24-sankyo.log.json.
 * Prod: DBURL=<prod url> TENANCY_MODE= NODE_PATH=. npx ts-node --transpile-only scripts/_bz-24-sankyo.ts [--apply --confirm-prod] [--html=<file>]
 */
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { renderSgjpV2Html, sgjpTotals, SgjpHeaderV2, SgjpItem } from '../src/shipments/trade-logistics-docs';

const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const SANKYO = '7cf77eb1-f67c-430d-8892-8efb6acdd984';
const PRODUCT = '351577ab-9c3e-4464-ab99-1f2de921272f';
const SHIPMENT = '2fbe50b3-9d2a-4c10-b6c8-a07e889c3665';
const SKT = '66c7dbcd-56c4-4cd6-9752-d40db2be65d3';
const PRICE = 3750;
const NET = 50.0395;
const OLD_CIF = 170690.23;
const apply = process.argv.includes('--apply') && process.argv.includes('--confirm-prod');
const htmlOut = process.argv.find((a) => a.startsWith('--html='))?.slice(7);

(async () => {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  const plan: string[] = [];
  const log: Record<string, unknown> = { at: new Date().toISOString() };

  // 1. product price basis
  const setting: any = await p.tradeSetting.findFirst({ where: { organizationId: ORG } });
  const profiles = (setting?.customerProfiles ?? {}) as Record<string, any>;
  const prof = profiles[SANKYO];
  const prod = (prof?.products ?? []).find((x: any) => x.id === PRODUCT);
  if (!prod) throw new Error('Sankyo 6063 product not found');
  const doProduct = !prod.priceMode;
  if (doProduct) plan.push(`Sankyo ${prod.grade} ${prod.form}: price basis — → Fixed unit price (all-in) ${PRICE.toFixed(2)} USD/MT`);
  else plan.push(`(unchanged) Sankyo product already priced: ${prod.priceMode} ${prod.fixedUnitPrice ?? ''}`);

  // 2. net weight at B/L precision
  const s: any = await p.shipment.findFirst({ where: { id: SHIPMENT, organizationId: ORG }, select: { netWeightMt: true, grossWeightMt: true, costs: true, seqNo: true, order: { select: { orderNo: true, year: true } } } });
  const net = s.netWeightMt === null ? null : Number(s.netWeightMt);
  const doNet = net === 50.04;
  if (doNet) plan.push(`#24-1 net weight 50.04 → ${NET} MT (B/L 50,039.5 KGS)`);
  else plan.push(`(unchanged) #24-1 net weight ${net}`);

  // 3. new fixed-price draft
  const docs: any[] = await p.tradeGeneratedDoc.findMany({ where: { organizationId: ORG, shipmentId: SHIPMENT, docType: 'SGJP_IV_PL' }, select: { id: true, number: true, status: true, docRef: true, header: true, rows: true } });
  const haveFixedDraft = docs.some((d) => d.status === 'DRAFT' && (d.rows ?? []).some((r: any) => r?.priceMode === 'FIXED_ALL_IN'));
  const skt = docs.find((d) => d.id === SKT);
  if (!skt) throw new Error('ADH20261120-SKT not found');
  const header: SgjpHeaderV2 = { ...(skt.header as SgjpHeaderV2), invoiceNo: 'ADH20261125', invoiceDate: '2026-11-25' };
  const item: SgjpItem = {
    goods: 'ALUMINIUM ALLOY INGOT 6063',
    hsCode: '7601.20',
    terms: 'CIF',
    priceMode: 'FIXED_ALL_IN',
    lme: null,
    qmjp: null,
    premium: null,
    upcharge: null,
    unitPrice: PRICE,
    quantity: NET,
    bundles: 45,
    pieces: 8375,
    netMt: NET,
    grossMt: s.grossWeightMt === null ? null : Number(s.grossWeightMt),
    dimension: '',
  };
  const total = sgjpTotals([item]).amount;
  const refs = new Set(docs.map((d) => d.docRef));
  let n = 2;
  while (refs.has(`26-24-1-SGJP-${n}`)) n++;
  const docRef = `26-24-1-SGJP-${n}`;
  if (!haveFixedDraft) plan.push(`NEW draft SG→JP ${header.invoiceNo} (${docRef}): ${NET} MT × ${PRICE.toFixed(2)} = US$${total.toFixed(2)} · POR/POL ${header.placeOfReceipt} / ${header.portOfLoading}`);
  else plan.push('(unchanged) a fixed-price SG→JP draft already exists on #24-1');
  for (const d of docs) plan.push(`  kept: ${d.number ?? '(draft)'} ${d.status} ${d.docRef} total US$${sgjpTotals(d.rows ?? []).amount.toFixed(2)}`);
  if (htmlOut) fs.writeFileSync(htmlOut, renderSgjpV2Html(header, [item], { draft: true }));

  // 4. CIF
  const costs = (s.costs ?? {}) as Record<string, unknown>;
  const doCif = Number(costs.cifUsd) === OLD_CIF;
  if (doCif) plan.push(`#24-1 step 7 CIF ${OLD_CIF} (ADH20261120-SKT formula total) → ${total.toFixed(2)}`);
  else plan.push(`(unchanged) #24-1 CIF ${costs.cifUsd ?? '—'}`);

  const writes = [doProduct, doNet, !haveFixedDraft, doCif].filter(Boolean).length;
  console.log(plan.join('\n'));
  console.log(`${writes} write(s) planned`);
  if (!apply) {
    console.log(writes ? 'DRY RUN — nothing written. Re-run with --apply --confirm-prod.' : 'Nothing to do (0 writes).');
    return p.$disconnect();
  }
  if (!writes) return console.log('0 writes'), p.$disconnect();
  const now = new Date().toISOString();
  if (doProduct) {
    const products = prof.products.map((x: any) => (x.id === PRODUCT ? { ...x, priceMode: 'FIXED_ALL_IN', fixedUnitPrice: PRICE, fixedCurrency: 'USD', updatedAt: now } : x));
    await p.tradeSetting.update({ where: { id: setting.id }, data: { customerProfiles: { ...profiles, [SANKYO]: { ...prof, products } } } });
    log.product = { id: PRODUCT, priceMode: 'FIXED_ALL_IN', fixedUnitPrice: PRICE, fixedCurrency: 'USD', before: { priceMode: prod.priceMode ?? null } };
  }
  if (doNet) {
    await p.shipment.update({ where: { id: SHIPMENT }, data: { netWeightMt: NET } });
    const back = await p.shipment.findFirst({ where: { id: SHIPMENT }, select: { netWeightMt: true } });
    if (Number(back?.netWeightMt) !== NET) throw new Error(`net weight stored as ${back?.netWeightMt} — is the Decimal(14,4) schema live?`);
    log.netWeightMt = { from: 50.04, to: NET };
  }
  let draftId: string | null = null;
  if (!haveFixedDraft) {
    const g = await p.tradeGeneratedDoc.create({
      data: { organizationId: ORG, shipmentId: SHIPMENT, docType: 'SGJP_IV_PL', issuingEntity: 'ADH_SG', status: 'DRAFT', docRef, header: header as any, columns: [], rows: [item] as any, createdById: 'system:bz-24-sankyo', createdByName: 'System creation' },
      select: { id: true },
    });
    draftId = g.id;
    log.draft = { id: g.id, docRef, invoiceNo: header.invoiceNo, total };
  }
  if (doCif) {
    await p.shipment.update({ where: { id: SHIPMENT }, data: { costs: { ...costs, cifUsd: total } as any } });
    log.cifUsd = { from: OLD_CIF, to: total };
  }
  await p.actionLog.create({
    data: { actorType: 'SYSTEM', actorId: 'system:bz-24-sankyo', actorName: 'System creation', organizationId: ORG, channel: 'cron', action: 'UPDATE', resource: 'shipments', resourceId: SHIPMENT, details: { note: 'Round BZ: Sankyo fixed all-in price 3,750 USD/MT; #24-1 net 50.0395; new SG→JP draft ADH20261125 at the fixed price; CIF follows it', ...log, draftId } as any },
  });
  fs.writeFileSync('scripts/_bz-24-sankyo.log.json', JSON.stringify(log, null, 2));
  console.log(`APPLIED ${writes} write(s); log scripts/_bz-24-sankyo.log.json`);
  await p.$disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
