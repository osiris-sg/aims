/**
 * Round BN — 請求書 layout (seal / From block placement): read, save (org default or one customer) and preview on a
 * real invoice of the customer. Used by Clients › Document formats › 請求書 › Layout and by AIMEE's
 * invoice_layout Confirm card — one write path, logged with before → after.
 */
import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { ActionLogService } from '../action-log/action-log.service';
import { PrismaService } from '../common/prisma.service';
import { TradeActor } from './shipments.request';
import { TradeConfigService } from './trade-config.service';
import { GENERATED_TEMPLATES, TradeGeneratedService } from './trade-generated.service';
import { DocDefaults } from './trade-invoice';
import {
  applyLayoutChange,
  cleanInvoiceLayout,
  DEFAULT_INVOICE_LAYOUT,
  describeLayoutChange,
  InvoiceLayout,
  LAYOUT_LIMITS,
  layoutDiff,
  LayoutChange,
  readInvoiceLayout,
  resolveInvoiceLayout,
  SINGLE_INVOICE_LAYOUT,
} from './trade-invoice-layout';
import { CustomerProfile, profileFor } from './trade-profile';
import { isHoeiLayout } from './trade-hoei-formats';

export type LayoutScope = 'org' | 'customer';
const INVOICE_TYPES = ['INVOICE_1', 'INVOICE_2', 'INVOICE_SINGLE'];
const bad = (m: string): never => {
  throw new BadRequestException(m);
};

export interface InvoiceLayoutView {
  /** The built-in placement for this customer's 請求書 (two-stage vs single). */
  builtIn: InvoiceLayout;
  /** Saved values (partial; null = none). */
  org: Partial<InvoiceLayout> | null;
  customer: Partial<InvoiceLayout> | null;
  /** In force for this customer. */
  effective: InvoiceLayout;
  /** In force for the org (no customer override). */
  orgEffective: InvoiceLayout;
  limits: typeof LAYOUT_LIMITS;
  billing: 'TWO_STAGE' | 'SINGLE';
  /** This customer's invoices to preview on (drafts first, newest first). */
  docs: Array<{ id: string; docType: string; status: string; number: string | null; orderNo: number | null; createdAt: string }>;
}

