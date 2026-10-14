import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { LinkTradeDocumentDto } from './dto/trade-document.dto';
import { documentLinkState, parseIdList } from './shipments.rules';
import { TradeActor } from './shipments.request';
import { Db, DOC_LINK_SELECT, documentSummary, isVoided, TradeConfigService, TradeOwner } from './trade-config.service';
import { ownerOf, ownersOfTargets, TradeFilesService } from './trade-files.service';

/** Sales document types an in-app trade invoice can be. */
export const INVOICE_DOCUMENT_TYPES = ['INVOICE', 'TI', 'TI2'];

/**
 * In-app Sales Documents (invoices) counted as trade documents on contracts /
 * shipments. Same link rules as files: targets must be OPEN, and removing a
 * link may not leave a DONE step without its required type.
 */
@Injectable()
export class TradeDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: TradeConfigService,
    private readonly files: TradeFilesService,
  ) {}

  async link(organizationId: string, dto: LinkTradeDocumentDto, actor: TradeActor | null = null) {
    const contractIds = parseIdList(dto.contractIds);
    const shipmentIds = parseIdList(dto.shipmentIds);
    const docType = (dto.docType || '').trim();
    if (!contractIds.length && !shipmentIds.length && !dto.stepId) {
      throw new BadRequestException('Give at least one contract, shipment or step to link');
    }
    let owners: TradeOwner[] = [];
    await this.prisma.$transaction(async (tx: Db) => {
      await this.config.assertActiveDocType(organizationId, docType, tx);
      const doc = await tx.document.findFirst({
        where: { id: dto.documentId, organizationId },
        select: { id: true, name: true, config: true },
      });
      if (!doc) throw new BadRequestException('Document not found in this organization');
      if (isVoided(doc.config)) throw new BadRequestException(`${doc.name ?? 'This document'} is voided and can't be linked`);
      const targets = await this.files.resolveTargets(tx, organizationId, contractIds, shipmentIds, dto.stepId);
      const existing: Array<{ id: string; contractId: string | null; shipmentId: string | null; stepId: string | null }> = await tx.tradeDocumentLink.findMany({
        where: { organizationId, documentId: doc.id },
        select: { id: true, contractId: true, shipmentId: true, stepId: true },
      });
      const stepFor = (ownerId: string) => (targets.step && (targets.step.contractId ?? targets.step.shipmentId) === ownerId ? targets.step.id : null);
      owners = ownersOfTargets(targets);
      const rowsFor = [
        ...targets.contracts.map((c) => ({ contractId: c.id, shipmentId: null })),
        ...targets.shipments.map((s) => ({ contractId: null, shipmentId: s.id })),
      ];
      for (const o of rowsFor) {
        const ownerId = (o.contractId ?? o.shipmentId) as string;
        const prior = existing.find((l) => (l.contractId ?? l.shipmentId) === ownerId);
        const stepId = stepFor(ownerId);
        if (prior) {
          // Already linked here: retag it (doc type / step) instead of duplicating.
          await tx.tradeDocumentLink.update({ where: { id: prior.id, organizationId }, data: { docType, ...(stepId ? { stepId } : {}) } });
        } else {
          await tx.tradeDocumentLink.create({ data: { organizationId, documentId: doc.id, docType, ...o, stepId } });
        }
      }
    });
    // A confirmed invoice completes the step that needs it (a draft doesn't count yet).
    await this.config.syncSteps(this.prisma, organizationId, owners, actor, { docTypes: [docType] });
    const rows = await this.prisma.tradeDocumentLink.findMany({
      where: { organizationId, documentId: dto.documentId },
      orderBy: { createdAt: 'asc' },
      select: DOC_LINK_SELECT,
    });
    return this.config.describeDocLinks(this.prisma, organizationId, rows);
  }

  async unlink(organizationId: string, linkId: string) {
    await this.prisma.$transaction(async (tx: Db) => {
      const link = await tx.tradeDocumentLink.findFirst({
        where: { id: linkId, organizationId },
        select: {
          id: true,
          contractId: true,
          shipmentId: true,
          contract: { select: { contractNo: true, status: true } },
          shipment: { select: { blNumber: true, status: true } },
        },
      });
      if (!link) throw new NotFoundException('Document link not found');
      await this.config.assertRemovalKeepsDoneSteps(tx, organizationId, [ownerOf(link)], { docLinkId: linkId }, 'unlink this invoice');
      await tx.tradeDocumentLink.delete({ where: { id: linkId, organizationId } });
    });
    return { id: linkId, deleted: true };
  }

  /** Invoices for "Link existing invoice": by number, or by customer name. Voided ones are left out. */
  async searchInvoices(organizationId: string, q?: string) {
    const term = (q ?? '').trim();
    const docs: Array<{ id: string; name: string | null; type: string; status: string; config: any; createdAt: Date; documentTemplateId: string }> = await this.prisma.document.findMany({
      where: {
        organizationId,
        type: { in: INVOICE_DOCUMENT_TYPES },
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' as const } },
                { config: { path: ['customer', 'name'], string_contains: term } },
                { config: { path: ['customerName'], string_contains: term } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: { id: true, name: true, type: true, status: true, config: true, createdAt: true, documentTemplateId: true },
    });
    const fallbackCurrency = await this.config.defaultCurrency(organizationId);
    return docs
      .filter((d) => !isVoided(d.config))
      .map((d) => ({ ...documentSummary(d, fallbackCurrency), countsForSteps: documentLinkState(d).satisfies }));
  }
}
