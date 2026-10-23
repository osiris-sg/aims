/**
 * WhatsApp staff notifications (ADH, round S, 2026-10-21) — the QUEUE side.
 *
 * Anything in the shipments flow that a person should hear about calls `queue()`; it writes one
 * WhatsAppOutbox row per opted-in linked user (member profile with a WhatsApp number + the matching
 * pref on), due 10 minutes later (so a burst becomes one message) and never inside the user's quiet
 * hours. Nothing is sent from here — the Operator module's outbox worker drains the rows, so this
 * service depends on Prisma only and can be injected anywhere in the shipments / email modules.
 *
 * Gated by the org flag `enableWhatsAppAgent` (off = no rows at all).
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { isOrgFeatureEnabled } from '../common/org-features';
import { dueAtFor, KIND_PREF, OutboxKind, prefsOf, SHIPMENTS_PUSH_KINDS_ON, WhatsAppPrefs } from '../operator/shipments-agent.rules';

export const WHATSAPP_AGENT_FLAG = 'enableWhatsAppAgent';

export interface QueueOpts {
  linkUrl?: string | null;
  /** One row per (org, user, dedupeKey): an event once, a digest once a day. */
  dedupeKey?: string | null;
  /** Only these users (default: every opted-in linked user of the org). */
  userIds?: string[];
  /** Per-user text (e.g. the digest in the user's language); `text` is the fallback. */
  textFor?: (prefs: WhatsAppPrefs, userId: string) => string;
  at?: Date;
}

@Injectable()
export class ShipmentsNotifyService {
  private readonly logger = new Logger(ShipmentsNotifyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** The org's linked users with their prefs (number set on the member profile). */
  async recipients(organizationId: string, userIds?: string[]): Promise<Array<{ userId: string; to: string; prefs: WhatsAppPrefs }>> {
    const rows: Array<{ userId: string; whatsappNumber: string | null; whatsappPrefs: unknown }> = await this.prisma.organizationMemberProfile.findMany({
      where: { organizationId, whatsappNumber: { not: null }, ...(userIds?.length ? { userId: { in: userIds } } : {}) },
      select: { userId: true, whatsappNumber: true, whatsappPrefs: true },
    });
    return rows.filter((r) => r.whatsappNumber).map((r) => ({ userId: r.userId, to: r.whatsappNumber!.replace(/\D/g, ''), prefs: prefsOf(r.whatsappPrefs) }));
  }

  async enabled(organizationId: string): Promise<boolean> {
    return isOrgFeatureEnabled(this.prisma, organizationId, WHATSAPP_AGENT_FLAG).catch(() => false);
  }

  /** Queue `text` for every opted-in user. Never throws (a notification must never break the flow that raised it). */
  async queue(organizationId: string, kind: OutboxKind, text: string, opts: QueueOpts = {}): Promise<number> {
    try {
      // Round AE (owner): only "needs your answer" goes out on its own — the digest / events / filed kinds are off.
      if (!SHIPMENTS_PUSH_KINDS_ON.includes(kind)) return 0;
      if (!(await this.enabled(organizationId))) return 0;
      const at = opts.at ?? new Date();
      let n = 0;
      for (const r of await this.recipients(organizationId, opts.userIds)) {
        if (!r.prefs[KIND_PREF[kind]]) continue;
        const body = (opts.textFor ? opts.textFor(r.prefs, r.userId) : text).trim();
        if (!body) continue;
        try {
          await this.prisma.whatsAppOutbox.create({
            data: { organizationId, userId: r.userId, to: r.to, kind, text: body.slice(0, 3500), linkUrl: opts.linkUrl ?? null, dedupeKey: opts.dedupeKey ? `${opts.dedupeKey}:${r.userId}` : null, dueAt: dueAtFor(kind, at, r.prefs) },
          });
          n++;
        } catch (e: any) {
          if (e?.code !== 'P2002') this.logger.warn(`outbox row failed: ${e?.message}`); // P2002 = already queued (dedupe)
        }
      }
      return n;
    } catch (e: any) {
      this.logger.warn(`queue(${kind}) failed: ${e?.message}`);
      return 0;
    }
  }
}
