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
 * through — set by WhatsAppService.handleWebhook just before it hands us the
 * message. Sending reads the connection's token straight from the DB, so this
 * adapter never depends on WhatsAppService (keeps the module graph acyclic).
 *
 * Parse is intentionally a no-op: WhatsApp routing happens in
 * WhatsAppService.handleWebhook (which already parses the webhook for the CRM
 * agent), and it builds the InboundMessage itself.
 *
 * WhatsApp has no typing indicator, no message edit and no delete, so the
 * progress affordances (sendTyping/sendStatus/editStatus/deleteMessage) are
 * deliberately omitted — the operator's showStatus degrades to a no-op rather
 * than spamming un-editable "Thinking..." bubbles into the chat.
 */
@Injectable()
export class WhatsAppAdapter implements ChannelAdapter {
  readonly channel = 'whatsapp' as const;
  private readonly logger = new Logger(WhatsAppAdapter.name);

  /** recipient phone (chatId) -> business phoneNumberId to reply through. */
  private readonly replyFrom = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Record which business number an inbound arrived on so replies route back
   *  out through it. Every inbound (text OR button tap) re-primes this, so the
   *  context is always fresh for the sends that follow in the same request. */
  rememberContext(chatId: string, phoneNumberId: string): void {
    if (chatId && phoneNumberId) this.replyFrom.set(chatId, phoneNumberId);
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

  /** POST a message payload to the Graph API. Returns true on success. */
  private async send(chatId: string, payload: Record<string, any>): Promise<boolean> {
    const conn = await this.connFor(chatId);
    if (!conn) {
      this.logger.error(`No WhatsApp connection primed to reply to ${chatId}`);
      return false;
    }
    const url = `https://graph.facebook.com/${this.apiVersion}/${conn.phoneNumberId}/messages`;
    const body = { messaging_product: 'whatsapp', recipient_type: 'individual', to: chatId, ...payload };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${conn.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json: any = await res.json().catch(() => ({}));
      if (json?.error) {
        this.logger.error(`WhatsApp send failed: ${json.error.message || JSON.stringify(json.error)}`);
        return false;
      }
      // Log the outbound so it shows in the org's WhatsApp thread like any send.
      await this.prisma.whatsAppMessage
        .create({
          data: {
            organizationId: conn.organizationId,
            direction: 'OUTBOUND',
            counterparty: chatId,
            waMessageId: json?.messages?.[0]?.id || null,
            body: payload?.text?.body || payload?.interactive?.body?.text || payload?.document?.caption || null,
            status: 'sent',
            payload: body,
          },
        })
        .catch(() => null);
      return true;
    } catch (e: any) {
      this.logger.error(`WhatsApp send threw: ${e.message}`);
      return false;
    }
  }

  async sendText(chatId: string, text: string): Promise<void> {
    for (const chunk of chunkText(cleanText(text), 4000)) {
      // WhatsApp caps a text body at 4096 chars.
      await this.send(chatId, { type: 'text', text: { preview_url: false, body: chunk } });
    }
  }

  async sendDocument(chatId: string, url: string, filename: string, caption?: string): Promise<void> {
    const ok = await this.send(chatId, {
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
    const ok = await this.send(chatId, {
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
