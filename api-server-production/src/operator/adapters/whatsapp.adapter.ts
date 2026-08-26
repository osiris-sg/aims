import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma.service';
import { ChannelAdapter, ChannelButton, InboundMessage } from '../operator.types';
import { cleanText } from '../text.util';

/**
 * WhatsApp Cloud API adapter for the Operator.
 *
 * Unlike Telegram (one bot token in config), WhatsApp sends through a per-org
 * business number: the token lives on WhatsAppConnection, keyed by the
 * phoneNumberId that RECEIVED the inbound. So each inbound primes a per-chat
 * reply context (rememberContext) recording which business number to answer
 * through AND the inbound message id — set by WhatsAppService.handleWebhook just
 * before it hands us the message. Sending reads the connection's token straight
 * from the DB, so this adapter never depends on WhatsAppService (keeps the
 * module graph acyclic).
 *
 * Parse is intentionally a no-op: WhatsApp routing happens in
 * WhatsAppService.handleWebhook (which already parses the webhook for the CRM
 * agent), and it builds the InboundMessage itself.
 *
 * Progress affordances: WhatsApp has NO message edit and NO delete, so the
 * Telegram-style "post a status, edit it, delete it" flow is impossible. Instead
 * sendTyping uses the native typing indicator (a read-receipt + typing_indicator
 * call tied to the inbound message) which shows "typing…" for up to ~25s and
 * auto-clears the moment the reply is sent — no leftover status bubble. The
 * text-status hooks (sendStatus/editStatus/deleteMessage) stay omitted on
 * purpose: a "Thinking" text message can't be cleared and would just clutter.
 */
@Injectable()
export class WhatsAppAdapter implements ChannelAdapter {
  readonly channel = 'whatsapp' as const;
  private readonly logger = new Logger(WhatsAppAdapter.name);

  /** recipient phone (chatId) -> business phoneNumberId to reply through. */
  private readonly replyFrom = new Map<string, string>();
  /** recipient phone (chatId) -> id of their latest inbound message (wamid). */
  private readonly lastInbound = new Map<string, string>();
  /** inbound message ids we've already flashed a typing indicator for. */
  private readonly typedFor = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Record which business number an inbound arrived on (so replies route back
   *  out through it) and the inbound message id (so we can flash a typing
   *  indicator against it). Every inbound re-primes this, so the context is
   *  always fresh for the sends that follow in the same request. */
  rememberContext(chatId: string, phoneNumberId: string, inboundMessageId?: string): void {
    if (chatId && phoneNumberId) this.replyFrom.set(chatId, phoneNumberId);
    if (chatId && inboundMessageId) this.lastInbound.set(chatId, inboundMessageId);
  }

  // Routing/parsing lives in WhatsAppService.handleWebhook.
  parse(): InboundMessage | null {
    return null;
  }

  private get apiVersion(): string {
    return this.config.get<string>('WHATSAPP.API_VERSION') || 'v23.0';
  }

  private async connFor(chatId: string) {
    const phoneNumberId = this.replyFrom.get(chatId);
    if (!phoneNumberId) return null;
    return this.prisma.whatsAppConnection.findUnique({
      where: { phoneNumberId },
      select: { phoneNumberId: true, accessToken: true, organizationId: true },
    });
  }

  /** Low-level POST to the messages endpoint. `body` is sent verbatim (after
   *  the connection is resolved). Returns { ok, json }. */
  private async post(
    chatId: string,
    body: Record<string, any>,
  ): Promise<{ ok: boolean; json: any; organizationId?: string }> {
    const conn = await this.connFor(chatId);
    if (!conn) {
      this.logger.error(`No WhatsApp connection primed to reply to ${chatId}`);
      return { ok: false, json: null };
    }
    const url = `https://graph.facebook.com/${this.apiVersion}/${conn.phoneNumberId}/messages`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${conn.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json: any = await res.json().catch(() => ({}));
      if (json?.error) {
        this.logger.error(`WhatsApp send failed: ${json.error.message || JSON.stringify(json.error)}`);
        return { ok: false, json, organizationId: conn.organizationId };
      }
      return { ok: true, json, organizationId: conn.organizationId };
    } catch (e: any) {
      this.logger.error(`WhatsApp send threw: ${e.message}`);
      return { ok: false, json: null };
    }
  }

  /** Send an actual message payload (type text/document/interactive) and log it
   *  to the org's WhatsApp thread. Returns true on success. */
  private async sendMessage(chatId: string, payload: Record<string, any>): Promise<boolean> {
    const body = { messaging_product: 'whatsapp', recipient_type: 'individual', to: chatId, ...payload };
    const { ok, json, organizationId } = await this.post(chatId, body);
    if (organizationId) {
      await this.prisma.whatsAppMessage
        .create({
          data: {
            organizationId,
            direction: 'OUTBOUND',
            counterparty: chatId,
            waMessageId: json?.messages?.[0]?.id || null,
            body:
              payload?.text?.body ||
              payload?.interactive?.body?.text ||
              payload?.document?.caption ||
              null,
            status: ok ? 'sent' : 'failed',
            error: ok ? null : json?.error?.message || null,
            payload: body,
          },
        })
        .catch(() => null);
    }
    return ok;
  }

  /** Native "typing…" indicator. Marks the sender's latest inbound as read and
   *  shows typing for up to ~25s or until we send the reply, whichever comes
   *  first — so it clears itself. Fired at most once per inbound message. */
  async sendTyping(chatId: string): Promise<void> {
    const wamid = this.lastInbound.get(chatId);
    if (!wamid || this.typedFor.has(wamid)) return;
    this.typedFor.add(wamid);
    if (this.typedFor.size > 1000) this.typedFor.clear(); // bound memory
    await this.post(chatId, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: wamid,
      typing_indicator: { type: 'text' },
    }).catch(() => null);
  }

  async sendText(chatId: string, text: string): Promise<void> {
    for (const chunk of chunkText(cleanText(text), 4000)) {
      // WhatsApp caps a text body at 4096 chars.
      await this.sendMessage(chatId, { type: 'text', text: { preview_url: false, body: chunk } });
    }
  }

  async sendDocument(chatId: string, url: string, filename: string, caption?: string): Promise<void> {
    const ok = await this.sendMessage(chatId, {
      type: 'document',
      document: {
        link: url,
        filename,
        caption: caption ? cleanText(caption).slice(0, 1000) : undefined,
      },
    });
    // WhatsApp fetches the link itself; if it refuses (unreachable/expired),
    // hand the user the link so the flow never dead-ends.
    if (!ok) {
      await this.sendText(chatId, `${caption ? caption + '\n\n' : ''}${filename}: ${url}`);
    }
  }

  async sendButtons(chatId: string, text: string, buttons: ChannelButton[]): Promise<void> {
    // Cloud API allows at most 3 reply buttons; title <=20 chars, id <=256.
    const reply = buttons.slice(0, 3).map((b) => ({
      type: 'reply',
      reply: { id: b.data.slice(0, 256), title: cleanText(b.label).slice(0, 20) },
    }));
    const ok = await this.sendMessage(chatId, {
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: cleanText(text).slice(0, 1024) },
        action: { buttons: reply },
      },
    });
    // Degrade to a typed-confirm prompt if interactive isn't accepted.
    if (!ok) {
      await this.sendText(chatId, `${text}\n\nReply "yes" to confirm or "no" to cancel.`);
    }
  }
}

function chunkText(text: string, size: number): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}
