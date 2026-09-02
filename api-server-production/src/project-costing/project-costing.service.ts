import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { S3Service } from '../common/services/s3.service';
import { BillsService } from '../bills/bills.service';
import { DocumentsService } from '../documents/documents.service';
import { ID_SCHEDULE_SEQUENCE, SG_PUBLIC_HOLIDAYS, buildWeeks, renderScheduleHtml } from './schedule';

const DEFAULT_ENGAGEMENT_FEE = 1500; // S$ — in lieu of the 10% deposit (their T&C clause A)

const QUOTATION_TYPES = ['QUOTATION', 'QO', 'QO1', 'QO2', 'QT'];
const DEFAULT_COMMISSION_PCT = 50;

// Their standard progressive schedule. The engagement-fee variant (S$1,500 in
// lieu of the 10%) is an edit on the seeded row, not a separate template.
const DEFAULT_MILESTONES = [
  { label: '10% on confirmation (or engagement fee)', pct: 10, dueTrigger: 'confirmation' },
  { label: '40% on commencement of works', pct: 40, dueTrigger: 'commencement' },
  { label: '45% on carpentry measurement (VOs fully paid)', pct: 45, dueTrigger: 'carpentry' },
  { label: '5% on handover & completion', pct: 5, dueTrigger: 'handover' },
];

export const ID_STAGES = ['signed', 'design', 'works', 'carpentry', 'handover', 'completed'] as const;

type CostDto = {
  date?: string | null;
  supplierName?: string | null;
  supplierId?: string | null;
  description: string;
  invoiceNo?: string | null;
  amount: number;
  sectionId?: string | null;
  attachmentUrl?: string | null;
  attachmentKey?: string | null;
  source?: string;
  status?: string;
  notes?: string | null;
};

type MilestoneDto = {
  kind?: string;
  label?: string;
  pct?: number | null;
  amount?: number;
  sortOrder?: number;
  dueTrigger?: string | null;
  paidAmount?: number;
  paidAt?: string | null;
  paymentMethod?: string | null;
  invoiceId?: string | null;
};

const num = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

