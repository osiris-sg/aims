import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelAdapter, ChannelButton, InboundMessage } from '../operator.types';
import { cleanText } from '../text.util';

/**
 * Telegram Bot API adapter. Uses native fetch — the repo has no HTTP module and
 * no Telegram SDK (same approach as WhatsAppService.dispatch).
 */
@Injectable()
export class TelegramAdapter implements ChannelAdapter {
  readonly channel = 'telegram' as const;
  private readonly logger = new Logger(TelegramAdapter.name);

  constructor(private readonly configService: ConfigService) {}

  private api(method: string): string {
    const token = this.configService.get<string>('TELEGRAM.BOT_TOKEN');
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    return `https://api.telegram.org/bot${token}/${method}`;
  }

  private async call(method: string, payload: Record<string, any>): Promise<any> {
    try {
      const res = await fetch(this.api(method), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json: any = await res.json().catch(() => ({}));
      if (!json?.ok) this.logger.error(`Telegram ${method} failed: ${json?.description || res.status}`);
      return json;
    } catch (e: any) {
      this.logger.error(`Telegram ${method} threw: ${e.message}`);
      return { ok: false };
    }
  }

  parse(body: any): InboundMessage | null {
    // Button tap
    const cq = body?.callback_query;
    if (cq) {
      const from = cq.from || {};
      return {
        channel: this.channel,
        channelUserId: String(from.id ?? ''),
        chatId: String(cq.message?.chat?.id ?? from.id ?? ''),
        text: '',
        displayName: [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username,
        callbackData: String(cq.data ?? ''),
        callbackId: String(cq.id ?? ''),
      };
    }

    // Plain text message (media ignored for now)
    const msg = body?.message || body?.edited_message;
    const text: string | undefined = msg?.text;
    if (!msg || !text) return null;
    const from = msg.from || {};
    return {
      channel: this.channel,
      channelUserId: String(from.id ?? ''),
      chatId: String(msg.chat?.id ?? from.id ?? ''),
      text: text.trim(),
      displayName: [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username,
    };
  }

  async sendText(chatId: string, text: string): Promise<void> {
    // Sanitise at the boundary: model output reaches the user unfiltered
    // otherwise, and the punctuation rule must not depend on the prompt.
    for (const chunk of chunkText(cleanText(text), 4000)) {
      // Telegram hard-caps a message at 4096 chars.
      await this.call('sendMessage', { chat_id: chatId, text: chunk });
    }
  }

  /** "typing…" indicator. Expires after ~5s, so re-send while work continues. */
  async sendTyping(chatId: string): Promise<void> {
    await this.call('sendChatAction', { chat_id: chatId, action: 'typing' });
  }

  /** Post a transient status line; returns its id so it can be edited/removed. */
  async sendStatus(chatId: string, text: string): Promise<string | null> {
    const res = await this.call('sendMessage', { chat_id: chatId, text: cleanText(text) });
    const id = res?.result?.message_id;
    return id ? String(id) : null;
  }

  async editStatus(chatId: string, messageId: string, text: string): Promise<void> {
    await this.call('editMessageText', { chat_id: chatId, message_id: Number(messageId), text: cleanText(text) });
  }

  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    await this.call('deleteMessage', { chat_id: chatId, message_id: Number(messageId) });
  }

  async sendDocument(chatId: string, url: string, filename: string, caption?: string): Promise<void> {
    const sent = await this.call('sendDocument', {
      chat_id: chatId,
      document: url,
      caption: caption ? cleanText(caption).slice(0, 1000) : undefined,
    });
    // Telegram fetches the URL itself and refuses some presigned links — fall
    // back to handing the user the link so the flow never dead-ends.
    if (!sent?.ok) {
      await this.sendText(chatId, `${caption ? caption + '\n\n' : ''}${filename}: ${url}`);
    }
  }

  async sendButtons(chatId: string, text: string, buttons: ChannelButton[]): Promise<void> {
    await this.call('sendMessage', {
      chat_id: chatId,
      text: cleanText(text),
      reply_markup: { inline_keyboard: [buttons.map((b) => ({ text: b.label, callback_data: b.data }))] },
    });
  }

  async sendList(
    chatId: string,
    text: string,
    _buttonLabel: string,
    rows: Array<{ id: string; title: string; description?: string }>,
  ): Promise<void> {
    // Telegram has no native list — stack the rows as inline buttons (callback
    // data max 64 bytes, which fits `costproj:<uuid>`).
    await this.call('sendMessage', {
      chat_id: chatId,
      text: cleanText(text),
      reply_markup: {
        inline_keyboard: rows
          .slice(0, 10)
          .map((r) => [{ text: cleanText(r.title).slice(0, 60), callback_data: r.id.slice(0, 64) }]),
      },
    });
  }

  async answerCallback(callbackId: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: callbackId, text: text?.slice(0, 200) });
  }
}

function chunkText(text: string, size: number): string[] {
  if (text.length <= size) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}
