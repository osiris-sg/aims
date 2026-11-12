import { orgTimeZoneFor } from '../common/org-today';
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
import { ActionLogService } from '../action-log/action-log.service';
import { isOrgFeatureEnabled } from '../common/org-features';

const QUOTATION_TYPES = ['QUOTATION', 'QO', 'QO1', 'QO2', 'QT'];
const VO_TYPE = 'VARIATION_ORDER'; // VOs sign by the same link flow (Mike 2026-11-07)
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
    private readonly actionLog: ActionLogService,
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
    // A relative path is fine for the editor (it knows its origin) but useless
    // in a WhatsApp message or an email, so the live portal is the fallback.
    const base = (process.env.PORTAL_URL || process.env.FRONTEND_URL || 'https://app.ai-ms.io').replace(/\/$/, '');
    return `${base}${path}`;
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

  /** VO line count + net (additions − removals, complimentary and area rows at 0). */
  private voStats(config: any): { lines: number; net: number } {
    const vo: any = config?.vo || {};
    const real = (list: any[]) => (Array.isArray(list) ? list : []).filter((l) => l && l.kind !== 'area' && !l.struck);
    const sumOf = (list: any[]) => real(list).reduce((s, l) => s + (l.complimentary ? 0 : Number(l.amount) || 0), 0); // struck already filtered by real()
    return { lines: real(vo.additions).length + real(vo.removals).length, net: sumOf(vo.additions) - sumOf(vo.removals) };
  }

  private assertVoHasLines(config: any) {
    if (!this.voStats(config).lines) throw new BadRequestException('Add at least one line to the variation order before sending it for signature');
  }

  /** Mint (or reuse the active) sign link for a quotation. */
  async createForDocument(documentId: string, organizationId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, type: true, status: true, config: true },
    });
    if (!doc) throw new NotFoundException('Document not found');
    const type = String(doc.type).toUpperCase();
    if (type === VO_TYPE) {
      // A confirmed VO can still be SENT — confirmation locks nothing until
      // the client gets the link (guru 2026-11-08). Only an already-signed
      // one has nothing left to sign.
      if ((doc.config as any)?.clientSignature) throw new BadRequestException('The client has already signed this variation order');
      this.assertVoHasLines(doc.config);
    } else if (!QUOTATION_TYPES.includes(type)) {
      throw new BadRequestException('Only quotations and variation orders can be sent for signature');
    } else {
      if (doc.status === 'confirmed') throw new BadRequestException('This quotation is already confirmed');
      this.assertHasPricedLines(doc.config);
    }

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
    const doc = await this.prisma.document.findFirst({ where: { id: documentId, organizationId }, select: { id: true, name: true, config: true, documentTemplateId: true, type: true, projectId: true } });
    if (!doc) throw new NotFoundException('Document not found');
    const link = await this.createForDocument(documentId, organizationId);
    const cfg: any = doc.config || {};
    const di: any = cfg.documentInfo || {};
    const isVo = String(doc.type).toUpperCase() === VO_TYPE;
    // A VO's config carries only the homeowner's name/address — the phone and
    // email live on the project's customer.
    const voCustomer = isVo && doc.projectId
      ? (await this.prisma.project.findFirst({ where: { id: doc.projectId, organizationId }, select: { customer: { select: { phone: true, email: true } } } }))?.customer || null
      : null;
    const customerName = String(cfg.client?.name || cfg.customerName || cfg.customer?.name || di.customerName || '').trim();
    const contactName = String(cfg.attention?.name || di.contactName || cfg.customer?.contactPerson || '').trim();
    const toDefault =
      via === 'whatsapp'
        ? cfg.attention?.phoneNumber || di.contactNumber || cfg.customer?.mobile || cfg.customer?.phoneNumber || cfg.customer?.phone || cfg.customerPhone || voCustomer?.phone || ''
        : cfg.attention?.email || di.contactEmail || cfg.customerEmail || cfg.customer?.email || voCustomer?.email || '';
    let to = String(body?.to || toDefault || '').trim();
    if (via === 'whatsapp') {
      to = to.replace(/\D/g, '').replace(/^0+/, '');
      if (to.length === 8) to = `65${to}`;
      if (to.length < 8) throw new BadRequestException('The customer has no WhatsApp number on file. Enter the number to send to.');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      throw new BadRequestException('The customer has no email on file. Enter the email address to send to.');
    }
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
    const total = isVo ? this.voStats(cfg).net : Number(grossOf(cfg) ?? 0);
    const amount = total > 0 ? ` (${isVo ? 'net ' : ''}S$ ${total.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : '';
    const until = link.expiresAt ? ` The link is valid until ${new Date(link.expiresAt).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}.` : '';
    const greeting = contactName || customerName ? `Hi ${contactName || customerName}, ` : 'Hi, ';
    const docLabel = isVo ? 'variation order' : 'quotation';
    const message = String(body?.message || '').trim() || `${greeting}please review and sign ${docLabel} ${doc.name || ''}${amount} here: ${link.url}.${until} Thank you, ${org?.name || 'AIMS'}.`;
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
      const html = `<p>${escapeHtml(greeting.trim())}</p><p>Please review and sign ${docLabel} <b>${escapeHtml(doc.name || '')}</b>${escapeHtml(amount)}:</p><p><a href="${link.url}">${link.url}</a></p><p>${escapeHtml(until.trim())}</p><p>Thank you,<br/>${escapeHtml(org?.name || 'AIMS')}</p>`;
      const res = await this.email.sendSimpleEmail({ to: [to], subject: `${isVo ? 'Variation order' : 'Quotation'} ${doc.name || ''} from ${org?.name || 'AIMS'} — please sign`, html });
      await record('email', res.success, res.error);
      return res.success ? { sent: true, ...base } : { sent: false, ...base, reason: res.error || 'email failed' };
    }

    const waHref = `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
    // The org's own line, else the shared AIMS line the sender already texts
    // (a client org does not have to connect a number of its own), else the
    // platform line. Nothing at all → the caller hands over a wa.me link.
    const staffNumbers = actor?.id ? await this.numbersOf(actor.id, organizationId) : [];
    const primed = await this.whatsapp.primeForOrgOrShared(to, organizationId, staffNumbers).catch(() => false);
    if (!primed) {
      await record('whatsapp', false, 'no WhatsApp line available');
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

  /** The WhatsApp numbers a staff member is known by (linked identity + member profile). */
  private async numbersOf(userId: string, organizationId: string): Promise<string[]> {
    const [ids, profiles]: [Array<{ channelUserId: string }>, Array<{ whatsappNumber: string | null }>] = await Promise.all([
      this.prisma.operatorIdentity.findMany({ where: { channel: 'whatsapp', clerkUserId: userId, verified: true }, select: { channelUserId: true } }).catch(() => []),
      this.prisma.organizationMemberProfile.findMany({ where: { userId, organizationId, whatsappNumber: { not: null } }, select: { whatsappNumber: true } }).catch(() => []),
    ]);
    return [...ids.map((i) => i.channelUserId), ...profiles.map((p) => p.whatsappNumber || '')].filter(Boolean);
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
    const isVo = String(doc.type).toUpperCase() === VO_TYPE;
    // A VO's headline figure is its NET (additions − removals); the quotation's
    // is the grand total. `newQuantum` lets the sign panel show what the
    // contract becomes once the client accepts.
    const grand = isVo ? this.voStats(cfg).net : this.quoteStats(cfg).grand;
    const base = {
      state,
      document: {
        number: doc.name,
        docType: isVo ? 'VARIATION_ORDER' : 'QUOTATION',
        clientName: cfg?.client?.name || quote?.header?.clientName || cfg?.customer?.name || cfg?.customerName || '',
        address: cfg?.client?.address || quote?.header?.address || cfg?.customerAddress || cfg?.customer?.address || '',
        designer: cfg?.designer || quote?.header?.designer || '',
        grandTotal: grand,
        newQuantum: isVo ? Number(cfg?.consolidation?.newQuantum) || null : null,
        currency: 'SGD',
      },
      // The logo is usually stored as an S3 key ("logos/wct-logo.png"); the page needs a full URL.
      organization: { name: org?.name || '', logo: logoUrlOf(org?.logo), phoneNumber: org?.phoneNumber || null },
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
    // A signed VO must be reverted through the VO path (Directors only): it
    // also removes the contract milestone and the consolidation snapshot.
    if (String(doc.type).toUpperCase() === VO_TYPE) return this.costing.revertVo(documentId, organizationId, actor?.id);
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
    const isVo = String(doc.type).toUpperCase() === VO_TYPE;
    // A VO may legitimately arrive here already confirmed (confirmed-but-
    // unsent VOs stay sendable, guru 2026-11-08) — signing then just attaches
    // the client's signature. A quotation link still dies on confirm.
    if (doc.status === 'confirmed' && !isVo) throw new BadRequestException('This quotation has already been confirmed');
    if (isVo && (doc.config as any)?.clientSignature) throw new BadRequestException('This variation order has already been signed');
    if (isVo) this.assertVoHasLines(doc.config);
    else this.assertHasPricedLines(doc.config);
    const cfg: any = doc.config || {};
    const isIdQuote = !isVo && !!cfg.quote;
    const quote = cfg.quote || {};
    const signedAt = new Date();

    // ── Variation order: store the signature, then confirm through the same
    // path the staff Confirm button uses (locks the VO, snapshots the
    // consolidation, adds the net to the contract as a `vo` milestone).
    if (isVo) {
      if (!doc.projectId) throw new BadRequestException('This variation order is not linked to a project — please contact the office');
      // The date as the org reads it (its time zone, Financial Settings), for the printed signature line:
      // the PDF renders on a UTC server (WCT 2026-11-13).
      const tz = await orgTimeZoneFor(this.prisma, doc.organizationId);
      const signedDateText = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(signedAt);
      const clientSignature = { name, image, signedAt: signedAt.toISOString(), signedDateText, ip: meta.ip || null };
      await this.prisma.document.update({
        where: { id: doc.id },
        data: { config: { ...cfg, clientSignature }, version: { increment: 1 } },
      });
      // Already confirmed by staff before sending → the milestone and
      // consolidation exist; the signature is all that was missing.
      const r =
        doc.status === 'confirmed'
          ? { net: (cfg?.consolidation?.additions ?? 0) - (cfg?.consolidation?.removals ?? 0), newQuantum: cfg?.consolidation?.newQuantum ?? 0 }
          : await this.costing.confirmVo(doc.id, doc.organizationId);
      await this.prisma.$transaction([
        this.prisma.documentSignLink.update({ where: { id: link.id }, data: { signedAt, signerName: name, signerIp: meta.ip || null, userAgent: (meta.userAgent || '').slice(0, 300) } }),
        this.prisma.documentSignLink.updateMany({ where: { documentId: doc.id, id: { not: link.id }, signedAt: null, revokedAt: null }, data: { revokedAt: signedAt } }),
      ]);
      const voClient = cfg?.client?.name || '';
      const fmt = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      await this.staffWhatsApp.push(
        doc.organizationId,
        `Variation order ${doc.name || ''} signed by ${name}${voClient ? ` (${voClient})` : ''}. It is confirmed — the contract is now S$ ${fmt(r.newQuantum)}.`,
        { linkPath: `/portal/sales/variation-orders/${doc.id}`, dedupeKey: `vo-signed:${doc.id}` },
      );
      await this.notifications.emit({
        organizationId: doc.organizationId,
        kind: 'vo_signed',
        title: `Variation order ${doc.name || ''} signed by ${name}`,
        body: `${voClient || 'The client'} accepted the variation order — net S$ ${fmt(r.net)} added, contract is now S$ ${fmt(r.newQuantum)}.`,
        entityType: 'document',
        entityId: doc.id,
        linkUrl: `/portal/sales/variation-orders/${doc.id}`,
      });
      this.logger.log(`variation order ${doc.name || doc.id} signed by ${name} (${meta.ip || 'ip?'})`);
      return { ok: true, signedAt, projectId: doc.projectId };
    }

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
    // Manual order flow: the job's draft DO + draft service report (no-op otherwise).
    // DO first (2026-11-13): the order's first draft DO and no job; otherwise the job's DO + draft report.
    const firstDo = run?.doFirst && run.orderId ? await this.documents.prepareManualOrderDo(run.orderId, doc.organizationId) : null;
    if (run && !run.doFirst) await this.documents.prepareManualOrderJob(run.id, doc.organizationId);

    const clientLabel = quote?.header?.clientName || cfg?.customer?.name || cfg?.customerName || '';
    // The office on WhatsApp (guru 2026-10-28): the customer signed; in a
    // service-job org the draft delivery is waiting for a date. Flag-gated,
    // best-effort.
    await this.staffWhatsApp.push(
      doc.organizationId,
      `Quotation ${allocatedName || doc.name || ''} signed by ${name}${clientLabel ? ` (${clientLabel})` : ''}.` +
        (run
          ? run.doFirst
            ? ` Order ${run.orderNumber} created with draft DO ${firstDo?.doName || ''}: complete the DO when the work is done (add a job for a date or a technician if needed).`
            : run.orderNumber
            ? ` Order ${run.orderNumber} created with draft job #${run.deliveryNumber}: please schedule a date and confirm the items.`
            : ` Draft delivery #${run.deliveryNumber} created: please schedule a date and confirm the items.`
          : ' It is now confirmed.'),
      {
        linkPath: run ? (run.doFirst ? `/portal/orders/${run.orderId}` : `/portal/deliveries/${run.id}`) : isIdQuote ? `/portal/sales/quotations/id/${doc.id}` : doc.documentTemplateId ? `/portal/documents/${doc.type}/${doc.documentTemplateId}/${doc.id}` : '/portal',
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
    // E-signature orgs (enableQuotationESign, the WCT group): the signed PDF
    // is drawn again now, so the copy the customer and the office open shows
    // the signature (the stored PDF is otherwise reused as it was before
    // signing), and the customer's signature gets its own Activity Log row on
    // the org (the public request has no org of its own). CIEL / ID
    // quotations sign without this flag and are untouched.
    if (await isOrgFeatureEnabled(this.prisma, doc.organizationId, QUOTATION_ESIGN_FLAG)) {
      await this.afterESign(doc, { name, ip: meta.ip, userAgent: meta.userAgent, documentNumber: allocatedName || doc.name || null, orderNumber: run?.orderNumber ?? null });
    }
    this.logger.log(`quotation ${doc.name} signed by ${name} (${meta.ip || 'ip?'})`);
    return { ok: true, signedAt, projectId };
  }

  /** enableQuotationESign orgs only: re-render the signed PDF and log the customer's signature. Never throws. */
  private async afterESign(
    doc: { id: string; organizationId: string; type: string },
    who: { name: string; ip?: string; userAgent?: string; documentNumber: string | null; orderNumber: string | null },
  ): Promise<void> {
    try {
      await this.documents.getOrGeneratePdfUrl(doc.id, doc.organizationId, undefined, true);
    } catch (e: any) {
      this.logger.warn(`signed PDF refresh failed for ${doc.id}: ${e?.message}`);
    }
    await this.actionLog.log({
      actorType: 'GUEST',
      actorId: `signer:${who.name}`.slice(0, 120),
      actorName: `${who.name} (customer, sign link)`,
      organizationId: doc.organizationId,
      channel: 'public',
      method: 'POST',
      path: '/public/sign/:token',
      action: 'SIGN',
      resource: 'documents',
      resourceId: doc.id,
      statusCode: 201,
      ipAddress: who.ip ?? null,
      userAgent: (who.userAgent || '').slice(0, 300) || null,
      details: { documentType: doc.type, documentNumber: who.documentNumber, signerName: who.name, ...(who.orderNumber ? { orderNumber: who.orderNumber } : {}) },
    });
  }
}

/** The generic quotation e-signature flag (WCT group); CIEL's ID quotations sign through enableIdQuotation instead. */
export const QUOTATION_ESIGN_FLAG = 'enableQuotationESign';

/** A stored logo as a URL the browser can load: full URLs / data URLs as they are, an S3 key under the public bucket URL. */
export function logoUrlOf(logo: string | null | undefined): string | null {
  const k = (logo ?? '').trim();
  if (!k) return null;
  if (/^(https?:|data:)/i.test(k)) return k;
  const base = (process.env.S3_PUBLIC_URL ?? 'https://aims-osiris.s3.ap-southeast-1.amazonaws.com/').replace(/\/?$/, '/');
  return base + k.replace(/^\/+/, '');
}

function escapeHtml(v: string): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
