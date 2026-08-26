import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../common/prisma.service';
import { OperatorAuthService } from './operator-auth.service';
import { OperatorToolsService } from './operator-tools.service';
import { TelegramAdapter } from './adapters/telegram.adapter';
import { WhatsAppAdapter } from './adapters/whatsapp.adapter';
import {
  ChannelAdapter,
  InboundMessage,
  OperatorChannel,
  OperatorContext,
  PendingAction,
  SessionState,
} from './operator.types';

// Financial actions run through this agent, so tool selection has to be right.
// (Deliberately NOT the Haiku the WhatsApp PA agent uses — that one only drafts text.)
const MODEL = 'claude-opus-4-8';
const MAX_TOOL_ROUNDS = 8;
const HISTORY_TURNS = 20;
// Conversation memory does NOT expire — pick up where you left off days or
// months later. Size is bounded by HISTORY_TURNS, not by time. (expiresAt is
// still stamped far out to satisfy the column, but load ignores it.)
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
// A held financial confirmation DOES expire — "confirm" tapped days after the
// fact must not silently post something the user has forgotten about.
const PENDING_TTL_MS = 30 * 60 * 1000;

// What the user sees while a tool runs, so the bot never looks frozen.
const TOOL_STATUS: Record<string, string> = {
  find_customer: '🔎 Looking up the customer...',
  create_customer: '👤 Creating the customer...',
  find_item: '🔎 Looking up items...',
  create_quotation: '📝 Creating the quotation...',
  create_invoice: '📝 Creating the invoice...',
  create_invoice_from_quotation: '📝 Raising the invoice from the quotation...',
  preview_document: '📄 Generating the PDF preview...',
  confirm_document: '🔒 Checking the document...',
  confirm_invoice: '🔒 Checking the invoice...',
  list_open_invoices: '📂 Fetching open invoices...',
  record_payment: '💵 Preparing the payment...',
  aged_receivables: '📊 Running aged receivables...',
  get_document: '📂 Fetching the document...',
  list_recent_documents: '📂 Fetching recent documents...',
  update_customer: '✏️ Updating the customer...',
  find_supplier: '🔎 Looking up the supplier...',
  list_bills: '📂 Fetching bills...',
  create_bill: '📝 Recording the bill...',
  post_bill: '🔒 Checking the bill...',
  create_delivery_order: '📝 Creating the delivery order...',
  create_credit_note: '📝 Creating the credit note...',
  check_stock: '📦 Checking stock...',
  list_projects: '📂 Fetching projects...',
  sales_by_customer: '📊 Running sales by customer...',
  aged_payables: '📊 Running aged payables...',
  gst_report: '📊 Running the GST report...',
  email_document: '📧 Preparing the email...',
};

