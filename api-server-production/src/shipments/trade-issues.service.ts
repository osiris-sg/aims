/**
 * Round AR — general issues on a customer / supplier (Clients profile, the order, a banner on the affected shipments'
 * steps). An issue comes from an email ("Not one shipment: general issue" in the Answer flow) or is added by hand.
 * Never deleted: resolved.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { TradeActor } from './shipments.request';

export type IssueStatus = 'OPEN' | 'RESOLVED';

export interface IssueInput {
  title?: unknown;
  summaryEn?: unknown;
  summaryJa?: unknown;
  customerId?: unknown;
  supplierId?: unknown;
  orderIds?: unknown;
  shipmentIds?: unknown;
  emailLogIds?: unknown;
  docTypes?: unknown;
  effectiveFrom?: unknown;
  status?: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && UUID.test(x)))].slice(0, 50) : []);
const docTypes = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && /^[A-Z0-9_]{2,40}$/.test(x)))].slice(0, 10) : []);

/** Pure: clean an issue body (create = title required; update = only the fields given). */
export function cleanIssue(b: IssueInput, mode: 'create' | 'update') {
  const out: Record<string, unknown> = {};
  const has = (k: keyof IssueInput) => b && Object.prototype.hasOwnProperty.call(b, k);
  if (mode === 'create' || has('title')) {
    const t = text(b?.title, 200);
    if (!t) throw new BadRequestException('A title is required');
    out.title = t;
  }
  if (has('summaryEn')) out.summaryEn = text(b.summaryEn, 4000);
  if (has('summaryJa')) out.summaryJa = text(b.summaryJa, 4000);
  if (has('effectiveFrom')) out.effectiveFrom = text(b.effectiveFrom, 80);
  if (has('customerId')) out.customerId = typeof b.customerId === 'string' && b.customerId ? b.customerId : null;
  if (has('supplierId')) out.supplierId = typeof b.supplierId === 'string' && b.supplierId ? b.supplierId : null;
  if (has('orderIds')) out.orderIds = ids(b.orderIds);
  if (has('shipmentIds')) out.shipmentIds = ids(b.shipmentIds);
  if (has('emailLogIds')) out.emailLogIds = ids(b.emailLogIds);
  if (has('docTypes')) out.docTypes = docTypes(b.docTypes);
  if (has('status')) {
    if (b.status !== 'OPEN' && b.status !== 'RESOLVED') throw new BadRequestException('status must be OPEN or RESOLVED');
    out.status = b.status;
  }
  if (mode === 'create' && !out.customerId && !out.supplierId && !(out.orderIds as string[] | undefined)?.length && !(out.shipmentIds as string[] | undefined)?.length) {
    throw new BadRequestException('Link the issue to a customer, a supplier, an order or a shipment');
  }
  return out;
}

/**
 * Pure: does an open issue apply to this shipment? Linked shipments → only those; linked orders → their shipments;
 * else every shipment of the issue's customer / supplier. `docType` = a step's banner: only issues marked for it.
 */
export function issueApplies(
  issue: { status: string; shipmentIds: string[]; orderIds: string[]; customerId: string | null; supplierId: string | null; docTypes: string[] },
  s: { id: string; orderId: string | null; customerId: string | null; supplierId: string | null },
  docType?: string | null,
): boolean {
  if (issue.status !== 'OPEN') return false;
  // A step banner shows only the issues marked for that step (e.g. "Show on step 4 COA").
  if (docType && !issue.docTypes.includes(docType)) return false;
  if (issue.shipmentIds.length) return issue.shipmentIds.includes(s.id);
  if (issue.orderIds.length) return !!s.orderId && issue.orderIds.includes(s.orderId);
  return (!!issue.customerId && issue.customerId === s.customerId) || (!!issue.supplierId && issue.supplierId === s.supplierId);
}

