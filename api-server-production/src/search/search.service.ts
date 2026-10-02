import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { resolveTier } from '../common/role-tier';

// Global search (guru 2026-10-03, "like Xero's top-right search"): one query
// across documents, projects, customers, suppliers and leads — grouped, with
// enough context on each hit to recognise it. Org-scoped always; projects and
// leads additionally tier-scoped exactly like their list pages.
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(organizationId: string, q: string, callerUserId?: string) {
    const term = (q || '').trim();
    if (term.length < 2) return { q: term, documents: [], projects: [], customers: [], suppliers: [], leads: [] };
    const contains = { contains: term, mode: 'insensitive' as const };
    const digits = term.replace(/\D/g, '');

    const scope = await resolveTier(this.prisma, organizationId, callerUserId);
    const projWhere: any = { organizationId };
    if (scope.tier === 'designer') projWhere.designerUserId = callerUserId;
    else if (scope.tier === 'junior') projWhere.designerUserId = { in: scope.teamUserIds || [callerUserId] };
    const leadWhere: any = { organizationId };
    if (scope.tier === 'designer') leadWhere.assignedToUserId = callerUserId;
    else if (scope.tier === 'junior') leadWhere.assignedToUserId = { in: scope.teamUserIds || [] };

    const [documents, projects, customers, suppliers, leads] = await Promise.all([
      this.prisma.document.findMany({
        where: {
          organizationId,
          name: contains,
          // Designer tier: only their own documents surface (same rule as the
          // ID quotation list — owned, designer-picked, or on their project).
          ...(scope.tier === 'designer'
            ? { OR: [{ project: { designerUserId: callerUserId } }, { config: { path: ['quote', 'header', 'designerUserId'], equals: callerUserId } }] }
            : scope.tier === 'junior'
              ? { OR: [{ project: { designerUserId: { in: scope.teamUserIds || [] } } }, { projectId: null }] }
              : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { id: true, name: true, type: true, status: true, createdAt: true, projectId: true, documentTemplateId: true, config: true },
      }),
      this.prisma.project.findMany({
        where: { ...projWhere, OR: [{ name: contains }, { address: contains }] },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, name: true, address: true, stage: true, status: true, designer: true },
      }),
      this.prisma.customer.findMany({
        where: { organizationId, OR: [{ name: contains }, { customerCode: contains }, { email: contains }, ...(digits ? [{ phone: { contains: digits } }] : [])] },
        take: 5,
        select: { id: true, name: true, customerCode: true, phone: true, email: true },
      }),
      this.prisma.supplier.findMany({
        where: { organizationId, OR: [{ name: contains }, { supplierCode: contains }] },
        take: 5,
        select: { id: true, name: true, supplierCode: true },
      }),
      this.prisma.lead.findMany({
        where: {
          ...leadWhere,
          OR: [{ name: contains }, { ref: contains }, ...(digits ? [{ phone: { contains: digits } }, { whatsappPhone: { contains: digits } }, { phones: { has: digits } }] : [])],
        },
        orderBy: { receivedAt: 'desc' },
        take: 5,
        select: { id: true, name: true, phone: true, status: true, source: true, assignedToName: true },
      }),
    ]);

    const num = (v: any) => (isFinite(Number(v)) ? Number(v) : null);
    return {
      q: term,
      documents: documents.map((d) => {
        const cfg: any = d.config || {};
        return {
          id: d.id,
          number: d.name,
          type: d.type,
          status: d.status,
          customer: cfg.quote?.header?.clientName || cfg.customerName || cfg.customer?.name || null,
          total: num(cfg.documentInfo?.grandTotal) ?? num(cfg.nettTotal) ?? num(cfg.documentInfo?.nettTotal),
          createdAt: d.createdAt,
          projectId: d.projectId,
          templateId: d.documentTemplateId,
          isIdQuote: String(cfg.templateVariant || '').toUpperCase() === 'ID' || !!cfg.quote,
        };
      }),
      projects: projects.map((p) => ({ id: p.id, name: p.name, address: p.address, stage: p.stage, status: p.status, designer: p.designer })),
      customers,
      suppliers,
      leads,
    };
  }
}
