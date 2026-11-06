/**
 * Round BG — READ-ONLY preview fixture from prod data for the round's screenshots (nothing is written to any database):
 *   - Clients › SUS / Kato › Process with Sayaka's due-date rules (in memory only) and the dry-run changes;
 *   - the upload dialog's link checklist opened from #18-1 (open orders / shipments with their CIs);
 *   - #18-1's 出庫・納入依頼書 as a fresh draft + its SI context, and the PDF of the rows her schedule paste builds.
 *
 *   DBURL=<prod url> TENANCY_MODE= npx ts-node --transpile-only scripts/_bg-preview-dump.ts --out=<dir>
 */
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { TradeConfigService } from '../src/shipments/trade-config.service';
import { TradeDueService } from '../src/shipments/trade-due.service';
import { ClientsService } from '../src/shipments/clients.service';
import { TradeGeneratedService } from '../src/shipments/trade-generated.service';
import { renderSiV2Html, SiHeaderV2, SiRowV2 } from '../src/shipments/trade-logistics-docs';
import { siPrintRows, siXlsx } from '../src/shipments/trade-si';
import { CustomerDueRule, describeRule } from '../src/shipments/trade-due';

const ADH = '056ed6da-42d3-438e-895b-84bb4df47a4c';
const out = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1];
const RULES: Record<string, Record<string, CustomerDueRule>> = {
  SUS: { INVOICE_1: { anchor: 'SHIP_MONTH_DAY', days: 0, day: 9 } },
  KATO: { INVOICE_2: { anchor: 'SHIPPING_DOCS_DONE', days: 2, daysText: '1–2' } },
};

