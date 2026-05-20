import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

/**
 * Orders are auto-created when a quotation is confirmed (gated by the
 * enableConfirmQuotation flag on the org). Each order holds a snapshot of the
 * quotation's items and acts as the parent container from which POs, DOs and
 * Invoices are spun off later. Status is intentionally free-form for v1 — no
 * auto-advance based on linked-doc states yet.
 */
@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Auto-create an Order from a confirmed quotation. Idempotent — if an order
   * already exists for this quotation we return the existing one instead of
   * making a duplicate. Items are deep-copied so later quotation edits don't
   * mutate the order's snapshot.
   */
  async createFromQuotation(quotationDocId: string, organizationId: string) {
    const existing = await this.prisma.order.findFirst({
      where: { sourceQuotationId: quotationDocId, organizationId },
    });
    if (existing) return existing;

    const quotation = await this.prisma.document.findFirst({
      where: { id: quotationDocId, organizationId },
      select: { id: true, name: true, config: true },
    });
    if (!quotation) {
      throw new HttpException('Source quotation not found', HttpStatus.NOT_FOUND);
    }

    const config: any = quotation.config || {};
    const items = Array.isArray(config.items) ? config.items : [];
    const customerId: string | null = config?.customer?.id ?? config?.customerId ?? null;

    const orderNumber = await this.nextOrderNumber(organizationId);

    return await this.prisma.order.create({
      data: {
        orderNumber,
        organizationId,
        customerId,
        sourceQuotationId: quotation.id,
        status: 'DRAFT',
        items: items as Prisma.InputJsonValue,
        linkedDocuments: { po: [], do: [], invoice: [] } as Prisma.InputJsonValue,
        notes: `Auto-created from quotation ${quotation.name}`,
      },
    });
  }

  async list(organizationId: string) {
    return this.prisma.order.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true, customerCode: true } },
        sourceQuotation: { select: { id: true, name: true, status: true, type: true, documentTemplateId: true } },
      },
    });
  }

  async getById(id: string, organizationId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, organizationId },
      include: {
        customer: { select: { id: true, name: true, customerCode: true, address: true } },
        sourceQuotation: { select: { id: true, name: true, status: true, type: true, documentTemplateId: true } },
      },
    });
    if (!order) throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    return order;
  }

  async updateStatus(id: string, organizationId: string, status: string) {
    return this.prisma.order.update({
      where: { id, organizationId },
      data: { status },
    });
  }

  /**
   * Append a linked document reference to the order's linkedDocuments bucket.
   * docKind is one of 'po' / 'do' / 'invoice'. Idempotent on the docId.
   */
  async linkDocument(
    orderId: string,
    organizationId: string,
    docKind: 'po' | 'do' | 'invoice',
    docRef: { id: string; name: string; templateId?: string; itemIds?: number[] },
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, organizationId },
      select: { linkedDocuments: true },
    });
    if (!order) throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    const bucket: any = (order.linkedDocuments as any) || { po: [], do: [], invoice: [] };
    const list: any[] = Array.isArray(bucket[docKind]) ? bucket[docKind] : [];
    if (!list.some((d) => d.id === docRef.id)) list.push(docRef);
    bucket[docKind] = list;
    return this.prisma.order.update({
      where: { id: orderId, organizationId },
      data: { linkedDocuments: bucket as Prisma.InputJsonValue },
    });
  }

  async delete(id: string, organizationId: string) {
    return this.prisma.order.delete({
      where: { id, organizationId },
    });
  }

  /**
   * Compute the next ORD-prefix number for this org. Mirrors the document
   * numbering scheme: ORD{YYYY}{MM}-{NNN}.
   */
  private async nextOrderNumber(organizationId: string): Promise<string> {
    const now = new Date();
    const prefix = `ORD${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`;
    const last = await this.prisma.order.findFirst({
      where: { organizationId, orderNumber: { startsWith: prefix } },
      orderBy: { orderNumber: 'desc' },
      select: { orderNumber: true },
    });
    let serial = 1;
    if (last?.orderNumber) {
      const match = last.orderNumber.match(/-(\d+)$/);
      if (match) serial = parseInt(match[1], 10) + 1;
    }
    return `${prefix}${String(serial).padStart(3, '0')}`;
  }
}
