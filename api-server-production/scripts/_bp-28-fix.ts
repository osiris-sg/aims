/**
 * Round BP item 3 (owner's go 2026-11-10): order #28 (Kato Dec 6063) client premium 285 → 260 (Kato's 6063 premium, as
 * #17 / #22 and ADH's invoice 202611_01; 285 is the 6005 premium) and #28-1 net weight ← 40.271 from its CI 9000600230
 * (only while empty). Logged old → new. Usage: DBURL=<prod url> TENANCY_MODE= npx ts-node --transpile-only scripts/_bp-28-fix.ts [--apply]
 */
import { PrismaClient } from '@prisma/client';

const ADH = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const APPLY = process.argv.includes('--apply');

async function main() {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  const o: any = await p.tradeOrder.findFirst({ where: { organizationId: ADH, orderNo: 28 }, select: { id: true, grade: true, clientPremium: true, customer: { select: { name: true } }, shipments: { select: { id: true, seqNo: true, netWeightMt: true, ciNumber: true } } } });
  if (!o || o.grade !== '6063' || !/Kato/.test(o.customer?.name ?? '')) throw new Error('#28 is not Kato 6063 — stop');
  const log = (resource: string, id: string, details: Record<string, unknown>) =>
    p.actionLog.create({ data: { actorType: 'SYSTEM', actorId: 'system:round-bp-28-fix', actorName: 'System creation', organizationId: ADH, channel: 'script', action: 'UPDATE', resource, resourceId: id, details: { script: 'scripts/_bp-28-fix.ts', go: 'owner 2026-11-10 (round BP item 3)', ...details } as any } });
  const prem = Number(o.clientPremium);
  if (prem === 260) console.log('#28 client premium already 260');
  else {
    console.log(`${APPLY ? 'write' : 'would write'} #28 client premium ${prem} → 260`);
    if (APPLY) {
      await p.tradeOrder.update({ where: { id: o.id }, data: { clientPremium: 260 } });
      await log('TradeOrder', o.id, { order: '#28', clientPremium: { from: prem, to: 260 } });
    }
  }
  const s = o.shipments.find((x: any) => x.seqNo === 1);
  if (!s) throw new Error('#28-1 not found');
  if (s.netWeightMt !== null) console.log(`#28-1 net weight already ${s.netWeightMt} — left as is`);
  else {
    console.log(`${APPLY ? 'write' : 'would write'} #28-1 net weight — → 40.271 (CI ${s.ciNumber ?? '9000600230'})`);
    if (APPLY) {
      await p.shipment.update({ where: { id: s.id }, data: { netWeightMt: 40.271 } });
      await log('Shipment', s.id, { shipment: '#28-1', netWeightMt: { from: null, to: 40.271 }, source: 'CI 9000600230 (filed on #28, 2026-11-09)' });
    }
  }
  console.log(APPLY ? 'done' : 'DRY RUN — nothing written');
  await p.$disconnect();
}
main().catch((e) => {
  console.error(String(e?.message ?? e).slice(0, 300));
  process.exit(1);
});
