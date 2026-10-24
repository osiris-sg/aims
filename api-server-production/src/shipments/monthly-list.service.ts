/**
 * Round AG — the Monthly order list: reads orders (test / cancelled left out), their shipments, steps and supplier side,
 * and hands them to the pure builder (monthly-list.ts). The .xlsx (their layout) and CSV come from the same rows; the
 * WhatsApp tool sends a summary + the .xlsx. 管理NO is ADH's client-order number (#n-s), computed.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { TradeConfigService } from './trade-config.service';
import { currentStepOf, tradeToday } from './shipments.rules';
import { buildMonthlyList, cleanMonths, MonthBasis, MonthlyBlock, monthlyCsv, monthlySummary, OrderFact, OrderStatusWord } from './monthly-list';
import { monthlyXlsx } from './monthly-list.xlsx';

export interface MonthlyQuery {
  from?: string;
  to?: string;
  basis?: string;
  customerId?: string;
  supplier?: string;
  grade?: string;
  status?: string;
}

const STEP = { id: true, code: true, title: true, displayNo: true, sortOrder: true, status: true, isOngoing: true, notApplicable: true };
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

@Injectable()
export class MonthlyListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TradeConfigService,
  ) {}

  filterOf(q: MonthlyQuery, today = tradeToday()) {
    const { from, to } = cleanMonths(q.from, q.to, today);
    const basis: MonthBasis = q.basis === 'ship' ? 'ship' : 'delivery';
    const status = (['Open', 'Completed', 'Unconfirmed'] as OrderStatusWord[]).find((s) => s.toLowerCase() === String(q.status ?? '').toLowerCase()) ?? null;
    return { from, to, basis, customerId: q.customerId || null, supplier: q.supplier?.trim() || null, grade: q.grade?.trim() || null, status };
  }

  /** The facts of every live, non-test order whose months could touch the window (a little wider: shipments may differ). */
  async facts(organizationId: string): Promise<OrderFact[]> {
    const settings = await this.config.getSettings(organizationId);
    const keyOf = (customerId: string) => ((settings.customerProfiles?.[customerId] as { key?: string } | undefined)?.key ?? null)?.toUpperCase() ?? null;
    const orders: any[] = await this.prisma.tradeOrder.findMany({
      where: { organizationId, isTest: false, status: { not: 'CANCELLED' } },
      select: {
        id: true,
        orderNo: true,
        status: true,
        checkFields: true,
        customerId: true,
        createdAt: true,
        customerPoNo: true,
        customerPoDate: true,
        grade: true,
        size: true,
        qtyMt: true,
        shipMonth: true,
        deliveryMonth: true,
        piDate: true,
        customer: { select: { name: true } },
        supplier: { select: { name: true } },
        contract: { select: { contractNo: true, piDate: true } },
        supplierOrder: { select: { status: true, piDate: true, qtyMt: true, contract: { select: { contractNo: true } }, steps: { select: STEP } } },
        steps: { select: STEP },
        shipments: { where: { status: { not: 'CANCELLED' } }, select: { id: true, seqNo: true, status: true, blNumber: true, etd: true, eta: true, deliveryMonth: true, steps: { select: STEP } } },
      },
    });
    return orders.map((o) => {
      const piSteps = [...(o.supplierOrder?.steps ?? []), ...(o.steps ?? [])].filter((s: any) => s.code === 'PI_PAYMENT');
      const orderCurrent = currentStepOf([...(o.supplierOrder?.steps ?? []), ...(o.steps ?? [])]);
      const orderStepId = orderCurrent ? ([...(o.supplierOrder?.steps ?? []), ...(o.steps ?? [])].find((s: any) => s.code === orderCurrent.code)?.id ?? null) : null;
      return {
        id: o.id,
        orderNo: o.orderNo,
        status: o.status,
        checkFields: o.checkFields ?? [],
        customerId: o.customerId,
        customerName: o.customer?.name ?? '—',
        customerPoNo: o.customerPoNo ?? null,
        customerKey: keyOf(o.customerId),
        supplierName: o.supplier?.name ?? '—',
        orderDate: o.customerPoDate ?? o.createdAt,
        grade: o.grade,
        size: o.size,
        qtyMt: num(o.qtyMt),
        shipMonth: o.shipMonth,
        deliveryMonth: o.deliveryMonth,
        supplierContractNo: o.contract?.contractNo ?? o.supplierOrder?.contract?.contractNo ?? null,
        piDate: o.supplierOrder?.piDate ?? o.piDate ?? o.contract?.piDate ?? null,
        piQtyMt: num(o.supplierOrder?.qtyMt ?? o.qtyMt),
        supplierDone: o.supplierOrder ? o.supplierOrder.status === 'COMPLETED' && o.status === 'COMPLETED' : o.status === 'COMPLETED',
        piPayment: piSteps,
        currentStepId: orderStepId,
        shipments: (o.shipments ?? []).map((s: any) => {
          const cur = currentStepOf(s.steps ?? []);
          return {
            id: s.id,
            seqNo: s.seqNo,
            status: s.status,
            blNumber: s.blNumber,
            etd: s.etd,
            eta: s.eta,
            deliveryMonth: s.deliveryMonth,
            currentStep: cur ? { id: (s.steps ?? []).find((x: any) => x.code === cur.code)?.id ?? null, label: cur.label, code: cur.code } : null,
            ciPayment: (s.steps ?? []).filter((x: any) => x.code === 'CI_PAYMENT'),
          };
        }),
      } satisfies OrderFact;
    });
  }

  async list(organizationId: string, q: MonthlyQuery) {
    const f = this.filterOf(q);
    const facts = await this.facts(organizationId);
    const blocks = buildMonthlyList(facts, f);
    // The filter choices come from every live order (not only the window), so a filter never empties its own menu.
    const options = {
      clients: [...new Map(facts.map((o) => [o.customerId, { id: o.customerId, name: buildMonthlyList([o], { from: '0000-01', to: '9999-12', basis: 'delivery' })[0]?.client ?? o.customerName }])).values()].sort((a, b) => a.name.localeCompare(b.name)),
      suppliers: [...new Set(facts.map((o) => buildMonthlyList([o], { from: '0000-01', to: '9999-12', basis: 'delivery' })[0]?.rows[0]?.supplier).filter((x): x is string => !!x))].sort(),
      grades: [...new Set(facts.map((o) => (o.grade ?? '').trim()).filter(Boolean))].sort(),
    };
    return { filter: f, blocks, options, totals: { orders: blocks.reduce((a, b) => a + b.orders, 0), rows: blocks.reduce((a, b) => a + b.rows.length, 0), tons: blocks.reduce((a, b) => a + b.tons, 0) } };
  }

  private async orgName(organizationId: string) {
    const o = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
    return o?.name ?? 'AIMS';
  }

  /** The export in their layout: .xlsx (styled) or CSV. */
  async export(organizationId: string, q: MonthlyQuery, format: 'xlsx' | 'csv'): Promise<{ fileName: string; contentType: string; buffer: Buffer; blocks: MonthlyBlock[]; filter: ReturnType<MonthlyListService['filterOf']> }> {
    const f = this.filterOf(q);
    const blocks = buildMonthlyList(await this.facts(organizationId), f);
    const name = `Monthly order list ${f.from}${f.to !== f.from ? `_${f.to}` : ''}`;
    if (format === 'csv') return { fileName: `${name}.csv`, contentType: 'text/csv; charset=utf-8', buffer: Buffer.from(monthlyCsv(blocks), 'utf8'), blocks, filter: f };
    const buffer = await monthlyXlsx(blocks, { orgName: await this.orgName(organizationId), from: f.from, to: f.to, basis: f.basis, generatedAt: new Date() });
    return { fileName: `${name}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer, blocks, filter: f };
  }

  summary(blocks: MonthlyBlock[], f: ReturnType<MonthlyListService['filterOf']>, lang: 'en' | 'ja' = 'en') {
    return monthlySummary(blocks, f, lang);
  }
}
