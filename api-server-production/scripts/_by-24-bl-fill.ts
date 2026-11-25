/**
 * Round BY (Sayaka, #24): fill #24-1's EMPTY B/L fields from its uploaded B/L draft read (TradeExtraction of
 * "BL SRI INDAH NLBSO 2611001-00.pdf"). Dry run by default; --apply --confirm-prod writes, logs every field to
 * scripts/_by-24-bl-fill.log.json and one ActionLog row. Never overwrites a value; a re-run plans 0 writes.
 * Prod: DBURL=<prod url> TENANCY_MODE= NODE_PATH=. npx ts-node --transpile-only scripts/_by-24-bl-fill.ts [--apply --confirm-prod]
 */
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';

const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const SHIPMENT = '2fbe50b3-9d2a-4c10-b6c8-a07e889c3665';
const FILE = '1055d373-9f7e-47be-868b-66cf92f95d51';
const FIELDS = ['blNumber', 'shippingLine', 'vessel', 'voyageNo', 'etd', 'portOfLoading', 'portOfDischarge', 'netWeightMt', 'grossWeightMt', 'totalBundles', 'totalPieces', 'containerCount', 'hsCode', 'countryOfOrigin'] as const;
const apply = process.argv.includes('--apply') && process.argv.includes('--confirm-prod');

(async () => {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  const s: any = await p.shipment.findFirst({ where: { id: SHIPMENT, organizationId: ORG }, include: { order: { select: { orderNo: true } } } });
  const ex: any = await p.tradeExtraction.findFirst({ where: { organizationId: ORG, fileId: FILE, status: 'DONE' }, orderBy: { createdAt: 'desc' } });
  if (!s || !ex) throw new Error('shipment or B/L read not found');
  const d = ex.result?.draft ?? {};
  const plan: Record<string, { from: unknown; to: unknown }> = {};
  const kept: string[] = [];
  for (const k of FIELDS) {
    const v = d[k];
    if (v === null || v === undefined || v === '') continue;
    const cur = s[k];
    if (cur !== null && cur !== undefined && cur !== '') {
      if (String(cur) !== String(k === 'etd' ? new Date(v).toISOString() : v) && !(k === 'etd' && cur.toISOString().slice(0, 10) === v)) kept.push(`${k}: keeps "${k === 'etd' ? cur.toISOString().slice(0, 10) : cur}" (B/L "${v}")`);
      continue;
    }
    plan[k] = { from: null, to: k === 'etd' ? new Date(`${v}T00:00:00Z`) : v };
  }
  if (plan.blNumber) {
    const clash = await p.shipment.findFirst({ where: { organizationId: ORG, blNumber: String(plan.blNumber.to), NOT: { id: SHIPMENT } }, select: { id: true } });
    if (clash) throw new Error(`B/L ${plan.blNumber.to} is already on shipment ${clash.id}`);
  }
  console.log(`#${s.order?.orderNo}-${s.seqNo} — ${Object.keys(plan).length} field(s) to fill (empty only):`);
  for (const [k, v] of Object.entries(plan)) console.log(`  ${k}: — → ${v.to instanceof Date ? v.to.toISOString().slice(0, 10) : v.to}`);
  for (const k of kept) console.log(`  (unchanged) ${k}`);
  if (!apply) {
    console.log(Object.keys(plan).length ? 'DRY RUN — nothing written. Re-run with --apply --confirm-prod.' : 'Nothing to do (0 writes).');
    return p.$disconnect();
  }
  if (!Object.keys(plan).length) return console.log('0 writes'), p.$disconnect();
  const data = Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, v.to]));
  await p.shipment.update({ where: { id: SHIPMENT }, data });
  await p.actionLog.create({
    data: { actorType: 'SYSTEM', actorId: 'system:by-24-bl-fill', actorName: 'System creation', organizationId: ORG, channel: 'cron', action: 'UPDATE', resource: 'shipments', resourceId: SHIPMENT, details: { note: 'Round BY: #24-1 empty B/L fields filled from its B/L draft read (step 3a save was blocked)', fileId: FILE, fields: Object.keys(plan) } as any },
  });
  fs.writeFileSync('scripts/_by-24-bl-fill.log.json', JSON.stringify({ at: new Date().toISOString(), shipmentId: SHIPMENT, fileId: FILE, written: plan }, null, 2));
  console.log(`APPLIED ${Object.keys(plan).length} field(s); log scripts/_by-24-bl-fill.log.json`);
  await p.$disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
