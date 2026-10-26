/**
 * Round AN — ADH's Google Drive exports (Docs / Document / Thailand, unpacked under ~/Desktop/ADH_Docs/_drive) → AIMS.
 * DRY RUN by default; --apply writes (owner's go only). ADH only. Prod: TENANCY_MODE= and DATABASE_URL=<prod> inline.
 *
 *   --plan=<plan.json>    attach plan from the round AN planner: { plan: [{ kind: 'attach', scope, target, step, docType, file }] }
 *   --fills=<fills.json>  field fills: { fills: [{ target, field, value, src }] }
 *   --only=attach|fill    one half only
 *   --apply               write
 *
 * Rules (owner, round AN): empty slots / empty fields only — never overwrite or delete. Each attach is re-checked
 * against the live data (slot still empty for that doc type at that step, same bytes not already linked there) and
 * goes through TradeFilesService.upload (the app's own path: S3 key under the org prefix, document ID, thumbnail,
 * step sync). A file whose bytes are already in AIMS (sha256) is linked, not uploaded again. A file planned for
 * several records is uploaded once and linked to the others. Each fill is an updateMany guarded by "field IS NULL".
 * Every write → ActionLog (System creation) + scripts/_an-drive-backfill.log.json. Every org's trade data is hashed
 * before and after; only ADH may change.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../config/configuration';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { PushModule } from '../src/push/push.module';
import { ShipmentsModule } from '../src/shipments/shipments.module';
import { TradeFilesService } from '../src/shipments/trade-files.service';
import { TradeConfigService } from '../src/shipments/trade-config.service';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), PushModule, ActionLogModule, ShipmentsModule] })
class M {}
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const ORG = arg('org') ?? '056ed6da-42d3-438e-895b-84bb4df47a4c';
const APPLY = process.argv.includes('--apply');
const ONLY = arg('only');
const DRIVE = arg('drive') ?? `${process.env.HOME}/Desktop/ADH_Docs/_drive`;
const JOB = 'round-an-drive';
const ACTOR = { id: `system:${JOB}`, name: 'System creation (round AN Drive backfill)' };
const LOG = ORG === '056ed6da-42d3-438e-895b-84bb4df47a4c' ? 'scripts/_an-drive-backfill.log.json' : 'scripts/_an-drive-backfill.dev.log.json';
const DATE_FIELDS = new Set(['eta', 'etd', 'piDate', 'customerPoDate', 'actualArrivalDate']);
const MIME: Record<string, string> = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', jpeg: 'image/jpeg', jpg: 'image/jpeg', eml: 'message/rfc822' };
const h = (v: unknown) => createHash('sha256').update(JSON.stringify(v ?? null)).digest('hex').slice(0, 12);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const log: any[] = [];

type Attach = { kind: string; scope: 'shipment' | 'order' | 'contract'; target: string; step: string; docType: string; file: string };
type Fill = { target: string; field: string; value: string | number; src: string };

(async () => {
  const planPath = arg('plan');
  const fillsPath = arg('fills');
  if (!planPath && !fillsPath) throw new Error('--plan=<plan.json> and/or --fills=<fills.json>');
  const attaches: Attach[] = planPath && ONLY !== 'fill' ? JSON.parse(fs.readFileSync(planPath, 'utf8')).plan.filter((p: Attach) => p.kind === 'attach') : [];
  const fills: Fill[] = fillsPath && ONLY !== 'attach' ? JSON.parse(fs.readFileSync(fillsPath, 'utf8')).fills : [];
  const app = await NestFactory.createApplicationContext(M, { logger: ['error'] });
  const prisma: any = app.get(PrismaService);
  const files = app.get(TradeFilesService);
  const config = app.get(TradeConfigService);
  const audit = async (action: string, resource: string, resourceId: string, details: any) => {
    await prisma.actionLog.create({ data: { actorType: 'SYSTEM', actorId: ACTOR.id, actorName: 'System creation', organizationId: ORG, channel: 'operator', action, resource, resourceId, details } });
    log.push({ at: new Date().toISOString(), action, resource, resourceId, details });
  };
  const snap = async () => {
    const m = new Map<string, string>();
    const add = (k: string, v: unknown) => m.set(k, h([m.get(k), v]));
    for (const o of await prisma.tradeOrder.findMany({ select: { organizationId: true, id: true, piNo: true, piDate: true, piAmount: true, customerPoNo: true, customerPoDate: true }, orderBy: { id: 'asc' } })) add(`o:${o.organizationId}`, o);
    for (const s of await prisma.supplierOrder.findMany({ select: { organizationId: true, id: true, piNo: true, piDate: true, piAmount: true }, orderBy: { id: 'asc' } })) add(`so:${s.organizationId}`, s);
    for (const s of await prisma.shipment.findMany({ select: { organizationId: true, id: true, blNumber: true, vessel: true, voyageNo: true, eta: true, ciNumber: true, ciAmount: true, grossWeightMt: true, totalBundles: true, totalPieces: true, portOfLoading: true }, orderBy: { id: 'asc' } })) add(`s:${s.organizationId}`, s);
    for (const l of await prisma.tradeFileLink.findMany({ select: { organizationId: true, id: true }, orderBy: { id: 'asc' } })) add(`l:${l.organizationId}`, l.id);
    return m;
  };

  await runAsOrg(ORG, async () => {
    const before = await snap();
    const stepSel = { select: { id: true, displayNo: true, code: true, status: true, requiredDocTypes: true } };
    const linkSel = { select: { stepId: true, file: { select: { id: true, docType: true, sha256: true, fileName: true } } } };
    const orders: any[] = await prisma.tradeOrder.findMany({ where: { organizationId: ORG, year: 2026, isTest: false }, select: { id: true, orderNo: true, status: true, piNo: true, piDate: true, piAmount: true, customerPoNo: true, customerPoDate: true, steps: stepSel, fileLinks: linkSel } });
    const sos: any[] = await prisma.supplierOrder.findMany({ where: { organizationId: ORG, year: 2026 }, select: { id: true, soNo: true, piNo: true, piDate: true, piAmount: true } });
    const ships: any[] = await prisma.shipment.findMany({ where: { organizationId: ORG, order: { isTest: false, year: 2026 } }, select: { id: true, seqNo: true, status: true, blNumber: true, vessel: true, voyageNo: true, eta: true, etd: true, ciNumber: true, ciAmount: true, netWeightMt: true, grossWeightMt: true, totalBundles: true, totalPieces: true, portOfLoading: true, order: { select: { orderNo: true } }, steps: stepSel, fileLinks: linkSel } });
    const contracts: any[] = await prisma.contract.findMany({ where: { organizationId: ORG }, select: { id: true, contractNo: true, status: true, fileLinks: linkSel } });
    for (const k of contracts) k.steps = [{ id: null, displayNo: '' }];
    const byRef = (t: string) => {
      if (t.startsWith('K:')) return { kind: 'contract', rec: contracts.find((k) => k.contractNo === t.slice(2)) };
      let m = t.match(/^#(\d+)-(\d+)$/);
      if (m) return { kind: 'shipment', rec: ships.find((s) => s.order?.orderNo === +m![1] && s.seqNo === +m![2]) };
      m = t.match(/^#(\d+)$/);
      if (m) return { kind: 'order', rec: orders.find((o) => o.orderNo === +m![1]) };
      m = t.match(/^S(\d+)$/);
      if (m) return { kind: 'supplierOrder', rec: sos.find((o) => o.soNo === +m![1]) };
      return { kind: '?', rec: null };
    };
    // Files uploaded by this run, by content: a file planned for several records is stored once and linked to the rest.
    // (Same bytes already in AIMS from another upload — e.g. on a test order — get their own copy, so real and test
    // records never share a file row.)
    const knownBySha = new Map<string, { id: string }>();

    // ---------------- attaches ----------------
    const stat = { attach: 0, link: 0, skipFilled: 0, skipLinked: 0, missing: 0, notFound: 0 };
    const groups = new Map<string, Attach[]>();
    for (const a of attaches) (groups.get(a.file) ?? groups.set(a.file, []).get(a.file)!).push(a);
    const willComplete = new Map<string, Set<string>>(); // stepId -> docTypes added
    for (const [rel, list] of groups) {
      const abs = path.join(DRIVE, rel);
      if (!fs.existsSync(abs)) { stat.missing++; console.log(`  MISSING FILE ${rel}`); continue; }
      const buf = fs.readFileSync(abs);
      const digest = sha(buf);
      let fileId: string | null = knownBySha.get(digest)?.id ?? null;
      for (const a of list) {
        const { rec } = byRef(a.target);
        if (!rec) { stat.notFound++; console.log(`  NOT FOUND ${a.target} (${rel})`); continue; }
        const step = rec.steps.find((s: any) => s.displayNo === a.step);
        if (!step) { stat.notFound++; console.log(`  NO STEP ${a.step} on ${a.target}`); continue; }
        if (rec.fileLinks.some((l: any) => l.file.sha256 === digest || (l.file.fileName && l.file.fileName.toLowerCase() === path.basename(rel).toLowerCase()))) { stat.skipLinked++; console.log(`  ALREADY ${a.target} has ${path.basename(rel)} — skip`); continue; }
        const multi = ['ARRIVAL_NOTICE', 'OTHER', 'CI_PAYMENT_PROOF', 'VENDOR_INVOICE'].includes(a.docType);
        const filledBefore = rec.fileLinks.some((l: any) => (a.scope === 'contract' || l.stepId === step.id) && l.file.docType === a.docType && !l.planned);
        if (filledBefore && !multi) { stat.skipFilled++; console.log(`  SLOT FILLED ${a.target} step ${a.step} ${a.docType} — skip ${path.basename(rel)}`); continue; }
        const ownerKey = a.scope === 'shipment' ? 'shipmentIds' : a.scope === 'contract' ? 'contractIds' : 'orderIds';
        console.log(`  ${fileId ? 'LINK  ' : 'UPLOAD'} ${a.target.padEnd(6)} ${a.step.padEnd(3)} ${a.docType.padEnd(22)} ${rel.split('/').slice(2).join('/')}`);
        if (step.id) (willComplete.get(step.id) ?? willComplete.set(step.id, new Set()).get(step.id)!).add(a.docType);
        if (!APPLY) { rec.fileLinks.push({ stepId: step.id, planned: true, file: { docType: a.docType, sha256: digest } }); fileId ? stat.link++ : stat.attach++; if (!fileId) knownBySha.set(digest, { id: (fileId = `planned:${digest}`) }); continue; }
        if (!fileId) {
          let name = path.basename(rel);
          if (!path.extname(name) && buf.subarray(0, 4).toString() === '%PDF') name += '.pdf';
          const ext = path.extname(name).slice(1).toLowerCase();
          const r: any = await files.upload(ORG, { originalname: name, mimetype: MIME[ext] ?? 'application/octet-stream', size: buf.length, buffer: buf } as any, { docType: a.docType, ...(step.id ? { stepId: step.id } : {}), [ownerKey]: rec.id, notes: `ADH Drive: ${rel.split('/').slice(2).join('/')}` } as any, ACTOR, { sha256: digest, completedShipmentsOk: true });
          fileId = r.id;
          knownBySha.set(digest, { id: r.id });
          stat.attach++;
          await audit('CREATE', 'trade-file', r.id, { ref: a.target, step: a.step, docType: a.docType, fileName: name, drivePath: rel, sha256: digest, completedSteps: r.completedSteps ?? [] });
        } else {
          await prisma.tradeFileLink.create({ data: { organizationId: ORG, fileId, stepId: step.id, contractId: null, supplierOrderId: null, shipmentId: a.scope === 'shipment' ? rec.id : null, orderId: a.scope === 'order' ? rec.id : null, ...(a.scope === 'contract' ? { contractId: rec.id } : {}) } });
          const done = await config.syncSteps(prisma, ORG, [a.scope === 'shipment' ? { shipmentId: rec.id } : a.scope === 'contract' ? { contractId: rec.id } : { orderId: rec.id }] as any, ACTOR as any, { docTypes: [a.docType] });
          stat.link++;
          await audit('LINK', 'trade-file', fileId, { ref: a.target, step: a.step, docType: a.docType, drivePath: rel, sha256: digest, completedSteps: done ?? [] });
        }
        rec.fileLinks.push({ stepId: step.id, file: { id: fileId, docType: a.docType, sha256: digest } });
      }
    }
    if (attaches.length) {
      // Steps whose required documents would all be present afterwards (the app ticks those DONE by itself).
      const ticks: string[] = [];
      for (const r of [...ships, ...orders]) for (const st of r.steps) {
        if (!willComplete.has(st.id) || st.status === 'DONE' || !st.requiredDocTypes.length) continue;
        const have = new Set(r.fileLinks.filter((l: any) => l.stepId === st.id).map((l: any) => l.file.docType));
        if (st.requiredDocTypes.every((d: string) => have.has(d))) ticks.push(`${r.seqNo ? `#${r.order.orderNo}-${r.seqNo}` : `#${r.orderNo}`} step ${st.displayNo}`);
      }
      console.log(`\nattach: ${stat.attach} upload(s), ${stat.link} extra link(s) of a file uploaded in this run; skipped ${stat.skipFilled} (slot filled), ${stat.skipLinked} (same file already on the record); missing ${stat.missing}; not found ${stat.notFound}`);
      console.log(`steps the app would tick DONE (all required documents present): ${ticks.join(', ') || 'none'}`);
    }

    // ---------------- fills ----------------
    let wrote = 0;
    let held = 0;
    for (const f of fills) {
      const { kind, rec } = byRef(f.target);
      if (!rec) { console.log(`  NOT FOUND ${f.target}`); continue; }
      const cur = rec[f.field];
      if (cur !== null && cur !== undefined && cur !== '') { held++; console.log(`  NOT EMPTY ${f.target} ${f.field} = ${cur instanceof Date ? cur.toISOString().slice(0, 10) : cur} (doc ${f.value}) — skip`); continue; }
      const value = DATE_FIELDS.has(f.field) ? new Date(`${f.value}T00:00:00Z`) : f.value;
      console.log(`  FILL  ${f.target.padEnd(6)} ${f.field.padEnd(15)} ${String(f.value).padEnd(28)} ← ${f.src}`);
      if (!APPLY) continue;
      const model = kind === 'shipment' ? prisma.shipment : kind === 'order' ? prisma.tradeOrder : prisma.supplierOrder;
      const r = await model.updateMany({ where: { id: rec.id, organizationId: ORG, [f.field]: null }, data: { [f.field]: value } });
      if (r.count) {
        wrote++;
        await audit('UPDATE', kind === 'shipment' ? 'shipment' : kind === 'order' ? 'trade-order' : 'supplier-order', rec.id, { ref: f.target, field: f.field, from: null, to: f.value, source: f.src });
      }
    }
    if (fills.length) console.log(`\nfills: ${APPLY ? `${wrote} written` : `${fills.length - held} would be written`}, ${held} held (field not empty)`);

    const after = await snap();
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter((k) => before.get(k) !== after.get(k));
    console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN — nothing written'}; changed snapshot keys: ${changed.join(', ') || 'none'}; other orgs changed: ${changed.filter((k) => !k.endsWith(ORG)).length}`);
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
  if (log.length) fs.writeFileSync('scripts/_an-drive-backfill.partial.json', JSON.stringify(log, null, 1));
  process.exit(1);
});
