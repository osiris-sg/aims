/**
 * Round AO — owner's go (2026-10-26), ADH only. DRY RUN unless --apply. Prod: TENANCY_MODE= and DATABASE_URL=<prod> inline.
 *   --part=ci21      #21-1 CI no. XP2652102552 → XP2652102456 (the owner's go) + the CI fields held back for it; then a
 *                    read-only check that no other shipment holds a CI no. of another B/L.
 *   --part=permit    IM3Z640309 (import permit of B/L 198GX01385) was filed on #1-1 by the round AN run — move the link to #2-1.
 *   --part=split     #2 and #8: one shipment per B/L. #n-1 keeps the first B/L, #n-2 is created for the second; the
 *                    second B/L's documents move to #n-2; order totals unchanged; both completed.
 *   --part=inalum    #9-1 (B/L MEDURQ949170), completed; #9 itself unchanged (Inalum trial, status unconfirmed).
 *   --part=history   #30–#40: the 11 past deals, completed orders + one shipment per B/L, every step done "Backfilled from Drive".
 *   --part=etd       ETD ← the B/L's shipped-on-board date (empty only).
 *   --part=pilines   PI amount ← the order's own PI line (qty × rate printed on the PI, shared PIs; empty only).
 *   --part=hide11    #11-1: hide the 8 dummy.pdf placeholders and the provisional CI (never deleted).
 *   --part=hoei      Hoei's document formats, party blocks, port and bank.
 * Documents for the new records go in afterwards with scripts/_an-drive-backfill.ts (same empty-slot rules).
 * Every write → ActionLog (System creation) + scripts/_ao-prod-go.log.json. Other orgs are hashed before / after.
 */
import 'dotenv/config';
import * as fs from 'fs';
import { createHash } from 'crypto';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../config/configuration';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { PushModule } from '../src/push/push.module';
import { ShipmentsModule } from '../src/shipments/shipments.module';
import { OrdersService } from '../src/shipments/orders.service';
import { ShipmentsService } from '../src/shipments/shipments.service';
import { TradeConfigService } from '../src/shipments/trade-config.service';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
import { DRIVE_BACKFILL_NOTE } from '../src/shipments/trade-open-orders';

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), PushModule, ActionLogModule, ShipmentsModule] })
class M {}
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const ORG = arg('org') ?? '056ed6da-42d3-438e-895b-84bb4df47a4c';
const APPLY = process.argv.includes('--apply');
const PART = arg('part') ?? '';
const ACTOR = { id: 'system:round-ao-go', name: 'System creation (round AO go)' };
const LOG = ORG === '056ed6da-42d3-438e-895b-84bb4df47a4c' ? 'scripts/_ao-prod-go.log.json' : 'scripts/_ao-prod-go.dev.log.json';
const CUST = { SUS: 'a094ff62-47f7-41dc-93da-a17ddf505283', KATO: 'a4ccfa28-9f64-468e-a943-e96ce8f8c3a0', HOEI: '8ebdc67b-224a-4f30-ac5c-929b4f17fd78' };
const h = (v: unknown) => createHash('sha256').update(JSON.stringify(v ?? null)).digest('hex').slice(0, 12);
const d = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null);
const day = (x: Date | string | null | undefined) => (x ? new Date(x).toISOString().slice(0, 10) : null);
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const log: any[] = [];

/** B/L facts read from Vedanta's CI / COO / PL and the carriers' B/Ls (ETD = shipped-on-board date = B/L date). */
type Ship = { bl: string; vessel: string; voyage: string; etd: string; nw: number; gw: number | null; bundles: number | null; pieces: number | null; ci: string | null; ciAmount: number | null; pol: string | null; pod: string; deliveryMonth?: string | null; eta?: string | null; src: string };
type Hist = { no: number; cust: keyof typeof CUST; grade: string; size: string; product: string; qty: number; qtySrc: string; ship: string; dlv: string | null; pi?: { no: string; date: string; amount: number }; po?: string; clientPremium?: { v: number; src: string }; port: string; s: Ship; note: string };

