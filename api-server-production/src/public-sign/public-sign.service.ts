import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { DocumentsService } from '../documents/documents.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProjectCostingService } from '../project-costing/project-costing.service';

const QUOTATION_TYPES = ['QUOTATION', 'QO', 'QO1', 'QO2', 'QT'];
const VALIDITY_DAYS = 14; // "This quotation and agreement is valid for 14 days"
const MAX_SIGNATURE_BYTES = 400_000; // PNG data URL of a trimmed signature is ~10–40 KB

type LinkState = 'active' | 'signed' | 'revoked' | 'expired' | 'notfound';

@Injectable()
export class PublicSignService {
  private readonly logger = new Logger(PublicSignService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly notifications: NotificationsService,
    private readonly costing: ProjectCostingService,
  ) {}

  /** Shared by e-sign and manual confirm: create the project if missing, seed its payment schedule. */
  private async projectFor(doc: { id: string; projectId: string | null; organizationId: string; config: any }, startDate: Date) {
    const cfg: any = doc.config || {};
    const quote = cfg.quote || {};
    let projectId = doc.projectId || null;
    let created = false;
    let name: string | null = null;
    if (projectId) {
      const p = await this.prisma.project.findFirst({ where: { id: projectId, organizationId: doc.organizationId }, select: { id: true, name: true } });
      if (p) name = p.name;
      else projectId = null;
    }
    if (!projectId) {
      const clientName = quote?.header?.clientName || cfg?.customer?.name || 'Client';
      const address = quote?.header?.address || cfg?.customer?.address || '';
      const customerId = cfg?.customerId || cfg?.customer?.id || null;
      const customerOk = customerId ? await this.prisma.customer.findFirst({ where: { id: customerId, organizationId: doc.organizationId }, select: { id: true } }) : null;
      const project = await this.prisma.project.create({
        data: {
          organizationId: doc.organizationId,
          name: address ? `${clientName} — ${address.split('\n')[0]}` : clientName,
          address: address || null,
          status: 'ongoing',
          stage: 'signed',
          designer: quote?.header?.designer || null,
          startDate,
          ...(customerOk ? { customerId: customerOk.id } : {}),
        },
        select: { id: true, name: true },
      });
      projectId = project.id;
      name = project.name;
      created = true;
    }
    // Always seed the 10/40/45/5 schedule (amounts follow the contract sum;
    // Recalculate on the project re-derives them if the quote changes).
    const grand = Number(cfg?.documentInfo?.grandTotal) || 0;
    await this.costing.seedMilestones(projectId, doc.organizationId, grand).catch(() => null);
    return { projectId, name: name || '', created };
  }