@Injectable()
export class TradeIssuesService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertOwners(organizationId: string, data: Record<string, unknown>) {
    if (data.customerId && !(await this.prisma.customer.findFirst({ where: { id: data.customerId as string, organizationId }, select: { id: true } }))) throw new BadRequestException('Customer not found');
    if (data.supplierId && !(await this.prisma.supplier.findFirst({ where: { id: data.supplierId as string, organizationId }, select: { id: true } }))) throw new BadRequestException('Supplier not found');
    const o = (data.orderIds as string[] | undefined) ?? [];
    if (o.length && (await this.prisma.tradeOrder.count({ where: { organizationId, id: { in: o } } })) !== o.length) throw new BadRequestException('Order not found');
    const s = (data.shipmentIds as string[] | undefined) ?? [];
    if (s.length && (await this.prisma.shipment.count({ where: { organizationId, id: { in: s } } })) !== s.length) throw new BadRequestException('Shipment not found');
  }

  /** Refs and names for the list: "#18-2", the customer / supplier name, the email subjects. */
  private async shape(organizationId: string, rows: any[]) {
    const shipIds = [...new Set(rows.flatMap((r) => r.shipmentIds))];
    const orderIds = [...new Set(rows.flatMap((r) => r.orderIds))];
    const logIds = [...new Set(rows.flatMap((r) => r.emailLogIds))];
    const ships: any[] = shipIds.length ? await this.prisma.shipment.findMany({ where: { organizationId, id: { in: shipIds } }, select: { id: true, seqNo: true, blNumber: true, order: { select: { orderNo: true } } } }) : [];
    const orders: any[] = orderIds.length ? await this.prisma.tradeOrder.findMany({ where: { organizationId, id: { in: orderIds } }, select: { id: true, orderNo: true } }) : [];
    const logs: any[] = logIds.length ? await this.prisma.emailIngestLog.findMany({ where: { organizationId, id: { in: logIds } }, select: { id: true, subject: true, fromAddress: true, emailDate: true, createdAt: true } }) : [];
    const custIds = [...new Set(rows.map((r) => r.customerId).filter(Boolean))];
    const supIds = [...new Set(rows.map((r) => r.supplierId).filter(Boolean))];
    const custs: any[] = custIds.length ? await this.prisma.customer.findMany({ where: { organizationId, id: { in: custIds } }, select: { id: true, name: true } }) : [];
    const sups: any[] = supIds.length ? await this.prisma.supplier.findMany({ where: { organizationId, id: { in: supIds } }, select: { id: true, name: true } }) : [];
    const shipRef = (s: any) => (s.order?.orderNo ? `#${s.order.orderNo}-${s.seqNo ?? 1}` : s.blNumber ?? 'shipment');
    return rows.map((r) => ({
      ...r,
      customerName: custs.find((c) => c.id === r.customerId)?.name ?? null,
      supplierName: sups.find((c) => c.id === r.supplierId)?.name ?? null,
      shipments: r.shipmentIds.map((id: string) => ({ id, ref: (() => { const s = ships.find((x) => x.id === id); return s ? shipRef(s) : null; })() })),
      orders: r.orderIds.map((id: string) => ({ id, ref: (() => { const o = orders.find((x) => x.id === id); return o ? `#${o.orderNo}` : null; })() })),
      emails: r.emailLogIds.map((id: string) => {
        const l = logs.find((x) => x.id === id);
        return { id, subject: l?.subject ?? null, from: (/@([^>\s]+)/.exec(l?.fromAddress ?? '')?.[1] ?? '').toLowerCase() || null, date: l?.emailDate ?? l?.createdAt ?? null };
      }),
    }));
  }

  async list(organizationId: string, q: { customerId?: string; supplierId?: string; orderId?: string; shipmentId?: string; status?: string }) {
    const or: any[] = [];
    if (q.customerId) or.push({ customerId: q.customerId });
    if (q.supplierId) or.push({ supplierId: q.supplierId });
    if (q.orderId) or.push({ orderIds: { has: q.orderId } });
    if (q.shipmentId) or.push({ shipmentIds: { has: q.shipmentId } });
    // An order also shows its customer's / supplier's issues that are not tied to other orders / shipments.
    if (q.orderId) {
      const o = await this.prisma.tradeOrder.findFirst({ where: { id: q.orderId, organizationId }, select: { customerId: true, supplierId: true } });
      if (o) or.push({ orderIds: { isEmpty: true }, shipmentIds: { isEmpty: true }, OR: [{ customerId: o.customerId }, { supplierId: o.supplierId }] });
    }
    const rows = await this.prisma.tradeIssue.findMany({
      where: { organizationId, ...(or.length ? { OR: or } : {}), ...(q.status === 'OPEN' || q.status === 'RESOLVED' ? { status: q.status } : {}) },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
    return this.shape(organizationId, rows);
  }

  /** The open issues that apply to a shipment (the step banner); `docType` = the step's document (e.g. CUSTOMER_COA). */
  async forShipment(organizationId: string, shipmentId: string, docType?: string | null) {
    const s = await this.prisma.shipment.findFirst({ where: { id: shipmentId, organizationId }, select: { id: true, orderId: true, customerId: true, order: { select: { customerId: true, supplierId: true } } } });
    if (!s) throw new NotFoundException('Shipment not found');
    const ctx = { id: s.id, orderId: s.orderId, customerId: s.order?.customerId ?? s.customerId ?? null, supplierId: s.order?.supplierId ?? null };
    const open = await this.prisma.tradeIssue.findMany({ where: { organizationId, status: 'OPEN' }, orderBy: { createdAt: 'desc' }, take: 200 });
    return this.shape(organizationId, open.filter((i) => issueApplies(i, ctx, docType)));
  }

  async create(organizationId: string, body: IssueInput, actor: TradeActor) {
    const data = cleanIssue(body, 'create');
    await this.assertOwners(organizationId, data);
    const row = await this.prisma.tradeIssue.create({ data: { organizationId, ...(data as any), status: (data.status as IssueStatus) ?? 'OPEN', createdById: actor.id, createdByName: actor.name } });
    return (await this.shape(organizationId, [row]))[0];
  }

  async update(organizationId: string, id: string, body: IssueInput, actor: TradeActor) {
    const cur = await this.prisma.tradeIssue.findFirst({ where: { id, organizationId } });
    if (!cur) throw new NotFoundException('Issue not found');
    const data = cleanIssue(body, 'update');
    await this.assertOwners(organizationId, data);
    const resolving = data.status === 'RESOLVED' && cur.status !== 'RESOLVED';
    const reopening = data.status === 'OPEN' && cur.status !== 'OPEN';
    const row = await this.prisma.tradeIssue.update({
      where: { id },
      data: { ...(data as any), ...(resolving ? { resolvedAt: new Date(), resolvedByName: actor.name } : {}), ...(reopening ? { resolvedAt: null, resolvedByName: null } : {}) },
    });
    return (await this.shape(organizationId, [row]))[0];
  }
}