const HIST: Hist[] = [
  { no: 30, cust: 'KATO', grade: '1070', size: '203 MM X 5800 MM', product: 'Aluminium Billet', qty: 2.03, qtySrc: 'shipped (trial, no PI)', ship: '2024-03', dlv: '2024-04', port: 'Nagoya', note: 'Kato 1070 trial (Drive: Document/shipment 202404)',
    s: { bl: 'JJCVZNGMNC401842', vessel: 'INTERASIA MOMENTUM', voyage: 'E043', etd: '2024-03-30', nw: 2.03, gw: 2.04, bundles: 1, pieces: 4, ci: 'XP2332100419', ciAmount: 6252.4, pol: 'VISAKHAPATNAM PORT, INDIA', pod: 'NAGOYA, JAPAN', src: 'CI XP2332100419 (final)' } },
  { no: 31, cust: 'HOEI', grade: 'P1020', size: 'ingot', product: 'Aluminium Ingot', qty: 25, qtySrc: 'PI 9331002708', ship: '2024-06', dlv: '2024-07', port: 'Laem Chabang', pi: { no: '9331002708', date: '2024-05-31', amount: 68258.75 }, po: 'PO2405044', clientPremium: { v: 85, src: '請求書_Thailand_Vedanta_202407.pdf ("プレミアムベース85")' }, note: 'Hoei P1020 25 t, contract 454002382 (Drive: Thailand/P1020 25トン202405見積, Houeiへ送付資料)',
    s: { bl: 'SITGVZLC000319', vessel: 'ZHONG GU BEI JING', voyage: '24005E', etd: '2024-07-01', nw: 24.458, gw: 24.458, bundles: 25, pieces: null, ci: 'XP2452100908', ciAmount: 65200.14, pol: null, pod: 'LAEM CHABANG, THAILAND', src: 'CI XP2452100908 (final)' } },
  { no: 32, cust: 'HOEI', grade: 'P1020', size: 'ingot', product: 'Aluminium Ingot', qty: 50, qtySrc: 'contract 454002801 (50 MT)', ship: '2025-04', dlv: null, port: 'Laem Chabang', po: 'PO2503036', note: 'Hoei P1020 50 t trial order, contract 454002801 (Drive: Thailand/202505 P1020 50ton)',
    s: { bl: '252366442', vessel: 'MARINA VOYAGER', voyage: '516E', etd: '2025-04-20', nw: 49.971, gw: 49.971, bundles: 50, pieces: null, ci: 'XP2552100058', ciAmount: 128088.17, pol: null, pod: 'LAEM CHABANG, THAILAND', src: 'CI XP2552100058 (final copy "Asia Deal49.971.pdf")' } },
  { no: 33, cust: 'KATO', grade: '6061', size: '203 MM X 5800 MM', product: 'Aluminium Billet', qty: 5, qtySrc: 'PI 9331003291', ship: '2025-05', dlv: '2025-06', port: 'Nagoya', pi: { no: '9331003291', date: '2025-05-02', amount: 14307.5 }, clientPremium: { v: 350, src: '請求書正式ビレット_加藤軽金属_202506r.pdf ("350(Billet Premium)")' }, note: 'Kato 6061 5 t trial, contract 454002846 (Drive: Document/202503見積_202505Ship_202506納入). Only the provisional (暫定) CI is in the Drive: CI amount left blank.',
    s: { bl: '198FX01656', vessel: 'WAN HAI 361', voyage: 'E023', etd: '2025-05-16', nw: 5.106, gw: 5.126, bundles: 2, pieces: null, ci: 'XP2552100395', ciAmount: null, pol: null, pod: 'NAGOYA, JAPAN', src: 'CI XP2552100395 (provisional) / COO' } },
  { no: 34, cust: 'HOEI', grade: 'P1020', size: 'ingot', product: 'Aluminium Ingot', qty: 75, qtySrc: 'contract 454002897 / folder "75トン"', ship: '2025-06', dlv: null, port: 'Laem Chabang', po: 'PO2505052', note: 'Hoei P1020 75 t, contract 454002897 (Drive: Thailand/202505 P1020 75トン)',
    s: { bl: 'VKTCB25000562', vessel: 'BHUDTHI BHUM', voyage: '027E', etd: '2025-06-24', nw: 72.945, gw: null, bundles: 75, pieces: null, ci: 'XP2552100819', ciAmount: 196840.62, pol: null, pod: 'LAEM CHABANG, THAILAND', src: 'CI XP2552100819 (final copy "Asia Deal 72.945.pdf")' } },
  { no: 35, cust: 'KATO', grade: '1070', size: '203 MM X 5800 MM', product: 'Aluminium Billet', qty: 20, qtySrc: 'PI 9221033941', ship: '2025-08', dlv: '2025-09', port: 'Nagoya', pi: { no: '9221033941', date: '2025-08-05', amount: 56200 }, clientPremium: { v: 190, src: '請求書正式ビレット_加藤軽金属_202509_1.pdf ("190(Billet Premium)")' }, note: 'Kato 1070 20 t, contract 434000702 (Drive: Document/202507見積1070_20ton)',
    s: { bl: 'SITGHANG000989', vessel: 'SITC SHUNDE', voyage: 'V.2515N', etd: '2025-08-31', nw: 20.264, gw: 20.344, bundles: 8, pieces: null, ci: 'XP2532100057', ciAmount: 57935.38, pol: null, pod: 'NAGOYA, JAPAN', src: 'CI XP2532100057 (final)' } },
  { no: 36, cust: 'HOEI', grade: 'P1020', size: 'ingot', product: 'Aluminium Ingot', qty: 100, qtySrc: 'contract 454003024 (100 MT)', ship: '2025-08', dlv: '2025-09', port: 'Laem Chabang', note: 'Hoei P1020 100 t, contract 454003024 (Drive: Thailand/202508 P1020_100MT_9月納入)',
    s: { bl: '258823206', vessel: 'MARINA VOYAGER', voyage: '536E', etd: '2025-09-08', nw: 98.613, gw: 98.613, bundles: 100, pieces: null, ci: 'XP2552101868', ciAmount: 266507.55, pol: null, pod: 'LAEM CHABANG, THAILAND', src: 'CI XP2552101868 (final)' } },
  { no: 37, cust: 'KATO', grade: '6005', size: '203 MM X 5800 MM', product: 'Aluminium Billet', qty: 44, qtySrc: 'PI 9331003752', ship: '2025-12', dlv: '2026-02', port: 'Nagoya', pi: { no: '9331003752', date: '2025-12-05', amount: 137043.72 }, clientPremium: { v: 195, src: '請求書正式ビレット_加藤軽金属_202601 - Rev.pdf ("195(Billet Premium)")' }, note: 'Kato 6005 44 t, contract 454003190 (Drive: Document/202512Ship6005 44ton)',
    s: { bl: 'SITGHANG001633', vessel: 'SITC PORT KLANG', voyage: 'V.2515N', etd: '2026-01-07', nw: 40.854, gw: 41.014, bundles: 16, pieces: null, ci: 'XP2552103352', ciAmount: 128013.97, pol: null, pod: 'NAGOYA, JAPAN', src: 'CI XP2552103352 (final)' } },
  { no: 38, cust: 'SUS', grade: '6005', size: '203 MM X 5800 MM', product: 'Aluminium Billet', qty: 61.295, qtySrc: 'shipped (no PI in the Drive)', ship: '2026-01', dlv: '2026-03', port: 'Yokohama', note: 'SUS 6005 Jan 2026 shipment, March delivery (Drive: Docs/Docs 202603(Jan Shipment))',
    s: { bl: '198GX00409', vessel: 'EVER BRAVE', voyage: '096E', etd: '2026-02-06', nw: 61.295, gw: 61.535, bundles: 24, pieces: null, ci: 'XP2552103786', ciAmount: 214863.49, pol: null, pod: 'YOKOHAMA, JAPAN', src: 'CI XP2552103786 (final)' } },
  { no: 39, cust: 'KATO', grade: '6063 HSB', size: '152 MM X 5800 MM', product: 'Aluminium Billet', qty: 22, qtySrc: 'PI 9331003961', ship: '2026-04', dlv: '2026-06', port: 'Nagoya', pi: { no: '9331003961', date: '2026-04-15', amount: 90891.68 }, clientPremium: { v: 230, src: '請求書正式ビレット_加藤軽金属様6063‗22t_202605.pdf ("Billet Premium 230")' }, note: 'Kato 6063 6" 22 t, contract 454003446 (Drive: Document/202604Shipment22t)',
    s: { bl: '270182906', vessel: 'ZEBRA', voyage: '619E', etd: '2026-05-10', nw: 20.536, gw: 20.656, bundles: 12, pieces: null, ci: 'XP2652100381', ciAmount: 85576.18, pol: null, pod: 'NAGOYA, JAPAN', src: 'CI XP2652100381 (final)' } },
  { no: 40, cust: 'HOEI', grade: 'P0507', size: 'ingot', product: 'Aluminium Ingot', qty: 100, qtySrc: 'PI 9331004092', ship: '2026-06', dlv: '2026-07', port: 'Laem Chabang', pi: { no: '9331004092', date: '2026-06-12', amount: 404400 }, po: 'PO2606036', clientPremium: { v: 60, src: '請求書_豊栄メタルThailand様_P1020_99.354T_202606-07修正版.pdf ("+ 60 プレミアムベース", paid 17 Jul)' }, note: 'Hoei 100 t (P0507 97.360 t + P1020), contract 454003575 (Drive: Thailand/202606P1020 100)',
    s: { bl: 'KMTCVTG0066779', vessel: 'XIN TAIN JIN', voyage: '108E', etd: '2026-07-12', nw: 99.354, gw: 99.354, bundles: 100, pieces: null, ci: 'XP2652101288', ciAmount: 361354.47, pol: null, pod: 'LAEM CHABANG, THAILAND', src: 'CI XP2652101288 (final)' } },
];

