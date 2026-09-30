import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { timingSafeEqual } from 'crypto';
import { runAsOrg } from '../common/tenancy/tenant-context';
import { NotificationsService } from '../notifications/notifications.service';
import { ActionLogService } from '../action-log/action-log.service';
import { OperatorService } from './operator.service';
import { OperatorAuthService } from './operator-auth.service';
import { WaWebAdapter } from './adapters/wa-web.adapter';
import { toE164Digits } from './phone.util';

/**
 * The San bridge (whatsapp-web.js linked device) as an Operator channel.
 *
 * WA_WEB_BRIDGES on the API binds each bridge token to ONE org and the chats
 * it may act in, e.g.
 *   {"<token>": {"orgId": "52e9…", "chats": ["1203…@g.us", "dm"], "label": "San"}}
 * "dm" allows 1:1 chats. Any other chat is refused here, whatever the bridge
 * sends. The bridge's existing Denzel endpoints are untouched: this is a
 * separate token and a separate path.
 */
interface BridgeConfig {
  token: string;
  orgId: string;
  chats: string[];
  label: string;
}

export interface WaWebInbound {
  messageId?: string;
  chatId?: string;
  isGroup?: boolean;
  fromPhone?: string | null;
  fromLid?: string | null;
  text?: string;
  quotedMessageId?: string | null;
}

const PER_MINUTE = 6;
const PER_HOUR = 60;
const HEARTBEAT_SILENCE_MS = 5 * 60_000;
const SEEN_TTL_MS = 2 * 3600_000;

@Injectable()
export class WaWebBridgeService {
  private readonly logger = new Logger(WaWebBridgeService.name);
  private parsed: { raw: string; bridges: BridgeConfig[] } | null = null;
  /** messageId → when handled: the bridge's catch-up and retries resend. */
  private readonly seen = new Map<string, number>();
  /** sender → request times in the last hour, and whether we already said "slow down". */
  private readonly hits = new Map<string, { at: number[]; warned: boolean }>();
  /** token → last heartbeat; alerted = bell already rung for this silence. */
  private readonly beats = new Map<string, { at: number; alerted: boolean }>();

  constructor(
    private readonly operator: OperatorService,
    private readonly auth: OperatorAuthService,
    private readonly adapter: WaWebAdapter,
    private readonly notifications: NotificationsService,
    private readonly actionLog: ActionLogService,
  ) {}

  private bridges(): BridgeConfig[] {
    const raw = process.env.WA_WEB_BRIDGES || '';
    if (this.parsed?.raw === raw) return this.parsed.bridges;
    let bridges: BridgeConfig[] = [];
    try {
      const obj = raw ? JSON.parse(raw) : {};
      bridges = Object.entries<any>(obj)
        .filter(([token, v]) => token && v?.orgId)
        .map(([token, v]) => ({
          token,
          orgId: String(v.orgId),
          chats: (Array.isArray(v.chats) ? v.chats : []).map((c: any) => String(c).trim()).filter(Boolean),
          label: String(v.label || 'wa-web bridge'),
        }));
    } catch (e: any) {
      this.logger.error(`WA_WEB_BRIDGES is not valid JSON: ${e?.message}`);
    }
    this.parsed = { raw, bridges };
    return bridges;
  }

  private bridgeFor(token: string | undefined): BridgeConfig {
    const t = String(token || '');
    const hit = t
      ? this.bridges().find((b) => b.token.length === t.length && timingSafeEqual(Buffer.from(b.token), Buffer.from(t)))
      : undefined;
    if (!hit) throw new UnauthorizedException('Invalid bridge token');
    return hit;
  }

