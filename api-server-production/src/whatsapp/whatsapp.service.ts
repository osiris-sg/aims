import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { OnboardDto, SendTemplateDto, SendTextDto } from './dto/whatsapp.dto';
import { WhatsAppAgentService } from './whatsapp-agent.service';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly agent: WhatsAppAgentService,
  ) {}

  private get apiVersion(): string {
    return this.configService.get<string>('WHATSAPP.API_VERSION') || 'v23.0';
  }

  private graphUrl(path: string): string {
    return `https://graph.facebook.com/${this.apiVersion}/${path}`;
  }

  /** Thin Graph API caller — surfaces Meta's error message on failure. */
  private async graph<T = any>(
    path: string,
    opts: { method?: 'GET' | 'POST'; token?: string; body?: Record<string, any> } = {},
  ): Promise<T> {
    const res = await fetch(this.graphUrl(path), {
      method: opts.method || 'GET',
      headers: {
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      const msg = json?.error?.message || `Graph API ${res.status}`;
      const err: any = new Error(msg);
      err.graphError = json?.error;
      throw err;
    }
    return json as T;
  }

  // ── Onboarding (Embedded Signup completion) ───────────────────────────────

  /**
   * Server side of Embedded Signup: exchange the one-time code for a business
   * token scoped to the client's shared WABA, subscribe our app to the WABA's
   * webhooks, register the number on Cloud API, and persist the connection.
   */
  async onboard(organizationId: string, dto: OnboardDto) {
    if (!dto?.code || !dto?.wabaId || !dto?.phoneNumberId) {
      throw new BadRequestException('code, wabaId and phoneNumberId are required');
    }
    const appId = this.configService.get<string>('WHATSAPP.APP_ID');
    const appSecret = this.configService.get<string>('WHATSAPP.APP_SECRET');
    if (!appId || !appSecret) {
      throw new BadRequestException('WhatsApp integration is not configured (META_APP_ID / META_APP_SECRET unset)');
    }

    // 1. Code → business access token (server-to-server; never in the browser).
    const tokenResp = await this.graph<{ access_token: string }>(
      `oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${encodeURIComponent(dto.code)}`,
    );
    const accessToken = tokenResp.access_token;

    // 2. Subscribe our app to the WABA so its webhooks reach us.
    await this.graph(`${dto.wabaId}/subscribed_apps`, { method: 'POST', token: accessToken });

    // 3. Fetch the human-readable number details for display.
    let displayPhoneNumber: string | null = null;
    let verifiedName: string | null = null;
    try {
      const phone = await this.graph<{ display_phone_number?: string; verified_name?: string }>(
        `${dto.phoneNumberId}?fields=display_phone_number,verified_name`,
        { token: accessToken },
      );
      displayPhoneNumber = phone.display_phone_number || null;
      verifiedName = phone.verified_name || null;
    } catch (e) {
      this.logger.warn(`Could not fetch phone details: ${(e as Error).message}`);
    }

    // 4. Register the number on Cloud API with a fresh 2FA pin. "already
    //    registered" style errors are fine (e.g. a migrated number).
    //    Coexistence numbers stay registered through the WhatsApp Business app
    //    — Meta requires skipping this call for them.
    const pin = dto.coexistence ? null : String(randomInt(0, 1000000)).padStart(6, '0');
    let registered = true;
    if (!dto.coexistence) {
      try {
        await this.graph(`${dto.phoneNumberId}/register`, {
          method: 'POST',
          token: accessToken,
          body: { messaging_product: 'whatsapp', pin },
        });
      } catch (e: any) {
        registered = false;
        this.logger.warn(`Phone registration returned: ${e.message}`);
      }
    }

    const connection = await this.prisma.whatsAppConnection.upsert({
      where: { organizationId },
      update: {
        wabaId: dto.wabaId,
        phoneNumberId: dto.phoneNumberId,
        displayPhoneNumber,
        verifiedName,
        accessToken,
        pin,
        status: 'CONNECTED',
        lastError: registered ? null : 'Phone registration reported an error — may already be registered',
        connectedAt: new Date(),
      },
      create: {
        organizationId,
        wabaId: dto.wabaId,
        phoneNumberId: dto.phoneNumberId,
        displayPhoneNumber,
        verifiedName,
        accessToken,
        pin,
        status: 'CONNECTED',
        lastError: registered ? null : 'Phone registration reported an error — may already be registered',
      },
    });

    return this.publicView(connection);
  }

  async getStatus(organizationId: string) {
    const connection = await this.prisma.whatsAppConnection.findUnique({ where: { organizationId } });
    return connection ? this.publicView(connection) : { status: 'NOT_CONNECTED' };
  }

  /** Soft disconnect: stop using the connection but keep the row for history. */
  async disconnect(organizationId: string) {
    const connection = await this.prisma.whatsAppConnection.findUnique({ where: { organizationId } });
    if (!connection) throw new NotFoundException('No WhatsApp connection for this organization');
    const updated = await this.prisma.whatsAppConnection.update({
      where: { organizationId },
      data: { status: 'DISCONNECTED' },
    });
    return this.publicView(updated);
  }

  /** Never expose the access token or pin to the frontend. */
  private publicView(c: any) {
    const { accessToken, pin, ...rest } = c;
    return rest;
  }

  // ── Sending ────────────────────────────────────────────────────────────────

  private async requireConnection(organizationId: string) {
    const connection = await this.prisma.whatsAppConnection.findUnique({ where: { organizationId } });
    if (!connection || connection.status !== 'CONNECTED') {
      throw new BadRequestException('WhatsApp is not connected for this organization');
    }
    return connection;
  }

  async sendTemplate(organizationId: string, dto: SendTemplateDto) {
    if (!dto?.to || !dto?.templateName) throw new BadRequestException('to and templateName are required');
    const payload = {
      messaging_product: 'whatsapp',
      to: dto.to.replace(/[^\d]/g, ''),
      type: 'template',
      template: {
        name: dto.templateName,
        language: { code: dto.languageCode || 'en_US' },
        ...(dto.components?.length ? { components: dto.components } : {}),
      },
    };
    return this.dispatch(organizationId, payload, { templateName: dto.templateName });
  }

  /** Free-form text — only delivered inside the 24h customer-service window. */
  async sendText(organizationId: string, dto: SendTextDto) {
    if (!dto?.to || !dto?.body) throw new BadRequestException('to and body are required');
    const payload = {
      messaging_product: 'whatsapp',
      to: dto.to.replace(/[^\d]/g, ''),
      type: 'text',
      text: { body: dto.body },
    };
    return this.dispatch(organizationId, payload, { body: dto.body });
  }

  private async dispatch(
    organizationId: string,
    payload: Record<string, any>,
    logFields: { templateName?: string; body?: string },
  ) {
    const connection = await this.requireConnection(organizationId);
    try {
      const resp = await this.graph<{ messages?: Array<{ id: string }> }>(
        `${connection.phoneNumberId}/messages`,
        { method: 'POST', token: connection.accessToken, body: payload },
      );
      const waMessageId = resp.messages?.[0]?.id || null;
      const logged = await this.prisma.whatsAppMessage.create({
        data: {
          organizationId,
          direction: 'OUTBOUND',
          counterparty: payload.to,
          waMessageId,
          templateName: logFields.templateName || null,
          body: logFields.body || null,
          status: 'sent',
          payload,
        },
      });
      return { id: logged.id, waMessageId, status: 'sent' };
    } catch (e: any) {
      await this.prisma.whatsAppMessage.create({
        data: {
          organizationId,
          direction: 'OUTBOUND',
          counterparty: payload.to,
          templateName: logFields.templateName || null,
          body: logFields.body || null,
          status: 'failed',
          error: e.message,
          payload,
        },
      });
      throw new BadRequestException(`WhatsApp send failed: ${e.message}`);
    }
  }

  /**
   * Store one `history` webhook chunk. Payload shape is nested and has varied
   * across doc versions, so this parses defensively:
   * value.history[] → { threads[] → { id, messages[] } } (also tolerates
   * value.threads[] / value.messages[] directly). Direction is inferred by
   * comparing the sender to the business number.
   */
  private async ingestHistoryChunk(organizationId: string, businessNumber: string | null, value: any) {
    const businessDigits = (businessNumber || '').replace(/\D/g, '');
    const chunks: any[] = Array.isArray(value?.history) ? value.history : [value];
    let stored = 0;
    for (const chunk of chunks) {
      const threads: any[] = Array.isArray(chunk?.threads)
        ? chunk.threads
        : Array.isArray(chunk?.messages)
          ? [{ id: null, messages: chunk.messages }]
          : [];
      for (const thread of threads) {
        const threadDigits = String(thread?.id || '').replace(/\D/g, '');
        for (const message of thread?.messages || []) {
          if (!message?.id) continue;
          const fromDigits = String(message.from || '').replace(/\D/g, '');
          const outbound = businessDigits.length > 0 && fromDigits === businessDigits;
          const counterparty = outbound
            ? String(message.to || thread?.id || 'unknown').replace(/\D/g, '') || threadDigits || 'unknown'
            : fromDigits || threadDigits || 'unknown';
          const ts = Number(message.timestamp);
          const created = await this.prisma.whatsAppMessage
            .create({
              data: {
                organizationId,
                direction: outbound ? 'OUTBOUND' : 'INBOUND',
                counterparty,
                waMessageId: message.id,
                body: message.text?.body || null,
                status: 'history',
                payload: message,
                ...(Number.isFinite(ts) && ts > 0 ? { createdAt: new Date(ts * 1000) } : {}),
              },
            })
            .catch(() => null); // redelivered chunk — already stored
          if (created) stored++;
        }
      }
    }
    if (stored) this.logger.log(`History sync: stored ${stored} past messages for org ${organizationId}`);
  }

  // ── AI agent orchestration ────────────────────────────────────────────────

  /**
   * Run the agent on a stored inbound message: draft a reply, auto-send it if
   * the org's policy allows, otherwise queue a PENDING suggestion for review.
   */
  private async runAgentOnInbound(inboundMessageId: string) {
    const inbound = await this.prisma.whatsAppMessage.findUnique({ where: { id: inboundMessageId } });
    if (!inbound || inbound.direction !== 'INBOUND' || !inbound.body) return;

    const config = await this.agent.getConfig(inbound.organizationId);
    if (!config.enabled) return;

    // Recent conversation with this counterparty for context (oldest first).
    const history = (
      await this.prisma.whatsAppMessage.findMany({
        where: { organizationId: inbound.organizationId, counterparty: inbound.counterparty, id: { not: inbound.id } },
        orderBy: { createdAt: 'desc' },
        take: 40,
        select: { direction: true, body: true },
      })
    ).reverse();

    const customerContext = await this.agent
      .buildCustomerContext(inbound.organizationId, inbound.counterparty)
      .catch(() => null);

    const verdict = await this.agent.draftReply(inbound.organizationId, inbound.body, history, customerContext);
    const autoSend = config.autoSendEnabled && verdict.canAutoSend;

    const suggestion = await this.prisma.whatsAppSuggestion.create({
      data: {
        organizationId: inbound.organizationId,
        inboundMessageId: inbound.id,
        counterparty: inbound.counterparty,
        inboundBody: inbound.body,
        suggestedReply: verdict.reply,
        canAutoSend: verdict.canAutoSend,
        confidence: verdict.confidence,
        reason: verdict.reason,
        status: autoSend ? 'AUTO_SENT' : 'PENDING',
      },
    });

    if (autoSend) {
      const sent = await this.sendText(inbound.organizationId, { to: inbound.counterparty, body: verdict.reply });
      await this.prisma.whatsAppSuggestion.update({
        where: { id: suggestion.id },
        data: { sentMessageId: sent.id },
      });
      this.logger.log(`Agent auto-replied to ${inbound.counterparty} (confidence ${verdict.confidence})`);
    } else {
      this.logger.log(`Agent queued suggestion for ${inbound.counterparty} (${verdict.reason})`);
    }
  }

  /** Dry-run with the same context assembly as the live path (no send). */
  async dryRun(organizationId: string, message: string, counterparty?: string) {
    if (!message?.trim()) throw new BadRequestException('message is required');
    let history: Array<{ direction: string; body: string | null }> = [];
    let customerContext: string | null = null;
    if (counterparty?.trim()) {
      history = (
        await this.prisma.whatsAppMessage.findMany({
          where: { organizationId, counterparty: { contains: counterparty.replace(/\D/g, '').slice(-8) } },
          orderBy: { createdAt: 'desc' },
          take: 40,
          select: { direction: true, body: true },
        })
      ).reverse();
      customerContext = await this.agent.buildCustomerContext(organizationId, counterparty).catch(() => null);
    }
    const verdict = await this.agent.draftReply(organizationId, message, history, customerContext);
    return { ...verdict, usedHistoryMessages: history.length, usedCustomerRecord: !!customerContext };
  }

  /**
   * Ask Meta to (re)deliver the coexistence chat history for this number via
   * the `history` webhook (last ~180 days, only if the user shared history
   * during onboarding).
   */
  async requestHistorySync(organizationId: string) {
    const connection = await this.requireConnection(organizationId);
    const resp = await this.graph(`${connection.phoneNumberId}/smb_app_data`, {
      method: 'POST',
      token: connection.accessToken,
      body: { messaging_product: 'whatsapp', sync_type: 'history' },
    });
    return resp;
  }

  /** Approve a pending suggestion (optionally edited) and send it. */
  async approveSuggestion(organizationId: string, suggestionId: string, editedReply?: string) {
    const suggestion = await this.prisma.whatsAppSuggestion.findFirst({
      where: { id: suggestionId, organizationId },
    });
    if (!suggestion) throw new NotFoundException('Suggestion not found');
    if (suggestion.status !== 'PENDING') throw new BadRequestException('Suggestion is not pending');

    const body = (editedReply ?? suggestion.suggestedReply).trim();
    if (!body) throw new BadRequestException('Reply is empty');

    const sent = await this.sendText(organizationId, { to: suggestion.counterparty, body });
    return this.prisma.whatsAppSuggestion.update({
      where: { id: suggestion.id },
      data: { status: 'SENT', suggestedReply: body, sentMessageId: sent.id },
    });
  }

  async listMessages(organizationId: string, limit = 50) {
    return this.prisma.whatsAppMessage.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 50, 200),
      select: {
        id: true,
        direction: true,
        counterparty: true,
        waMessageId: true,
        templateName: true,
        body: true,
        status: true,
        error: true,
        createdAt: true,
      },
    });
  }

  // ── Webhook ────────────────────────────────────────────────────────────────

  /**
   * Cloud API webhook payload: entry[].changes[].value carries either
   * `messages` (inbound) or `statuses` (delivery receipts for our sends).
   * The value.metadata.phone_number_id routes the event to the right org.
   */
  async handleWebhook(body: any) {
    const entries: any[] = Array.isArray(body?.entry) ? body.entry : [];
    for (const entry of entries) {
      const changes: any[] = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change?.value;
        const field: string = change?.field;
        if (!value || !['messages', 'smb_message_echoes', 'history'].includes(field)) continue;

        const phoneNumberId: string | undefined = value?.metadata?.phone_number_id;
        if (!phoneNumberId) continue;
        const connection = await this.prisma.whatsAppConnection.findUnique({
          where: { phoneNumberId },
        });
        if (!connection) {
          this.logger.warn(`Webhook for unknown phone_number_id ${phoneNumberId} — ignoring`);
          continue;
        }

        // Messages the business sent FROM the WhatsApp Business app (coexistence
        // echo) — log as outbound so conversation context stays complete, and
        // close any pending AI suggestions for that chat: a manual reply from
        // the phone means the human already handled it.
        if (field === 'smb_message_echoes') {
          const echoes: any[] = value.message_echoes || value.messages || [];
          for (const echo of echoes) {
            if (!echo?.id) continue;
            const counterparty = (echo.to || 'unknown').replace(/\D/g, '') || 'unknown';
            await this.prisma.whatsAppMessage
              .create({
                data: {
                  organizationId: connection.organizationId,
                  direction: 'OUTBOUND',
                  counterparty,
                  waMessageId: echo.id,
                  body: echo.text?.body || null,
                  status: 'sent',
                  payload: echo,
                },
              })
              .catch(() => {}); // redelivery
            const closed = await this.prisma.whatsAppSuggestion.updateMany({
              where: { organizationId: connection.organizationId, counterparty, status: 'PENDING' },
              data: { status: 'HANDLED_MANUALLY' },
            });
            if (closed.count) {
              this.logger.log(`Closed ${closed.count} pending suggestion(s) for ${counterparty} — replied manually from phone`);
            }
          }
          continue;
        }

        // Coexistence history sync: batches of past conversations (~180 days).
        if (field === 'history') {
          await this.ingestHistoryChunk(connection.organizationId, connection.displayPhoneNumber, value);
          continue;
        }

        // Delivery receipts for messages we sent.
        for (const status of value.statuses || []) {
          if (!status?.id) continue;
          await this.prisma.whatsAppMessage
            .update({
              where: { waMessageId: status.id },
              data: {
                status: status.status || 'unknown',
                error: status?.errors?.[0]?.message || null,
              },
            })
            .catch(() => {
              // Receipt for a message we didn't log (e.g. sent outside AIMS) — ignore.
            });
        }

        // Inbound messages from the org's customers.
        for (const message of value.messages || []) {
          if (!message?.id) continue;
          const body =
            message.text?.body ||
            message.button?.text ||
            message.interactive?.button_reply?.title ||
            message.interactive?.list_reply?.title ||
            null;
          const stored = await this.prisma.whatsAppMessage
            .create({
              data: {
                organizationId: connection.organizationId,
                direction: 'INBOUND',
                counterparty: message.from || 'unknown',
                waMessageId: message.id,
                body,
                status: 'received',
                payload: message,
              },
            })
            .catch(() => null); // Unique waMessageId → webhook redelivery, already stored.

          // Hand text messages to the AI agent (no-op unless enabled for the org).
          if (stored && body) {
            this.runAgentOnInbound(stored.id).catch((e) =>
              this.logger.error(`Agent failed on message ${stored.id}: ${e.message}`),
            );
          }
        }
      }
    }
    return { received: true };
  }
}
