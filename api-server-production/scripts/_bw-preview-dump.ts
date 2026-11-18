/**
 * Round BW — READ-ONLY: the Accounting preview of an ADH order computed by the real LotAccountingService against the
 * given database, written as a /preview/shipments fixture (lotPreview, chart, fxRates). The FxRate read is stubbed
 * (prod has no table until the deploy): --rate=<1 SGD = x USD> shows the preview as if that rate were typed for the
 * delivery month (the report labels it). Nothing is written to the database (every write method throws).
 *
 *   DATABASE_URL=<prod> TENANCY_MODE= npx ts-node --transpile-only scripts/_bw-preview-dump.ts --order=15 --out=<json> [--rate=0.780622]
 */
import { writeFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import { LotAccountingService } from '../src/shipments/lot-accounting.service';
import { ADH_CHART } from './_bw-adh-books';

const ORG = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];

(async () => {
  const orderNo = Number(arg('order') ?? 15);
  const out = arg('out');
  const rate = arg('rate') ? Number(arg('rate')) : null;
  if (!out) throw new Error('--out=<json> is required');
  const base = new PrismaClient();
  const deny = () => {
    throw new Error('read-only script');
  };
  // Read-only proxy: any write method on any model throws.
  const prisma: any = new Proxy(base, {
    get(t: any, model: string) {
      if (model === 'fxRate') return { findFirst: async () => (rate ? { rate, enteredByName: 'example — the FRS rate for Oct 2026', enteredAt: new Date('2026-11-18T00:00:00Z') } : null), findMany: async () => [] };
      const v = t[model];
      if (v && typeof v === 'object' && 'findMany' in v)
        return new Proxy(v, { get: (m: any, op: string) => (/^(create|update|upsert|delete)/.test(op) ? deny : typeof m[op] === 'function' ? m[op].bind(m) : m[op]) });
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  const config: any = { getSettings: (org: string) => base.tradeSetting.findUnique({ where: { organizationId: org }, select: { customerProfiles: true, supplierProfiles: true } }).then((r) => r ?? {}) };
  const svc = new LotAccountingService(prisma, config);
  const order = await base.tradeOrder.findFirst({ where: { organizationId: ORG, orderNo }, select: { id: true } });
  if (!order) throw new Error(`order #${orderNo} not found`);
  const preview = await svc.preview(ORG, order.id);
  const chart = ADH_CHART.map((a, i) => ({ id: `c${i}`, code: a.code, name: a.name, accountType: a.accountType, description: `Provisional — ${a.note}`, isActive: true, provisional: true }));
  const fxRates = rate ? [{ id: 'fx1', month: preview.deliveryMonth, currency: 'USD', baseCurrency: 'SGD', rate, note: 'FRS example rate', enteredByName: 'example — the FRS rate', enteredAt: '2026-11-18T00:00:00.000Z' }] : [];
  writeFileSync(out, JSON.stringify({ lotPreview: { [order.id]: preview }, chart, fxRates }, null, 2));
  console.log(`#${orderNo} (${order.id}) → ${out}`);
  console.log(`pattern ${preview.pattern} · month ${preview.deliveryMonth} · rate ${preview.usdRate}`);
  for (const p of preview.postings) console.log(`  ${p.status.padEnd(12)} ${p.title}`);
  for (const c of preview.checks) console.log(`  check ${c.key}: ${c.ok} — ${c.detail}`);
  console.log(`  rules needed: ${preview.rulesNeeded.length} · missing: ${preview.missing.join(' | ')}`);
  await base.$disconnect();
})().catch((e) => {
  console.error('ERR', e?.message ?? e);
  process.exit(1);
});