@Injectable()
export class ProjectCostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly bills: BillsService,
    private readonly documents: DocumentsService,
  ) {}

  private async project(projectId: string, organizationId: string) {
    const p = await this.prisma.project.findFirst({ where: { id: projectId, organizationId } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  /** The signed (or latest) ID quotation on the project, with its totals. */
  private async contractQuotation(projectId: string, organizationId: string) {
    const docs = await this.prisma.document.findMany({
      where: { projectId, organizationId, type: { in: QUOTATION_TYPES } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      select: { id: true, name: true, status: true, config: true, createdAt: true },
    });
    const signed = docs.find((d) => d.status === 'confirmed') || docs[0];
    if (!signed) return null;
    const cfg: any = signed.config || {};
    return {
      id: signed.id,
      number: signed.name,
      status: signed.status,
      grandTotal: num(cfg?.documentInfo?.grandTotal),
      signedAt: cfg?.clientSignature?.signedAt || null,
      signedBy: cfg?.clientSignature?.name || null,
      designer: cfg?.quote?.header?.designer || null,
      clientName: cfg?.quote?.header?.clientName || cfg?.customer?.name || null,
      address: cfg?.quote?.header?.address || null,
      contact: cfg?.quote?.header?.contact || null,
      nric: cfg?.quote?.header?.nric || null,
      // cost provisioned per trade section in the quote (for the tally)
      provisions: this.provisionsBySection(cfg?.quote),
      isId: cfg?.templateVariant === 'ID' || !!cfg?.quote,
    };
  }

  private provisionsBySection(quote: any): Array<{ title: string; letter: string; quoted: number; cost: number }> {
    if (!quote?.sections) return [];
    return quote.sections.map((s: any) => {
      let quoted = 0;
      let cost = 0;
      for (const a of s.areas || []) {
        for (const it of a.items || []) {
          if (!it.pricingMode || it.pricingMode === 'priced') {
            quoted += num(it.amount) + (it.includes || []).reduce((x: number, i: any) => x + (i.pricingMode === 'priced' ? num(i.amount) : 0), 0);
          }
          cost += num(it.cost) + (it.includes || []).reduce((x: number, i: any) => x + num(i.cost), 0);
        }
      }
      return { title: s.title, letter: s.letter, quoted, cost };
    });
  }

  /** Seed the standard milestone schedule from a contract sum (idempotent). */
  async seedMilestones(projectId: string, organizationId: string, contractSum: number) {
    const existing = await this.prisma.projectMilestone.count({ where: { projectId, kind: 'milestone' } });
    if (existing > 0) return { created: 0 };
    await this.prisma.projectMilestone.createMany({
      data: DEFAULT_MILESTONES.map((m, i) => ({
        organizationId,
        projectId,
        kind: 'milestone',
        label: m.label,
        pct: m.pct,
        amount: Math.round(contractSum * m.pct) / 100,
        sortOrder: i,
        dueTrigger: m.dueTrigger,
      })),
    });
    return { created: DEFAULT_MILESTONES.length };
  }

  // ── the costing summary (one call for the project page) ────────────────
  async summary(projectId: string, organizationId: string) {
    const project = await this.project(projectId, organizationId);
    const [quotation, costs, rawMilestones, sections, customer, otherDocs] = await Promise.all([
      this.contractQuotation(projectId, organizationId),
      this.prisma.projectCost.findMany({ where: { projectId }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
      this.prisma.projectMilestone.findMany({ where: { projectId }, orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.workSection.findMany({ where: { organizationId }, orderBy: { sortOrder: 'asc' }, select: { id: true, letter: true, title: true } }),
      project.customerId ? this.prisma.customer.findFirst({ where: { id: project.customerId }, select: { id: true, name: true, phone: true, email: true, address: true } }) : null,
      this.prisma.document.findMany({
        where: { projectId, organizationId, type: { notIn: QUOTATION_TYPES } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, type: true, status: true, createdAt: true, documentTemplateId: true },
      }),
    ]);

    // Attach the progress-claim invoice (number / status / editor route) to each milestone.
    const invoiceIds = rawMilestones.map((m) => m.invoiceId).filter(Boolean) as string[];
    const invoices = invoiceIds.length
      ? await this.prisma.document.findMany({ where: { id: { in: invoiceIds }, organizationId }, select: { id: true, name: true, status: true, type: true, documentTemplateId: true } })
      : [];
    const invById = new Map(invoices.map((i) => [i.id, i]));
    const milestones = rawMilestones.map((m) => {
      const inv = m.invoiceId ? invById.get(m.invoiceId) : null;
      return { ...m, invoice: inv ? { id: inv.id, number: inv.name, status: inv.status, path: `/portal/documents/${inv.type}/${inv.documentTemplateId}/${inv.id}` } : null };
    });
    const deposit = rawMilestones.find((m) => m.kind === 'milestone' && m.dueTrigger === 'confirmation');
    const depositMode = deposit ? (deposit.pct == null ? 'engagement' : 'percent') : null;

    // Contract = signed quotation + VO milestones (VO documents come in Phase 3).
    const vos = milestones.filter((m) => m.kind === 'vo');
    const contractTotal = (quotation?.grandTotal || 0) + vos.reduce((s, m) => s + num(m.amount), 0);
    const refunds = milestones.filter((m) => m.kind === 'refund');
    const collected = milestones.filter((m) => m.kind !== 'refund').reduce((s, m) => s + num(m.paidAmount), 0) - refunds.reduce((s, m) => s + num(m.paidAmount || m.amount), 0);
    const approvedCosts = costs.filter((c) => c.status !== 'rejected');
    const totalCost = approvedCosts.filter((c) => c.status === 'approved').reduce((s, c) => s + num(c.amount), 0);
    const pendingCost = approvedCosts.filter((c) => c.status === 'pending').reduce((s, c) => s + num(c.amount), 0);
    const profit = collected - totalCost;
    const commissionPct = project.commissionPct ?? DEFAULT_COMMISSION_PCT;
    const commission = Math.round(profit * commissionPct) / 100;
    // Their sheet's "Profit Margin" = profit ÷ amount collected. Also give the
    // forward-looking version against the contract (what it'll be at handover).
    const marginOnCollected = collected > 0 ? (profit / collected) * 100 : null;
    const projectedProfit = contractTotal - totalCost - pendingCost;
    const projectedMargin = contractTotal > 0 ? (projectedProfit / contractTotal) * 100 : null;

    // Actual cost per section vs the quote's provisioned cost.
    const bySection = new Map<string, number>();
    for (const c of approvedCosts) if (c.sectionId) bySection.set(c.sectionId, (bySection.get(c.sectionId) || 0) + num(c.amount));
    const unallocated = approvedCosts.filter((c) => !c.sectionId).reduce((s, c) => s + num(c.amount), 0);
    const tally = sections.map((s) => {
      const prov = quotation?.provisions.find((p) => p.title === s.title);
      return { sectionId: s.id, letter: s.letter, title: s.title, quoted: prov?.quoted || 0, provisionedCost: prov?.cost || 0, actualCost: bySection.get(s.id) || 0 };
    }).filter((t) => t.quoted || t.provisionedCost || t.actualCost);

    const voDocs = await this.prisma.document.findMany({
      where: { projectId, organizationId, type: 'VARIATION_ORDER' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, status: true, config: true, createdAt: true },
    });
    const voDocuments = voDocs.map((d) => {
      const c: any = d.config || {};
      const sumL = (list: any[]) => (Array.isArray(list) ? list : []).reduce((x, l) => x + (l?.complimentary ? 0 : num(l?.amount)), 0);
      return { id: d.id, name: d.name, status: d.status, additions: sumL(c?.vo?.additions), removals: sumL(c?.vo?.removals), net: sumL(c?.vo?.additions) - sumL(c?.vo?.removals), createdAt: d.createdAt };
    });

    return {
      project: {
        id: project.id,
        projectNumber: project.projectNumber,
        source: (project as any).source || null,
        leadId: (project as any).leadId || null,
        name: project.name,
        address: project.address,
        status: project.status,
        stage: project.stage || (quotation?.signedAt ? 'signed' : null),
        designer: project.designer || quotation?.designer || null,
        commissionPct,
        startDate: project.startDate,
        endDate: project.endDate,
        customer,
        client: { name: quotation?.clientName || customer?.name || null, contact: quotation?.contact || customer?.phone || null, nric: quotation?.nric || null, address: quotation?.address || project.address || customer?.address || null },
      },
      quotation,
      vos: voDocuments,
      documents: otherDocs,
      costs,
      milestones,
      depositMode,
      engagementFee: deposit && deposit.pct == null ? deposit.amount : DEFAULT_ENGAGEMENT_FEE,
      sections,
      tally,
      unallocatedCost: unallocated,
      totals: {
        contractTotal,
        initialContractSum: quotation?.grandTotal || 0,
        voTotal: vos.reduce((s, m) => s + num(m.amount), 0),
        collected,
        refunded: refunds.reduce((s, m) => s + num(m.paidAmount || m.amount), 0),
        balanceDue: contractTotal - collected,
        totalCost,
        pendingCost,
        profit,
        commissionPct,
        commission,
        advanced: 0, // Phase 7: designer advances
        commissionBalance: commission,
        marginOnCollected,
        projectedProfit,
        projectedMargin,
      },
      stages: ID_STAGES,
    };
  }

  async updateProjectFields(projectId: string, organizationId: string, dto: { designer?: string | null; designerUserId?: string | null; stage?: string | null; commissionPct?: number | null; status?: string; startDate?: string | null; endDate?: string | null; name?: string; address?: string | null }) {
    await this.project(projectId, organizationId);
    if (dto.stage && !ID_STAGES.includes(dto.stage as any)) throw new BadRequestException('Unknown stage');
    // Picking a designer with a stored default commission adopts it (unless the
    // caller sets commissionPct explicitly in the same call).
    let commissionFromProfile: number | undefined;
    if (dto.designerUserId && dto.commissionPct === undefined) {
      const profile = await this.prisma.organizationMemberProfile.findUnique({
        where: { organizationId_userId: { organizationId, userId: dto.designerUserId } },
        select: { commissionPct: true },
      });
      if (profile?.commissionPct != null) commissionFromProfile = profile.commissionPct;
    }
    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        designer: dto.designer !== undefined ? dto.designer : undefined,
        designerUserId: dto.designerUserId !== undefined ? dto.designerUserId : undefined,
        ...(commissionFromProfile !== undefined ? { commissionPct: commissionFromProfile } : {}),
        stage: dto.stage !== undefined ? dto.stage : undefined,
        commissionPct: dto.commissionPct !== undefined ? dto.commissionPct : undefined,
        status: dto.status ? (dto.status as any) : dto.stage === 'completed' ? 'completed' : undefined,
        startDate: dto.startDate !== undefined ? (dto.startDate ? new Date(dto.startDate) : null) : undefined,
        endDate: dto.endDate !== undefined ? (dto.endDate ? new Date(dto.endDate) : null) : undefined,
        name: dto.name || undefined,
        address: dto.address !== undefined ? dto.address : undefined,
      },
      select: { id: true, designer: true, stage: true, commissionPct: true, status: true, name: true, address: true },
    });
  }

  // ── costs ledger ──────────────────────────────────────────────────────
  async addCost(projectId: string, organizationId: string, dto: CostDto, actorName?: string) {
    await this.project(projectId, organizationId);
    if (!dto.description?.trim()) throw new BadRequestException('Description is required');
    if (!(num(dto.amount) > 0)) throw new BadRequestException('Amount must be greater than zero');
    return this.prisma.projectCost.create({
      data: {
        organizationId,
        projectId,
        date: dto.date ? new Date(dto.date) : new Date(),
        supplierName: dto.supplierName?.trim() || null,
        supplierId: dto.supplierId || null,
        description: dto.description.trim(),
        invoiceNo: dto.invoiceNo?.trim() || null,
        amount: num(dto.amount),
        sectionId: dto.sectionId || null,
        attachmentUrl: dto.attachmentUrl || null,
        attachmentKey: dto.attachmentKey || null,
        source: dto.source || 'portal',
        status: dto.status || 'approved',
        approvedAt: (dto.status || 'approved') === 'approved' ? new Date() : null,
        createdByName: actorName || null,
        notes: dto.notes || null,
      },
    });
  }

  async updateCost(costId: string, organizationId: string, dto: Partial<CostDto>) {
    const existing = await this.prisma.projectCost.findFirst({ where: { id: costId, organizationId } });
    if (!existing) throw new NotFoundException('Cost not found');
    const approvingNow = dto.status === 'approved' && existing.status !== 'approved';
    return this.prisma.projectCost.update({
      where: { id: costId },
      data: {
        date: dto.date !== undefined ? (dto.date ? new Date(dto.date) : null) : undefined,
        supplierName: dto.supplierName !== undefined ? dto.supplierName : undefined,
        description: dto.description?.trim() || undefined,
        invoiceNo: dto.invoiceNo !== undefined ? dto.invoiceNo : undefined,
        amount: dto.amount !== undefined ? num(dto.amount) : undefined,
        sectionId: dto.sectionId !== undefined ? dto.sectionId : undefined,
        status: dto.status || undefined,
        approvedAt: approvingNow ? new Date() : undefined,
        notes: dto.notes !== undefined ? dto.notes : undefined,
      },
    });
  }

  async removeCost(costId: string, organizationId: string) {
    const existing = await this.prisma.projectCost.findFirst({ where: { id: costId, organizationId } });
    if (!existing) throw new NotFoundException('Cost not found');
    if (existing.attachmentKey) {
      try {
        await this.s3.deleteFile(existing.attachmentKey);
      } catch {
        /* best effort */
      }
    }
    await this.prisma.projectCost.delete({ where: { id: costId } });
    return { ok: true };
  }

  /**
   * Supplier invoice photo/PDF → AI extraction (reuses the bills extractor) +
   * attachment upload. Returns a DRAFT cost for the user (or the WhatsApp
   * agent) to confirm; nothing is written to the ledger here.
   */
  async extractCost(projectId: string, organizationId: string, base64Data: string, filename?: string) {
    await this.project(projectId, organizationId);
    if (!base64Data) throw new BadRequestException('No file provided');
    const headerMatch = base64Data.match(/^data:([a-zA-Z/+.-]+);base64,/);
    const mediaType = (headerMatch?.[1] || 'image/jpeg') as any;
    const raw = base64Data.slice(base64Data.indexOf(',') + 1);
    const ext = mediaType === 'application/pdf' ? 'pdf' : mediaType.includes('png') ? 'png' : mediaType.includes('webp') ? 'webp' : 'jpg';
    const key = `project-costs/${organizationId}/${projectId}/${Date.now()}-${(filename || 'invoice').replace(/[^a-zA-Z0-9._-]/g, '_')}.${ext}`;
    const [attachmentUrl, extracted] = await Promise.all([
      this.s3.uploadFile(key, Buffer.from(raw, 'base64'), mediaType),
      this.bills.extractFromFile(organizationId, base64Data, mediaType).catch(() => null),
    ]);
    const lines: any[] = Array.isArray(extracted?.lines) ? extracted.lines : [];
    const description = lines.length ? lines.map((l) => String(l.description || '').split('\n')[0]).filter(Boolean).slice(0, 4).join('; ') : '';
    return {
      attachmentUrl,
      attachmentKey: key,
      supplierName: extracted?.supplierName || null,
      supplierId: extracted?.supplierIdGuess || null,
      invoiceNo: extracted?.billNumber || null,
      date: extracted?.billDate || null,
      amount: num(extracted?.totalAmount) || num(extracted?.subtotal) || null,
      description: description || (extracted?.supplierName ? `${extracted.supplierName} invoice` : ''),
      currency: extracted?.currency || 'SGD',
      lines,
      extracted: !!extracted,
    };
  }

  // ── milestones / collections ──────────────────────────────────────────
  async addMilestone(projectId: string, organizationId: string, dto: MilestoneDto) {
    await this.project(projectId, organizationId);
    const count = await this.prisma.projectMilestone.count({ where: { projectId } });
    return this.prisma.projectMilestone.create({
      data: {
        organizationId,
        projectId,
        kind: dto.kind || 'milestone',
        label: dto.label?.trim() || (dto.kind === 'vo' ? 'Variation order' : dto.kind === 'refund' ? 'Refund excess' : 'Payment'),
        pct: dto.pct ?? null,
        amount: num(dto.amount),
        sortOrder: dto.sortOrder ?? count,
        dueTrigger: dto.dueTrigger || null,
        paidAmount: num(dto.paidAmount),
        paidAt: dto.paidAt ? new Date(dto.paidAt) : null,
        paymentMethod: dto.paymentMethod || null,
        invoiceId: dto.invoiceId || null,
      },
    });
  }

  async updateMilestone(milestoneId: string, organizationId: string, dto: MilestoneDto) {
    const existing = await this.prisma.projectMilestone.findFirst({ where: { id: milestoneId, organizationId } });
    if (!existing) throw new NotFoundException('Milestone not found');
    return this.prisma.projectMilestone.update({
      where: { id: milestoneId },
      data: {
        label: dto.label?.trim() || undefined,
        pct: dto.pct !== undefined ? dto.pct : undefined,
        amount: dto.amount !== undefined ? num(dto.amount) : undefined,
        sortOrder: dto.sortOrder ?? undefined,
        dueTrigger: dto.dueTrigger !== undefined ? dto.dueTrigger : undefined,
        paidAmount: dto.paidAmount !== undefined ? num(dto.paidAmount) : undefined,
        paidAt: dto.paidAt !== undefined ? (dto.paidAt ? new Date(dto.paidAt) : null) : undefined,
        paymentMethod: dto.paymentMethod !== undefined ? dto.paymentMethod : undefined,
        invoiceId: dto.invoiceId !== undefined ? dto.invoiceId : undefined,
      },
    });
  }

  async removeMilestone(milestoneId: string, organizationId: string) {
    const r = await this.prisma.projectMilestone.deleteMany({ where: { id: milestoneId, organizationId } });
    if (!r.count) throw new NotFoundException('Milestone not found');
    return { ok: true };
  }

  /**
   * First payment is EITHER the fixed engagement fee OR 10% of the contract sum
   * (never both — the owners' rule). Rewrites the "confirmation" milestone.
   */
  async setDepositMode(projectId: string, organizationId: string, dto: { mode: 'engagement' | 'percent'; engagementFee?: number; pct?: number }) {
    await this.project(projectId, organizationId);
    const q = await this.contractQuotation(projectId, organizationId);
    const base = q?.grandTotal || 0;
    let deposit = await this.prisma.projectMilestone.findFirst({ where: { projectId, kind: 'milestone', dueTrigger: 'confirmation' } });
    if (!deposit) {
      await this.seedMilestones(projectId, organizationId, base);
      deposit = await this.prisma.projectMilestone.findFirst({ where: { projectId, kind: 'milestone', dueTrigger: 'confirmation' } });
    }
    if (!deposit) throw new BadRequestException('No deposit milestone on this project');
    if (deposit.invoiceId) throw new BadRequestException('The deposit has already been invoiced — void that invoice first');
    const data =
      dto.mode === 'engagement'
        ? { label: `Engagement fee on confirmation (in lieu of 10%)`, pct: null, amount: num(dto.engagementFee) || DEFAULT_ENGAGEMENT_FEE }
        : { label: `${num(dto.pct) || 10}% on confirmation`, pct: num(dto.pct) || 10, amount: Math.round(base * (num(dto.pct) || 10)) / 100 };
    return this.prisma.projectMilestone.update({ where: { id: deposit.id }, data });
  }

  /**
   * Raise the formal progress-claim invoice for a milestone: one service line
   * for the milestone amount, customer + contract details from the signed
   * quotation, linked back to the project and the milestone. Created as a
   * draft in the invoice editor so the office can review, confirm and send
   * (with the PayNow QR) — idempotent per milestone.
   */
  async createMilestoneInvoice(milestoneId: string, organizationId: string, actorName?: string) {
    const m = await this.prisma.projectMilestone.findFirst({ where: { id: milestoneId, organizationId } });
    if (!m) throw new NotFoundException('Milestone not found');
    if (m.kind === 'refund') throw new BadRequestException('Refunds are not invoiced');
    if (!(num(m.amount) > 0)) throw new BadRequestException('Set the milestone amount first');
    if (m.invoiceId) {
      const existing = await this.prisma.document.findFirst({ where: { id: m.invoiceId, organizationId }, select: { id: true, name: true, type: true, documentTemplateId: true, status: true } });
      if (existing) return { id: existing.id, number: existing.name, status: existing.status, path: `/portal/documents/${existing.type}/${existing.documentTemplateId}/${existing.id}`, created: false };
    }
    const project = await this.project(m.projectId, organizationId);
    const q = await this.contractQuotation(m.projectId, organizationId);
    const qDoc = q ? await this.prisma.document.findFirst({ where: { id: q.id }, select: { config: true } }) : null;
    const qCfg: any = qDoc?.config || {};
    const templateId = await this.documents.resolveTemplateIdForType('INVOICE', organizationId);

    const pctText = m.pct != null ? `${m.pct}% of contract sum S$${num(q?.grandTotal).toLocaleString('en-SG', { minimumFractionDigits: 2 })}` : '';
    const description = `Progress claim — ${m.label}${pctText ? ` (${pctText})` : ''}${q?.number ? `\nContract ${q.number}` : ''}${project.address ? `\nSite: ${project.address.split('\n')[0]}` : ''}`;
    const now = new Date();
    const due = new Date(now.getTime() + 7 * 86400000);
    const config: any = {
      customer: qCfg.customer || { name: q?.clientName || project.name, address: q?.address || project.address || '', phone: q?.contact || '' },
      customerId: qCfg.customerId || project.customerId || null,
      customerName: q?.clientName || project.name,
      items: [
        {
          id: Date.now(),
          itemCode: '',
          inventoryItemId: '',
          description,
          quantity: 1,
          uom: 'lot',
          unitPrice: num(m.amount),
          amount: num(m.amount),
          isService: true,
          revenueTag: 'service',
          accountCode: 'SS001',
        },
      ],
      date: now.toISOString(),
      dueDate: due.toISOString(),
      documentInfo: { date: now.toISOString(), dueDate: due.toISOString(), paymentTerms: 'Due on receipt', referenceNo: q?.number || '', subject: `Progress claim — ${m.label}`, currency: 'SGD', taxApplicable: false },
      taxApplicable: false,
      sourceDocumentId: q?.id || null,
      sourceDocumentNumber: q?.number || null,
      sourceDocumentType: q ? 'QUOTATION' : null,
      milestoneId: m.id,
      projectId: m.projectId,
    };
    const invoice = await this.documents.createBasicDocument(templateId, 'INVOICE', organizationId, config, m.projectId, actorName ? { name: actorName } : undefined);
    await this.prisma.projectMilestone.update({ where: { id: m.id }, data: { invoiceId: invoice.id } });
    return { id: invoice.id, number: (invoice as any).name, status: (invoice as any).status, path: `/portal/documents/INVOICE/${templateId}/${invoice.id}`, created: true };
  }

  /** Re-derive milestone amounts from the current contract sum (keeps paid amounts). */
  async recalcMilestones(projectId: string, organizationId: string) {
    await this.project(projectId, organizationId);
    const q = await this.contractQuotation(projectId, organizationId);
    const base = q?.grandTotal || 0;
    const rows = await this.prisma.projectMilestone.findMany({ where: { projectId, kind: 'milestone', pct: { not: null } } });
    for (const m of rows) await this.prisma.projectMilestone.update({ where: { id: m.id }, data: { amount: Math.round(base * (m.pct || 0)) / 100 } });
    if (!rows.length) await this.seedMilestones(projectId, organizationId, base);
    return { ok: true, base };
  }

  // ── schedule (weekly Mon–Sun calendar) ────────────────────────────────
  private async scheduleHeader(projectId: string, organizationId: string) {
    const project = await this.project(projectId, organizationId);
    const q = await this.contractQuotation(projectId, organizationId);
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true, logo: true, phoneNumber: true } });
    return {
      project,
      projectSite: q?.address?.split('\n')[0] || project.address || project.name,
      contractNo: q?.number || null,
      manager: project.designer || q?.designer || null,
      contact: org?.phoneNumber || null,
      orgName: org?.name || '',
      logo: org?.logo || null,
    };
  }

  async getSchedule(projectId: string, organizationId: string) {
    const h = await this.scheduleHeader(projectId, organizationId);
    const items = await this.prisma.projectScheduleItem.findMany({ where: { projectId }, orderBy: [{ startDate: 'asc' }, { sortOrder: 'asc' }] });
    return {
      header: { projectSite: h.projectSite, contractNo: h.contractNo, manager: h.manager, contact: h.contact },
      items,
      weeks: buildWeeks(items).map((w) => ({ index: w.index, days: w.days.map((d) => ({ iso: d.iso, dow: d.dow, holiday: d.holiday, work: d.work, notes: d.notes })) })),
      sequence: ID_SCHEDULE_SEQUENCE,
      holidays: SG_PUBLIC_HOLIDAYS,
    };
  }

  /** Add one or many activities (each with its own range) in one go. */
  async addScheduleItems(projectId: string, organizationId: string, items: Array<{ label: string; kind?: string; startDate: string; endDate?: string; notes?: string | null }>) {
    await this.project(projectId, organizationId);
    const clean = (items || []).filter((i) => i?.label?.trim() && i.startDate);
    if (!clean.length) throw new BadRequestException('Nothing to add');
    const base = await this.prisma.projectScheduleItem.count({ where: { projectId } });
    const created = await this.prisma.$transaction(
      clean.map((i, idx) =>
        this.prisma.projectScheduleItem.create({
          data: {
            organizationId,
            projectId,
            label: i.label.trim(),
            kind: i.kind || 'work',
            startDate: new Date(i.startDate),
            endDate: new Date(i.endDate || i.startDate),
            sortOrder: base + idx,
            notes: i.notes || null,
          },
        }),
      ),
    );
    return { created: created.length };
  }

  async updateScheduleItem(itemId: string, organizationId: string, dto: { label?: string; kind?: string; startDate?: string; endDate?: string; notes?: string | null; sortOrder?: number }) {
    const existing = await this.prisma.projectScheduleItem.findFirst({ where: { id: itemId, organizationId } });
    if (!existing) throw new NotFoundException('Schedule item not found');
    const start = dto.startDate ? new Date(dto.startDate) : existing.startDate;
    let end = dto.endDate ? new Date(dto.endDate) : existing.endDate;
    if (end < start) end = start;
    return this.prisma.projectScheduleItem.update({
      where: { id: itemId },
      data: { label: dto.label?.trim() || undefined, kind: dto.kind || undefined, startDate: start, endDate: end, notes: dto.notes !== undefined ? dto.notes : undefined, sortOrder: dto.sortOrder ?? undefined },
    });
  }

  async removeScheduleItem(itemId: string, organizationId: string) {
    const r = await this.prisma.projectScheduleItem.deleteMany({ where: { id: itemId, organizationId } });
    if (!r.count) throw new NotFoundException('Schedule item not found');
    return { ok: true };
  }

  /** Shift every activity by N days (site delays) — keeps the sequence intact. */
  async shiftSchedule(projectId: string, organizationId: string, days: number, fromDate?: string) {
    await this.project(projectId, organizationId);
    const n = Math.trunc(Number(days) || 0);
    if (!n) return { shifted: 0 };
    const where: any = { projectId };
    if (fromDate) where.startDate = { gte: new Date(fromDate) };
    const rows = await this.prisma.projectScheduleItem.findMany({ where });
    await this.prisma.$transaction(
      rows.map((r) =>
        this.prisma.projectScheduleItem.update({
          where: { id: r.id },
          data: { startDate: new Date(r.startDate.getTime() + n * 86400000), endDate: new Date(r.endDate.getTime() + n * 86400000) },
        }),
      ),
    );
    return { shifted: rows.length };
  }

  async scheduleHtml(projectId: string, organizationId: string) {
    const h = await this.scheduleHeader(projectId, organizationId);
    const items = await this.prisma.projectScheduleItem.findMany({ where: { projectId }, orderBy: [{ startDate: 'asc' }, { sortOrder: 'asc' }] });
    return { html: renderScheduleHtml({ projectSite: h.projectSite, contractNo: h.contractNo, manager: h.manager, contact: h.contact, orgName: h.orgName, logo: h.logo, items }) };
  }

  /** Mint (or reuse) the public schedule link — the client always sees the latest calendar. */
  async createScheduleLink(projectId: string, organizationId: string) {
    await this.project(projectId, organizationId);
    let link = await this.prisma.projectShareLink.findFirst({ where: { projectId, kind: 'schedule', revokedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!link) {
      const { randomBytes } = await import('crypto');
      link = await this.prisma.projectShareLink.create({ data: { projectId, kind: 'schedule', token: randomBytes(32).toString('base64url') } });
    }
    const base = (process.env.PORTAL_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
    const path = `/schedule/${link.token}`;
    return { token: link.token, path, url: base ? `${base}${path}` : path };
  }

  async revokeScheduleLink(projectId: string, organizationId: string) {
    await this.project(projectId, organizationId);
    const r = await this.prisma.projectShareLink.updateMany({ where: { projectId, kind: 'schedule', revokedAt: null }, data: { revokedAt: new Date() } });
    return { revoked: r.count };
  }

  /**
   * PUBLIC (token only): the live schedule for the client — structured weeks
   * for the responsive page, plus the A4 print HTML for its Print button.
   */
  async publicScheduleByToken(token: string) {
    if (!token || token.length < 16) throw new NotFoundException();
    const link = await this.prisma.projectShareLink.findUnique({ where: { token }, select: { projectId: true, kind: true, revokedAt: true, project: { select: { organizationId: true } } } });
    if (!link || link.kind !== 'schedule' || link.revokedAt) throw new NotFoundException();
    const organizationId = link.project.organizationId!;
    const h = await this.scheduleHeader(link.projectId, organizationId);
    const items = await this.prisma.projectScheduleItem.findMany({ where: { projectId: link.projectId }, orderBy: [{ startDate: 'asc' }, { sortOrder: 'asc' }] });
    return {
      header: { projectSite: h.projectSite, contractNo: h.contractNo, manager: h.manager, contact: h.contact, orgName: h.orgName, logo: h.logo },
      weeks: buildWeeks(items).map((w) => ({ index: w.index, days: w.days.map((d) => ({ iso: d.iso, dow: d.dow, holiday: d.holiday, work: d.work, notes: d.notes })) })),
      html: renderScheduleHtml({ projectSite: h.projectSite, contractNo: h.contractNo, manager: h.manager, contact: h.contact, orgName: h.orgName, logo: h.logo, items }).toString(),
    };
  }

  // ── Lead → Project → Quotation (CIEL 09-01) ───────────────────────
  /**
   * Create an ID project directly — from an assigned lead, a referral, or the
   * designer's own client — BEFORE any quotation exists. Converting a lead
   * marks it converted and links it. The quotation is raised from the project
   * page afterwards; signing then locks onto this same project.
   */
  async createIdProject(
    organizationId: string,
    dto: { clientName?: string; name?: string; address?: string | null; source?: string; leadId?: string | null; designer?: string | null; designerUserId?: string | null },
  ) {
    let lead: any = null;
    if (dto.leadId) {
      lead = await this.prisma.lead.findFirst({ where: { id: dto.leadId, organizationId } });
      if (!lead) throw new NotFoundException('Lead not found');
      if (lead.projectId) {
        const existing = await this.prisma.project.findFirst({ where: { id: lead.projectId, organizationId }, select: { id: true, name: true } });
        if (existing) return { projectId: existing.id, name: existing.name, created: false };
      }
    }
    const clientName = (dto.clientName || dto.name || lead?.name || '').trim();
    if (!clientName) throw new BadRequestException('Client name is required');
    const address = (dto.address ?? lead?.location ?? null) || null;
    let designer = dto.designer ?? null;
    let designerUserId = dto.designerUserId ?? null;
    if (!designerUserId && lead?.assignedToUserId) {
      designerUserId = lead.assignedToUserId;
      designer = designer || lead.assignedToName || null;
    }
    // Designer's stored default commission rides in (same rule as updateProjectFields).
    let commissionPct: number | undefined;
    if (designerUserId) {
      const profile = await this.prisma.organizationMemberProfile.findUnique({
        where: { organizationId_userId: { organizationId, userId: designerUserId } },
        select: { commissionPct: true },
      });
      if (profile?.commissionPct != null) commissionPct = profile.commissionPct;
    }
    const project = await this.prisma.project.create({
      data: {
        organizationId,
        name: address ? `${clientName} — ${address.split('\n')[0]}` : clientName,
        address,
        status: 'pending',
        source: dto.source || (lead ? 'lead' : 'self'),
        leadId: dto.leadId || null,
        designer,
        designerUserId,
        ...(commissionPct != null ? { commissionPct } : {}),
      },
      select: { id: true, name: true },
    });
    if (lead) await this.prisma.lead.update({ where: { id: lead.id }, data: { status: 'converted', projectId: project.id } });
    return { projectId: project.id, name: project.name, created: true };
  }

  // ── Variation Orders (CIEL 09-01: one main quotation; changes are VOs) ──
  /** New draft VO document on the project (their sheet: additions + removals). */
  async createVo(projectId: string, organizationId: string) {
    const project = await this.project(projectId, organizationId);
    const q = await this.prisma.document.findFirst({
      where: { projectId, organizationId, type: { in: QUOTATION_TYPES }, status: 'confirmed' },
      orderBy: { createdAt: 'desc' },
      select: { name: true, config: true },
    });
    const n = (await this.prisma.document.count({ where: { projectId, organizationId, type: 'VARIATION_ORDER' } })) + 1;
    const templateId = await this.documents.resolveTemplateIdForType('QUOTATION', organizationId);
    const qc: any = q?.config || {};
    const doc = await this.prisma.document.create({
      data: {
        organizationId,
        projectId,
        type: 'VARIATION_ORDER',
        documentTemplateId: templateId,
        name: `VO${n}${q?.name ? ` · ${q.name}` : ''}`,
        config: {
          templateVariant: 'ID_VO',
          voNumber: n,
          contractNo: q?.name || null,
          designer: project.designer || qc?.quote?.header?.designer || null,
          client: {
            name: qc?.quote?.header?.clientName || null,
            address: qc?.quote?.header?.address || project.address || null,
            agreementDate: qc?.quote?.header?.agreementDate || null,
          },
          vo: { additions: [], removals: [] },
        },
      },
      select: { id: true, name: true },
    });
    return doc;
  }

  /**
   * Confirm a VO: snapshot the consolidation (their sheet's right-hand panel),
   * lock the document, and add the net amount to the contract as a `vo`
   * milestone so contract sum, balance and reports all move together.
   */
  async confirmVo(docId: string, organizationId: string) {
    const doc = await this.prisma.document.findFirst({ where: { id: docId, organizationId, type: 'VARIATION_ORDER' } });
    if (!doc) throw new NotFoundException('Variation order not found');
    if (!doc.projectId) throw new BadRequestException('Variation order is not linked to a project');
    if (doc.status === 'confirmed') throw new BadRequestException('This variation order is already confirmed');
    const cfg: any = doc.config || {};
    const vo: any = cfg.vo || {};
    const sumLines = (list: any[]) => (Array.isArray(list) ? list : []).reduce((x, l) => x + (l?.complimentary ? 0 : num(l?.amount)), 0);
    const additions = sumLines(vo.additions);
    const removals = sumLines(vo.removals);
    const net = additions - removals;

    const summary = await this.summary(doc.projectId, organizationId);
    const previousQuantum = summary.totals.contractTotal; // incl. earlier VOs, not this one
    const consolidation = {
      previousQuantum,
      additions,
      removals,
      newQuantum: previousQuantum + net,
      collected: summary.totals.collected,
      balance: previousQuantum + net - summary.totals.collected,
      schedule: summary.milestones.filter((m: any) => m.kind === 'milestone').map((m: any) => ({ label: m.label, collected: num(m.amount) > 0 && num(m.paidAmount) >= num(m.amount) })),
    };

    const count = await this.prisma.projectMilestone.count({ where: { projectId: doc.projectId, organizationId } });
    await this.prisma.$transaction([
      this.prisma.document.update({
        where: { id: doc.id },
        data: { status: 'confirmed', config: { ...cfg, vo: { ...vo, confirmedAt: new Date().toISOString() }, consolidation }, version: { increment: 1 } },
      }),
      this.prisma.projectMilestone.create({
        data: { organizationId, projectId: doc.projectId, kind: 'vo', label: doc.name || `VO`, amount: net, sortOrder: count, paidAmount: 0 },
      }),
    ]);
    return { confirmed: true, net, newQuantum: consolidation.newQuantum };
  }

  // ── list for the ID projects page ─────────────────────────────────────
  async list(organizationId: string, opts: { page?: number; limit?: number; search?: string; stage?: string; designer?: string; callerUserId?: string }) {
    const page = Math.max(1, opts.page || 1);
    const limit = Math.min(100, Math.max(1, opts.limit || 20));
    const where: any = { organizationId };
    // Designers only see the projects they're in charge of (CIEL 09-01).
    // A user whose ONLY active role in the org is "Designer" is scoped to
    // projects where they are the designer; anyone holding a broader role
    // (Management, superadmin, admin…) — or with no org roles at all
    // (osirisadmin bypass) — sees everything.
    if (opts.callerUserId) {
      const roles = await this.prisma.userRole.findMany({
        where: { userId: opts.callerUserId, organizationId, isActive: true },
        select: { role: { select: { name: true } } },
      });
      const names = roles.map((r) => r.role.name);
      if (names.length > 0 && names.every((n) => n === 'Designer')) {
        where.designerUserId = opts.callerUserId;
      }
    }
    if (opts.stage) where.stage = opts.stage;
    if (opts.designer) where.designer = { contains: opts.designer, mode: 'insensitive' };
    if (opts.search?.trim()) {
      const s = opts.search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { address: { contains: s, mode: 'insensitive' } },
        { designer: { contains: s, mode: 'insensitive' } },
        { documents: { some: { name: { contains: s, mode: 'insensitive' } } } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          projectNumber: true,
          name: true,
          address: true,
          status: true,
          stage: true,
          designer: true,
          commissionPct: true,
          startDate: true,
          createdAt: true,
          customer: { select: { id: true, name: true } },
          documents: { where: { type: { in: QUOTATION_TYPES } }, select: { id: true, name: true, status: true, config: true }, orderBy: { createdAt: 'desc' }, take: 3 },
          milestones: { select: { kind: true, label: true, amount: true, paidAmount: true }, orderBy: { sortOrder: 'asc' } },
          costs: { where: { status: 'approved' }, select: { amount: true } },
        },
      }),
      this.prisma.project.count({ where }),
    ]);
    const docs = rows.map((p) => {
      const q = p.documents.find((d) => d.status === 'confirmed') || p.documents[0];
      const cfg: any = q?.config || {};
      const initial = num(cfg?.documentInfo?.grandTotal);
      const vo = p.milestones.filter((m) => m.kind === 'vo').reduce((s, m) => s + num(m.amount), 0);
      const collected = p.milestones.filter((m) => m.kind !== 'refund').reduce((s, m) => s + num(m.paidAmount), 0) - p.milestones.filter((m) => m.kind === 'refund').reduce((s, m) => s + num(m.paidAmount || m.amount), 0);
      const cost = p.costs.reduce((s, c) => s + num(c.amount), 0);
      const contract = initial + vo;
      const nextMilestone = p.milestones.find((m) => m.kind === 'milestone' && num(m.paidAmount) < num(m.amount));
      return {
        id: p.id,
        projectNumber: p.projectNumber,
        name: p.name,
        address: p.address,
        status: p.status,
        stage: p.stage || (cfg?.clientSignature ? 'signed' : null),
        designer: p.designer || cfg?.quote?.header?.designer || null,
        customer: p.customer,
        clientName: cfg?.quote?.header?.clientName || p.customer?.name || null,
        contractNo: q?.name || null,
        quotationId: q?.id || null,
        contractTotal: contract,
        collected,
        outstanding: contract - collected,
        totalCost: cost,
        marginPct: contract > 0 ? ((contract - cost) / contract) * 100 : null,
        nextMilestoneLabel: nextMilestone?.label || null,
        startDate: p.startDate,
        createdAt: p.createdAt,
      };
    });
    return { docs, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