  private generateToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private portalUrl(path: string) {
    const base = (process.env.PORTAL_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
    return base ? `${base}${path}` : path;
  }

  // ── office (authenticated) ────────────────────────────────────────────
  /** A quotation must carry at least one priced line before it can be signed. */
  private assertHasPricedLines(config: any) {
    const grand = Number(config?.documentInfo?.grandTotal) || 0;
    const lines = (config?.quote?.sections || []).reduce((n: number, s: any) => n + (s.areas || []).reduce((m: number, a: any) => m + (a.items || []).length, 0), 0);
    if (!lines || grand <= 0) throw new BadRequestException('Add priced lines to the quotation before sending it for signature');
  }

  /** Mint (or reuse the active) sign link for a quotation. */
  async createForDocument(documentId: string, organizationId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, type: true, status: true, config: true },
    });
    if (!doc) throw new NotFoundException('Document not found');
    if (!QUOTATION_TYPES.includes(String(doc.type).toUpperCase())) throw new BadRequestException('Only quotations can be sent for signature');
    if (doc.status === 'confirmed') throw new BadRequestException('This quotation is already confirmed');
    this.assertHasPricedLines(doc.config);

    const now = new Date();
    let link = await this.prisma.documentSignLink.findFirst({
      where: { documentId, revokedAt: null, signedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      orderBy: { createdAt: 'desc' },
    });
    if (!link) {
      link = await this.prisma.documentSignLink.create({
        data: { documentId, token: this.generateToken(), expiresAt: new Date(now.getTime() + VALIDITY_DAYS * 86400000) },
      });
    }
    const path = `/sign/${link.token}`;
    return { token: link.token, path, url: this.portalUrl(path), expiresAt: link.expiresAt, createdAt: link.createdAt };
  }

  /** Current sign status of a document for the editor header. */
  async statusForDocument(documentId: string, organizationId: string) {
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, organizationId }, select: { id: true, config: true } });
    if (!doc) throw new NotFoundException('Document not found');
    const now = new Date();
    const [active, signed] = await Promise.all([
      this.prisma.documentSignLink.findFirst({
        where: { documentId, revokedAt: null, signedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.documentSignLink.findFirst({ where: { documentId, signedAt: { not: null } }, orderBy: { signedAt: 'desc' } }),
    ]);
    const sig: any = (doc.config as any)?.clientSignature || null;
    return {
      active: active ? { url: this.portalUrl(`/sign/${active.token}`), expiresAt: active.expiresAt, createdAt: active.createdAt } : null,
      signed: signed ? { signedAt: signed.signedAt, signerName: signed.signerName } : sig ? { signedAt: sig.signedAt, signerName: sig.name } : null,
    };
  }

  /**
   * Office: make sure a (confirmed) quotation has a project — creates one from
   * the quote's client + site address when missing. Used by the manual
   * Confirm path so every accepted quotation lands on a project, signed
   * electronically or on paper.
   */
  async ensureProjectForDocument(documentId: string, organizationId: string) {
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, organizationId }, select: { id: true, projectId: true, organizationId: true, config: true } });
    if (!doc) throw new NotFoundException('Document not found');
    const r = await this.projectFor(doc, new Date());
    if (r.projectId !== doc.projectId) await this.prisma.document.update({ where: { id: doc.id }, data: { projectId: r.projectId } });
    return r;
  }

  async revokeForDocument(documentId: string, organizationId: string) {
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, organizationId }, select: { id: true } });
    if (!doc) throw new NotFoundException('Document not found');
    const r = await this.prisma.documentSignLink.updateMany({ where: { documentId, revokedAt: null, signedAt: null }, data: { revokedAt: new Date() } });
    return { revoked: r.count };
  }

  // ── public (token) ────────────────────────────────────────────────────
  private async resolve(token: string) {
    if (!token || token.length < 16) return { link: null, state: 'notfound' as LinkState };
    const link = await this.prisma.documentSignLink.findUnique({ where: { token }, include: { document: { include: { organization: true } } } });
    if (!link) return { link: null, state: 'notfound' as LinkState };
    let state: LinkState = 'active';
    if (link.signedAt) state = 'signed';
    else if (link.revokedAt) state = 'revoked';
    else if (link.expiresAt && link.expiresAt.getTime() < Date.now()) state = 'expired';
    return { link, state };
  }

  /** Public payload: state + a safe summary + the rendered quotation HTML. */
  async getByToken(token: string) {
    const { link, state } = await this.resolve(token);
    if (!link) throw new NotFoundException();
    const doc = link.document;
    const cfg: any = doc.config || {};
    const org = doc.organization;
    const quote = cfg.quote || {};
    const grand = Number(cfg?.documentInfo?.grandTotal) || 0;
    const base = {
      state,
      document: {
        number: doc.name,
        clientName: quote?.header?.clientName || cfg?.customer?.name || '',
        address: quote?.header?.address || '',
        designer: quote?.header?.designer || '',
        grandTotal: grand,
        currency: 'SGD',
      },
      organization: { name: org?.name || '', logo: org?.logo || null, phoneNumber: org?.phoneNumber || null },
      expiresAt: link.expiresAt,
      signedAt: link.signedAt,
      signerName: link.signerName,
    };
    if (state === 'revoked' || state === 'expired') return base;
    const { html } = await this.documents.renderDocumentHtml(doc.id, doc.organizationId);
    let pdfUrl: string | null = null;
    if (state === 'signed') {
      try {
        pdfUrl = (await this.documents.getOrGeneratePdfUrl(doc.id, doc.organizationId)) || null;
      } catch {
        pdfUrl = null;
      }
    }
    return { ...base, html, pdfUrl };
  }

  /**
   * Client signs: store the signature on the document, confirm it, create or
   * link the project, notify the office. All-or-nothing on the document row.
   */
  async sign(token: string, body: { signerName?: string; signatureDataUrl?: string; agreed?: boolean }, meta: { ip?: string; userAgent?: string }) {
    const { link, state } = await this.resolve(token);
    if (!link) throw new NotFoundException();
    if (state !== 'active') throw new BadRequestException(state === 'signed' ? 'This quotation has already been signed' : 'This link is no longer valid');
    const name = (body.signerName || '').trim();
    const image = body.signatureDataUrl || '';
    if (!name) throw new BadRequestException('Please enter your name');
    if (!body.agreed) throw new BadRequestException('Please accept the terms and conditions');
    if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > MAX_SIGNATURE_BYTES) throw new BadRequestException('Please draw your signature');

    const doc = link.document;
    if (doc.status === 'confirmed') throw new BadRequestException('This quotation has already been confirmed');
    this.assertHasPricedLines(doc.config);
    const cfg: any = doc.config || {};
    const quote = cfg.quote || {};
    const signedAt = new Date();

    // Project: link to the existing one, else create one for this client/site
    // (and seed the 10/40/45/5 payment schedule from the grand total).
    const { projectId } = await this.projectFor({ id: doc.id, projectId: doc.projectId, organizationId: doc.organizationId, config: cfg }, signedAt);

    const clientSignature = { name, image, signedAt: signedAt.toISOString(), ip: meta.ip || null };

    // Skip-numbering drafts (ID quotations) claim their contract number at
    // THIS moment — signing confirms the quotation (CIEL 09-01). The number
    // lands on the document AND inside the quote header so the printed LOI
    // shows it immediately.
    let allocatedName: string | null = null;
    if (!doc.name && cfg.skipNumbering === true) {
      try {
        allocatedName = await this.documents.generateSequentialDocumentName(doc.organizationId, doc.type, doc.documentTemplateId, cfg, signedAt);
      } catch (e) {
        this.logger.warn(`confirm-time number allocation failed for ${doc.id}: ${(e as Error).message}`);
      }
    }
    const cfgOut: any = { ...cfg, clientSignature, quote: { ...quote, clientSignature } };
    if (allocatedName) {
      cfgOut.documentInfo = { ...(cfgOut.documentInfo || {}), documentNumber: allocatedName };
      cfgOut.quote = { ...cfgOut.quote, header: { ...(cfgOut.quote?.header || {}), contractNo: allocatedName } };
    }

    await this.prisma.$transaction([
      this.prisma.document.update({
        where: { id: doc.id },
        data: {
          status: 'confirmed',
          projectId,
          ...(allocatedName ? { name: allocatedName } : {}),
          config: cfgOut,
          version: { increment: 1 },
        },
      }),
      this.prisma.documentSignLink.update({ where: { id: link.id }, data: { signedAt, signerName: name, signerIp: meta.ip || null, userAgent: (meta.userAgent || '').slice(0, 300) } }),
      // Any other still-open link for the same document is now moot.
      this.prisma.documentSignLink.updateMany({ where: { documentId: doc.id, id: { not: link.id }, signedAt: null, revokedAt: null }, data: { revokedAt: signedAt } }),
    ]);

    await this.notifications.emit({
      organizationId: doc.organizationId,
      kind: 'quotation_signed',
      title: `Quotation ${allocatedName || doc.name || ''} signed by ${name}`,
      body: `${quote?.header?.clientName || ''} accepted the quotation — it is now confirmed and linked to its project.`,
      entityType: 'document',
      entityId: doc.id,
      linkUrl: `/portal/sales/quotations/id/${doc.id}`,
    });
    this.logger.log(`quotation ${doc.name} signed by ${name} (${meta.ip || 'ip?'})`);
    return { ok: true, signedAt, projectId };
  }
}