const SPLIT: Record<number, { first: Ship; second: Ship; secondPath: RegExp }> = {
  2: {
    first: { bl: '198GX01385', vessel: 'ZHONG GU XIONG AN', voyage: '004E', etd: '2026-03-24', nw: 40.93, gw: 41.09, bundles: 16, pieces: 80, ci: 'XP2552104480', ciAmount: null, pol: 'VISAKHAPATNAM PORT, INDIA', pod: 'YOKOHAMA, JAPAN', src: 'COO / PL 9000523941 (XP2552104480; no CI in the Drive)' },
    second: { bl: 'KMTCVTG0067502', vessel: 'ZHONG GU GUI YANG', voyage: '0FDH6E', etd: '2026-04-25', nw: 20.444, gw: 20.524, bundles: 8, pieces: 40, ci: 'XP2652100127', ciAmount: null, pol: 'VISAKHAPATNAM PORT, INDIA', pod: 'YOKOHAMA, JAPAN', deliveryMonth: '2026-06', src: 'COO / PL 9000537651 (XP2652100127; no CI in the Drive); delivered with June (folder 船２_6月とまとめて)' },
    secondPath: /船２|KMTCVTG0067502|VTG0067502/,
  },
  8: {
    first: { bl: '198GX04346', vessel: 'WAN HAI 328', voyage: 'E064', etd: '2026-07-15', nw: 262.45, gw: 263.48, bundles: 103, pieces: null, ci: 'XP2652101260', ciAmount: 1053773.49, pol: 'VISAKHAPATNAM PORT, INDIA', pod: 'YOKOHAMA, JAPAN', src: 'CI XP2652101260 (final)' },
    second: { bl: '198GX04631', vessel: 'RACHA BHUM', voyage: '211E', etd: '2026-07-22', nw: 40.775, gw: 40.935, bundles: 16, pieces: null, ci: 'XP2652101328', ciAmount: 163717.33, pol: 'VISAKHAPATNAM PORT, INDIA', pod: 'YOKOHAMA, JAPAN', src: 'CI XP2652101328 (final)' },
    secondPath: /後着40t|198GX04631/,
  },
};
const ETD: Record<string, { etd: string; src: string }> = {
  '#1-1': { etd: '2026-03-05', src: 'CI XP2552104249 BL Date' }, '#3-1': { etd: '2026-04-25', src: 'B/L KMTCVTG0060509 Shipped On Board Apr.25,2026' }, '#4-1': { etd: '2026-05-08', src: 'COO XP2652100377 (B/L KMTCVTG0069547) date' },
  '#5-1': { etd: '2026-05-29', src: 'CI XP2652100546 BL Date' }, '#6-1': { etd: '2026-06-13', src: 'CI XP2652100827 BL Date' }, '#7-1': { etd: '2026-07-07', src: 'CI XP2652101117 BL Date' },
  '#17-1': { etd: '2026-08-24', src: 'CI XP2652101870 BL Date' }, '#18-2': { etd: '2026-10-06', src: 'CI XP2652102549 BL Date' }, '#18-3': { etd: '2026-10-06', src: 'CI XP2652102548 BL Date' },
  '#19-1': { etd: '2026-10-06', src: 'CI XP2652102551 BL Date' }, '#19-2': { etd: '2026-10-06', src: 'CI XP2652102550 BL Date' },
};
/** Shared PIs: each order's own line, qty × rate exactly as printed (9331004266 of 01/09, 9331004320 of 22/09). */
const PI_LINES: Array<{ refs: string[]; pi: string; qty: number; rate: number; amount: number }> = [
  { refs: ['S10', '#20'], pi: '9331004266', qty: 40, rate: 3916.8, amount: 156672.0 },
  { refs: ['S11', '#21'], pi: '9331004266', qty: 32, rate: 3918.8, amount: 125401.6 },
  { refs: ['S12', '#22'], pi: '9331004266', qty: 40, rate: 3891.8, amount: 155672.0 },
  { refs: ['S15', '#25'], pi: '9331004320', qty: 40, rate: 3955.04, amount: 158201.6 },
  { refs: ['S16', '#26'], pi: '9331004320', qty: 40, rate: 3930.04, amount: 157201.6 },
];