  /** One message from the bridge → everything the Operator says back. */
  async inbound(token: string | undefined, body: WaWebInbound): Promise<{ messages: string[]; quotedMessageId: string | null; skipped?: string }> {
    const bridge = this.bridgeFor(token);
    const chatId = String(body?.chatId || '');
    // Group-ness comes from the id itself, never from what the caller claims.
    const isGroup = chatId.endsWith('@g.us');
    const allowed = bridge.chats.includes(chatId) || (!isGroup && !!chatId && bridge.chats.includes('dm'));
    if (!allowed) throw new ForbiddenException('Chat not allowed for this bridge');

    const messageId = String(body?.messageId || '');
    const reply = (messages: string[], skipped?: string) => ({ messages, quotedMessageId: messageId || null, ...(skipped ? { skipped } : {}) });
    const now = Date.now();
    for (const [k, at] of this.seen) if (now - at > SEEN_TTL_MS) this.seen.delete(k);
    if (messageId) {
      if (this.seen.has(messageId)) return reply([], 'duplicate');
      this.seen.set(messageId, now);
    }

    // The trigger word is for the bridge, not for the Operator.
    const text = String(body?.text || '').replace(/@san\b/gi, ' ').replace(/[ \t]+/g, ' ').trim();
    if (!text) return reply([], 'empty');
    const phone = toE164Digits(body?.fromPhone);
    const sender = phone || String(body?.fromLid || '').replace(/\D/g, '') || chatId;

    return runAsOrg(bridge.orgId, async () => {
      const limit = this.rateLimit(sender, now);
      if (limit !== 'ok') {
        if (limit === 'silent') return reply([], 'rate-limited');
        // Only a linked sender is told; an unlinked one stays silent as always.
        const linked = (await this.auth.resolveWaWeb(bridge.orgId, phone)).ok;
        return reply(linked ? ['Slow down a moment.'] : [], 'rate-limited');
      }
      const messages = await this.adapter.collect(() =>
        this.operator.handleInbound({
          channel: 'wa-web',
          channelUserId: phone || '',
          chatId,
          text,
          boundOrgId: bridge.orgId,
          isGroup,
          providerMessageId: messageId || undefined,
        }),
      );
      return reply(messages);
    });
  }

  /** 6 a minute, 60 an hour per sender. Over it: one warning, then silence
   *  until the sender is back under both limits. */
  private rateLimit(sender: string, now: number): 'ok' | 'warn' | 'silent' {
    const h = this.hits.get(sender) || { at: [], warned: false };
    h.at = h.at.filter((t) => now - t < 3600_000);
    const lastMinute = h.at.filter((t) => now - t < 60_000).length;
    if (lastMinute >= PER_MINUTE || h.at.length >= PER_HOUR) {
      const first = !h.warned;
      h.warned = true;
      this.hits.set(sender, h);
      return first ? 'warn' : 'silent';
    }
    h.at.push(now);
    h.warned = false;
    this.hits.set(sender, h);
    return 'ok';
  }

  heartbeat(token: string | undefined): { ok: true } {
    const bridge = this.bridgeFor(token);
    const prev = this.beats.get(bridge.token);
    if (prev?.alerted) {
      this.logger.log(`${bridge.label} is back after ${Math.round((Date.now() - prev.at) / 60_000)} min`);
      this.actionLog.system('wa-web-bridge', 'ONLINE', 'operator', { organizationId: bridge.orgId, details: { bridge: bridge.label } });
    }
    this.beats.set(bridge.token, { at: Date.now(), alerted: false });
    return { ok: true };
  }

  /** Every minute: a bridge that checked in before and has now been silent for
   *  5 minutes rings the office bell once. Armed by the first heartbeat since
   *  this API process started (the times are in memory), so a bridge that is
   *  configured but not switched on never raises a false alarm. */
  @Interval(60_000)
  async checkHeartbeats(now = Date.now()): Promise<number> {
    let rung = 0;
    for (const b of this.bridges()) {
      const beat = this.beats.get(b.token);
      if (!beat || beat.alerted || now - beat.at < HEARTBEAT_SILENCE_MS) continue;
      beat.alerted = true;
      rung++;
      const mins = Math.round((now - beat.at) / 60_000);
      await runAsOrg(b.orgId, () =>
        this.notifications.emit({
          organizationId: b.orgId,
          kind: 'OPERATOR_BRIDGE_DOWN',
          title: `WhatsApp bridge ${b.label} is offline`,
          body: `No check-in for ${mins} minutes. Requests to ${b.label} in WhatsApp are not being answered until it is back.`,
          entityType: 'wa-web-bridge',
          // One bell per outage: keyed by the last check-in it went quiet after.
          entityId: `${b.label}:${new Date(beat.at).toISOString()}`,
        }),
      );
      this.actionLog.system('wa-web-bridge', 'OFFLINE', 'operator', {
        organizationId: b.orgId,
        details: { bridge: b.label, silentMinutes: mins },
      });
    }
    return rung;
  }
}