async function main() {
  if (!process.env.DBURL || !out) throw new Error('DBURL and --out= are required');
  mkdirSync(out, { recursive: true });
  const real = new PrismaClient({ datasources: { db: { url: process.env.DBURL } } });
  // Read-only guard: any write method throws.
  const p: any = new Proxy(real, {
    get(t: any, model: string) {
      const m = t[model];
      if (!m || typeof m !== 'object') return typeof m === 'function' ? m.bind(t) : m;
      return new Proxy(m, { get: (mm: any, fn: string) => (/^(create|update|upsert|delete)/.test(fn) || fn === 'executeRaw' ? () => { throw new Error(`read-only: ${model}.${fn}`); } : typeof mm[fn] === 'function' ? mm[fn].bind(mm) : mm[fn]) });
    },
  });
  try {
    const ts = await real.tradeSetting.findUnique({ where: { organizationId: ADH }, select: { customerProfiles: true } });
    const profiles = { ...((ts?.customerProfiles ?? {}) as Record<string, any>) };
    const idOf = (key: string) => Object.entries(profiles).find(([, v]) => String(v?.key ?? '').toUpperCase() === key)![0];
    const sus = idOf('SUS');
    const kato = idOf('KATO');
    // In memory only: the profiles with the rules, as they will be after the apply.
    const withRules = { ...profiles, [sus]: { ...profiles[sus], dueRules: RULES.SUS }, [kato]: { ...profiles[kato], dueRules: RULES.KATO } };
    const pr: any = new Proxy(p, { get: (t: any, model: string) => (model === 'tradeSetting' ? { findUnique: async (a: any) => ({ ...(await real.tradeSetting.findUnique(a)), customerProfiles: withRules }) } : t[model]) });
    const config = new TradeConfigService(pr);
    const due = new TradeDueService(pr);
    const clients = new ClientsService(pr, config, { getSignedUrl: async () => '' } as any, {} as any, due);
    const detail: Record<string, unknown> = {};
    const duePreview: Record<string, unknown> = {};
    for (const [key, id] of [['SUS', sus], ['KATO', kato]] as const) {
      detail[id] = await clients.customer(ADH, id);
      // The dialog's preview: what the rule changes against the stored (default) rules.
      duePreview[id] = { ...(await new TradeDueService(p).customerRuleChanges(ADH, id, RULES[key])), dueRules: RULES[key], words: Object.fromEntries(Object.entries(RULES[key]).map(([c, r]) => [c, { en: describeRule(r, 'en'), ja: describeRule(r, 'ja') }])) };
    }
    // Link checklist: open orders + open shipments (with CI no. / amount).
    const orders = await real.tradeOrder.findMany({ where: { organizationId: ADH, status: 'OPEN', isTest: false }, orderBy: { orderNo: 'asc' }, select: { id: true, year: true, orderNo: true, customer: { select: { name: true } }, grade: true, size: true, qtyMt: true, _count: { select: { shipments: true } } } });
    const ordersAll = { items: orders.map((o) => ({ id: o.id, year: o.year, orderNo: o.orderNo, label: `#${o.orderNo}`, customerName: o.customer?.name ?? null, productLabel: [o.grade, o.size, o.qtyMt ? `${o.qtyMt} MT` : null].filter(Boolean).join(' · '), shipmentCount: o._count.shipments, status: 'OPEN' })), total: orders.length, page: 1, pageSize: 100, totalPages: 1 };
    const ships = await real.shipment.findMany({ where: { organizationId: ADH, status: 'OPEN', order: { isTest: false } }, select: { id: true, seqNo: true, orderId: true, blNumber: true, ciNumber: true, ciAmount: true, currency: true, status: true, order: { select: { orderNo: true, grade: true, size: true } }, customer: { select: { name: true } } } });
    const shipsAll = { items: ships.map((s) => ({ id: s.id, orderId: s.orderId, seqNo: s.seqNo, ref: s.order ? `#${s.order.orderNo}-${s.seqNo}` : '', order: s.order ? { orderNo: s.order.orderNo } : null, blNumber: s.blNumber, ciNumber: s.ciNumber, ciAmount: s.ciAmount ? Number(s.ciAmount) : null, currency: s.currency, status: s.status, customerName: s.customer?.name ?? null, productLine: [s.order?.grade, s.order?.size].filter(Boolean).join(' · ') })), total: ships.length, page: 1, pageSize: 100, totalPages: 1 };
    const s181 = ships.find((s) => s.order?.orderNo === 18 && s.seqNo === 1)!;
    const docTypes = await real.tradeDocType.findMany({ where: { organizationId: ADH }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }], select: { id: true, code: true, label: true, category: true, sortOrder: true, isActive: true } });
    // The SI: #18-1's, shown as a new draft (one empty row) — the screenshot pastes her schedule into it.
    const g: any = await real.tradeGeneratedDoc.findFirst({ where: { organizationId: ADH, shipmentId: s181.id, docType: 'SHIPPING_INSTRUCTIONS' }, orderBy: { createdAt: 'desc' } });
    const gen = Object.create(TradeGeneratedService.prototype);
    Object.assign(gen, { prisma: p, config: new TradeConfigService(p), get: async () => g });
    const siContext = await gen.siContext(ADH, g.id);
    const blank = { shipDate: '', deliveryDate: '', destination: (g.rows as any[])[0]?.destination ?? '', billet: (g.rows as any[])[0]?.billet ?? '', bundles: null };
    const view = { ...g, status: 'DRAFT', finalFileId: null, header: { ...g.header, editedBy: null, editedAt: null }, rows: [blank], shipment: { id: s181.id, blNumber: s181.blNumber, status: s181.status, orderId: s181.orderId, seqNo: 1, order: { orderNo: 18 } }, order: { orderNo: 18 }, contract: null, covers: [] };
    // The rows her paste builds (the screenshot's result) → the PDF preview the editor shows after "Add rows".
    const built: SiRowV2[] = JSON.parse(process.env.BG_PASTED_ROWS ?? '[]');
    const html = renderSiV2Html(g.header as SiHeaderV2, siPrintRows(built.length ? built : (g.rows as SiRowV2[])), { draft: true });
    writeFileSync(join(out, 'si-preview-html.json'), JSON.stringify({ [g.id]: html }));
    writeFileSync(join(out, 'si-result.html'), html);
    if (built.length) writeFileSync(join(out, 'SI-18-1-pasted.xlsx'), await siXlsx({ ...(g.header as any), weightMode: g.header?.weightMode ?? 'NET_GROSS' }, siPrintRows(built) as any));
    const settings = await new TradeConfigService(p).getSettings(ADH);
    const fixture = {
      detail,
      duePreview,
      ordersAll,
      shipsAll,
      docTypes,
      link: { id: s181.id, label: '#18-1', docType: 'CI_PAYMENT_PROOF' },
      generated: { [g.id]: view },
      siContext: { [g.id]: siContext },
      settings: { customerProfiles: Object.fromEntries(Object.entries(settings.customerProfiles).map(([k, v]: any) => [k, { label: v.label, key: v.key, deliveryProfile: v.deliveryProfile ?? null }])), docDefaults: { deliveryProfiles: [] } },
    };
    writeFileSync(join(out, 'bg-fixture.json'), JSON.stringify(fixture));
    console.log(JSON.stringify({ sus, kato, si: g.id, siStored: g.status, lots: siContext.lots.map((l: any) => [l.lot, l.bundles, l.billet, l.shipments.map((s: any) => s.ref).join(',')]), destination: siContext.destination, holidays: siContext.holidays.filter((h: any) => h.date.startsWith('2026-11')), orders: orders.length, ships: ships.length, s181: s181.id, dueSUS: (duePreview[sus] as any).changes.length }));
  } finally {
    await real.$disconnect();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
