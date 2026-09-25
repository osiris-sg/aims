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
  list_customers: '📇 Fetching customers...',
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
  edit_document: '✏️ Editing the document...',
  get_document_link: '🔗 Getting the link...',
  add_project_cost: '🧾 Recording the project cost...',
  edit_schedule: '🗓 Updating the schedule...',
  import_price_list: '📚 Adding the price list to the Work Library...',
  schedule_delivery: '🚚 Preparing the delivery...',
  find_sales_order: '🔎 Looking for the order or quotation...',
  api_write: '⚙️ Preparing the change...',
  ask_choice: '',
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
      this.whatsapp.rememberContext(msg.chatId, msg.businessPhoneNumberId, msg.providerMessageId);
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
        // The tap ANSWERING this picker arrives here too, because resolve()
        // still finds no stored org. Handling it before re-prompting is what
        // makes the picker escapable at all.
        if (msg.callbackData?.startsWith('org:')) {
          const picked = await this.auth.chooseOrgWhileUnset(msg.channel, msg.channelUserId, msg.callbackData.slice(4));
          if (picked) {
            await adapter.sendText(msg.chatId, `✅ Now working in ${picked.name}. What would you like to do?`);
            return;
          }
          await adapter.sendText(msg.chatId, "You don't have access to that organization.");
          return;
        }
        await this.presentOrgPicker(adapter, msg.chatId, resolved.options ?? []);
      }
      return;
    }
    const ctx: OperatorContext = resolved.ctx;

    // Button taps
    if (msg.callbackData) {
      await this.handleCallback(ctx, adapter, msg, msg.callbackData);
      return;
    }

    // Voice note: echo what we heard (so a mis-transcription is caught), or say
    // we couldn't make it out. Then the transcript flows through as normal text.
    if (msg.fromVoice) {
      if (!text) {
        await adapter.sendText(msg.chatId, "Sorry, I couldn't make out that voice note. Try again, or type it.");
        return;
      }
      await adapter.sendText(msg.chatId, `🎙️ "${text}"`);
    }

    // An uploaded file (photo/PDF of an invoice) → extract it and file it as a
    // project cost: match the invoice's site address to a project, else offer
    // the projects as tappable buttons.
    if (msg.attachment) {
      await adapter.sendTyping?.(msg.chatId).catch(() => null);
      const status = (await adapter.sendStatus?.(msg.chatId, '📎 Reading the uploaded invoice...')) ?? null;
      const up = await this.tools
        .extractUpload(ctx.organizationId, msg.attachment.dataUri, msg.attachment.mimetype, msg.attachment.filename)
        .catch(() => null);
      if (status) await adapter.deleteMessage?.(msg.chatId, status).catch(() => null);
      const session = await this.loadSession(msg.channel, msg.channelUserId);
      await this.handleUpload(ctx, adapter, msg, session, up);
      return;
    }

    if (/^\/(start|help)\b/i.test(text)) {
      await adapter.sendText(
        msg.chatId,
        `You're linked to ${ctx.organizationName}.\n\nAsk me things like:\n• "create a quotation for Acme, 2 fan coil units and 8 hours install"\n• "show me the last 5 quotations"\n• "what's QO2026-001?"\n\nI'll always show you a preview and ask before finalising anything.\n\nSend /org to switch organization.`,
      );
      return;
    }
    if (/^\/orgs?\b/i.test(text) || /^(switch|change) org/i.test(text)) {
      // Everything after the command is a name filter, so a long org list stays
      // reachable on channels that cap the picker at a handful of rows.
      const query = text.replace(/^\/orgs?\b/i, '').replace(/^(switch|change) org/i, '').trim();
      const options = await this.auth.listOrgOptions(ctx, query);
      if (!options.length) {
        await adapter.sendText(
          msg.chatId,
          query ? `No organization matches "${query}".` : 'You are not a member of any organization.',
        );
        return;
      }
      if (options.length === 1 && query) {
        // An unambiguous name: just switch, no tapping needed.
        await this.switchOrg(ctx, adapter, msg, options[0].id);
        return;
      }
      await this.presentOrgPicker(adapter, msg.chatId, options, ctx.organizationName);
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

  // ── Invoice upload → project costing ──────────────────────────────────────

  /** File an uploaded invoice as a project cost: match its site address to a
   *  project, else offer the projects as tappable buttons. */
  private async handleUpload(
    ctx: OperatorContext,
    adapter: ChannelAdapter,
    msg: InboundMessage,
    session: SessionState,
    up: OperatorContext['upload'] | null,
  ): Promise<void> {
    // A delivery held for want of its order? Then this upload IS that order.
    // Registering it here is the whole point: the gap was named, the file was
    // sent, the run is filled in — no extra step asked of the user.
    const held = session.pendingAction;
    if (up && held?.kind === 'schedule_delivery' && !held.args?.dto?.saleOrderId) {
      const dto = held.args!.dto;
      const so = await this.tools
        .createSaleOrderFromUpload(ctx, up, held.args!.customerName, dto.projectId)
        .catch(() => null);
      if (so) {
        dto.saleOrderId = so.id;
        dto.poNumber = dto.poNumber || so.name;
        // With the order attached, a run that was a draft only for want of one
        // becomes a real booking — provided it still has its project.
        const nowLive = !!dto.projectId;
        dto.isDraft = !nowLive;
        held.args!.isDraft = !nowLive;
        held.summary = held.summary
          .replace(/^Order: \(none\)$/m, `Order: ${so.name}`)
          .replace(/\n\nMissing [^\n]*$/, '');
        if (!nowLive) held.summary += `\n\nStill missing a project, so this saves as a DRAFT.`;
        session.pendingAction = held;
        session.pendingUpload = null;
        this.holdPending(session, held);
        await this.saveSession(msg.channel, msg.channelUserId, session);
        await adapter.sendButtons(msg.chatId, `${held.summary}\n\nConfirm?`, [
          { label: '✅ Confirm', data: `confirm:${held.id}` },
          { label: '❌ Cancel', data: `cancel:${held.id}` },
        ]);
        return;
      }
      await adapter.sendText(
        msg.chatId,
        "I couldn't read that as an order. Send the PO or quotation number instead and I'll attach it.",
      );
      return;
    }

    const e = up?.extracted;
    if (!up || e?.amount == null) {
      // Keep the stored file around — the next message may name what it really
      // is (e.g. "this is a contractor price list, add it to the work library").
      if (up) {
        session.pendingUpload = up;
        await this.saveSession(msg.channel, msg.channelUserId, session);
      }
      await adapter.sendText(
        msg.chatId,
        "I couldn't read an invoice amount from that file. If it's a supplier invoice, reply with the amount (and the project). If it's a contractor PRICE LIST, say \"add it to the work library\" and I'll import the rates.",
      );
      return;
    }
    const projects = await this.tools.listProjectsForMatch(ctx.organizationId);
    if (!projects.length) {
      await adapter.sendText(
        msg.chatId,
        'There are no projects yet to charge this to. Create a project in AIMS first, then resend the invoice.',
      );
      return;
    }
    const money = `${e.currency || 'SGD'} ${Number(e.amount).toFixed(2)}`;
    const who = e.supplierName || 'this supplier';

    // Pick a project: the only one, or a confident site-address match.
    let chosen = projects.length === 1 ? projects[0] : this.matchProjectByAddress(e.siteAddress, projects);

    if (chosen) {
      ctx.upload = up;
      const outcome = await this.tools.execute(ctx, 'add_project_cost', { projectId: chosen.id });
      session.pendingUpload = null;
      if (outcome.pending) {
        session.pendingAction = outcome.pending;
        this.holdPending(session, outcome.pending);
        await this.saveSession(msg.channel, msg.channelUserId, session);
        await adapter.sendButtons(msg.chatId, `${outcome.pending.summary}\n\nConfirm?`, [
          { label: '✅ Confirm', data: `confirm:${outcome.pending.id}` },
          { label: '❌ Cancel', data: `cancel:${outcome.pending.id}` },
        ]);
      } else {
        await this.saveSession(msg.channel, msg.channelUserId, session);
        await adapter.sendText(msg.chatId, outcome.result?.error || "I couldn't record that cost.");
      }
      return;
    }

    // Ambiguous → let them tap the project. Stash the upload for the tap.
    session.pendingUpload = up;
    session.pendingAction = null;
    await this.saveSession(msg.channel, msg.channelUserId, session);
    const prompt = `Which project should I charge ${who} (${money}) to?`;
    if (projects.length > 3 && adapter.sendList) {
      // More than 3 → a scrollable list (up to 10).
      await adapter.sendList(
        msg.chatId,
        prompt,
        'Choose project',
        projects.slice(0, 10).map((p) => ({
          id: `costproj:${p.id}`,
          title: p.name || p.customer || 'Project',
          description: p.address || p.customer || undefined,
        })),
      );
      if (projects.length > 10) {
        await adapter.sendText(
          msg.chatId,
          `(${projects.length} projects total — showing 10. If it's a different one, tell me the project name.)`,
        );
      }
    } else {
      // 3 or fewer (or a channel without lists) → buttons.
      await adapter.sendButtons(
        msg.chatId,
        prompt,
        projects.slice(0, 3).map((p) => ({ label: this.projectButtonLabel(p), data: `costproj:${p.id}` })),
      );
      if (projects.length > 3) {
        await adapter.sendText(
          msg.chatId,
          `(${projects.length} projects total — showing the first 3. If it's a different one, just tell me the project name.)`,
        );
      }
    }
  }

  /** Confident site-address match: score projects by shared distinctive tokens
   *  (numbers weigh more), return the clear winner or null. */
  private matchProjectByAddress(
    siteAddress: string | null | undefined,
    projects: Array<{ id: string; name: string; address: string | null; customer: string | null }>,
  ): (typeof projects)[number] | null {
    if (!siteAddress) return null;
    const norm = (s: any) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const invTokens = new Set(norm(siteAddress).split(' ').filter((t) => t.length >= 2));
    if (!invTokens.size) return null;
    const scoreFor = (p: (typeof projects)[number]) => {
      const ptoks = new Set(norm(`${p.name} ${p.address || ''}`).split(' ').filter(Boolean));
      let score = 0;
      for (const t of ptoks) if (invTokens.has(t)) score += /[0-9]/.test(t) ? 2 : 1;
      return score;
    };
    const scored = projects.map((p) => ({ p, s: scoreFor(p) })).sort((a, b) => b.s - a.s);
    const [best, second] = scored;
    // Confident: clears a threshold AND clearly beats the runner-up.
    if (best && best.s >= 4 && (!second || best.s >= second.s + 3)) return best.p;
    return null;
  }

  private projectButtonLabel(p: { name: string; customer: string | null }): string {
    return (p.name || p.customer || 'Project').slice(0, 20);
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
    let choiceFromTools: { question: string; options: string[] } | null = null;

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
        if ((outcome as any).choice) choiceFromTools = (outcome as any).choice;
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          // Once a tool asks for confirmation, the SYSTEM shows the user a
          // Confirm/Cancel button and executes on their tap. Tell the model to
          // stop so it doesn't loop calling the tool or re-ask in its own words.
          content: outcome.pending
            ? 'A Confirm/Cancel button has been shown to the user. STOP now: do not call this tool again, do not ask for confirmation yourself, and do not say it is done. The system will finalize it when the user taps Confirm.'
            : (outcome as any).choice
              ? 'The buttons have been shown to the user. STOP now and say nothing further: their tap arrives as the next message.'
              : JSON.stringify(outcome.result ?? {}).slice(0, 6000),
        });
      }
      messages.push({ role: 'user', content: results });
      // A confirmation is now pending — end the model loop and wait for the
      // user's decision rather than letting the model reason further.
      if (pendingFromTools || choiceFromTools) break;
      await showStatus('💭 Thinking...');
    }

    await clearStatus();

    // Persist trimmed history + any action now awaiting confirmation. The card
    // has to be held BEFORE the save, or its id never reaches the database and
    // every tap comes back "expired".
    session.history = this.trimHistory(messages) as SessionState['history'];
    if (pendingFromTools) this.holdPending(session, pendingFromTools);
    else session.pendingAction = null;
    await this.saveSession(msg.channel, msg.channelUserId, session);

    if (choiceFromTools) {
      await adapter.sendButtons(
        msg.chatId,
        choiceFromTools.question,
        choiceFromTools.options.slice(0, 3).map((o: string) => ({ label: o.slice(0, 20), data: `choice:${o}` })),
      );
    }

    if (pendingFromTools) {
      await adapter.sendButtons(msg.chatId, `${pendingFromTools.summary}\n\nConfirm?`, [
          { label: '✅ Confirm', data: `confirm:${pendingFromTools.id}` },
          { label: '❌ Cancel', data: `cancel:${pendingFromTools.id}` },
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
    // Without this the model dates "tomorrow" from its training data — a real
    // schedule came back as 2 Sept when the user meant the 23rd.
    const now = new Date();
    const fmt = (d: Date) =>
      d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Singapore' });
    const iso = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
    const tomorrow = new Date(now.getTime() + 86400_000);
    return [
      `You are the AIMS Operator, an assistant that performs real work inside the AIMS business system on behalf of staff, over chat.`,
      `TODAY is ${fmt(now)} (${iso(now)}) in Singapore time. TOMORROW is ${fmt(tomorrow)} (${iso(tomorrow)}). Work out every relative date ("tomorrow", "next Tuesday", "end of the month") from these, never from memory, and always send dates as ISO-8601 with the +08:00 offset.`,
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
      `7b. BE SHORT (guru 2026-09-22: "always short and sweet, get to the point"). Lead with the answer or the gap, never a paragraph of preamble. When something is missing, say which field is missing in a few words and stop; do not explain the consequences at length or restate what the user just told you. When you need the user to pick between options, DO NOT write them out as "1. ... 2. ..." — call ask_choice and they tap a button. Offer to take an upload when a document would fill the gap.`,
      `8. PUNCTUATION: never use em dashes or en dashes ("—", "–") in your replies OR in any text you write into a document (line item descriptions, notes, terms). Use a comma, a full stop, a colon or brackets instead. Ordinary hyphens inside words (e.g. "Fan-Coil") are fine.`,
      `9. FULL DASHBOARD ACCESS: you can read ANYTHING the user's web dashboard shows, even without a dedicated tool. When asked about commissions, earnings, targets, dashboards, reports, schedules, quests, leads or any other screen's numbers: call api_docs with keywords to find the right GET endpoint, then api_get to fetch it (their permissions are enforced automatically). Examples: designer commissions/revenue live at /id-projects/dashboard; a project's P&L incl. commission at /projects/<id>/costing. NEVER answer "I don't have a tool for that" before trying api_docs.`,
      `10. CHANGING THINGS WITHOUT A DEDICATED TOOL: if no tool covers an action the user wants, do NOT invent one out of a tool that looks close (that is how a delivery schedule became a priced document). Search api_docs for the POST/PATCH/PUT endpoint, build the body from the {field*:type} list it returns, then call api_write with a plain-English summary of what will change. It does not fire immediately: the user sees your summary and taps Confirm. If the call comes back with a validation error, read the field names in it and fix the body rather than giving up. Money and irreversible actions (confirming invoices, posting bills, recording payments, deleting) are blocked there by design, so use their dedicated tools.`,
      `11. RETRY, DON'T REMEMBER FAILURES: tool errors are often transient (deploys, config changes between messages). When the user asks again for something that failed earlier in this chat, ALWAYS call the tool again fresh. NEVER claim you "tried again" unless you actually called the tool this turn, and never present an old error as the current state.`,
    ].join('\n');
  }

  // ── Confirmation handling ─────────────────────────────────────────────────

  /**
   * Render the org picker. WhatsApp reply buttons cap at THREE (the adapter
   * silently drops the rest), so anything larger goes out as a tappable list,
   * which holds ten. Beyond that, `/org <name>` narrows it.
   */
  private async presentOrgPicker(
    adapter: ChannelAdapter,
    chatId: string,
    options: Array<{ id: string; name: string }>,
    currentName?: string,
  ): Promise<void> {
    const prompt = currentName
      ? `Currently working in ${currentName}. Switch to:`
      : 'Which organization should I work in?';
    if (options.length > 3 && adapter.sendList) {
      await adapter.sendList(
        chatId,
        options.length > 10
          ? `${prompt}\n\nShowing the first 10. Send "/org <name>" to narrow it down.`
          : prompt,
        'Choose org',
        options.slice(0, 10).map((o) => ({ id: `org:${o.id}`, title: o.name })),
      );
      return;
    }
    await adapter.sendButtons(
      chatId,
      prompt,
      options.slice(0, 3).map((o) => ({ label: o.name, data: `org:${o.id}` })),
    );
  }

  /** Persist the chosen org for this sender and confirm it. */
  private async switchOrg(
    ctx: OperatorContext,
    adapter: ChannelAdapter,
    msg: InboundMessage,
    organizationId: string,
  ): Promise<void> {
    const org = await this.auth.canUseOrg(ctx, organizationId);
    if (!org) {
      await adapter.sendText(msg.chatId, "You don't have access to that organization.");
      return;
    }
    await this.auth.setOrganization(msg.channel, msg.channelUserId, org.id);
    await adapter.sendText(msg.chatId, `✅ Now working in ${org.name}. Everything I do next applies to this org.`);
  }

  private async handleCallback(
    ctx: OperatorContext,
    adapter: ChannelAdapter,
    msg: InboundMessage,
    data: string,
  ): Promise<void> {
    if (data.startsWith('choice:')) {
      // The label the user tapped re-enters as ordinary text, so the model
      // picks up exactly where it left off with no special-casing.
      const picked = data.slice('choice:'.length);
      const choiceSession = await this.loadSession(msg.channel, msg.channelUserId);
      await this.runAgent(ctx, adapter, { ...msg, text: picked, callbackData: undefined }, choiceSession, picked);
      return;
    }

    if (data.startsWith('org:')) {
      await this.switchOrg(ctx, adapter, msg, data.slice(4));
      return;
    }

    const session = await this.loadSession(msg.channel, msg.channelUserId);

    // Project chosen for an uploaded invoice's cost.
    if (data.startsWith('costproj:')) {
      const projectId = data.slice('costproj:'.length);
      const up = session.pendingUpload;
      if (!up) {
        await adapter.sendText(msg.chatId, 'That invoice upload has expired — please resend it.');
        return;
      }
      ctx.upload = up;
      const outcome = await this.tools.execute(ctx, 'add_project_cost', { projectId });
      session.pendingUpload = null;
      if (outcome.pending) {
        session.pendingAction = outcome.pending;
        this.holdPending(session, outcome.pending);
        await this.saveSession(msg.channel, msg.channelUserId, session);
        await adapter.sendButtons(msg.chatId, `${outcome.pending.summary}\n\nConfirm?`, [
          { label: '✅ Confirm', data: `confirm:${outcome.pending.id}` },
          { label: '❌ Cancel', data: `cancel:${outcome.pending.id}` },
        ]);
      } else {
        await this.saveSession(msg.channel, msg.channelUserId, session);
        await adapter.sendText(msg.chatId, outcome.result?.error || "I couldn't record that cost.");
      }
      return;
    }

    if (data === 'cancel' || data.startsWith('cancel:')) {
      const dropped = this.takePending(session, data.startsWith('cancel:') ? data.slice(7) : '');
      await this.saveSession(msg.channel, msg.channelUserId, session);
      await adapter.sendText(
        msg.chatId,
        dropped ? 'Cancelled. Nothing was changed.' : 'That one is no longer waiting, so nothing was changed.',
      );
      return;
    }
    if (data.startsWith('confirm:')) {
      const chosen = this.takePending(session, data.slice(8));
      if (!chosen) {
        await adapter.sendText(msg.chatId, 'That confirmation has expired. Ask me again and I’ll redo it.');
        return;
      }
      await this.executePending(ctx, adapter, msg, session, chosen);
    }
  }

  /** Hold a card and return its id for the buttons. Keeps the last few so a
   *  tap on an older card still lands on the right action. */
  private holdPending(session: SessionState, pending: PendingAction): string {
    const id = pending.id || `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    pending.id = id;
    const list = (session.pendingActions || []).filter((p) => p.id !== id);
    list.push(pending);
    session.pendingActions = list.slice(-3);
    session.pendingAction = pending; // newest, for the typed "yes" path
    return id;
  }

  /** Find a card by the id its button carried, and drop it from the held set. */
  private takePending(session: SessionState, id: string): PendingAction | null {
    const list = session.pendingActions || (session.pendingAction ? [session.pendingAction] : []);
    const found = list.find((p) => p.id === id) || (!id || id === 'pending' ? list[list.length - 1] : null);
    if (!found) return null;
    session.pendingActions = list.filter((p) => p !== found);
    session.pendingAction = session.pendingActions[session.pendingActions.length - 1] ?? null;
    return found;
  }

  private async executePending(
    ctx: OperatorContext,
    adapter: ChannelAdapter,
    msg: InboundMessage,
    session: SessionState,
    chosen?: PendingAction,
  ): Promise<void> {
    const pending = chosen ?? session.pendingAction!;
    let res: { ok: boolean; message: string };
    try {
      res = await this.tools.runPending(ctx, pending);
    } catch (e: any) {
      // A thrown confirm used to vanish silently (the webhook swallows the
      // rejection) leaving the user with no feedback and a stuck pendingAction.
      // Surface the real reason and clear the action so they can retry.
      this.logger.error(`runPending(${pending.kind}) failed: ${e?.message}`);
      const detail = e?.response?.message ?? e?.message ?? 'Unknown error';
      res = {
        ok: false,
        message: `Sorry, I couldn't finalise that: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`,
      };
    }
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
    const fresh = (p: any) => p && (!p.createdAt || Date.now() - new Date(p.createdAt).getTime() <= PENDING_TTL_MS);
    let pendingAction = fresh(state.pendingAction) ? state.pendingAction : null;
    const pendingActions: PendingAction[] = (Array.isArray(state.pendingActions) ? state.pendingActions : []).filter(fresh);
    // Older sessions stored only the single slot — carry it into the list so a
    // card shown before this change still responds to its buttons.
    if (pendingAction && !pendingActions.some((p) => p.id && p.id === pendingAction.id)) pendingActions.push(pendingAction);
    if (!pendingAction && pendingActions.length) pendingAction = pendingActions[pendingActions.length - 1];
    return { history: Array.isArray(state.history) ? state.history : [], pendingAction, pendingActions };
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