@Injectable()
export class TradeInvoiceLayoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TradeConfigService,
    private readonly generated: TradeGeneratedService,
    @Optional() private readonly actionLog?: ActionLogService,
  ) {}

  private async customer(organizationId: string, customerId: string): Promise<{ id: string; name: string; profile: CustomerProfile }> {
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, organizationId }, select: { id: true, name: true } });
    if (!c) throw new NotFoundException('Customer not found');
    return { ...c, profile: await this.config.profileOf(organizationId, customerId) };
  }

  private async orgLayout(organizationId: string): Promise<Partial<InvoiceLayout> | null> {
    const s = await this.config.getSettings(organizationId);
    return readInvoiceLayout((s.docDefaults as DocDefaults | undefined)?.invoiceLayout);
  }

  private baseFor(p: CustomerProfile): InvoiceLayout {
    return p.billingMode === 'SINGLE' ? SINGLE_INVOICE_LAYOUT : DEFAULT_INVOICE_LAYOUT;
  }

  /** The customer's 請求書 documents (any status), drafts first. */
  private async invoiceDocs(organizationId: string, customerId: string): Promise<InvoiceLayoutView['docs']> {
    const rows: any[] = await this.prisma.tradeGeneratedDoc.findMany({
      where: {
        organizationId,
        docType: { in: INVOICE_TYPES },
        OR: [{ order: { customerId } }, { shipment: { customerId } }, { shipment: { order: { customerId } } }, { contract: { customerId } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, docType: true, status: true, number: true, createdAt: true, order: { select: { orderNo: true } }, shipment: { select: { order: { select: { orderNo: true } } } } },
    });
    return rows
      .map((r) => ({ id: r.id, docType: r.docType, status: r.status, number: r.number ?? null, orderNo: r.order?.orderNo ?? r.shipment?.order?.orderNo ?? null, createdAt: new Date(r.createdAt).toISOString() }))
      .sort((a, b) => Number(a.status !== 'DRAFT') - Number(b.status !== 'DRAFT') || b.createdAt.localeCompare(a.createdAt));
  }

  async view(organizationId: string, customerId: string): Promise<InvoiceLayoutView> {
    const c = await this.customer(organizationId, customerId);
    const org = await this.orgLayout(organizationId);
    const cust = readInvoiceLayout(c.profile.docFormats?.INVOICE?.layout);
    const base = this.baseFor(c.profile);
    return {
      builtIn: base,
      org,
      customer: cust,
      effective: resolveInvoiceLayout(org, cust, base),
      orgEffective: resolveInvoiceLayout(org, null, base),
      limits: LAYOUT_LIMITS,
      billing: c.profile.billingMode === 'SINGLE' ? 'SINGLE' : 'TWO_STAGE',
      docs: await this.invoiceDocs(organizationId, customerId),
    };
  }

  /**
   * Save a scope's layout. `layout` = the values to store for that scope (partial; null / {} = clear it, so the scope
   * inherits). The org default applies to every customer without their own value. Logged with before → after.
   */
  async save(organizationId: string, scope: LayoutScope, customerId: string | null, layout: unknown, actor: TradeActor, via?: string): Promise<{ before: InvoiceLayout; after: InvoiceLayout; changes: string[] }> {
    const next = cleanInvoiceLayout(layout, bad);
    if (scope === 'customer') {
      if (!customerId) throw new BadRequestException('Pick a customer');
      const c = await this.customer(organizationId, customerId);
      const org = await this.orgLayout(organizationId);
      const base = this.baseFor(c.profile);
      const before = resolveInvoiceLayout(org, readInvoiceLayout(c.profile.docFormats?.INVOICE?.layout), base);
      // The customer's own values are stored as given (an explicit override); null / {} = follow the org default again.
      const after = resolveInvoiceLayout(org, next, base);
      await this.writeCustomerLayout(organizationId, customerId, next);
      const changes = describeLayoutChange(before, after);
      this.log(organizationId, actor, customerId, c.name, scope, before, after, changes, via);
      return { before, after, changes };
    }
    const cur = await this.orgLayout(organizationId);
    const before = resolveInvoiceLayout(cur);
    const after = resolveInvoiceLayout(next);
    const own = layoutDiff(DEFAULT_INVOICE_LAYOUT, after);
    await this.config.updateSettings(organizationId, { docDefaults: { invoiceLayout: Object.keys(own).length ? own : null } } as any);
    const changes = describeLayoutChange(before, after);
    this.log(organizationId, actor, null, 'All customers (org default)', scope, before, after, changes, via);
    return { before, after, changes };
  }

  /** A relative / absolute change on top of what is in force for the scope (AIMEE: "move the stamp 8 mm right"). */
  async plan(organizationId: string, scope: LayoutScope, customerId: string | null, change: LayoutChange): Promise<{ before: InvoiceLayout; after: InvoiceLayout; store: Partial<InvoiceLayout>; changes: string[]; changesJa: string[]; customerName: string | null }> {
    if (scope === 'customer') {
      if (!customerId) throw new BadRequestException('Pick a customer');
      const c = await this.customer(organizationId, customerId);
      const org = await this.orgLayout(organizationId);
      const base = this.baseFor(c.profile);
      const before = resolveInvoiceLayout(org, readInvoiceLayout(c.profile.docFormats?.INVOICE?.layout), base);
      const after = applyLayoutChange(before, change);
      return { before, after, store: after, changes: describeLayoutChange(before, after), changesJa: describeLayoutChange(before, after, 'ja'), customerName: c.name };
    }
    const before = resolveInvoiceLayout(await this.orgLayout(organizationId));
    const after = applyLayoutChange(before, change);
    return { before, after, store: layoutDiff(DEFAULT_INVOICE_LAYOUT, after), changes: describeLayoutChange(before, after), changesJa: describeLayoutChange(before, after, 'ja'), customerName: null };
  }

  /**
   * Preview a candidate layout on one of the customer's real invoices (its stored header and lines, DRAFT watermark).
   * `layout` = the full placement to show (the editor's values); omitted = what is in force. Read-only.
   */
  async preview(organizationId: string, customerId: string, docId: string, layout?: unknown): Promise<{ html: string }> {
    const c = await this.customer(organizationId, customerId);
    const docs = await this.invoiceDocs(organizationId, customerId);
    if (!docs.some((d) => d.id === docId)) throw new BadRequestException("That invoice isn't this customer's");
    const g: any = await this.prisma.tradeGeneratedDoc.findFirst({ where: { id: docId, organizationId }, select: { docType: true, header: true, columns: true, rows: true } });
    if (!g) throw new NotFoundException('Invoice not found');
    const kind = GENERATED_TEMPLATES[g.docType]?.kind;
    if (kind !== 'invoice' && kind !== 'single') throw new BadRequestException('Not a 請求書');
    if (isHoeiLayout(g.header)) throw new BadRequestException("Hoei's USD invoice has no seal to place");
    const base = this.baseFor(c.profile);
    const candidate = layout === undefined || layout === null ? null : cleanInvoiceLayout(layout, bad);
    const printLayout = candidate ? resolveInvoiceLayout(null, candidate, base) : resolveInvoiceLayout(await this.orgLayout(organizationId), readInvoiceLayout(c.profile.docFormats?.INVOICE?.layout), base);
    const seal = await this.generated.sealFor(organizationId);
    return { html: this.generated.render(g.docType, { ...(g.header ?? {}), printLayout }, g.columns ?? [], g.rows ?? [], { draft: true, seal }) };
  }

  /** profile.docFormats.INVOICE.layout, written straight to the stored profile (as the SI settings). */
  private async writeCustomerLayout(organizationId: string, customerId: string, layout: Partial<InvoiceLayout> | null) {
    const row = await this.prisma.tradeSetting.findUnique({ where: { organizationId }, select: { id: true, customerProfiles: true } });
    const profiles = (row?.customerProfiles as unknown as Record<string, CustomerProfile> | null) ?? {};
    const p = profiles[customerId] ?? profileFor({}, customerId);
    const formats = { ...(p.docFormats ?? {}) };
    const cur = { ...(formats.INVOICE ?? {}) };
    if (layout) cur.layout = layout;
    else delete cur.layout;
    if (Object.keys(cur).length) formats.INVOICE = cur;
    else delete formats.INVOICE;
    const next = { ...profiles, [customerId]: { ...p, docFormats: formats } };
    if (row) await this.prisma.tradeSetting.update({ where: { organizationId }, data: { customerProfiles: next as any } });
    else await this.prisma.tradeSetting.create({ data: { organizationId, customerProfiles: next as any } });
  }

  /** AIMEE's writes get their own Activity Log row (a portal save is logged by the interceptor with actionLogResult). */
  private log(organizationId: string, actor: TradeActor, customerId: string | null, name: string, scope: LayoutScope, before: InvoiceLayout, after: InvoiceLayout, changes: string[], via?: string) {
    if (!via) return;
    void this.actionLog
      ?.log({
        actorType: 'USER',
        actorId: actor.id ?? 'unknown',
        actorName: actor.name ?? null,
        organizationId,
        channel: `chat:${via}`,
        method: 'TOOL',
        path: '/trade-clients/invoice-layout',
        action: 'UPDATE',
        resource: 'InvoiceLayout',
        resourceId: customerId ?? 'org-default',
        details: { name, scope, before, after, changes, via },
      } as any)
      .catch(() => null);
  }
}
