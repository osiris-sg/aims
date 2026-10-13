import { Injectable } from '@nestjs/common';
import { ChannelAdapter, ChannelButton, InboundMessage, WebUiEvent } from '../operator.types';

type Emit = (event: any) => void;

/**
 * The AIMS dashboard chat as an operator channel.
 *
 * Unlike Telegram/WhatsApp there is no provider to call: each web message is
 * one HTTP request streaming Server-Sent Events, and every "send" here becomes
 * an event on THAT request's stream. The controller registers the stream under
 * a per-request chatId before handing the message to the brain, and removes it
 * when the request ends. A send to a chatId with no open stream is dropped (the
 * transcript still records it, so a reload shows it).
 */
@Injectable()
export class WebAdapter implements ChannelAdapter {
  readonly channel = 'web' as const;
  private readonly streams = new Map<string, Emit>();
  private seq = 0;

  open(chatId: string, emit: Emit): void {
    this.streams.set(chatId, emit);
  }

  close(chatId: string): void {
    this.streams.delete(chatId);
  }

  private emit(chatId: string, event: any): void {
    this.streams.get(chatId)?.(event);
  }

  /** Web messages arrive through the controller, never a provider webhook. */
  parse(_body: any): InboundMessage | null {
    return null;
  }

  async sendText(chatId: string, text: string): Promise<void> {
    this.emit(chatId, { type: 'message', kind: 'text', text });
  }

  async sendDocument(chatId: string, url: string, filename: string, caption?: string): Promise<void> {
    this.emit(chatId, { type: 'message', kind: 'document', url, filename, text: caption });
  }

  async sendButtons(chatId: string, text: string, buttons: ChannelButton[]): Promise<void> {
    this.emit(chatId, { type: 'message', kind: 'buttons', text, buttons });
  }

  async sendList(
    chatId: string,
    text: string,
    _buttonLabel: string,
    rows: Array<{ id: string; title: string; description?: string }>,
  ): Promise<void> {
    // A list is just more buttons on the web: no 3-button cap to work around.
    this.emit(chatId, {
      type: 'message',
      kind: 'list',
      text,
      buttons: rows.map((r) => ({ label: r.title, data: r.id, description: r.description })),
    });
  }

  async sendTyping(): Promise<void> {
    /* the status line already shows activity */
  }

  async sendStatus(chatId: string, text: string): Promise<string | null> {
    const id = `s${++this.seq}`;
    this.emit(chatId, { type: 'status', text });
    return id;
  }

  async editStatus(chatId: string, _messageId: string, text: string): Promise<void> {
    this.emit(chatId, { type: 'status', text });
  }

  async deleteMessage(chatId: string): Promise<void> {
    this.emit(chatId, { type: 'status', text: null });
  }

  async sendUi(chatId: string, event: WebUiEvent): Promise<void> {
    this.emit(chatId, { type: 'ui', event });
  }
}
