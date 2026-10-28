import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { grossOf } from '../common/document-money';
import { DocumentsService } from '../documents/documents.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProjectCostingService } from '../project-costing/project-costing.service';
import { EmailService } from '../email/email.service';
import { StaffWhatsAppService } from '../staff-whatsapp/staff-whatsapp.service';
import { WhatsAppAdapter } from '../operator/adapters/whatsapp.adapter';
import { TemplateStatusService } from '../operator/template-status.service';

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
    private readonly email: EmailService,
    private readonly staffWhatsApp: StaffWhatsAppService,
    private readonly whatsapp: WhatsAppAdapter,
    private readonly templates: TemplateStatusService,
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
  /**
   * Line / total stats for either quotation shape: the ID editor's tree
   * (config.quote.sections[].areas[].items) or the generic editor's flat
   * config.items (WCT 2026-10-26: generic quotations sign by link too).
   */
  private quoteStats(config: any): { lines: number; grand: number; isIdQuote: boolean } {
    const cfg: any = config || {};
    if (cfg.quote) {
      const lines = (cfg.quote.sections || []).reduce((n: number, s: any) => n + (s.areas || []).reduce((m: number, a: any) => m + (a.items || []).length, 0), 0);
      return { lines, grand: Number(cfg?.documentInfo?.grandTotal) || 0, isIdQuote: true };
    }
    const items = (Array.isArray(cfg.items) ? cfg.items : []).filter((it: any) => it && !it.isGroupHeader && !it.isTagGroup);
    const summed = items.reduce((n: number, it: any) => {
      const amount = Number(it.amount);
      if (Number.isFinite(amount) && amount !== 0) return n + amount;
      return n + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);
    }, 0);
    const grand = Number(cfg?.documentInfo?.grandTotal) || grossOf(cfg) || Math.round(summed * 100) / 100;
    return { lines: items.length, grand, isIdQuote: false };
  }

  /** A quotation must carry at least one priced line before it can be signed. */
  private assertHasPricedLines(config: any) {
    const { lines, grand } = this.quoteStats(config);
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

  /**
   * SEND the sign link to the customer (guru 2026-10-28: "once confirmed it
   * will ask them to send the link to the customer number or email them …
   * also on the dashboard during send for signature"). Mints or reuses the
   * link, then:
   *   whatsapp — a text from the org's connected business line (the approved
   *              notify template when the customer's 24-hour window is closed).
   *              No line connected → not sent; the caller gets a wa.me link to
   *              forward the message by hand.
   *   email    — a plain email with the link (Resend).
   * Never throws for a delivery problem: the result says what happened.
   */
  async sendLink(
    documentId: string,
    organizationId: string,
    body: { via?: string; to?: string; message?: string },
    actor?: { id?: string; name?: string; email?: string },
  ): Promise<{ sent: boolean; via: 'whatsapp' | 'email'; to: string; url: string; expiresAt: Date | null; message: string; reason?: string; waHref?: string }> {
    const via = String(body?.via || '').toLowerCase() === 'email' ? 'email' : 'whatsapp';
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, organizationId }, select: { id: true, name: true, config: true, documentTemplateId: true, type: true } });
    if (!doc) throw new NotFoundException('Document not found');
    const link = await this.createForDocument(documentId, organizationId);
    const cfg: any = doc.config || {};
    const di: any = cfg.documentInfo || {};
    const customerName = String(cfg.customerName || cfg.customer?.name || di.customerName || '').trim();
    const contactName = String(cfg.attention?.name || di.contactName || cfg.customer?.contactPerson || '').trim();
    const toDefault =
      via === 'whatsapp'
        ? cfg.attention?.phoneNumber || di.contactNumber || cfg.customer?.mobile || cfg.customer?.phoneNumber || cfg.customer?.phone || cfg.customerPhone || ''
        : cfg.attention?.email || di.contactEmail || cfg.customerEmail || cfg.customer?.email || '';
    let to = String(body?.to || toDefault || '').trim();
    if (via === 'whatsapp') {
      to = to.replace(/\D/g, '').replace(/^0+/, '');
      if (to.length === 8) to = `65${to}`;
      if (to.length < 8) throw new BadRequestException('The customer has no WhatsApp number on file. Enter the number to send to.');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      throw new BadRequestException('The customer has no email on file. Enter the email address to send to.');
    }
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
    const total = Number(grossOf(cfg) ?? 0);
    const amount = total > 0 ? ` (S$ ${total.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : '';
    const until = link.expiresAt ? ` The link is valid until ${new Date(link.expiresAt).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}.` : '';
    const greeting = contactName || customerName ? `Hi ${contactName || customerName}, ` : 'Hi, ';
    const message = String(body?.message || '').trim() || `${greeting}please review and sign quotation ${doc.name || ''}${amount} here: ${link.url}.${until} Thank you, ${org?.name || 'AIMS'}.`;
    const text = message.includes(link.url) ? message : `${message}\n${link.url}`;
    const base = { via, to, url: link.url, expiresAt: link.expiresAt ?? null, message: text } as const;
    // Document history row ("History & notes" in the editor), same table the
    // editor's SENT rows use. Never breaks the send.
    const record = (how: string, ok: boolean, detail?: string) =>
      this.prisma.auditLog
        .create({
          data: {
            userId: actor?.id || 'system',
            userName: actor?.name || null,
            userEmail: actor?.email || null,
            action: ok ? 'SENT' : 'EMAIL_FAILED',
            resource: 'document',
            resourceId: doc.id,
            resourceName: doc.name || null,
            organizationId,
            details: { detail: ok ? `Sign link sent to ${to} on ${how}` : `Sign link to ${to} on ${how} failed${detail ? `: ${detail}` : ''}`, via, to },
          },
        })
        .catch(() => null);

    if (via === 'email') {
      const html = `<p>${escapeHtml(greeting.trim())}</p><p>Please review and sign quotation <b>${escapeHtml(doc.name || '')}</b>${escapeHtml(amount)}:</p><p><a href="${link.url}">${link.url}</a></p><p>${escapeHtml(until.trim())}</p><p>Thank you,<br/>${escapeHtml(org?.name || 'AIMS')}</p>`;
      const res = await this.email.sendSimpleEmail({ to: [to], subject: `Quotation ${doc.name || ''} from ${org?.name || 'AIMS'} — please sign`, html });
      await record('email', res.success, res.error);
      return res.success ? { sent: true, ...base } : { sent: false, ...base, reason: res.error || 'email failed' };
    }

    const waHref = `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
    const primed = await this.whatsapp.primeForOrg(to, organizationId).catch(() => false);
    if (!primed) {
      await record('whatsapp', false, 'no WhatsApp line connected');
      return { sent: false, ...base, reason: 'no-line', waHref };
    }
    let res = await this.whatsapp.sendTextResult(to, text).catch((e: any) => ({ ok: false, code: null as number | null, message: String(e?.message ?? e) }));
    if (!res.ok && (res.code === 131047 || /re-?engagement/i.test(res.message ?? ''))) {
      // The customer has not written to the line in 24 hours: the approved
      // one-parameter notify template carries the same text.
      const tpl = await this.templates.notifyTemplate(organizationId).catch(() => 'aims_notify');
      const ok = tpl ? await this.whatsapp.sendTemplate(to, tpl, text, 'en').catch(() => false) : false;
      res = ok ? { ok: true, code: null, message: null } : { ok: false, code: res.code, message: `${res.message ?? 'window closed'}; template ${tpl || 'aims_notify'} failed too` };
    }
    await record('whatsapp', res.ok, res.message ?? undefined);
    return res.ok ? { sent: true, ...base } : { sent: false, ...base, reason: res.message || 'send failed', waHref };
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

  /**
   * Designer counter-signature (CIEL 09-01): after the client signs, the
   * designer stamps their own signature onto the confirmed quotation. Stored
   * on config + quote (like clientSignature) and rendered in the "Prepared
   * by" block. Optionally saves the image to the caller's member profile for
   * one-tap reuse.
   */
  async addDesignerSignature(
    documentId: string,
    organizationId: string,
    body: { signatureImage: string; name?: string; saveToProfile?: boolean },
    userId?: string,
  ) {
    const image = body.signatureImage || '';
    if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > MAX_SIGNATURE_BYTES) {
      throw new BadRequestException('Please draw or pick a signature');
    }
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, organizationId }, select: { id: true, status: true, config: true } });
    if (!doc) throw new NotFoundException('Document not found');
    const cfg: any = doc.config || {};
    if (!cfg.clientSignature && doc.status !== 'confirmed') {
      throw new BadRequestException('The client signs first — send the quotation for signature');
    }
    const designerSignature = {
      name: (body.name || cfg?.quote?.header?.designer || '').trim() || null,
      image,
      signedAt: new Date().toISOString(),
      userId: userId || null,
    };
    await this.prisma.document.update({
      where: { id: doc.id },
      data: { config: { ...cfg, designerSignature, quote: { ...(cfg.quote || {}), designerSignature } }, version: { increment: 1 } },
    });
    if (body.saveToProfile && userId) {
      await this.prisma.organizationMemberProfile.upsert({
        where: { organizationId_userId: { organizationId, userId } },
        update: { signatureImage: image },
        create: { organizationId, userId, signatureImage: image },
      }).catch(() => null);
    }
    return { signed: true, signedAt: designerSignature.signedAt };
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
  async getByToken(token: string, lang?: string) {
    const { link, state } = await this.resolve(token);
    if (!link) throw new NotFoundException();
    const doc = link.document;
    const cfg: any = doc.config || {};
    const org = doc.organization;
    const quote = cfg.quote || {};
    const grand = this.quoteStats(cfg).grand;
    const base = {
      state,
      document: {
        number: doc.name,
        clientName: quote?.header?.clientName || cfg?.customer?.name || cfg?.customerName || '',
        address: quote?.header?.address || cfg?.customerAddress || cfg?.customer?.address || '',
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
    const { html } = await this.documents.renderDocumentHtml(doc.id, doc.organizationId, lang);
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
   * The client changed their mind after signing (guru 2026-09-19): remove the
   * client signature and un-confirm the quotation so it can be edited and
   * re-signed. The allocated CONTRACT NUMBER is deliberately KEPT — sign()
   * only allocates when the document has no name, so a re-sign reuses the
   * same CI number. The linked project is left in place (it may already hold
   * a schedule/costs); the who-signed-when trail goes to the document history.
   */
  async revertClientSignature(documentId: string, organizationId: string, actor?: { id?: string; name?: string; email?: string }) {
    // Managers and up only (guru 2026-10-02): reverting puts the quotation
    // back in the designers' hands — the designer tier can't do it themselves.
    if (actor?.id) {
      const { resolveTier } = await import('../common/role-tier');
      const { tier } = await resolveTier(this.prisma, organizationId, actor.id);
      if (tier === 'designer') throw new BadRequestException('Only managers can revert a confirmed quotation');
    }
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, organizationId } });
    if (!doc) throw new NotFoundException('Quotation not found');
    const cfg: any = doc.config || {};
    if (!cfg.clientSignature && doc.status !== 'confirmed') throw new BadRequestException('This quotation has no client signature to revert');
    const prevSig: any = cfg.clientSignature || null;

    const { clientSignature: _c, ...cfgRest } = cfg;
    const quote = cfgRest.quote ? { ...cfgRest.quote } : null;
    if (quote) delete (quote as any).clientSignature;
    const cfgOut: any = { ...cfgRest, ...(quote ? { quote } : {}) };

    await this.prisma.$transaction([
      this.prisma.document.update({
        where: { id: doc.id },
        data: { status: 'unconfirmed', config: cfgOut, version: { increment: 1 } },
      }),
      // Clear the signed link(s) so a fresh link can be minted; the audit of
      // who signed lives in the history entry below, not the link row.
      this.prisma.documentSignLink.updateMany({
        where: { documentId: doc.id, signedAt: { not: null } },
        data: { revokedAt: new Date(), signedAt: null, signerName: null },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: actor?.id || 'system',
          userName: actor?.name || null,
          userEmail: actor?.email || null,
          action: 'STATUS_CHANGED',
          resource: 'document',
          resourceId: doc.id,
          resourceName: doc.name,
          organizationId,
          details: {
            detail: prevSig
              ? `Client signature reverted — quotation back to draft (client cancelled). Was signed by ${prevSig.name} on ${prevSig.signedAt}. Contract number ${doc.name || '(none)'} kept.`
              : `Confirmed quotation reverted to draft by a manager so it can be edited again. Contract number ${doc.name || '(none)'} kept.`,
          },
        },
      }),
    ]);
    this.logger.log(`quotation ${doc.name || doc.id} client signature reverted by ${actor?.name || actor?.id || 'system'}`);
    return { ok: true, name: doc.name };
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
    const isIdQuote = !!cfg.quote;
    const quote = cfg.quote || {};
    const signedAt = new Date();

    // Project: ID quotations link to the existing one, else create one for
    // this client/site (and seed the 10/40/45/5 payment schedule from the
    // grand total). Generic quotations (WCT) keep whatever project link the
    // document already has — no auto-created project, no ID milestones.
    let projectId = doc.projectId || null;
    if (isIdQuote) {
      ({ projectId } = await this.projectFor({ id: doc.id, projectId: doc.projectId, organizationId: doc.organizationId, config: cfg }, signedAt));
    }

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
    const cfgOut: any = { ...cfg, clientSignature, ...(isIdQuote ? { quote: { ...quote, clientSignature } } : {}) };
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

    // Quotation → DRAFT DELIVERY (enableQuotationToDelivery, WCT 2026-10-26):
    // signing IS the acceptance, so the e-sign path triggers the same
    // auto-draft the staff Confirm button does. Pure helper — flag-gated
    // inside, idempotent, never throws.
    const { autoDraftDeliveryFromQuotation } = await import('../deliveries/quotation-to-delivery');
    const run = await autoDraftDeliveryFromQuotation(this.prisma, doc.organizationId, doc.id, this.logger);

    const clientLabel = quote?.header?.clientName || cfg?.customer?.name || cfg?.customerName || '';
    // The office on WhatsApp (guru 2026-10-28): the customer signed; in a
    // service-job org the draft delivery is waiting for a date. Flag-gated,
    // best-effort.
    await this.staffWhatsApp.push(
      doc.organizationId,
      `Quotation ${allocatedName || doc.name || ''} signed by ${name}${clientLabel ? ` (${clientLabel})` : ''}.` +
        (run ? ` Draft delivery #${run.deliveryNumber} created: please schedule a date and confirm the items.` : ' It is now confirmed.'),
      {
        linkPath: run ? `/portal/deliveries/${run.id}` : isIdQuote ? `/portal/sales/quotations/id/${doc.id}` : doc.documentTemplateId ? `/portal/documents/${doc.type}/${doc.documentTemplateId}/${doc.id}` : '/portal',
        dedupeKey: `quotation-signed:${doc.id}`,
      },
    );
    await this.notifications.emit({
      organizationId: doc.organizationId,
      kind: 'quotation_signed',
      title: `Quotation ${allocatedName || doc.name || ''} signed by ${name}`,
      body: isIdQuote
        ? `${clientLabel} accepted the quotation — it is now confirmed and linked to its project.`
        : `${clientLabel} accepted the quotation — it is now confirmed.`,
      entityType: 'document',
      entityId: doc.id,
      linkUrl: isIdQuote
        ? `/portal/sales/quotations/id/${doc.id}`
        : doc.documentTemplateId
          ? `/portal/documents/${doc.type}/${doc.documentTemplateId}/${doc.id}`
          : null,
    });
    this.logger.log(`quotation ${doc.name} signed by ${name} (${meta.ip || 'ip?'})`);
    return { ok: true, signedAt, projectId };
  }
}

function escapeHtml(v: string): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
