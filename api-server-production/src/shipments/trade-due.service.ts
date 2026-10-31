/**
 * Round AY part 2 — due dates per step and the order's Overall process. Reads the steps and the schedule; writes
 * only a step's hand-set due date (TradeStep.dueAt + who / when). Everything else is computed (trade-due.ts).
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { TradeActor } from './shipments.request';
import { countsForProgress, shipmentRef, tradeToday } from './shipments.rules';
import { alertRulesOf } from './trade-alerts';
import { profileFor } from './trade-profile';
import { processStep } from './trade-process';
import { ALERTABLE_ORDER } from './trade-test-orders';
import { daysLate, DueContext, dueOf, dayOf, StepState, stepState } from './trade-due';
import { isMovedToOrder } from './trade-process';

const STEP = {
  id: true,
  code: true,
  title: true,
  displayNo: true,
  sortOrder: true,
  status: true,
  isOngoing: true,
  notApplicable: true,
  skipReason: true,
  completedAt: true,
  dueAt: true,
  dueSetByName: true,
  dueSetAt: true,
};
const SHIP = { id: true, seqNo: true, status: true, etd: true, eta: true, tsPort: true, tsEta: true, tsEtd: true, actualArrivalDate: true, dischargeDate: true, steps: { select: STEP } };
const ORDER = {
  id: true,
  orderNo: true,
  status: true,
  createdAt: true,
  customerId: true,
  piDate: true,
  depositDueDays: true,
  depositDueUnit: true,
  steps: { select: STEP },
  shipments: { where: { status: { not: 'CANCELLED' } }, orderBy: { seqNo: 'asc' }, select: SHIP },
} as const;

export interface DueItem {
  stepId: string;
  code: string;
  no: string;
  title: string;
  titleJa: string | null;
  kind: 'order' | 'shipment';
  recordId: string;
  orderId: string;
  shipmentId: string | null;
  ref: string;
  status: string;
  /** Runs alongside (step 14): never due, never blocks. */
  ongoing: boolean;
  state: StepState;
  doneAt: string | null;
  due: string | null;
  dueSource: 'manual' | 'rule' | null;
  dueWhy: string | null;
  dueSetByName: string | null;
  dueSetAt: string | null;
  daysLate: number | null;
}

@Injectable()
export class TradeDueService {
  constructor(private readonly prisma: PrismaService) {}

