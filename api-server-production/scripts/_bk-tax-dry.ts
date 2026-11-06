/**
 * Round BK — DRY RUN (read-only; any DB write throws): the import tax estimate of every open ADH shipment, before
 * (round BI: typed CIF + typed rate, 加算運賃 typed / EQMC always added) → after (ADH's calculator: CIF = SG→JP invoice
 * total, customs weekly rate of the clearance week, 加算運賃 off unless switched on). Nothing is stored by this round —
 * the estimate is computed on view. Prod: DBURL inline, TENANCY_MODE=, AWS env (SG→JP PDFs), internet (customs.go.jp).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { S3Service } from '../src/common/services/s3.service';
import { importTax } from '../src/shipments/trade-customs';
import { estimate, ShipmentCosts } from '../src/shipments/trade-estimator';
import { TradeTaxInputsService } from '../src/shipments/trade-tax-inputs';

const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const WRITES = /^(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw|\$executeRawUnsafe|\$transaction)$/;
const readOnly = (p: PrismaClient): any =>
  new Proxy(p as any, {
    get(t, k: string) {
      if (WRITES.test(k)) throw new Error(`read-only: ${k}`);
      const v = t[k];
      if (v && typeof v === 'object' && !k.startsWith('$')) return new Proxy(v, { get: (m, op: string) => { if (WRITES.test(op)) throw new Error(`read-only: ${k}.${op}`); const f = m[op]; return typeof f === 'function' ? f.bind(m) : f; } });
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
const yen = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `¥${n.toLocaleString('en-US')}`);
(async () => {
  const raw = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  const prisma = readOnly(raw);
  const inputs = new TradeTaxInputsService(prisma, new S3Service({ get: (k: string, d?: string) => process.env[k] ?? d } as any));
  const ships = await raw.shipment.findMany({
    where: { organizationId: ORG, status: 'OPEN', order: { isTest: false } },
    select: { id: true, seqNo: true, eta: true, netWeightMt: true, grossWeightMt: true, containerCount: true, costs: true, order: { select: { orderNo: true } }, steps: { where: { code: { in: ['TAX_FUNDS', 'IMPORT_PERMIT'] } }, select: { code: true, status: true } } },
  });
  ships.sort((a, b) => (a.order!.orderNo - b.order!.orderNo) || ((a.seqNo ?? 0) - (b.seqNo ?? 0)));
  const rates = { blFee: 0 } as any;
  console.log('DRY RUN · Round BK · import tax estimate, open shipments (before → after)\n');
  for (const s of ships) {
    const c = (s.costs ?? {}) as ShipmentCosts;
    const ref = `#${s.order!.orderNo}-${s.seqNo}`;
    // Before (round BI): typed CIF + typed rate only; 加算運賃 = typed ?? EQMC ?? 0, always added.
    const oldAdd = c.customsAddOnJpy ?? c.equipmentFee ?? 0;
    const before = c.cifUsd != null && c.fxRate != null ? importTax(Number(c.cifUsd), Number(c.fxRate), Number(oldAdd)).total : null;
    const clearance = c.clearanceDate || (s.eta ? s.eta.toISOString().slice(0, 10) : null);
    const ctx = { cif: await inputs.cifFor(ORG, s.id, s.netWeightMt === null ? null : Number(s.netWeightMt)), rate: await inputs.usdRateFor(clearance) };
    const t = estimate({ ...s, eta: s.eta?.toISOString() }, c, { ...rates, truckRates: {}, taxMultiplier: 1.1, customsPerMt: 0 } as any, {}, ctx).importTax;
    const cif = t.cifUsd === null ? 'CIF —' : `CIF ${t.cifUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${t.cifSource?.kind === 'typed' ? `typed${t.cifSource.sgjpAmount != null && Math.abs(t.cifSource.sgjpAmount - t.cifUsd) > 0.004 ? `; SG→JP says ${t.cifSource.sgjpAmount}` : ''}` : `${t.cifSource?.kind} ${t.cifSource?.invoiceNo ?? t.cifSource?.ref}`})`;
    const fx = t.fxRate === null ? 'rate —' : `rate ${t.fxRate} (${t.fxSource?.kind === 'typed' ? `typed${t.fxSource.customsRate != null && t.fxSource.customsRate !== t.fxRate ? `; customs ${t.fxSource.customsRate}` : ''}` : `customs ${t.fxSource?.start}…${t.fxSource?.end}${t.fxSource?.provisional ? ' provisional' : ''}`})`;
    const add = t.addOnValue === null ? '加算運賃 —' : `加算運賃 ${yen(t.addOnValue)} ${t.addOnIncluded ? 'ON' : 'off'} (${t.addOnSource}; +${yen(t.addOnEffect)} if on)`;
    const actual = c.importTaxActual != null ? ` · permit ${yen(Number(c.importTaxActual))} (diff ${yen(Number(c.importTaxActual) - (t.estimate ?? 0))}, with 加算運賃 ${yen(t.addOnEffect === null || t.estimate === null ? null : Number(c.importTaxActual) - t.estimate - (t.addOnIncluded ? 0 : t.addOnEffect))})` : '';
    console.log(`${ref.padEnd(7)} ${yen(before).padStart(12)} → ${yen(t.estimate).padStart(12)}   ${cif} · ${fx} · clearance ${t.clearanceDate ?? '—'} (${t.clearanceFrom ?? '—'}) · ${add}${actual} · funded ${yen(c.importTaxFunded as any)}`);
  }
  console.log('\nNothing written. The estimate is computed on view; no stored value changes with this round.');
  await raw.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
