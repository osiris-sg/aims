import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { isOrgFeatureEnabled } from '../common/org-features';

export const WHATSAPP_AGENT_FLAG = 'enableWhatsAppAgent';

export interface StaffPushOpts {
  /** Portal path the message points at (made absolute with PORTAL_URL). */
  linkPath?: string | null;
  /** One message per (org, event, user) — a re-fired hook is a silent no-op. */
  dedupeKey?: string | null;
  /** Only these users (default: every office user of the org — holders of documents:read). */
  userIds?: string[];
}

/**
 * Lifecycle pushes to the org's STAFF on WhatsApp (guru 2026-10-28: "once
 * confirmed … draft delivery created pls schedule a time and confirm items …
 * once the maintenance and DO is done they will get a noti that the draft
 * invoice is created pls confirm").
 *
 * Writes WhatsAppOutbox rows (kind EVENT, due now); the Operator module's
 * outbox worker sends them within the minute through the business line the
 * user last wrote to (else the org's own line), falling back to the approved
 * aims_notify template when the 24-hour window is closed. Recipients are the
 * same office users the bell reaches, resolved to the WhatsApp numbers they
 * linked to the AIMS line (OperatorIdentity) or set on their member profile.
 *
 * Gated by the org flag enableWhatsAppAgent. Depends on Prisma only, so any
 * module can import it without a cycle. NEVER throws.
 */
@Injectable()
export class StaffWhatsAppService {
  private readonly logger = new Logger(StaffWhatsAppService.name);

  constructor(private readonly prisma: PrismaService) {}

  portalUrl(path: string): string {
    const base = (process.env.PORTAL_URL || process.env.FRONTEND_URL || 'https://app.ai-ms.io').replace(/\/+$/, '');
    return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  /** The office users of the org and the WhatsApp numbers they are reachable on. */
  async recipients(organizationId: string, userIds?: string[]): Promise<Array<{ userId: string; to: string }>> {
    const office: Array<{ userId: string }> = userIds?.length
      ? userIds.map((userId) => ({ userId }))
      : await this.prisma.userRole.findMany({
          where: { organizationId, isActive: true, role: { permissions: { some: { name: 'documents:read' } } } },
          select: { userId: true },
        });
    const ids = [...new Set(office.map((u) => u.userId))];
    if (!ids.length) return [];
    const [identities, profiles]: [Array<{ clerkUserId: string; channelUserId: string }>, Array<{ userId: string; whatsappNumber: string | null }>] = await Promise.all([
      this.prisma.operatorIdentity.findMany({
        where: { channel: 'whatsapp', verified: true, clerkUserId: { in: ids } },
        select: { clerkUserId: true, channelUserId: true },
      }),
      this.prisma.organizationMemberProfile.findMany({
        where: { organizationId, userId: { in: ids }, whatsappNumber: { not: null } },
        select: { userId: true, whatsappNumber: true },
      }),
    ]);
    const seen = new Set<string>();
    const out: Array<{ userId: string; to: string }> = [];
    const add = (userId: string, raw: string | null) => {
      const to = String(raw || '').replace(/\D/g, '');
      if (!to || seen.has(`${userId}|${to}`)) return;
      seen.add(`${userId}|${to}`);
      out.push({ userId, to });
    };
    identities.forEach((i) => add(i.clerkUserId, i.channelUserId));
    profiles.forEach((p) => add(p.userId, p.whatsappNumber));
    return out;
  }

  /** Queue `text` for the org's office staff. Returns the number of rows written. */
  async push(organizationId: string, text: string, opts: StaffPushOpts = {}): Promise<number> {
    try {
      if (!(await isOrgFeatureEnabled(this.prisma, organizationId, WHATSAPP_AGENT_FLAG).catch(() => false))) return 0;
      const body = `${text.trim()}${opts.linkPath ? `\n${this.portalUrl(opts.linkPath)}` : ''}`;
      const rows = await this.recipients(organizationId, opts.userIds);
      if (!rows.length) return 0;
      const now = new Date();
      const res = await this.prisma.whatsAppOutbox.createMany({
        data: rows.map((r) => ({
          organizationId,
          userId: r.userId,
          to: r.to,
          kind: 'EVENT',
          text: body,
          linkUrl: opts.linkPath ? this.portalUrl(opts.linkPath) : null,
          dedupeKey: opts.dedupeKey ? `${opts.dedupeKey}:${r.userId}:${r.to}` : null,
          dueAt: now,
        })),
        skipDuplicates: true,
      });
      return res.count;
    } catch (e: any) {
      this.logger.warn(`staff WhatsApp push skipped (${opts.dedupeKey || 'event'}): ${e?.message}`);
      return 0;
    }
  }
}