(async () => {
  const app = await NestFactory.createApplicationContext(M, { logger: ['error'] });
  const prisma: any = app.get(PrismaService);
  const orders = app.get(OrdersService);
  const shipments = app.get(ShipmentsService);
  const config = app.get(TradeConfigService);
  const audit = async (db: any, action: string, resource: string, resourceId: string, details: any) => {
    await db.actionLog.create({ data: { actorType: 'SYSTEM', actorId: ACTOR.id, actorName: 'System creation', organizationId: ORG, channel: 'operator', action, resource, resourceId, details } });
    log.push({ at: new Date().toISOString(), action, resource, resourceId, details });
  };
  const snap = async () => {
    const m = new Map<string, string>();
    const add = (k: string, v: unknown) => m.set(k, h([m.get(k), v]));
    for (const o of await prisma.tradeOrder.findMany({ orderBy: { id: 'asc' } })) add(`o:${o.organizationId}`, o);
    for (const s of await prisma.supplierOrder.findMany({ orderBy: { id: 'asc' } })) add(`so:${s.organizationId}`, s);
    for (const s of await prisma.shipment.findMany({ orderBy: { id: 'asc' } })) add(`s:${s.organizationId}`, s);
    for (const l of await prisma.tradeFileLink.findMany({ select: { organizationId: true, id: true, stepId: true, shipmentId: true, hiddenAt: true }, orderBy: { id: 'asc' } })) add(`l:${l.organizationId}`, l);
    for (const t of await prisma.tradeSetting.findMany({ select: { organizationId: true, customerProfiles: true } })) add(`ts:${t.organizationId}`, t);
    return m;
  };
  const shipSel = { id: true, seqNo: true, status: true, blNumber: true, vessel: true, voyageNo: true, etd: true, eta: true, netWeightMt: true, grossWeightMt: true, totalBundles: true, totalPieces: true, ciNumber: true, ciAmount: true, portOfLoading: true, portOfDischarge: true, deliveryMonth: true, notes: true, orderId: true, order: { select: { orderNo: true } } };
  const shipRef = async (ref: string) => {
    const [, o, s] = ref.match(/^#(\d+)-(\d+)$/)!;
    return prisma.shipment.findFirst({ where: { organizationId: ORG, seqNo: Number(s), order: { orderNo: Number(o), year: 2026, isTest: false } }, select: shipSel });
  };
  const orderRef = (no: number) => prisma.tradeOrder.findFirst({ where: { organizationId: ORG, year: 2026, orderNo: no, isTest: false }, select: { id: true, orderNo: true, status: true, qtyMt: true, customerId: true, supplierId: true, piAmount: true, piNo: true, checkFields: true, notes: true, supplierOrderId: true } });
  const fillEmpty = async (db: any, model: 'shipment' | 'tradeOrder' | 'supplierOrder', rec: any, ref: string, data: Record<string, unknown>, src: string, allowOverwrite: string[] = []) => {
    const out: string[] = [];
    for (const [k, v] of Object.entries(data)) {
      if (v === null || v === undefined) continue;
      const cur = rec[k];
      const curS = cur instanceof Date ? day(cur) : cur === null || cur === undefined ? null : String(Number.isFinite(Number(cur)) && typeof v === 'number' ? Number(cur) : cur);
      const newS = v instanceof Date ? day(v) : String(v);
      if (curS === newS) continue;
      if (curS !== null && !allowOverwrite.includes(k)) { out.push(`${k} kept ${curS} (doc ${newS})`); continue; }
      out.push(`${k} ${curS ?? '∅'} → ${newS}`);
      if (APPLY) {
        const r = await db[model].updateMany({ where: { id: rec.id, organizationId: ORG, ...(curS === null ? { [k]: null } : {}) }, data: { [k]: v } });
        if (r.count) await audit(db, 'UPDATE', model === 'shipment' ? 'shipment' : model === 'tradeOrder' ? 'trade-order' : 'supplier-order', rec.id, { ref, field: k, from: curS, to: newS, source: src });
      }
    }
    console.log(`  ${ref.padEnd(6)} ${out.join(' · ') || 'nothing to change'}`);
  };
  const shipData = (s: Ship) => ({ blNumber: s.bl, vessel: s.vessel, voyageNo: s.voyage, etd: d(s.etd), netWeightMt: s.nw, grossWeightMt: s.gw, totalBundles: s.bundles, totalPieces: s.pieces, ciNumber: s.ci, ciAmount: s.ciAmount, portOfLoading: s.pol, portOfDischarge: s.pod, ...(s.deliveryMonth ? { deliveryMonth: s.deliveryMonth } : {}), ...(s.eta ? { eta: d(s.eta) } : {}) });
  /** Every open step of a new record → DONE with the backfill note; the record completed. */
  const closeSteps = async (tx: any, owner: { orderId?: string; shipmentId?: string }, note: string) => {
    const steps = await tx.tradeStep.findMany({ where: { organizationId: ORG, ...owner }, select: { id: true, status: true, notApplicable: true, isOngoing: true } });
    let k = 0;
    for (const s of steps) {
      if (s.notApplicable || s.isOngoing || s.status === 'DONE') continue;
      await tx.tradeStep.update({ where: { id: s.id }, data: { status: 'DONE', completedAt: new Date(), holdOpen: false, skipReason: note, updatedById: ACTOR.id, updatedByName: ACTOR.name } });
      k++;
    }
    return k;
  };

  await runAsOrg(ORG, async () => {
    const before = await snap();

    if (PART === 'ci21') {
      const s = await shipRef('#21-1');
      console.log(`#21-1 B/L ${s.blNumber} CI ${s.ciNumber} → XP2652102456 (CI 9000586235 for B/L 198GX06445, 28.963 t; XP2652102552 is the CI of 198GX06520 = #22-1)`);
      if (s.ciNumber === 'XP2652102552') {
        if (APPLY) {
          const r = await prisma.shipment.updateMany({ where: { id: s.id, organizationId: ORG, ciNumber: 'XP2652102552' }, data: { ciNumber: 'XP2652102456' } });
          if (r.count) await audit(prisma, 'UPDATE', 'shipment', s.id, { ref: '#21-1', field: 'ciNumber', from: 'XP2652102552', to: 'XP2652102456', source: 'Drive: Document/202609 Shipment …/6063 6 inch HSB_198GX06445_28.963_MT_Nagoya_454003598/COMMERCIAL_INVOICE_9000586235.pdf (Invoice No. XP2652102456, BL No. 198GX06445)', go: 'owner, round AO item 2' });
        }
        s.ciNumber = APPLY ? 'XP2652102456' : null;
      }
      await fillEmpty(prisma, 'shipment', s, '#21-1', { ciNumber: 'XP2652102456', ciAmount: 113935.23, totalBundles: 17, totalPieces: 102, portOfLoading: 'VISAKHAPATNAM PORT, INDIA' }, 'CI XP2652102456 (final)');
    }

    if (PART === 'ci-audit') {
      const plan = JSON.parse(fs.readFileSync(arg('plan') ?? 'scripts/_an-drive-plan.json', 'utf8'));
      const xpBl = new Map<string, string>((plan.blm as any[]).filter((b) => b.xp).map((b) => [b.xp, b.bl]));
      const all: any[] = await prisma.shipment.findMany({ where: { organizationId: ORG, ciNumber: { not: null } }, select: { ...shipSel, order: { select: { orderNo: true, isTest: true } } } });
      const byCi = new Map<string, string[]>();
      for (const s of all) (byCi.get(s.ciNumber) ?? byCi.set(s.ciNumber, []).get(s.ciNumber)!).push(`#${s.order?.orderNo}-${s.seqNo}${s.order?.isTest ? ' (test)' : ''}`);
      let bad = 0;
      for (const s of all.sort((a, b) => a.order.orderNo - b.order.orderNo || a.seqNo - b.seqNo)) {
        const bl = xpBl.get(s.ciNumber);
        const norm = (x: string | null) => (x ?? '').replace(/^TEST\d*-/, '').replace(/^(GGVCB\d{8})\d{2}$/, '$1');
        const ok = bl ? norm(s.blNumber) === bl : null;
        const shared = byCi.get(s.ciNumber)!.length > 1;
        if (ok === false || shared) bad++;
        console.log(`  #${s.order.orderNo}-${s.seqNo}${s.order.isTest ? ' test' : ''} B/L ${s.blNumber ?? '∅'} CI ${s.ciNumber} → ${ok === null ? 'CI not in the Drive' : ok ? 'matches its B/L' : `belongs to B/L ${bl}`}${shared ? ` · shared with ${byCi.get(s.ciNumber)!.join(', ')}` : ''}`);
      }
      console.log(`shipments with a CI no.: ${all.length}; mismatched or shared: ${bad}`);
    }

    if (PART === 'permit') {
      const s1 = await shipRef('#1-1');
      const s2 = await shipRef('#2-1');
      const link = await prisma.tradeFileLink.findFirst({ where: { organizationId: ORG, shipmentId: s1.id, file: { fileName: { startsWith: 'IM3Z640309' } } }, select: { id: true, fileId: true, stepId: true } });
      const st2 = await prisma.tradeStep.findFirst({ where: { organizationId: ORG, shipmentId: s2.id, displayNo: '10' }, select: { id: true } });
      console.log(`IM3Z640309 (permit for B/L 198GX01385, "BE 22AA198GX01385"): on #1-1 ${link ? 'yes' : 'no'} → #2-1 step 10`);
      if (link && APPLY) {
        await prisma.tradeFileLink.update({ where: { id: link.id }, data: { shipmentId: s2.id, stepId: st2.id } });
        await audit(prisma, 'UPDATE', 'trade-file-link', link.id, { fileId: link.fileId, fileName: 'IM3Z640309_20260420091448.pdf', from: '#1-1 step 10', to: '#2-1 step 10', reason: 'the permit is for B/L 198GX01385 (#2); round AN filed it by folder on #1-1' });
      }
    }

    if (PART === 'split') {
      for (const no of [2, 8]) {
        const sp = SPLIT[no];
        const o = await orderRef(no);
        const ships: any[] = await prisma.shipment.findMany({ where: { organizationId: ORG, orderId: o.id }, select: shipSel, orderBy: { seqNo: 'asc' } });
        const s1 = ships[0];
        console.log(`\n#${no} (order ${o.qtyMt} t, ${o.status}) BEFORE: ${ships.map((s) => `#${no}-${s.seqNo} ${s.blNumber ?? 'no B/L'} ${n(s.netWeightMt)} t ${s.status}`).join('; ')}`);
        console.log(`  AFTER: #${no}-1 ${sp.first.bl} ${sp.first.nw} t · #${no}-2 ${sp.second.bl} ${sp.second.nw} t (sum ${(sp.first.nw + sp.second.nw).toFixed(3)} t); order qty ${o.qtyMt} t unchanged; both completed`);
        if (ships.length !== 1) { console.log('  already split — skip'); continue; }
        const links: any[] = await prisma.tradeFileLink.findMany({ where: { organizationId: ORG, shipmentId: s1.id }, select: { id: true, stepId: true, step: { select: { displayNo: true } }, file: { select: { id: true, fileName: true, notes: true, docType: true } } } });
        const move = links.filter((l) => sp.secondPath.test(l.file.notes ?? '') || sp.secondPath.test(l.file.fileName));
        console.log(`  documents moving to #${no}-2: ${move.length} — ${move.map((l) => `${l.step?.displayNo}:${l.file.docType}:${l.file.fileName}`).join(', ') || 'none'}`);
        if (!APPLY) continue;
        await prisma.$transaction(async (tx: any) => {
          const id2 = await shipments.createInTx(tx, ORG, { orderId: o.id, portOfDischarge: 'Yokohama', notes: `${DRIVE_BACKFILL_NOTE} (round AO): second B/L of #${no}, split from #${no}-1 (one shipment per B/L).` } as any, ACTOR as any);
          await tx.shipment.update({ where: { id: id2 }, data: { ...shipData(sp.second), deliveryMonth: sp.second.deliveryMonth ?? s1.deliveryMonth, status: 'COMPLETED' } });
          const k = await closeSteps(tx, { shipmentId: id2 }, `${DRIVE_BACKFILL_NOTE} (split from #${no}-1)`);
          await audit(tx, 'CREATE', 'shipment', id2, { ref: `#${no}-2`, orderNo: no, ...shipData(sp.second), deliveryMonth: sp.second.deliveryMonth ?? s1.deliveryMonth, status: 'COMPLETED', stepsDone: k, source: sp.second.src, go: 'owner, round AO item 3' });
          await tx.shipment.update({ where: { id: s1.id }, data: { netWeightMt: sp.first.nw } });
          await audit(tx, 'UPDATE', 'shipment', s1.id, { ref: `#${no}-1`, field: 'netWeightMt', from: n(s1.netWeightMt), to: sp.first.nw, reason: `split: #${no}-1 keeps ${sp.first.bl}, ${sp.second.bl} moved to #${no}-2`, go: 'owner, round AO item 3' });
          const steps2: any[] = await tx.tradeStep.findMany({ where: { organizationId: ORG, shipmentId: id2 }, select: { id: true, displayNo: true } });
          for (const l of move) {
            const st = steps2.find((s) => s.displayNo === l.step?.displayNo);
            await tx.tradeFileLink.update({ where: { id: l.id }, data: { shipmentId: id2, stepId: st?.id ?? null } });
            await audit(tx, 'UPDATE', 'trade-file-link', l.id, { fileId: l.file.id, fileName: l.file.fileName, from: `#${no}-1 step ${l.step?.displayNo}`, to: `#${no}-2 step ${l.step?.displayNo}` });
          }
        }, { timeout: 60_000 });
        const fresh = await prisma.shipment.findFirst({ where: { id: s1.id }, select: shipSel });
        await fillEmpty(prisma, 'shipment', fresh, `#${no}-1`, shipData(sp.first), sp.first.src);
      }
    }

    if (PART === 'inalum') {
      const o = await orderRef(9);
      const has = await prisma.shipment.count({ where: { organizationId: ORG, orderId: o.id } });
      const s: Ship = { bl: 'MEDURQ949170', vessel: 'MSC ANIELLO', voyage: 'HI631A', etd: '', nw: 20.296, gw: 20.464, bundles: 8, pieces: null, ci: null, ciAmount: null, pol: null, pod: 'YOKOHAMA, JAPAN', eta: '2026-07-30', deliveryMonth: '2026-08', src: 'MSC arrival notice MEDURQ949170 (ETA 7/30/2026, NW 20,296 kg, GW 20,464 kg, 8 bundles)' };
      console.log(`#9 (${o.status}, check ${JSON.stringify(o.checkFields)}): shipments ${has} → create #9-1 B/L ${s.bl}, ${s.vessel} ${s.voyage}, ETA ${s.eta}, ${s.nw} t, completed; #9 itself unchanged`);
      if (!has && APPLY) {
        await prisma.$transaction(async (tx: any) => {
          const id = await shipments.createInTx(tx, ORG, { orderId: o.id, portOfDischarge: 'Yokohama', notes: `${DRIVE_BACKFILL_NOTE} (round AO): Inalum (MIND ID) trial 20 t, PT Inalum COA/PL AO50001693.` } as any, ACTOR as any);
          const data = { ...shipData(s), etd: null, status: 'COMPLETED' };
          await tx.shipment.update({ where: { id }, data });
          const k = await closeSteps(tx, { shipmentId: id }, `${DRIVE_BACKFILL_NOTE} (Inalum trial)`);
          await audit(tx, 'CREATE', 'shipment', id, { ref: '#9-1', ...data, stepsDone: k, source: s.src, go: 'owner, round AO item 4' });
        }, { timeout: 60_000 });
      }
    }

    if (PART === 'history') {
      const used = await prisma.tradeOrder.findMany({ where: { organizationId: ORG, year: 2026, orderNo: { gte: 30, lte: 40 } }, select: { orderNo: true } });
      const vedanta = await prisma.supplier.findFirst({ where: { organizationId: ORG, name: { contains: 'Vedanta', mode: 'insensitive' } }, select: { id: true, name: true } });
      const bls = await prisma.shipment.findMany({ where: { organizationId: ORG, blNumber: { in: HIST.map((x) => x.s.bl) } }, select: { blNumber: true } });
      console.log(`supplier ${vedanta?.name}; order numbers 30–40 already used: ${used.map((u: any) => u.orderNo).join(', ') || 'none'}; B/Ls already in AIMS: ${bls.map((b: any) => b.blNumber).join(', ') || 'none'}`);
      if (HIST.length > 11) throw new Error('more than 11 history deals — stop');
      for (const x of HIST) console.log(`  #${x.no} ${x.cust.padEnd(4)} ${(x.grade + ' ' + x.size).padEnd(24)} ${String(x.qty).padStart(7)} t (${x.qtySrc}) ship ${x.ship} dlv ${x.dlv ?? '—'} · B/L ${x.s.bl} ${x.s.vessel} ${x.s.voyage} ETD ${x.s.etd} · ${x.s.nw} t · CI ${x.s.ci ?? '—'} ${x.s.ciAmount ?? ''}${x.pi ? ` · PI ${x.pi.no} ${x.pi.date} ${x.pi.amount}` : ''}${x.po ? ` · PO ${x.po}` : ''}${x.clientPremium ? ` · client premium ${x.clientPremium.v}` : ''}`);
      if (APPLY && (used.length || bls.length)) throw new Error('numbers or B/Ls already in use — stop');
      if (APPLY) {
        for (const x of HIST) {
          await prisma.$transaction(async (tx: any) => {
            const note = `${DRIVE_BACKFILL_NOTE} (round AO, owner's go): ${x.note}. Quantity: ${x.qtySrc}.${x.clientPremium ? ` Client premium ${x.clientPremium.v} from ${x.clientPremium.src}.` : ''}`;
            const id = await orders.createInTx(tx, ORG, { year: 2026, orderNo: x.no, customerId: CUST[x.cust], supplierId: vedanta.id, shipMonth: x.ship, deliveryMonth: x.dlv ?? undefined, product: x.product, grade: x.grade, size: x.size, qtyMt: x.qty, clientPremium: x.clientPremium?.v, incoterm: 'CIF', destinationPort: x.port, notes: note, ...(x.po ? { customerPoNo: x.po } : {}) } as any, ACTOR as any);
            if (x.pi) await tx.tradeOrder.update({ where: { id }, data: { piNo: x.pi.no, piDate: d(x.pi.date), piAmount: x.pi.amount } });
            const ko = await closeSteps(tx, { orderId: id }, DRIVE_BACKFILL_NOTE);
            const sid = await shipments.createInTx(tx, ORG, { orderId: id, portOfDischarge: x.port, notes: `${DRIVE_BACKFILL_NOTE} (round AO).` } as any, ACTOR as any);
            await tx.shipment.update({ where: { id: sid }, data: { ...shipData(x.s), status: 'COMPLETED' } });
            const ks = await closeSteps(tx, { shipmentId: sid }, DRIVE_BACKFILL_NOTE);
            await tx.tradeOrder.update({ where: { id }, data: { status: 'COMPLETED' } });
            await audit(tx, 'CREATE', 'trade-order', id, { ref: `#${x.no}`, customer: x.cust, grade: x.grade, size: x.size, qtyMt: x.qty, qtySource: x.qtySrc, shipMonth: x.ship, deliveryMonth: x.dlv, pi: x.pi ?? null, customerPoNo: x.po ?? null, clientPremium: x.clientPremium ?? null, status: 'COMPLETED', stepsDone: ko, go: 'owner, round AO item 5' });
            await audit(tx, 'CREATE', 'shipment', sid, { ref: `#${x.no}-1`, ...shipData(x.s), status: 'COMPLETED', stepsDone: ks, source: x.s.src });
          }, { timeout: 60_000 });
          console.log(`  created #${x.no} + #${x.no}-1`);
        }
      }
    }

    if (PART === 'etd') {
      for (const [ref, v] of Object.entries(ETD)) await fillEmpty(prisma, 'shipment', await shipRef(ref), ref, { etd: d(v.etd) }, v.src);
    }

    if (PART === 'pilines') {
      for (const l of PI_LINES) {
        const check = Math.round(l.qty * l.rate * 100) / 100;
        if (check !== l.amount) { console.log(`  ${l.refs.join('/')} PI ${l.pi}: ${l.qty} × ${l.rate} = ${check} ≠ ${l.amount} — left blank`); continue; }
        for (const ref of l.refs) {
          const rec = ref.startsWith('S')
            ? await prisma.supplierOrder.findFirst({ where: { organizationId: ORG, year: 2026, soNo: Number(ref.slice(1)) }, select: { id: true, piNo: true, piAmount: true } })
            : await orderRef(Number(ref.slice(1)));
          if (rec.piNo !== l.pi) { console.log(`  ${ref} has PI ${rec.piNo} ≠ ${l.pi} — skip`); continue; }
          await fillEmpty(prisma, ref.startsWith('S') ? 'supplierOrder' : 'tradeOrder', rec, ref, { piAmount: l.amount }, `PI ${l.pi} line ${l.qty} t × ${l.rate} = ${l.amount}`);
        }
      }
    }

    if (PART === 'hide11') {
      const s = await shipRef('#11-1');
      const links: any[] = await prisma.tradeFileLink.findMany({ where: { organizationId: ORG, shipmentId: s.id, hiddenAt: null }, select: { id: true, step: { select: { displayNo: true } }, file: { select: { id: true, fileName: true, docType: true, sha256: true } } } });
      const dummies = links.filter((l) => l.file.fileName === 'dummy.pdf');
      const prov = links.filter((l) => l.file.docType === 'CI' && l.file.fileName === 'COMMERCIAL_INVOICE_9000565680.pdf');
      console.log(`#11-1: hide ${dummies.length} dummy.pdf (${dummies.map((l) => `${l.step?.displayNo}:${l.file.docType}`).join(', ')}) + ${prov.length} provisional CI (6月平均, LME 3,197.90) → the final CI goes in with the Drive run`);
      if (APPLY) {
        for (const [l, why] of [...dummies.map((l) => [l, 'placeholder dummy.pdf (owner, round AO item 6)']), ...prov.map((l) => [l, 'provisional CI (6月平均); the final CI 1,148,593.71 replaces it (owner, round AO item 6)'])] as Array<[any, string]>) {
          await prisma.tradeFileLink.update({ where: { id: l.id }, data: { hiddenAt: new Date(), hiddenReason: why } });
          await audit(prisma, 'HIDE', 'trade-file-link', l.id, { ref: '#11-1', step: l.step?.displayNo, docType: l.file.docType, fileName: l.file.fileName, fileId: l.file.id, reason: why });
        }
      }
    }

    if (PART === 'hoei') {
      const ts = await prisma.tradeSetting.findFirst({ where: { organizationId: ORG }, select: { id: true, customerProfiles: true, docDefaults: true } });
      const cp = { ...(ts.customerProfiles as any) };
      const p = { ...(cp[CUST.HOEI] ?? {}) };
      const banks: any[] = ((ts.docDefaults as any)?.bankAccounts ?? (ts.docDefaults as any)?.banks ?? []) as any[];
      const cfsb = banks.find((b) => /Community Federal|CFSB|CMFGUS33/i.test(JSON.stringify(b)));
      const mask = (b: any) => (b ? `${b.id} · ${String(b.label ?? b.name ?? '').slice(0, 40)} · …${String(JSON.stringify(b).match(/\d{6,}/g)?.slice(-1)[0] ?? '').slice(-4)}` : '∅');
      const cur = banks.find((b) => b.id === p.defaultBankId);
      const next = {
        ...p,
        port: 'Laem Chabang',
        defaultBankId: cfsb?.id ?? p.defaultBankId,
        docVariants: { ...(p.docVariants ?? {}), CUSTOMER_COA: 'CUSTOMER_COA_AS_RECEIVED', CUSTOMER_PL: 'CUSTOMER_PL_AS_RECEIVED', SGJP_IV_PL: 'SGJP_IV_PL_HOEI', INVOICE: 'INVOICE_SINGLE_HOEI_USD' },
        partyBlocks: {
          consignee: 'HOEI METAL (THAILAND)CO., LTD.\nHEAD OFFICE 454/16 MOO.9 TAMBOL NONGKI,\nAMPHUR KABINBURI, PRACHINBURI 25110 THAILAND\nTEL +66(0)87-625-400 EXT/207 TAX ID: 0105558091532',
          buyer: 'HOEI METAL (THAILAND)CO., LTD.\nHEAD OFFICE 454/16 MOO.9 TAMBOL NONGKI,\nAMPHUR KABINBURI, PRACHINBURI 25110 THAILAND\nTEL +66(0)87-625-400 EXT/207 TAX ID: 0105558091532',
          notify: 'ISEWAN (THAILAND)CO., LTD.\n159/32 SERM-MITR TOWER, 19TH FL, UNIT 1903/1,\nSUKHUMVIT 21(ASOKE) RD., NORTH-KLONGTOEY, WATTANA,\nBANGKOK 10110 TEL +66(0)2-661-6404-5',
        },
      };
      console.log(`Hoei profile (${CUST.HOEI}):`);
      console.log(`  port: ${p.port ?? '∅'} → ${next.port}`);
      console.log(`  defaultBankId: ${mask(cur)} → ${mask(cfsb)}${cfsb ? '' : '  (no CFSB account in Settings — bank NOT changed)'}`);
      for (const k of ['CUSTOMER_COA', 'CUSTOMER_PL', 'SGJP_IV_PL', 'INVOICE']) console.log(`  docVariants.${k}: ${p.docVariants?.[k] ?? '∅ (default)'} → ${next.docVariants[k]}`);
      console.log(`  partyBlocks: ${p.partyBlocks ? 'set' : '∅'} → consignee / buyer HOEI METAL (THAILAND), notify ISEWAN (THAILAND) (from ADH's IV&PL GGVCB26000252)`);
      console.log(`  bank accounts in Settings: ${banks.map(mask).join(' | ')}`);
      if (APPLY) {
        cp[CUST.HOEI] = next;
        await prisma.tradeSetting.update({ where: { id: ts.id }, data: { customerProfiles: cp } });
        await audit(prisma, 'UPDATE', 'customer-profile', CUST.HOEI, { port: { from: p.port ?? null, to: next.port }, defaultBankId: { from: p.defaultBankId ?? null, to: next.defaultBankId }, docVariants: { from: p.docVariants ?? null, to: next.docVariants }, partyBlocks: 'set (Hoei / ISEWAN)', go: 'owner, round AO item 7' });
      }
    }

    const after = await snap();
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter((k) => before.get(k) !== after.get(k));
    console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN — nothing written'}; changed: ${changed.join(', ') || 'none'}; other orgs changed: ${changed.filter((k) => !k.endsWith(ORG)).length}`);
    if (log.length) {
      const prev = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : [];
      fs.writeFileSync(LOG, JSON.stringify([...prev, ...log], null, 1));
      console.log(`log → ${LOG} (+${log.length})`);
    }
  });
  await app.close();
  process.exit(0);
})().catch((e) => {
  console.error(e?.message ?? e);
  if (log.length) fs.writeFileSync('scripts/_ao-prod-go.partial.json', JSON.stringify(log, null, 1));
  process.exit(1);
});
