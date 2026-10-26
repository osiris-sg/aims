/**
 * Round AM — owner's go (2026-10-26), ADH only. Prod: TENANCY_MODE= and DATABASE_URL=<prod> inline.
 *   --part=1  SUS profile → CUSTOMER_COA_SUS_SUMMARY + CUSTOMER_PL_SUS_XLS, the two ADH samples added (footer stays blank:
 *             no Vedanta logo / "FOR VEDANTA" lines).
 *   --part=2  October PIs, empty fields only: #24 / S14 → 9331004321; #25 / S15 and #26 / S16 → 9331004320.
 *   --part=3  #23 split (dry run unless --apply): S13 → 100 t on 454003255, PI 9331004319, premium 162; new supplier order
 *             100 t on 454003422, PI 9331004321, premium 240 (6005, Oct'26) — before / after with margins.
 * Every org's trade settings / orders / supplier orders are hashed before and after; only ADH may change.
 * Each write → ActionLog (System creation) + scripts/_am-prod-go.log.json.
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
import { ClientsService } from '../src/shipments/clients.service';
import { TradeConfigService } from '../src/shipments/trade-config.service';
import { createSupplierOrderInTx } from '../src/shipments/trade-supplier-order';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), PushModule, ActionLogModule, ShipmentsModule] })
class M {}
const ORG = process.argv.find((a) => a.startsWith('--org='))?.slice(6) ?? '056ed6da-42d3-438e-895b-84bb4df47a4c';
const SUS = 'a094ff62-47f7-41dc-93da-a17ddf505283';
const APPLY = process.argv.includes('--apply');
const PART = Number(process.argv.find((a) => a.startsWith('--part='))?.slice(7));
const JOB = 'round-am-go';
const ACTOR = { id: `system:${JOB}`, name: 'System creation (round AM go)' };
const F = `${process.env.HOME}/Desktop/ADH_Docs/SUS_formats/9月納入 6063材305.804t`;
const SAMPLES = [
  { docType: 'CUSTOMER_COA', path: `${F}/COA_集計ファイル_Sep300t.pdf`, mime: 'application/pdf' },
  { docType: 'CUSTOMER_PL', path: `${F}/PACKING LIST.XLS.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
];
const h = (v: unknown) => createHash('sha256').update(JSON.stringify(v ?? null)).digest('hex').slice(0, 12);
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const log: any[] = [];
const LOG = ORG === '056ed6da-42d3-438e-895b-84bb4df47a4c' ? 'scripts/_am-prod-go.log.json' : 'scripts/_am-prod-go.dev.log.json';
const NOTE23 = 'Client premium to confirm with ADH (sheet says 200 or 265; AIMS has 190). The negative margin after the split (454003422 half at 240) is not final.';

(async () => {
  if (![1, 2, 3].includes(PART)) throw new Error('--part=1|2|3');
  const app = await NestFactory.createApplicationContext(M, { logger: ['error'] });
  const prisma: any = app.get(PrismaService);
  const clients = app.get(ClientsService);
  const config = app.get(TradeConfigService);
  const snap = async () => {
    const m = new Map<string, string>();
    for (const t of await prisma.tradeSetting.findMany({ select: { organizationId: true, customerProfiles: true, docDefaults: true, supplierProfiles: true } })) m.set(`ts:${t.organizationId}`, h([t.customerProfiles, t.docDefaults, t.supplierProfiles]));
    for (const o of await prisma.tradeOrder.findMany({ select: { organizationId: true, id: true, piNo: true, supplierPremium: true, supplierOrderId: true, notes: true }, orderBy: { id: 'asc' } })) m.set(`o:${o.organizationId}`, h([m.get(`o:${o.organizationId}`), o]));
    for (const s of await prisma.supplierOrder.findMany({ select: { organizationId: true, id: true, piNo: true, qtyMt: true, supplierPremium: true, contractId: true, notes: true }, orderBy: { id: 'asc' } })) m.set(`so:${s.organizationId}`, h([m.get(`so:${s.organizationId}`), s]));
    return m;
  };
  const audit = async (action: string, resource: string, resourceId: string, details: any) => {
    await prisma.actionLog.create({ data: { actorType: 'SYSTEM', actorId: ACTOR.id, actorName: 'System creation', organizationId: ORG, channel: 'operator', action, resource, resourceId, details } });
    log.push({ at: new Date().toISOString(), action, resource, resourceId, details });
  };
  // The org context: the tenancy router (per-org mode, dev) routes every query — and the split's transaction — to ADH.
  await runAsOrg(ORG, async () => {
  const before = await snap();
  const order = (no: number) => prisma.tradeOrder.findFirst({ where: { organizationId: ORG, orderNo: no, year: 2026, isTest: false }, select: { id: true, orderNo: true, grade: true, size: true, qtyMt: true, piNo: true, checkFields: true, clientPremium: true, supplierPremium: true, upcharge: true, notes: true, contract: { select: { contractNo: true } }, supplierOrder: { select: { id: true, soNo: true, piNo: true, qtyMt: true, supplierPremium: true, notes: true, contract: { select: { contractNo: true } } } } } });

  if (PART === 1) {
    const p = await config.profileOf(ORG, SUS);
    console.log('SUS now:', JSON.stringify(p.docVariants), '| samples:', JSON.stringify(Object.fromEntries(Object.entries(p.docFormats ?? {}).map(([k, v]: any) => [k, (v.samples ?? []).map((s: any) => s.fileName)]))));
    for (const s of SAMPLES) console.log(`  sample ${s.docType}: ${s.path.split('/').pop()} sha ${createHash('sha256').update(fs.readFileSync(s.path)).digest('hex').slice(0, 16)}`);
    console.log('PLAN: COA → CUSTOMER_COA_SUS_SUMMARY, PL → CUSTOMER_PL_SUS_XLS (were', p.docVariants.CUSTOMER_COA, '/', p.docVariants.CUSTOMER_PL, '); add the 2 samples; COA footer blank (no Vedanta logo / signature lines)');
    if (APPLY) {
      await clients.updateFormat(ORG, SUS, 'CUSTOMER_COA', { generator: 'CUSTOMER_COA_SUS_SUMMARY', notes: 'ADH-made COA_集計ファイル from Vedanta COA.XLS. No Vedanta logo / "FOR VEDANTA" signature lines (to confirm with ADH whether SUS needs them).' });
      await audit('UPDATE', 'customer-profile', SUS, { field: 'docVariants.CUSTOMER_COA', from: p.docVariants.CUSTOMER_COA ?? null, to: 'CUSTOMER_COA_SUS_SUMMARY' });
      await clients.updateFormat(ORG, SUS, 'CUSTOMER_PL', { generator: 'CUSTOMER_PL_SUS_XLS', notes: 'PACKING LIST .xlsx from Vedanta PL.XLS (cast + bundle no. added, Sub Total).' });
      await audit('UPDATE', 'customer-profile', SUS, { field: 'docVariants.CUSTOMER_PL', from: p.docVariants.CUSTOMER_PL ?? null, to: 'CUSTOMER_PL_SUS_XLS' });
      for (const s of SAMPLES) {
        const buf = fs.readFileSync(s.path);
        const name = s.path.split('/').pop()!;
        const r = await clients.addSample(ORG, SUS, s.docType, { originalname: name, mimetype: s.mime, size: buf.length, buffer: buf } as any, { id: ACTOR.id, name: ACTOR.name });
        const added = r.formats.find((f) => f.docType === s.docType)!.samples.slice(-1)[0];
        await audit('CREATE', 'format-sample', added.id, { customerId: SUS, docType: s.docType, fileName: name, sizeBytes: buf.length });
      }
      const q = await config.profileOf(ORG, SUS);
      console.log('SUS after:', JSON.stringify(q.docVariants), '| docAddressee', q.docAddressee, '| delivery', q.deliveryProfile?.siteName, '| billing', q.billingMode);
    }
  }

  if (PART === 2) {
    for (const [no, pi] of [[24, '9331004321'], [25, '9331004320'], [26, '9331004320']] as const) {
      const o = await order(no);
      console.log(`#${no} order piNo ${o.piNo ?? '∅'} · S${o.supplierOrder?.soNo} piNo ${o.supplierOrder?.piNo ?? '∅'} → ${pi}`);
      if (!APPLY) continue;
      const so = await prisma.supplierOrder.updateMany({ where: { id: o.supplierOrder.id, organizationId: ORG, piNo: null }, data: { piNo: pi } });
      if (so.count) await audit('UPDATE', 'supplier-order', o.supplierOrder.id, { field: 'piNo', from: null, to: pi, ref: `S${o.supplierOrder.soNo} (#${no})`, source: "Vedanta Oct'26 declaration (forwarded by ADH, 24–25 Oct)" });
      const od = await prisma.tradeOrder.updateMany({ where: { id: o.id, organizationId: ORG, piNo: null }, data: { piNo: pi } });
      if (od.count) await audit('UPDATE', 'trade-order', o.id, { field: 'piNo', from: null, to: pi, ref: `#${no}`, source: "Vedanta Oct'26 declaration" });
      console.log(`   wrote: S${o.supplierOrder.soNo} ${so.count ? 'yes' : 'no (not empty)'}, #${no} ${od.count ? 'yes' : 'no (not empty)'}`);
    }
  }

  if (PART === 3) {
    const o = await order(23);
    const so = o.supplierOrder;
    const k422 = await prisma.contract.findFirst({ where: { organizationId: ORG, contractNo: '454003422' }, select: { id: true, supplierId: true, premiumSchedule: true } });
    const cp = n(o.clientPremium)!;
    const qty = n(o.qtyMt)!;
    const m = (sp: number, t: number) => ({ perT: cp - sp, total: (cp - sp) * t });
    const blended = (100 * 162 + 100 * 240) / 200;
    console.log(`#23 SUS ${o.grade} ${qty} t, contract ${o.contract?.contractNo}, client premium ${cp}, upcharge ${n(o.upcharge)}, order supplier premium ${n(o.supplierPremium)}`);
    console.log(`BEFORE  S${so.soNo}: ${n(so.qtyMt)} t on ${so.contract?.contractNo}, PI ${so.piNo ?? '∅'}, premium ${n(so.supplierPremium)} → margin ${cp - n(so.supplierPremium)!}/t × ${qty} t = USD ${m(n(so.supplierPremium)!, qty).total.toLocaleString()}`);
    console.log(`AFTER   S${so.soNo}: 100 t on 454003255, PI 9331004319, premium 162 → margin ${m(162, 100).perT}/t × 100 t = USD ${m(162, 100).total.toLocaleString()}`);
    console.log(`        S(new): 100 t on 454003422, PI 9331004321, premium 240, 6005, Oct'26 → margin ${m(240, 100).perT}/t × 100 t = USD ${m(240, 100).total.toLocaleString()}`);
    console.log(`        total margin USD ${(m(162, 100).total + m(240, 100).total).toLocaleString()} (was ${m(n(so.supplierPremium)!, qty).total.toLocaleString()}); blended supplier premium ${blended} → ${cp - blended}/t`);
    console.log(`        #23 order: supplier premium ${n(o.supplierPremium)} → ${blended} (blended, shown for your go — an overwrite); client premium ${cp} unchanged; PI no. stays empty (two PIs: on the supplier orders)`);
    console.log(`        #23 stays linked to S${so.soNo}; the new supplier order gets forOrderId = #23 (Monthly view: Order ton 200, both contract · PI)`);
    console.log(`        #23 flag: checkFields ${JSON.stringify(o.checkFields)} → + clientPremium if missing; note + "${NOTE23}"`);
    if (APPLY) {
      const fresh = await prisma.supplierOrder.findFirst({ where: { id: so.id }, select: { qtyMt: true, piNo: true, supplierPremium: true } });
      if (n(fresh.qtyMt) !== 200 || fresh.piNo || n(fresh.supplierPremium) !== 162) throw new Error(`S${so.soNo} changed since the dry run: ${JSON.stringify(fresh)}`);
      const newId: string = await prisma.$transaction(async (tx: any) => {
        await tx.supplierOrder.update({ where: { id: so.id }, data: { qtyMt: 100, piNo: '9331004319', notes: [so.notes, "Round AM split (owner's go): first 100 t of #23 on 454003255 (Oct'26 declaration, PI 9331004319, premium 162 for the first 103 t). Second 100 t: the 454003422 supplier order (PI 9331004321)."].filter(Boolean).join('\n') } });
        const id = await createSupplierOrderInTx(tx, config, ORG, { contractId: k422.id, declarationMonth: '2026-10', grade: o.grade, size: o.size, qtyMt: 100, supplierPremium: 240, piNo: '9331004321', notes: `Round AM split (owner's go): second 100 t of #23 (SUS 6005, Oct'26) on 454003422 — PI 9331004321 (shared with #24's 6063 200 t), premium 240.` } as any, { id: ACTOR.id, name: ACTOR.name });
        await tx.supplierOrder.update({ where: { id }, data: { forOrderId: o.id } });
        const flags = [...new Set([...(o.checkFields ?? []), 'clientPremium'])];
        await tx.tradeOrder.update({ where: { id: o.id }, data: { checkFields: flags, notes: [o.notes, NOTE23].filter(Boolean).join('\n'), ...(process.argv.includes('--blend') ? { supplierPremium: blended } : {}) } });
        return id;
      });
      await audit('UPDATE', 'trade-order', o.id, { ref: '#23', checkFields: { from: o.checkFields, to: [...new Set([...(o.checkFields ?? []), 'clientPremium'])] }, notesAppended: NOTE23, ...(process.argv.includes('--blend') ? { supplierPremium: { from: n(o.supplierPremium), to: blended } } : {}) });
      await audit('UPDATE', 'supplier-order', so.id, { ref: `S${so.soNo} (#23)`, qtyMt: { from: 200, to: 100 }, piNo: { from: null, to: '9331004319' } });
      const created = await prisma.supplierOrder.findFirst({ where: { id: newId }, select: { soNo: true } });
      await audit('CREATE', 'supplier-order', newId, { ref: `S${created.soNo} (#23 second half)`, forOrderId: o.id, contract: '454003422', qtyMt: 100, piNo: '9331004321', supplierPremium: 240 });
      console.log(`applied: S${so.soNo} updated, S${created.soNo} created${process.argv.includes('--blend') ? ', #23 supplier premium blended' : ''}`);
    }
  }

  const after = await snap();
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter((k) => before.get(k) !== after.get(k));
  console.log(`\nchanged snapshot keys: ${changed.join(', ') || 'none'}; other orgs changed: ${changed.filter((k) => !k.endsWith(ORG)).length}`);
  if (log.length) {
    const prev = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : [];
    fs.writeFileSync(LOG, JSON.stringify([...prev, ...log], null, 1));
    console.log(`log → ${LOG} (+${log.length})`);
  }
  });
  await app.close();
  process.exit(0);
})().catch((e) => { console.error(e?.message ?? e); if (log.length) fs.writeFileSync('scripts/_am-prod-go.partial.json', JSON.stringify(log, null, 1)); process.exit(1); });