@Injectable()
export class OperatorService {
  private readonly logger = new Logger(OperatorService.name);
  private readonly anthropic: Anthropic | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: OperatorAuthService,
    private readonly tools: OperatorToolsService,
    private readonly telegram: TelegramAdapter,
    private readonly whatsapp: WhatsAppAdapter,
  ) {
    const key = process.env.ANTHROPIC_API_KEY;
    this.anthropic = key ? new Anthropic({ apiKey: key }) : null;
  }

  private adapterFor(channel: OperatorChannel): ChannelAdapter {
    if (channel === 'telegram') return this.telegram;
    if (channel === 'whatsapp') return this.whatsapp;
    throw new Error(`No adapter for channel ${channel}`);
  }

  /** Entry point: one inbound chat message, end to end. */
  async handleInbound(msg: InboundMessage): Promise<void> {
    const adapter = this.adapterFor(msg.channel);
    // WhatsApp replies route back out through the business number that received
    // the inbound — prime the adapter before any send in this request.
    if (msg.channel === 'whatsapp' && msg.businessPhoneNumberId) {
      this.whatsapp.rememberContext(msg.chatId, msg.businessPhoneNumberId);
    }
    if (msg.callbackId) await adapter.answerCallback?.(msg.callbackId).catch(() => null);

    const text = (msg.text || '').trim();

    // /link is the only command available before an identity exists.
    if (/^\/link\b/i.test(text)) {
      const code = text.split(/\s+/)[1] || '';
      const res = await this.auth.redeemLinkCode(msg.channel, msg.channelUserId, code, msg.displayName);
      await adapter.sendText(msg.chatId, res.message);
      return;
    }

    const resolved = await this.auth.resolve(msg.channel, msg.channelUserId);

    if (!resolved.ok || !resolved.ctx) {
      if (resolved.reason === 'unlinked') {
        await adapter.sendText(
          msg.chatId,
          "I don't recognise you yet. In AIMS go to Settings → Link chat account, then send me: /link <the 6-digit code>",
        );
      } else if (resolved.reason === 'no-org') {
        await adapter.sendText(msg.chatId, 'Your AIMS account is not assigned to any organization yet.');
      } else if (resolved.reason === 'needs-org-choice') {
        await adapter.sendButtons(
          msg.chatId,
          'Which organization should I work in?',
          (resolved.options ?? []).slice(0, 6).map((o) => ({ label: o.name, data: `org:${o.id}` })),
        );
      }
      return;
    }
    const ctx: OperatorContext = resolved.ctx;

    // Button taps
    if (msg.callbackData) {
      await this.handleCallback(ctx, adapter, msg, msg.callbackData);
      return;
    }

    if (/^\/(start|help)\b/i.test(text)) {
      await adapter.sendText(
        msg.chatId,
        `You're linked to ${ctx.organizationName}.\n\nAsk me things like:\n• "create a quotation for Acme, 2 fan coil units and 8 hours install"\n• "show me the last 5 quotations"\n• "what's QO2026-001?"\n\nI'll always show you a preview and ask before finalising anything.`,
      );
      return;
    }
    if (/^\/org\b/i.test(text)) {
      const memberships = await this.prisma.userOrganization.findMany({
        where: { userId: ctx.clerkUserId, isActive: true },
        select: { organization: { select: { id: true, name: true } } },
      });
      await adapter.sendButtons(
        msg.chatId,
        `Currently: ${ctx.organizationName}. Switch to:`,
        memberships.slice(0, 6).map((m) => ({ label: m.organization!.name, data: `org:${m.organization!.id}` })),
      );
      return;
    }

    // A typed yes/no answering a held confirmation
    const session = await this.loadSession(msg.channel, msg.channelUserId);
    if (session.pendingAction && /^(yes|y|confirm|ok|okay|go ahead|do it)\b/i.test(text)) {
      await this.executePending(ctx, adapter, msg, session);
      return;
    }
    if (session.pendingAction && /^(no|n|cancel|stop|nevermind|never mind)\b/i.test(text)) {
      session.pendingAction = null;
      await this.saveSession(msg.channel, msg.channelUserId, session);
      await adapter.sendText(msg.chatId, 'Cancelled. Nothing was changed.');
      return;
    }

    if (!text) return;
    await this.runAgent(ctx, adapter, msg, session, text);
  }

  // ── The tool-use loop ─────────────────────────────────────────────────────

  private async runAgent(
    ctx: OperatorContext,
    adapter: ChannelAdapter,
    msg: InboundMessage,
    session: SessionState,
    text: string,
  ): Promise<void> {
    if (!this.anthropic) {
      await adapter.sendText(msg.chatId, 'The assistant is not configured (missing ANTHROPIC_API_KEY).');
      return;
    }

    const messages: Anthropic.MessageParam[] = [
      // trimHistory again on the way IN, so a session stored broken by an
      // earlier version heals itself instead of failing forever.
      ...this.trimHistory(session.history as Anthropic.MessageParam[]),
      { role: 'user', content: text },
    ];
    const toolDefs = this.tools.definitions(ctx);
    let pendingFromTools: PendingAction | null = null;

    // Live progress: one status message that gets edited as work moves along,
    // plus the native typing indicator. Cleared before the final reply.
    let statusId: string | null = null;
    const showStatus = async (label: string) => {
      await adapter.sendTyping?.(msg.chatId).catch(() => null);
      try {
        if (!statusId) statusId = (await adapter.sendStatus?.(msg.chatId, label)) ?? null;
        else await adapter.editStatus?.(msg.chatId, statusId, label);
      } catch {
        /* status is cosmetic, never break the run for it */
      }
    };
    const clearStatus = async () => {
      if (!statusId) return;
      await adapter.deleteMessage?.(msg.chatId, statusId).catch(() => null);
      statusId = null;
    };

    await showStatus('💭 Thinking...');

    try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const resp = await this.anthropic.messages.create({
        model: MODEL,
        max_tokens: 2000,
        system: this.systemPrompt(ctx),
        tools: toolDefs,
        messages,
      });

      messages.push({ role: 'assistant', content: resp.content });

      const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (!toolUses.length) {
        const say = resp.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim();
        await clearStatus();
        if (say) await adapter.sendText(msg.chatId, say);
        break;
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        await showStatus(TOOL_STATUS[use.name] || `⚙️ Working on ${use.name.replace(/_/g, ' ')}...`);
        const outcome = await this.tools.execute(ctx, use.name, use.input);
        if (outcome.preview) {
          await adapter.sendDocument(
            msg.chatId,
            outcome.preview.url,
            outcome.preview.filename,
            outcome.preview.caption,
          );
        }
        if (outcome.pending) pendingFromTools = outcome.pending;
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          // Once a tool asks for confirmation, the SYSTEM shows the user a
          // Confirm/Cancel button and executes on their tap. Tell the model to
          // stop so it doesn't loop calling the tool or re-ask in its own words.
          content: outcome.pending
            ? 'A Confirm/Cancel button has been shown to the user. STOP now: do not call this tool again, do not ask for confirmation yourself, and do not say it is done. The system will finalize it when the user taps Confirm.'
            : JSON.stringify(outcome.result ?? {}).slice(0, 6000),
        });
      }
      messages.push({ role: 'user', content: results });
      // A confirmation is now pending — end the model loop and wait for the
      // user's decision rather than letting the model reason further.
      if (pendingFromTools) break;
      await showStatus('💭 Thinking...');
    }

    await clearStatus();

    // Persist trimmed history + any action now awaiting confirmation.
    session.history = this.trimHistory(messages) as SessionState['history'];
    session.pendingAction = pendingFromTools;
    await this.saveSession(msg.channel, msg.channelUserId, session);

    if (pendingFromTools) {
      await adapter.sendButtons(msg.chatId, `${pendingFromTools.summary}\n\nConfirm?`, [
        { label: '✅ Confirm', data: `confirm:${pendingFromTools.documentId ?? 'pending'}` },
        { label: '❌ Cancel', data: 'cancel' },
      ]);
    }
    } catch (e: any) {
      // Never leave the user staring at a status line. Drop the (possibly
      // corrupted) history so the next message starts clean.
      this.logger.error(`agent run failed: ${e?.message}`);
      await clearStatus();
      session.history = [];
      session.pendingAction = null;
      await this.saveSession(msg.channel, msg.channelUserId, session);
      await adapter.sendText(
        msg.chatId,
        'Sorry, something went wrong on my side and I have reset our conversation. Please send that again.',
      );
    }
  }

  /**
   * Trim history to the last N turns WITHOUT orphaning tool blocks.
   *
   * A `tool_result` is only valid when the immediately preceding assistant
   * message carries the matching `tool_use`. A naive slice can cut between the
   * two, leaving a window that starts on a `tool_result` — the API then rejects
   * every subsequent call with a 400 and the conversation is bricked until the
   * session is cleared. So after slicing, drop from the front until the window
   * begins on a clean user turn.
   */
  private trimHistory(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
    let out = messages.slice(-HISTORY_TURNS);
    while (out.length && !this.isCleanStart(out[0])) out = out.slice(1);
    return out;
  }

  /** True when this message can safely be the first in a request. */
  private isCleanStart(m: Anthropic.MessageParam): boolean {
    if (!m || m.role !== 'user') return false;
    if (typeof m.content === 'string') return true;
    return Array.isArray(m.content) && !m.content.some((b: any) => b?.type === 'tool_result');
  }

  private systemPrompt(ctx: OperatorContext): string {
    const perms = ctx.isOsirisAdmin
      ? 'all permissions (admin)'
      : ctx.roles.flatMap((r) => r.permissions.map((p) => `${p.resource}:${p.action}`)).join(', ') || 'none';
    return [
      `You are the AIMS Operator, an assistant that performs real work inside the AIMS business system on behalf of staff, over chat.`,
      `You are acting as ${ctx.actor.name || 'a staff user'} in the organization "${ctx.organizationName}". Their permissions: ${perms}.`,
      `Everything you do is scoped to this organization only.`,
      ``,
      `RULES:`,
      `1. NEVER invent a customer id, item id, price, or amount. Always resolve them with tools first (find_customer, find_item).`,
      `2. If a customer or item is ambiguous or missing, ask the user. Do not guess or silently pick the first match.`,
      `3. Creating a DRAFT is safe. Finalising/confirming/posting/paying is NOT. To finalise anything you MUST call the matching confirm tool (confirm_document, confirm_invoice, post_bill, record_payment) — NEVER ask the user to confirm in your own words, and never simulate it. When such a tool responds that a Confirm button has been shown, STOP: say one short line like "Sent for your confirmation" and wait. Do NOT call the tool again and do NOT claim it is done — the system finalises it only when the user taps Confirm.`,
      `4. Amounts are in the organization's default currency unless stated otherwise.`,
      `5. Keep replies short and plain, because this is a chat app. No markdown tables, no headings. Use the document number when referring to a document.`,
      `6. If a tool returns an error, tell the user plainly what went wrong and what you need from them.`,
      `7. If the user refers to something loosely ("send it again", "that quotation", "the last one") and it isn't in this conversation, DON'T ask them to repeat themselves. Call list_recent_documents and act on the most recent matching document. Only ask when there is genuine ambiguity (e.g. several plausible matches).`,
      `8. PUNCTUATION: never use em dashes or en dashes ("—", "–") in your replies OR in any text you write into a document (line item descriptions, notes, terms). Use a comma, a full stop, a colon or brackets instead. Ordinary hyphens inside words (e.g. "Fan-Coil") are fine.`,
    ].join('\n');
  }

  // ── Confirmation handling ─────────────────────────────────────────────────

  private async handleCallback(
    ctx: OperatorContext,
    adapter: ChannelAdapter,
    msg: InboundMessage,
    data: string,
  ): Promise<void> {
    if (data.startsWith('org:')) {
      const orgId = data.slice(4);
      const allowed = await this.prisma.userOrganization.findFirst({
        where: { userId: ctx.clerkUserId, organizationId: orgId, isActive: true },
        select: { organization: { select: { name: true } } },
      });
      if (!allowed) {
        await adapter.sendText(msg.chatId, "You're not a member of that organization.");
        return;
      }
      await this.auth.setOrganization(msg.channel, msg.channelUserId, orgId);
      await adapter.sendText(msg.chatId, `Now working in ${allowed.organization!.name}.`);
      return;
    }

    const session = await this.loadSession(msg.channel, msg.channelUserId);
    if (data === 'cancel') {
      session.pendingAction = null;
      await this.saveSession(msg.channel, msg.channelUserId, session);
      await adapter.sendText(msg.chatId, 'Cancelled. Nothing was changed.');
      return;
    }
    if (data.startsWith('confirm:')) {
      if (!session.pendingAction) {
        await adapter.sendText(msg.chatId, 'That confirmation has expired. Ask me again and I’ll redo it.');
        return;
      }
      // Re-verify the held action targets the document the button referenced.
      const targetId = data.slice(8);
      if (session.pendingAction.documentId && targetId !== session.pendingAction.documentId) {
        await adapter.sendText(msg.chatId, "That button doesn't match the pending action. Cancelled for safety.");
        session.pendingAction = null;
        await this.saveSession(msg.channel, msg.channelUserId, session);
        return;
      }
      await this.executePending(ctx, adapter, msg, session);
    }
  }

  private async executePending(
    ctx: OperatorContext,
    adapter: ChannelAdapter,
    msg: InboundMessage,
    session: SessionState,
  ): Promise<void> {
    const pending = session.pendingAction!;
    const res = await this.tools.runPending(ctx, pending);
    session.pendingAction = null;
    await this.saveSession(msg.channel, msg.channelUserId, session);
    await adapter.sendText(msg.chatId, res.message);
  }

  // ── Session ───────────────────────────────────────────────────────────────

  private async loadSession(channel: OperatorChannel, channelUserId: string): Promise<SessionState> {
    const row = await this.prisma.operatorSession.findUnique({
      where: { channel_channelUserId: { channel, channelUserId } },
    });
    if (!row) return { history: [], pendingAction: null };
    const state = (row.state as any) || {};
    // History never expires. A stale pending confirmation is dropped so it can
    // never be executed long after the user asked for it.
    let pendingAction = state.pendingAction ?? null;
    if (pendingAction?.createdAt && Date.now() - new Date(pendingAction.createdAt).getTime() > PENDING_TTL_MS) {
      pendingAction = null;
    }
    return { history: Array.isArray(state.history) ? state.history : [], pendingAction };
  }

  private async saveSession(channel: OperatorChannel, channelUserId: string, state: SessionState): Promise<void> {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.operatorSession
      .upsert({
        where: { channel_channelUserId: { channel, channelUserId } },
        update: { state: state as any, expiresAt },
        create: { channel, channelUserId, state: state as any, expiresAt },
      })
      .catch((e) => this.logger.warn(`session save failed: ${e.message}`));
  }
}
