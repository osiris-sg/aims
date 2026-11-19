/**
 * DEV test for Biofuel A/B/C (2026-11-19). Service-level, against the DEV DB (.env),
 * under the Biofuel tenant context. NOT committed. Runs:
 *   C  schedule a delivery with no Sales Order: refused with the flag off, accepted on;
 *      claim a unit, ack-all + finalize with a signature -> signed DO, draft invoice
 *      with no saleOrderId and no poNo.
 *   A  schedule a return of that unit + one free-typed line, claim, collect, finalize ->
 *      RDO. Re-save of an UNSIGNED RDO copy with a no-unit row: refused flag off,
 *      accepted flag on. Re-save of the SIGNED RDO with the flag on: refused (read-only).
 *      getById marks the signed RDO rdoSigned.
 * Dev Biofuel's WhatsApp agent + group posts are switched off for the run and every
 * outbox / group-post row it queued is removed; flags restored and all test rows torn
 * down by exact id at the end.
 *   npx ts-node -r tsconfig-paths/register --transpile-only scripts/_abc-biofuel-devtest.ts
 */
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../config/configuration';
import { CommonModule } from '../src/common/common.module';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
import { DeliveriesModule } from '../src/deliveries/deliveries.module';
import { DeliveriesService } from '../src/deliveries/deliveries.service';
import { DocumentsModule } from '../src/documents/documents.module';
import { DocumentsService } from '../src/documents/documents.service';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { PushModule } from '../src/push/push.module';
import { ClerkModule } from '../src/clerk/clerk.module';

@Module({
  imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), CommonModule, ActionLogModule, PushModule, ClerkModule, DeliveriesModule, DocumentsModule],
})
class M {}

const ORG = '52e90ba8-bfbd-48b0-bb76-4f9667bf74f1'; // Biofuel (DEV)
const RIDER = 'devtest-abc-rider';
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const STAMP = Date.now().toString(36).toUpperCase();
const SKU = `ABCTEST-${STAMP}`;
const TYPED = `ABC typed line ${STAMP}`;
const FLAGS = ['enableRdoFreeTypedRows', 'enableSignedDocPreview', 'enableOptionalSaleOrder'];
const QUIET = ['enableWhatsAppAgent', 'enableDeliveryGroupPosts'];

function expect(cond: unknown, msg: string) {
  if (!cond) throw new Error(`EXPECT FAILED: ${msg}`);
  console.log(`  ok  ${msg}`);
}
async function rejects(p: Promise<unknown>, re: RegExp, msg: string) {
  let err = '';
  try { await p; } catch (e: any) { err = e?.message ?? String(e); }
  expect(re.test(err), `${msg} (got: ${err || 'no error'})`);
}