  /** The org flag enableStepDueDates (default off): without it there are no due dates, tasks or overdue. */
  async enabled(organizationId: string): Promise<boolean> {
    try {
      const o = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { uiConfig: true } });
      return !!((o?.uiConfig as any)?.features?.enableStepDueDates);
    } catch {
      return false;
    }
  }

  private async settings(organizationId: string) {
    const s = await this.prisma.tradeSetting.findUnique({ where: { organizationId }, select: { customerProfiles: true, alertRules: true } });
    return { profiles: s?.customerProfiles, taxDays: alertRulesOf(s?.alertRules).taxFundingDaysBefore };
  }

  /** Every applicable step of these orders (and their live shipments) with its due date and state. */
  itemsOf(orders: any[], set: { profiles: unknown; taxDays: number }, today = tradeToday(), dueOn = true): DueItem[] {
    const out: DueItem[] = [];
    for (const o of orders) {
      const ships = (o.shipments ?? []) as any[];
      const etds = ships.map((s) => dayOf(s.etd)).filter((x): x is string => !!x).sort();
      const etas = ships.map((s) => dayOf(s.eta)).filter((x): x is string => !!x).sort();
      const base: DueContext = {
        orderCreatedAt: o.createdAt,
        piDate: o.piDate,
        depositDueDays: o.depositDueDays,
        depositDueUnit: o.depositDueUnit,
        firstEtd: etds[0] ?? null,
        lastEta: etas[etas.length - 1] ?? null,
        billingMode: profileFor(set.profiles, o.customerId).billingMode,
        taxFundingDaysBefore: set.taxDays,
      };
      const push = (steps: any[], kind: 'order' | 'shipment', recordId: string, ref: string, shipmentId: string | null, ctx: DueContext) => {
        const live = steps.filter((s) => !isMovedToOrder(s)).sort((a, b) => a.sortOrder - b.sortOrder);
        const current = live.filter(countsForProgress).find((s) => s.status !== 'DONE')?.id ?? null;
        for (const s of live) {
          if (s.notApplicable) continue;
          const d = s.isOngoing || !dueOn ? { due: null, source: null, why: null } : dueOf(s.code, ctx, s.dueAt);
          const state = stepState(s, d.due, today, s.id === current);
          out.push({
            stepId: s.id,
            code: s.code,
            no: s.displayNo ?? processStep(s.code)?.no ?? '',
            title: s.title,
            titleJa: processStep(s.code)?.ja ?? null,
            kind,
            recordId,
            orderId: o.id,
            shipmentId,
            ref,
            status: s.status,
            ongoing: !!s.isOngoing,
            state,
            doneAt: dayOf(s.completedAt),
            due: d.due,
            dueSource: d.source as DueItem['dueSource'],
            dueWhy: d.why,
            dueSetByName: s.dueSetByName ?? null,
            dueSetAt: s.dueSetAt ? new Date(s.dueSetAt).toISOString() : null,
            daysLate: state === 'overdue' && d.due ? daysLate(d.due, today) : null,
          });
        }
      };
      push(o.steps ?? [], 'order', o.id, `#${o.orderNo}`, null, base);
      for (const sh of ships) push(sh.steps ?? [], 'shipment', sh.id, shipmentRef(o.orderNo, sh.seqNo), sh.id, { ...base, etd: sh.etd, eta: sh.eta });
    }
    return out;
  }

  /** Open steps of open (real, confirmed) orders: the Tasks list, the Dashboard and the overdue badges. */
  async openItems(organizationId: string, today = tradeToday()): Promise<DueItem[]> {
    if (!(await this.enabled(organizationId))) return [];
    const orders: any[] = await this.prisma.tradeOrder.findMany({ where: { organizationId, status: 'OPEN', ...ALERTABLE_ORDER }, select: ORDER });
    for (const o of orders) o.shipments = o.shipments.filter((s: any) => s.status !== 'CANCELLED');
    const items = this.itemsOf(orders, await this.settings(organizationId), today);
    // A completed shipment's leftover steps aren't tasks.
    const closedShips = new Set(orders.flatMap((o) => o.shipments.filter((s: any) => s.status !== 'OPEN').map((s: any) => s.id)));
    return items.filter((i) => i.state !== 'done' && i.state !== 'na' && !(i.shipmentId && closedShips.has(i.shipmentId)));
  }

  /** Orders / shipments with a step past its due date (the progress bars' and Monthly view's "overdue"). */
  async overdueRecordIds(organizationId: string, today = tradeToday()): Promise<Set<string>> {
    const items = await this.openItems(organizationId, today);
    return new Set(items.filter((i) => i.state === 'overdue').flatMap((i) => [i.recordId, i.orderId]));
  }

  /** "My tasks": open steps due within `days` (overdue included), shaped like the reminders. */
  async tasks(organizationId: string, days = 3, today = tradeToday()) {
    const until = new Date(`${today}T00:00:00Z`);
    until.setUTCDate(until.getUTCDate() + days);
    const limit = until.toISOString().slice(0, 10);
    return (await this.openItems(organizationId, today))
      .filter((i) => i.due && i.due <= limit)
      .sort((a, b) => a.due!.localeCompare(b.due!))
      .map((i) => ({
        id: `step:${i.stepId}`,
        kind: 'STEP_DUE',
        key: `STEP_DUE:${i.stepId}`,
        dueAt: new Date(`${i.due}T00:00:00Z`),
        title: `${i.ref}: step ${i.no} ${i.title}${i.state === 'overdue' ? ` — ${i.daysLate} day${i.daysLate === 1 ? '' : 's'} overdue` : ''}`,
        detail: i.dueSource === 'manual' ? `Due date set by ${i.dueSetByName ?? 'hand'}` : i.dueWhy,
        shipmentId: i.shipmentId,
        orderId: i.orderId,
        supplierOrderId: null,
        linkUrl: `/portal/shipments/orders/${i.orderId}${i.shipmentId ? `?shipment=${i.shipmentId}` : ''}`,
        status: i.due! < today ? 'DUE' : 'SCHEDULED',
        notifiedAt: null,
        resolvedAt: null,
        updatedAt: null,
        stepId: i.stepId,
        overdue: i.state === 'overdue',
      }));
  }

  /** The order page's Overall process: one column per record (order, then each live shipment), one row per step. */
  async orderProcess(organizationId: string, orderId: string, today = tradeToday()) {
    const o: any = await this.prisma.tradeOrder.findFirst({ where: { id: orderId, organizationId }, select: ORDER });
    if (!o) throw new NotFoundException('Order not found');
    const dueOn = await this.enabled(organizationId);
    const items = this.itemsOf([o], await this.settings(organizationId), today, dueOn);
    // 出庫・納入依頼書 delivery rows (納入日) per shipment, for the schedule line.
    const sis: Array<{ shipmentId: string | null; rows: unknown }> = o.shipments.length
      ? await this.prisma.tradeGeneratedDoc.findMany({ where: { organizationId, shipmentId: { in: o.shipments.map((s: any) => s.id) }, docType: 'SHIPPING_INSTRUCTIONS' }, select: { shipmentId: true, rows: true } })
      : [];
    const deliveries = (id: string) =>
      [...new Set(sis.filter((g) => g.shipmentId === id).flatMap((g) => (Array.isArray(g.rows) ? (g.rows as Array<{ deliveryDate?: unknown }>) : []).map((r) => (typeof r?.deliveryDate === 'string' ? r.deliveryDate.trim() : '')).filter(Boolean)))].sort();
    const columns = [
      { kind: 'order' as const, id: o.id, ref: `#${o.orderNo}`, status: o.status, schedule: null },
      ...o.shipments.map((s: any) => ({
        kind: 'shipment' as const,
        id: s.id,
        ref: shipmentRef(o.orderNo, s.seqNo),
        status: s.status,
        schedule: { etd: dayOf(s.etd), tsPort: s.tsPort ?? null, tsEta: dayOf(s.tsEta), tsEtd: dayOf(s.tsEtd), eta: dayOf(s.eta), arrived: dayOf(s.actualArrivalDate) ?? dayOf(s.dischargeDate), deliveries: deliveries(s.id) },
      })),
    ];
    const order = (no: string) => {
      const m = /^(\d+)([a-z]*)/i.exec(no);
      return m ? Number(m[1]) + (m[2] ? m[2].toLowerCase().charCodeAt(0) / 1000 : 0) : 999;
    };
    const nos = [...new Map(items.map((i) => [i.no || i.code, { no: i.no, code: i.code, title: i.title, titleJa: i.titleJa }])).values()].sort((a, b) => order(a.no) - order(b.no));
    const rows = nos.map((r) => ({ ...r, cells: Object.fromEntries(items.filter((i) => (i.no || i.code) === (r.no || r.code)).map((i) => [i.recordId, i])) }));
    return { today, dueDates: dueOn, columns, rows, overdue: items.filter((i) => i.state === 'overdue').length };
  }

  /** Set (YYYY-MM-DD) or clear (null → back to the rule) one step's due date. */
  async setDue(organizationId: string, stepId: string, value: unknown, actor: TradeActor) {
    const s = await this.prisma.tradeStep.findFirst({ where: { id: stepId, organizationId }, select: { id: true, dueAt: true, code: true, orderId: true, shipmentId: true, shipment: { select: { orderId: true } } } });
    if (!s) throw new NotFoundException('Step not found');
    if (!(await this.enabled(organizationId))) throw new BadRequestException('Due dates are not switched on for this organization');
    if (value !== null && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))) throw new BadRequestException('dueAt must be a date (YYYY-MM-DD) or null');
    const next = value === null ? null : new Date(`${value}T00:00:00Z`);
    await this.prisma.tradeStep.update({
      where: { id: stepId },
      data: next ? { dueAt: next, dueSetById: actor?.id ?? null, dueSetByName: actor?.name ?? null, dueSetAt: new Date() } : { dueAt: null, dueSetById: null, dueSetByName: null, dueSetAt: null },
    });
    return { stepId, from: dayOf(s.dueAt), to: value, orderId: s.orderId ?? s.shipment?.orderId ?? null };
  }
}
