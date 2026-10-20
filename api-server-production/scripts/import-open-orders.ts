/**
 * Import ADH's open orders from their task list so the email intake can match
 * them (2026-10). For each order in the file (#11 is skipped — already in AIMS):
 *   - the customer order (customer, contract, months, product, qty, client fixed premium) and its
 *     1:1 supplier order (Vedanta, the contract, declaration month = ship month) — via the app's own
 *     create path, so the steps follow the customer / supplier profile rules (Kato: step 2 N/A …);
 *   - its shipments (B/L, vessel / voyage, carrier, net / gross, ETD / ETA / arrived), the ETA
 *     history = that one value;
 *   - steps numbered before currentStep → done ("completed before AIMS (from task list)", no files),
 *     the step at currentStep → in progress; a shipment whose steps are then all done is completed;
 *   - a missing premium, or a note saying something was assumed / unclear → "check" on the field.
 *
 * Idempotent: an order is matched on year + orderNo and updated (only what differs); a shipment on
 * its B/L. A second run writes nothing. ADH only. --dry-run does every write in a transaction that
 * is rolled back, so the counts per order are exact.
 *
 * The file is customer business data — keep it out of the repo.
 *
 *   TENANCY_MODE=per-org npx ts-node -r tsconfig-paths/register --transpile-only scripts/import-open-orders.ts \
 *     --org=<id> --file=~/Desktop/ADH_Docs/_import/adh-open-orders-2026-10.json [--dry-run]
 *   (prod: DATABASE_URL=<prod> TENANCY_MODE= …)
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as os from 'os';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../config/configuration';
import { ActionLogModule } from '../src/action-log/action-log.module';
import { ActionLogService } from '../src/action-log/action-log.service';
import { PushModule } from '../src/push/push.module';
import { ShipmentsModule } from '../src/shipments/shipments.module';
import { PrismaService } from '../src/common/prisma.service';
import { runAsOrg } from '../src/common/tenancy/tenant-context';
import { OrdersService } from '../src/shipments/orders.service';
import { ShipmentsService } from '../src/shipments/shipments.service';
import { countsForProgress } from '../src/shipments/shipments.rules';
import { withEtaChange } from '../src/shipments/trade-alerts';
import {
  CARRIER_LINES,
  checkFieldsFor,
  clientPremiumToStore,
  CUSTOMER_NAMES,
  IMPORT_NOTE,
  lineFor,
  OpenOrder,
  OpenOrdersFile,
  openOrdersProblems,
  SKIP_ORDERS,
  splitVesselVoyage,
  stepPlan,
} from '../src/shipments/trade-open-orders';

@Module({ imports: [ConfigModule.forRoot({ load: [configuration], isGlobal: true }), ActionLogModule, PushModule, ShipmentsModule] })
class ImportModule {}

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const ORG = arg('org');
const FILE = arg('file')?.replace(/^~(?=\/)/, os.homedir());
const DRY = process.argv.includes('--dry-run');
const ADH = /^Asia Deal Hub Japan/i;
const ACTOR = { id: 'import:task-list', name: 'Task list import' };
class Rollback extends Error {}

type Db = any;
const day = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

async function main() {
  if (!ORG || !/^[0-9a-f-]{36}$/i.test(ORG)) throw new Error('--org=<organization id> is required');
  if (!FILE || !fs.existsSync(FILE)) throw new Error('--file=<json> is required (and must exist)');
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8')) as OpenOrdersFile;
  const problems = openOrdersProblems(data);
  if (problems.length) throw new Error(`the file has problems:\n  ${problems.join('\n  ')}`);

  const app = await NestFactory.createApplicationContext(ImportModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const orders = app.get(OrdersService);
  const shipments = app.get(ShipmentsService);
  const actionLog = app.get(ActionLogService);
  const org = await prisma.organization.findUnique({ where: { id: ORG }, select: { name: true } });
  if (!org || !ADH.test(org.name)) throw new Error(`refusing: ${ORG} is not the ADH org (${org?.name ?? 'not found'})`);
  console.log(`org: ${org.name} · mode: ${DRY ? 'DRY RUN (rolled back)' : 'RUN'} · ${data.orders.length} order(s) in the file, year ${data.year}\n`);

  const totals = { created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0, shipmentsNew: 0, shipmentsUpdated: 0, stepsDone: 0, stepsStarted: 0 };
  await runAsOrg(ORG, async () => {
    const custIds: Record<string, string> = {};
    for (const [k, name] of Object.entries(CUSTOMER_NAMES)) {
      const c = await prisma.customer.findFirst({ where: { organizationId: ORG, name: { equals: name, mode: 'insensitive' } }, select: { id: true } });
      if (c) custIds[k] = c.id;
    }
    for (const o of [...data.orders].sort((a, b) => a.orderNo - b.orderNo)) {
      if (SKIP_ORDERS.has(o.orderNo)) {
        totals.skipped++;
        console.log(`#${o.orderNo}  skipped (already in AIMS)`);
        continue;
      }
      try {
        const r = await prisma
          .$transaction((tx: Db) => importOne(tx, o), { timeout: 120_000, maxWait: 20_000 })
          .catch((e: unknown) => {
            if (e instanceof Rollback) return (e as Rollback & { result: OrderResult }).result;
            throw e;
          });
        totals[r.action]++;
        totals.shipmentsNew += r.shipmentsNew;
        totals.shipmentsUpdated += r.shipmentsUpdated;
        totals.stepsDone += r.stepsDone;
        totals.stepsStarted += r.stepsStarted;
        console.log(
          `#${o.orderNo}  ${r.action.padEnd(9)} ${o.customer.padEnd(4)} ${o.contract} ${o.grade.padEnd(9)} ${String(o.qtyMt).padStart(4)} MT · supplier order ${r.so} · shipments +${r.shipmentsNew} new, ${r.shipmentsUpdated} updated · steps ${r.stepsDone} done, ${r.stepsStarted} in progress${r.completedShipments ? ` · ${r.completedShipments} shipment(s) completed` : ''}${r.check.length ? ` · check: ${r.check.join(', ')}` : ''}${r.changes.length ? `\n        changed: ${r.changes.join('; ')}` : ''}${r.notes.length ? `\n        ${r.notes.join('\n        ')}` : ''}`,
        );
        if (!DRY && r.action !== 'unchanged')
          actionLog.system('import-open-orders', r.action === 'created' ? 'CREATE' : 'UPDATE', 'TradeOrder', {
            organizationId: ORG,
            resourceId: r.orderId,
            details: { orderNo: o.orderNo, source: 'task list', shipmentsNew: r.shipmentsNew, stepsDone: r.stepsDone },
          });
      } catch (e) {
        totals.failed++;
        console.log(`#${o.orderNo}  FAILED: ${String((e as Error)?.message ?? e).slice(0, 300)}`);
      }
    }

    type OrderResult = {
      action: 'created' | 'updated' | 'unchanged';
      orderId: string;
      so: string;
      shipmentsNew: number;
      shipmentsUpdated: number;
      stepsDone: number;
      stepsStarted: number;
      completedShipments: number;
      check: string[];
      changes: string[];
      notes: string[];
    };

    async function importOne(tx: Db, o: OpenOrder): Promise<OrderResult> {
      const year = data.year;
      const customerId = custIds[o.customer.toUpperCase()];
      if (!customerId) throw new Error(`customer ${CUSTOMER_NAMES[o.customer.toUpperCase()]} not found — run setup-adh-org first`);
      const contract = await tx.contract.findFirst({
        where: { organizationId: ORG, contractNo: o.contract },
        select: { id: true, supplierId: true, lines: { select: { grade: true, upcharge: true } } },
      });
      if (!contract) throw new Error(`contract ${o.contract} not found`);
      const { line, sameGrade } = lineFor(contract.lines as Array<{ grade: string | null; upcharge: unknown }>, o.grade);
      // No line of this grade on the contract: the supplier premium defaults from another grade's line → "check".
      const check = [...new Set([...checkFieldsFor(o), ...(sameGrade ? [] : ['supplierPremium'])])];
      const note = o.note ? `Task list: ${o.note}` : null;
      const res: OrderResult = {
        action: 'unchanged',
        orderId: '',
        so: '—',
        shipmentsNew: 0,
        shipmentsUpdated: 0,
        stepsDone: 0,
        stepsStarted: 0,
        completedShipments: 0,
        check: [],
        changes: [],
        notes: [],
      };

      let existing = await tx.tradeOrder.findFirst({ where: { organizationId: ORG, year, orderNo: o.orderNo } });
      if (!existing) {
        const id = await orders.createInTx(
          tx,
          ORG,
          {
            year,
            orderNo: o.orderNo,
            contractId: contract.id,
            customerId,
            shipMonth: o.shipMonth,
            deliveryMonth: o.deliveryMonth,
            grade: o.grade,
            ...(o.size ? { size: o.size } : {}),
            qtyMt: o.qtyMt,
            // A missing premium defaults from the contract line (flagged "check"); the upcharge stays apart.
            ...(o.clientFixedPremium !== null ? { clientPremium: clientPremiumToStore(o.clientFixedPremium, line?.upcharge) } : {}),
            ...(note ? { notes: note } : {}),
            checkFields: check,
          },
          ACTOR,
        );
        existing = await tx.tradeOrder.findFirst({ where: { id } });
        res.action = 'created';
        res.check = check;
      } else {
        // Update what differs; a field this run changes and the note flags gets "check".
        const want: Record<string, unknown> = {
          contractId: contract.id,
          customerId,
          shipMonth: o.shipMonth,
          deliveryMonth: o.deliveryMonth,
          grade: o.grade,
          ...(o.size ? { size: o.size } : {}),
          qtyMt: o.qtyMt,
          ...(o.clientFixedPremium !== null ? { clientPremium: clientPremiumToStore(o.clientFixedPremium, existing.upcharge) } : {}),
        };
        const diff: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(want)) {
          const cur = (existing as Record<string, unknown>)[k];
          const same = typeof v === 'number' ? num(cur) === v : (cur ?? null) === v;
          if (!same) {
            diff[k] = v;
            res.changes.push(`${k} ${cur === null || cur === undefined ? '—' : String(cur)} → ${String(v)}`);
          }
        }
        if (note && !existing.notes) diff.notes = note;
        const addCheck = check.filter((k) => k in diff || (k === 'clientPremium' && o.clientFixedPremium === null && existing!.clientPremium === null));
        const nextCheck = [...new Set([...(existing.checkFields ?? []), ...addCheck])];
        if (nextCheck.length !== (existing.checkFields ?? []).length) diff.checkFields = nextCheck;
        if (Object.keys(diff).length) {
          await tx.tradeOrder.update({ where: { id: existing.id }, data: diff });
          // Shipments carry the order's contract / customer (as OrdersService.update does).
          if (diff.customerId !== undefined) await tx.shipment.updateMany({ where: { organizationId: ORG, orderId: existing.id }, data: { customerId } });
          if (diff.contractId !== undefined) await tx.shipment.updateMany({ where: { organizationId: ORG, orderId: existing.id }, data: { contractId: contract.id } });
          res.action = 'updated';
          res.check = addCheck;
        }
      }
      const order = existing!;
      res.orderId = order.id;
      if (order.supplierOrderId) {
        const so = await tx.supplierOrder.findFirst({ where: { id: order.supplierOrderId }, select: { year: true, soNo: true, piNo: true, declarationMonth: true } });
        res.so = so ? (so.piNo ?? `${so.year}-S${so.soNo}`) : '—';
        if (so && !so.declarationMonth) await tx.supplierOrder.update({ where: { id: order.supplierOrderId }, data: { declarationMonth: o.shipMonth } });
      } else res.notes.push('no supplier order linked — link one on the order');

      // Shipments, by B/L.
      for (const s of [...(o.shipments ?? [])].sort((a, b) => a.seq - b.seq)) {
        const vv = splitVesselVoyage(s.vesselVoyage);
        const fields = {
          vessel: vv.vessel,
          voyageNo: vv.voyageNo,
          shippingLine: s.carrier ? CARRIER_LINES[s.carrier.toUpperCase()] : null,
          netWeightMt: s.netMt ?? null,
          grossWeightMt: s.grossMt ?? null,
          etd: s.etd ?? null,
          eta: s.eta ?? null,
          actualArrivalDate: s.arrived ?? null,
        };
        // By B/L; else the order's shipment of that number still without a B/L (made in AIMS before the B/L was known).
        const hit =
          (await tx.shipment.findFirst({ where: { organizationId: ORG, blNumber: s.blNo } })) ??
          (await tx.shipment.findFirst({ where: { organizationId: ORG, orderId: order.id, seqNo: s.seq, blNumber: null } }));
        if (hit && hit.orderId !== order.id) {
          res.notes.push(`B/L ${s.blNo} is on another order — left as is`);
          continue;
        }
        if (!hit) {
          const id = await shipments.createInTx(tx, ORG, { orderId: order.id, blNumber: s.blNo, ...fields } as any, ACTOR);
          const created = await tx.shipment.findFirst({ where: { id }, select: { seqNo: true } });
          if (created?.seqNo !== s.seq) res.notes.push(`B/L ${s.blNo}: shipment #${o.orderNo}-${created?.seqNo} (task list says -${s.seq})`);
          if (s.eta) await tx.shipment.update({ where: { id }, data: { etaHistory: [{ eta: s.eta, previous: null, at: new Date().toISOString(), by: ACTOR.name, source: 'IMPORT' }] } });
          res.shipmentsNew++;
          continue;
        }
        const data: Record<string, unknown> = hit.blNumber ? {} : { blNumber: s.blNo };
        const dates = { etd: hit.etd, eta: hit.eta, actualArrivalDate: hit.actualArrivalDate } as Record<string, Date | null>;
        for (const [k, v] of Object.entries(fields)) {
          if (v === null) continue; // the task list never clears what AIMS already has
          const cur = k in dates ? ymd(dates[k]) : k.endsWith('Mt') ? num(hit[k]) : hit[k];
          if (cur !== v) data[k] = k in dates ? day(v as string) : v;
        }
        if ('eta' in data)
          data.etaHistory = hit.eta
            ? withEtaChange(hit.etaHistory, hit.eta, data.eta as Date, ACTOR.name, 'IMPORT')
            : [{ eta: s.eta, previous: null, at: new Date().toISOString(), by: ACTOR.name, source: 'IMPORT' }];
        if (Object.keys(data).length) {
          await tx.shipment.update({ where: { id: hit.id }, data });
          res.shipmentsUpdated++;
          res.changes.push(
            `B/L ${s.blNo}: ${Object.keys(data)
              .filter((k) => k !== 'etaHistory')
              .join(', ')}`,
          );
          if (res.action === 'unchanged') res.action = 'updated';
        }
      }

      // Steps: supplier order, order, every shipment.
      const ships: Array<{ id: string; status: string }> = await tx.shipment.findMany({ where: { organizationId: ORG, orderId: order.id }, select: { id: true, status: true } });
      const owners = [...(order.supplierOrderId ? [{ supplierOrderId: order.supplierOrderId }] : []), { orderId: order.id }, ...ships.map((s) => ({ shipmentId: s.id }))];
      const now = new Date();
      const stamp = { updatedById: ACTOR.id, updatedByName: ACTOR.name };
      for (const owner of owners) {
        const steps = await tx.tradeStep.findMany({
          where: { organizationId: ORG, ...owner },
          select: { id: true, displayNo: true, sortOrder: true, status: true, isOngoing: true, notApplicable: true },
        });
        const plan = stepPlan(steps, o.currentStep);
        for (const s of plan.done) await tx.tradeStep.update({ where: { id: s.id }, data: { status: 'DONE', completedAt: now, holdOpen: false, skipReason: IMPORT_NOTE, ...stamp } });
        if (plan.start) await tx.tradeStep.update({ where: { id: plan.start.id }, data: { status: 'IN_PROGRESS', ...stamp } });
        res.stepsDone += plan.done.length;
        res.stepsStarted += plan.start ? 1 : 0;
        if (plan.done.length || plan.start) res.action = res.action === 'unchanged' ? 'updated' : res.action;
        // A shipment whose counted steps are all done is completed (as "Mark done" on its last step would).
        if ('shipmentId' in owner && plan.done.length) {
          const after = await tx.tradeStep.findMany({ where: { organizationId: ORG, shipmentId: owner.shipmentId }, select: { status: true, isOngoing: true, notApplicable: true } });
          const ship = ships.find((x) => x.id === owner.shipmentId);
          if (ship?.status === 'OPEN' && after.every((s: { status: string; isOngoing: boolean; notApplicable: boolean }) => !countsForProgress(s) || s.status === 'DONE')) {
            await tx.shipment.update({ where: { id: owner.shipmentId }, data: { status: 'COMPLETED' } });
            res.completedShipments++;
          }
        }
      }
      if (!(o.shipments ?? []).length && o.currentStep > 2) res.notes.push(`current step ${o.currentStep} but no shipment in the file`);
      if (DRY) throw Object.assign(new Rollback('dry run'), { result: res });
      return res;
    }
  });
  console.log(
    `\n${DRY ? 'would: ' : ''}created ${totals.created} · updated ${totals.updated} · unchanged ${totals.unchanged} · skipped ${totals.skipped} · failed ${totals.failed} · shipments +${totals.shipmentsNew} new, ${totals.shipmentsUpdated} updated · steps ${totals.stepsDone} done, ${totals.stepsStarted} in progress`,
  );
  await app.close();
  if (totals.failed) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(`❌ ${e?.message || e}`);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(), 200));