async function main() {
  const app = await NestFactory.createApplicationContext(M, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const svc = app.get(DeliveriesService);
  const docs = app.get(DocumentsService);
  const made = { inv: null as string | null, runs: [] as string[], docs: [] as string[] };
  let origFeatures: any = undefined;
  const setFlags = async (patch: Record<string, boolean>) => {
    const ui = await prisma.organizationUIConfig.findUnique({ where: { organizationId: ORG }, select: { features: true } });
    await prisma.organizationUIConfig.update({ where: { organizationId: ORG }, data: { features: { ...((ui?.features as any) ?? {}), ...patch } } });
  };
  try {
    await runAsOrg(ORG, async () => {
      const ui = await prisma.organizationUIConfig.findUnique({ where: { organizationId: ORG }, select: { features: true } });
      if (!ui) throw new Error('dev Biofuel has no OrganizationUIConfig');
      origFeatures = ui.features ?? {};
      await setFlags({ ...Object.fromEntries(FLAGS.map((k) => [k, false])), ...Object.fromEntries(QUIET.map((k) => [k, false])) });

      // ---- setup: one instock test unit, a project with a customer -------------
      const template = await prisma.inventory.findFirst({ where: { organizationId: ORG }, select: { assetId: true, category: true } });
      if (!template?.assetId) throw new Error('no unit to copy asset from');
      const unit = await prisma.inventory.create({ data: { organizationId: ORG, assetId: template.assetId, category: template.category, sku: SKU, status: 'instock', quantity: 1 } });
      made.inv = unit.id;
      const proj = await prisma.project.findFirst({ where: { organizationId: ORG, customerId: { not: null } }, select: { id: true, customerId: true } });
      if (!proj?.customerId) throw new Error('no dev project with a customer');
      console.log(`setup: unit ${SKU}, project ${proj.id}`);
      const when = new Date(Date.now() + 3600_000).toISOString();
      const schedDto: any = { scheduledFor: when, customerId: proj.customerId, projectId: proj.id, items: [{ assetId: template.assetId, quantity: 1 }] };

      // ---- C: Sales Order optional ---------------------------------------------
      console.log('C. schedule a delivery with no Sales Order');
      await rejects(svc.createScheduled({ ...schedDto }, ORG), /Sale Order is required/, 'flag off: refused');
      await setFlags({ enableOptionalSaleOrder: true });
      const run: any = await svc.createScheduled({ ...schedDto }, ORG);
      made.runs.push(run.id);
      if (run.documentId) made.docs.push(run.documentId);
      expect(run.id && run.status === 'scheduled', 'flag on: scheduled without a Sales Order');
      const doId = run.documentId ?? (await prisma.deliveryItem.findFirst({ where: { deliveryId: run.id, documentId: { not: null } } }))?.documentId;
      expect(!!doId, 'the run has a DO');
      if (doId && !made.docs.includes(doId)) made.docs.push(doId);
      let doDoc = await prisma.document.findUnique({ where: { id: doId! } });
      expect(!(doDoc?.config as any)?.poNo && !(doDoc?.config as any)?.saleOrderId, 'the DO has no poNo and no saleOrderId');

      await svc.claimScheduled(run.id, { inventoryId: unit.id, assetId: template.assetId, riderName: 'DEV Rider' } as any, ORG, RIDER);
      await svc.advanceDeliveryItem(run.id, unit.id, 'start', ORG); // the rider's DO_START
      await svc.acknowledgeAll(run.id, { signature: SIG, recipientName: 'DEV Customer', photos: [] } as any, ORG, RIDER);
      const fin: any = await svc.finalizeRun(run.id, { signature: SIG, recipientName: 'DEV Customer' } as any, ORG, RIDER, { allowPartial: true } as any);
      const runAfter = await prisma.delivery.findUnique({ where: { id: run.id }, select: { status: true } });
      expect(['completed', 'delivered'].includes(String(runAfter?.status)), `delivery finished (${runAfter?.status})`);
      doDoc = await prisma.document.findUnique({ where: { id: doId! } });
      console.log(`     DO ${doDoc?.name} status ${doDoc?.status}`);
      const inv = await prisma.document.findFirst({ where: { organizationId: ORG, type: 'INVOICE', config: { path: ['sourceDocumentId'], equals: doId } } });
      if (inv) {
        made.docs.push(inv.id);
        expect(!(inv.config as any)?.saleOrderId, `draft invoice ${inv.name} (${inv.status}) has no saleOrderId, so the editor flags it`);
      } else console.log('     (no draft invoice was made on dev for this run)');
      const unitNow = await prisma.inventory.findUnique({ where: { id: unit.id }, select: { status: true } });
      expect(unitNow?.status === 'rental', 'unit went out on rental');
      void fin;

      // ---- A: return + RDO ------------------------------------------------------
      console.log('A. return of the unit + one free-typed line');
      const ret: any = await svc.createScheduledReturn(
        { scheduledFor: when, customerId: proj.customerId, projectId: proj.id, inventoryIds: [unit.id], typedLines: [{ description: TYPED }] } as any,
        ORG,
      );
      made.runs.push(ret.id);
      await svc.claimReturn(ret.id, { riderName: 'DEV Rider' }, ORG, RIDER);
      await svc.advanceDeliveryItem(ret.id, unit.id, 'start', ORG);
      const typedItem = await prisma.deliveryItem.findFirst({ where: { deliveryId: ret.id, inventoryId: null, assetId: null } });
      if (typedItem) await svc.startFreeTypedItem(ret.id, typedItem.id, { technicianName: 'DEV Rider' } as any, ORG, RIDER, { photoGate: false } as any);
      await svc.acknowledgeAll(ret.id, { signature: SIG, recipientName: 'DEV Customer', photos: [] } as any, ORG, RIDER);
      await svc.finalizeReturn(ret.id, { signature: SIG, recipientName: 'DEV Customer' }, ORG, RIDER);
      const rdoItem = await prisma.deliveryItem.findFirst({ where: { deliveryId: ret.id, documentId: { not: null } } });
      const rdo = rdoItem?.documentId ? await prisma.document.findUnique({ where: { id: rdoItem.documentId } }) : null;
      expect(!!rdo && rdo.type === 'RETURN_DELIVERY_ORDER', `RDO made (${rdo?.name})`);
      made.docs.push(rdo!.id);
      const unitBack = await prisma.inventory.findUnique({ where: { id: unit.id }, select: { status: true } });
      expect(unitBack?.status === 'instock', 'unit back instock');
      const rdoItems: any[] = ((rdo!.config as any)?.items ?? []);
      expect(rdoItems.some((i) => !i.inventoryItemId), 'the RDO carries a row with no unit (auto-made free-typed line)');

      // An UNSIGNED copy of the RDO (same config, no run) for the re-save tests.
      const copy = await prisma.document.create({
        data: { organizationId: ORG, type: 'RETURN_DELIVERY_ORDER', name: `RDO-ABCTEST-${STAMP}`, status: 'unconfirmed', documentTemplateId: rdo!.documentTemplateId, config: rdo!.config as any },
      });
      made.docs.push(copy.id);
      const withFree = { ...(rdo!.config as any), items: [...rdoItems, { id: 1, itemCode: '', inventoryItemId: '', description: 'Free row typed in the editor', quantity: 1, unitPrice: 0, amount: 0 }] };
      await setFlags({ enableRdoFreeTypedRows: false });
      await rejects(docs.updateDocument({ id: copy.id, type: 'RETURN_DELIVERY_ORDER', config: withFree } as any, ORG), /select inventory items/, 'flag off: unsigned RDO with a no-unit row refused (old rule)');
      await setFlags({ enableRdoFreeTypedRows: true });
      const unitBefore = (await prisma.inventory.findUnique({ where: { id: unit.id }, select: { status: true } }))?.status;
      await docs.updateDocument({ id: copy.id, type: 'RETURN_DELIVERY_ORDER', config: withFree } as any, ORG);
      const saved = await prisma.document.findUnique({ where: { id: copy.id } });
      expect(((saved?.config as any)?.items ?? []).length === rdoItems.length + 1, 'flag on: unsigned RDO with no-unit rows saved');
      const unitAfterSave = (await prisma.inventory.findUnique({ where: { id: unit.id }, select: { status: true } }))?.status;
      expect(unitAfterSave === unitBefore, `saving moved no stock (${unitBefore} -> ${unitAfterSave})`);
      await rejects(docs.updateDocument({ id: rdo!.id, type: 'RETURN_DELIVERY_ORDER', config: rdo!.config } as any, ORG), /signed and can no longer be changed/, 'flag on: the SIGNED RDO is read-only');
      const got: any = await docs.getById(rdo!.id, ORG);
      expect(got?.rdoSigned === true, 'getById marks the signed RDO');
      const gotCopy: any = await docs.getById(copy.id, ORG);
      expect(!gotCopy?.rdoSigned, 'the unsigned copy is not marked');

      // A DO is untouched by the RDO flag.
      await rejects(
        docs.updateDocument({ id: doId!, type: 'DELIVERY_ORDER', config: { ...(doDoc!.config as any), items: [{ description: 'no unit', quantity: 1 }] } } as any, ORG),
        /select inventory items/,
        'a DO still needs a unit on every row with the RDO flag on',
      );
    });
    console.log('\nALL CHECKS PASSED');
  } finally {
    await runAsOrg(ORG, async () => {
      // queued pushes / group posts from these runs, then the test rows themselves
      const outbox = await prisma.whatsAppOutbox.deleteMany({ where: { organizationId: ORG, createdAt: { gte: new Date(Date.now() - 15 * 60_000) }, OR: [{ text: { contains: SKU } }, ...made.docs.map((id) => ({ text: { contains: id } }))] } as any }).catch(() => ({ count: -1 }));
      const posts = made.runs.length ? await prisma.deliveryGroupPost.deleteMany({ where: { organizationId: ORG, deliveryId: { in: made.runs } } }).catch(() => ({ count: -1 })) : { count: 0 };
      const recentOutbox = await prisma.whatsAppOutbox.findMany({ where: { organizationId: ORG, createdAt: { gte: new Date(Date.now() - 15 * 60_000) } }, select: { id: true, text: true } }).catch(() => []);
      console.log(`cleanup: outbox ${outbox.count}, group posts ${posts.count}; other outbox rows in the last 15 min: ${recentOutbox.length}`);
      for (const o of recentOutbox) console.log(`   outbox ${o.id}: ${String(o.text).slice(0, 80)}`);
      for (const runId of made.runs) {
        await prisma.maintenanceServiceReport.deleteMany({ where: { deliveryId: runId } }).catch((e) => console.log('msr', e.message));
      }
      for (const id of [...made.docs].reverse()) {
        await prisma.timelineItem.deleteMany({ where: { documentId: id } }).catch(() => undefined);
        await prisma.maintenanceServiceReport.deleteMany({ where: { documentId: id } }).catch(() => undefined);
      }
      for (const runId of made.runs) {
        await prisma.delivery.delete({ where: { id: runId } }).catch((e) => console.log('run', runId, e.message));
      }
      for (const id of [...made.docs].reverse()) {
        await prisma.documentItem.deleteMany({ where: { documentId: id } }).catch(() => undefined);
        await prisma.document.delete({ where: { id } }).catch((e) => console.log('doc', id, e.message));
      }
      if (made.inv) {
        await prisma.timelineItem.deleteMany({ where: { inventoryId: made.inv } }).catch(() => undefined);
        const unitAssign = await prisma.assignment.findMany({ where: { inventoryId: made.inv }, select: { id: true, projectDeploymentId: true } });
        await prisma.assignment.deleteMany({ where: { inventoryId: made.inv } }).catch(() => undefined);
        for (const depId of [...new Set(unitAssign.map((a) => a.projectDeploymentId).filter((x): x is string => !!x))]) {
          const left = await prisma.assignment.count({ where: { projectDeploymentId: depId } });
          if (!left) await prisma.projectDeployment.delete({ where: { id: depId } }).catch((e) => console.log('unit dep', e.message));
        }
        await prisma.inventory.delete({ where: { id: made.inv } }).catch((e) => console.log('inv', e.message));
      }
      const typedAssign = await prisma.assignment.findMany({ where: { description: TYPED }, select: { id: true, projectDeploymentId: true } });
      for (const a of typedAssign) {
        await prisma.assignment.delete({ where: { id: a.id } }).catch(() => undefined);
        if (a.projectDeploymentId) await prisma.projectDeployment.delete({ where: { id: a.projectDeploymentId } }).catch((e) => console.log('dep', e.message));
      }
      if (origFeatures !== undefined) {
        await prisma.organizationUIConfig.update({ where: { organizationId: ORG }, data: { features: origFeatures } });
        console.log('dev Biofuel flags restored');
      }
    });
    await app.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
