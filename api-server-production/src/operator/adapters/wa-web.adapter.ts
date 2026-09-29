import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { ChannelAdapter, ChannelButton, InboundMessage } from '../operator.types';

/**
 * The whatsapp-web.js bridge (San). Nothing is sent from here: the bridge
 * posts one message and gets back everything the Operator said, which it then
 * posts as quoted replies from the linked phone. So this adapter only COLLECTS,
 * per request, through an async-local buffer.
 *
 * A linked device cannot send buttons or lists, so they become text. Confirm
 * cards never arrive here as buttons: OperatorService renders them itself as
 * "Reply confirm 4821" for this channel.
 */
@Injectable()
export class WaWebAdapter implements ChannelAdapter {
  readonly channel = 'wa-web' as const;
  private readonly store = new AsyncLocalStorage<string[]>();

  /** Run `fn` and return every message the Operator produced during it. */
  async collect(fn: () => Promise<void>): Promise<string[]> {
    const out: string[] = [];
    await this.store.run(out, fn);
    return out;
  }

  private push(text: string) {
    const t = String(text || '').trim();
    if (t) this.store.getStore()?.push(t);
  }

  parse(): InboundMessage | null {
    return null; // inbound arrives as a structured POST, see OperatorController
  }

  async sendText(_chatId: string, text: string): Promise<void> {
    this.push(text);
  }

  async sendDocument(_chatId: string, url: string, filename: string, caption?: string): Promise<void> {
    this.push(`${caption ? `${caption}\n` : ''}${filename}: ${url}`);
  }

  async sendButtons(_chatId: string, text: string, buttons: ChannelButton[]): Promise<void> {
    const options = buttons.map((b) => b.label.replace(/^[✅❌]\s*/, '')).filter(Boolean);
    this.push(options.length ? `${text}\n${options.map((o) => `• ${o}`).join('\n')}\n(Reply with your choice)` : text);
  }

  async sendList(_chatId: string, text: string, _label: string, rows: Array<{ id: string; title: string; description?: string }>) {
    this.push(`${text}\n${rows.map((r) => `• ${r.title}${r.description ? ` (${r.description})` : ''}`).join('\n')}\n(Reply with your choice)`);
  }
}
